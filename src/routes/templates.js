'use strict';

const { Router } = require('express');
const supabase = require('../db');

const router = Router();

router.get('/', async (req, res) => {
  const { nicho } = req.query;
  let query = supabase.from('message_templates').select('*').order('created_at', { ascending: false });
  if (nicho) query = query.eq('nicho', nicho);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post('/', async (req, res) => {
  const { nome, nicho, conteudo } = req.body || {};
  if (!nome || !conteudo) return res.status(400).json({ error: 'nome and conteudo are required' });
  const { data, error } = await supabase
    .from('message_templates')
    .insert({ nome, nicho, conteudo, created_at: new Date().toISOString() })
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(data);
});

router.patch('/:id', async (req, res) => {
  const { nome, nicho, conteudo } = req.body || {};
  const { data, error } = await supabase
    .from('message_templates')
    .update({ nome, nicho, conteudo, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  return res.json(data);
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('message_templates').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  return res.status(204).send();
});

module.exports = router;
