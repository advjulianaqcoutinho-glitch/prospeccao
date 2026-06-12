'use strict';

const { Router } = require('express');
const supabase = require('../db');
const aiService = require('../services/aiService');
const evolutionService = require('../services/evolutionService');
const enrichmentService = require('../services/enrichmentService');
const exportService = require('../services/exportService');

// Helper: fetch user profile for AI calls
async function getUserProfile(userId) {
  if (!userId) return { nome: 'Consultor', empresa: '', descricao: '', tom_comunicacao: 'amigável' };
  const { data } = await supabase.from('user_profile').select('nome, empresa, descricao, tom_comunicacao').eq('id', userId).single();
  return data || { nome: 'Consultor', empresa: '', descricao: '', tom_comunicacao: 'amigável' };
}

// Helper: fetch campanha for a lead
async function getCampanha(campanhaId) {
  if (!campanhaId) return {};
  const { data } = await supabase.from('campanhas').select('nicho, contexto').eq('id', campanhaId).single();
  return data || {};
}

const router = Router();

// GET /export (must be before /:id routes)
router.get('/export', async (req, res) => {
  try {
    const filters = {
      campanha_id: req.query.campanha_id,
      status: req.query.status,
    };
    const csv = await exportService.exportLeads(filters);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
    return res.send(csv);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /
router.get('/', async (req, res) => {
  const {
    campanha_id, status, kanban_stage,
    search, tag_id,
    limit = 50, offset = 0,
  } = req.query;

  let query = supabase
    .from('leads')
    .select('*', { count: 'exact' })
    .order('criado_em', { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  if (campanha_id) query = query.eq('campanha_id', campanha_id);
  if (status) query = query.eq('status', status);
  if (kanban_stage) query = query.eq('kanban_stage', kanban_stage);
  if (search) {
    // Escape special PostgREST characters to prevent query injection
    const safe = search.replace(/[%_().,]/g, (c) => '\\' + c).slice(0, 100);
    query = query.or(`nome.ilike.%${safe}%,telefone.ilike.%${safe}%`);
  }
  if (tag_id) {
    // filter leads that have this tag
    const { data: taggedLeads } = await supabase
      .from('lead_tags')
      .select('lead_id')
      .eq('tag_id', tag_id);
    const ids = (taggedLeads || []).map((t) => t.lead_id);
    if (ids.length === 0) return res.json({ data: [], count: 0 });
    query = query.in('id', ids);
  }

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ data: data || [], count });
});

// POST /
router.post('/', async (req, res) => {
  const { nome, telefone, campanha_id, endereco, email, nicho } = req.body || {};
  if (!nome || !telefone) {
    return res.status(400).json({ error: 'nome and telefone are required' });
  }

  const { data, error } = await supabase
    .from('leads')
    .insert({ nome, telefone, campanha_id, endereco, email, nicho, status: 'pendente', criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(data);
});

// GET /:id
router.get('/:id', async (req, res) => {
  const [leadRes, interactionsRes, notesRes, tagsRes] = await Promise.all([
    supabase.from('leads').select('*').eq('id', req.params.id).single(),
    supabase.from('interactions').select('*').eq('lead_id', req.params.id)
      .order('created_at', { ascending: false }).limit(20),
    supabase.from('lead_notes').select('*').eq('lead_id', req.params.id)
      .order('created_at', { ascending: false }),
    supabase.from('lead_tags').select('tag_id, tags(*)').eq('lead_id', req.params.id),
  ]);

  if (leadRes.error) return res.status(404).json({ error: leadRes.error.message });

  return res.json({
    ...leadRes.data,
    interactions: interactionsRes.data || [],
    notes: notesRes.data || [],
    tags: tagsRes.data || [],
  });
});

// PATCH /:id
router.patch('/:id', async (req, res) => {
  const updates = { ...req.body, atualizado_em: new Date().toISOString() };
  delete updates.id;

  const { data, error } = await supabase
    .from('leads')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.json(data);
});

// DELETE /:id
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('leads').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  return res.status(204).send();
});

// POST /:id/regenerar-mensagem
router.post('/:id/regenerar-mensagem', async (req, res) => {
  const { variante } = req.body || {};

  const { data: lead, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !lead) return res.status(404).json({ error: 'Lead not found' });

  try {
    const campanha = await getCampanha(lead.campanha_id);
    const perfil = await getUserProfile(req.user && req.user.id);
    const variant = variante === 'b' ? 'b' : 'a';
    const mensagem = await aiService.gerarMensagem(lead.nome, campanha.nicho || '', campanha.contexto || '', perfil, variant);
    const field = variante === 'b' ? 'mensagem_variante_b' : 'mensagem_gerada';

    await supabase
      .from('leads')
      .update({ [field]: mensagem, atualizado_em: new Date().toISOString() })
      .eq('id', req.params.id);

    return res.json({ mensagem, field });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /:id/disparar
router.post('/:id/disparar', async (req, res) => {
  const { data: lead, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !lead) return res.status(404).json({ error: 'Lead not found' });
  if (!lead.mensagem_gerada) return res.status(400).json({ error: 'Mensagem não gerada. Abra o lead e gere a mensagem antes de enviar.' });

  try {
    await evolutionService.enviarMensagem(lead.telefone, lead.mensagem_gerada);

    const now = new Date().toISOString();
    await Promise.all([
      supabase.from('interactions').insert({
        lead_id: lead.id,
        type: 'message_sent',
        payload: { content: lead.mensagem_gerada },
        created_at: now,
      }),
      supabase.from('leads').update({ status: 'enviado', enviado_em: now, atualizado_em: now }).eq('id', lead.id),
    ]);

    return res.json({ message: 'Mensagem enviada' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /:id/agendar
router.post('/:id/agendar', async (req, res) => {
  const { scheduled_at } = req.body || {};
  if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at is required' });

  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('id, campanha_id')
    .eq('id', req.params.id)
    .single();

  if (leadErr || !lead) return res.status(404).json({ error: 'Lead not found' });

  const { data, error } = await supabase
    .from('send_queue')
    .insert({
      lead_id: lead.id,
      campanha_id: lead.campanha_id,
      scheduled_at,
      status: 'pending',
      type: 'scheduled',
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(data);
});

// PATCH /:id/kanban
router.patch('/:id/kanban', async (req, res) => {
  const { kanban_stage } = req.body || {};
  if (!kanban_stage) return res.status(400).json({ error: 'kanban_stage is required' });

  const now = new Date().toISOString();
  const [updateRes, interactionRes] = await Promise.all([
    supabase.from('leads').update({ kanban_stage, atualizado_em: now }).eq('id', req.params.id).select().single(),
    supabase.from('interactions').insert({
      lead_id: req.params.id,
      type: 'stage_change',
      payload: { stage: kanban_stage },
      created_at: now,
    }),
  ]);

  if (updateRes.error) return res.status(400).json({ error: updateRes.error.message });
  return res.json(updateRes.data);
});

// POST /:id/notes
router.post('/:id/notes', async (req, res) => {
  const { conteudo } = req.body || {};
  if (!conteudo) return res.status(400).json({ error: 'conteudo is required' });

  const { data, error } = await supabase
    .from('lead_notes')
    .insert({ lead_id: req.params.id, content: conteudo, created_at: new Date().toISOString() })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(data);
});

// DELETE /:id/notes/:noteId
router.delete('/:id/notes/:noteId', async (req, res) => {
  const { error } = await supabase
    .from('lead_notes')
    .delete()
    .eq('id', req.params.noteId)
    .eq('lead_id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  return res.status(204).send();
});

// POST /:id/tags
router.post('/:id/tags', async (req, res) => {
  const { tag_ids } = req.body || {};
  if (!Array.isArray(tag_ids)) return res.status(400).json({ error: 'tag_ids must be an array' });

  // Remove existing tags then insert
  await supabase.from('lead_tags').delete().eq('lead_id', req.params.id);

  if (tag_ids.length > 0) {
    const rows = tag_ids.map((tag_id) => ({ lead_id: req.params.id, tag_id }));
    const { error } = await supabase.from('lead_tags').insert(rows);
    if (error) return res.status(400).json({ error: error.message });
  }

  const { data, error } = await supabase
    .from('lead_tags')
    .select('tag_id, tags(*)')
    .eq('lead_id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /:id/blacklist
router.post('/:id/blacklist', async (req, res) => {
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('telefone')
    .eq('id', req.params.id)
    .single();

  if (leadErr || !lead) return res.status(404).json({ error: 'Lead not found' });

  const { motivo } = req.body || {};
  const now = new Date().toISOString();

  await Promise.all([
    supabase.from('blacklist').insert({ telefone: lead.telefone, telefone_normalizado: lead.telefone.replace(/\D/g, ''), motivo, created_at: now }),
    supabase.from('leads').update({ status: 'blacklisted', atualizado_em: now }).eq('id', req.params.id),
  ]);

  return res.json({ message: 'Lead adicionado à blacklist' });
});

// GET /:id/timeline
router.get('/:id/timeline', async (req, res) => {
  const [interactionsRes, notesRes] = await Promise.all([
    supabase.from('interactions').select('type, payload, created_at')
      .eq('lead_id', req.params.id).order('created_at', { ascending: false }).limit(100),
    supabase.from('lead_notes').select('content, created_at')
      .eq('lead_id', req.params.id).order('created_at', { ascending: false }),
  ]);

  if (interactionsRes.error) return res.status(500).json({ error: interactionsRes.error.message });

  const interactions = (interactionsRes.data || []).map((i) => ({
    type: i.type, content: i.payload?.content || null, created_at: i.created_at,
  }));
  const notes = (notesRes.data || []).map((n) => ({
    type: 'note', content: n.content, created_at: n.created_at,
  }));

  const timeline = [...interactions, ...notes].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return res.json(timeline);
});

// POST /:id/score
router.post('/:id/score', async (req, res) => {
  const { data: lead, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !lead) return res.status(404).json({ error: 'Lead not found' });

  try {
    // aiService.calcularScore expects empresa-like object with rating, review_count, website, nicho
    const scoreInput = {
      rating: lead.rating || 0,
      review_count: lead.review_count || 0,
      website: lead.website || null,
      nicho: lead.nicho || '',
    };
    const result = await aiService.calcularScore(scoreInput);
    await supabase
      .from('leads')
      .update({ score: result.score, score_breakdown: result.breakdown, atualizado_em: new Date().toISOString() })
      .eq('id', req.params.id);

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /:id/enrich
router.post('/:id/enrich', async (req, res) => {
  try {
    const result = await enrichmentService.enrichLead(req.params.id);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /:id/analisar-resposta
router.post('/:id/analisar-resposta', async (req, res) => {
  const { resposta } = req.body || {};
  if (!resposta) return res.status(400).json({ error: 'resposta is required' });

  const { data: lead, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !lead) return res.status(404).json({ error: 'Lead not found' });

  try {
    const analise = await aiService.analisarResposta(lead.mensagem_gerada || '', resposta);

    await supabase.from('leads').update({
      classificacao: analise.classificacao,
      atualizado_em: new Date().toISOString(),
    }).eq('id', req.params.id);

    return res.json(analise);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
