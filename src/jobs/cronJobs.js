'use strict';

const cron = require('node-cron');
const supabase = require('../db');
const evolutionService = require('../services/evolutionService');
const metaCapiService = require('../services/metaCapiService');
const queueWorker = require('./queueWorker');
const followupWorker = require('./followupWorker');

// Process leads with status='agendado' whose agendado_para has passed
async function processScheduledLeads() {
  try {
    const now = new Date().toISOString();

    const { data: leads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'agendado')
      .lte('agendado_para', now);

    if (error) {
      console.error('[cronJobs] processScheduledLeads error:', error.message);
      return;
    }

    if (!leads || leads.length === 0) return;

    for (const lead of leads) {
      try {
        // Insert into send_queue so the queue worker handles delivery
        const { error: qErr } = await supabase.from('send_queue').insert({
          lead_id: lead.id,
          campanha_id: lead.campanha_id,
          scheduled_at: now,
          status: 'pending',
          type: 'scheduled',
          created_at: now,
        });

        if (qErr) throw new Error(qErr.message);

        // Mark lead as no longer agendado so we don't pick it up again
        await supabase
          .from('leads')
          .update({ status: 'pendente', agendado_para: null, atualizado_em: now })
          .eq('id', lead.id);

        console.log(`[cronJobs] Queued scheduled lead: ${lead.nome}`);
      } catch (err) {
        console.error(`[cronJobs] Error queuing lead ${lead.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[cronJobs] processScheduledLeads unexpected error:', err.message);
  }
}

async function midnightTasks() {
  console.log('[cronJobs] Running midnight tasks...');

  try {
    await evolutionService.resetDailyCounts();
    console.log('[cronJobs] Daily WhatsApp counts reset.');
  } catch (err) {
    console.error('[cronJobs] resetDailyCounts error:', err.message);
  }

  try {
    await metaCapiService.retryFailed();
    console.log('[cronJobs] Meta CAPI retry completed.');
  } catch (err) {
    console.error('[cronJobs] retryFailed error:', err.message);
  }
}

function init() {
  // Start queue worker (setInterval-based, every 10s)
  queueWorker.start();

  // Start followup worker (setInterval-based, every 5min)
  followupWorker.start();

  // Reset daily counts on startup (handles server restarts mid-day)
  evolutionService.resetDailyCounts().catch((err) =>
    console.error('[cronJobs] startup resetDailyCounts error:', err.message)
  );

  // Every minute: process scheduled sends (backwards compat)
  cron.schedule('* * * * *', () => {
    processScheduledLeads().catch((err) =>
      console.error('[cronJobs] scheduled-leads cron error:', err.message)
    );
  });

  // Midnight: reset daily counts + retry failed Meta CAPI events
  cron.schedule('0 0 * * *', () => {
    midnightTasks().catch((err) =>
      console.error('[cronJobs] midnight cron error:', err.message)
    );
  });

  console.log('[cronJobs] All cron jobs initialized.');
}

module.exports = { init };
