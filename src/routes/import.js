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

// POST /import/leads — importar leads via JSON (frontend faz parse do CSV)
router.post('/leads', async (req, res) => {
  const { campanha_id, leads } = req.body || {};
  if (!campanha_id) return res.status(400).json({ error: 'campanha_id is required' });
  if (!Array.isArray(leads) || leads.length === 0) return res.status(400).json({ error: 'leads array is required' });

  // Load blacklist for filtering
  const { data: blacklist } = await supabase.from('blacklist').select('telefone_normalizado');
  const blacklistSet = new Set((blacklist || []).map((b) => b.telefone_normalizado));

  const now = new Date().toISOString();
  const toInsert = [];
  const skipped = [];

  for (const row of leads) {
    const nome = String(row.nome || row.Nome || row.name || '').trim();
    const telefone = String(row.telefone || row.Telefone || row.phone || row.Phone || '').trim();
    if (!nome || !telefone) { skipped.push({ row, motivo: 'nome ou telefone vazio' }); continue; }

    const norm = normalizePhone(telefone);
    if (blacklistSet.has(norm)) { skipped.push({ row, motivo: 'blacklist' }); continue; }

    toInsert.push({
      campanha_id,
      nome,
      telefone,
      telefone_normalizado: norm,
      endereco: row.endereco || row.Endereco || row.address || null,
      email: row.email || row.Email || null,
      status: 'pendente',
      criado_em: now,
      atualizado_em: now,
    });
  }

  let inserted = 0;
  if (toInsert.length > 0) {
    // Insert in batches of 100
    for (let i = 0; i < toInsert.length; i += 100) {
      const batch = toInsert.slice(i, i + 100);
      const { error } = await supabase.from('leads').insert(batch);
      if (!error) inserted += batch.length;
    }
  }

  return res.json({ imported: inserted, skipped: skipped.length, skipped_detail: skipped.slice(0, 10) });
});

module.exports = router;
