'use strict';

const { Router } = require('express');
const supabase = require('../db');

const router = Router();

// GET /
router.get('/', async (req, res) => {
  try {
    const [
      campanhasRes,
      totalLeadsRes,
      pendentesRes,
      enviadosRes,
      interessadosRes,
      pipelineRes,
      recentRes,
    ] = await Promise.all([
      supabase.from('campanhas').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'pendente'),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'enviado'),
      supabase.from('leads').select('id', { count: 'exact', head: true }).in('status', ['interessado', 'muito_interessado']),
      supabase.from('leads').select('deal_value').not('deal_value', 'is', null).catch(() => ({ data: [] })),
      supabase.from('leads').select('id, nome, telefone, status, campanha_id, criado_em').order('criado_em', { ascending: false }).limit(8),
    ]);

    const totalPipeline = (pipelineRes.data || []).reduce((sum, l) => sum + (l.deal_value || 0), 0);

    return res.json({
      totalCampanhas: campanhasRes.count || 0,
      totalLeads: totalLeadsRes.count || 0,
      leadsPendentes: pendentesRes.count || 0,
      leadsEnviados: enviadosRes.count || 0,
      leadsInteressados: interessadosRes.count || 0,
      totalPipeline,
      recentLeads: recentRes.data || [],
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /pipeline
router.get('/pipeline', async (req, res) => {
  const { data, error } = await supabase
    .from('leads')
    .select('kanban_stage, deal_value');

  if (error) return res.status(500).json({ error: error.message });

  const grouped = {};
  for (const lead of data || []) {
    const stage = lead.kanban_stage || 'sem_stage';
    if (!grouped[stage]) grouped[stage] = { stage, count: 0, total_deal_value: 0 };
    grouped[stage].count += 1;
    grouped[stage].total_deal_value += lead.deal_value || 0;
  }

  return res.json(Object.values(grouped));
});

// GET /ab
router.get('/ab', async (req, res) => {
  const { data, error } = await supabase
    .from('ab_test_results')
    .select('*, campanhas(nome, nicho)');

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// GET /send-times
router.get('/send-times', async (req, res) => {
  const { nicho } = req.query;

  let query = supabase
    .from('send_time_stats')
    .select('*')
    .order('response_rate', { ascending: false });

  if (nicho) query = query.eq('nicho', nicho);

  query = query.limit(5);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

module.exports = router;
