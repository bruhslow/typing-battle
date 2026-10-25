-- ========================================================
-- TYPENDO SQL DATABASE SCHEMA
-- Exported At: 2026-10-26T00:00:00.000Z
-- ========================================================

CREATE TABLE IF NOT EXISTS player_stats (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    username TEXT NOT NULL,
    winning_streak INTEGER DEFAULT 0,
    max_streak INTEGER DEFAULT 0,
    matches_played INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    rating INTEGER DEFAULT 1000,
    login_method TEXT DEFAULT 'email',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review TEXT NOT NULL,
    word_count INTEGER NOT NULL,
    is_logged_in INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_accounts (
    account_key TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    email TEXT,
    data JSONB NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
