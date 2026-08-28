const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();

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
  socket.on('joinRoom', (roomId) => {
    if (typeof roomId !== 'string' || !roomId.trim()) {
      socket.emit('errorMessage', 'A room ID is required.');
      return;
    }

    leaveRoom(socket);
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
    socket.emit('joinedRoom', { playerNumber: room.players.size });

    if (room.players.size === 2) {
      room.paragraph = getRandomParagraph();
      io.to(normalizedRoomId).emit('raceStarted', { paragraph: room.paragraph });
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
    leaveRoom(socket);
  });
});

server.listen(PORT, () => {
  console.log(`Typing race server listening on port ${PORT}`);
});
