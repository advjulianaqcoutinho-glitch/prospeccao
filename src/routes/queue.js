'use strict';

const { Router } = require('express');
const supabase = require('../db');

const router = Router();

// GET /
router.get('/', async (req, res) => {
  const { status, campanha_id, limit = 50, offset = 0 } = req.query;

  let query = supabase
    .from('send_queue')
    .select('*, leads(id, nome, telefone)', { count: 'exact' })
    .order('scheduled_at', { ascending: true })
    .range(Number(offset), Number(offset) + Number(limit) - 1);

  if (status) query = query.eq('status', status);
  if (campanha_id) query = query.eq('campanha_id', campanha_id);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ data: data || [], count });
});

// DELETE /:id
router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('send_queue')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .in('status', ['pending', 'processing', 'paused']);

  if (error) return res.status(400).json({ error: error.message });
  return res.status(204).send();
});

// POST /clear
router.post('/clear', async (req, res) => {
  const { campanha_id } = req.body || {};

  let query = supabase
    .from('send_queue')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .in('status', ['pending', 'processing', 'paused']);

  if (campanha_id) query = query.eq('campanha_id', campanha_id);

  const { error, count } = await query;
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ message: 'Queue cleared', cancelled: count });
});

module.exports = router;
