'use strict';

const { Router } = require('express');
const supabase = require('../db');

const router = Router();

// GET /
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('tags')
    .select('*')
    .order('nome', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// POST /
router.post('/', async (req, res) => {
  const { nome, cor } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'nome is required' });

  const { data, error } = await supabase
    .from('tags')
    .insert({ nome, cor, criado_em: new Date().toISOString() })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(data);
});

// GET /:id
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('tags')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: error.message });
  return res.json(data);
});

// PATCH /:id
router.patch('/:id', async (req, res) => {
  const updates = { ...req.body };
  delete updates.id;

  const { data, error } = await supabase
    .from('tags')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.json(data);
});

// DELETE /:id
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('tags').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  return res.status(204).send();
});

module.exports = router;
