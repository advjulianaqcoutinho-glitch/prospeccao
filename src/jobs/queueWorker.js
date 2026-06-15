'use strict';

const supabase = require('../db');
const config = require('../config');
const evolutionService = require('../services/evolutionService');
const ws = require('../ws');

const INTERVAL_MS = 10 * 1000; // 10 seconds
const WARMUP_GROWTH_DAYS = parseInt(process.env.WARMUP_GROWTH_DAYS || '7', 10);

// Check if current time in BUSINESS_TZ is within business hours
function isBusinessHours(campanha) {
  const tz = config.BUSINESS_TZ;
  const now = new Date();

  // Get current hour and day in business timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'long',
  });

  const parts = formatter.formatToParts(now);
  const hourPart = parts.find((p) => p.type === 'hour');
  const minutePart = parts.find((p) => p.type === 'minute');
  const weekdayPart = parts.find((p) => p.type === 'weekday');

  const hour = parseInt(hourPart ? hourPart.value : '0', 10);
  const minute = parseInt(minutePart ? minutePart.value : '0', 10);
  const weekday = weekdayPart ? weekdayPart.value.toLowerCase() : '';

  const currentMinutes = hour * 60 + minute;

  // Use campanha overrides or sane defaults (Mon-Fri 08:00-18:00)
  const startHour = campanha.business_hours_start != null ? campanha.business_hours_start : 8;
  const endHour = campanha.business_hours_end != null ? campanha.business_hours_end : 18;
  const allowedDays = campanha.business_days || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

  const startMinutes = startHour * 60;
  const endMinutes = endHour * 60;

  if (!allowedDays.includes(weekday)) return false;
  if (currentMinutes < startMinutes || currentMinutes >= endMinutes) return false;

  return true;
}

// Calculate warm-up daily limit for a campanha
function calcWarmupLimit(campanha) {
  const createdAt = new Date(campanha.criado_em || campanha.created_at);
  const daysSince = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
  const base = campanha.warmup_day_limit || 20;
  const max = campanha.warmup_max_limit || 200;
  const periods = Math.floor(daysSince / WARMUP_GROWTH_DAYS);
  const allowed = base + periods * base;
  return Math.min(allowed, max);
}

async function processQueue() {
  try {
    const now = new Date().toISOString();

    // Fetch one pending queue item due for sending
    const { data: items, error: fetchErr } = await supabase
      .from('send_queue')
      .select('*, campanhas(*), leads(*)')
      .eq('status', 'pending')
      .lte('scheduled_at', now)
      .order('scheduled_at', { ascending: true })
      .limit(1);

    if (fetchErr) {
      console.error('[queueWorker] fetch error:', fetchErr.message);
      return;
    }

    if (!items || items.length === 0) return;

    const item = items[0];

    // Atomic lock: mark as 'processing' before doing anything — prevents double-send
    const { count: locked } = await supabase
      .from('send_queue')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', item.id)
      .eq('status', 'pending') // only succeeds if still pending
      .select('id', { count: 'exact', head: true });

    if (!locked || locked === 0) {
      // Another worker already grabbed this item
      return;
    }

    // Load campanha (may be embedded via join or we fetch separately)
    let campanha = item.campanhas;
    if (!campanha) {
      const { data: c } = await supabase
        .from('campanhas')
        .select('*')
        .eq('id', item.campanha_id)
        .single();
      campanha = c;
    }

    if (!campanha) {
      console.error('[queueWorker] campanha not found for queue item', item.id);
      return;
    }

    // Business hours check — revert to pending instead of leaving stuck as 'processing'
    if (campanha.business_hours_enabled) {
      if (!isBusinessHours(campanha)) {
        console.log('[queueWorker] Outside business hours, reverting to pending.');
        await supabase.from('send_queue')
          .update({ status: 'pending', updated_at: new Date().toISOString() })
          .eq('id', item.id);
        return;
      }
    }

    // Warm-up limit check — revert to pending instead of leaving stuck as 'processing'
    if (campanha.warmup_enabled) {
      const allowedToday = calcWarmupLimit(campanha);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { count: sentToday } = await supabase
        .from('send_queue')
        .select('id', { count: 'exact', head: true })
        .eq('campanha_id', campanha.id)
        .eq('status', 'sent')
        .gte('sent_at', todayStart.toISOString());

      if ((sentToday || 0) >= allowedToday) {
        console.log(`[queueWorker] Warm-up limit reached (${sentToday}/${allowedToday}), reverting to pending.`);
        await supabase.from('send_queue')
          .update({ status: 'pending', updated_at: new Date().toISOString() })
          .eq('id', item.id);
        return;
      }
    }

    // Get lead
    let lead = item.leads;
    if (!lead) {
      const { data: l } = await supabase
        .from('leads')
        .select('*')
        .eq('id', item.lead_id)
        .single();
      lead = l;
    }

    if (!lead) {
      console.error('[queueWorker] lead not found for queue item', item.id);
      await supabase
        .from('send_queue')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', item.id);
      return;
    }

    // Get message based on variante_ativa
    let mensagem = null;

    if (item.mensagem_id) {
      let mensagemRow = item.mensagens;
      if (!mensagemRow) {
        const { data: m } = await supabase
          .from('mensagens')
          .select('*')
          .eq('id', item.mensagem_id)
          .single();
        mensagemRow = m;
      }
      if (mensagemRow) {
        const variante = lead.variante_ativa || 'a';
        mensagem = variante === 'b' ? mensagemRow.mensagem_variante_b : mensagemRow.mensagem_gerada;
      }
    }

    // Fallback to lead columns directly
    if (!mensagem) {
      const variante = lead.variante_ativa || 'a';
      mensagem = variante === 'b' ? lead.mensagem_variante_b : lead.mensagem_gerada;
    }

    if (!mensagem) {
      console.error('[queueWorker] no message found for queue item', item.id);
      await supabase
        .from('send_queue')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', item.id);
      return;
    }

    // Auto-advance kanban to 'contatado' on first send
    if (!lead.kanban_stage || lead.kanban_stage === 'novo') {
      await supabase.from('leads').update({ kanban_stage: 'contatado', atualizado_em: new Date().toISOString() }).eq('id', lead.id);
    }

    // Send message — use campaign's assigned instance if set
    try {
      const sendResult = await evolutionService.enviarMensagem(lead.telefone, mensagem, campanha.whatsapp_instance_id || null);

      const sentAt = new Date().toISOString();
      const hour = new Date().getHours();
      const day = new Date().getDay(); // 0=Sun

      // Update queue item
      await supabase
        .from('send_queue')
        .update({ status: 'sent', sent_at: sentAt, updated_at: sentAt })
        .eq('id', item.id);

      // Update lead status
      await supabase
        .from('leads')
        .update({ status: 'enviado', enviado_em: sentAt, atualizado_em: sentAt })
        .eq('id', lead.id);

      // Insert interaction
      await supabase.from('interactions').insert({
        lead_id: lead.id,
        campanha_id: campanha.id,
        type: 'message_sent',
        message_id: sendResult.messageId || null,
        instance_id: sendResult.instanceUsed || null,
        created_at: sentAt,
      });

      // Upsert send_time_stats
      const nicho = campanha.nicho || lead.nicho || 'unknown';
      await supabase.rpc('upsert_send_time_stats', {
        p_nicho: nicho,
        p_hour: hour,
        p_day: day,
      }).catch(async () => {
        // Fallback manual upsert if RPC not available
        const { data: existing } = await supabase
          .from('send_time_stats')
          .select('id, total_sent')
          .eq('nicho', nicho)
          .eq('hour', hour)
          .eq('day', day)
          .single();

        if (existing) {
          await supabase
            .from('send_time_stats')
            .update({ total_sent: (existing.total_sent || 0) + 1, updated_at: sentAt })
            .eq('id', existing.id);
        } else {
          await supabase.from('send_time_stats').insert({
            nicho,
            hour,
            day,
            total_sent: 1,
            created_at: sentAt,
            updated_at: sentAt,
          });
        }
      });

      console.log(`[queueWorker] Sent to ${lead.nome} (${lead.telefone})`);

      ws.broadcast({
        tipo: 'queue_progress',
        leadId: lead.id,
        nome: lead.nome,
        status: 'sent',
        campanhaId: campanha.id,
      });
    } catch (sendErr) {
      console.error('[queueWorker] send error:', sendErr.message);

      // Number not on WhatsApp — mark lead and don't retry
      if (sendErr.code === 'NO_WHATSAPP') {
        await supabase.from('send_queue')
          .update({ status: 'failed', last_error: 'Número não tem WhatsApp', updated_at: new Date().toISOString() })
          .eq('id', item.id);
        await supabase.from('leads')
          .update({ status: 'sem_whatsapp', atualizado_em: new Date().toISOString() })
          .eq('id', lead.id);
        ws.broadcast({ tipo: 'queue_progress', leadId: lead.id, nome: lead.nome, status: 'failed', campanhaId: campanha.id, error: 'Sem WhatsApp' });
        return;
      }

      const attempts = (item.attempt_count || 0) + 1;
      const now5min = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      if (attempts >= 3) {
        await supabase
          .from('send_queue')
          .update({
            status: 'failed',
            attempt_count: attempts,
            last_error: sendErr.message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id);

        ws.broadcast({
          tipo: 'queue_progress',
          leadId: lead.id,
          nome: lead.nome,
          status: 'failed',
          campanhaId: campanha.id,
          error: sendErr.message,
        });
      } else {
        await supabase
          .from('send_queue')
          .update({
            status: 'pending',
            attempt_count: attempts,
            last_error: sendErr.message,
            scheduled_at: now5min,
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.id);
      }
    }
  } catch (err) {
    console.error('[queueWorker] unexpected error:', err.message);
  }
}

function start() {
  console.log('[queueWorker] Starting — polling every 10s');
  setInterval(processQueue, INTERVAL_MS);
  // Also run immediately
  processQueue();
}

module.exports = { start, processQueue };
