-- Tabela de campanhas
create table if not exists campanhas (
  id uuid default gen_random_uuid() primary key,
  nome text not null,
  nicho text not null,
  cidade text not null,
  limite integer default 10,
  contexto text,
  status text default 'criada', -- criada | prospectando | pronta | erro
  criado_em timestamptz default now(),
  atualizado_em timestamptz
);

-- Tabela de leads
create table if not exists leads (
  id uuid default gen_random_uuid() primary key,
  campanha_id uuid references campanhas(id) on delete cascade,
  nome text not null,
  telefone text not null,
  endereco text,
  mensagem_gerada text,
  status text default 'pendente', -- pendente | agendado | enviado | erro
  agendado_para timestamptz,
  enviado_em timestamptz,
  criado_em timestamptz default now(),
  atualizado_em timestamptz
);

-- Índices
create index if not exists leads_campanha_id_idx on leads(campanha_id);
create index if not exists leads_status_idx on leads(status);
create index if not exists leads_agendado_para_idx on leads(agendado_para);
