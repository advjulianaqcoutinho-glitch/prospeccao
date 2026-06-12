'use strict';

const supabase = require('../db');

const CSV_COLUMNS = [
  'nome',
  'telefone',
  'endereco',
  'cidade',
  'nicho',
  'status',
  'kanban_stage',
  'score',
  'website',
  'email',
  'instagram',
  'mensagem_gerada',
  'criado_em',
];

function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowToCSV(lead) {
  return CSV_COLUMNS.map((col) => escapeCSV(lead[col])).join(',');
}

async function exportLeads(filters = {}) {
  let query = supabase.from('leads').select(CSV_COLUMNS.join(', '));

  // Apply filters dynamically
  if (filters.nicho) query = query.eq('nicho', filters.nicho);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.kanban_stage) query = query.eq('kanban_stage', filters.kanban_stage);
  if (filters.cidade) query = query.ilike('cidade', `%${filters.cidade}%`);
  if (filters.score_min !== undefined) query = query.gte('score', filters.score_min);
  if (filters.score_max !== undefined) query = query.lte('score', filters.score_max);
  if (filters.created_after) query = query.gte('criado_em', filters.created_after);
  if (filters.created_before) query = query.lte('criado_em', filters.created_before);

  const { data: leads, error } = await query.order('criado_em', { ascending: false });

  if (error) throw new Error(`exportLeads: ${error.message}`);

  const header = CSV_COLUMNS.join(',');
  const rows = (leads || []).map(rowToCSV);

  return [header, ...rows].join('\n');
}

module.exports = { exportLeads };
