require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');
const { fork } = require('child_process');
const path = require('path');
const cron = require('node-cron');
const axios = require('axios');
const { WebSocketServer } = require('ws');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

// ─── Clientes externos ───────────────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  { realtime: { transport: WebSocket } }
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EVOLUTION_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE;

// ─── WebSocket broadcast ─────────────────────────────────────────────────────

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

wss.on('connection', ws => {
  console.log('Cliente WebSocket conectado');
  ws.send(JSON.stringify({ tipo: 'conexao', mensagem: 'Conectado ao Prospector' }));
});

// ─── Helpers Evolution API ────────────────────────────────────────────────────

async function enviarWhatsApp(telefone, mensagem) {
  const numero = telefone.replace(/\D/g, '');
  const response = await axios.post(
    `${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
    { number: `55${numero}`, text: mensagem },
    { headers: { apikey: EVOLUTION_KEY } }
  );
  return response.data;
}

// ─── Rotas ────────────────────────────────────────────────────────────────────

// Dashboard
app.get('/api/stats', async (req, res) => {
  try {
    const [campanhas, leads, pendentes, enviados] = await Promise.all([
      supabase.from('campanhas').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'pendente'),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'enviado')
    ]);

    res.json({
      totalCampanhas: campanhas.count || 0,
      totalLeads: leads.count || 0,
      leadsPendentes: pendentes.count || 0,
      leadsEnviados: enviados.count || 0
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Campanhas
app.get('/api/campanhas', async (req, res) => {
  const { data, error } = await supabase
    .from('campanhas')
    .select('*')
    .order('criado_em', { ascending: false });
  if (error) return res.status(500).json({ erro: error.message });
  res.json(data);
});

app.post('/api/campanhas', async (req, res) => {
  const { nome, nicho, cidade, limite, contexto } = req.body;
  if (!nome || !nicho || !cidade) {
    return res.status(400).json({ erro: 'nome, nicho e cidade são obrigatórios' });
  }
  const { data, error } = await supabase
    .from('campanhas')
    .insert({ nome, nicho, cidade, limite: limite || 10, contexto, status: 'criada', criado_em: new Date().toISOString() })
    .select()
    .single();
  if (error) return res.status(500).json({ erro: error.message });
  res.status(201).json(data);
});

app.delete('/api/campanhas/:id', async (req, res) => {
  const { error } = await supabase.from('campanhas').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ erro: error.message });
  res.json({ ok: true });
});

// Leads
app.get('/api/leads', async (req, res) => {
  const { campanha_id, status } = req.query;
  let query = supabase.from('leads').select('*').order('criado_em', { ascending: false });
  if (campanha_id) query = query.eq('campanha_id', campanha_id);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) return res.status(500).json({ erro: error.message });
  res.json(data);
});

app.patch('/api/leads/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('leads')
    .update({ ...req.body, atualizado_em: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ erro: error.message });
  res.json(data);
});

// Prospectar (iniciar scraping)
app.post('/api/prospectar', async (req, res) => {
  const { campanhaId } = req.body;
  if (!campanhaId) return res.status(400).json({ erro: 'campanhaId é obrigatório' });

  const { data: campanha, error } = await supabase
    .from('campanhas')
    .select('*')
    .eq('id', campanhaId)
    .single();

  if (error || !campanha) return res.status(404).json({ erro: 'Campanha não encontrada' });

  await supabase
    .from('campanhas')
    .update({ status: 'prospectando', atualizado_em: new Date().toISOString() })
    .eq('id', campanhaId);

  const child = fork(path.join(__dirname, '..', 'prospector.js'), [
    JSON.stringify({
      campanhaId: campanha.id,
      nicho: campanha.nicho,
      cidade: campanha.cidade,
      limite: campanha.limite,
      contexto: campanha.contexto
    })
  ]);

  child.on('message', data => broadcast(data));
  child.on('error', err => broadcast({ tipo: 'erro', mensagem: err.message }));

  res.json({ ok: true, mensagem: 'Prospecção iniciada' });
});

// Disparar mensagem imediata
app.post('/api/disparar', async (req, res) => {
  const { leadId } = req.body;
  if (!leadId) return res.status(400).json({ erro: 'leadId é obrigatório' });

  const { data: lead, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single();

  if (error || !lead) return res.status(404).json({ erro: 'Lead não encontrado' });

  try {
    await enviarWhatsApp(lead.telefone, lead.mensagem_gerada);
    await supabase
      .from('leads')
      .update({ status: 'enviado', enviado_em: new Date().toISOString() })
      .eq('id', leadId);
    res.json({ ok: true, mensagem: 'Mensagem enviada' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// Agendar mensagem
app.post('/api/agendar', async (req, res) => {
  const { leadId, dataHora } = req.body;
  if (!leadId || !dataHora) return res.status(400).json({ erro: 'leadId e dataHora são obrigatórios' });

  const { error } = await supabase
    .from('leads')
    .update({ status: 'agendado', agendado_para: dataHora, atualizado_em: new Date().toISOString() })
    .eq('id', leadId);

  if (error) return res.status(500).json({ erro: error.message });
  res.json({ ok: true, mensagem: 'Mensagem agendada' });
});

// Status WhatsApp
app.get('/api/whatsapp/status', async (req, res) => {
  try {
    const response = await axios.get(
      `${EVOLUTION_URL}/instance/connectionState/${EVOLUTION_INSTANCE}`,
      { headers: { apikey: EVOLUTION_KEY } }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ erro: err.message, conectado: false });
  }
});

// ─── Cron: envio de mensagens agendadas ──────────────────────────────────────

cron.schedule('* * * * *', async () => {
  const agora = new Date().toISOString();
  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'agendado')
    .lte('agendado_para', agora);

  if (!leads || leads.length === 0) return;

  for (const lead of leads) {
    try {
      await enviarWhatsApp(lead.telefone, lead.mensagem_gerada);
      await supabase
        .from('leads')
        .update({ status: 'enviado', enviado_em: new Date().toISOString() })
        .eq('id', lead.id);
      console.log(`[CRON] Mensagem enviada para ${lead.nome}`);
    } catch (err) {
      console.error(`[CRON] Erro ao enviar para ${lead.nome}:`, err.message);
    }
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Prospector API rodando na porta ${PORT}`);
});
