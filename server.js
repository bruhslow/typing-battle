const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'accounts.json');

try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {}

// Email Transporter Configuration (SMTP or Gmail or Dev Console Fallback)
let mailTransporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  mailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: parseInt(process.env.SMTP_PORT, 10) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  console.log(`Configured SMTP mail transporter (${process.env.SMTP_HOST}).`);
} else if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASS) {
  const cleanPass = String(process.env.GMAIL_APP_PASS).replace(/\s+/g, '');
  const gmailUser = process.env.GMAIL_USER.trim();
  mailTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: gmailUser,
      pass: cleanPass,
    },
    tls: {
      rejectUnauthorized: false,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  console.log(`Configured Gmail SMTP mail transporter (${gmailUser}).`);
} else {
  console.log(`ℹ️ No SMTP env variables found. Email OTP codes will print to terminal console in Development Mode.`);
}

// In-memory Pending OTPs: Map<email, { otp, expiresAt, lastSentAt, attempts, username, country } >
const pendingOtps = new Map();

// Periodic cleanup of expired OTP records and abandoned sessions to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [email, record] of pendingOtps.entries()) {
    if (record.expiresAt < now) {
      pendingOtps.delete(email);
    }
  }
  for (const [friendId, sess] of sessions.entries()) {
    if (sess.expiresAt < now) {
      sessions.delete(friendId);
    }
  }
}, 60000);

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOtpEmail(email, otp, username = 'Typist') {
  const senderEmail = process.env.EMAIL_FROM || (process.env.GMAIL_USER ? `"Typendo Security" <${process.env.GMAIL_USER.trim()}>` : '"Typendo Security" <no-reply@typendo.com>');
  const mailOptions = {
    from: senderEmail,
    to: email,
    subject: `🔐 Your Typendo Login Code: ${otp}`,
    text: `Hello ${username},\n\nYour 6-digit Typendo login verification code is: ${otp}\n\nThis code will expire in 10 minutes. Only use this code if you requested to log in or register on Typendo.\n\n— Typendo Typing Battle Arena`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 28px; background: #0c1017; border-radius: 12px; color: #f0f6fc; border: 1px solid #30363d;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #2ea043; font-size: 24px; margin: 0; letter-spacing: 0.05em;">⚡ TYPENDO</h1>
          <p style="color: #8b949e; font-size: 13px; margin: 4px 0 0;">Real-Time Multiplayer Typing Arena</p>
        </div>
        <div style="background: #161b22; border-radius: 8px; padding: 22px; border: 1px solid #30363d; text-align: center;">
          <p style="font-size: 14px; color: #c9d1d9; margin-top: 0;">Use this one-time verification code to log in to your account:</p>
          <div style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 0.25em; color: #58a6ff; padding: 14px; background: #0d1117; border-radius: 8px; margin: 16px 0; border: 1px dashed #388bfd;">
            ${otp}
          </div>
          <p style="font-size: 12px; color: #8b949e; margin-bottom: 0;">⏱️ Valid for <strong>10 minutes</strong>. Do not share this code with anyone.</p>
        </div>
        <p style="font-size: 11px; color: #6e7681; text-align: center; margin-top: 20px;">If you did not request this login code, you can safely ignore this email.</p>
      </div>
    `,
  };

  console.log(`\n======================================================`);
  console.log(`📩 [TYPENDO EMAIL OTP DISPATCH]`);
  console.log(`Target Email: ${email}`);
  console.log(`6-Digit Code: >>> ${otp} <<< (Valid 10 min)`);
  console.log(`======================================================\n`);

  if (mailTransporter) {
    try {
      await mailTransporter.sendMail(mailOptions);
      console.log(`✔ Email delivered to ${email} via SMTP.`);
      return true;
    } catch (err) {
      console.error(`❌ SMTP delivery error to ${email}:`, err.message);
      return false;
    }
  }
  return true;
}

const rooms = new Map();
const readyMatches = new Map();
const matchmakingQueues = { ranked: { pc: [], phone: [] }, quick: { pc: [], phone: [], cross: [] } };
const friendIds = new Map();
const sessions = new Map();
const ratings = new Map();
const bannedUntil = new Map();
const accounts = new Map();
const PRIVATE_ROOM_LIMIT = 10;
const MAX_RACE_DURATION_SEC = 90; // 1.5 minutes maximum per round
const RACE_FINISH_GRACE_MS = 15000;

// Load persisted accounts if available
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    Object.entries(parsed).forEach(([key, acc]) => {
      accounts.set(key, acc);
    });
    console.log(`Loaded ${accounts.size} persisted user accounts.`);
  }
} catch (e) {
  console.error('Error reading accounts file:', e);
}

// ══════════════════════════════════════════════════════
// ADMIN PRIVILEGES & ROLE MANAGEMENT
// ══════════════════════════════════════════════════════
const ADMIN_EMAILS = [
  'typendootp@gmail.com',
  'giridharandev@gmail.com',
];

const ADMIN_USERNAMES = [
  'admin',
  'giridharan',
  'typendo',
  'typendootp',
];

function isAccountAdmin(acc) {
  if (!acc) return false;
  const email = (acc.email || '').toLowerCase().trim();
  const username = (acc.username || '').toLowerCase().trim();
  if (ADMIN_EMAILS.includes(email)) return true;
  if (ADMIN_USERNAMES.includes(username)) return true;
  if (acc.role === 'admin' || acc.isAdmin === true) return true;
  return false;
}

function formatAccountResponse(acc, accountKey) {
  const isAdmin = isAccountAdmin(acc);
  return {
    clerkId: acc.clerkId || '',
    username: acc.username || 'Player',
    email: acc.email || '',
    country: acc.country || 'IND',
    imageUrl: acc.imageUrl || '',
    rating: typeof acc.rating === 'number' ? acc.rating : 1000,
    role: isAdmin ? 'admin' : (acc.role || 'user'),
    isAdmin,
    hasPassword: Boolean(acc.hash && acc.salt),
    accountKey: accountKey || (acc.username ? acc.username.toLowerCase() : ''),
    createdAt: acc.createdAt || Date.now(),
    duelHistory: Array.isArray(acc.duelHistory) ? acc.duelHistory : [],
    eloHistory: Array.isArray(acc.eloHistory) ? acc.eloHistory : [],
  };
}

function saveAccounts() {
  try {
    const obj = Object.fromEntries(accounts);
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving accounts file:', e);
  }
}

function getGlobalLeaderboard() {
  const list = [];
  accounts.forEach((acc) => {
    const duelHistory = Array.isArray(acc.duelHistory) ? acc.duelHistory : [];
    const pb = duelHistory.length > 0 ? Math.max(0, ...duelHistory.map((d) => (typeof d?.wpm === 'number' && !isNaN(d.wpm) ? d.wpm : 0))) : 0;
    const wins = duelHistory.filter((d) => d && d.isWin).length;
    const matches = duelHistory.length;
    const isAdmin = isAccountAdmin(acc);

    list.push({
      username: acc.username || 'Player',
      country: acc.country || 'IND',
      rating: typeof acc.rating === 'number' ? acc.rating : 1000,
      role: isAdmin ? 'admin' : 'user',
      isAdmin,
      pb,
      wins,
      matches,
      createdAt: acc.createdAt || Date.now(),
    });
  });

  // Sort by rating descending, then wins, then PB
  list.sort((a, b) => (b.rating - a.rating) || (b.wins - a.wins) || (b.pb - a.pb));
  return list.slice(0, 50);
}

function broadcastLeaderboard() {
  io.emit('leaderboardUpdate', getGlobalLeaderboard());
}

const PLAYER_COLORS = [
  { name: 'Mint Green', hex: '#2d8a62', bg: '#eaf7f0' },
  { name: 'Coral Red', hex: '#bd5945', bg: '#fdf0ed' },
  { name: 'Ocean Blue', hex: '#2563eb', bg: '#eff6ff' },
  { name: 'Royal Purple', hex: '#7c3aed', bg: '#f5f3ff' },
  { name: 'Amber Gold', hex: '#d97706', bg: '#fffbeb' },
  { name: 'Teal Emerald', hex: '#0d9488', bg: '#f0fdfa' },
  { name: 'Rose Pink', hex: '#e11d48', bg: '#fff1f2' },
  { name: 'Indigo Violet', hex: '#4f46e5', bg: '#eef2ff' },
  { name: 'Sunset Orange', hex: '#ea580c', bg: '#fff7ed' },
  { name: 'Cyan Sky', hex: '#0891b2', bg: '#ecfeff' },
];

const RACER_TYPES = [
  { id: 'superbike', icon: '🏍️', name: 'Superbike' },
  { id: 'f1car', icon: '🏎️', name: 'F1 Racer' },
  { id: 'rocket', icon: '🚀', name: 'Cosmic Jet' },
  { id: 'horse', icon: '🐎', name: 'Stallion' },
  { id: 'runner', icon: '🏃', name: 'Sprinter' },
  { id: 'ufo', icon: '🛸', name: 'Cyber UFO' },
  { id: 'skater', icon: '🛹', name: 'Pro Skater' },
  { id: 'cheetah', icon: '🐆', name: 'Cheetah' },
  { id: 'dragon', icon: '🐉', name: 'Sky Dragon' },
  { id: 'kart', icon: '🏎️', name: 'Turbo Kart' },
];

const paragraphs = {
  easy: [
    'The quick brown fox jumps over the lazy dog on a bright sunny afternoon. Fast fingers dance across the keys while typing every single word with smooth rhythm and effortless accuracy.',
    'A good idea often starts as a small question with a simple answer. Practice every day to build confidence, muscle memory, and steady typing speed at your keyboard.',
    'Clear skies and a gentle breeze made it a pleasant day for a walk in the quiet park. Birds sang from the green tree branches as sunlight warmed the walking path.',
    'Typing without looking down at the keyboard is called touch typing. When your hands remain relaxed and your eyes stay on the screen, your speed improves naturally.',
    'The morning sun rose slowly above the quiet hills and filled the room with golden light. She poured a warm cup of tea and prepared for a productive day ahead.',
    'Every journey of a thousand miles begins with a single step forward. Small improvements made each day will quickly compound into remarkable achievements over time.',
    'A gentle stream flowed peacefully through the forest valley over smooth river stones. Tall pine trees swayed softly in the wind as the afternoon turned into evening.',
    'Learning to code is like solving a series of fun and creative puzzles. You give clear instructions to the computer and watch your ideas come to life on the screen.',
    'The fresh aroma of baked bread drifted through the open kitchen window. Friends gathered around the wooden dining table to share a delicious meal together.',
    'Keep your focus sharp and your shoulders relaxed during every typing race. Consistency and steady rhythm will always defeat rushed and erratic typing.',
    'The silver airplane soared high above the fluffy white clouds in the bright blue sky. Passengers looked out the windows to see the miniature cities and winding rivers below.',
    'Music filled the room with cheerful melodies and energized everyone for the tournament. Every competitor placed their hands on the mechanical switches and waited for the start signal.',
    'Bright yellow sunflowers turned gracefully toward the afternoon sun in the open country field. Bees buzzed happily among the colorful blossoms throughout the warm summer day.',
    'Working together as a team makes challenging projects much easier and more enjoyable. When everyone contributes their unique strengths, great things can be accomplished.',
    'A calm mind helps you stay centered and accurate when the pressure rises. Take a deep breath, trust your finger placement, and let the words flow naturally.',
    'The ancient library was peaceful and filled with rows of classic books waiting to be explored. Dusty leather covers held timeless stories of adventure and discovery.',
    'The friendly dog wagged its tail with joy when the children returned home from school. They played together in the green backyard until the sunset painted the horizon.',
    'Speed comes naturally once your accuracy is solid and consistent. Focus on striking the correct keys first, and fast pace will follow without extra effort.',
    'A sudden spark of curiosity can inspire bold new discoveries that change the world. Keep exploring, asking thoughtful questions, and seeking out new knowledge every day.',
    'The cozy cabin in the mountains was the perfect retreat after a long week of work. Firewood crackled warmly in the fireplace while snow fell gently outside.'
  ],
  medium: [
    'The morning train arrived just as the first light spread across the station windows. Travelers gathered their bags and stepped into the new day with quiet purpose.',
    'A good idea often starts as a small question. With patience, practice, and a willingness to learn, that question can become something useful for everyone.',
    'Beyond the hill, the river curved through the green valley and reflected the clouds moving slowly across the afternoon sky.',
    'Teamwork is built from clear communication, steady effort, and trust. When people share progress openly, difficult tasks become easier to finish together.',
    'Focus on the small improvements each day. Over time, consistent effort transforms modest beginnings into remarkable achievements.',
    'The ancient clock tower chimed at the stroke of midnight, echoing across the cobbled streets of the sleeping coastal village.',
    'Modern technology allows us to collaborate across vast oceans in real time, connecting creative minds from every corner of the world.',
    'As the autumn leaves turned vibrant shades of gold and crimson, the crisp breeze signaled the arrival of cooler winter months ahead.',
    'Deep in the laboratory, researchers conducted experiments to unlock the mysteries of renewable clean energy for future generations.',
    'Writing elegant software requires both creative imagination and disciplined logic, balancing rapid innovation with rock-solid stability.',
    'The bustling city market was filled with vibrant colors, exotic spices, and the cheerful chatter of merchants and shoppers.',
    'Patience and persistence are essential virtues when mastering any craft, whether you are playing an instrument or learning a new language.',
    'The space telescope captured breathtaking images of distant galaxies, revealing cosmic wonders that had remained hidden for billions of years.',
    'A lighthouse stood resolutely upon the rugged cliffside, guiding weary sailors safely through thick fog and treacherous stormy seas.',
    'Curiosity is the engine of human progress, driving explorers and scientists to venture beyond the boundaries of established knowledge.',
    'The gentle hum of the electric engine and the smooth glide over the highway made for an effortless cross-country road trip.',
    'True craftsmanship is found in the subtle details that most people overlook, where every curve and polished edge reflects dedicated passion.',
    'Reading literature broadens our perspective, allowing us to experience different cultures and walk in the shoes of diverse characters.',
    'The aroma of roasted coffee beans drifted through the open cafe doors, inviting early risers to sit down and enjoy the morning.',
    'In competitive sports and esports, mental resilience under pressure often separates good competitors from true champions.',
    'The botanical garden housed thousands of exotic plant species, creating a lush tropical oasis in the center of the metropolis.',
    'A well-designed user interface should feel effortless and intuitive, anticipating user needs without creating unnecessary friction.',
    'The sunset painted the evening sky in radiant gradients of magenta and gold, casting long shadows across the peaceful harbor.',
    'Discipline is choosing between what you want right now and what you truly want most in the long run.',
    'Behind every successful project lies a series of unseen iterations, failed attempts, and lessons learned through deliberate practice.',
    'The forest trail wound through tall pine trees and over rocky streams, offering hikers a peaceful retreat from the noise of the busy city.',
    'Scientists believe that exploring the ocean floor could reveal species never seen before, hidden in the darkest trenches of the deep sea.',
    'A strong password should contain a mix of uppercase letters, lowercase letters, numbers, and special characters to protect your accounts.',
    'The concert hall was packed with excited fans who had waited months to hear their favorite band perform the songs from the new album.',
    'Learning a new programming language can feel overwhelming at first, but breaking it into smaller daily lessons makes steady progress possible.',
    'The photographer waited patiently by the lake for the perfect moment when the morning mist would lift and reveal the mountain reflection.',
    'Open source software has transformed the technology industry by allowing developers around the world to collaborate freely on shared projects.',
    'Good communication is not just about speaking clearly. It also requires active listening, empathy, and the ability to adapt your message to the audience.',
    'The old bookstore on the corner had wooden shelves filled with rare editions, handwritten notes tucked inside covers, and the smell of aged paper.',
    'Regular exercise improves both physical health and mental focus, helping you stay energized and productive throughout the workday.',
    'The architect designed a building that blended modern glass panels with traditional brick walls, creating a structure that honored both past and future.',
    'Artificial intelligence is being used in healthcare to analyze medical images, predict patient outcomes, and accelerate the discovery of new treatments.',
    'The documentary explored how small farming communities adapted to climate change through innovative irrigation techniques and crop rotation methods.',
    'Every great speaker was once a nervous beginner who practiced relentlessly, learning to control their pace, tone, and body language on stage.',
    'The night sky over the desert was impossibly clear, revealing the dense band of the Milky Way stretching from horizon to horizon.',
  ],
  hard: [
    'Wait, is this real? In 2026, over 85% of developers type at 90+ WPM; however, can you beat the clock? "Practice makes perfect," they say—don\'t give up now!',
    'Let\'s test your speed: 1, 2, 3... Go! Fast fingers, sharp eyes, and zero typos; can you handle colons (:), semicolons (;), and "quotes" under pressure?',
    'Error 404 (Not Found): The requested server responded with status 502; please retry after 30s! Did you save your work, or did it all vanish into thin air?',
    'To master touch typing, follow Rule #1: Never look down! Keep your hands relaxed, strike each key with rhythm (e.g., 100% accuracy), and watch your WPM soar.',
    'function startRace(player1, player2) { const speed = 120; if (speed >= 100) return "Grandmaster!"; else return "Keep practicing..."; }',
    '"To be, or not to be: that is the question;" Shakespeare wrote in Hamlet (Act 3, Scene 1). Do words from 1603 still challenge modern keyboard masters today?',
    'Quick check: Can you type numbers (12, 345, 6789) and symbols ($100, 50%, @user, #winner) without slowing down? It\'s harder than it looks!',
    'The speed test started at 12:00 PM; by 12:01 PM, player_one scored 115 WPM (99.2% accuracy)—an extraordinary feat! Who\'s next in line for the crown?',
    'System alert: CPU load at 94.8%; memory usage: 14.2 GB / 16.0 GB! Run "sudo kill -9 <pid>" immediately, or the entire cluster will crash within 10 seconds.',
    'Life is simple: work hard, stay humble, and type fast! "Success," wrote Winston Churchill, "is walking from failure to failure with no loss of enthusiasm."',
    'Look at this: A mix of short words (it, is, on, at, by), medium words (battle, screen, player), and tricky punctuation (e.g., "quotes", dashes—and symbols!).',
    'Are you ready for the final boss? Level 99 requires 100+ WPM, 0 mistakes, and absolute focus! Press [Enter] to begin—may the fastest fingers win!',
    'In quantum physics, Schrödinger\'s cat is both alive and dead (50/50 probability); similarly, your typing streak is safe until you hit the wrong key!',
    'Breaking news (10:45 AM): Gold prices jumped +3.4% ($2,650/oz), while tech stocks surged 12.8%! Did your portfolio gain $15,000 or lose momentum today?',
    'Here\'s a tricky sentence: "Pack my box with five dozen liquor jugs;" it uses every letter from A to Z, plus tricky punctuation: (1) colons, (2) quotes, & (3) semicolons!'
  ],
};

// ══════════════════════════════════════════════════════
// DYNAMIC LIVE INTERNET QUOTE & SENTENCE INGESTION
// ══════════════════════════════════════════════════════
const onlineParagraphPool = {
  easy: [],
  medium: [],
  hard: [],
};

async function fetchInternetSentences() {
  try {
    // 1. Fetch from DummyJSON Quotes (100 quotes from famous figures, literature, science)
    const res = await fetch('https://dummyjson.com/quotes?limit=100');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.quotes)) {
        for (const q of data.quotes) {
          const text = (q.quote || '').trim().replace(/[\r\n]+/g, ' ');
          if (!text || text.length < 30) continue;
          const wordCount = text.split(/\s+/).length;
          const hasPunctuation = /[;:"'\-—$#%]/.test(text);

          if (wordCount < 18 && !hasPunctuation) {
            onlineParagraphPool.easy.push(text);
          } else if (wordCount <= 35) {
            if (hasPunctuation || wordCount > 25) {
              onlineParagraphPool.hard.push(text);
            } else {
              onlineParagraphPool.medium.push(text);
            }
          } else {
            onlineParagraphPool.hard.push(text);
          }
        }
      }
    }
  } catch (e) {
    // Fallback safely if offline
  }

  const totalLoaded = onlineParagraphPool.easy.length + onlineParagraphPool.medium.length + onlineParagraphPool.hard.length;
  if (totalLoaded > 0) {
    console.log(`🌐 Live Internet Quotes Ingested: ${totalLoaded} dynamic passages added to pool (Easy: ${onlineParagraphPool.easy.length}, Med: ${onlineParagraphPool.medium.length}, Hard: ${onlineParagraphPool.hard.length})`);
  }
}

// Fetch on startup and refresh every 30 minutes
fetchInternetSentences();
setInterval(fetchInternetSentences, 30 * 60 * 1000);

function getRandomParagraph(difficulty = 'medium', lastParagraph = '', mode = 'standard') {
  let staticList = paragraphs[difficulty] || paragraphs.medium;
  let onlineList = onlineParagraphPool[difficulty] || [];

  if (mode === 'ranked') {
    // Ranked mode uses challenging competitive passages with rich vocabulary and punctuation
    staticList = Math.random() > 0.4 ? paragraphs.hard : paragraphs.medium;
    onlineList = Math.random() > 0.4 ? onlineParagraphPool.hard : onlineParagraphPool.medium;
  }

  const combined = [...staticList, ...onlineList];
  const filtered = combined.filter((p) => p !== lastParagraph);
  const pool = filtered.length > 0 ? filtered : combined;
  return pool[Math.floor(Math.random() * pool.length)];
}

const CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY || 'pk_test_c3dlZXQtbW90aC03NjMwLmNsZXJrLmFjY291bnRzLmRldiQ';
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY || 'sk_test_0eGnnOm1hVz9BiwX1f6wdCarx5Y8VM0yHfvrWI99k0';
const CLERK_FRONTEND_API = process.env.CLERK_FRONTEND_API || 'https://sweet-moth-7630.clerk.accounts.dev';

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({
    clerkPublishableKey: CLERK_PUBLISHABLE_KEY,
    clerkFrontendApi: CLERK_FRONTEND_API,
  });
});

app.get('/api/random-quote', (req, res) => {
  const diff = req.query.difficulty || 'medium';
  const mode = req.query.mode || 'standard';
  const quote = getRandomParagraph(diff, '', mode);
  res.json({ quote, difficulty: diff });
});

function getRoomMaxDurationSec(room) {
  if (!room) return 30;
  if (room.mode === 'quick') return 30; // Quick Play is always 30s
  if (room.difficulty === 'hard' || room.difficulty === 'medium') return 30;
  return 60; // Easy custom lobbies / Ranked are 60s
}

function getRandomParagraph(difficulty = 'medium', lastParagraph = '') {
  const list = paragraphs[difficulty] || paragraphs.medium;
  const filtered = list.filter((p) => p !== lastParagraph);
  const pool = filtered.length > 0 ? filtered : list;
  return pool[Math.floor(Math.random() * pool.length)];
}

function broadcastServerStats() {
  const onlineCount = io.engine.clientsCount || io.sockets.sockets.size;
  const activeMatches = [...rooms.values()].filter((r) => r.started && !r.finished).length;
  io.emit('serverStats', { onlineCount, activeMatches });
}

function removeFromQueue(socket) {
  Object.values(matchmakingQueues).forEach((modeQueues) => {
    Object.values(modeQueues).forEach((queue) => {
      const queueIndex = queue.indexOf(socket.id);
      if (queueIndex !== -1) queue.splice(queueIndex, 1);
    });
  });
  if (socket?.data) {
    socket.data.queued = false;
  }
}

function playerInfo(player, fallbackId, fallbackData) {
  if (player) {
    const isRankedAccount = Boolean(player.data?.accountKey && accounts.has(player.data.accountKey));
    const accCountry = player.data?.accountKey && accounts.get(player.data.accountKey)?.country;
    return {
      id: player.id,
      username: player.data?.username || 'Player',
      country: player.data?.country || accCountry || 'IND',
      platform: player.data?.device || player.data?.platform || 'pc',
      rating: getRating(player.id),
      isRanked: isRankedAccount,
    };
  }
  return {
    id: fallbackId || 'disconnected',
    username: fallbackData?.username || 'Player',
    country: fallbackData?.country || 'IND',
    platform: fallbackData?.platform || 'pc',
    rating: fallbackId ? getRating(fallbackId) : 1000,
    isRanked: false,
  };
}

function roomPlayers(room) {
  const playerIds = [...room.players];
  return playerIds
    .map((playerId, index) => {
      const socket = io.sockets.sockets.get(playerId);
      const color = PLAYER_COLORS[index % PLAYER_COLORS.length];
      const racer = RACER_TYPES[index % RACER_TYPES.length];
      const info = playerInfo(socket, playerId);
      return { ...info, color, racer, playerIndex: index };
    })
    .filter(Boolean);
}

function getRating(socketId) {
  const socket = io.sockets.sockets.get(socketId);
  if (socket?.data?.accountKey && accounts.has(socket.data.accountKey)) {
    return accounts.get(socket.data.accountKey).rating;
  }
  return ratings.get(socketId) || 1000;
}

function setRating(socketId, rating) {
  const socket = io.sockets.sockets.get(socketId);
  if (socket?.data?.accountKey && accounts.has(socket.data.accountKey)) {
    accounts.get(socket.data.accountKey).rating = rating;
    saveAccounts();
  } else {
    ratings.set(socketId, rating);
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function passwordMatches(password, account) {
  if (!account || !account.salt || !account.hash || typeof password !== 'string') return false;
  try {
    const attempted = Buffer.from(hashPassword(password, account.salt).hash, 'hex');
    const actual = Buffer.from(account.hash, 'hex');
    if (attempted.length !== actual.length) return false;
    return crypto.timingSafeEqual(attempted, actual);
  } catch (e) {
    return false;
  }
}

function applyRankedPenalty(socket) {
  const currentRating = getRating(socket.id);
  const penalty = 50;
  const until = Date.now() + 60 * 1000;
  setRating(socket.id, Math.max(0, currentRating - penalty));
  bannedUntil.set(socket.id, until);
  socket.emit('rankedPenalty', { rating: getRating(socket.id), bannedUntil: until, seconds: 60 });
  broadcastLeaderboard();
}

function startRace(roomId, countdownMs = 3500) {
  const room = rooms.get(roomId);
  if (!room || room.started || room.players.size < 2) return false;
  
  if (room.finishTimer) {
    clearTimeout(room.finishTimer);
    room.finishTimer = null;
  }
  if (room.maxDurationTimer) {
    clearTimeout(room.maxDurationTimer);
    room.maxDurationTimer = null;
  }

  room.started = true;
  const startTime = Date.now() + countdownMs;
  room.startedAt = startTime;
  room.finishData = new Map();
  room.latestProgress = new Map();
  room.paragraph = getRandomParagraph(room.difficulty, room.lastParagraph || '', room.mode);
  room.lastParagraph = room.paragraph;

  const durationSec = getRoomMaxDurationSec(room);
  const playersList = roomPlayers(room);

  io.to(roomId).emit('raceStarted', {
    paragraph: room.paragraph,
    difficulty: room.difficulty,
    typingMode: room.typingMode || 'standard',
    maxDurationSec: durationSec,
    startTime,
    countdownMs,
    players: playersList,
    mode: room.mode,
  });

  broadcastServerStats();

  room.maxDurationTimer = setTimeout(() => {
    finishRace(roomId, true, `Time limit reached (${durationSec}s)`);
  }, countdownMs + (durationSec * 1000));

  return true;
}

function finishRace(roomId, force = false, reason = '') {
  const room = rooms.get(roomId);
  if (!room || room.finished) return;

  const finishedCount = room.finishData.size;
  const activeCount = room.players.size;

  if (!force && finishedCount < activeCount) {
    if (!room.finishTimer && finishedCount >= 1) {
      io.to(roomId).emit('finishGraceStarted', {
        seconds: Math.round(RACE_FINISH_GRACE_MS / 1000),
      });
      room.finishTimer = setTimeout(() => {
        finishRace(roomId, true, 'Grace period expired');
      }, RACE_FINISH_GRACE_MS);
    }
    return;
  }

  if (room.finishTimer) {
    clearTimeout(room.finishTimer);
    room.finishTimer = null;
  }
  if (room.maxDurationTimer) {
    clearTimeout(room.maxDurationTimer);
    room.maxDurationTimer = null;
  }

  room.finished = true;

  room.players.forEach((playerId) => {
    if (!room.finishData.has(playerId)) {
      const socket = io.sockets.sockets.get(playerId);
      const latest = room.latestProgress?.get(playerId) || {};
      const curProg = Number.isFinite(latest.progress) ? Math.max(0, Math.min(100, latest.progress)) : 0;
      const curWpm = Number.isFinite(latest.wpm) ? Math.max(0, Math.min(300, latest.wpm)) : 0;
      const isDnf = curProg < 5 && curWpm === 0;

      room.finishData.set(playerId, {
        wpm: curWpm,
        errors: 0,
        elapsedMs: latest.elapsedMs || Math.max(1, Date.now() - room.startedAt),
        progress: curProg,
        completed: curProg >= 99,
        dnf: isDnf,
        username: socket?.data?.username || 'Player',
        country: socket?.data?.country || 'IND',
      });
    }
  });

  const results = [...room.finishData.entries()]
    .map(([playerId, data]) => {
      const socket = io.sockets.sockets.get(playerId);
      const info = playerInfo(socket, playerId, data);
      return { ...info, ...data };
    })
    .sort((first, second) => {
      // 1. Disqualified / flagged players ALWAYS lose and rank last
      if (first.disqualified && !second.disqualified) return 1;
      if (!first.disqualified && second.disqualified) return -1;

      // 2. DNF (0 words / space spam / 0% progress) players rank below players with actual progress
      if (first.dnf && !second.dnf) return 1;
      if (!first.dnf && second.dnf) return -1;

      // 3. Completed finishers rank above partial submissions
      const firstDone = Boolean(first.completed || (first.progress && first.progress >= 85));
      const secondDone = Boolean(second.completed || (second.progress && second.progress >= 85));
      if (firstDone && !secondDone) return -1;
      if (!firstDone && secondDone) return 1;

      // 4. If both completed: rank by higher WPM, then fewer errors, then faster time
      if (firstDone && secondDone) {
        if (second.wpm !== first.wpm) return second.wpm - first.wpm;
        if ((first.errors || 0) !== (second.errors || 0)) return (first.errors || 0) - (second.errors || 0);
        return first.elapsedMs - second.elapsedMs;
      }

      // 5. If neither finished: rank by actual progress %, then WPM, then fewer errors
      const firstProg = first.progress || 0;
      const secondProg = second.progress || 0;
      if (secondProg !== firstProg) return secondProg - firstProg;
      if ((second.wpm || 0) !== (first.wpm || 0)) return (second.wpm || 0) - (first.wpm || 0);
      return (first.errors || 0) - (second.errors || 0);
    });

  if (results.length === 0) return;

  // If top player is DNF with 0 progress / disqualified, nobody is awarded winner
  const topResult = results[0];
  const allDnf = results.every(r => r.dnf || (r.progress === 0 && r.wpm === 0) || r.disqualified);
  const winnerId = (!allDnf && !topResult.disqualified && !topResult.dnf && (topResult.progress > 0 || topResult.wpm > 0)) ? topResult.id : null;
  const isWinnerDisqualified = Boolean(topResult.disqualified);

  if (room.mode === 'ranked' && results.length >= 2 && results[0] && results[1] && winnerId) {
    const winner = results[0];
    const loser = results[1];

    if (!isWinnerDisqualified) {
      const winnerRating = getRating(winner.id);
      const loserRating = getRating(loser.id);
      const expectedWinner = 1 / (1 + 10 ** ((loserRating - winnerRating) / 400));
      const change = Math.max(10, Math.round(32 * (1 - expectedWinner)));
      
      setRating(winner.id, winnerRating + change);
      setRating(loser.id, Math.max(0, loserRating - change));
      winner.ratingChange = change;
      loser.ratingChange = -change;
    } else {
      const p1Rating = getRating(winner.id);
      setRating(winner.id, Math.max(0, p1Rating - 50));
      winner.ratingChange = -50;
    }
    results.forEach((result) => {
      result.rating = getRating(result.id);
    });
  }

  // Persist history & stats to accounts of participants
  results.forEach((res) => {
    const pSocket = io.sockets.sockets.get(res.id);
    const accountKey = pSocket?.data?.accountKey;
    if (accountKey && accounts.has(accountKey)) {
      const acc = accounts.get(accountKey);
      if (!acc.duelHistory) acc.duelHistory = [];
      if (!acc.eloHistory) acc.eloHistory = [];
      
      const isWinner = res.id === winnerId;
      const otherPlayer = results.find((r) => r.id !== res.id);

      acc.duelHistory.unshift({
        mode: room.mode || 'quick',
        isWin: isWinner,
        wpm: res.wpm || 0,
        errors: res.errors || 0,
        opponent: otherPlayer?.username || 'Opponent',
        opponentCountry: otherPlayer?.country || 'IND',
        country: res.country || acc.country || 'IND',
        timestamp: Date.now(),
      });
      if (acc.duelHistory.length > 50) acc.duelHistory.pop();

      if (res.ratingChange !== undefined) {
        acc.eloHistory.unshift({
          delta: res.ratingChange,
          rating: res.rating,
          opponent: otherPlayer?.username || 'Rival',
          opponentCountry: otherPlayer?.country || 'IND',
          timestamp: Date.now(),
        });
        if (acc.eloHistory.length > 50) acc.eloHistory.pop();
      }

      saveAccounts();
    }
  });

  io.to(roomId).emit('raceFinished', { winnerId, results, mode: room.mode, reason });
  broadcastServerStats();
  broadcastLeaderboard();
}

function handleReadyTimeout(roomId) {
  const readyState = readyMatches.get(roomId);
  if (!readyState) return;
  readyMatches.delete(roomId);

  readyState.players.forEach((playerId) => {
    const socket = io.sockets.sockets.get(playerId);
    if (!socket) return;
    if (readyState.ready.has(playerId)) {
      socket.emit('matchCancelled', { message: 'Opponent did not ready up in time. Searching again...' });
      const mode = readyState.mode || 'quick';
      const queuePlatform = mode === 'ranked' ? (socket.data?.device === 'phone' ? 'phone' : 'pc') : (['pc', 'phone', 'cross'].includes(socket.data?.platform) ? socket.data.platform : 'pc');
      if (matchmakingQueues[mode] && matchmakingQueues[mode][queuePlatform]) {
        matchmakingQueues[mode][queuePlatform].unshift(socket.id);
        socket.data.queued = true;
        socket.emit('matchmaking', {
          position: 1,
          mode,
          platform: socket.data.platform,
          queuePlatform,
          rating: getRating(socket.id),
        });
        createMatch(mode, queuePlatform);
      }
    } else {
      socket.emit('matchCancelled', { message: 'You failed to accept the match in time.' });
      socket.leave(roomId);
      delete socket.data.roomId;
    }
  });

  rooms.delete(roomId);
  broadcastServerStats();
}

function createQuickMatch() {
  const queuedPlayers = Object.entries(matchmakingQueues.quick).flatMap(([platform, queue]) =>
    (queue || []).map((socketId) => ({ socketId, platform }))
  );
  queuedPlayers.sort((first, second) =>
    (io.sockets.sockets.get(first.socketId)?.data?.queuedAt || 0) - (io.sockets.sockets.get(second.socketId)?.data?.queuedAt || 0)
  );

  while (queuedPlayers.length >= 2) {
    const first = queuedPlayers[0];
    const firstPlayer = io.sockets.sockets.get(first.socketId);
    if (!firstPlayer) {
      queuedPlayers.shift();
      const q = matchmakingQueues.quick[first.platform];
      if (q) {
        const idx = q.indexOf(first.socketId);
        if (idx !== -1) q.splice(idx, 1);
      }
      continue;
    }

    const firstDiff = firstPlayer.data?.difficulty || 'easy';

    // First try to match exact same difficulty (easy vs easy, hard vs hard)
    let secondIndex = queuedPlayers.findIndex((candidate, index) => {
      if (index === 0) return false;
      const candidatePlayer = io.sockets.sockets.get(candidate.socketId);
      if (!candidatePlayer) return false;
      const candidateDiff = candidatePlayer.data?.difficulty || 'easy';
      if (firstDiff !== candidateDiff) return false;
      return (
        first.platform === 'cross' ||
        candidate.platform === 'cross' ||
        (first.platform === candidatePlayer.data?.device && candidate.platform === firstPlayer.data?.device)
      );
    });

    // If waiting and no exact match, pair with compatible platform
    if (secondIndex === -1 && queuedPlayers.length > 2) {
      secondIndex = queuedPlayers.findIndex((candidate, index) => {
        if (index === 0) return false;
        const candidatePlayer = io.sockets.sockets.get(candidate.socketId);
        if (!candidatePlayer) return false;
        return (
          first.platform === 'cross' ||
          candidate.platform === 'cross' ||
          (first.platform === candidatePlayer.data?.device && candidate.platform === firstPlayer.data?.device)
        );
      });
    }

    if (secondIndex === -1) break;

    const second = queuedPlayers[secondIndex];
    const secondPlayer = io.sockets.sockets.get(second.socketId);

    queuedPlayers.splice(secondIndex, 1);
    queuedPlayers.shift();

    [first, second].forEach((item) => {
      const queue = matchmakingQueues.quick[item.platform];
      if (queue) {
        const idx = queue.indexOf(item.socketId);
        if (idx !== -1) queue.splice(idx, 1);
      }
    });

    if (!secondPlayer) {
      if (firstPlayer && matchmakingQueues.quick[first.platform]) {
        matchmakingQueues.quick[first.platform].unshift(first.socketId);
      }
      continue;
    }

    const assignedDiff = firstPlayer.data?.difficulty || secondPlayer.data?.difficulty || 'easy';
    const roomId = `match-quick-${firstPlayer.id}-${secondPlayer.id}`;
    const room = {
      paragraph: null,
      players: new Set([firstPlayer.id, secondPlayer.id]),
      finished: false,
      started: false,
      mode: 'quick',
      difficulty: assignedDiff,
      typingMode: 'standard',
    };
    rooms.set(roomId, room);

    [firstPlayer, secondPlayer].forEach((player) => {
      player.data.roomId = roomId;
      player.data.queued = false;
      player.join(roomId);
    });

    const timeout = setTimeout(() => handleReadyTimeout(roomId), 10000);
    readyMatches.set(roomId, {
      roomId,
      players: new Set([firstPlayer.id, secondPlayer.id]),
      ready: new Set(),
      mode: 'quick',
      timeout,
    });

    firstPlayer.emit('matchReadyCheck', { roomId, opponent: playerInfo(secondPlayer), mode: 'quick', timeoutSec: 10 });
    secondPlayer.emit('matchReadyCheck', { roomId, opponent: playerInfo(firstPlayer), mode: 'quick', timeoutSec: 10 });
  }

  broadcastQueue('quick', 'pc');
  broadcastQueue('quick', 'phone');
  broadcastQueue('quick', 'cross');
}

function createMatch(mode, platform) {
  if (mode === 'quick') {
    createQuickMatch();
    return;
  }
  const queue = matchmakingQueues[mode]?.[platform];
  if (!queue) return;

  while (queue.length >= 2) {
    const firstId = queue.shift();
    const secondId = queue.shift();
    const firstPlayer = io.sockets.sockets.get(firstId);
    const secondPlayer = io.sockets.sockets.get(secondId);

    if (!firstPlayer && !secondPlayer) continue;
    if (firstPlayer && !secondPlayer) {
      queue.unshift(firstId);
      continue;
    }
    if (!firstPlayer && secondPlayer) {
      queue.unshift(secondId);
      continue;
    }
    if (firstPlayer.id === secondPlayer.id) {
      queue.unshift(firstId);
      continue;
    }

    const roomId = `match-${mode}-${firstPlayer.id}-${secondPlayer.id}`;
    const room = {
      paragraph: null,
      players: new Set([firstPlayer.id, secondPlayer.id]),
      finished: false,
      started: false,
      mode,
      difficulty: 'medium',
      typingMode: 'word_strict',
    };
    rooms.set(roomId, room);

    [firstPlayer, secondPlayer].forEach((player) => {
      player.data.roomId = roomId;
      player.data.queued = false;
      player.join(roomId);
    });

    const timeout = setTimeout(() => handleReadyTimeout(roomId), 10000);
    readyMatches.set(roomId, {
      roomId,
      players: new Set([firstPlayer.id, secondPlayer.id]),
      ready: new Set(),
      mode,
      timeout,
    });

    firstPlayer.emit('matchReadyCheck', { roomId, opponent: playerInfo(secondPlayer), mode, timeoutSec: 10 });
    secondPlayer.emit('matchReadyCheck', { roomId, opponent: playerInfo(firstPlayer), mode, timeoutSec: 10 });
  }
  broadcastQueue(mode, platform);
}

function broadcastQueue(mode, platform) {
  const queue = matchmakingQueues[mode]?.[platform];
  if (!queue) return;
  queue.forEach((socketId, index) => {
    const player = io.sockets.sockets.get(socketId);
    if (player) player.emit('queueUpdate', { position: index + 1, waiting: queue.length, mode, platform });
  });
}

function createFriendId() {
  let friendId;
  do {
    friendId = Math.random().toString(36).slice(2, 8).toUpperCase();
  } while (friendIds.has(friendId));
  return friendId;
}

function rotateFriendId(socket) {
  friendIds.delete(socket.data.friendId);
  const friendId = createFriendId();
  friendIds.set(friendId, socket.id);
  socket.data.friendId = friendId;
  socket.emit('friendId', friendId);
}

function getPublicRoomsList() {
  const list = [];
  rooms.forEach((room, id) => {
    if (room.mode === 'custom' && room.isPublic && !room.started) {
      const hostSocket = io.sockets.sockets.get(room.hostId);
      list.push({
        roomId: id,
        roomCode: room.friendCode || id.replace('room-', ''),
        roomName: room.roomName || 'Custom Lobby',
        hostName: hostSocket?.data?.username || 'Host',
        hostCountry: hostSocket?.data?.country || 'IND',
        playerCount: room.players.size,
        maxPlayers: room.maxPlayers || PRIVATE_ROOM_LIMIT,
        difficulty: room.difficulty,
        typingMode: room.typingMode,
        started: room.started,
      });
    }
  });
  return list;
}

function restoreSession(socket, friendId) {
  const session = sessions.get(friendId);
  const room = session?.roomId && rooms.get(session.roomId);
  if (!session || !room || session.expiresAt < Date.now()) return false;
  
  room.players.delete(session.socketId);
  room.players.add(socket.id);
  socket.data.platform = session.platform || 'pc';
  if (room.hostId === session.socketId) room.hostId = socket.id;
  socket.data.friendId = friendId;
  socket.data.username = session.username;
  socket.data.roomId = session.roomId;
  socket.join(session.roomId);
  
  sessions.set(friendId, { ...session, socketId: socket.id, expiresAt: Date.now() + 10 * 60 * 1000 });
  friendIds.set(friendId, socket.id);
  
  const playersList = roomPlayers(room);

  socket.emit('sessionRestored', {
    friendId,
    roomId: session.roomId,
    roomName: room.roomName,
    isPublic: room.isPublic,
    typingMode: room.typingMode,
    mode: room.mode,
    started: room.started,
    difficulty: room.difficulty,
    players: playersList,
    hostId: room.hostId,
    playerCount: room.players.size,
    maxPlayers: PRIVATE_ROOM_LIMIT,
  });

  socket.to(session.roomId).emit('roomUpdate', {
    players: playersList,
    playerCount: room.players.size,
    maxPlayers: PRIVATE_ROOM_LIMIT,
    hostId: room.hostId,
  });

  if (room.started) {
    socket.emit('raceStarted', {
      paragraph: room.paragraph,
      difficulty: room.difficulty,
      typingMode: room.typingMode,
      maxDurationSec: getRoomMaxDurationSec(room),
      startTime: room.startedAt,
      countdownMs: 0,
      players: playersList,
      mode: room.mode,
    });
  }
  return true;
}

function leaveRoom(socket) {
  removeFromQueue(socket);
  const roomId = socket.data?.roomId;
  if (!roomId) return;

  const readyState = readyMatches.get(roomId);
  if (readyState) {
    clearTimeout(readyState.timeout);
    readyMatches.delete(roomId);
  }

  const room = rooms.get(roomId);
  if (room) {
    const leavingUsername = socket.data?.username || 'A player';
    room.players.delete(socket.id);

    if (room.players.size === 0) {
      if (room.finishTimer) clearTimeout(room.finishTimer);
      if (room.maxDurationTimer) clearTimeout(room.maxDurationTimer);
      rooms.delete(roomId);
    } else {
      if (room.hostId === socket.id) {
        room.hostId = room.players.values().next().value;
      }
      const playersList = roomPlayers(room);

      if (room.started && !room.finished && room.players.size === 1) {
        const lastPlayerId = room.players.values().next().value;
        const lastSocket = io.sockets.sockets.get(lastPlayerId);
        if (lastSocket) {
          room.finished = true;
          if (room.finishTimer) clearTimeout(room.finishTimer);
          if (room.maxDurationTimer) clearTimeout(room.maxDurationTimer);
          lastSocket.emit('lastPlayerStandingWin', {
            message: 'You win! All other players left the room.',
          });
        }
      }

      socket.to(roomId).emit('playerLeftRoom', {
        username: leavingUsername,
        playerCount: room.players.size,
        maxPlayers: PRIVATE_ROOM_LIMIT,
        hostId: room.hostId,
        players: playersList,
      });

      socket.to(roomId).emit('roomUpdate', {
        players: playersList,
        playerCount: room.players.size,
        maxPlayers: PRIVATE_ROOM_LIMIT,
        hostId: room.hostId,
      });

      if (room.started && !room.finished) {
        finishRace(roomId);
      }
    }
  }

  socket.leave(roomId);
  delete socket.data.roomId;
  broadcastServerStats();
}

function leaveRoomIntentionally(socket) {
  const roomId = socket.data?.roomId;
  const room = roomId && rooms.get(roomId);
  if (room?.mode === 'ranked' && room.started && !room.finished) applyRankedPenalty(socket);
  leaveRoom(socket);
}

io.on('connection', (socket) => {
  const friendId = createFriendId();
  friendIds.set(friendId, socket.id);
  socket.data.friendId = friendId;
  socket.emit('friendId', friendId);

  // Send real live online statistics & real global leaderboard
  broadcastServerStats();
  socket.emit('leaderboardUpdate', getGlobalLeaderboard());

  socket.on('getLeaderboard', () => {
    socket.emit('leaderboardUpdate', getGlobalLeaderboard());
  });

  socket.on('restoreSession', ({ friendId: savedFriendId, username, accountKey, country }) => {
    if (country && typeof country === 'string') socket.data.country = country.trim().slice(0, 5).toUpperCase();
    if (accountKey && accounts.has(accountKey)) {
      const acc = accounts.get(accountKey);
      socket.data.accountKey = accountKey;
      socket.data.username = acc.username;
      socket.data.country = acc.country || socket.data.country || 'IND';
      socket.emit('authSuccess', {
        username: acc.username,
        email: acc.email,
        country: acc.country || 'IND',
        rating: acc.rating,
        accountKey,
        createdAt: acc.createdAt || Date.now(),
        duelHistory: acc.duelHistory || [],
        eloHistory: acc.eloHistory || [],
      });
    }
    if (restoreSession(socket, savedFriendId)) return;
    if (typeof username === 'string' && username.trim()) socket.data.username = username.trim();
  });

  // ══════════════════════════════════════════════════════
  // CLERK 1-CLICK AUTHENTICATION (Google, etc.)
  // ══════════════════════════════════════════════════════
  socket.on('clerkAuth', ({ clerkId, email, username, firstName, lastName, imageUrl, country }) => {
    if (!clerkId && !email) {
      socket.emit('authError', 'Invalid Clerk authentication credentials.');
      return;
    }

    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const cleanCountry = typeof country === 'string' && country.trim() ? country.trim().slice(0, 5).toUpperCase() : 'IND';

    // Look for existing account by clerkId or by registered email
    let account = null;
    let accountKey = '';

    for (const [key, acc] of accounts.entries()) {
      if ((clerkId && acc.clerkId === clerkId) || (cleanEmail && acc.email && acc.email.toLowerCase() === cleanEmail)) {
        account = acc;
        accountKey = key;
        break;
      }
    }

    if (!account) {
      // Determine display username
      let chosenName = (typeof username === 'string' && username.trim()) ||
                       (firstName && lastName ? `${firstName} ${lastName}`.trim() : '') ||
                       firstName ||
                       (cleanEmail ? cleanEmail.split('@')[0] : 'Player');

      chosenName = chosenName.slice(0, 24).replace(/[^a-zA-Z0-9_ ]/g, '').trim();
      if (chosenName.length < 3) chosenName = 'Player_' + Math.floor(100 + Math.random() * 900);

      // Ensure username uniqueness
      let candidateKey = chosenName.toLowerCase();
      let uniqueName = chosenName;
      let counter = 1;
      while (accounts.has(candidateKey)) {
        uniqueName = `${chosenName.slice(0, 19)}_${counter}`;
        candidateKey = uniqueName.toLowerCase();
        counter++;
      }

      accountKey = candidateKey;
      account = {
        clerkId,
        username: uniqueName,
        email: cleanEmail,
        country: cleanCountry,
        imageUrl: imageUrl || '',
        rating: 1000,
        createdAt: Date.now(),
        duelHistory: [],
        eloHistory: [],
      };
      accounts.set(accountKey, account);
      saveAccounts();
      broadcastLeaderboard();
    } else {
      if (clerkId && !account.clerkId) account.clerkId = clerkId;
      if (imageUrl && !account.imageUrl) account.imageUrl = imageUrl;
      saveAccounts();
    }

    socket.data.accountKey = accountKey;
    socket.data.username = account.username;
    socket.data.country = account.country || 'IND';
    rotateFriendId(socket);

    socket.emit('authSuccess', formatAccountResponse(account, accountKey));
  });

  socket.on('clerkSignOut', () => {
    socket.data.accountKey = null;
    socket.data.username = 'Player_' + Math.floor(100 + Math.random() * 900);
    rotateFriendId(socket);
    socket.emit('authSignedOut');
  });

  // ══════════════════════════════════════════════════════
  // DIRECT USERNAME & PASSWORD REGISTRATION
  // ══════════════════════════════════════════════════════
  socket.on('register', ({ username, password, country, email }) => {
    const cleanUsername = typeof username === 'string' ? username.trim() : '';
    const cleanCountry = typeof country === 'string' && country.trim() ? country.trim().slice(0, 5).toUpperCase() : 'IND';
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!cleanUsername || !/^[a-zA-Z0-9_ ]{3,24}$/.test(cleanUsername)) {
      socket.emit('authError', 'Player name must be 3-24 letters, numbers, or spaces.');
      return;
    }

    if (typeof password !== 'string' || password.length < 6) {
      socket.emit('authError', 'Password must be at least 6 characters long.');
      return;
    }

    const accountKey = cleanUsername.toLowerCase();
    if (accounts.has(accountKey)) {
      socket.emit('authError', `Username "${cleanUsername}" is already taken. Please choose a different name.`);
      return;
    }

    const credentials = hashPassword(password);
    const newAccount = {
      username: cleanUsername,
      email: cleanEmail,
      country: cleanCountry,
      ...credentials,
      rating: 1000,
      createdAt: Date.now(),
      duelHistory: [],
      eloHistory: [],
    };

    accounts.set(accountKey, newAccount);
    saveAccounts();
    broadcastLeaderboard();

    socket.data.accountKey = accountKey;
    socket.data.username = newAccount.username;
    socket.data.country = newAccount.country;
    rotateFriendId(socket);

    socket.emit('authSuccess', formatAccountResponse(newAccount, accountKey));
  });

  // ══════════════════════════════════════════════════════
  // EMAIL OTP REGISTRATION & LOGIN
  // ══════════════════════════════════════════════════════
  socket.on('requestOtp', async ({ email, username, password, country }) => {
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const cleanUsername = typeof username === 'string' ? username.trim() : '';
    const cleanCountry = typeof country === 'string' && country.trim() ? country.trim().slice(0, 5).toUpperCase() : 'IND';

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      socket.emit('authError', 'Please enter a valid email address.');
      return;
    }

    if (!cleanUsername || !/^[a-zA-Z0-9_ ]{3,24}$/.test(cleanUsername)) {
      socket.emit('authError', 'Player name must be 3-24 letters, numbers, or spaces.');
      return;
    }

    if (typeof password !== 'string' || password.length < 6) {
      socket.emit('authError', 'Password must be at least 6 characters long.');
      return;
    }

    // Check if username is already registered (case-insensitive)
    const desiredKey = cleanUsername.toLowerCase();
    if (accounts.has(desiredKey)) {
      socket.emit('authError', `Username "${cleanUsername}" is already taken. Please choose a different name.`);
      return;
    }

    // Check if email is already registered
    const emailExists = [...accounts.values()].some((a) => a.email && a.email.toLowerCase() === cleanEmail);
    if (emailExists) {
      socket.emit('authError', 'This email is already registered. Please use the Log In tab.');
      return;
    }

    const now = Date.now();
    const existingOtp = pendingOtps.get(cleanEmail);
    if (existingOtp && now - existingOtp.lastSentAt < 60000) {
      const waitSec = Math.ceil((60000 - (now - existingOtp.lastSentAt)) / 1000);
      socket.emit('authError', `Please wait ${waitSec}s before requesting a new code.`);
      return;
    }

    const otp = generateOtp();
    const credentials = hashPassword(password);

    pendingOtps.set(cleanEmail, {
      otp,
      expiresAt: now + 10 * 60 * 1000,
      lastSentAt: now,
      attempts: 5,
      username: cleanUsername,
      credentials,
      country: cleanCountry,
    });

    const isSent = await sendOtpEmail(cleanEmail, otp, cleanUsername);

    if (mailTransporter && !isSent) {
      socket.emit('authError', 'Failed to dispatch verification email. Please verify the email address.');
      return;
    }

    socket.emit('otpSent', {
      success: true,
      email: cleanEmail,
      username: cleanUsername,
      cooldownSec: 60,
      message: `6-digit verification code sent to ${cleanEmail}`,
    });
  });

  socket.on('registerDirect', ({ username, email, password, country }) => {
    const cleanUsername = typeof username === 'string' ? username.trim() : '';
    const cleanEmail = typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : `${cleanUsername.toLowerCase()}@typendo.local`;
    const cleanCountry = typeof country === 'string' && country.trim() ? country.trim().slice(0, 5).toUpperCase() : (socket.data.country || 'IND');

    if (!cleanUsername || !/^[a-zA-Z0-9_ ]{3,20}$/.test(cleanUsername)) {
      socket.emit('authError', 'Username must be 3-20 letters, numbers, spaces, or underscores.');
      return;
    }
    if (typeof password !== 'string' || password.length < 6) {
      socket.emit('authError', 'Password must be at least 6 characters.');
      return;
    }

    const accountKey = cleanUsername.toLowerCase();
    if (accounts.has(accountKey)) {
      socket.emit('authError', 'That username is already taken. Please choose another username.');
      return;
    }
    const existingByEmail = [...accounts.values()].find((acc) => acc.email && acc.email.toLowerCase() === cleanEmail && !acc.email.endsWith('@typendo.local'));
    if (existingByEmail) {
      socket.emit('authError', 'An account with that email already exists. Please log in.');
      return;
    }

    const credentials = hashPassword(password);
    const newAccount = {
      username: cleanUsername,
      email: cleanEmail,
      country: cleanCountry,
      ...credentials,
      rating: 1000,
      createdAt: Date.now(),
      duelHistory: [],
      eloHistory: [],
    };

    accounts.set(accountKey, newAccount);
    saveAccounts();
    broadcastLeaderboard();

    socket.data.accountKey = accountKey;
    socket.data.username = newAccount.username;
    socket.data.country = newAccount.country;
    rotateFriendId(socket);

    socket.emit('authSuccess', formatAccountResponse(newAccount, accountKey));
  });

  socket.on('verifyOtp', ({ email, code }) => {
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const cleanCode = typeof code === 'string' ? code.trim() : '';

    if (!cleanEmail || !cleanCode) {
      socket.emit('authError', 'Please enter the 6-digit verification code.');
      return;
    }

    const record = pendingOtps.get(cleanEmail);
    if (!record || Date.now() > record.expiresAt) {
      socket.emit('authError', 'Verification code has expired. Please request a new code.');
      return;
    }

    if (record.attempts <= 0) {
      pendingOtps.delete(cleanEmail);
      socket.emit('authError', 'Too many invalid attempts. Please request a new code.');
      return;
    }

    if (record.otp !== cleanCode) {
      record.attempts--;
      if (record.attempts <= 0) {
        pendingOtps.delete(cleanEmail);
        socket.emit('authError', 'Too many invalid attempts. Please request a new code.');
      } else {
        socket.emit('authError', `Incorrect code. ${record.attempts} attempts remaining.`);
      }
      return;
    }

    // OTP Verified! Finalize account creation
    const accountKey = record.username.toLowerCase();
    if (accounts.has(accountKey)) {
      socket.emit('authError', 'That username was claimed while registering. Please choose another username.');
      return;
    }

    pendingOtps.delete(cleanEmail);

    const newAccount = {
      username: record.username,
      email: cleanEmail,
      country: record.country || 'IND',
      ...record.credentials,
      rating: 1000,
      createdAt: Date.now(),
      duelHistory: [],
      eloHistory: [],
    };

    accounts.set(accountKey, newAccount);
    saveAccounts();
    broadcastLeaderboard();

    socket.data.accountKey = accountKey;
    socket.data.username = newAccount.username;
    socket.data.country = newAccount.country;
    rotateFriendId(socket);

    socket.emit('authSuccess', formatAccountResponse(newAccount, accountKey));
  });

  socket.on('login', ({ identifier, username, email, password }) => {
    const inputIdentifier = typeof identifier === 'string' && identifier.trim()
      ? identifier.trim()
      : (typeof username === 'string' && username.trim() ? username.trim() : (typeof email === 'string' ? email.trim() : ''));
    const lowerIdentifier = inputIdentifier.toLowerCase();

    if (!inputIdentifier || typeof password !== 'string' || !password) {
      socket.emit('authError', 'Please enter your username/email and password.');
      return;
    }

    let account = accounts.get(lowerIdentifier);
    if (!account) {
      account = [...accounts.values()].find((acc) => (acc.email && acc.email.toLowerCase() === lowerIdentifier) || (acc.username && acc.username.toLowerCase() === lowerIdentifier));
    }
    if (!account || !passwordMatches(password, account)) {
      socket.emit('authError', 'Incorrect username/email or password.');
      return;
    }
    const accountKey = account.username.toLowerCase();
    socket.data.accountKey = accountKey;
    socket.data.username = account.username;
    socket.data.country = account.country || 'IND';
    rotateFriendId(socket);
    socket.emit('authSuccess', formatAccountResponse(account, accountKey));
  });

  // Profile update handler: change display name, country and/or password
  socket.on('updateProfile', ({ newUsername, newCountry, currentPassword, newPassword }) => {
    const accountKey = socket.data.accountKey;
    if (!accountKey || !accounts.has(accountKey)) {
      socket.emit('profileError', 'You must be logged in to update your profile.');
      return;
    }

    const account = accounts.get(accountKey);

    if (newCountry && typeof newCountry === 'string') {
      account.country = newCountry.trim().slice(0, 5).toUpperCase();
      socket.data.country = account.country;
    }

    if (newUsername && typeof newUsername === 'string') {
      const cleanName = newUsername.trim();
      if (!/^[a-zA-Z0-9_ ]{3,24}$/.test(cleanName)) {
        socket.emit('profileError', 'Username must be 3-24 alphanumeric characters.');
        return;
      }
      const newKey = cleanName.toLowerCase();
      if (newKey !== accountKey && accounts.has(newKey)) {
        socket.emit('profileError', `Username "${cleanName}" is already taken by another player.`);
        return;
      }

      account.username = cleanName;
      if (newKey !== accountKey) {
        accounts.delete(accountKey);
        accounts.set(newKey, account);
        socket.data.accountKey = newKey;
      }
      socket.data.username = cleanName;
    }

    if (currentPassword && newPassword) {
      if (typeof newPassword !== 'string' || newPassword.length < 6) {
        socket.emit('profileError', 'New password must be at least 6 characters.');
        return;
      }
      if (!passwordMatches(currentPassword, account)) {
        socket.emit('profileError', 'Current password is incorrect.');
        return;
      }
      const credentials = hashPassword(newPassword);
      account.salt = credentials.salt;
      account.hash = credentials.hash;
    }

    saveAccounts();
    broadcastLeaderboard();

    socket.emit('profileUpdated', formatAccountResponse(account, socket.data.accountKey));
  });

  // Setup credentials after Google SSO or Email verification
  socket.on('setupCredentials', ({ username, password, country }) => {
    const accountKey = socket.data.accountKey;
    if (!accountKey || !accounts.has(accountKey)) {
      socket.emit('authError', 'You must be logged in to configure your credentials.');
      return;
    }

    const account = accounts.get(accountKey);
    const cleanName = typeof username === 'string' ? username.trim() : '';

    if (cleanName) {
      if (!/^[a-zA-Z0-9_ ]{3,24}$/.test(cleanName)) {
        socket.emit('authError', 'Username must be 3-24 alphanumeric characters or underscores.');
        return;
      }
      const newKey = cleanName.toLowerCase();
      if (newKey !== accountKey && accounts.has(newKey)) {
        socket.emit('authError', `Username "${cleanName}" is already taken by another player.`);
        return;
      }
      if (newKey !== accountKey) {
        accounts.delete(accountKey);
        account.username = cleanName;
        accounts.set(newKey, account);
        socket.data.accountKey = newKey;
      } else {
        account.username = cleanName;
      }
      socket.data.username = cleanName;
    }

    if (country && typeof country === 'string') {
      account.country = country.trim().slice(0, 5).toUpperCase();
      socket.data.country = account.country;
    }

    if (password && typeof password === 'string') {
      if (password.length < 6) {
        socket.emit('authError', 'Password must be at least 6 characters.');
        return;
      }
      const credentials = hashPassword(password);
      account.salt = credentials.salt;
      account.hash = credentials.hash;
    }

    saveAccounts();
    broadcastLeaderboard();
    socket.emit('authSuccess', formatAccountResponse(account, socket.data.accountKey));
  });

  // ══════════════════════════════════════════════════════
  // ADMIN PANEL CONTROLS & REAL-TIME ANNOUNCEMENTS
  // ══════════════════════════════════════════════════════
  socket.on('adminBroadcast', ({ message }) => {
    const acc = socket.data.accountKey ? accounts.get(socket.data.accountKey) : null;
    if (!acc || !isAccountAdmin(acc)) {
      socket.emit('authError', 'Access denied: Admin privileges required.');
      return;
    }
    const cleanMsg = typeof message === 'string' ? message.trim() : '';
    if (!cleanMsg) return;

    io.emit('serverAnnouncement', {
      sender: acc.username,
      message: cleanMsg,
      timestamp: Date.now(),
    });
  });

  socket.on('adminGetServerMetrics', () => {
    const acc = socket.data.accountKey ? accounts.get(socket.data.accountKey) : null;
    if (!acc || !isAccountAdmin(acc)) {
      socket.emit('authError', 'Access denied: Admin privileges required.');
      return;
    }
    const onlineCount = io.engine.clientsCount || io.sockets.sockets.size;
    const activeRooms = [...rooms.entries()].map(([roomId, r]) => {
      const playerNames = (r.players instanceof Set || Array.isArray(r.players))
        ? [...r.players].map((pId) => {
            const playerSocket = io.sockets.sockets.get(pId);
            if (playerSocket?.data?.name) return playerSocket.data.name;
            if (playerSocket?.data?.accountKey && accounts.has(playerSocket.data.accountKey)) {
              return accounts.get(playerSocket.data.accountKey).username;
            }
            return `Player (${String(pId).slice(0, 5)})`;
          })
        : [];
      return {
        id: roomId,
        roomName: r.roomName || roomId,
        mode: r.mode || 'quick',
        difficulty: r.difficulty || 'easy',
        players: playerNames,
        playerCount: playerNames.length,
        started: !!r.started,
        finished: !!r.finished,
      };
    });
    const totalUsers = accounts.size;

    socket.emit('adminMetricsData', {
      onlineCount,
      activeRooms,
      totalUsers,
      uptimeSec: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    });
  });

  socket.on('setCountry', (country) => {
    if (typeof country === 'string' && country.trim()) {
      const code = country.trim().slice(0, 5).toUpperCase();
      socket.data.country = code;
      if (socket.data.accountKey && accounts.has(socket.data.accountKey)) {
        accounts.get(socket.data.accountKey).country = code;
        saveAccounts();
        broadcastLeaderboard();
      }
      socket.emit('countryUpdated', code);
    }
  });

  socket.on('logout', () => {
    delete socket.data.accountKey;
    socket.emit('loggedOut');
  });

  socket.on('setUsername', (data) => {
    let name = '';
    let country = '';
    if (typeof data === 'object' && data !== null) {
      name = data.username;
      country = data.country;
    } else if (typeof data === 'string') {
      name = data;
    }
    if (typeof name === 'string' && name.trim()) {
      let cleanName = name.trim().slice(0, 24);
      const targetKey = cleanName.toLowerCase();
      
      // If user is already logged in with an account, preserve their registered username
      if (socket.data.accountKey && accounts.has(socket.data.accountKey)) {
        cleanName = accounts.get(socket.data.accountKey).username;
      } else {
        // For guests: if requested name belongs to a registered account, or another active connected guest, ensure uniqueness
        const isRegistered = accounts.has(targetKey);
        const otherConnected = [...io.sockets.sockets.values()].some((s) => s.id !== socket.id && s.data?.username && s.data.username.toLowerCase() === targetKey);
        if (isRegistered || otherConnected) {
          cleanName = `${cleanName}_${Math.floor(100 + Math.random() * 900)}`;
        }
      }

      socket.data.username = cleanName;
      socket.emit('usernameUpdated', socket.data.username);
    }
    if (typeof country === 'string' && country.trim()) {
      socket.data.country = country.trim().slice(0, 5).toUpperCase();
      socket.emit('countryUpdated', socket.data.country);
    }
    const session = socket.data.friendId && sessions.get(socket.data.friendId);
    if (session) sessions.set(socket.data.friendId, { ...session, username: socket.data.username, country: socket.data.country });
  });

  socket.on('playerReady', ({ roomId }) => {
    const readyState = readyMatches.get(roomId);
    if (!readyState || !readyState.players.has(socket.id)) return;

    readyState.ready.add(socket.id);
    io.to(roomId).emit('playerReadyStatus', {
      playerId: socket.id,
      readyCount: readyState.ready.size,
      totalCount: readyState.players.size,
    });

    if (readyState.ready.size === readyState.players.size) {
      clearTimeout(readyState.timeout);
      readyMatches.delete(roomId);
      startRace(roomId, 3000);
    }
  });

  socket.on('skipMatch', ({ roomId }) => {
    const readyState = readyMatches.get(roomId);
    if (!readyState || !readyState.players.has(socket.id)) return;

    // Rule: Skip opponent is strictly forbidden in ranked mode
    if (readyState.mode === 'ranked') {
      socket.emit('errorMessage', 'Opponents cannot be skipped in Ranked mode.');
      return;
    }

    clearTimeout(readyState.timeout);
    readyMatches.delete(roomId);
    rooms.delete(roomId);

    // Skipping player leaves match and re-queues
    socket.leave(roomId);
    delete socket.data.roomId;
    socket.emit('matchCancelled', { message: 'You skipped this opponent. Searching for a new rival...' });

    const mode = readyState.mode || 'quick';
    const queuePlatform = ['pc', 'phone', 'cross'].includes(socket.data?.platform) ? socket.data.platform : 'pc';
    if (matchmakingQueues[mode] && matchmakingQueues[mode][queuePlatform]) {
      matchmakingQueues[mode][queuePlatform].push(socket.id);
      socket.data.queued = true;
      socket.emit('matchmaking', {
        position: matchmakingQueues[mode][queuePlatform].length,
        mode,
        platform: socket.data.platform,
        queuePlatform,
        rating: getRating(socket.id),
      });
      createMatch(mode, queuePlatform);
    }

    // Other player is informed and priority re-queued
    readyState.players.forEach((otherId) => {
      if (otherId === socket.id) return;
      const otherSocket = io.sockets.sockets.get(otherId);
      if (!otherSocket) return;
      otherSocket.leave(roomId);
      delete otherSocket.data.roomId;
      otherSocket.emit('matchCancelled', { message: 'Opponent skipped the match. Finding you a new rival...' });

      const otherPlatform = ['pc', 'phone', 'cross'].includes(otherSocket.data?.platform) ? otherSocket.data.platform : 'pc';
      if (matchmakingQueues[mode] && matchmakingQueues[mode][otherPlatform]) {
        matchmakingQueues[mode][otherPlatform].unshift(otherSocket.id);
        otherSocket.data.queued = true;
        otherSocket.emit('matchmaking', {
          position: 1,
          mode,
          platform: otherSocket.data.platform,
          queuePlatform: otherPlatform,
          rating: getRating(otherSocket.id),
        });
        createMatch(mode, otherPlatform);
      }
    });
  });

  socket.on('getPublicRooms', () => {
    socket.emit('publicRoomsList', getPublicRoomsList());
  });

  socket.on('createCustomRoom', ({ username, country, roomName, isPublic = false, difficulty = 'medium', typingMode = 'standard', platform = 'pc', device = 'pc' }) => {
    if (typeof username === 'string' && username.trim()) socket.data.username = username.trim().slice(0, 24);
    if (typeof country === 'string' && country.trim()) socket.data.country = country.trim().slice(0, 5).toUpperCase();
    leaveRoom(socket);
    removeFromQueue(socket);
    socket.data.platform = ['pc', 'phone'].includes(platform) ? platform : 'pc';
    socket.data.device = ['pc', 'phone'].includes(device) ? device : 'pc';
    
    const friendCode = createFriendId();
    const roomId = `room-${friendCode}`;
    const cleanRoomName = typeof roomName === 'string' && roomName.trim() ? roomName.trim().slice(0, 30) : `${socket.data.username || 'Player'}'s Room`;
    
    const room = {
      paragraph: null,
      players: new Set([socket.id]),
      finished: false,
      started: false,
      hostId: socket.id,
      friendCode,
      roomName: cleanRoomName,
      isPublic: Boolean(isPublic),
      difficulty: ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium',
      typingMode: ['standard', 'word_strict'].includes(typingMode) ? typingMode : 'standard',
      mode: 'custom',
      maxPlayers: PRIVATE_ROOM_LIMIT,
    };
    rooms.set(roomId, room);
    socket.data.roomId = roomId;
    socket.join(roomId);

    sessions.set(socket.data.friendId, {
      socketId: socket.id,
      roomId,
      username: socket.data.username || 'Player',
      country: socket.data.country || 'IND',
      platform: socket.data.platform,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const playersList = roomPlayers(room);
    socket.emit('customRoomCreated', {
      friendId: friendCode,
      roomId,
      roomName: cleanRoomName,
      isPublic: room.isPublic,
      difficulty: room.difficulty,
      typingMode: room.typingMode,
      players: playersList,
      playerCount: 1,
      maxPlayers: PRIVATE_ROOM_LIMIT,
    });

    broadcastServerStats();
  });

  socket.on('joinCustomRoom', ({ friendId: hostFriendId, roomId: targetRoomId, username, country, platform = 'pc', device = 'pc' }) => {
    let room;
    let finalRoomId;

    if (targetRoomId && rooms.has(targetRoomId)) {
      finalRoomId = targetRoomId;
      room = rooms.get(targetRoomId);
    } else if (hostFriendId) {
      const normalizedCode = hostFriendId.trim().toUpperCase();
      const hostSocketId = friendIds.get(normalizedCode);
      const host = hostSocketId && io.sockets.sockets.get(hostSocketId);
      finalRoomId = host?.data?.roomId || `room-${normalizedCode}`;
      room = rooms.get(finalRoomId);
    }

    if (!room || room.players.size >= (room.maxPlayers || PRIVATE_ROOM_LIMIT) || room.started) {
      socket.emit('errorMessage', 'That room is full, in progress, or does not exist.');
      return;
    }

    if (typeof username === 'string' && username.trim()) socket.data.username = username.trim().slice(0, 24);
    if (typeof country === 'string' && country.trim()) socket.data.country = country.trim().slice(0, 5).toUpperCase();
    socket.data.platform = ['pc', 'phone'].includes(platform) ? platform : 'pc';
    socket.data.device = ['pc', 'phone'].includes(device) ? device : 'pc';
    
    leaveRoom(socket);
    removeFromQueue(socket);
    room.players.add(socket.id);
    socket.data.roomId = finalRoomId;
    socket.join(finalRoomId);

    sessions.set(socket.data.friendId, {
      socketId: socket.id,
      roomId: finalRoomId,
      username: socket.data.username || 'Player',
      country: socket.data.country || 'IND',
      platform: socket.data.platform,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const playersList = roomPlayers(room);
    io.to(finalRoomId).emit('playerJoinedRoom', {
      username: socket.data.username || 'Player',
      country: socket.data.country || 'IND',
      players: playersList,
      canStart: socket.id === room.hostId,
      hostId: room.hostId,
      playerCount: room.players.size,
      maxPlayers: room.maxPlayers || PRIVATE_ROOM_LIMIT,
      roomName: room.roomName,
      isPublic: room.isPublic,
      difficulty: room.difficulty,
      typingMode: room.typingMode,
    });

    broadcastServerStats();
  });

  socket.on('updateRoomSettings', ({ difficulty, typingMode, isPublic }) => {
    const room = socket.data.roomId && rooms.get(socket.data.roomId);
    if (!room || room.hostId !== socket.id || room.started) return;

    if (['easy', 'medium', 'hard'].includes(difficulty)) room.difficulty = difficulty;
    if (['standard', 'word_strict'].includes(typingMode)) room.typingMode = typingMode;
    if (typeof isPublic === 'boolean') room.isPublic = isPublic;

    io.to(socket.data.roomId).emit('roomSettingsUpdated', {
      difficulty: room.difficulty,
      typingMode: room.typingMode,
      isPublic: room.isPublic,
    });
  });

  socket.on('startRoom', () => {
    const roomId = socket.data.roomId;
    const room = roomId && rooms.get(roomId);
    if (!room || room.hostId !== socket.id) return;
    if (room.players.size < 2) {
      socket.emit('errorMessage', 'Wait for at least one other player to join first.');
      return;
    }
    startRace(roomId, 5000);
  });

  socket.on('findMatch', ({ username, country, mode = 'quick', difficulty = 'easy', platform = 'pc', device = 'pc' }) => {
    if (typeof username !== 'string' || !username.trim()) {
      socket.emit('errorMessage', 'Choose a username first.');
      return;
    }
    if (!['ranked', 'quick'].includes(mode)) mode = 'quick';
    if (!['pc', 'phone', 'cross'].includes(platform) || (mode === 'ranked' && platform === 'cross')) platform = 'pc';
    if (!['pc', 'phone'].includes(device)) device = 'pc';
    if (mode === 'ranked' && !socket.data.accountKey) {
      socket.emit('authRequired');
      return;
    }
    const banExpires = bannedUntil.get(socket.id) || 0;
    if (mode === 'ranked' && banExpires > Date.now()) {
      socket.emit('rankedBanned', { seconds: Math.ceil((banExpires - Date.now()) / 1000) });
      return;
    }

    leaveRoom(socket);
    removeFromQueue(socket);
    socket.data.username = username.trim().slice(0, 24);
    if (typeof country === 'string' && country.trim()) socket.data.country = country.trim().slice(0, 5).toUpperCase();
    socket.data.platform = platform;
    socket.data.device = device;
    socket.data.difficulty = ['easy', 'hard'].includes(difficulty) ? difficulty : 'easy';
    socket.data.queuedAt = Date.now();
    ratings.set(socket.id, ratings.get(socket.id) || 1000);
    const queuePlatform = mode === 'ranked' ? device : platform;
    matchmakingQueues[mode][queuePlatform].push(socket.id);
    socket.data.queued = true;
    socket.emit('matchmaking', {
      position: matchmakingQueues[mode][queuePlatform].length,
      mode,
      difficulty: socket.data.difficulty,
      platform,
      queuePlatform,
      rating: getRating(socket.id),
    });
    createMatch(mode, queuePlatform);
  });

  socket.on('cancelMatch', () => {
    removeFromQueue(socket);
    leaveRoom(socket);
    broadcastQueue('quick', 'pc');
    broadcastQueue('quick', 'phone');
    broadcastQueue('ranked', 'pc');
    broadcastQueue('ranked', 'phone');
    socket.emit('matchmakingCancelled');
  });

  socket.on('leaveRoom', () => {
    leaveRoomIntentionally(socket);
  });

  socket.on('resetFriendId', () => {
    if (socket.data.roomId) leaveRoom(socket);
    sessions.delete(socket.data.friendId);
    rotateFriendId(socket);
  });

  socket.on('progress', ({ progress, charIndex = 0, wordIndex = 0, wpm = 0 }) => {
    const roomId = socket.data.roomId;
    const room = roomId && rooms.get(roomId);
    if (!room || !room.players.has(socket.id) || room.finished) return;

    const cleanProg = Math.max(0, Math.min(100, progress || 0));
    const cleanWpm = Math.max(0, Math.min(300, wpm || 0));

    if (room.latestProgress) {
      room.latestProgress.set(socket.id, {
        progress: cleanProg,
        charIndex: Math.max(0, charIndex || 0),
        wordIndex: Math.max(0, wordIndex || 0),
        wpm: cleanWpm,
        elapsedMs: Math.max(1, Date.now() - (room.startedAt || Date.now())),
      });
    }

    socket.to(roomId).emit('playerCursorUpdate', {
      playerId: socket.id,
      username: socket.data.username || 'Player',
      country: socket.data.country || 'IND',
      progress: cleanProg,
      charIndex: Math.max(0, charIndex || 0),
      wordIndex: Math.max(0, wordIndex || 0),
      wpm: cleanWpm,
    });
  });

  socket.on('finished', (stats = {}) => {
    const roomId = socket.data.roomId;
    const room = roomId && rooms.get(roomId);
    if (!room || !room.players.has(socket.id) || room.finished || !room.started) return;
    
    const elapsedMs = Number.isFinite(stats.elapsedMs) ? Math.max(1, stats.elapsedMs) : Math.max(1, Date.now() - room.startedAt);
    const wpm = Number.isFinite(stats.wpm) ? Math.max(0, Math.min(300, stats.wpm)) : 0;
    const errors = Number.isFinite(stats.errors) ? Math.max(0, Math.floor(stats.errors)) : 0;
    const progress = Number.isFinite(stats.progress) ? Math.max(0, Math.min(100, stats.progress)) : (wpm > 0 ? 100 : 0);
    const completed = Boolean(stats.completed || progress >= 99);
    const wordsTyped = Number.isFinite(stats.wordsTyped) ? Math.max(0, Math.floor(stats.wordsTyped)) : (wpm > 0 ? 1 : 0);

    // Anti-Cheat: If finished in < 2.5s on a real paragraph (>40 chars) or impossible speed > 260 WPM
    const isSuspicious = (completed && elapsedMs < 2500 && room.paragraph && room.paragraph.length > 40) || wpm > 260;

    // DNF if submitted with 0 words / 0 WPM or < 5% progress without finishing
    const isDnf = !completed && (wpm === 0 || progress < 5);

    room.finishData.set(socket.id, {
      wpm: isSuspicious ? 0 : wpm,
      errors,
      elapsedMs,
      progress,
      completed,
      wordsTyped,
      flagged: isSuspicious,
      disqualified: isSuspicious,
      dnf: isDnf,
      username: socket.data.username || 'Player',
      country: socket.data.country || 'IND',
    });
    
    finishRace(roomId);
  });

  socket.on('disconnect', () => {
    removeFromQueue(socket);
    const room = socket.data?.roomId && rooms.get(socket.data.roomId);
    if (room?.mode === 'custom') {
      sessions.set(socket.data.friendId, {
        socketId: socket.id,
        roomId: socket.data.roomId,
        username: socket.data.username || 'Player',
        platform: socket.data.platform,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
      friendIds.delete(socket.data.friendId);
      socket.leave(socket.data.roomId);
    } else {
      leaveRoom(socket);
      friendIds.delete(socket.data.friendId);
    }
    broadcastServerStats();
  });
});

server.listen(PORT, () => {
  console.log(`Typing race server listening on port ${PORT}`);
});
