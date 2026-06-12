-- ============================================================
--  Prospector SaaS — full schema v2
--  Run this on a fresh Supabase project (or against an existing
--  one; all statements are idempotent / IF NOT EXISTS).
-- ============================================================

-- ─── Extensions ───────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ─── Base tables (new) ────────────────────────────────────────────────────────

-- user_profile
create table if not exists user_profile (
  id              uuid default gen_random_uuid() primary key,
  email           text not null unique,
  password_hash   text not null,
  nome            text,
  empresa         text,
  segmento        text,
  descricao       text,
  tom_comunicacao text default 'profissional',
  jwt_secret      text,
  criado_em       timestamptz default now(),
  atualizado_em   timestamptz
);

-- whatsapp_instances
create table if not exists whatsapp_instances (
  id              uuid default gen_random_uuid() primary key,
  instance_name   text not null unique,
  display_name    text,
  active          boolean default true,
  daily_limit     integer default 200,
  daily_sent      integer default 0,
  last_reset_at   timestamptz default now(),
  created_at      timestamptz default now(),
  updated_at      timestamptz
);

-- ─── campanhas (base already exists — apply ALTERs) ───────────────────────────

create table if not exists campanhas (
  id          uuid default gen_random_uuid() primary key,
  nome        text not null,
  nicho       text not null,
  cidade      text not null,
  limite      integer default 10,
  contexto    text,
  status      text default 'criada',
  criado_em   timestamptz default now(),
  atualizado_em timestamptz
);

-- New columns on campanhas (safe to run multiple times)
alter table campanhas add column if not exists business_hours_enabled boolean default false;
alter table campanhas add column if not exists business_hours_start   integer default 8;   -- hour 0-23
alter table campanhas add column if not exists business_hours_end     integer default 18;  -- hour 0-23
alter table campanhas add column if not exists business_days          text[]  default '{"monday","tuesday","wednesday","thursday","friday"}';
alter table campanhas add column if not exists warmup_enabled         boolean default false;
alter table campanhas add column if not exists warmup_day_limit       integer default 20;
alter table campanhas add column if not exists warmup_max_limit       integer default 200;
alter table campanhas add column if not exists ab_testing_enabled     boolean default false;
alter table campanhas add column if not exists meta_capi_enabled      boolean default false;
alter table campanhas add column if not exists whatsapp_instance_id   uuid references whatsapp_instances(id) on delete set null;

-- ─── leads (base already exists — apply ALTERs) ───────────────────────────────

create table if not exists leads (
  id              uuid default gen_random_uuid() primary key,
  campanha_id     uuid references campanhas(id) on delete cascade,
  nome            text not null,
  telefone        text not null,
  endereco        text,
  mensagem_gerada text,
  status          text default 'pendente',
  agendado_para   timestamptz,
  enviado_em      timestamptz,
  criado_em       timestamptz default now(),
  atualizado_em   timestamptz
);

alter table leads add column if not exists telefone_normalizado text;
alter table leads add column if not exists mensagem_variante_b  text;
alter table leads add column if not exists variante_ativa       text default 'a';  -- 'a' | 'b'
alter table leads add column if not exists rating               numeric(3,1);
alter table leads add column if not exists review_count         integer;
alter table leads add column if not exists website              text;
alter table leads add column if not exists google_maps_url      text;
alter table leads add column if not exists cidade               text;
alter table leads add column if not exists nicho                text;
alter table leads add column if not exists score                integer;
alter table leads add column if not exists score_breakdown      jsonb;
alter table leads add column if not exists followup_count       integer default 0;
alter table leads add column if not exists next_followup_at     timestamptz;
alter table leads add column if not exists tags                 text[];

-- ─── followup_sequences ───────────────────────────────────────────────────────

create table if not exists followup_sequences (
  id               uuid default gen_random_uuid() primary key,
  campanha_id      uuid not null references campanhas(id) on delete cascade,
  step_number      integer not null,
  delay_hours      numeric(8,2) not null default 24,  -- hours after previous step
  message_template text,                               -- null = AI-generated
  created_at       timestamptz default now(),
  updated_at       timestamptz,
  unique (campanha_id, step_number)
);

-- ─── interactions ─────────────────────────────────────────────────────────────

create table if not exists interactions (
  id          uuid default gen_random_uuid() primary key,
  lead_id     uuid not null references leads(id) on delete cascade,
  campanha_id uuid references campanhas(id) on delete set null,
  type        text not null,          -- 'message_sent' | 'reply_received' | 'followup_sent' | etc.
  message_id  text,                   -- Evolution/WhatsApp message ID
  instance_id uuid references whatsapp_instances(id) on delete set null,
  payload     jsonb,
  created_at  timestamptz default now()
);

-- ─── lead_notes ───────────────────────────────────────────────────────────────

create table if not exists lead_notes (
  id         uuid default gen_random_uuid() primary key,
  lead_id    uuid not null references leads(id) on delete cascade,
  content    text not null,
  created_by uuid references user_profile(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz
);

-- ─── tags ────────────────────────────────────────────────────────────────────

create table if not exists tags (
  id         uuid default gen_random_uuid() primary key,
  nome       text not null unique,
  cor        text default '#6B7280',
  created_at timestamptz default now()
);

-- ─── lead_tags ───────────────────────────────────────────────────────────────

create table if not exists lead_tags (
  lead_id uuid not null references leads(id) on delete cascade,
  tag_id  uuid not null references tags(id) on delete cascade,
  primary key (lead_id, tag_id)
);

-- ─── blacklist ───────────────────────────────────────────────────────────────

create table if not exists blacklist (
  id                   uuid default gen_random_uuid() primary key,
  telefone             text not null,
  telefone_normalizado text not null unique,
  motivo               text,
  created_at           timestamptz default now()
);

-- ─── ab_test_results ─────────────────────────────────────────────────────────

create table if not exists ab_test_results (
  id          uuid default gen_random_uuid() primary key,
  lead_id     uuid not null references leads(id) on delete cascade,
  campanha_id uuid references campanhas(id) on delete set null,
  variante_a  text,
  variante_b  text,
  winner      text,        -- 'a' | 'b' | null (undecided)
  sent_a      boolean default false,
  sent_b      boolean default false,
  reply_a     text,
  reply_b     text,
  created_at  timestamptz default now(),
  updated_at  timestamptz
);

-- ─── send_time_stats ─────────────────────────────────────────────────────────

create table if not exists send_time_stats (
  id          uuid default gen_random_uuid() primary key,
  nicho       text not null,
  hour        smallint not null check (hour >= 0 and hour <= 23),
  day         smallint not null check (day >= 0 and day <= 6),   -- 0=Sun
  total_sent  integer default 0,
  total_reply integer default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz,
  unique (nicho, hour, day)
);

-- ─── meta_capi_events ────────────────────────────────────────────────────────

create table if not exists meta_capi_events (
  id            uuid default gen_random_uuid() primary key,
  event_name    text not null,
  lead_id       uuid references leads(id) on delete set null,
  payload       jsonb,
  success       boolean default false,
  response      jsonb,
  attempt_count integer default 1,
  created_at    timestamptz default now(),
  updated_at    timestamptz
);

-- ─── send_queue ──────────────────────────────────────────────────────────────

create table if not exists send_queue (
  id             uuid default gen_random_uuid() primary key,
  lead_id        uuid not null references leads(id) on delete cascade,
  campanha_id    uuid references campanhas(id) on delete set null,
  mensagem_id    uuid,                          -- optional FK to a mensagens table
  scheduled_at   timestamptz not null default now(),
  status         text not null default 'pending',   -- 'pending' | 'sent' | 'failed'
  type           text not null default 'prospecting',  -- 'prospecting' | 'followup' | 'scheduled'
  followup_step  integer,
  message_text   text,
  attempt_count  integer default 0,
  last_error     text,
  sent_at        timestamptz,
  created_at     timestamptz default now(),
  updated_at     timestamptz
);

-- ─── integrations ────────────────────────────────────────────────────────────

create table if not exists integrations (
  id         uuid default gen_random_uuid() primary key,
  type       text not null,    -- 'meta_capi' | 'webhook' | etc.
  active     boolean default true,
  config     jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

-- campanhas
create index if not exists campanhas_status_idx on campanhas(status);

-- leads
create index if not exists leads_campanha_id_idx      on leads(campanha_id);
create index if not exists leads_status_idx           on leads(status);
create index if not exists leads_agendado_para_idx    on leads(agendado_para);
create index if not exists leads_next_followup_at_idx on leads(next_followup_at);
create index if not exists leads_telefone_norm_idx    on leads(telefone_normalizado);
create index if not exists leads_score_idx            on leads(score desc);

-- interactions
create index if not exists interactions_lead_id_idx    on interactions(lead_id);
create index if not exists interactions_campanha_id_idx on interactions(campanha_id);
create index if not exists interactions_type_idx       on interactions(type);
create index if not exists interactions_created_at_idx on interactions(created_at desc);

-- send_queue
create index if not exists send_queue_status_sched_idx  on send_queue(status, scheduled_at);
create index if not exists send_queue_lead_id_idx       on send_queue(lead_id);
create index if not exists send_queue_campanha_id_idx   on send_queue(campanha_id);

-- followup_sequences
create index if not exists followup_seq_campanha_idx on followup_sequences(campanha_id);

-- ab_test_results
create index if not exists ab_test_lead_idx on ab_test_results(lead_id);

-- meta_capi_events
create index if not exists meta_capi_success_idx     on meta_capi_events(success);
create index if not exists meta_capi_attempts_idx    on meta_capi_events(attempt_count);
create index if not exists meta_capi_created_at_idx  on meta_capi_events(created_at desc);

-- send_time_stats
create index if not exists send_time_stats_nicho_idx on send_time_stats(nicho);

-- blacklist
create index if not exists blacklist_telefone_norm_idx on blacklist(telefone_normalizado);

-- lead_notes
create index if not exists lead_notes_lead_id_idx on lead_notes(lead_id);

-- lead_tags
create index if not exists lead_tags_tag_id_idx on lead_tags(tag_id);

-- ─── Helper function for send_time_stats upsert ──────────────────────────────

create or replace function upsert_send_time_stats(
  p_nicho text,
  p_hour  smallint,
  p_day   smallint
) returns void language plpgsql as $$
begin
  insert into send_time_stats (nicho, hour, day, total_sent, created_at, updated_at)
  values (p_nicho, p_hour, p_day, 1, now(), now())
  on conflict (nicho, hour, day)
  do update set
    total_sent = send_time_stats.total_sent + 1,
    updated_at = now();
end;
$$;

-- ─── Seed default admin user ─────────────────────────────────────────────────

insert into user_profile (email, password_hash, nome, jwt_secret)
values (
  'admin@prospector.com',
  '$2b$10$placeholder',
  'Admin',
  'change-me-secret'
)
on conflict (email) do nothing;
