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
  });
  console.log(`Configured SMTP mail transporter (${process.env.SMTP_HOST}).`);
} else if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASS) {
  const cleanPass = String(process.env.GMAIL_APP_PASS).replace(/\s+/g, '');
  mailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER.trim(),
      pass: cleanPass,
    },
  });
  console.log(`Configured Gmail mail transporter (${process.env.GMAIL_USER.trim()}).`);
} else {
  console.log(`ℹ️ No SMTP env variables found. Email OTP codes will print to terminal console in Development Mode.`);
}

// In-memory Pending OTPs: Map<email, { otp, expiresAt, lastSentAt, attempts, username, country } >
const pendingOtps = new Map();

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOtpEmail(email, otp, username = 'Typist') {
  const mailOptions = {
    from: process.env.EMAIL_FROM || '"Typendo Security" <no-reply@typendo.com>',
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
    const duelHistory = acc.duelHistory || [];
    const pb = duelHistory.length > 0 ? Math.max(...duelHistory.map((d) => d.wpm || 0)) : 0;
    const wins = duelHistory.filter((d) => d.isWin).length;
    const matches = duelHistory.length;

    list.push({
      username: acc.username,
      country: acc.country || 'IND',
      rating: acc.rating || 1000,
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

const paragraphs = {
  easy: [
    'The quick brown fox jumps over the lazy dog on a sunny afternoon.',
    'A good idea often starts as a small question. With practice, it grows.',
    'Early morning light spread across the quiet station as the first train arrived.',
    'Coding is the art of telling a computer what to do step by step.',
    'Clear skies and a gentle breeze made it a pleasant day for a walk in the park.',
  ],
  medium: [
    'The morning train arrived just as the first light spread across the station windows. Travelers gathered their bags and stepped into the new day with quiet purpose.',
    'A good idea often starts as a small question. With patience, practice, and a willingness to learn, that question can become something useful for everyone.',
    'Beyond the hill, the river curved through the green valley and reflected the clouds moving slowly across the afternoon sky.',
    'Teamwork is built from clear communication, steady effort, and trust. When people share progress openly, difficult tasks become easier to finish together.',
    'Focus on the small improvements each day. Over time, consistent effort transforms modest beginnings into remarkable achievements.',
  ],
  hard: [
    'Technological revolutions frequently originate at the intersection of diverse disciplines, demanding resilience, rigorous empirical testing, and unyielding intellectual curiosity.',
    'Complex asynchronous architectures necessitate meticulous state synchronization, preventing race conditions through deterministic dispatch cycles and resilient event boundaries.',
    'The philosophical juxtaposition of computational abstraction against concrete algorithmic optimization remains an intriguing paradox for modern systems architects.',
    'Distributed consensus protocols guarantee deterministic convergence under adversarial network partitions through cryptographic Byzantine fault tolerance paradigms.',
  ],
};

app.use(express.static(path.join(__dirname, 'public')));

function getRandomParagraph(difficulty = 'medium') {
  const list = paragraphs[difficulty] || paragraphs.medium;
  return list[Math.floor(Math.random() * list.length)];
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
      const info = playerInfo(socket, playerId);
      return { ...info, color, playerIndex: index };
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
  const attempted = Buffer.from(hashPassword(password, account.salt).hash, 'hex');
  return crypto.timingSafeEqual(attempted, Buffer.from(account.hash, 'hex'));
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
  room.paragraph = getRandomParagraph(room.difficulty);

  const playersList = roomPlayers(room);

  io.to(roomId).emit('raceStarted', {
    paragraph: room.paragraph,
    difficulty: room.difficulty,
    typingMode: room.typingMode || 'standard',
    maxDurationSec: MAX_RACE_DURATION_SEC,
    startTime,
    countdownMs,
    players: playersList,
    mode: room.mode,
  });

  broadcastServerStats();

  room.maxDurationTimer = setTimeout(() => {
    finishRace(roomId, true, 'Time limit reached (90s)');
  }, countdownMs + (MAX_RACE_DURATION_SEC * 1000));

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
      room.finishData.set(playerId, {
        wpm: 0,
        errors: 0,
        elapsedMs: 999999,
        dnf: true,
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
    .sort((first, second) => first.elapsedMs - second.elapsedMs);

  if (results.length === 0) return;

  const winnerId = results[0].id;

  if (room.mode === 'ranked' && results.length >= 2) {
    const winnerRating = getRating(winnerId);
    const loserRating = getRating(results[1].id);
    const expectedWinner = 1 / (1 + 10 ** ((loserRating - winnerRating) / 400));
    const change = Math.max(10, Math.round(32 * (1 - expectedWinner)));
    
    setRating(winnerId, winnerRating + change);
    setRating(results[1].id, Math.max(0, loserRating - change));
    results[0].ratingChange = change;
    results[1].ratingChange = -change;
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
      const mode = readyState.mode;
      const platform = socket.data?.device || socket.data?.platform || 'pc';
      const queuePlatform = mode === 'ranked' ? socket.data?.device || 'pc' : socket.data?.platform || 'pc';
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
    queue.map((socketId) => ({ socketId, platform }))
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
      const idx = q.indexOf(first.socketId);
      if (idx !== -1) q.splice(idx, 1);
      continue;
    }

    const secondIndex = queuedPlayers.findIndex((candidate, index) => {
      if (index === 0) return false;
      const candidatePlayer = io.sockets.sockets.get(candidate.socketId);
      if (!candidatePlayer) return false;
      return (
        first.platform === 'cross' ||
        candidate.platform === 'cross' ||
        (first.platform === candidatePlayer.data?.device && candidate.platform === firstPlayer.data?.device)
      );
    });

    if (secondIndex === -1) break;

    const second = queuedPlayers[secondIndex];
    const secondPlayer = io.sockets.sockets.get(second.socketId);

    queuedPlayers.splice(secondIndex, 1);
    queuedPlayers.shift();

    [first, second].forEach((item) => {
      const queue = matchmakingQueues.quick[item.platform];
      const idx = queue.indexOf(item.socketId);
      if (idx !== -1) queue.splice(idx, 1);
    });

    if (!secondPlayer) {
      if (firstPlayer) {
        matchmakingQueues.quick[first.platform].unshift(first.socketId);
      }
      continue;
    }

    const roomId = `match-quick-${firstPlayer.id}-${secondPlayer.id}`;
    const room = {
      paragraph: null,
      players: new Set([firstPlayer.id, secondPlayer.id]),
      finished: false,
      started: false,
      mode: 'quick',
      difficulty: 'medium',
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
  const queue = matchmakingQueues[mode][platform];
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
  const queue = matchmakingQueues[mode][platform];
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
      maxDurationSec: MAX_RACE_DURATION_SEC,
      startTime: room.startedAt,
      countdownMs: 0,
      players: playersList,
      mode: room.mode,
    });
  }
  return true;
}

function leaveRoom(socket) {
  const roomId = socket.data?.roomId;
  if (!roomId) return;

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
  // REGISTRATION WITH EMAIL OTP & STANDARD PASSWORD LOGIN
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
    const emailExists = [...accounts.values()].some((a) => a.email.toLowerCase() === cleanEmail);
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

    await sendOtpEmail(cleanEmail, otp, cleanUsername);

    socket.emit('otpSent', {
      success: true,
      email: cleanEmail,
      username: cleanUsername,
      cooldownSec: 60,
      devMode: !mailTransporter,
      devOtp: !mailTransporter ? otp : undefined,
      message: mailTransporter ? `6-digit verification code sent to ${cleanEmail}` : `Verification code sent! (Dev Mode: code ${otp})`,
    });
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

    socket.emit('authSuccess', {
      username: newAccount.username,
      email: newAccount.email,
      country: newAccount.country,
      rating: 1000,
      accountKey,
      createdAt: newAccount.createdAt,
      duelHistory: [],
      eloHistory: [],
    });
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
      account = [...accounts.values()].find((acc) => acc.email.toLowerCase() === lowerIdentifier || acc.username.toLowerCase() === lowerIdentifier);
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
    socket.emit('authSuccess', {
      username: account.username,
      email: account.email,
      country: account.country || 'IND',
      rating: account.rating,
      accountKey,
      createdAt: account.createdAt || Date.now(),
      duelHistory: account.duelHistory || [],
      eloHistory: account.eloHistory || [],
    });
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

    socket.emit('profileUpdated', {
      username: account.username,
      email: account.email,
      country: account.country,
      rating: account.rating,
      accountKey: socket.data.accountKey,
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

  socket.on('findMatch', ({ username, country, mode = 'quick', platform = 'pc', device = 'pc' }) => {
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
    socket.data.queuedAt = Date.now();
    ratings.set(socket.id, ratings.get(socket.id) || 1000);
    const queuePlatform = mode === 'ranked' ? device : platform;
    matchmakingQueues[mode][queuePlatform].push(socket.id);
    socket.data.queued = true;
    socket.emit('matchmaking', {
      position: matchmakingQueues[mode][queuePlatform].length,
      mode,
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

    socket.to(roomId).emit('playerCursorUpdate', {
      playerId: socket.id,
      username: socket.data.username || 'Player',
      country: socket.data.country || 'IND',
      progress: Math.max(0, Math.min(100, progress || 0)),
      charIndex: Math.max(0, charIndex || 0),
      wordIndex: Math.max(0, wordIndex || 0),
      wpm: Math.max(0, Math.min(300, wpm || 0)),
    });
  });

  socket.on('finished', (stats = {}) => {
    const roomId = socket.data.roomId;
    const room = roomId && rooms.get(roomId);
    if (!room || !room.players.has(socket.id) || room.finished || !room.started) return;
    
    const elapsedMs = Number.isFinite(stats.elapsedMs) ? Math.max(1, stats.elapsedMs) : Math.max(1, Date.now() - room.startedAt);
    const wpm = Number.isFinite(stats.wpm) ? Math.max(0, Math.min(300, stats.wpm)) : 0;
    const errors = Number.isFinite(stats.errors) ? Math.max(0, Math.floor(stats.errors)) : 0;
    const isSuspicious = (elapsedMs < 2000 && room.paragraph.length > 30) || wpm > 260;

    room.finishData.set(socket.id, {
      wpm,
      errors,
      elapsedMs,
      flagged: isSuspicious,
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
