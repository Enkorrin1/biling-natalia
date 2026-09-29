"""Additive SQLite migration; all bot state survives process restarts."""


def init_bot_schema(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS bot_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK(provider IN ('telegram','max')),
        external_id TEXT NOT NULL, chat_id TEXT NOT NULL,
        display_name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        UNIQUE(provider,external_id), UNIQUE(user_id,provider)
    );
    CREATE TABLE IF NOT EXISTS bot_preferences (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        channel TEXT NOT NULL CHECK(channel IN ('telegram','max','both','off'))
    );
    CREATE TABLE IF NOT EXISTS bot_pairings (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL, expires_at REAL NOT NULL,
        external_id TEXT, chat_id TEXT, display_name TEXT,
        confirmation TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bot_states (
        link_id INTEGER PRIMARY KEY REFERENCES bot_links(id) ON DELETE CASCADE,
        data TEXT NOT NULL, expires_at REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bot_updates (
        provider TEXT NOT NULL, event_id TEXT NOT NULL,
        created_at REAL NOT NULL, PRIMARY KEY(provider,event_id)
    );
    CREATE TABLE IF NOT EXISTS bot_actions (
        token TEXT PRIMARY KEY,
        link_id INTEGER NOT NULL REFERENCES bot_links(id) ON DELETE CASCADE,
        data TEXT NOT NULL, expires_at REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bot_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL, chat_id TEXT NOT NULL,
        link_id INTEGER REFERENCES bot_links(id) ON DELETE CASCADE,
        payload TEXT NOT NULL, context_kind TEXT, context_id INTEGER,
        notification INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        available_at REAL NOT NULL, lease_until REAL, lease_token TEXT,
        last_error TEXT, created_at REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bot_outbox_pending ON bot_outbox(state,available_at,id);
    CREATE TABLE IF NOT EXISTS bot_sent (
        provider TEXT NOT NULL, chat_id TEXT NOT NULL, message_id TEXT NOT NULL,
        link_id INTEGER NOT NULL REFERENCES bot_links(id) ON DELETE CASCADE,
        context_kind TEXT NOT NULL, context_id INTEGER NOT NULL,
        PRIMARY KEY(provider,chat_id,message_id)
    );
    CREATE TABLE IF NOT EXISTS bot_delivery_slots (
        provider TEXT NOT NULL, chat_id TEXT NOT NULL, next_at REAL NOT NULL,
        PRIMARY KEY(provider,chat_id)
    );
    """)
