'use strict';

const { scrapeGoogleMaps } = require('./googleMaps');
const supabase = require('../db');
const aiService = require('../services/aiService');
const metaCapiService = require('../services/metaCapiService');
const { normalizePhone, isMobilePhone } = require('../utils/phoneNormalizer');

function sendProgress(data) {
  if (process.send) {
    process.send(data);
  } else {
    console.log('[PROGRESS]', JSON.stringify(data));
  }
}

// ─── Main logic ───────────────────────────────────────────────────────────────

async function executarProspeccao({ campanhaId, nicho, cidade, limite, contexto }) {
  try {
    sendProgress({ tipo: 'inicio', mensagem: `Iniciando prospecção: ${nicho} em ${cidade}` });

    // Load campanha for extra config
    const { data: campanha, error: campanhaErr } = await supabase
      .from('campanhas')
      .select('*')
      .eq('id', campanhaId)
      .single();

    if (campanhaErr || !campanha) {
      throw new Error(`Campanha não encontrada: ${campanhaErr ? campanhaErr.message : campanhaId}`);
    }

    // Load user profile for AI message generation
    const { data: perfilRows } = await supabase
      .from('user_profile')
      .select('*')
      .limit(1);

    const perfil = perfilRows && perfilRows.length > 0
      ? perfilRows[0]
      : { nome: 'Prospector', empresa: '', descricao: '', tom_comunicacao: 'profissional' };

    // Scrape Google Maps
    const empresas = await scrapeGoogleMaps(nicho, cidade, limite || 10);

    sendProgress({
      tipo: 'scraping_concluido',
      mensagem: `${empresas.length} empresas encontradas`,
      total: empresas.length,
    });

    let salvos = 0;
    let erros = 0;

    for (let i = 0; i < empresas.length; i++) {
      const empresa = empresas[i];

      try {
        sendProgress({
          tipo: 'processando',
          mensagem: `Buscando dados de ${empresa.nome}`,
          atual: i + 1,
          total: empresas.length,
          empresa_nome: empresa.nome,
          empresa_telefone: empresa.telefone || null,
          empresa_endereco: empresa.endereco || null,
          empresa_rating: empresa.rating || null,
          empresa_reviews: empresa.review_count || null,
          empresa_website: empresa.website || null,
        });

        // ── Phone type check — skip landlines ───────────────────────────
        const telefoneNorm = normalizePhone(empresa.telefone);
        if (telefoneNorm && !isMobilePhone(telefoneNorm)) {
          sendProgress({
            tipo: 'lead_fixo',
            mensagem: `📞 ${empresa.nome} tem telefone fixo — ignorado`,
            atual: i + 1,
            total: empresas.length,
            empresa_nome: empresa.nome,
          });
          continue;
        }

        // ── Blacklist check ──────────────────────────────────────────────
        if (telefoneNorm) {
          const { data: blacklisted } = await supabase
            .from('blacklist')
            .select('id')
            .eq('telefone_normalizado', telefoneNorm)
            .limit(1);

          if (blacklisted && blacklisted.length > 0) {
            console.log(`[prospector] Skipping blacklisted number: ${empresa.nome}`);
            continue;
          }
        }

        // ── Deduplication check ──────────────────────────────────────────
        if (telefoneNorm) {
          const { data: existing } = await supabase
            .from('leads')
            .select('id')
            .eq('telefone_normalizado', telefoneNorm)
            .limit(1);

          if (existing && existing.length > 0) {
            sendProgress({
              tipo: 'lead_duplicado',
              mensagem: `⏭ ${empresa.nome} já existe na base (número duplicado)`,
              atual: i + 1,
              total: empresas.length,
              empresa_nome: empresa.nome,
            });
            continue;
          }
        }

        // ── Generate messages ────────────────────────────────────────────
        let mensagemGerada = null;
        let mensagemVarianteB = null;

        if (campanha.ab_testing_enabled) {
          const { a, b } = await aiService.gerarMensagemAB(
            empresa.nome,
            nicho,
            contexto || campanha.contexto || '',
            perfil
          );
          mensagemGerada = a;
          mensagemVarianteB = b;
        } else {
          mensagemGerada = await aiService.gerarMensagem(
            empresa.nome,
            nicho,
            contexto || campanha.contexto || '',
            perfil
          );
        }

        // ── Calculate lead score ─────────────────────────────────────────
        let score = null;
        let scoreBreakdown = null;

        try {
          const scoreResult = await aiService.calcularScore({
            rating: empresa.rating || 0,
            review_count: empresa.review_count || 0,
            website: empresa.website || null,
            nicho,
          });
          score = scoreResult.score;
          scoreBreakdown = scoreResult.breakdown;
        } catch (scoreErr) {
          console.error('[prospector] calcularScore error:', scoreErr.message);
        }

        // ── Save lead ────────────────────────────────────────────────────
        const now = new Date().toISOString();
        const leadRow = {
          campanha_id: campanhaId,
          nome: empresa.nome,
          telefone: empresa.telefone,
          telefone_normalizado: telefoneNorm,
          endereco: empresa.endereco,
          mensagem_gerada: mensagemGerada,
          mensagem_variante_b: mensagemVarianteB || null,
          variante_ativa: campanha.ab_testing_enabled ? 'a' : null,
          status: 'pendente',
          rating: empresa.rating || null,
          review_count: empresa.review_count || null,
          website: empresa.website || null,
          google_maps_url: empresa.google_maps_url || null,
          cidade: campanha.cidade,
          nicho: campanha.nicho,
          score: score,
          score_breakdown: scoreBreakdown || null,
          criado_em: now,
          atualizado_em: now,
        };

        const { data: savedLead, error: insertErr } = await supabase
          .from('leads')
          .insert(leadRow)
          .select()
          .single();

        if (insertErr) throw new Error(insertErr.message);

        // ── If AB testing, save ab_test_results ──────────────────────────
        if (campanha.ab_testing_enabled && mensagemVarianteB && savedLead) {
          await supabase.from('ab_test_results').insert({
            lead_id: savedLead.id,
            campanha_id: campanhaId,
            variante_a: mensagemGerada,
            variante_b: mensagemVarianteB,
            created_at: now,
          }).catch((err) => {
            console.error('[prospector] ab_test_results insert error:', err.message);
          });
        }

        // ── Meta CAPI Lead event ─────────────────────────────────────────
        if (savedLead) {
          try {
            // Check if meta capi is configured (pixel + token come from config)
            const { data: integrations } = await supabase
              .from('integrations')
              .select('*')
              .eq('type', 'meta_capi')
              .eq('active', true)
              .limit(1);

            if (integrations && integrations.length > 0) {
              await metaCapiService.sendEvent('Lead', {
                phone: telefoneNorm || empresa.telefone,
                lead_id: savedLead.id,
              });
            }
          } catch (capiErr) {
            console.error('[prospector] meta capi error:', capiErr.message);
          }
        }

        sendProgress({
          tipo: 'lead_salvo',
          mensagem: `✅ ${empresa.nome} salvo (score: ${score ?? '–'})`,
          atual: i + 1,
          total: empresas.length,
          empresa_nome: empresa.nome,
          empresa_telefone: empresa.telefone || null,
          empresa_rating: empresa.rating || null,
          lead_score: score,
          salvos_ate_agora: salvos + 1,
        });

        salvos++;
      } catch (err) {
        console.error(`[prospector] Erro ao processar ${empresa.nome}:`, err.message);
        sendProgress({
          tipo: 'lead_erro',
          mensagem: `⚠️ Erro em ${empresa.nome}: ${err.message}`,
          atual: i + 1,
          total: empresas.length,
          empresa_nome: empresa.nome,
        });
        erros++;
      }
    }

    // Update campanha status
    await supabase
      .from('campanhas')
      .update({ status: 'pronta', atualizado_em: new Date().toISOString() })
      .eq('id', campanhaId);

    sendProgress({
      tipo: 'concluido',
      mensagem: `Prospecção concluída. ${salvos} leads salvos, ${erros} erros.`,
      salvos,
      erros,
    });
  } catch (err) {
    console.error('[prospector] Erro fatal:', err.message);
    sendProgress({ tipo: 'erro', mensagem: err.message });

    await supabase
      .from('campanhas')
      .update({ status: 'erro', atualizado_em: new Date().toISOString() })
      .eq('id', campanhaId)
      .catch(() => {});
  }
}

// Execute when called as a child process
const args = process.argv.slice(2);
if (args.length > 0) {
  const campanha = JSON.parse(args[0]);
  executarProspeccao({
    campanhaId: campanha.campanhaId || campanha.id,
    nicho: campanha.nicho,
    cidade: campanha.cidade,
    limite: campanha.limite,
    contexto: campanha.contexto,
  });
}

module.exports = { executarProspeccao, normalizePhone };
