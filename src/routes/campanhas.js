'use strict';

const { Router } = require('express');
const { fork } = require('child_process');
const path = require('path');
const supabase = require('../db');
const ws = require('../ws');

const router = Router();

// GET /stats/hoje — must come before /:id routes
router.get('/stats/hoje', async (req, res) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count: sentToday, error } = await supabase
    .from('send_queue')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'sent')
    .gte('scheduled_at', todayStart.toISOString());

  if (error) return res.status(500).json({ error: error.message });

  // Estimate daily limit from most recent pending/sent batch
  const { data: limitRow } = await supabase
    .from('send_queue')
    .select('scheduled_at')
    .gte('created_at', todayStart.toISOString())
    .limit(1);

  return res.json({ sent_today: sentToday || 0 });
});

// GET /arquivadas
router.get('/arquivadas', async (req, res) => {
  const { data, error } = await supabase
    .from('campanhas')
    .select('*, leads(count)')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// GET /
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('campanhas')
    .select('*, leads(count)')
    .is('deleted_at', null)
    .order('criado_em', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /
router.post('/', async (req, res) => {
  const {
    nome, nicho, cidade, limite, contexto,
    delay_min = 30, delay_max = 120,
    warmup_enabled, warmup_day_limit, warmup_max_limit,
    business_hours_enabled, business_hours_start, business_hours_end,
    ab_testing_enabled, source, whatsapp_instance_id,
  } = req.body || {};

  if (!nome || !nicho || !cidade) {
    return res.status(400).json({ error: 'nome, nicho, and cidade are required' });
  }

  const { data, error } = await supabase
    .from('campanhas')
    .insert({
      nome, nicho, cidade,
      limite: limite || 10,
      contexto,
      delay_min, delay_max,
      warmup_enabled: warmup_enabled || false,
      warmup_day_limit: parseInt(warmup_day_limit) || 20,
      warmup_max_limit: parseInt(warmup_max_limit) || 200,
      business_hours_enabled: business_hours_enabled || false,
      business_hours_start: parseInt(business_hours_start) || 8,
      business_hours_end: parseInt(business_hours_end) || 18,
      ab_testing_enabled: ab_testing_enabled || false,
      source,
      whatsapp_instance_id: whatsapp_instance_id || null,
      status: 'criada',
      criado_em: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(data);
});

// GET /:id
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('campanhas')
    .select('*, followup_sequences(*)')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: error.message });
  return res.json(data);
});

// PATCH /:id
router.patch('/:id', async (req, res) => {
  const updates = { ...req.body, atualizado_em: new Date().toISOString() };
  delete updates.id;

  const { data, error } = await supabase
    .from('campanhas')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.json(data);
});

// DELETE /:id → soft-delete (archive)
router.delete('/:id', async (req, res) => {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('campanhas')
    .update({ deleted_at: now, status: 'arquivada', atualizado_em: now })
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  return res.status(204).send();
});

// POST /:id/arquivar
router.post('/:id/arquivar', async (req, res) => {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('campanhas')
    .update({ deleted_at: now, status: 'arquivada', atualizado_em: now })
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  return res.json({ message: 'Campanha arquivada' });
});

// POST /:id/restaurar
router.post('/:id/restaurar', async (req, res) => {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('campanhas')
    .update({ deleted_at: null, status: 'pronta', atualizado_em: now })
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  return res.json({ message: 'Campanha restaurada' });
});

// DELETE /:id/permanente — hard delete with lead count check
router.delete('/:id/permanente', async (req, res) => {
  const confirmar = req.query.confirmar === 'true';

  const { count: leadsCount, error: countErr } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('campanha_id', req.params.id);

  if (countErr) return res.status(500).json({ error: countErr.message });

  if (!confirmar && leadsCount > 0) {
    return res.status(409).json({
      leads_count: leadsCount,
      message: `Esta campanha tem ${leadsCount} leads. Passe ?confirmar=true para excluir permanentemente.`,
    });
  }

  // Delete leads first, then campaign
  await supabase.from('leads').delete().eq('campanha_id', req.params.id);
  const { error } = await supabase.from('campanhas').delete().eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  return res.status(204).send();
});

// POST /:id/prospectar
router.post('/:id/prospectar', async (req, res) => {
  const { data: campanha, error } = await supabase
    .from('campanhas')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !campanha) return res.status(404).json({ error: 'Campanha not found' });

  await supabase
    .from('campanhas')
    .update({ status: 'prospectando', atualizado_em: new Date().toISOString() })
    .eq('id', req.params.id);

  const prospectorPath = path.resolve(__dirname, '../../src/scraper/prospector.js');
  const child = fork(prospectorPath, [JSON.stringify(campanha)], {
    detached: true,
    stdio: 'pipe', // keep IPC + pipe stderr for crash logs
  });

  // Forward all progress messages from the scraper to WebSocket clients
  child.on('message', (msg) => {
    ws.broadcast({ ...msg, campanha_id: req.params.id, campanha_nome: campanha.nome });
  });

  child.stderr?.on('data', (data) => {
    console.error(`[prospector:${req.params.id}]`, data.toString().trim());
    ws.broadcast({
      tipo: 'erro',
      mensagem: data.toString().trim().slice(0, 200),
      campanha_id: req.params.id,
    });
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      ws.broadcast({
        tipo: 'erro',
        mensagem: `Processo encerrou inesperadamente (código ${code})`,
        campanha_id: req.params.id,
      });
    }
  });

  child.unref();

  return res.json({ message: 'Prospecção iniciada', campanha_id: req.params.id });
});

// POST /:id/disparar-massa
router.post('/:id/disparar-massa', async (req, res) => {
  const { data: campanha, error: campanhaErr } = await supabase
    .from('campanhas')
    .select('delay_min, delay_max, business_hours_enabled, business_hours_start, business_hours_end')
    .eq('id', req.params.id)
    .single();

  if (campanhaErr || !campanha) return res.status(404).json({ error: 'Campanha not found' });

  const leadIds = Array.isArray(req.body.lead_ids) && req.body.lead_ids.length > 0
    ? req.body.lead_ids : null;

  let leadsQuery = supabase
    .from('leads')
    .select('id, telefone')
    .eq('campanha_id', req.params.id)
    .eq('status', 'pendente');

  if (leadIds) leadsQuery = leadsQuery.in('id', leadIds);

  const { data: leads, error: leadsErr } = await leadsQuery;

  if (leadsErr) return res.status(500).json({ error: leadsErr.message });
  if (!leads || leads.length === 0) return res.json({ queued: 0 });

  const delayMin = parseInt(req.body.delay_min) || campanha.delay_min || 30;
  const delayMax = parseInt(req.body.delay_max) || campanha.delay_max || 120;
  const bizEnabled = campanha.business_hours_enabled || false;
  const bizStartH = parseInt(campanha.business_hours_start) || 8;
  const bizEndH = parseInt(campanha.business_hours_end) || 18;
  const dailyLimit = parseInt(req.body.daily_limit) || null;

  let scheduled = new Date();

  function nextBusinessTime(dt) {
    if (!bizEnabled) return dt;
    const startMinutes = bizStartH * 60;
    const endMinutes = bizEndH * 60;
    const dayMinutes = dt.getHours() * 60 + dt.getMinutes();

    if (dayMinutes < startMinutes) {
      dt.setHours(bizStartH, 0, 0, 0);
    } else if (dayMinutes >= endMinutes) {
      dt.setDate(dt.getDate() + 1);
      dt.setHours(bizStartH, 0, 0, 0);
    }
    while (dt.getDay() === 0 || dt.getDay() === 6) {
      dt.setDate(dt.getDate() + 1);
      dt.setHours(bizStartH, 0, 0, 0);
    }
    return dt;
  }

  function advanceToNextBusinessDay(dt) {
    dt.setDate(dt.getDate() + 1);
    dt.setHours(bizStartH, 0, 0, 0);
    while (dt.getDay() === 0 || dt.getDay() === 6) {
      dt.setDate(dt.getDate() + 1);
    }
    return dt;
  }

  let currentDay = scheduled.toDateString();
  let countToday = 0;

  const queueItems = leads.map((lead) => {
    // If daily limit hit, jump to next business day
    if (dailyLimit && countToday >= dailyLimit) {
      scheduled = advanceToNextBusinessDay(new Date(scheduled));
      currentDay = scheduled.toDateString();
      countToday = 0;
    }

    const delaySecs = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
    scheduled = new Date(scheduled.getTime() + delaySecs * 1000);
    scheduled = nextBusinessTime(new Date(scheduled));

    // If the delay pushed into a new day, reset counter for that day
    if (scheduled.toDateString() !== currentDay) {
      currentDay = scheduled.toDateString();
      countToday = 0;
    }

    countToday++;

    return {
      lead_id: lead.id,
      campanha_id: req.params.id,
      scheduled_at: scheduled.toISOString(),
      status: 'pending',
      type: 'initial',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });

  const { error: insertErr } = await supabase.from('send_queue').insert(queueItems);
  if (insertErr) return res.status(500).json({ error: insertErr.message });

  return res.json({ queued: queueItems.length });
});

// POST /:id/pausar
router.post('/:id/pausar', async (req, res) => {
  const { error } = await supabase
    .from('send_queue')
    .update({ status: 'paused' })
    .eq('campanha_id', req.params.id)
    .eq('status', 'pending');

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ message: 'Campanha pausada' });
});

// POST /:id/retomar
router.post('/:id/retomar', async (req, res) => {
  const { error } = await supabase
    .from('send_queue')
    .update({ status: 'pending' })
    .eq('campanha_id', req.params.id)
    .eq('status', 'paused');

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ message: 'Campanha retomada' });
});

module.exports = router;
