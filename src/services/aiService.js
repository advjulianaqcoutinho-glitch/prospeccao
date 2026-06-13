'use strict';

const OpenAI = require('openai');
const config = require('../config');

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

// ─── Models ───────────────────────────────────────────────────────────────────
const MODEL_WRITING = 'gpt-4o';
const MODEL_FAST    = 'gpt-4o-mini';

// ─── Business signal analysis ─────────────────────────────────────────────────
function analisarSinaisDeNegocio({ rating, review_count, website, cidade }) {
  const sinais = [];
  const angulos = [];

  if (rating >= 4.5) {
    sinais.push(`Loja bem avaliada (${rating}★ com ${review_count || 0} avaliações) — reputação sólida, clientes satisfeitos`);
    angulos.push('escala_qualidade');
  } else if (rating >= 4.0) {
    sinais.push(`Boa avaliação (${rating}★) com espaço para crescer`);
    angulos.push('crescimento');
  } else if (rating > 0 && rating < 3.8) {
    sinais.push(`Avaliação abaixo da média do setor (${rating}★)`);
    angulos.push('visibilidade');
  }

  if (review_count >= 100) {
    sinais.push(`${review_count} avaliações — loja estabelecida e ativa`);
    angulos.push('escala_qualidade');
  } else if (review_count >= 20) {
    sinais.push(`${review_count} avaliações — presença local reconhecida`);
    angulos.push('crescimento');
  } else {
    const n = review_count || 0;
    sinais.push(`${n > 0 ? `Apenas ${n} avaliações` : 'Sem avaliações'} — pouca visibilidade para quem pesquisa online`);
    angulos.push('visibilidade');
  }

  if (!website) {
    sinais.push('Sem site — perde credibilidade com clientes que pesquisam antes de visitar');
    angulos.push('presenca_digital');
  } else {
    sinais.push('Tem site — já investe em presença digital');
  }

  if (cidade) sinais.push(`Localizada em ${cidade}`);

  const prioridade = ['presenca_digital', 'visibilidade', 'crescimento', 'escala_qualidade'];
  const anguloEscolhido = prioridade.find(a => angulos.includes(a)) || 'crescimento';

  // Angle descriptions specifically for furniture store owners
  const descricaoAngulo = {
    presenca_digital: `A loja não tem site — tem pessoas buscando "móveis planejados em ${cidade || 'sua cidade'}" agora e não encontrando ela. Aborde isso como uma oportunidade concreta de clientes que estão indo para o concorrente.`,
    visibilidade: `A loja tem pouca presença digital — enquanto ela trabalha, potenciais clientes com obra em andamento pesquisam no Google e não a encontram. Aborde a fatia de mercado que ela está perdendo sem saber.`,
    crescimento: `A loja tem boa base mas não aparece para quem está ativamente buscando planejados com urgência (em reforma, recém-mudado). Aborde o perfil específico desse cliente que ela ainda não captura.`,
    escala_qualidade: `A loja já tem reputação sólida. Aborde que ela merece estar na frente de clientes que já decidiram comprar — pessoas em obra, com prazo e budget definidos — e que provavelmente estão escolhendo entre ela e o concorrente sem nem saber que ela existe.`,
  };

  return { sinais, anguloEscolhido, instrucaoAngulo: descricaoAngulo[anguloEscolhido] };
}

// ─── Core message generation ──────────────────────────────────────────────────
async function gerarMensagem(empresa, nicho, contexto, perfil, variante = 'a', dadosEmpresa = {}) {
  const { rating, review_count, website, cidade, endereco } = dadosEmpresa;
  const analise = analisarSinaisDeNegocio({ rating, review_count, website, cidade });

  // Build the middle line based on angle detected
  const linhaValor = {
    escala_qualidade: `Vi a ${empresa} no Google. Vocês têm uma das melhores avaliações de planejados em ${cidade || 'sua cidade'}.

Trabalho conectando lojas com esse nível de reputação a pessoas que estão em obra agora. Clientes que já decidiram comprar e só precisam encontrar a loja certa.`,

    crescimento: `Encontrei a ${empresa} no Google enquanto pesquisava lojas de planejados em ${cidade || 'sua cidade'}.

Tenho trabalhado com lojas do setor para conectá-las com pessoas que estão ativamente em obra ou reforma. Clientes que já decidiram comprar, só ainda não escolheram onde.`,

    visibilidade: `Encontrei a ${empresa} no Google enquanto pesquisava lojas de planejados em ${cidade || 'sua cidade'}.

Reparei que vocês podem estar perdendo clientes que estão em obra agora. Pessoas prontas pra comprar que pesquisam online e acabam indo pro concorrente sem nem saber que vocês existem.`,

    presenca_digital: `Encontrei a ${empresa} no Google enquanto pesquisava lojas de planejados em ${cidade || 'sua cidade'}.

Reparei que vocês podem estar perdendo clientes que estão em obra agora. Pessoas prontas pra comprar que pesquisam online e acabam indo pro concorrente sem nem saber que vocês existem.`,
  };

  const corpo = linhaValor[analise.anguloEscolhido] || linhaValor.crescimento;

  const systemPrompt = `Você é Igor, fundador da Assessoria para Lojistas de Móveis e criador do Método Projeto Fechado.

ESTRUTURA OBRIGATÓRIA DA MENSAGEM (3 blocos separados por linha em branco):
Bloco 1: "Oi, meu nome é Igor! [contexto de como encontrou a loja — 1 frase]"
Bloco 2: [linha de valor específica ao perfil da loja — 2 frases curtas]
Bloco 3: "Você toparia entender como funciona?"

REGRAS ABSOLUTAS — NUNCA QUEBRE:
- Separe os 3 blocos com uma linha em branco entre eles (como no WhatsApp)
- Máximo 5 frases no total. WhatsApp não é e-mail.
- NUNCA use traço longo (—) ou travessão. Use ponto final para separar ideias.
- NUNCA entregue o que você faz por completo — gere curiosidade, não explique tudo.
- NUNCA use: "prospecção", "tráfego pago", "leads", "marketing digital", "impulsionar", "anúncios"
- NUNCA use emojis
- NUNCA prometa resultados numéricos
- Escreva como uma pessoa real escreveria no WhatsApp — natural, sem formalidade excessiva
- A mensagem deve parecer escrita especificamente para essa loja`;

  const userPrompt = `LOJA: "${empresa}"
CIDADE: ${cidade || 'não informada'}
${endereco ? `BAIRRO/ENDEREÇO: ${endereco}` : ''}
AVALIAÇÃO: ${rating ? `${rating}★ com ${review_count || 0} avaliações` : 'sem dados'}
SITE: ${website || 'sem site'}
ÂNGULO DETECTADO: ${analise.anguloEscolhido}

Use exatamente esta linha de valor no bloco 2 (adapte apenas se soar antinatural):
---
${corpo}
---

Escreva APENAS o texto final da mensagem. Nada mais.`;

  const response = await openai.chat.completions.create({
    model: MODEL_WRITING,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 220,
  });

  const mensagem = response.choices[0].message.content.trim();

  const qualidade = await avaliarQualidadeMensagem(mensagem, empresa, analise.anguloEscolhido);
  if (qualidade.score < 7) {
    return await melhorarMensagem(mensagem, qualidade.critica, empresa, systemPrompt);
  }

  return mensagem;
}

// ─── Self-critique ────────────────────────────────────────────────────────────
async function avaliarQualidadeMensagem(mensagem, empresa, angulo) {
  const response = await openai.chat.completions.create({
    model: MODEL_FAST,
    messages: [
      {
        role: 'system',
        content: 'Você é especialista em copywriting de prospecção B2B via WhatsApp. Avalie com rigor. Retorne JSON.',
      },
      {
        role: 'user',
        content: `Avalie esta mensagem de prospecção para a loja "${empresa}" (ângulo: ${angulo}):

"${mensagem}"

Critérios de qualidade:
1. Gera curiosidade sem entregar o pitch? (não pode revelar tudo)
2. Parece escrita por uma pessoa real, não robô?
3. Menciona algo específico da empresa (não genérico)?
4. CTA de baixo compromisso (não pede reunião logo)?
5. Tamanho adequado para WhatsApp (máximo 5 frases)?
6. Ausência de palavras proibidas: "leads", "tráfego", "marketing digital", "prospecção"?

Retorne: { "score": <1-10>, "critica": "<problema principal em 1 frase>" }`,
      },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  try { return JSON.parse(response.choices[0].message.content); }
  catch { return { score: 8, critica: '' }; }
}

// ─── Message improvement ──────────────────────────────────────────────────────
async function melhorarMensagem(mensagemOriginal, critica, empresa, systemPrompt) {
  const response = await openai.chat.completions.create({
    model: MODEL_WRITING,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Reescreva esta mensagem para a loja "${empresa}", corrigindo:
PROBLEMA: ${critica}

MENSAGEM ATUAL:
"${mensagemOriginal}"

Escreva apenas a mensagem corrigida.`,
      },
    ],
    temperature: 0.55,
    max_tokens: 250,
  });
  return response.choices[0].message.content.trim();
}

// ─── A/B generation ──────────────────────────────────────────────────────────
async function gerarMensagemAB(empresa, nicho, contexto, perfil, dadosEmpresa = {}) {
  const [a, b] = await Promise.all([
    gerarMensagem(empresa, nicho, contexto, perfil, 'a', dadosEmpresa),
    gerarMensagem(empresa, nicho, contexto, perfil, 'b', dadosEmpresa),
  ]);
  return { a, b };
}

// ─── Lead scoring ─────────────────────────────────────────────────────────────
async function calcularScore(empresa) {
  const { rating = 0, review_count = 0, website, nicho } = empresa;

  const ratingScore = Math.round((rating / 5) * 30);

  let reviewScore = 0;
  if (review_count >= 200) reviewScore = 30;
  else if (review_count >= 100) reviewScore = 20;
  else if (review_count >= 50) reviewScore = 10;
  else if (review_count >= 10) reviewScore = 5;

  const websiteScore = website ? 25 : 0;

  let aiRelevanceScore = 7;
  try {
    const response = await openai.chat.completions.create({
      model: MODEL_FAST,
      messages: [
        { role: 'system', content: 'You are a sales qualification assistant. Return only JSON.' },
        {
          role: 'user',
          content: `Rate the niche "${nicho}" for B2B prospecting of furniture stores (móveis planejados sector). Consider: typical marketing budget, receptiveness to client acquisition services, potential for qualified leads. Return JSON: {"score": <0-15>}`,
        },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(response.choices[0].message.content);
    aiRelevanceScore = Math.max(0, Math.min(15, parseInt(parsed.score, 10) || 7));
  } catch (err) {
    console.error('[aiService] calcularScore error:', err.message);
  }

  return {
    score: Math.min(100, ratingScore + reviewScore + websiteScore + aiRelevanceScore),
    breakdown: { rating: ratingScore, reviews: reviewScore, website: websiteScore, nicho_fit: aiRelevanceScore },
  };
}

// ─── Response analysis ────────────────────────────────────────────────────────
async function analisarResposta(mensagemOriginal, resposta) {
  const response = await openai.chat.completions.create({
    model: MODEL_FAST,
    messages: [
      {
        role: 'system',
        content: `Você analisa respostas de donos de lojas de móveis planejados para mensagens de prospecção da Assessoria para Lojistas de Móveis (Método Projeto Fechado).
Seja preciso — análise errada leva a abordagem errada. Retorne JSON.`,
      },
      {
        role: 'user',
        content: `Mensagem enviada: "${mensagemOriginal}"
Resposta do lojista: "${resposta}"

Retorne JSON:
{
  "classificacao": "interessado" | "muito_interessado" | "nao_interessado" | "pedir_mais_info" | "agendar",
  "sentimento": "positivo" | "neutro" | "negativo",
  "urgencia": "alta" | "media" | "baixa",
  "objecao": null | "preco" | "tempo" | "nao_precisa" | "pessoa_errada" | "ja_tem_fornecedor",
  "sinal_de_compra": true | false,
  "sugestao": "<próxima ação específica em 1 frase>"
}

Classificações:
- "muito_interessado": pediu mais detalhes, perguntou sobre preço/processo, demonstrou urgência real
- "interessado": respondeu positivamente, aberto à conversa, sem urgência clara
- "agendar": mencionou call, reunião, visita ou "quando podemos conversar"
- "pedir_mais_info": quer entender melhor antes de decidir, fez perguntas
- "nao_interessado": recusou, ignorou a proposta ou respondeu negativamente`,
      },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });

  let parsed;
  try { parsed = JSON.parse(response.choices[0].message.content); }
  catch { parsed = {}; }

  const validos = ['interessado', 'muito_interessado', 'nao_interessado', 'pedir_mais_info', 'agendar'];
  if (!validos.includes(parsed.classificacao)) parsed.classificacao = 'pedir_mais_info';

  return {
    classificacao: parsed.classificacao,
    sentimento: parsed.sentimento || 'neutro',
    urgencia: parsed.urgencia || 'media',
    objecao: parsed.objecao || null,
    sinal_de_compra: parsed.sinal_de_compra || false,
    sugestao: parsed.sugestao || '',
  };
}

// ─── Suggested reply ──────────────────────────────────────────────────────────
async function gerarRespostaSugerida(mensagemOriginal, respostaLead, classificacao, perfil, analise = {}) {
  const instrucoes = {
    muito_interessado: `O lojista demonstrou interesse real. AGORA é hora de avançar:
- Explique brevemente o Método Projeto Fechado em 2 frases (captação de clientes que já estão em obra/reforma, com prazo e budget definidos)
- Proponha uma conversa de 15-20 minutos para explicar como funciona
- Ofereça 2 horários concretos`,

    agendar: `O lojista quer marcar. Facilite ao máximo:
- Confirme entusiasmo brevemente
- Ofereça 2-3 opções de horário concretas para essa semana
- Diga que é uma conversa rápida (15-20 min) sem compromisso`,

    interessado: `O lojista está aberto. Avance sem pressão:
- Valide o interesse com 1 frase
- Dê uma amostra do valor: "trabalho conectando lojistas a clientes que já decidiram comprar, com obra em andamento — não é lead genérico"
- Proponha uma conversa curta para mostrar como funciona`,

    pedir_mais_info: `O lojista quer entender melhor. Seja consultivo:
- Responda de forma específica ao que ele perguntou
- Mencione o diferencial central: clientes qualificados (em obra, com prazo, com budget) — não lead frio
- Termine com uma pergunta que qualifique o interesse dele`,

    nao_interessado: `O lojista não está interessado. Seja breve e deixe porta aberta:
- Agradeça a resposta em 1 frase
- Deixe uma semente: "se algum momento quiser entender como conectamos lojas a clientes prontos para fechar, é só falar"
- Máximo 2 frases. Não insista.`,
  };

  const instrucaoObjecao = {
    preco: ' Ele mencionou custo/preço — NÃO discuta valores agora. Diga que o modelo é baseado em resultado e proponha uma conversa para explicar como funciona.',
    tempo: ' Ele está sem tempo — empatize e proponha algo ultracurto: "são só 15 minutos, você escolhe o horário".',
    nao_precisa: ' Ele acha que não precisa — não force. Plante uma semente: "entendo, se em algum momento quiser entender o perfil de cliente que chegaria, é só me chamar".',
    pessoa_errada: ' Não é o decisor — peça indicação gentilmente: "faz sentido, com quem eu poderia falar sobre isso?".',
    ja_tem_fornecedor: ' Já tem parceiro — não ataque. Diferencie: o Método Projeto Fechado não substitui o que ele já tem, é um canal adicional de clientes qualificados.',
  };

  const base = instrucoes[classificacao] || instrucoes.pedir_mais_info;
  const extra = analise.objecao ? (instrucaoObjecao[analise.objecao] || '') : '';

  const response = await openai.chat.completions.create({
    model: MODEL_WRITING,
    messages: [
      {
        role: 'system',
        content: `Você é Igor, da Assessoria para Lojistas de Móveis / Método Projeto Fechado.
Tom: humano, direto, sem formalidade. Escreva como alguém que conhece bem o setor de planejados.
Máximo 4 frases. WhatsApp — seja natural.`,
      },
      {
        role: 'user',
        content: `CONVERSA:
Você enviou: "${mensagemOriginal}"
Lojista respondeu: "${respostaLead}"

SITUAÇÃO: ${classificacao}${analise.urgencia ? ` | urgência ${analise.urgencia}` : ''}${analise.objecao ? ` | objeção: ${analise.objecao}` : ''}

INSTRUÇÃO: ${base}${extra}

Escreva a resposta:`,
      },
    ],
    temperature: 0.5,
    max_tokens: 200,
  });

  return response.choices[0].message.content.trim();
}

// ─── Score with rules ─────────────────────────────────────────────────────────
async function calcularScoreComRegras(lead, rules) {
  let bonus = 0;
  for (const rule of rules || []) {
    if (!rule.ativo) continue;
    if (rule.evento === 'tem_email' && lead.email) bonus += rule.pontos;
    if (rule.evento === 'respondeu' && lead.status === 'respondeu') bonus += rule.pontos;
    if (rule.evento === 'classificado_interessado' && lead.classificacao === 'interessado') bonus += rule.pontos;
    if (rule.evento === 'muito_interessado' && lead.classificacao === 'muito_interessado') bonus += rule.pontos;
    if (rule.evento === 'agendar' && lead.classificacao === 'agendar') bonus += rule.pontos;
    if (rule.evento === 'respondeu_2x' && (lead.reply_count || 0) >= 2) bonus += rule.pontos;
    if (rule.evento === 'sinal_de_compra' && lead.sinal_de_compra) bonus += rule.pontos;
  }
  return Math.min(100, (lead.score || 0) + bonus);
}

module.exports = {
  gerarMensagem,
  gerarMensagemAB,
  calcularScore,
  analisarResposta,
  gerarRespostaSugerida,
  calcularScoreComRegras,
};
