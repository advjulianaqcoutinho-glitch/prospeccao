'use strict';

const { Router } = require('express');
const supabase = require('../db');

const router = Router({ mergeParams: true });

// GET /campanhas/:campanhaId/followups
router.get('/campanhas/:campanhaId/followups', async (req, res) => {
  const { data, error } = await supabase
    .from('followup_sequences')
    .select('*')
    .eq('campanha_id', req.params.campanhaId)
    .order('step_number', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /campanhas/:campanhaId/followups
router.post('/campanhas/:campanhaId/followups', async (req, res) => {
  const { step_number, delay_hours, message_template } = req.body || {};
  if (!step_number || delay_hours === undefined || !message_template) {
    return res.status(400).json({ error: 'step_number, delay_hours, and message_template are required' });
  }

  const { data, error } = await supabase
    .from('followup_sequences')
    .insert({
      campanha_id: req.params.campanhaId,
      step_number,
      delay_hours,
      message_template,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(data);
});

// PATCH /campanhas/:campanhaId/followups/:id
router.patch('/campanhas/:campanhaId/followups/:id', async (req, res) => {
  const updates = { ...req.body, updated_at: new Date().toISOString() };
  delete updates.id;
  delete updates.campanha_id;

  const { data, error } = await supabase
    .from('followup_sequences')
    .update(updates)
    .eq('id', req.params.id)
    .eq('campanha_id', req.params.campanhaId)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.json(data);
});

// DELETE /campanhas/:campanhaId/followups/:id
router.delete('/campanhas/:campanhaId/followups/:id', async (req, res) => {
  const { error } = await supabase
    .from('followup_sequences')
    .delete()
    .eq('id', req.params.id)
    .eq('campanha_id', req.params.campanhaId);

  if (error) return res.status(400).json({ error: error.message });
  return res.status(204).send();
});

module.exports = router;
