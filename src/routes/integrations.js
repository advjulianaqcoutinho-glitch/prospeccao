'use strict';

const { Router } = require('express');
const https = require('https');
const supabase = require('../db');
const config = require('../config');

const router = Router();

// GET /meta
router.get('/meta', (req, res) => {
  return res.json({
    pixel_id: config.META_PIXEL_ID,
    has_token: Boolean(config.META_ACCESS_TOKEN),
  });
});

// POST /meta/test
router.post('/meta/test', async (req, res) => {
  const { META_PIXEL_ID, META_ACCESS_TOKEN } = config;
  if (!META_PIXEL_ID || !META_ACCESS_TOKEN) {
    return res.status(400).json({ error: 'Meta CAPI not configured' });
  }

  const eventTime = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    data: [
      {
        event_name: 'Lead',
        event_time: eventTime,
        action_source: 'website',
        user_data: {
          client_ip_address: req.ip || '127.0.0.1',
          client_user_agent: req.headers['user-agent'] || 'test',
        },
      },
    ],
    test_event_code: 'TEST_EVENT',
  });

  const options = {
    hostname: 'graph.facebook.com',
    path: `/v18.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  const result = await new Promise((resolve, reject) => {
    const reqHttp = https.request(options, (r) => {
      let body = '';
      r.on('data', (chunk) => { body += chunk; });
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: r.statusCode, body }); }
      });
    });
    reqHttp.on('error', reject);
    reqHttp.write(payload);
    reqHttp.end();
  });

  // Log event to DB
  await supabase.from('meta_capi_events').insert({
    event_name: 'Lead',
    event_time: new Date(eventTime * 1000).toISOString(),
    response_status: result.status,
    response_body: result.body,
    criado_em: new Date().toISOString(),
  }).select();

  return res.json(result);
});

// GET /meta/events
router.get('/meta/events', async (req, res) => {
  const { data, error } = await supabase
    .from('meta_capi_events')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

module.exports = router;
