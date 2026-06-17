'use strict';

const { Router } = require('express');
const { fork } = require('child_process');
const path = require('path');
const supabase = require('../db');
const ws = require('../ws');

const router = Router();

// GET /instagram/leads - list all leads where fonte='instagram'
router.get('/leads', async (req, res) => {
  const { status, limit = 50, offset = 0, keyword } = req.query;

  let query = supabase
    .from('leads')
    .select('*')
    .eq('fonte', 'instagram')
    .not('status', 'eq', 'arquivado')
    .order('criado_em', { ascending: false })
    .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

  if (status === 'contatado') {
    query = query.eq('instagram_contacted', true);
  } else if (status === 'pendente') {
    query = query.or('instagram_contacted.is.null,instagram_contacted.eq.false');
  }

  if (keyword) {
    query = query.or(`nome.ilike.%${keyword}%,bio.ilike.%${keyword}%`);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ leads: data || [] });
});

// POST /instagram/extrair - start extraction
router.post('/extrair', async (req, res) => {
  const { palavra_chave, limite = 20 } = req.body;
  if (!palavra_chave) return res.status(400).json({ error: 'palavra_chave required' });

  // Find or create Instagram Leads campaign
  let campanhaId;
  const { data: existing } = await supabase
    .from('campanhas')
    .select('id')
    .eq('nome', 'Instagram Leads')
    .limit(1);

  if (existing && existing.length > 0) {
    campanhaId = existing[0].id;
  } else {
    const { data: created, error: createErr } = await supabase
      .from('campanhas')
      .insert({ nome: 'Instagram Leads', status: 'ativo', criado_em: new Date().toISOString() })
      .select('id')
      .single();
    if (createErr) return res.status(500).json({ error: createErr.message });
    campanhaId = created.id;
  }

  const scriptPath = path.resolve(__dirname, '../scraper/instagramProspector.js');
  const params = JSON.stringify({
    campanhaId,
    palavraChave: palavra_chave,
    limite: Math.min(parseInt(limite) || 20, 50),
  });

  const child = fork(scriptPath, [params], { detached: true, stdio: 'pipe' });

  child.on('message', (msg) => {
    ws.broadcast({ ...msg, campanha_id: campanhaId });
  });

  child.stderr?.on('data', (data) => {
    const text = data.toString().trim();
    console.error(`[instagramRoute]`, text);
    const isWarning = text.includes('Puppeteer') || text.includes('DevTools') || text.includes('GPU') || text.includes('NSS_VersionCheck');
    if (!isWarning) {
      ws.broadcast({ tipo: 'erro', mensagem: text.slice(0, 200), campanha_id: campanhaId });
    }
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      ws.broadcast({ tipo: 'erro', mensagem: `Instagram: processo encerrou (código ${code})`, campanha_id: campanhaId });
    }
  });

  child.unref();

  return res.json({ ok: true, campanha_id: campanhaId });
});

// PATCH /instagram/leads/:id/contatar
router.patch('/leads/:id/contatar', async (req, res) => {
  const { error } = await supabase
    .from('leads')
    .update({ instagram_contacted: true, instagram_contacted_at: new Date().toISOString() })
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

// DELETE /instagram/leads/:id - soft delete
router.delete('/leads/:id', async (req, res) => {
  const { error } = await supabase
    .from('leads')
    .update({ status: 'arquivado' })
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

module.exports = router;
