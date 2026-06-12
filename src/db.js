'use strict';

const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const config = require('./config');

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY, {
  realtime: {
    transport: WebSocket,
  },
});

module.exports = supabase;
