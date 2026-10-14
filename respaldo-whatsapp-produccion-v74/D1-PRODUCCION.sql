-- Ejecutar una vez en la nueva base D1 de PRODUCCIÓN, vinculada como WHATSAPP_PROD_DB.
-- No ejecutar en la base de pruebas.
CREATE TABLE IF NOT EXISTS whatsapp_prod_messages (
  meta_message_id TEXT PRIMARY KEY,
  message_type TEXT NOT NULL,
  message_text TEXT,
  received_at TEXT NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS whatsapp_prod_messages_processed ON whatsapp_prod_messages(processed, received_at);

CREATE TABLE IF NOT EXISTS whatsapp_prod_sessions (
  session_key TEXT PRIMARY KEY,
  context_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS whatsapp_prod_sessions_expires ON whatsapp_prod_sessions(expires_at);

CREATE TABLE IF NOT EXISTS whatsapp_prod_cart_offers (
  offer_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  product_id TEXT NOT NULL,
  reference TEXT NOT NULL,
  size TEXT NOT NULL,
  quoted_price INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS whatsapp_prod_cart_offers_session ON whatsapp_prod_cart_offers(session_key, expires_at);

CREATE TABLE IF NOT EXISTS whatsapp_prod_cart_items (
  offer_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  product_id TEXT NOT NULL,
  reference TEXT NOT NULL,
  size TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS whatsapp_prod_cart_items_session ON whatsapp_prod_cart_items(session_key, expires_at);

CREATE TABLE IF NOT EXISTS whatsapp_prod_photo_choices (
  choice_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  product_id TEXT NOT NULL,
  reference TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS whatsapp_prod_photo_choices_session ON whatsapp_prod_photo_choices(session_key, expires_at);

CREATE TABLE IF NOT EXISTS wa_inbox_conversations (
 id TEXT PRIMARY KEY, phone TEXT NOT NULL,
 last_inbound INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
 owner_uid TEXT, owner_name TEXT, paused INTEGER NOT NULL DEFAULT 0,
 bot_busy_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS wa_inbox_messages (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
 direction TEXT NOT NULL, kind TEXT NOT NULL, body TEXT,
 created_at INTEGER NOT NULL, staff_uid TEXT, staff_name TEXT,
 status TEXT NOT NULL DEFAULT 'received'
);
CREATE INDEX IF NOT EXISTS wa_inbox_recent ON wa_inbox_messages(conversation_id,created_at);
CREATE TABLE IF NOT EXISTS wa_inbox_audit (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, action TEXT NOT NULL,
 staff_uid TEXT NOT NULL, staff_name TEXT NOT NULL, created_at INTEGER NOT NULL
);
