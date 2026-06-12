'use strict';

const { Router } = require('express');
const supabase = require('../db');
const aiService = require('../services/aiService');
const ws = require('../ws');

const router = Router();

// POST /evolution
router.post('/evolution', async (req, res) => {
  // Always return 200 immediately to acknowledge receipt
  res.status(200).json({ received: true });

  try {
    const body = req.body || {};
    const event = body.event || body.type;

    if (event !== 'messages.upsert') return;

    const message = body.data || body;
    const key = message.key || {};
    if (key.fromMe === true) return;

    // Extract phone number and message text
    const remoteJid = key.remoteJid || '';
    const telefoneNormalizado = remoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
    if (!telefoneNormalizado) return;

    const messageContent =
      message.message?.conversation ||
      message.message?.extendedTextMessage?.text ||
      message.message?.imageMessage?.caption ||
      '';

    // Find lead by normalized phone
    const { data: leads } = await supabase
      .from('leads')
      .select('id, campanha_id, classificacao')
      .or(`telefone_normalizado.eq.${telefoneNormalizado},telefone.ilike.%${telefoneNormalizado}%`)
      .limit(1);

    if (!leads || leads.length === 0) return;

    const lead = leads[0];
    const now = new Date().toISOString();

    // Insert inbound interaction
    await supabase.from('interactions').insert({
      lead_id: lead.id,
      type: 'response_received',
      direction: 'inbound',
      content: messageContent,
      created_at: now,
    });

    // Update last_response_at
    await supabase
      .from('leads')
      .update({ last_response_at: now, atualizado_em: now })
      .eq('id', lead.id);

    // Async: analyze response and update classification
    setImmediate(async () => {
      try {
        // Fetch original message for context
        const { data: fullLead } = await supabase.from('leads').select('mensagem_gerada').eq('id', lead.id).single();
        const analise = await aiService.analisarResposta(fullLead?.mensagem_gerada || '', messageContent);

        await supabase.from('leads').update({
          classificacao: analise.classificacao,
          sugestao_ia: analise.sugestao,
          atualizado_em: new Date().toISOString(),
        }).eq('id', lead.id);

        if (ws && typeof ws.broadcast === 'function') {
          ws.broadcast({
            tipo: 'resposta',
            lead_id: lead.id,
            classificacao: analise.classificacao,
          });
        }
      } catch (aiErr) {
        console.error('[webhook] AI analysis error:', aiErr.message);
      }
    });
  } catch (err) {
    console.error('[webhook] evolution error:', err.message);
  }
});

// POST /meta
router.post('/meta', (req, res) => {
  return res.status(200).json({ received: true });
});

module.exports = router;
