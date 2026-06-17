'use strict';

const { scrapeInstagram } = require('./instagram');
const supabase = require('../db');
const aiService = require('../services/aiService');

function sendProgress(data) {
  if (process.send) {
    process.send(data);
  } else {
    console.log('[PROGRESS]', JSON.stringify(data));
  }
}

async function executarProspeccaoInstagram({ campanhaId, palavraChave, limite, contexto }) {
  try {
    sendProgress({ tipo: 'inicio', mensagem: `Iniciando extração Instagram: "${palavraChave}"` });

    const { data: campanha, error: campanhaErr } = await supabase
      .from('campanhas')
      .select('*')
      .eq('id', campanhaId)
      .single();

    if (campanhaErr || !campanha) {
      throw new Error(`Campanha não encontrada: ${campanhaErr ? campanhaErr.message : campanhaId}`);
    }

    const { data: perfilRows } = await supabase.from('user_profile').select('*').limit(1);
    const perfil = perfilRows && perfilRows.length > 0
      ? perfilRows[0]
      : { nome: 'Prospector', empresa: '', descricao: '', tom_comunicacao: 'profissional' };

    const perfis = await scrapeInstagram(palavraChave, limite || 20);

    sendProgress({
      tipo: 'scraping_concluido',
      mensagem: `${perfis.length} perfis encontrados no Instagram`,
      total: perfis.length,
    });

    let salvos = 0;
    let erros = 0;

    for (let i = 0; i < perfis.length; i++) {
      const perfil_ig = perfis[i];

      try {
        sendProgress({
          tipo: 'processando',
          mensagem: `Processando @${perfil_ig.instagram_username}`,
          atual: i + 1,
          total: perfis.length,
          empresa_nome: perfil_ig.nome,
          empresa_telefone: perfil_ig.telefone || null,
        });

        // Dedup by instagram_username
        const { data: existing } = await supabase
          .from('leads')
          .select('id')
          .eq('instagram_username', perfil_ig.instagram_username)
          .limit(1);

        if (existing && existing.length > 0) {
          sendProgress({
            tipo: 'lead_duplicado',
            mensagem: `⏭ @${perfil_ig.instagram_username} já existe na base`,
            atual: i + 1,
            total: perfis.length,
            empresa_nome: perfil_ig.nome,
          });
          continue;
        }

        // Generate personalized message using bio as context
        const contextoIA = [
          contexto || campanha.contexto || '',
          perfil_ig.bio ? `Bio do perfil: ${perfil_ig.bio}` : '',
        ].filter(Boolean).join('\n');

        let mensagemGerada = null;
        try {
          mensagemGerada = await aiService.gerarMensagem(
            perfil_ig.nome,
            campanha.nicho || palavraChave,
            contextoIA,
            perfil,
            'a',
            {}
          );
        } catch (aiErr) {
          console.error('[instagramProspector] AI error:', aiErr.message);
        }

        const now = new Date().toISOString();
        const leadRow = {
          campanha_id: campanhaId,
          nome: perfil_ig.nome,
          telefone: perfil_ig.telefone || null,
          email: perfil_ig.email || null,
          instagram_username: perfil_ig.instagram_username,
          instagram_url: perfil_ig.instagram_url,
          bio: perfil_ig.bio || null,
          followers_count: perfil_ig.followers_count || null,
          mensagem_gerada: mensagemGerada,
          status: perfil_ig.telefone ? 'pendente' : 'sem_telefone',
          fonte: 'instagram',
          cidade: campanha.cidade || null,
          nicho: campanha.nicho || palavraChave,
          criado_em: now,
          atualizado_em: now,
        };

        const { error: insertErr } = await supabase.from('leads').insert(leadRow);
        if (insertErr) throw new Error(insertErr.message);

        sendProgress({
          tipo: 'lead_salvo',
          mensagem: `✅ @${perfil_ig.instagram_username} salvo`,
          atual: i + 1,
          total: perfis.length,
          empresa_nome: perfil_ig.nome,
          empresa_telefone: perfil_ig.telefone || null,
          salvos_ate_agora: salvos + 1,
        });

        salvos++;
      } catch (err) {
        console.error(`[instagramProspector] Erro em @${perfil_ig.instagram_username}:`, err.message);
        sendProgress({
          tipo: 'lead_erro',
          mensagem: `⚠️ Erro em @${perfil_ig.instagram_username}: ${err.message}`,
          atual: i + 1,
          total: perfis.length,
          empresa_nome: perfil_ig.nome,
        });
        erros++;
      }
    }

    await supabase
      .from('campanhas')
      .update({ status: 'pronta', atualizado_em: new Date().toISOString() })
      .eq('id', campanhaId);

    sendProgress({
      tipo: 'concluido',
      mensagem: `Extração Instagram concluída. ${salvos} leads salvos, ${erros} erros.`,
      salvos,
      erros,
    });
  } catch (err) {
    console.error('[instagramProspector] Erro fatal:', err.message);
    sendProgress({ tipo: 'erro', mensagem: err.message });

    try {
      await supabase
        .from('campanhas')
        .update({ status: 'erro', atualizado_em: new Date().toISOString() })
        .eq('id', campanhaId);
    } catch (_) {}
  }
}

const args = process.argv.slice(2);
if (args.length > 0) {
  const params = JSON.parse(args[0]);
  executarProspeccaoInstagram({
    campanhaId: params.campanhaId,
    palavraChave: params.palavraChave || params.nicho,
    limite: params.limite,
    contexto: params.contexto,
  });
}

module.exports = { executarProspeccaoInstagram };
