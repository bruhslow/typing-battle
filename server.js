const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const matchmakingQueues = { ranked: [], quick: [] };
const friendIds = new Map();
const ratings = new Map();

const paragraphs = [
  'The morning train arrived just as the first light spread across the station windows. Travelers gathered their bags and stepped into the new day with quiet purpose.',
  'A good idea often starts as a small question. With patience, practice, and a willingness to learn, that question can become something useful for everyone.',
  'Beyond the hill, the river curved through the green valley and reflected the clouds moving slowly across the afternoon sky.',
  'Teamwork is built from clear communication, steady effort, and trust. When people share progress openly, difficult tasks become easier to finish together.',
];

app.use(express.static(path.join(__dirname, 'public')));

function getRandomParagraph() {
  return paragraphs[Math.floor(Math.random() * paragraphs.length)];
}

function removeFromQueue(socket) {
  Object.values(matchmakingQueues).forEach((queue) => {
    const queueIndex = queue.indexOf(socket.id);
    if (queueIndex !== -1) queue.splice(queueIndex, 1);
  });
  socket.data.queued = false;
}

function playerInfo(player) {
  return { id: player.id, username: player.data.username || 'Player', rating: ratings.get(player.id) || 1000 };
}

function startRace(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.started || room.players.size !== 2) return false;
  room.started = true;
  room.paragraph = getRandomParagraph();
  io.to(roomId).emit('raceStarted', {
    paragraph: room.paragraph,
    difficulty: room.difficulty,
    players: [...room.players].map((playerId) => playerInfo(io.sockets.sockets.get(playerId))),
  });
  return true;
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
}

function createFriendId() {
  let friendId;
  do {
    friendId = Math.random().toString(36).slice(2, 8).toUpperCase();
  } while (friendIds.has(friendId));
  return friendId;
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
      socket.to(roomId).emit('playerLeft');
    }
  }

  socket.leave(roomId);
  delete socket.data.roomId;
}

io.on('connection', (socket) => {
  const friendId = createFriendId();
  friendIds.set(friendId, socket.id);
  socket.data.friendId = friendId;
  socket.emit('friendId', friendId);

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
    socket.emit('friendRoomCreated', { friendId, difficulty: room.difficulty });
  });

  socket.on('joinFriendRoom', ({ friendId: hostFriendId, username }) => {
    const hostSocketId = friendIds.get(hostFriendId);
    const host = hostSocketId && io.sockets.sockets.get(hostSocketId);
    const roomId = host && host.data.roomId;
    const room = roomId && rooms.get(roomId);

    if (!host || !room || room.players.size !== 1) {
      socket.emit('errorMessage', 'That friend ID is not available.');
      return;
    }
    if (typeof username === 'string' && username.trim()) socket.data.username = username.trim().slice(0, 24);
    leaveRoom(socket);
    removeFromQueue(socket);
    room.players.add(socket.id);
    socket.data.roomId = roomId;
    socket.join(roomId);
    const players = [...room.players].map((playerId) => ({
      id: playerId,
      username: io.sockets.sockets.get(playerId)?.data.username || 'Player',
    }));
    io.to(roomId).emit('friendJoined', { players, canStart: true });
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
    if (room.players.size !== 2) {
      socket.emit('errorMessage', 'Wait for your friend to join first.');
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
    socket.emit('matchmakingCancelled');
  });

  socket.on('leaveRoom', () => {
    leaveRoom(socket);
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

  socket.on('finished', () => {
    const roomId = socket.data.roomId;
    const room = roomId && rooms.get(roomId);
    if (!room || !room.players.has(socket.id) || room.finished) return;

    room.finished = true;
    const winner = socket.id;
    const loser = [...room.players].find((playerId) => playerId !== winner);
    let ratingChanges;
    if (room.mode === 'ranked' && loser) {
      const winnerRating = ratings.get(winner) || 1000;
      const loserRating = ratings.get(loser) || 1000;
      const expectedWinner = 1 / (1 + 10 ** ((loserRating - winnerRating) / 400));
      const change = Math.max(10, Math.round(32 * (1 - expectedWinner)));
      ratings.set(winner, winnerRating + change);
      ratings.set(loser, loserRating - change);
      ratingChanges = { [winner]: change, [loser]: -change };
    }
    io.to(roomId).emit('raceFinished', { winnerId: winner, ratingChanges });
  });

  socket.on('disconnect', () => {
    removeFromQueue(socket);
    leaveRoom(socket);
    friendIds.delete(socket.data.friendId);
  });
});

server.listen(PORT, () => {
  console.log(`Typing race server listening on port ${PORT}`);
});
