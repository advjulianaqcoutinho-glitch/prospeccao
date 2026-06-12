'use strict';

function required(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

function optional(name, defaultValue) {
  return process.env[name] || defaultValue;
}

const config = {
  SUPABASE_URL: required('SUPABASE_URL'),
  SUPABASE_KEY: required('SUPABASE_KEY'),
  OPENAI_API_KEY: required('OPENAI_API_KEY'),
  EVOLUTION_API_URL: required('EVOLUTION_API_URL'),
  EVOLUTION_API_KEY: required('EVOLUTION_API_KEY'),
  EVOLUTION_INSTANCE: required('EVOLUTION_INSTANCE'),
  PORT: parseInt(optional('PORT', '3000'), 10),
  JWT_SECRET: required('JWT_SECRET'),
  META_PIXEL_ID: required('META_PIXEL_ID'),
  META_ACCESS_TOKEN: required('META_ACCESS_TOKEN'),
  BUSINESS_TZ: optional('BUSINESS_TZ', 'America/Sao_Paulo'),
};

module.exports = config;
