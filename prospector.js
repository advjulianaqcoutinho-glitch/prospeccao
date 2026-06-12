const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');
const { scrapeGoogleMaps } = require('./scraper');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Envia progresso via WebSocket se o processo pai estiver ouvindo
function sendProgress(data) {
  if (process.send) {
    process.send(data);
  } else {
    console.log('[PROGRESS]', JSON.stringify(data));
  }
}

async function gerarMensagem(empresa, nicho, contexto = '') {
  const prompt = `Você é um especialista em prospecção de clientes B2B no Brasil.
Crie uma mensagem de WhatsApp curta e persuasiva para prospectar a empresa abaixo.
A mensagem deve ser informal, amigável e ter no máximo 3 parágrafos.
Não use emojis em excesso. Finalize com uma pergunta aberta.

Empresa: ${empresa.nome}
Segmento: ${nicho}
Endereço: ${empresa.endereco || 'não informado'}
${contexto ? `Contexto adicional: ${contexto}` : ''}

Retorne apenas o texto da mensagem, sem aspas ou explicações.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 300,
    temperature: 0.8
  });

  return response.choices[0].message.content.trim();
}

async function executarProspeccao({ campanhaId, nicho, cidade, limite, contexto }) {
  try {
    sendProgress({ tipo: 'inicio', mensagem: `Iniciando prospecção: ${nicho} em ${cidade}` });

    // Busca empresas
    const empresas = await scrapeGoogleMaps(nicho, cidade, limite || 10);

    sendProgress({
      tipo: 'scraping_concluido',
      mensagem: `${empresas.length} empresas encontradas`,
      total: empresas.length
    });

    let salvos = 0;
    let erros = 0;

    for (let i = 0; i < empresas.length; i++) {
      const empresa = empresas[i];

      try {
        sendProgress({
          tipo: 'processando',
          mensagem: `Gerando mensagem para ${empresa.nome} (${i + 1}/${empresas.length})`,
          atual: i + 1,
          total: empresas.length
        });

        const mensagem = await gerarMensagem(empresa, nicho, contexto);

        const { error } = await supabase.from('leads').insert({
          campanha_id: campanhaId,
          nome: empresa.nome,
          telefone: empresa.telefone,
          endereco: empresa.endereco,
          mensagem_gerada: mensagem,
          status: 'pendente',
          criado_em: new Date().toISOString()
        });

        if (error) throw error;
        salvos++;
      } catch (err) {
        console.error(`Erro ao processar ${empresa.nome}:`, err.message);
        erros++;
      }
    }

    // Atualiza status da campanha
    await supabase
      .from('campanhas')
      .update({ status: 'pronta', atualizado_em: new Date().toISOString() })
      .eq('id', campanhaId);

    sendProgress({
      tipo: 'concluido',
      mensagem: `Prospecção concluída. ${salvos} leads salvos, ${erros} erros.`,
      salvos,
      erros
    });
  } catch (err) {
    console.error('Erro fatal na prospecção:', err);
    sendProgress({ tipo: 'erro', mensagem: err.message });

    await supabase
      .from('campanhas')
      .update({ status: 'erro', atualizado_em: new Date().toISOString() })
      .eq('id', campanhaId);
  }
}

// Executa quando chamado como processo filho
const args = process.argv.slice(2);
if (args.length > 0) {
  const params = JSON.parse(args[0]);
  executarProspeccao(params);
}

module.exports = { executarProspeccao };
