const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const matchmakingQueue = [];
const friendIds = new Map();

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
  const queueIndex = matchmakingQueue.indexOf(socket.id);
  if (queueIndex !== -1) matchmakingQueue.splice(queueIndex, 1);
  socket.data.queued = false;
}

function createMatch() {
  while (matchmakingQueue.length >= 2) {
    const firstPlayer = io.sockets.sockets.get(matchmakingQueue.shift());
    const secondPlayer = io.sockets.sockets.get(matchmakingQueue.shift());
    if (!firstPlayer || !secondPlayer || firstPlayer.id === secondPlayer.id) continue;

    const roomId = `match-${firstPlayer.id}-${secondPlayer.id}`;
    const room = { paragraph: getRandomParagraph(), players: new Set([firstPlayer.id, secondPlayer.id]), finished: false };
    rooms.set(roomId, room);

    [firstPlayer, secondPlayer].forEach((player) => {
      player.data.roomId = roomId;
      player.data.queued = false;
      player.join(roomId);
    });

    firstPlayer.emit('matchFound', {
      roomId,
      opponent: { id: secondPlayer.id, username: secondPlayer.data.username },
    });
    secondPlayer.emit('matchFound', {
      roomId,
      opponent: { id: firstPlayer.id, username: firstPlayer.data.username },
    });
    io.to(roomId).emit('raceStarted', {
      paragraph: room.paragraph,
      players: [
        { id: firstPlayer.id, username: firstPlayer.data.username },
        { id: secondPlayer.id, username: secondPlayer.data.username },
      ],
    });
  }
}

function createFriendId() {
  let friendId;
  do {
    friendId = `TYPE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
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

  socket.on('createFriendRoom', (username) => {
    if (typeof username === 'string' && username.trim()) socket.data.username = username.trim().slice(0, 24);
    leaveRoom(socket);
    removeFromQueue(socket);
    const roomId = `friend-${socket.id}`;
    const room = { paragraph: null, players: new Set([socket.id]), finished: false };
    rooms.set(roomId, room);
    socket.data.roomId = roomId;
    socket.join(roomId);
    socket.emit('friendRoomCreated', { friendId });
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
    io.to(roomId).emit('friendJoined', { players });
    room.paragraph = getRandomParagraph();
    io.to(roomId).emit('raceStarted', { paragraph: room.paragraph, players });
  });

  socket.on('findMatch', (username) => {
    if (typeof username !== 'string' || !username.trim()) {
      socket.emit('errorMessage', 'Choose a username first.');
      return;
    }

    leaveRoom(socket);
    removeFromQueue(socket);
    socket.data.username = username.trim().slice(0, 24);
    matchmakingQueue.push(socket.id);
    socket.data.queued = true;
    socket.emit('matchmaking', { position: matchmakingQueue.length });
    createMatch();
  });

  socket.on('cancelMatch', () => {
    removeFromQueue(socket);
    socket.emit('matchmakingCancelled');
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
      room = { paragraph: null, players: new Set(), finished: false };
      rooms.set(normalizedRoomId, room);
    }

    room.players.add(socket.id);
    socket.data.roomId = normalizedRoomId;
    socket.join(normalizedRoomId);
    socket.emit('joinedRoom', { playerNumber: room.players.size, username: socket.data.username });

    if (room.players.size === 2) {
      room.paragraph = getRandomParagraph();
      io.to(normalizedRoomId).emit('raceStarted', {
        paragraph: room.paragraph,
        players: [...room.players].map((playerId) => ({
          id: playerId,
          username: io.sockets.sockets.get(playerId)?.data.username || 'Player',
        })),
      });
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
    io.to(roomId).emit('raceFinished', { winnerId: socket.id });
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
