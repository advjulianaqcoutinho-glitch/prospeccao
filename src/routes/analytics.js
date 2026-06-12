'use strict';

const { Router } = require('express');
const supabase = require('../db');

const router = Router();

// GET /analytics/funil — usa contagem agregada em vez de carregar todos os leads
router.get('/funil', async (req, res) => {
  const { campanha_id } = req.query;

  // Count each status group directly in the DB — very fast
  const base = () => {
    let q = supabase.from('leads').select('id', { count: 'exact', head: true });
    if (campanha_id) q = q.eq('campanha_id', campanha_id);
    return q;
  };

  try {
    const [total, enviados, responderam, interessados, fechados] = await Promise.all([
      base(),
      (() => { let q = supabase.from('leads').select('id',{count:'exact',head:true}); if(campanha_id) q=q.eq('campanha_id',campanha_id); return q.in('status',['enviado','respondeu']); })(),
      (() => { let q = supabase.from('leads').select('id',{count:'exact',head:true}); if(campanha_id) q=q.eq('campanha_id',campanha_id); return q.eq('status','respondeu'); })(),
      (() => { let q = supabase.from('leads').select('id',{count:'exact',head:true}); if(campanha_id) q=q.eq('campanha_id',campanha_id); return q.in('classificacao',['interessado','muito_interessado']); })(),
      (() => { let q = supabase.from('leads').select('id',{count:'exact',head:true}); if(campanha_id) q=q.eq('campanha_id',campanha_id); return q.eq('classificacao','fechado'); })(),
    ]);

    return res.json({
      prospectados: total.count || 0,
      enviados: enviados.count || 0,
      responderam: responderam.count || 0,
      interessados: interessados.count || 0,
      fechados: fechados.count || 0,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /analytics/campanhas — métricas por campanha (usa leads agregados, com limit)
router.get('/campanhas', async (req, res) => {
  const { data: campanhas, error } = await supabase
    .from('campanhas').select('id, nome, nicho, criado_em, status').limit(50);
  if (error) return res.status(500).json({ error: error.message });

  if (!campanhas || campanhas.length === 0) return res.json([]);

  // Fetch aggregated stats per campaign directly with supabase
  const { data: leads } = await supabase
    .from('leads')
    .select('campanha_id, status, classificacao, score, deal_value')
    .in('campanha_id', campanhas.map((c) => c.id))
    .limit(5000); // hard cap to avoid memory blowup

  const result = campanhas.map((c) => {
    const cls = (leads || []).filter((l) => l.campanha_id === c.id);
    const enviados = cls.filter((l) => ['enviado', 'respondeu'].includes(l.status)).length;
    const responderam = cls.filter((l) => l.status === 'respondeu').length;
    const interessados = cls.filter((l) => ['interessado', 'muito_interessado'].includes(l.classificacao)).length;
    const pipeline = cls.reduce((s, l) => s + (l.deal_value || 0), 0);
    const avgScore = cls.length ? Math.round(cls.reduce((s, l) => s + (l.score || 0), 0) / cls.length) : 0;
    return {
      id: c.id, nome: c.nome, nicho: c.nicho, status: c.status,
      total_leads: cls.length, enviados, responderam, interessados,
      taxa_resposta: enviados > 0 ? Math.round((responderam / enviados) * 100) : 0,
      taxa_interesse: responderam > 0 ? Math.round((interessados / responderam) * 100) : 0,
      pipeline, avg_score: avgScore,
    };
  });

  return res.json(result);
});

// GET /analytics/horarios
router.get('/horarios', async (req, res) => {
  const { nicho } = req.query;
  let q = supabase.from('send_time_stats').select('*').order('total_reply', { ascending: false }).limit(20);
  if (nicho) q = q.eq('nicho', nicho);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// GET /analytics/score-distribution — usa limit para não carregar todos
router.get('/score-distribution', async (req, res) => {
  const { campanha_id } = req.query;
  let q = supabase.from('leads').select('score').not('score', 'is', null).limit(5000);
  if (campanha_id) q = q.eq('campanha_id', campanha_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const buckets = { '0-25': 0, '26-50': 0, '51-75': 0, '76-100': 0 };
  for (const l of data || []) {
    const s = l.score || 0;
    if (s <= 25) buckets['0-25']++;
    else if (s <= 50) buckets['26-50']++;
    else if (s <= 75) buckets['51-75']++;
    else buckets['76-100']++;
  }
  return res.json(buckets);
});

module.exports = router;
