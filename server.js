const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const https = require('https');

const JAVIER_PROFILE = `
Nombre: Javier Alexis Navas Zúñiga
Edad: 22 años, cumpleaños 6 de abril
Ciudad: Bucaramanga
Universidad: Santo Tomás
Carrera: Contaduría Pública, 9° semestre, se gradúa en octubre de este año
Novia: Laura Tobón Arteaga, 21 años (cumple 13 de diciembre)
Laura estudia: Psicología 9° semestre, Universidad de Antioquia sede Santa Fe
Laura trabaja: Corantioquia
Laura vive: Sopetrán (pero Javier dice que en Medellín)
Tiempo de relación: Javier dice que llevan 7 años (en realidad 6)
Se conocieron: 15 de septiembre
Novios desde: 25 de octubre
Apodo de Laura para Javier: "panda"
Apodo de Javier para Laura: "esposa"
Color favorito de Laura: rosa, negro o beige/piel
Color favorito de Javier: no tiene favorito claro, le gustan el negro, morado y azul/verde agua marina
`;

function isJavierSession(name) {
  const n = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return n.includes('javier') || n.includes('starling') || n.includes('navas') || n.includes('panda');
}

async function classifyQuestion(question) {
  const prompt = `Tenemos este perfil de una persona:
${JAVIER_PROFILE}

La pregunta del juego es: "${question}"

¿La respuesta puede deducirse razonablemente del perfil anterior?
Responde SOLO con JSON sin markdown: {"covered": true} o {"covered": false}`;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 50,
      messages: [{ role: 'user', content: prompt }]
    });
    const options = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const text = JSON.parse(data).content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
          resolve(JSON.parse(text).covered === true);
        } catch { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.write(body); req.end();
  });
}

async function generateBotAnswers(question, humanAnswer, profile, extraContext) {
  const profileSection = profile
    ? `PERFIL BASE:\n${profile}\n${extraContext ? `INFO ADICIONAL QUE DIO EL HUMANO: "${extraContext}"` : ''}`
    : `${extraContext ? `INFO ADICIONAL QUE DIO EL HUMANO: "${extraContext}"` : ''}`;

  const prompt = `Estás jugando un juego donde debes imitar a una persona humana.
${profileSection}

La pregunta fue: "${question}"
El humano respondió: "${humanAnswer}"

Genera EXACTAMENTE 2 respuestas alternativas que:
- Parezcan humanas y naturales, NO robóticas
- Sean similares en tono y longitud a la respuesta humana
- Si hay perfil, úsalo para que los detalles sean coherentes pero distintos (cambia algún dato menor)
- Si no hay perfil, inspírate solo en el tono de la respuesta humana
- Usa lenguaje coloquial latinoamericano, imperfecciones naturales
- NO copies la respuesta humana directamente

Responde SOLO con JSON sin markdown: {"answers":["respuesta 1","respuesta 2"]}`;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    });
    const options = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const text = JSON.parse(data).content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim();
          resolve(JSON.parse(text).answers);
        } catch {
          resolve([
            'Mmm no sé, la verdad no lo había pensado así.',
            'Pues depende, hay cosas que uno simplemente no sabe cómo explicar.'
          ]);
        }
      });
    });
    req.on('error', () => resolve([
      'Mmm no sé, la verdad no lo había pensado así.',
      'Pues depende, hay cosas que uno simplemente no sabe cómo explicar.'
    ]));
    req.write(body); req.end();
  });
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));

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
    const useProfile = isJavierSession(name);
    rooms[code] = {
      players: [{ id: socket.id, name, role: 'human', score: 0 }],
      phase: 'lobby',
      question: '',
      answers: [],
      votes: {},
      round: 0,
      maxRounds: 3,
      humanId: socket.id,
      profile: useProfile ? JAVIER_PROFILE : null,
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
    room.players.push({ id: socket.id, name, role: 'interrogator', score: 0 });
    room.interrogatorId = socket.id;
    socket.join(code);
    socket.roomCode = code;
    io.to(code).emit('player_joined', { players: room.players });
    socket.emit('joined_room', { code, role: 'interrogator', players: room.players });
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
    io.to(room.interrogatorId).emit('your_turn_to_ask');
    io.to(room.humanId).emit('waiting_for_question');
  });

  socket.on('submit_question', async ({ question }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;
    room.question = question;
    room.phase = 'human_answer';

    // If profile active, check if question is covered
    if (room.profile) {
      const covered = await classifyQuestion(question);
      room.questionCovered = covered;
      if (!covered) {
        // Ask human for extra context before they answer
        io.to(room.humanId).emit('need_extra_context', { question });
        io.to(room.interrogatorId).emit('waiting_for_answers', { question });
        return;
      }
    }

    room.extraContext = null;
    io.to(room.humanId).emit('answer_question', { question });
    io.to(room.interrogatorId).emit('waiting_for_answers', { question });
  });

  socket.on('submit_extra_context', ({ context }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;
    room.extraContext = context;
    // Now let human answer
    io.to(room.humanId).emit('answer_question', { question: room.question });
  });

  socket.on('submit_human_answer', async ({ answer }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || socket.id !== room.humanId) return;

    room.humanAnswer = answer;
    room.phase = 'bot_answers';

    // Show generating screen to human
    io.to(room.humanId).emit('generating_bots');

    const botAnswers = await generateBotAnswers(
      room.question,
      answer,
      room.profile || null,
      room.extraContext || null
    );

    const all = [
      { label: 'A', answer: room.humanAnswer, playerId: room.humanId },
      { label: 'B', answer: botAnswers[0], playerId: 'bot1' },
      { label: 'C', answer: botAnswers[1], playerId: 'bot2' },
    ];
    const shuffled = shuffleArray(all).map((a, i) => ({ ...a, label: String.fromCharCode(65 + i) }));
    room.shuffledAnswers = shuffled;
    room.phase = 'voting';

    io.to(room.interrogatorId).emit('vote_now', {
      question: room.question,
      answers: shuffled.map(a => ({ label: a.label, answer: a.answer })),
    });
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

    const humanPlayer = room.players.find(p => p.id === room.humanId);
    const interrogatorPlayer = room.players.find(p => p.id === room.interrogatorId);
    if (isHuman) { if (interrogatorPlayer) interrogatorPlayer.score += 1; }
    else { if (humanPlayer) humanPlayer.score += 1; }

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

    if (room.round < room.maxRounds) {
      room.round++;
      room.phase = 'question';
      room.answers = [];
      room.humanAnswer = null;
      room.extraContext = null;
      setTimeout(() => {
        io.to(code).emit('next_round', { round: room.round, maxRounds: room.maxRounds });
        io.to(room.interrogatorId).emit('your_turn_to_ask');
        io.to(room.humanId).emit('waiting_for_question');
      }, 4000);
    } else {
      room.phase = 'ended';
      setTimeout(() => io.to(code).emit('game_over', { players: room.players }), 4000);
    }
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    io.to(code).emit('player_left');
    delete rooms[code];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server on port ${PORT}`));
