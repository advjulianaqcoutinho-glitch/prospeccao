'use strict';

const axios = require('axios');
const crypto = require('crypto');
const supabase = require('../db');
const config = require('../config');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

async function sendEvent(eventName, leadData) {
  const { phone, lead_id } = leadData;

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        user_data: {
          ph: [sha256(phone)],
        },
        custom_data: {
          lead_id,
        },
      },
    ],
  };

  const url = `https://graph.facebook.com/v19.0/${config.META_PIXEL_ID}/events`;

  let success = false;
  let responseData = null;
  let errorMsg = null;

  try {
    const response = await axios.post(url, payload, {
      params: { access_token: config.META_ACCESS_TOKEN },
    });
    responseData = response.data;
    success = true;
  } catch (err) {
    errorMsg = err.response?.data || err.message;
    console.error('[metaCapiService] sendEvent error:', errorMsg);
  }

  // Log to meta_capi_events
  await supabase.from('meta_capi_events').insert({
    event_name: eventName,
    lead_id,
    payload,
    success,
    response: responseData || errorMsg,
    attempt_count: 1,
    created_at: new Date().toISOString(),
  });

  return success;
}

async function retryFailed() {
  const { data: failedEvents, error } = await supabase
    .from('meta_capi_events')
    .select('*')
    .eq('success', false)
    .lt('attempt_count', 3);

  if (error) throw new Error(`retryFailed: ${error.message}`);
  if (!failedEvents || failedEvents.length === 0) return;

  for (const event of failedEvents) {
    const url = `https://graph.facebook.com/v19.0/${config.META_PIXEL_ID}/events`;

    let success = false;
    let responseData = null;
    let errorMsg = null;

    try {
      const response = await axios.post(url, event.payload, {
        params: { access_token: config.META_ACCESS_TOKEN },
      });
      responseData = response.data;
      success = true;
    } catch (err) {
      errorMsg = err.response?.data || err.message;
      console.error(`[metaCapiService] retryFailed event ${event.id} error:`, errorMsg);
    }

    await supabase
      .from('meta_capi_events')
      .update({
        success,
        response: responseData || errorMsg,
        attempt_count: (event.attempt_count || 1) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', event.id);
  }
}

module.exports = { sendEvent, retryFailed };
