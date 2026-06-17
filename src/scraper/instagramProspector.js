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

async function executarProspeccaoInstagram({ campanhaId, palavraChave, limite }) {
  try {
    sendProgress({ tipo: 'inicio', mensagem: 'Iniciando extração Instagram: "' + palavraChave + '"' });

    const { data: campanha, error: campanhaErr } = await supabase
      .from('campanhas')
      .select('*')
      .eq('id', campanhaId)
      .single();

    if (campanhaErr || !campanha) {
      throw new Error('Campanha não encontrada: ' + (campanhaErr ? campanhaErr.message : campanhaId));
    }

    const { data: perfilRows } = await supabase.from('user_profile').select('*').limit(1);
    const perfil = perfilRows && perfilRows.length > 0
      ? perfilRows[0]
      : { nome: 'Prospector', empresa: '', descricao: '', tom_comunicacao: 'profissional' };

    const perfis = await scrapeInstagram(palavraChave, limite || 20);

    sendProgress({ tipo: 'scraping_concluido', mensagem: perfis.length + ' perfis encontrados', total: perfis.length });

    let salvos = 0;
    let erros = 0;

    for (let i = 0; i < perfis.length; i++) {
      const p = perfis[i];

      try {
        sendProgress({
          tipo: 'processando',
          mensagem: 'Salvando @' + p.instagram_username,
          atual: i + 1,
          total: perfis.length,
          empresa_nome: p.nome,
          empresa_telefone: p.telefone || null,
        });

        const { data: existing } = await supabase
          .from('leads')
          .select('id')
          .eq('instagram_username', p.instagram_username)
          .limit(1);

        if (existing && existing.length > 0) {
          sendProgress({ tipo: 'lead_duplicado', mensagem: '⏭ @' + p.instagram_username + ' já existe', atual: i + 1, total: perfis.length, empresa_nome: p.nome });
          continue;
        }

        let mensagemGerada = null;
        if (p.telefone) {
          try {
            const contextoIA = [campanha.contexto || '', p.bio ? 'Bio: ' + p.bio : ''].filter(Boolean).join('\n');
            mensagemGerada = await aiService.gerarMensagem(p.nome, campanha.nicho || palavraChave, contextoIA, perfil, 'a', {});
          } catch (aiErr) {
            console.error('[instagramProspector] AI error:', aiErr.message);
          }
        }

        const now = new Date().toISOString();
        const { error: insertErr } = await supabase.from('leads').insert({
          campanha_id: campanhaId,
          nome: p.nome,
          telefone: p.telefone || null,
          email: p.email || null,
          instagram_username: p.instagram_username,
          instagram_url: p.instagram_url,
          bio: p.bio || null,
          followers_count: p.followers_count || null,
          mensagem_gerada: mensagemGerada,
          status: p.telefone ? 'pendente' : 'sem_telefone',
          fonte: 'instagram',
          nicho: campanha.nicho || palavraChave,
          criado_em: now,
          atualizado_em: now,
        });

        if (insertErr) throw new Error(insertErr.message);

        sendProgress({ tipo: 'lead_salvo', mensagem: '✅ @' + p.instagram_username + ' salvo', atual: i + 1, total: perfis.length, empresa_nome: p.nome, empresa_telefone: p.telefone || null, salvos_ate_agora: salvos + 1 });
        salvos++;
      } catch (err) {
        console.error('[instagramProspector] Erro @' + p.instagram_username + ':', err.message);
        sendProgress({ tipo: 'lead_erro', mensagem: '⚠️ Erro em @' + p.instagram_username + ': ' + err.message, atual: i + 1, total: perfis.length, empresa_nome: p.nome });
        erros++;
      }
    }

    await supabase.from('campanhas').update({ status: 'pronta', atualizado_em: new Date().toISOString() }).eq('id', campanhaId);

    sendProgress({ tipo: 'concluido', mensagem: 'Extração concluída. ' + salvos + ' leads salvos, ' + erros + ' erros.', salvos, erros });
  } catch (err) {
    console.error('[instagramProspector] Erro fatal:', err.message);
    sendProgress({ tipo: 'erro', mensagem: err.message });
    try {
      await supabase.from('campanhas').update({ status: 'erro', atualizado_em: new Date().toISOString() }).eq('id', campanhaId);
    } catch (_) {}
  }
}

const args = process.argv.slice(2);
if (args.length > 0) {
  const params = JSON.parse(args[0]);
  executarProspeccaoInstagram({ campanhaId: params.campanhaId, palavraChave: params.palavraChave || params.nicho, limite: params.limite });
}

module.exports = { executarProspeccaoInstagram };
