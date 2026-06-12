'use strict';

const { Router } = require('express');
const supabase = require('../db');

const router = Router();

// GET /respostas — leads que responderam, com última interação
router.get('/', async (req, res) => {
  const { campanha_id, classificacao, limit = 50, offset = 0 } = req.query;

  let query = supabase
    .from('leads')
    .select('*, campanhas(nome)', { count: 'exact' })
    .eq('status', 'respondeu')
    .order('atualizado_em', { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  if (campanha_id) query = query.eq('campanha_id', campanha_id);
  if (classificacao) query = query.eq('classificacao', classificacao);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Attach last reply message from interactions
  const leads = data || [];
  if (leads.length > 0) {
    const ids = leads.map((l) => l.id);
    const { data: interactions } = await supabase
      .from('interactions')
      .select('lead_id, payload, created_at')
      .in('lead_id', ids)
      .eq('type', 'response_received')
      .order('created_at', { ascending: false });

    const lastByLead = {};
    for (const i of interactions || []) {
      if (!lastByLead[i.lead_id]) lastByLead[i.lead_id] = i;
    }

    for (const lead of leads) {
      const last = lastByLead[lead.id];
      lead.ultima_resposta = last ? (last.payload && last.payload.content) : null;
      lead.respondeu_em = last ? last.created_at : null;
    }
  }

  return res.json({ data: leads, count });
});

// POST /respostas/:leadId/reply — enviar resposta via WhatsApp
router.post('/:leadId/reply', async (req, res) => {
  const { mensagem } = req.body || {};
  if (!mensagem) return res.status(400).json({ error: 'mensagem is required' });

  const { data: lead, error } = await supabase
    .from('leads').select('id, telefone, campanha_id').eq('id', req.params.leadId).single();
  if (error || !lead) return res.status(404).json({ error: 'Lead not found' });

  try {
    const evolutionService = require('../services/evolutionService');
    await evolutionService.enviarMensagem(lead.telefone, mensagem);

    const now = new Date().toISOString();
    await supabase.from('interactions').insert({
      lead_id: lead.id,
      campanha_id: lead.campanha_id,
      type: 'reply_sent',
      payload: { content: mensagem },
      created_at: now,
    });

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /respostas/:leadId/classificar
router.patch('/:leadId/classificar', async (req, res) => {
  const { classificacao } = req.body || {};
  if (!classificacao) return res.status(400).json({ error: 'classificacao is required' });

  const { data, error } = await supabase
    .from('leads')
    .update({ classificacao, atualizado_em: new Date().toISOString() })
    .eq('id', req.params.leadId).select().single();

  if (error) return res.status(400).json({ error: error.message });
  return res.json(data);
});

module.exports = router;
