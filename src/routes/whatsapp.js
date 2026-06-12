'use strict';

const { Router } = require('express');
const supabase = require('../db');
const evolutionService = require('../services/evolutionService');

const router = Router();

// GET /instances
router.get('/instances', async (req, res) => {
  const { data, error } = await supabase
    .from('whatsapp_instances')
    .select('*')
    .order('criado_em', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /instances
router.post('/instances', async (req, res) => {
  const { nome, instance_name, api_url, api_key, daily_limit } = req.body || {};
  if (!nome || !instance_name) {
    return res.status(400).json({ error: 'nome and instance_name are required' });
  }

  const { data, error } = await supabase
    .from('whatsapp_instances')
    .insert({
      nome,
      instance_name,
      api_url,
      api_key,
      daily_limit: daily_limit || 200,
      ativo: true,
      criado_em: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(data);
});

// PATCH /instances/:id
router.patch('/instances/:id', async (req, res) => {
  const updates = { ...req.body, atualizado_em: new Date().toISOString() };
  delete updates.id;

  const { data, error } = await supabase
    .from('whatsapp_instances')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.json(data);
});

// DELETE /instances/:id
router.delete('/instances/:id', async (req, res) => {
  const { error } = await supabase
    .from('whatsapp_instances')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  return res.status(204).send();
});

// GET /instances/:id/status
router.get('/instances/:id/status', async (req, res) => {
  try {
    const status = await evolutionService.checkStatus(req.params.id);
    return res.json(status);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /status (backwards compat)
router.get('/status', async (req, res) => {
  const { data, error } = await supabase
    .from('whatsapp_instances')
    .select('*')
    .eq('ativo', true)
    .order('criado_em', { ascending: true })
    .limit(1)
    .single();

  if (error || !data) return res.status(404).json({ error: 'No active instance found' });

  try {
    const status = await evolutionService.checkStatus(data.id);
    return res.json({ instance: data, status });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
