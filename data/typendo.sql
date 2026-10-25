-- ========================================================
-- TYPENDO SQL DATABASE SCHEMA & SEED DATA
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

-- INITIAL REVIEWS & RATINGS SEED DATA
INSERT INTO reviews (id, username, rating, review, word_count, is_logged_in, created_at)
VALUES 
('rev_init_1', 'SpeedDemon_99', 5, 'The real-time keyboard latency is unbelievable! Solo Practice helped me break 115 WPM in just 2 days. Best typing battle arena on the web.', 24, 1, '2026-10-25T12:00:00.000Z'),
('rev_init_2', 'VortexTypist', 5, 'Ranked duels get intense! Love the live racer tracks and audio effects. The new winning streak tracker makes every match count.', 21, 1, '2026-10-25T18:00:00.000Z'),
('rev_init_3', 'KeyboardRookie', 4, 'Super clean design and love that guests can practice without login. Beautiful UI and smooth animations!', 16, 0, '2026-10-25T21:00:00.000Z')
ON CONFLICT(id) DO NOTHING;
