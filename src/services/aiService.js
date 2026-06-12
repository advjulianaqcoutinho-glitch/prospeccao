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

  // Variant A: Curiosity hook (encontrei algo específico no seu perfil)
  // Variant B: Social proof + opportunity (trabalho com lojas do setor e vi que...)
  const estrutura = {
    a: `ESTRUTURA DA MENSAGEM (siga rigorosamente):
1. ABERTURA: "Oi, [nome do responsável ou tudo bem]! Sou o Igor, da Assessoria para Lojistas de Móveis." — natural, sem formalidade
2. CONTEXTO: Em 1 frase: como encontrou a loja (Google, pesquisando em ${cidade || 'sua cidade'})
3. OBSERVAÇÃO ESPECÍFICA: Mencione algo real e concreto que só quem olhou o perfil saberia — use os dados disponíveis (avaliações, site, posição no Maps)
4. GANCHO: "Reparei em algo que pode estar fazendo vocês perderem clientes que já querem comprar..." — não entregue o que é
5. CTA LEVE: Uma pergunta simples de baixo compromisso: "Posso te contar o que encontrei?" ou "Faz sentido conversar?"`,

    b: `ESTRUTURA DA MENSAGEM (siga rigorosamente):
1. ABERTURA: "Oi! Sou o Igor, da Assessoria para Lojistas de Móveis." — direto
2. CREDIBILIDADE: Em 1 frase: mencione que trabalha especificamente com lojas de planejados conectando-as a clientes qualificados
3. OBSERVAÇÃO: Algo específico sobre a loja baseado nos dados reais disponíveis
4. PROPOSTA IMPLÍCITA: "Tenho um perfil de cliente que está ativamente buscando planejados em ${cidade || 'sua cidade'} agora — pessoa em obra, prazo definido — e achei que vocês seriam um bom fit."
5. CTA LEVE: "Você toparia entender como funciona o Método Projeto Fechado?"`,
  };

  const systemPrompt = `Você é Igor, fundador da Assessoria para Lojistas de Móveis e criador do Método Projeto Fechado.

O QUE VOCÊ FAZ:
Você conecta lojas de móveis planejados a clientes qualificados — pessoas que estão ativamente em obra ou reforma, com prazo e budget definidos para fechar o projeto. Não é lead genérico: é cliente que já decidiu comprar, só ainda não escolheu onde.

POSICIONAMENTO:
- Assessoria para Lojistas de Móveis (nome do serviço)
- Método Projeto Fechado (nome do processo/método)
- Foco exclusivo em móveis planejados — você conhece o setor

TOM:
- Humano, direto, sem formalidade excessiva
- Curioso e respeitoso — não invasivo
- Confiante mas não arrogante
- Como alguém que pesquisou e quer ajudar, não como vendedor

REGRAS ABSOLUTAS — NUNCA QUEBRE:
- Máximo 5 frases. WhatsApp não é e-mail.
- NUNCA entregue o pitch completo. A primeira mensagem só deve gerar curiosidade e uma resposta.
- NUNCA use palavras: "prospecção", "tráfego pago", "leads", "marketing digital", "impulsionar"
- NUNCA prometa resultados numéricos na primeira mensagem
- NUNCA use emojis (parece robô)
- Escreva como uma pessoa real escreveria no WhatsApp
- A mensagem deve parecer escrita à mão para essa loja específica — não copiada`;

  const userPrompt = `LOJA-ALVO: "${empresa}"
CIDADE: ${cidade || 'não informada'}
AVALIAÇÃO NO GOOGLE: ${rating ? `${rating}★ com ${review_count || 0} avaliações` : 'sem dados'}
SITE: ${website || 'sem site'}
${endereco ? `ENDEREÇO: ${endereco}` : ''}

ANÁLISE DOS SINAIS DA LOJA:
${analise.sinais.map(s => `• ${s}`).join('\n')}

ÂNGULO ESCOLHIDO: ${analise.anguloEscolhido}
COMO ABORDAR: ${analise.instrucaoAngulo}

${contexto ? `CONTEXTO ADICIONAL: ${contexto}` : ''}

${estrutura[variante] || estrutura.a}

Escreva APENAS o texto da mensagem. Nada mais.`;

  const response = await openai.chat.completions.create({
    model: MODEL_WRITING,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: variante === 'b' ? 0.7 : 0.6,
    max_tokens: 250,
  });

  const mensagem = response.choices[0].message.content.trim();

  // Self-critique
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


// ─── Models ───────────────────────────────────────────────────────────────────
const MODEL_WRITING = 'gpt-4o';       // Best quality for persuasive writing
const MODEL_FAST    = 'gpt-4o-mini';  // Fast + cheap for scoring/classification

// ─── Business signal analysis ─────────────────────────────────────────────────
// Derives persuasion angle from lead's real data before writing the message.
function analisarSinaisDeNegocio({ rating, review_count, website, cidade, endereco, nicho }) {
  const sinais = [];
  const angulos = [];

  // Rating signals
  if (rating >= 4.5) {
    sinais.push(`Empresa bem avaliada (${rating}★) — clientes satisfeitos`);
    angulos.push('escala_qualidade'); // "você já tem qualidade, vamos ampliar o alcance"
  } else if (rating >= 4.0) {
    sinais.push(`Boa reputação (${rating}★) com espaço para crescer`);
    angulos.push('crescimento');
  } else if (rating > 0 && rating < 3.8) {
    sinais.push(`Avaliação abaixo da média (${rating}★) — pode querer reverter isso`);
    angulos.push('reputacao'); // "posso ajudar a melhorar sua imagem"
  }

  // Review count signals
  if (review_count >= 200) {
    sinais.push(`${review_count} avaliações — empresa estabelecida com forte presença`);
    angulos.push('escala_qualidade');
  } else if (review_count >= 50) {
    sinais.push(`${review_count} avaliações — negócio ativo e reconhecido localmente`);
    angulos.push('crescimento');
  } else if (review_count > 0 && review_count < 20) {
    sinais.push(`Apenas ${review_count} avaliações — pouca visibilidade online`);
    angulos.push('visibilidade'); // "você merece ser mais encontrado"
  } else if (review_count === 0) {
    sinais.push('Sem avaliações — invisível para clientes que pesquisam online');
    angulos.push('visibilidade');
  }

  // Website signal
  if (!website) {
    sinais.push('Sem site próprio — perda de credibilidade e clientes online');
    angulos.push('presenca_digital');
  } else {
    sinais.push('Tem site — já investe em presença digital');
  }

  // Location signal
  if (cidade) sinais.push(`Localizado em ${cidade}`);

  // Pick best angle (priority order)
  const prioridade = ['presenca_digital', 'visibilidade', 'reputacao', 'crescimento', 'escala_qualidade'];
  const anguloEscolhido = prioridade.find(a => angulos.includes(a)) || 'crescimento';

  const descricaoAngulo = {
    presenca_digital: 'A empresa não tem site — aborde a oportunidade perdida de captar clientes online e como você pode mudar isso.',
    visibilidade: 'A empresa tem poucas avaliações — aborde como ela está sendo "invisível" para novos clientes que pesquisam no Google/Maps.',
    reputacao: 'A avaliação está abaixo da concorrência — aborde como isso afeta a decisão de novos clientes e como você pode ajudar.',
    crescimento: 'A empresa tem boa base mas pode crescer mais — aborde a expansão do alcance e captação de novos clientes.',
    escala_qualidade: 'A empresa já tem qualidade comprovada — aborde como ela pode escalar resultados e dominar o mercado local.',
  };

  return {
    sinais,
    anguloEscolhido,
    instrucaoAngulo: descricaoAngulo[anguloEscolhido],
  };
}

// ─── Message generation (2-step: analyze → write) ────────────────────────────
async function gerarMensagem(empresa, nicho, contexto, perfil, variante = 'a', dadosEmpresa = {}) {
  const { rating, review_count, website, cidade, endereco } = dadosEmpresa;
  const analise = analisarSinaisDeNegocio({ rating, review_count, website, cidade, endereco, nicho });

  const frameworks = {
    a: {
      nome: 'PAS (Problema → Agitação → Solução)',
      instrucao: `1. Abra tocando em um problema real que o negócio enfrenta (baseado no ângulo: ${analise.anguloEscolhido}).
2. Amplifique brevemente a consequência desse problema (o que ele perde por não resolver).
3. Apresente sua solução de forma direta e específica.
4. Feche com uma pergunta aberta que convide à conversa.`,
    },
    b: {
      nome: 'AIDA (Atenção → Interesse → Desejo → Ação)',
      instrucao: `1. Abra com um fato ou observação específica sobre a empresa que chame atenção.
2. Desperte interesse mostrando uma oportunidade concreta.
3. Crie desejo apresentando o resultado que você entrega (seja específico).
4. Feche com uma call-to-action leve — uma pergunta ou convite de baixo compromisso.`,
    },
  };

  const fw = frameworks[variante] || frameworks.a;

  const systemPrompt = `Você é ${perfil.nome || 'um consultor de marketing'}, representante da empresa "${perfil.empresa || ''}".

SOBRE VOCÊ:
- Empresa: ${perfil.empresa || ''}
- O que você faz: ${perfil.descricao || ''}
- Tom de comunicação: ${perfil.tom_comunicacao || 'profissional e direto'}

REGRAS ABSOLUTAS PARA WHATSAPP:
- Máximo 4 frases curtas. WhatsApp não é e-mail.
- Sem saudações formais como "Prezado" ou "Espero que esteja bem".
- Sem emojis excessivos (máximo 1 por mensagem, apenas se natural).
- Escreva como uma pessoa real, não como um robô ou vendedor chato.
- Nunca mencione "prospecção", "marketing digital" de forma genérica — seja específico.
- A mensagem deve parecer escrita especificamente para esta empresa, não copiada.
- Use o nome da empresa naturalmente no início.`;

  const userPrompt = `EMPRESA-ALVO: "${empresa}"
NICHO: ${nicho}
CIDADE: ${cidade || 'não informada'}
AVALIAÇÃO: ${rating ? `${rating}★ com ${review_count} avaliações` : 'sem dados de avaliação'}
SITE: ${website ? website : 'sem site'}
${endereco ? `ENDEREÇO: ${endereco}` : ''}

ANÁLISE DOS SINAIS:
${analise.sinais.map(s => `• ${s}`).join('\n')}

ÂNGULO DE ABORDAGEM ESCOLHIDO: ${analise.instrucaoAngulo}

CONTEXTO ADICIONAL DA CAMPANHA: ${contexto || 'nenhum'}

FRAMEWORK A USAR: ${fw.nome}
${fw.instrucao}

Escreva a mensagem agora. Apenas o texto da mensagem, sem explicações.`;

  const response = await openai.chat.completions.create({
    model: MODEL_WRITING,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: variante === 'b' ? 0.75 : 0.65,
    max_tokens: 300,
  });

  const mensagem = response.choices[0].message.content.trim();

  // Self-critique: check if message meets quality bar
  const qualidade = await avaliarQualidadeMensagem(mensagem, empresa, nicho, analise.anguloEscolhido);

  // If quality is low, try to improve it once
  if (qualidade.score < 7) {
    const melhorada = await melhorarMensagem(mensagem, qualidade.critica, empresa, nicho, systemPrompt);
    return melhorada;
  }

  return mensagem;
}

// ─── Self-critique: evaluate message quality ──────────────────────────────────
async function avaliarQualidadeMensagem(mensagem, empresa, nicho, angulo) {
  const response = await openai.chat.completions.create({
    model: MODEL_FAST,
    messages: [
      {
        role: 'system',
        content: 'Você é um especialista em copywriting para WhatsApp B2B. Avalie mensagens de prospecção. Retorne apenas JSON.',
      },
      {
        role: 'user',
        content: `Avalie esta mensagem de prospecção para a empresa "${empresa}" (nicho: ${nicho}, ângulo: ${angulo}):

"${mensagem}"

Critérios:
1. Personalização real (não genérica)
2. Clareza da proposta de valor
3. Tom natural para WhatsApp (não robotizado)
4. Tem call-to-action claro
5. Tamanho adequado (não longo demais)

Retorne JSON: { "score": <1-10>, "critica": "<o que melhorar em 1 frase>" }`,
      },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  try {
    return JSON.parse(response.choices[0].message.content);
  } catch {
    return { score: 8, critica: '' };
  }
}

// ─── Improve message based on critique ───────────────────────────────────────
async function melhorarMensagem(mensagemOriginal, critica, empresa, nicho, systemPrompt) {
  const response = await openai.chat.completions.create({
    model: MODEL_WRITING,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Reescreva esta mensagem para a empresa "${empresa}" (nicho: ${nicho}), corrigindo o seguinte problema:
PROBLEMA: ${critica}

MENSAGEM ORIGINAL:
"${mensagemOriginal}"

Escreva apenas a mensagem reescrita, sem explicações.`,
      },
    ],
    temperature: 0.6,
    max_tokens: 300,
  });

  return response.choices[0].message.content.trim();
}

// ─── A/B message generation ──────────────────────────────────────────────────
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

  let aiRelevanceScore = 7; // neutral default
  try {
    const response = await openai.chat.completions.create({
      model: MODEL_FAST,
      messages: [
        {
          role: 'system',
          content: 'You are a sales qualification assistant. Return only JSON.',
        },
        {
          role: 'user',
          content: `Rate the niche "${nicho}" for WhatsApp B2B prospecting suitability (marketing budget availability, online presence potential, receptiveness to new services). Return JSON: {"score": <0-15>}`,
        },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(response.choices[0].message.content);
    aiRelevanceScore = Math.max(0, Math.min(15, parseInt(parsed.score, 10) || 7));
  } catch (err) {
    console.error('[aiService] calcularScore AI relevance error:', err.message);
  }

  return {
    score: Math.min(100, ratingScore + reviewScore + websiteScore + aiRelevanceScore),
    breakdown: {
      rating: ratingScore,
      reviews: reviewScore,
      website: websiteScore,
      nicho_fit: aiRelevanceScore,
    },
  };
}

// ─── Response analysis (deep) ─────────────────────────────────────────────────
async function analisarResposta(mensagemOriginal, resposta) {
  const response = await openai.chat.completions.create({
    model: MODEL_FAST,
    messages: [
      {
        role: 'system',
        content: `Você é um especialista em análise de conversas de prospecção B2B via WhatsApp.
Analise a resposta do lead e retorne um JSON detalhado. Seja preciso — análise errada leva à abordagem errada.`,
      },
      {
        role: 'user',
        content: `Mensagem enviada: "${mensagemOriginal}"
Resposta do lead: "${resposta}"

Retorne JSON com:
{
  "classificacao": "interessado" | "muito_interessado" | "nao_interessado" | "pedir_mais_info" | "agendar",
  "sentimento": "positivo" | "neutro" | "negativo",
  "urgencia": "alta" | "media" | "baixa",
  "objecao": null | "preco" | "tempo" | "nao_precisa" | "pessoa_errada" | "ja_tem_fornecedor",
  "sinal_de_compra": true | false,
  "sugestao": "<próxima ação em 1 frase concreta>"
}

Regras:
- "muito_interessado": lead perguntou preço, pediu reunião, demonstrou urgência
- "interessado": lead respondeu positivamente mas sem urgência clara
- "pedir_mais_info": lead quer entender melhor antes de decidir
- "agendar": lead mencionou explicitamente reunião, call ou agenda
- "nao_interessado": resposta negativa clara ou ignorou a proposta`,
      },
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' },
  });

  let parsed;
  try {
    parsed = JSON.parse(response.choices[0].message.content);
  } catch {
    parsed = {};
  }

  const validClassificacoes = ['interessado', 'muito_interessado', 'nao_interessado', 'pedir_mais_info', 'agendar'];
  if (!validClassificacoes.includes(parsed.classificacao)) {
    parsed.classificacao = 'pedir_mais_info';
  }

  return {
    classificacao: parsed.classificacao,
    sentimento: parsed.sentimento || 'neutro',
    urgencia: parsed.urgencia || 'media',
    objecao: parsed.objecao || null,
    sinal_de_compra: parsed.sinal_de_compra || false,
    sugestao: parsed.sugestao || '',
  };
}

// ─── Suggested reply (with conversation context) ──────────────────────────────
async function gerarRespostaSugerida(mensagemOriginal, respostaLead, classificacao, perfil, analise = {}) {
  const instrucoes = {
    muito_interessado: 'Lead MUITO interessado. Proponha um horário de reunião/call CONCRETO agora. Seja direto e facilite o próximo passo.',
    agendar: 'Lead quer marcar. Ofereça 2 opções de horário concretas (ex: "terça às 10h ou quinta às 15h?"). Não deixe em aberto.',
    interessado: 'Lead interessado. Avance propondo o próximo passo — um diagnóstico gratuito, uma reunião rápida. Mantenha o momentum.',
    pedir_mais_info: 'Lead quer mais informações. Responda de forma consultiva com 1-2 informações valiosas, depois faça uma pergunta para entender a necessidade específica.',
    nao_interessado: 'Lead não interessado. Seja breve, educado, deixe uma porta aberta para o futuro. Não insista. Máximo 2 frases.',
  };

  const instrucaoObjecao = {
    preco: ' A objeção é PREÇO — não argumente valor agora. Pergunte o que seria viável ou proponha uma conversa sem compromisso.',
    tempo: ' A objeção é TEMPO — seja empático. Proponha algo rápido (15 minutos) ou peça permissão para voltar em melhor momento.',
    nao_precisa: ' O lead acha que não precisa — ajude-o a ver a oportunidade que está perdendo com uma pergunta reflexiva.',
    pessoa_errada: ' Não é a pessoa certa — peça gentilmente quem seria o responsável por esse tipo de decisão.',
    ja_tem_fornecedor: ' Já tem fornecedor — não ataque o concorrente. Mostre como você complementa ou supera em algo específico.',
  };

  const contextoObjecao = analise.objecao ? (instrucaoObjecao[analise.objecao] || '') : '';
  const instrucao = (instrucoes[classificacao] || instrucoes.pedir_mais_info) + contextoObjecao;

  const response = await openai.chat.completions.create({
    model: MODEL_WRITING,
    messages: [
      {
        role: 'system',
        content: `Você é ${perfil?.nome || 'um consultor'} da empresa "${perfil?.empresa || ''}".
Tom: ${perfil?.tom_comunicacao || 'profissional'}.
Escreva como uma pessoa real no WhatsApp — curto, natural, sem robotismo. Máximo 3 frases.`,
      },
      {
        role: 'user',
        content: `CONVERSA:
Você enviou: "${mensagemOriginal}"
Lead respondeu: "${respostaLead}"

ANÁLISE: ${classificacao}${analise.urgencia ? ` | urgência: ${analise.urgencia}` : ''}${analise.objecao ? ` | objeção: ${analise.objecao}` : ''}

INSTRUÇÃO: ${instrucao}

Escreva a resposta ideal agora:`,
      },
    ],
    temperature: 0.55,
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
