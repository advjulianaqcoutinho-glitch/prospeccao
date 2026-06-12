'use strict';

const { Router } = require('express');
const { fork } = require('child_process');
const path = require('path');
const supabase = require('../db');

const router = Router();

// GET /
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('campanhas')
    .select('*, leads(count)')
    .order('criado_em', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /
router.post('/', async (req, res) => {
  const {
    nome, nicho, cidade, limite, contexto,
    delay_min = 30, delay_max = 120,
    warmup_enabled, business_hours_enabled,
    business_hours_start, business_hours_end,
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

// DELETE /:id
router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('campanhas')
    .delete()
    .eq('id', req.params.id);

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
    stdio: 'ignore',
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

  const { data: leads, error: leadsErr } = await supabase
    .from('leads')
    .select('id, telefone')
    .eq('campanha_id', req.params.id)
    .eq('status', 'pendente');

  if (leadsErr) return res.status(500).json({ error: leadsErr.message });
  if (!leads || leads.length === 0) return res.json({ queued: 0 });

  const delayMin = campanha.delay_min || 30;
  const delayMax = campanha.delay_max || 120;
  const bizEnabled = campanha.business_hours_enabled || false;
  const bizStart = campanha.business_hours_start || '08:00';
  const bizEnd = campanha.business_hours_end || '18:00';

  let scheduled = new Date();

  function nextBusinessTime(dt) {
    if (!bizEnabled) return dt;
    const [startH, startM] = bizStart.split(':').map(Number);
    const [endH, endM] = bizEnd.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    const dayMinutes = dt.getHours() * 60 + dt.getMinutes();

    if (dayMinutes < startMinutes) {
      dt.setHours(startH, startM, 0, 0);
    } else if (dayMinutes >= endMinutes) {
      dt.setDate(dt.getDate() + 1);
      dt.setHours(startH, startM, 0, 0);
    }
    // Skip weekends
    while (dt.getDay() === 0 || dt.getDay() === 6) {
      dt.setDate(dt.getDate() + 1);
      dt.setHours(startH, startM, 0, 0);
    }
    return dt;
  }

  const queueItems = leads.map((lead) => {
    const delaySecs = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
    scheduled = new Date(scheduled.getTime() + delaySecs * 1000);
    scheduled = nextBusinessTime(new Date(scheduled));

    return {
      lead_id: lead.id,
      campanha_id: req.params.id,
      scheduled_at: scheduled.toISOString(),
      status: 'pending',
      criado_em: new Date().toISOString(),
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
