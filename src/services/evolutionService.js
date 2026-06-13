'use strict';

const axios = require('axios');
const supabase = require('../db');
const config = require('../config');

const evolutionApi = axios.create({
  baseURL: config.EVOLUTION_API_URL,
  headers: {
    apikey: config.EVOLUTION_API_KEY,
    'Content-Type': 'application/json',
  },
});

async function getInstances() {
  const { data, error } = await supabase
    .from('whatsapp_instances')
    .select('*')
    .eq('active', true);

  if (error) throw new Error(`getInstances: ${error.message}`);
  return data || [];
}

async function getNextInstance() {
  const instances = await getInstances();

  if (instances.length === 0) throw new Error('No active WhatsApp instances available');

  const available = instances.filter(
    (inst) => (inst.daily_sent || 0) < (inst.daily_limit || 200)
  );

  if (available.length === 0) throw new Error('All instances have reached daily limit');

  available.sort((a, b) => (a.daily_sent || 0) - (b.daily_sent || 0));

  return available[0];
}

async function enviarMensagem(telefone, mensagem, instanceId = null) {
  let instance;

  if (instanceId) {
    const { data, error } = await supabase
      .from('whatsapp_instances')
      .select('*')
      .eq('id', instanceId)
      .single();
    if (error) throw new Error(`enviarMensagem: ${error.message}`);
    instance = data;
  } else {
    instance = await getNextInstance();
  }

  let response;
  try {
    response = await evolutionApi.post(`/message/sendText/${instance.instance_name}`, {
      number: telefone,
      text: mensagem,
    });
  } catch (axiosErr) {
    const detail = axiosErr.response?.data;

    // Detect "number not on WhatsApp" — treat as a special non-retryable error
    const responseArr = detail?.response?.message;
    if (Array.isArray(responseArr) && responseArr[0]?.exists === false) {
      const err = new Error('Número não tem WhatsApp');
      err.code = 'NO_WHATSAPP';
      throw err;
    }

    const msg = typeof detail === 'object' ? JSON.stringify(detail) : (detail || axiosErr.message);
    console.error('[evolutionService] sendText error:', msg);
    throw new Error(`Evolution API: ${msg}`);
  }

  const messageId =
    response.data?.key?.id ||
    response.data?.messageId ||
    response.data?.id ||
    null;

  // Increment daily_sent
  await supabase
    .from('whatsapp_instances')
    .update({ daily_sent: (instance.daily_sent || 0) + 1 })
    .eq('id', instance.id);

  return {
    success: true,
    messageId,
    instanceUsed: instance.id,
  };
}

async function checkStatus(instanceId) {
  const { data: instance, error } = await supabase
    .from('whatsapp_instances')
    .select('instance_name')
    .eq('id', instanceId)
    .single();

  if (error) throw new Error(`checkStatus: ${error.message}`);

  const response = await evolutionApi.get(
    `/instance/connectionState/${instance.instance_name}`
  );

  return response.data;
}

async function resetDailyCounts() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Reset instances where last_reset_at is before today OR null (new instances)
  const { error } = await supabase
    .from('whatsapp_instances')
    .update({ daily_sent: 0, last_reset_at: new Date().toISOString() })
    .or(`last_reset_at.lt.${today.toISOString()},last_reset_at.is.null`);

  if (error) throw new Error(`resetDailyCounts: ${error.message}`);
}

module.exports = { getInstances, getNextInstance, enviarMensagem, checkStatus, resetDailyCounts };
