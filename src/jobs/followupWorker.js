'use strict';

const supabase = require('../db');
const aiService = require('../services/aiService');

const INTERVAL_MS = 5 * 60 * 1000;

async function processFollowups() {
  try {
    const now = new Date().toISOString();

    const { data: leads, error: leadsErr } = await supabase
      .from('leads')
      .select('*')
      .lte('next_followup_at', now)
      .eq('status', 'enviado')
      .not('classificacao', 'in', '("nao_interessado","blacklisted")');

    if (leadsErr) { console.error('[followupWorker] fetch error:', leadsErr.message); return; }
    if (!leads || leads.length === 0) return;

    // Load user profile once for AI calls
    const { data: perfilRows } = await supabase.from('user_profile').select('*').limit(1);
    const perfil = perfilRows && perfilRows[0]
      ? perfilRows[0]
      : { nome: 'Prospector', empresa: '', descricao: '', tom_comunicacao: 'profissional' };

    for (const lead of leads) {
      try {
        const { data: sequences } = await supabase
          .from('followup_sequences')
          .select('*')
          .eq('campanha_id', lead.campanha_id)
          .order('step_number', { ascending: true });

        const nextStepNumber = (lead.followup_count || 0) + 1;
        const step = (sequences || []).find((s) => s.step_number === nextStepNumber);

        if (!step) {
          await supabase.from('leads')
            .update({ next_followup_at: null, atualizado_em: now })
            .eq('id', lead.id);
          continue;
        }

        let mensagem;
        if (step.message_template) {
          mensagem = step.message_template
            .replace(/\{\{nome\}\}/gi, lead.nome || '')
            .replace(/\{\{empresa\}\}/gi, perfil.empresa || '')
            .replace(/\{\{nicho\}\}/gi, lead.nicho || '');
        } else {
          const { data: campanha } = await supabase
            .from('campanhas').select('nicho,contexto').eq('id', lead.campanha_id).single();
          mensagem = await aiService.gerarMensagem(
            lead.nome,
            lead.nicho || (campanha ? campanha.nicho : ''),
            `Follow-up ${nextStepNumber}. ${campanha ? campanha.contexto || '' : ''}`,
            perfil
          );
        }

        const nowTs = new Date().toISOString();
        const afterStep = (sequences || []).find((s) => s.step_number === nextStepNumber + 1);
        const nextFollowupAt = afterStep
          ? new Date(Date.now() + afterStep.delay_hours * 3600000).toISOString()
          : null;

        // Insert directly with message_text (no race condition)
        await supabase.from('send_queue').insert({
          lead_id: lead.id,
          campanha_id: lead.campanha_id,
          scheduled_at: nowTs,
          status: 'pending',
          type: 'followup',
          followup_step: nextStepNumber,
          message_text: mensagem,
          created_at: nowTs,
          updated_at: nowTs,
        });

        await supabase.from('leads').update({
          followup_count: nextStepNumber,
          next_followup_at: nextFollowupAt,
          atualizado_em: nowTs,
        }).eq('id', lead.id);

        console.log(`[followupWorker] Queued step ${nextStepNumber} for ${lead.nome}`);
      } catch (err) {
        console.error(`[followupWorker] lead ${lead.id} error:`, err.message);
      }
    }
  } catch (err) {
    console.error('[followupWorker] unexpected error:', err.message);
  }
}

function start() {
  console.log('[followupWorker] Starting — polling every 5min');
  setInterval(processFollowups, INTERVAL_MS);
  processFollowups();
}

module.exports = { start, processFollowups };
