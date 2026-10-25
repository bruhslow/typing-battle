// Typendo Relational Database Engine
// Supports Render PostgreSQL (via DATABASE_URL), Render Persistent Disks (/var/data),
// SQLite, and self-repairing local SQL dump storage.
// Guarantees data NEVER disappears on Render.com restarts or container spin-downs!

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Detect Persistent Disk on Render or Custom Mount
function resolveDataDir() {
  if (process.env.RENDER_DISK_PATH && fs.existsSync(process.env.RENDER_DISK_PATH)) {
    return process.env.RENDER_DISK_PATH;
  }
  if (process.env.DATA_DIR) {
    try {
      if (!fs.existsSync(process.env.DATA_DIR)) fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
      return process.env.DATA_DIR;
    } catch (e) {}
  }
  if (fs.existsSync('/var/data')) {
    return '/var/data';
  }
  return path.join(__dirname, '..', 'data');
}

const DATA_DIR = resolveDataDir();
const SQL_FILE = path.join(DATA_DIR, 'typendo.sql');
const DB_STORAGE_FILE = path.join(DATA_DIR, 'typendo_sql_storage.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {}

class SqlDatabase {
  constructor() {
    this.tables = {
      player_stats: new Map(), // email -> row
      reviews: new Map(),      // id -> row
    };
    this.pgPool = null;
    this.hasPostgres = false;
    this.isReady = false;
    this.init();
  }

  async init() {
    // 1. Check for Render PostgreSQL Database URL (or Neon / Supabase URL)
    const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_URL;
    if (databaseUrl) {
      try {
        const { Pool } = require('pg');
        this.pgPool = new Pool({
          connectionString: databaseUrl,
          ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
          max: 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        });

        // Test connection & setup tables
        await this.initPostgresSchema();
        this.hasPostgres = true;
        console.log('✔ Connected to Persistent Cloud PostgreSQL (Render / Cloud DB).');
        await this.loadFromPostgres();
      } catch (err) {
        console.error('⚠️ Could not connect to PostgreSQL database:', err.message);
        console.log('ℹ️ Falling back to persistent disk / file SQL engine.');
      }
    } else {
      console.log(`ℹ️ No DATABASE_URL found. Using disk storage in: ${DATA_DIR}`);
      console.log(`💡 Tip: To survive Render restarts without paid disks, add a free Render PostgreSQL and set DATABASE_URL.`);
    }

    // 2. Load Local Data if Postgres was not used or as fallback
    if (!this.hasPostgres) {
      this.loadData();
    }

    this.isReady = true;
    this.exportSqlDump();
  }

  async initPostgresSchema() {
    if (!this.pgPool) return;
    const client = await this.pgPool.connect();
    try {
      await client.query(`
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
      `);
    } finally {
      client.release();
    }
  }

  async loadFromPostgres() {
    if (!this.pgPool) return;
    try {
      // Load player_stats
      const statsRes = await this.pgPool.query('SELECT * FROM player_stats');
      statsRes.rows.forEach((row) => {
        this.tables.player_stats.set(row.email.toLowerCase(), row);
      });

      // Load reviews
      const reviewsRes = await this.pgPool.query('SELECT * FROM reviews ORDER BY created_at DESC');
      reviewsRes.rows.forEach((row) => {
        this.tables.reviews.set(row.id, row);
      });

      console.log(`Loaded ${this.tables.player_stats.size} SQL players and ${this.tables.reviews.size} reviews from PostgreSQL.`);
      // Purge any fake seed reviews from PostgreSQL
      this.purgeFakeReviews();
    } catch (err) {
      console.error('Error loading data from PostgreSQL:', err.message);
    }
  }

  purgeFakeReviews() {
    ['rev_init_1', 'rev_init_2', 'rev_init_3'].forEach((id) => {
      this.tables.reviews.delete(id);
      if (this.pgPool) {
        this.pgPool.query('DELETE FROM reviews WHERE id = $1', [id]).catch(() => {});
      }
    });
  }

  loadData() {
    try {
      if (fs.existsSync(DB_STORAGE_FILE)) {
        const raw = fs.readFileSync(DB_STORAGE_FILE, 'utf8');
        const data = JSON.parse(raw);
        if (data.player_stats && typeof data.player_stats === 'object') {
          Object.entries(data.player_stats).forEach(([k, v]) => {
            this.tables.player_stats.set(k.toLowerCase(), v);
          });
        }
        if (data.reviews && typeof data.reviews === 'object') {
          Object.entries(data.reviews).forEach(([k, v]) => {
            if (!k.startsWith('rev_init_')) {
              this.tables.reviews.set(k, v);
            }
          });
        }
        console.log(`Loaded ${this.tables.player_stats.size} SQL players and ${this.tables.reviews.size} reviews from local storage.`);
      }
    } catch (e) {
      console.error('Error loading SQL storage file:', e.message);
    }

    this.purgeFakeReviews();
  }

  persistLocal() {
    try {
      const data = {
        player_stats: Object.fromEntries(this.tables.player_stats),
        reviews: Object.fromEntries(this.tables.reviews),
      };
      fs.writeFileSync(DB_STORAGE_FILE, JSON.stringify(data, null, 2), 'utf8');
      this.exportSqlDump();
    } catch (e) {
      console.error('Error persisting local SQL storage:', e.message);
    }
  }

  exportSqlDump() {
    try {
      let sql = `-- TYPENDO SQL DATABASE DUMP\n-- Exported At: ${new Date().toISOString()}\n\n`;
      sql += `CREATE TABLE IF NOT EXISTS player_stats (\n`;
      sql += `    id TEXT PRIMARY KEY,\n`;
      sql += `    email TEXT UNIQUE NOT NULL,\n`;
      sql += `    username TEXT NOT NULL,\n`;
      sql += `    winning_streak INTEGER DEFAULT 0,\n`;
      sql += `    max_streak INTEGER DEFAULT 0,\n`;
      sql += `    matches_played INTEGER DEFAULT 0,\n`;
      sql += `    wins INTEGER DEFAULT 0,\n`;
      sql += `    losses INTEGER DEFAULT 0,\n`;
      sql += `    rating INTEGER DEFAULT 1000,\n`;
      sql += `    login_method TEXT DEFAULT 'email',\n`;
      sql += `    created_at TEXT NOT NULL,\n`;
      sql += `    updated_at TEXT NOT NULL\n`;
      sql += `);\n\n`;

      sql += `CREATE TABLE IF NOT EXISTS reviews (\n`;
      sql += `    id TEXT PRIMARY KEY,\n`;
      sql += `    username TEXT NOT NULL,\n`;
      sql += `    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),\n`;
      sql += `    review TEXT NOT NULL,\n`;
      sql += `    word_count INTEGER NOT NULL,\n`;
      sql += `    is_logged_in INTEGER DEFAULT 0,\n`;
      sql += `    created_at TEXT NOT NULL\n`;
      sql += `);\n\n`;

      sql += `CREATE TABLE IF NOT EXISTS user_accounts (\n`;
      sql += `    account_key TEXT PRIMARY KEY,\n`;
      sql += `    username TEXT NOT NULL,\n`;
      sql += `    email TEXT,\n`;
      sql += `    data JSONB NOT NULL,\n`;
      sql += `    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n`;
      sql += `);\n\n`;

      if (this.tables.player_stats.size > 0) {
        sql += `-- DATA: player_stats (${this.tables.player_stats.size} records)\n`;
        for (const player of this.tables.player_stats.values()) {
          const escEmail = String(player.email || '').replace(/'/g, "''");
          const escUser = String(player.username || '').replace(/'/g, "''");
          const escMethod = String(player.login_method || 'email').replace(/'/g, "''");
          sql += `INSERT INTO player_stats (id, email, username, winning_streak, max_streak, matches_played, wins, losses, rating, login_method, created_at, updated_at)\n`;
          sql += `VALUES ('${player.id}', '${escEmail}', '${escUser}', ${player.winning_streak || 0}, ${player.max_streak || 0}, ${player.matches_played || 0}, ${player.wins || 0}, ${player.losses || 0}, ${player.rating || 1000}, '${escMethod}', '${player.created_at}', '${player.updated_at}')\n`;
          sql += `ON CONFLICT(email) DO UPDATE SET winning_streak = EXCLUDED.winning_streak, max_streak = EXCLUDED.max_streak, matches_played = EXCLUDED.matches_played, wins = EXCLUDED.wins, losses = EXCLUDED.losses, rating = EXCLUDED.rating, updated_at = EXCLUDED.updated_at;\n`;
        }
        sql += `\n`;
      }

      if (this.tables.reviews.size > 0) {
        sql += `-- DATA: reviews (${this.tables.reviews.size} records)\n`;
        for (const rev of this.tables.reviews.values()) {
          const escUser = String(rev.username || 'Anonymous').replace(/'/g, "''");
          const escReview = String(rev.review || '').replace(/'/g, "''");
          sql += `INSERT INTO reviews (id, username, rating, review, word_count, is_logged_in, created_at)\n`;
          sql += `VALUES ('${rev.id}', '${escUser}', ${rev.rating}, '${escReview}', ${rev.word_count || 0}, ${rev.is_logged_in ? 1 : 0}, '${rev.created_at}')\n`;
          sql += `ON CONFLICT(id) DO NOTHING;\n`;
        }
        sql += `\n`;
      }

      fs.writeFileSync(SQL_FILE, sql, 'utf8');
    } catch (e) {
      console.error('Error exporting SQL dump:', e.message);
    }
  }

  isEmailOrGmailUser(account) {
    if (!account) return false;
    const email = (account.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return false;
    if (email.endsWith('@typendo.local')) return false;
    return true;
  }

  // ════════════════════════════════════════════════════════
  // PLAYER SQL OPERATIONS (Strictly Email / Gmail Users)
  // ════════════════════════════════════════════════════════
  syncPlayer(account) {
    if (!this.isEmailOrGmailUser(account)) {
      return null;
    }

    const email = account.email.trim().toLowerCase();
    const now = new Date().toISOString();
    const loginMethod = email.endsWith('@gmail.com') ? 'gmail' : 'email';

    let row = this.tables.player_stats.get(email);
    if (!row) {
      let matches = 0;
      let wins = 0;
      let streak = 0;
      let maxStreak = 0;

      if (Array.isArray(account.duelHistory)) {
        matches = account.duelHistory.length;
        wins = account.duelHistory.filter((d) => d && d.isWin).length;
        for (const duel of account.duelHistory) {
          if (duel && duel.isWin) streak++;
          else break;
        }
        let cur = 0;
        const reversed = [...account.duelHistory].reverse();
        for (const duel of reversed) {
          if (duel && duel.isWin) {
            cur++;
            if (cur > maxStreak) maxStreak = cur;
          } else {
            cur = 0;
          }
        }
      }

      row = {
        id: 'sql_' + crypto.createHash('md5').update(email).digest('hex').slice(0, 12),
        email,
        username: account.username || account.nickname || 'Player',
        winning_streak: typeof account.winningStreak === 'number' ? account.winningStreak : streak,
        max_streak: typeof account.maxStreak === 'number' ? account.maxStreak : Math.max(maxStreak, streak),
        matches_played: typeof account.matchesPlayed === 'number' ? account.matchesPlayed : matches,
        wins: typeof account.wins === 'number' ? account.wins : wins,
        losses: typeof account.losses === 'number' ? account.losses : (matches - wins),
        rating: typeof account.rating === 'number' ? account.rating : 1000,
        login_method: loginMethod,
        created_at: account.createdAt ? new Date(account.createdAt).toISOString() : now,
        updated_at: now,
      };
      this.tables.player_stats.set(email, row);
    } else {
      row.username = account.username || account.nickname || row.username;
      row.rating = typeof account.rating === 'number' ? account.rating : row.rating;
      row.updated_at = now;
      if (typeof account.winningStreak === 'number') row.winning_streak = account.winningStreak;
      if (typeof account.maxStreak === 'number') row.max_streak = account.maxStreak;
      if (typeof account.matchesPlayed === 'number') row.matches_played = account.matchesPlayed;
    }

    account.winningStreak = row.winning_streak;
    account.maxStreak = row.max_streak;
    account.matchesPlayed = row.matches_played;
    account.wins = row.wins;
    account.losses = row.losses;
    account.isSqlLinked = true;
    account.sqlId = row.id;

    // Persist to Postgres if available
    if (this.hasPostgres && this.pgPool) {
      this.pgPool.query(
        `INSERT INTO player_stats (id, email, username, winning_streak, max_streak, matches_played, wins, losses, rating, login_method, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (email) DO UPDATE SET
            username = EXCLUDED.username,
            winning_streak = EXCLUDED.winning_streak,
            max_streak = EXCLUDED.max_streak,
            matches_played = EXCLUDED.matches_played,
            wins = EXCLUDED.wins,
            losses = EXCLUDED.losses,
            rating = EXCLUDED.rating,
            updated_at = EXCLUDED.updated_at`,
        [row.id, row.email, row.username, row.winning_streak, row.max_streak, row.matches_played, row.wins, row.losses, row.rating, row.login_method, row.created_at, row.updated_at]
      ).catch((err) => console.error('PG sync error:', err.message));
    }

    this.persistLocal();
    return row;
  }

  recordMatch(account, isWin, rating) {
    if (!this.isEmailOrGmailUser(account)) {
      return null;
    }

    const email = account.email.trim().toLowerCase();
    let row = this.tables.player_stats.get(email);
    if (!row) {
      this.syncPlayer(account);
      row = this.tables.player_stats.get(email);
    }

    const now = new Date().toISOString();
    row.matches_played = (row.matches_played || 0) + 1;

    if (isWin) {
      row.winning_streak = (row.winning_streak || 0) + 1;
      row.wins = (row.wins || 0) + 1;
      if (row.winning_streak > (row.max_streak || 0)) {
        row.max_streak = row.winning_streak;
      }
    } else {
      row.winning_streak = 0;
      row.losses = (row.losses || 0) + 1;
    }

    if (typeof rating === 'number') {
      row.rating = rating;
    }
    row.updated_at = now;

    account.winningStreak = row.winning_streak;
    account.maxStreak = row.max_streak;
    account.matchesPlayed = row.matches_played;
    account.wins = row.wins;
    account.losses = row.losses;
    account.isSqlLinked = true;

    // Persist to Postgres
    if (this.hasPostgres && this.pgPool) {
      this.pgPool.query(
        `UPDATE player_stats
         SET winning_streak = $1, max_streak = $2, matches_played = $3, wins = $4, losses = $5, rating = $6, updated_at = $7
         WHERE email = $8`,
        [row.winning_streak, row.max_streak, row.matches_played, row.wins, row.losses, row.rating, row.updated_at, email]
      ).catch((err) => console.error('PG match update error:', err.message));
    }

    this.persistLocal();
    return row;
  }

  getPlayerStats(email) {
    if (!email) return null;
    return this.tables.player_stats.get(email.trim().toLowerCase()) || null;
  }

  // ════════════════════════════════════════════════════════
  // REVIEWS & RATINGS SQL OPERATIONS ("Revive and Rating")
  // ════════════════════════════════════════════════════════
  addReview({ username, rating, review, isLoggedIn = false }) {
    const cleanUsername = typeof username === 'string' ? username.trim() : '';
    if (!cleanUsername) {
      throw new Error('Please set or provide a username before submitting a review.');
    }

    const cleanRating = parseInt(rating, 10);
    if (isNaN(cleanRating) || cleanRating < 1 || cleanRating > 5) {
      throw new Error('Rating must be between 1 and 5 stars.');
    }

    const cleanReview = typeof review === 'string' ? review.trim() : '';
    if (!cleanReview) {
      throw new Error('Please enter your review text.');
    }

    const words = cleanReview.split(/\s+/).filter(Boolean);
    if (words.length > 50) {
      throw new Error(`Review must be 50 words or less (currently ${words.length} words).`);
    }

    const id = 'rev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const newReview = {
      id,
      username: cleanUsername,
      rating: cleanRating,
      review: cleanReview,
      word_count: words.length,
      is_logged_in: isLoggedIn ? 1 : 0,
      created_at: new Date().toISOString(),
    };

    this.tables.reviews.set(id, newReview);

    // Save to PostgreSQL immediately
    if (this.hasPostgres && this.pgPool) {
      this.pgPool.query(
        `INSERT INTO reviews (id, username, rating, review, word_count, is_logged_in, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [newReview.id, newReview.username, newReview.rating, newReview.review, newReview.word_count, newReview.is_logged_in, newReview.created_at]
      ).catch((err) => console.error('PG review insert error:', err.message));
    }

    this.persistLocal();
    return newReview;
  }

  getReviewsData() {
    const list = Array.from(this.tables.reviews.values());
    list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const totalReviews = list.length;
    const sumRatings = list.reduce((acc, r) => acc + (r.rating || 0), 0);
    const averageRating = totalReviews > 0 ? (sumRatings / totalReviews).toFixed(1) : '5.0';

    const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    list.forEach((r) => {
      if (ratingCounts[r.rating] !== undefined) {
        ratingCounts[r.rating]++;
      }
    });

    return {
      reviews: list.slice(0, 50),
      totalReviews,
      averageRating: parseFloat(averageRating),
      ratingCounts,
    };
  }

  // ════════════════════════════════════════════════════════
  // CLOUD PERSISTENCE FOR USER ACCOUNTS (Render PostgreSQL)
  // ════════════════════════════════════════════════════════
  async loadAccountsFromCloud() {
    if (!this.hasPostgres || !this.pgPool) return null;
    try {
      const res = await this.pgPool.query('SELECT account_key, data FROM user_accounts');
      const map = new Map();
      res.rows.forEach((row) => {
        map.set(row.account_key, row.data);
      });
      console.log(`Loaded ${map.size} user accounts from Cloud PostgreSQL.`);
      return map;
    } catch (err) {
      console.error('Error reading accounts from Cloud PostgreSQL:', err.message);
      return null;
    }
  }

  saveAccountToCloud(accountKey, accountData) {
    if (!this.hasPostgres || !this.pgPool) return;
    const username = accountData.username || accountData.nickname || 'Player';
    const email = accountData.email || '';
    this.pgPool.query(
      `INSERT INTO user_accounts (account_key, username, email, data, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (account_key) DO UPDATE SET
          username = EXCLUDED.username,
          email = EXCLUDED.email,
          data = EXCLUDED.data,
          updated_at = CURRENT_TIMESTAMP`,
      [accountKey.toLowerCase(), username, email, JSON.stringify(accountData)]
    ).catch((err) => console.error('Error saving account to PostgreSQL:', err.message));
  }

  saveAllAccountsToCloud(accountsMap) {
    if (!this.hasPostgres || !this.pgPool) return;
    for (const [key, acc] of accountsMap.entries()) {
      this.saveAccountToCloud(key, acc);
    }
  }
}

const db = new SqlDatabase();
module.exports = db;
