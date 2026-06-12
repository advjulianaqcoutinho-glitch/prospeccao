'use strict';

const { Router } = require('express');
const supabase = require('../db');

const router = Router();

// GET /
router.get('/', async (req, res) => {
  const { limit = 50, offset = 0, search } = req.query;

  let query = supabase
    .from('blacklist')
    .select('*', { count: 'exact' })
    .order('criado_em', { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  if (search) query = query.ilike('telefone', `%${search}%`);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ data: data || [], count });
});

// POST /
router.post('/', async (req, res) => {
  const { telefone, motivo } = req.body || {};
  if (!telefone) return res.status(400).json({ error: 'telefone is required' });

  const { data, error } = await supabase
    .from('blacklist')
    .insert({ telefone, motivo, criado_em: new Date().toISOString() })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(data);
});

// DELETE /:id
router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('blacklist')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  return res.status(204).send();
});

module.exports = router;
