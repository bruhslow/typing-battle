const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const matchmakingQueues = { ranked: [], quick: [] };
const friendIds = new Map();
const sessions = new Map();
const ratings = new Map();
const bannedUntil = new Map();
const accounts = new Map();
const PRIVATE_ROOM_LIMIT = 10;

const paragraphs = [
  'The morning train arrived just as the first light spread across the station windows. Travelers gathered their bags and stepped into the new day with quiet purpose.',
  'A good idea often starts as a small question. With patience, practice, and a willingness to learn, that question can become something useful for everyone.',
  'Beyond the hill, the river curved through the green valley and reflected the clouds moving slowly across the afternoon sky.',
  'Teamwork is built from clear communication, steady effort, and trust. When people share progress openly, difficult tasks become easier to finish together.',
];

app.use(express.static(path.join(__dirname, 'public')));

function getRandomParagraph(difficulty = 'medium') {
  const ordered = [...paragraphs].sort((first, second) => first.length - second.length);
  const choices = difficulty === 'easy' ? ordered.slice(0, 2) : difficulty === 'hard' ? ordered.slice(-2) : ordered.slice(1, 3);
  return choices[Math.floor(Math.random() * choices.length)];
}

function removeFromQueue(socket) {
  Object.values(matchmakingQueues).forEach((queue) => {
    const queueIndex = queue.indexOf(socket.id);
    if (queueIndex !== -1) queue.splice(queueIndex, 1);
  });
  socket.data.queued = false;
}

function playerInfo(player) {
  return { id: player.id, username: player.data.username || 'Player', rating: getRating(player.id) };
}

function roomPlayers(room) {
  return [...room.players]
    .map((playerId) => io.sockets.sockets.get(playerId))
    .filter(Boolean)
    .map(playerInfo);
}

function startRace(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.started || room.players.size < 2 || (room.mode !== 'private' && room.players.size !== 2)) return false;
  room.started = true;
  room.startedAt = Date.now();
  room.finishData = new Map();
  room.paragraph = getRandomParagraph(room.difficulty);
  io.to(roomId).emit('raceStarted', {
    paragraph: room.paragraph,
    difficulty: room.difficulty,
    players: roomPlayers(room),
  });
  return true;
}

function getRating(socketId) {
  const socket = io.sockets.sockets.get(socketId);
  if (socket?.data.accountKey && accounts.has(socket.data.accountKey)) return accounts.get(socket.data.accountKey).rating;
  return ratings.get(socketId) || 1000;
}

function setRating(socketId, rating) {
  const socket = io.sockets.sockets.get(socketId);
  if (socket?.data.accountKey && accounts.has(socket.data.accountKey)) accounts.get(socket.data.accountKey).rating = rating;
  else ratings.set(socketId, rating);
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
}

function finishRace(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.finished || room.finishData.size !== room.players.size) return;
  room.finished = true;
  const results = [...room.finishData.entries()]
    .map(([playerId, data]) => ({ ...playerInfo(io.sockets.sockets.get(playerId)), ...data }))
    .sort((first, second) => first.elapsedMs - second.elapsedMs);
  const winnerId = results[0].id;

  if (room.mode === 'ranked') {
    const winnerRating = getRating(winnerId);
    const loserRating = getRating(results[1].id);
    const expectedWinner = 1 / (1 + 10 ** ((loserRating - winnerRating) / 400));
    const change = Math.max(10, Math.round(32 * (1 - expectedWinner)));
    setRating(winnerId, winnerRating + change);
    setRating(results[1].id, Math.max(0, loserRating - change));
    results[0].ratingChange = change;
    results[1].ratingChange = -change;
    results.forEach((result) => { result.rating = getRating(result.id); });
  }

  io.to(roomId).emit('raceFinished', { winnerId, results, mode: room.mode });
}

function createMatch(mode) {
  const queue = matchmakingQueues[mode];
  while (queue.length >= 2) {
    const firstPlayer = io.sockets.sockets.get(queue.shift());
    const secondPlayer = io.sockets.sockets.get(queue.shift());
    if (!firstPlayer || !secondPlayer || firstPlayer.id === secondPlayer.id) continue;

    const roomId = `match-${mode}-${firstPlayer.id}-${secondPlayer.id}`;
    const room = { paragraph: null, players: new Set([firstPlayer.id, secondPlayer.id]), finished: false, started: false, mode, difficulty: 'medium' };
    rooms.set(roomId, room);

    [firstPlayer, secondPlayer].forEach((player) => {
      player.data.roomId = roomId;
      player.data.queued = false;
      player.join(roomId);
    });

    firstPlayer.emit('matchFound', {
      roomId,
      opponent: playerInfo(secondPlayer),
      mode,
    });
    secondPlayer.emit('matchFound', {
      roomId,
      opponent: playerInfo(firstPlayer),
      mode,
    });
    startRace(roomId);
  }
  broadcastQueue(mode);
}

function broadcastQueue(mode) {
  matchmakingQueues[mode].forEach((socketId, index) => {
    const player = io.sockets.sockets.get(socketId);
    if (player) player.emit('queueUpdate', { position: index + 1, waiting: matchmakingQueues[mode].length, mode });
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

function restoreSession(socket, friendId) {
  const session = sessions.get(friendId);
  const room = session?.roomId && rooms.get(session.roomId);
  if (!session || !room || session.expiresAt < Date.now()) return false;
  room.players.delete(session.socketId);
  room.players.add(socket.id);
  if (room.hostId === session.socketId) room.hostId = socket.id;
  socket.data.friendId = friendId;
  socket.data.username = session.username;
  socket.data.roomId = session.roomId;
  socket.join(session.roomId);
  sessions.set(friendId, { ...session, socketId: socket.id, expiresAt: Date.now() + 10 * 60 * 1000 });
  friendIds.set(friendId, socket.id);
  socket.emit('sessionRestored', {
    friendId,
    roomId: session.roomId,
    mode: room.mode,
    started: room.started,
    difficulty: room.difficulty,
    players: roomPlayers(room),
    hostId: room.hostId,
    playerCount: room.players.size,
    maxPlayers: PRIVATE_ROOM_LIMIT,
  });
  if (room.started) {
    socket.emit('raceStarted', {
      paragraph: room.paragraph,
      difficulty: room.difficulty,
      players: roomPlayers(room),
    });
  }
  return true;
}

function leaveRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  const room = rooms.get(roomId);
  if (room) {
    room.players.delete(socket.id);
    if (room.players.size === 0) {
      rooms.delete(roomId);
    } else {
      socket.to(roomId).emit('playerLeft', { playerCount: room.players.size, maxPlayers: PRIVATE_ROOM_LIMIT });
      socket.to(roomId).emit('roomUpdate', { players: roomPlayers(room), playerCount: room.players.size, maxPlayers: PRIVATE_ROOM_LIMIT, hostId: room.hostId });
    }
  }

  socket.leave(roomId);
  delete socket.data.roomId;
}

function leaveRoomIntentionally(socket) {
  const roomId = socket.data.roomId;
  const room = roomId && rooms.get(roomId);
  if (room?.mode === 'ranked' && room.started && !room.finished) applyRankedPenalty(socket);
  leaveRoom(socket);
}

io.on('connection', (socket) => {
  const friendId = createFriendId();
  friendIds.set(friendId, socket.id);
  socket.data.friendId = friendId;
  socket.emit('friendId', friendId);

  socket.on('restoreSession', ({ friendId: savedFriendId, username }) => {
    if (restoreSession(socket, savedFriendId)) return;
    if (typeof username === 'string' && username.trim()) socket.data.username = username.trim().slice(0, 24);
  });

  socket.on('signup', ({ username, email, password }) => {
    const accountName = typeof username === 'string' ? username.trim() : '';
    const accountKey = accountName.toLowerCase();
    const accountEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!/^[a-zA-Z0-9_ ]{3,24}$/.test(accountName) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail) || typeof password !== 'string' || password.length < 6) {
      socket.emit('authError', 'Use a valid email, a username with 3-24 characters, and a password of 6+ characters.');
      return;
    }
    if (accounts.has(accountKey) || [...accounts.values()].some((account) => account.email === accountEmail)) {
      socket.emit('authError', 'That username is already taken.');
      return;
    }
    const credentials = hashPassword(password);
    accounts.set(accountKey, { username: accountName, email: accountEmail, ...credentials, rating: 1000 });
    socket.data.accountKey = accountKey;
    socket.data.username = accountName;
    socket.emit('authSuccess', { username: accountName, rating: 1000 });
  });

  socket.on('login', ({ username, email, password }) => {
    const accountKey = typeof username === 'string' ? username.trim().toLowerCase() : '';
    const account = accounts.get(accountKey);
    const emailMatches = typeof email === 'string' && email.trim().toLowerCase() === account?.email;
    if (!account || !emailMatches || typeof password !== 'string' || !passwordMatches(password, account)) {
      socket.emit('authError', 'Incorrect username or password.');
      return;
    }
    socket.data.accountKey = accountKey;
    socket.data.username = account.username;
    rotateFriendId(socket);
    socket.emit('authSuccess', { username: account.username, rating: account.rating });
  });

  socket.on('logout', () => {
    delete socket.data.accountKey;
    socket.emit('loggedOut');
  });

  socket.on('setUsername', (username) => {
    if (typeof username === 'string' && username.trim()) {
      socket.data.username = username.trim().slice(0, 24);
      socket.emit('usernameUpdated', socket.data.username);
    }
  });

  socket.on('createFriendRoom', ({ username, difficulty = 'medium' }) => {
    if (typeof username === 'string' && username.trim()) socket.data.username = username.trim().slice(0, 24);
    leaveRoom(socket);
    removeFromQueue(socket);
    const roomId = `friend-${socket.id}`;
    const room = { paragraph: null, players: new Set([socket.id]), finished: false, started: false, hostId: socket.id, difficulty: ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium', mode: 'private' };
    rooms.set(roomId, room);
    socket.data.roomId = roomId;
    socket.join(roomId);
    sessions.set(friendId, { socketId: socket.id, roomId, username: socket.data.username || 'Player', expiresAt: Date.now() + 10 * 60 * 1000 });
    socket.emit('friendRoomCreated', { friendId, difficulty: room.difficulty, playerCount: 1, maxPlayers: PRIVATE_ROOM_LIMIT });
  });

  socket.on('joinFriendRoom', ({ friendId: hostFriendId, username }) => {
    const hostSocketId = friendIds.get(hostFriendId);
    const host = hostSocketId && io.sockets.sockets.get(hostSocketId);
    const roomId = host && host.data.roomId;
    const room = roomId && rooms.get(roomId);

    if (!host || !room || room.mode !== 'private' || room.players.size >= PRIVATE_ROOM_LIMIT || room.started) {
      socket.emit('errorMessage', 'That friend ID is not available.');
      return;
    }
    if (typeof username === 'string' && username.trim()) socket.data.username = username.trim().slice(0, 24);
    leaveRoom(socket);
    removeFromQueue(socket);
    room.players.add(socket.id);
    socket.data.roomId = roomId;
    socket.join(roomId);
    sessions.set(socket.data.friendId, { socketId: socket.id, roomId, username: socket.data.username || 'Player', expiresAt: Date.now() + 10 * 60 * 1000 });
    const players = roomPlayers(room);
    io.to(roomId).emit('friendJoined', { players, canStart: socket.id === room.hostId, hostId: room.hostId, playerCount: room.players.size, maxPlayers: PRIVATE_ROOM_LIMIT });
  });

  socket.on('setRoomDifficulty', (difficulty) => {
    const room = socket.data.roomId && rooms.get(socket.data.roomId);
    if (!room || room.hostId !== socket.id || room.started) return;
    if (['easy', 'medium', 'hard'].includes(difficulty)) {
      room.difficulty = difficulty;
      io.to(socket.data.roomId).emit('roomDifficulty', difficulty);
    }
  });

  socket.on('startRoom', () => {
    const roomId = socket.data.roomId;
    const room = roomId && rooms.get(roomId);
    if (!room || room.mode !== 'private' || room.hostId !== socket.id) return;
    if (room.players.size < 2) {
      socket.emit('errorMessage', 'Wait for at least one friend to join first.');
      return;
    }
    startRace(roomId);
  });

  socket.on('findMatch', ({ username, mode = 'quick' }) => {
    if (typeof username !== 'string' || !username.trim()) {
      socket.emit('errorMessage', 'Choose a username first.');
      return;
    }
    if (!['ranked', 'quick'].includes(mode)) mode = 'quick';
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
    ratings.set(socket.id, ratings.get(socket.id) || 1000);
    matchmakingQueues[mode].push(socket.id);
    socket.data.queued = true;
    socket.emit('matchmaking', { position: matchmakingQueues[mode].length, mode, rating: ratings.get(socket.id) });
    createMatch(mode);
  });

  socket.on('cancelMatch', () => {
    removeFromQueue(socket);
    broadcastQueue('quick');
    broadcastQueue('ranked');
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

  socket.on('joinRoom', (roomId, username) => {
    if (typeof roomId !== 'string' || !roomId.trim()) {
      socket.emit('errorMessage', 'A room ID is required.');
      return;
    }

    leaveRoom(socket);
    removeFromQueue(socket);
    socket.data.username = typeof username === 'string' && username.trim() ? username.trim().slice(0, 24) : 'Player';
    const normalizedRoomId = roomId.trim();
    let room = rooms.get(normalizedRoomId);

    if (room && room.players.size >= 2) {
      socket.emit('roomFull');
      return;
    }

    if (!room) {
      room = { paragraph: null, players: new Set(), finished: false, started: false, mode: 'private', hostId: roomId };
      rooms.set(normalizedRoomId, room);
    }

    room.players.add(socket.id);
    socket.data.roomId = normalizedRoomId;
    socket.join(normalizedRoomId);
    socket.emit('joinedRoom', { playerNumber: room.players.size, username: socket.data.username });

    if (room.players.size === 2) {
      startRace(normalizedRoomId);
    }
  });

  socket.on('progress', (progress) => {
    const roomId = socket.data.roomId;
    const room = roomId && rooms.get(roomId);
    if (!room || !room.players.has(socket.id) || room.finished) return;

    socket.to(roomId).emit('opponentProgress', {
      playerId: socket.id,
      progress,
    });
  });

  socket.on('finished', (stats = {}) => {
    const roomId = socket.data.roomId;
    const room = roomId && rooms.get(roomId);
    if (!room || !room.players.has(socket.id) || room.finished || !room.started) return;
    const wpm = Number.isFinite(stats.wpm) ? Math.max(0, Math.min(300, stats.wpm)) : 0;
    const errors = Number.isFinite(stats.errors) ? Math.max(0, Math.floor(stats.errors)) : 0;
    const elapsedMs = Number.isFinite(stats.elapsedMs) ? Math.max(0, stats.elapsedMs) : Date.now() - room.startedAt;
    room.finishData.set(socket.id, { wpm, errors, elapsedMs });
    finishRace(roomId);
  });

  socket.on('disconnect', () => {
    removeFromQueue(socket);
    const room = socket.data.roomId && rooms.get(socket.data.roomId);
    if (room?.mode === 'private') {
      sessions.set(socket.data.friendId, { socketId: socket.id, roomId: socket.data.roomId, username: socket.data.username || 'Player', expiresAt: Date.now() + 10 * 60 * 1000 });
      friendIds.delete(socket.data.friendId);
      socket.leave(socket.data.roomId);
    } else {
      leaveRoom(socket);
      friendIds.delete(socket.data.friendId);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Typing race server listening on port ${PORT}`);
});
