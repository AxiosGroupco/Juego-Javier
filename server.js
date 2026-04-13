const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// rooms: { code: { players: [{id, name, role, score}], phase, question, answers, votes, round, maxRounds } }
const rooms = {};

function generateCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

io.on('connection', (socket) => {

  socket.on('create_room', ({ name }) => {
    const code = generateCode();
    rooms[code] = {
      players: [{ id: socket.id, name, role: 'human', score: 0 }],
      phase: 'lobby',
      question: '',
      answers: [],
      votes: {},
      round: 0,
      maxRounds: 3,
      humanId: socket.id,
    };
    socket.join(code);
    socket.roomCode = code;
    socket.emit('room_created', { code, players: rooms[code].players });
  });

  socket.on('join_room', ({ name, code }) => {
    const room = rooms[code];
    if (!room) return socket.emit('error', 'Sala no encontrada');
    if (room.players.length >= 4) return socket.emit('error', 'Sala llena');
    if (room.phase !== 'lobby') return socket.emit('error', 'La partida ya comenzó');

    const role = room.players.length === 0 ? 'human' : 'interrogator';
    room.players.push({ id: socket.id, name, role, score: 0 });
    if (role === 'interrogator') room.interrogatorId = socket.id;

    socket.join(code);
    socket.roomCode = code;

    io.to(code).emit('player_joined', { players: room.players });
    socket.emit('joined_room', { code, role, players: room.players });
  });

  socket.on('start_game', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || socket.id !== room.humanId) return;

    room.phase = 'question';
    room.round = 1;
    room.answers = [];
    room.votes = {};

    io.to(code).emit('game_started', { round: room.round, maxRounds: room.maxRounds });
    // Tell interrogator to ask question
    io.to(room.interrogatorId).emit('your_turn_to_ask');
  });

  socket.on('submit_question', ({ question }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;
    room.question = question;
    room.phase = 'human_answer';
    room.answers = [];

    // First, human answers
    io.to(room.humanId).emit('answer_question', { question, first: true });
    // Interrogator waits
    io.to(room.interrogatorId).emit('waiting_for_answers', { question });
  });

  socket.on('submit_human_answer', ({ answer }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || socket.id !== room.humanId) return;

    room.humanAnswer = answer;
    room.phase = 'bot_answers';

    // Now generate bot answers via client-side API call (we'll tell interrogator's socket to trigger it)
    // We tell the human's client to generate bot responses (it has the API key context)
    socket.emit('generate_bot_answers', {
      question: room.question,
      humanAnswer: answer,
      numBots: 2,
    });
  });

  socket.on('bot_answers_ready', ({ botAnswers }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;

    // Combine human + bot answers, shuffle
    const all = [
      { label: 'A', answer: room.humanAnswer, playerId: room.humanId },
      { label: 'B', answer: botAnswers[0], playerId: 'bot1' },
      { label: 'C', answer: botAnswers[1], playerId: 'bot2' },
    ];
    const shuffled = shuffleArray(all).map((a, i) => ({ ...a, label: String.fromCharCode(65 + i) }));
    room.shuffledAnswers = shuffled;
    room.phase = 'voting';

    // Show all answers to interrogator to vote
    io.to(room.interrogatorId).emit('vote_now', {
      question: room.question,
      answers: shuffled.map(a => ({ label: a.label, answer: a.answer })),
    });
    // Human sees answers are being judged
    io.to(room.humanId).emit('being_judged', {
      question: room.question,
      answers: shuffled.map(a => ({ label: a.label, answer: a.answer })),
    });
  });

  socket.on('submit_vote', ({ label }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || socket.id !== room.interrogatorId) return;

    const chosen = room.shuffledAnswers.find(a => a.label === label);
    const isHuman = chosen && chosen.playerId === room.humanId;

    let pointsHuman = 0;
    let pointsInterrogator = 0;
    if (isHuman) {
      pointsInterrogator += 1; // interrogator found the human
    } else {
      pointsHuman += 1; // human fooled the interrogator
    }

    const humanPlayer = room.players.find(p => p.id === room.humanId);
    const interrogatorPlayer = room.players.find(p => p.id === room.interrogatorId);
    if (humanPlayer) humanPlayer.score += pointsHuman;
    if (interrogatorPlayer) interrogatorPlayer.score += pointsInterrogator;

    const result = {
      chosenLabel: label,
      humanLabel: room.shuffledAnswers.find(a => a.playerId === room.humanId)?.label,
      isHuman,
      answers: room.shuffledAnswers,
      players: room.players,
      round: room.round,
      maxRounds: room.maxRounds,
    };

    io.to(code).emit('round_result', result);

    // Next round or end
    if (room.round < room.maxRounds) {
      room.round++;
      room.phase = 'question';
      room.answers = [];
      room.humanAnswer = null;
      setTimeout(() => {
        io.to(code).emit('next_round', { round: room.round, maxRounds: room.maxRounds });
        io.to(room.interrogatorId).emit('your_turn_to_ask');
        io.to(room.humanId).emit('waiting_for_question');
      }, 4000);
    } else {
      room.phase = 'ended';
      setTimeout(() => {
        io.to(code).emit('game_over', { players: room.players });
      }, 4000);
    }
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    io.to(code).emit('player_left', { name: socket.id });
    delete rooms[code];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
