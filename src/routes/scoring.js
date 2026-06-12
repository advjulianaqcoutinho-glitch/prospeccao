'use strict';

const { Router } = require('express');
const supabase = require('../db');

const router = Router();

// GET /scoring/rules
router.get('/rules', async (req, res) => {
  const { data, error } = await supabase
    .from('scoring_rules')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /scoring/rules
router.post('/rules', async (req, res) => {
  const { nome, evento, pontos } = req.body || {};
  if (!nome || !evento || pontos === undefined) {
    return res.status(400).json({ error: 'nome, evento e pontos são obrigatórios' });
  }
  const { data, error } = await supabase
    .from('scoring_rules')
    .insert({ nome, evento, pontos: parseInt(pontos), ativo: true, created_at: new Date().toISOString() })
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(data);
});

// PATCH /scoring/rules/:id
router.patch('/rules/:id', async (req, res) => {
  const updates = { ...req.body };
  delete updates.id;
  const { data, error } = await supabase
    .from('scoring_rules').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  return res.json(data);
});

// DELETE /scoring/rules/:id
router.delete('/rules/:id', async (req, res) => {
  const { error } = await supabase.from('scoring_rules').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  return res.status(204).send();
});

module.exports = router;
