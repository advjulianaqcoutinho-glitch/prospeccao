'use strict';

const OpenAI = require('openai');
const config = require('../config');

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

async function gerarMensagem(empresa, nicho, contexto, perfil, variante = 'a') {
  const toneNote =
    variante === 'b'
      ? 'Use um tom levemente mais direto e objetivo, focando em resultados concretos.'
      : 'Use um tom consultivo e amigável, focando em construir relacionamento.';

  const systemPrompt = `Você é ${perfil.nome}, representante da empresa ${perfil.empresa}.
Descrição da empresa: ${perfil.descricao}
Tom de comunicação preferido: ${perfil.tom_comunicacao}
${toneNote}`;

  const userPrompt = `Gere uma mensagem de prospecção para WhatsApp para a empresa "${empresa}" do nicho "${nicho}".
Contexto adicional: ${contexto}
A mensagem deve ser personalizada, natural, não-genérica, e com no máximo 3 parágrafos curtos.
Não use emojis em excesso. Não inclua saudações formais. Conclua com uma pergunta aberta.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: variante === 'b' ? 0.5 : 0.7,
  });

  return response.choices[0].message.content.trim();
}

async function gerarMensagemAB(empresa, nicho, contexto, perfil) {
  const [a, b] = await Promise.all([
    gerarMensagem(empresa, nicho, contexto, perfil, 'a'),
    gerarMensagem(empresa, nicho, contexto, perfil, 'b'),
  ]);
  return { a, b };
}

async function calcularScore(empresa) {
  const { rating = 0, review_count = 0, website, nicho } = empresa;

  // Rating score (0-5 -> 0-30)
  const ratingScore = Math.round((rating / 5) * 30);

  // Review count score
  let reviewScore = 0;
  if (review_count >= 200) reviewScore = 30;
  else if (review_count >= 100) reviewScore = 20;
  else if (review_count >= 50) reviewScore = 10;
  else if (review_count >= 10) reviewScore = 0;

  // Website score
  const websiteScore = website ? 25 : 0;

  // AI relevance score (0-15)
  let aiRelevanceScore = 0;
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a sales qualification assistant. Rate how suitable a business niche is for digital marketing / WhatsApp prospecting services. Return only a JSON object with a single field "score" (integer 0-15).',
        },
        {
          role: 'user',
          content: `Rate the niche "${nicho}" for digital marketing prospecting suitability. Consider: online presence potential, typical marketing budget availability, and receptiveness to new clients. Return JSON: {"score": <0-15>}`,
        },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(response.choices[0].message.content);
    aiRelevanceScore = Math.max(0, Math.min(15, parseInt(parsed.score, 10) || 0));
  } catch (err) {
    console.error('[aiService] calcularScore AI relevance error:', err.message);
    aiRelevanceScore = 7; // neutral fallback
  }

  const score = ratingScore + reviewScore + websiteScore + aiRelevanceScore;

  return {
    score: Math.min(100, score),
    breakdown: {
      rating: ratingScore,
      review_count: reviewScore,
      website: websiteScore,
      ai_relevance: aiRelevanceScore,
    },
  };
}

async function analisarResposta(mensagemOriginal, resposta) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'Você é um assistente de análise de respostas de prospecção B2B via WhatsApp. Retorne apenas JSON.',
      },
      {
        role: 'user',
        content: `Mensagem enviada: "${mensagemOriginal}"
Resposta recebida: "${resposta}"

Classifique a resposta e sugira a próxima ação. Retorne JSON no formato:
{
  "classificacao": "interessado" | "nao_interessado" | "pedir_mais_info",
  "sugestao": "<string com a próxima ação sugerida>"
}`,
      },
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  });

  let parsed;
  try {
    parsed = JSON.parse(response.choices[0].message.content);
  } catch {
    parsed = {};
  }

  const validClassificacoes = ['interessado', 'nao_interessado', 'pedir_mais_info'];
  if (!validClassificacoes.includes(parsed.classificacao)) {
    parsed.classificacao = 'pedir_mais_info';
  }

  return {
    classificacao: parsed.classificacao,
    sugestao: parsed.sugestao || '',
  };
}

async function gerarRespostaSugerida(mensagemOriginal, respostaLead, classificacao, perfil) {
  const contextoClassif = {
    interessado: 'O lead demonstrou interesse. Avance propondo uma reunião ou próximo passo concreto.',
    pedir_mais_info: 'O lead quer mais informações. Responda de forma consultiva e termine com uma pergunta para engajar.',
    nao_interessado: 'O lead não demonstrou interesse claro. Seja educado, deixe uma porta aberta e não insista.',
  };

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Você é ${perfil?.nome || 'um consultor'} da empresa ${perfil?.empresa || ''}. Tom: ${perfil?.tom_comunicacao || 'profissional'}. Escreva respostas curtas e naturais para WhatsApp, máximo 2 parágrafos.`,
      },
      {
        role: 'user',
        content: `Você enviou: "${mensagemOriginal}"
O lead respondeu: "${respostaLead}"
Classificação: ${classificacao}
Orientação: ${contextoClassif[classificacao] || ''}

Escreva uma resposta ideal para enviar ao lead agora.`,
      },
    ],
    temperature: 0.6,
  });

  return response.choices[0].message.content.trim();
}

async function calcularScoreComRegras(lead, rules) {
  let bonus = 0;
  for (const rule of rules || []) {
    if (!rule.ativo) continue;
    if (rule.evento === 'tem_email' && lead.email) bonus += rule.pontos;
    if (rule.evento === 'respondeu' && lead.status === 'respondeu') bonus += rule.pontos;
    if (rule.evento === 'classificado_interessado' && lead.classificacao === 'interessado') bonus += rule.pontos;
    if (rule.evento === 'muito_interessado' && lead.classificacao === 'muito_interessado') bonus += rule.pontos;
    if (rule.evento === 'respondeu_2x' && (lead.reply_count || 0) >= 2) bonus += rule.pontos;
  }
  return Math.min(100, (lead.score || 0) + bonus);
}

module.exports = { gerarMensagem, gerarMensagemAB, calcularScore, analisarResposta, gerarRespostaSugerida, calcularScoreComRegras };
