-- Indexes para performance — rode no Supabase SQL Editor

-- Leads: queries mais frequentes
CREATE INDEX IF NOT EXISTS leads_campanha_id_idx ON leads(campanha_id);
CREATE INDEX IF NOT EXISTS leads_status_idx ON leads(status);
CREATE INDEX IF NOT EXISTS leads_kanban_stage_idx ON leads(kanban_stage);
CREATE INDEX IF NOT EXISTS leads_telefone_normalizado_idx ON leads(telefone_normalizado);
CREATE INDEX IF NOT EXISTS leads_classificacao_idx ON leads(classificacao);
CREATE INDEX IF NOT EXISTS leads_criado_em_idx ON leads(criado_em DESC);
CREATE INDEX IF NOT EXISTS leads_atualizado_em_idx ON leads(atualizado_em DESC);

-- Composto para filtros combinados
CREATE INDEX IF NOT EXISTS leads_camp_status_idx ON leads(campanha_id, status);
CREATE INDEX IF NOT EXISTS leads_camp_kanban_idx ON leads(campanha_id, kanban_stage);

-- Fila de envios
CREATE INDEX IF NOT EXISTS queue_status_scheduled_idx ON send_queue(status, scheduled_at);
CREATE INDEX IF NOT EXISTS queue_campanha_idx ON send_queue(campanha_id);
CREATE INDEX IF NOT EXISTS queue_lead_idx ON send_queue(lead_id);

-- Interactions: timeline e analytics
CREATE INDEX IF NOT EXISTS interactions_lead_id_idx ON interactions(lead_id);
CREATE INDEX IF NOT EXISTS interactions_type_idx ON interactions(type);
CREATE INDEX IF NOT EXISTS interactions_lead_type_idx ON interactions(lead_id, type);

-- Followup sequences
CREATE INDEX IF NOT EXISTS followup_campanha_idx ON followup_sequences(campanha_id);

-- Blacklist: lookup rápido
CREATE INDEX IF NOT EXISTS blacklist_telefone_idx ON blacklist(telefone_normalizado);

-- Lead tags
CREATE INDEX IF NOT EXISTS lead_tags_lead_idx ON lead_tags(lead_id);
CREATE INDEX IF NOT EXISTS lead_tags_tag_idx ON lead_tags(tag_id);

-- Send time stats
CREATE INDEX IF NOT EXISTS stats_nicho_hour_idx ON send_time_stats(nicho, hour, day);
