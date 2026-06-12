-- Performance indexes — run once in Supabase SQL Editor
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_campanha_id ON leads(campanha_id);
CREATE INDEX IF NOT EXISTS idx_leads_telefone_norm ON leads(telefone_normalizado);
CREATE INDEX IF NOT EXISTS idx_leads_kanban_stage ON leads(kanban_stage);
CREATE INDEX IF NOT EXISTS idx_leads_atualizado_em ON leads(atualizado_em DESC);
CREATE INDEX IF NOT EXISTS idx_queue_status ON send_queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_scheduled_at ON send_queue(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_queue_campanha_id ON send_queue(campanha_id);
CREATE INDEX IF NOT EXISTS idx_blacklist_telefone ON blacklist(telefone_normalizado);
CREATE INDEX IF NOT EXISTS idx_interactions_lead_id ON interactions(lead_id);
CREATE INDEX IF NOT EXISTS idx_interactions_type ON interactions(type);
