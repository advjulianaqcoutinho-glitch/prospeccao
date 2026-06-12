'use strict';

const { Router } = require('express');
const supabase = require('../db');

const router = Router();

function normalizePhone(t) {
  if (!t) return '';
  let d = String(t).replace(/\D/g, '');
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d;
}

router.get('/', async (req, res) => {
  const { limit = 50, offset = 0, search } = req.query;

  let query = supabase
    .from('blacklist')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  if (search) {
    const norm = normalizePhone(search);
    query = query.or(`telefone.ilike.%${search}%,telefone_normalizado.ilike.%${norm}%`);
  }

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ data: data || [], count });
});

router.post('/', async (req, res) => {
  const { telefone, motivo } = req.body || {};
  if (!telefone) return res.status(400).json({ error: 'telefone is required' });

  const norm = normalizePhone(telefone);
  const { data, error } = await supabase
    .from('blacklist')
    .insert({ telefone, telefone_normalizado: norm, motivo, created_at: new Date().toISOString() })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(data);
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('blacklist').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  return res.status(204).send();
});

module.exports = router;
