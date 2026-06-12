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
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /instances
router.post('/instances', async (req, res) => {
  const { display_name, instance_name, daily_limit } = req.body || {};
  if (!instance_name) {
    return res.status(400).json({ error: 'instance_name is required' });
  }

  const { data, error } = await supabase
    .from('whatsapp_instances')
    .insert({
      display_name: display_name || instance_name,
      instance_name,
      daily_limit: daily_limit || 200,
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(data);
});

// PATCH /instances/:id
router.patch('/instances/:id', async (req, res) => {
  const updates = { ...req.body, updated_at: new Date().toISOString() };
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

// GET /instances/:id/status — checks Evolution API and persists result
router.get('/instances/:id/status', async (req, res) => {
  try {
    const statusData = await evolutionService.checkStatus(req.params.id);
    // Evolution API returns { instance: { state: 'open'|'close'|'connecting' } }
    const state = statusData?.instance?.state || statusData?.state || 'unknown';
    const isConnected = state === 'open';

    await supabase
      .from('whatsapp_instances')
      .update({
        status: isConnected ? 'connected' : 'disconnected',
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id);

    return res.json({ ...statusData, resolved_status: isConnected ? 'connected' : 'disconnected' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /status (backwards compat)
router.get('/status', async (req, res) => {
  const { data, error } = await supabase
    .from('whatsapp_instances')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: true })
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
