'use strict';

const supabase = require('../db');
const aiService = require('../services/aiService');

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function processFollowups() {
  try {
    const now = new Date().toISOString();

    // Fetch leads due for follow-up
    const { data: leads, error: leadsErr } = await supabase
      .from('leads')
      .select('*')
      .lte('next_followup_at', now)
      .eq('status', 'enviado');

    if (leadsErr) {
      console.error('[followupWorker] fetch leads error:', leadsErr.message);
      return;
    }

    if (!leads || leads.length === 0) return;

    for (const lead of leads) {
      try {
        // Get followup sequences for this campanha, ordered by step_number
        const { data: sequences, error: seqErr } = await supabase
          .from('followup_sequences')
          .select('*')
          .eq('campanha_id', lead.campanha_id)
          .order('step_number', { ascending: true });

        if (seqErr) {
          console.error('[followupWorker] fetch sequences error:', seqErr.message);
          continue;
        }

        if (!sequences || sequences.length === 0) {
          // No follow-up sequences configured; clear next_followup_at
          await supabase
            .from('leads')
            .update({ next_followup_at: null, atualizado_em: new Date().toISOString() })
            .eq('id', lead.id);
          continue;
        }

        const nextStepNumber = (lead.followup_count || 0) + 1;
        const step = sequences.find((s) => s.step_number === nextStepNumber);

        if (!step) {
          // No more steps; clear next_followup_at
          await supabase
            .from('leads')
            .update({ next_followup_at: null, atualizado_em: new Date().toISOString() })
            .eq('id', lead.id);
          continue;
        }

        // Generate follow-up message
        let mensagem;
        if (step.message_template) {
          // Replace basic placeholders
          mensagem = step.message_template
            .replace(/\{\{nome\}\}/gi, lead.nome || '')
            .replace(/\{\{empresa\}\}/gi, lead.nome || '')
            .replace(/\{\{nicho\}\}/gi, lead.nicho || '');
        } else {
          // Use AI to generate
          const { data: campanha } = await supabase
            .from('campanhas')
            .select('*')
            .eq('id', lead.campanha_id)
            .single();

          const perfil = {
            nome: campanha ? campanha.nome : 'Prospector',
            empresa: campanha ? campanha.nome : '',
            descricao: campanha ? campanha.contexto || '' : '',
            tom_comunicacao: 'profissional',
          };

          mensagem = await aiService.gerarMensagem(
            lead.nome,
            lead.nicho || (campanha ? campanha.nicho : ''),
            `Follow-up ${nextStepNumber} para este lead.`,
            perfil
          );
        }

        const nowTs = new Date().toISOString();

        // Insert into send_queue as a followup
        await supabase.from('send_queue').insert({
          lead_id: lead.id,
          campanha_id: lead.campanha_id,
          scheduled_at: nowTs,
          status: 'pending',
          type: 'followup',
          followup_step: nextStepNumber,
          created_at: nowTs,
        });

        // Determine next_followup_at
        const afterStep = sequences.find((s) => s.step_number === nextStepNumber + 1);
        let nextFollowupAt = null;
        if (afterStep && afterStep.delay_hours) {
          const delayMs = afterStep.delay_hours * 60 * 60 * 1000;
          nextFollowupAt = new Date(Date.now() + delayMs).toISOString();
        }

        // Update lead
        await supabase
          .from('leads')
          .update({
            followup_count: nextStepNumber,
            next_followup_at: nextFollowupAt,
            atualizado_em: nowTs,
          })
          .eq('id', lead.id);

        // Store message on the queue item (insert message text via a mensagem row if needed)
        // Also update send_queue row with the generated message text
        await supabase
          .from('send_queue')
          .update({ message_text: mensagem })
          .eq('lead_id', lead.id)
          .eq('status', 'pending')
          .eq('type', 'followup')
          .eq('followup_step', nextStepNumber);

        console.log(`[followupWorker] Queued follow-up step ${nextStepNumber} for lead ${lead.nome}`);
      } catch (leadErr) {
        console.error(`[followupWorker] error for lead ${lead.id}:`, leadErr.message);
      }
    }
  } catch (err) {
    console.error('[followupWorker] unexpected error:', err.message);
  }
}

function start() {
  console.log('[followupWorker] Starting — polling every 5min');
  setInterval(processFollowups, INTERVAL_MS);
  // Run immediately on startup
  processFollowups();
}

module.exports = { start, processFollowups };
