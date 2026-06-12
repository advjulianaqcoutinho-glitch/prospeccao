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

    // Idempotency: skip if we already processed this message ID
    const messageId = key.id;
    if (messageId) {
      const { data: existing } = await supabase
        .from('interactions')
        .select('id')
        .eq('type', 'response_received')
        .contains('payload', { message_id: messageId })
        .limit(1);
      if (existing && existing.length > 0) return;
    }

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
      campanha_id: lead.campanha_id,
      type: 'response_received',
      payload: { content: messageContent, message_id: messageId || null },
      created_at: now,
    });

    await supabase
      .from('leads')
      .update({ status: 'respondeu', atualizado_em: now })
      .eq('id', lead.id);

    // Async: analyze response, generate suggested reply, advance kanban, rescore
    setImmediate(async () => {
      try {
        const { data: fullLead } = await supabase.from('leads')
          .select('mensagem_gerada, kanban_stage, reply_count, score, email')
          .eq('id', lead.id).single();

        const analise = await aiService.analisarResposta(fullLead?.mensagem_gerada || '', messageContent);

        // Generate suggested reply — pass full analise for context-aware response
        const { data: perfilRows } = await supabase.from('user_profile').select('*').limit(1);
        const perfil = perfilRows?.[0] || {};
        let suggestedReply = '';
        try {
          suggestedReply = await aiService.gerarRespostaSugerida(
            fullLead?.mensagem_gerada || '', messageContent, analise.classificacao, perfil, analise
          );
        } catch (e) { console.error('[webhook] suggested reply error:', e.message); }

        // Auto-advance kanban stage (more nuanced with new classifications)
        const currentStage = fullLead?.kanban_stage || 'novo';
        let newStage = currentStage;
        if (['muito_interessado', 'agendar'].includes(analise.classificacao) && !['proposta', 'fechado'].includes(currentStage)) {
          newStage = 'proposta';
        } else if (analise.classificacao === 'interessado' && !['proposta', 'fechado'].includes(currentStage)) {
          newStage = 'interessado';
        } else if (currentStage === 'novo') {
          newStage = 'contatado';
        }

        // Recalculate score with rules
        const { data: scoringRules } = await supabase.from('scoring_rules').select('*').eq('ativo', true);
        const replyCount = (fullLead?.reply_count || 0) + 1;
        const scoreLead = {
          ...fullLead,
          status: 'respondeu',
          classificacao: analise.classificacao,
          reply_count: replyCount,
          sinal_de_compra: analise.sinal_de_compra,
        };
        const newScore = await aiService.calcularScoreComRegras(scoreLead, scoringRules || []);

        const now2 = new Date().toISOString();
        await supabase.from('leads').update({
          classificacao: analise.classificacao,
          kanban_stage: newStage,
          ai_suggested_reply: suggestedReply,
          ai_reply_generated_at: now2,
          reply_count: replyCount,
          score: newScore,
          // Store rich analysis data
          ai_analise: {
            sentimento: analise.sentimento,
            urgencia: analise.urgencia,
            objecao: analise.objecao,
            sinal_de_compra: analise.sinal_de_compra,
            sugestao: analise.sugestao,
          },
          atualizado_em: now2,
        }).eq('id', lead.id);

        if (ws && typeof ws.broadcast === 'function') {
          ws.broadcast({ tipo: 'resposta', lead_id: lead.id, classificacao: analise.classificacao, kanban_stage: newStage });

          // Suggest blacklist if clearly not interested
          if (analise.classificacao === 'nao_interessado') {
            ws.broadcast({
              tipo: 'sugestao_blacklist',
              lead_id: lead.id,
              classificacao: analise.classificacao,
            });
          }
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
