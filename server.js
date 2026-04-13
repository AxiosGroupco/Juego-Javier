const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const https = require('https');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));

// ── CLAUDE API HELPER ──────────────────────────────────────────
function callClaude(prompt, maxTokens) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens || 100,
      messages: [{ role: 'user', content: prompt }]
    });
    const options = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': (process.env.ANTHROPIC_API_KEY || '').trim(),
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
          resolve(text);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

// ── ROOMS ──────────────────────────────────────────────────────
const rooms = {};
function genCode() { return Math.random().toString(36).substring(2, 7).toUpperCase(); }
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ── JAVIER PROFILE ─────────────────────────────────────────────
const JAVIER_PROFILE = `Nombre: Javier Alexis Navas Zúñiga, 22 años (6 abril). Bucaramanga, U. Santo Tomás, Contaduría 9° sem, se gradúa octubre. Novia: Laura Tobón, 21 años (13 dic), Psicología 9° sem U. Antioquia sede Santa Fe, trabaja Corantioquia, vive Sopetrán (Javier dice Medellín). Llevan 6 años (Javier dice 7), novios desde 25 oct, se conocieron 15 sep. Apodo de Laura a Javier: panda. Apodo de Javier a Laura: esposa. Colores favoritos Laura: rosa/negro/beige. Javier: negro/morado/azul-verde agua marina.`;

function isJavier(name) {
  const n = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return n.includes('javier') || n.includes('starling') || n.includes('navas') || n.includes('panda');
}

async function classifyQ(question) {
  const t = await callClaude(`Perfil: ${JAVIER_PROFILE}\nPregunta: "${question}"\n¿Respuesta deducible del perfil? Solo: {"covered":true} o {"covered":false}`, 50);
  try { return JSON.parse(t).covered === true; } catch { return false; }
}

async function genBotAnswers(question, humanAnswer, profile, extra, count) {
  const t = await callClaude(`Juego de imitación. ${profile ? `Perfil: ${profile}` : ''} ${extra ? `Info extra: "${extra}"` : ''}
Pregunta: "${question}" | Humano respondió: "${humanAnswer}"
Genera EXACTAMENTE ${count} respuestas alternativas humanas, naturales, coloquiales latinoamericanas, distintas entre sí, inspiradas en el tono del humano pero no iguales.
Solo JSON: {"answers":["r1","r2",...]}`, 2000);
  try {
    const p = JSON.parse(t);
    if (p.answers?.length >= count) return p.answers.slice(0, count);
    throw 0;
  } catch {
    return Array.from({ length: count }, (_, i) => ['Mmm no lo había pensado así.','Pues uno se adapta.','Difícil explicarlo.','Jaja buena pregunta.','Creo que bien.','Uff complicado.','Honestamente no sé jaja.','Habría que verlo.','Lo que toca.','Cada quien.'][i % 10]);
  }
}

// ── AHORCADO WORDS ─────────────────────────────────────────────
const HANGMAN_WORDS = ['javascript','programacion','universidad','colombia','bucaramanga','medellin','contaduria','psicologia','computadora','telefono','cumpleanos','noviembre','diciembre','septiembre','octubre','chocolate','aguacate','mariposa','elefante','cocodrilo','helicoptero','submarino','dinosaurio','periodista','arquitecto'];

// ── SURVIVAL GAME CONSTANTS ────────────────────────────────────
const GRID = 20;
const TURN_MS = 3000;

function initSurvivalRoom(code) {
  return {
    game: 'survival',
    phase: 'lobby',
    players: {},
    mobs: [],
    barriers: [],
    turn: 0,
    tick: 0,
    aiActive: false,
    interval: null,
    scores: {},
    leaderboard: [],
  };
}

function spawnMobs(count, players, barriers) {
  const mobs = [];
  const occupied = new Set(barriers.map(b => `${b.x},${b.y}`));
  Object.values(players).forEach(p => occupied.add(`${p.x},${p.y}`));
  for (let i = 0; i < count; i++) {
    let x, y;
    do {
      const side = Math.floor(Math.random() * 4);
      if (side === 0) { x = 0; y = Math.floor(Math.random() * GRID); }
      else if (side === 1) { x = GRID - 1; y = Math.floor(Math.random() * GRID); }
      else if (side === 2) { x = Math.floor(Math.random() * GRID); y = 0; }
      else { x = Math.floor(Math.random() * GRID); y = GRID - 1; }
    } while (occupied.has(`${x},${y}`));
    mobs.push({ id: `mob_${Date.now()}_${i}`, x, y, hp: 1, type: i % 3 === 0 ? 'tank' : 'basic' });
  }
  return mobs;
}

function moveMobsBasic(mobs, players, barriers, aiActive) {
  const barrierSet = new Set(barriers.map(b => `${b.x},${b.y}`));
  const playerList = Object.values(players).filter(p => p.alive);
  return mobs.map(mob => {
    if (playerList.length === 0) return mob;
    let target = playerList[0];
    let minDist = Infinity;
    playerList.forEach(p => {
      const d = Math.abs(p.x - mob.x) + Math.abs(p.y - mob.y);
      if (d < minDist) { minDist = d; target = p; }
    });

    const dx = Math.sign(target.x - mob.x);
    const dy = Math.sign(target.y - mob.y);

    let candidates = [];
    if (aiActive) {
      // AI: try to flank, avoid barriers smartly
      candidates = [
        { x: mob.x + dx, y: mob.y },
        { x: mob.x, y: mob.y + dy },
        { x: mob.x + dx, y: mob.y + dy },
        { x: mob.x - dy, y: mob.y + dx },
        { x: mob.x + dy, y: mob.y - dx },
      ];
    } else {
      candidates = [
        { x: mob.x + dx, y: mob.y },
        { x: mob.x, y: mob.y + dy },
        { x: mob.x + (Math.random() > 0.5 ? 1 : -1), y: mob.y },
        { x: mob.x, y: mob.y + (Math.random() > 0.5 ? 1 : -1) },
      ];
    }

    for (const c of candidates) {
      if (c.x < 0 || c.x >= GRID || c.y < 0 || c.y >= GRID) continue;
      if (barrierSet.has(`${c.x},${c.y}`)) continue;
      const onPlayer = playerList.find(p => p.x === c.x && p.y === c.y);
      if (onPlayer) {
        // Attack player
        return { ...mob, attacking: onPlayer.id };
      }
      return { ...mob, x: c.x, y: c.y, attacking: null };
    }
    return { ...mob, attacking: null };
  });
}

// ── SOCKET ─────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // ── LOBBY / ROOM MANAGEMENT ──
  socket.on('create_room', ({ name, game }) => {
    const code = genCode();
    const useProfile = game === 'humano' && isJavier(name);
    rooms[code] = {
      game,
      phase: 'lobby',
      players: [{ id: socket.id, name, role: 'human', score: 0 }],
      humanId: socket.id,
      interrogatorId: null,
      profile: useProfile ? JAVIER_PROFILE : null,
      extraContext: null,
      allAnswers: [],
      activeAnswers: [],
      eliminationRound: 0,
      leaderboard: [],
      gameCount: 0,
      // hangman
      word: '', guessed: [], wrongGuesses: 0, currentDrawer: null,
      // survival
      survivalPlayers: {},
      mobs: [], barriers: [], turn: 0, tick: 0, aiActive: false, survivalInterval: null,
    };
    socket.join(code);
    socket.roomCode = code;
    socket.emit('room_created', { code, game, players: rooms[code].players });
  });

  socket.on('join_room', ({ name, code }) => {
    const room = rooms[code];
    if (!room) return socket.emit('error', 'Sala no encontrada');
    if (room.phase !== 'lobby') return socket.emit('error', 'La partida ya comenzó');

    let role = 'interrogator';
    if (room.game === 'survival') role = 'player';
    if (room.game === 'hangman') role = room.players.length === 0 ? 'drawer' : 'guesser';

    room.players.push({ id: socket.id, name, role, score: 0 });
    if (role === 'interrogator') room.interrogatorId = socket.id;

    socket.join(code);
    socket.roomCode = code;
    io.to(code).emit('player_joined', { players: room.players });
    socket.emit('joined_room', { code, game: room.game, role, players: room.players });
  });

  socket.on('start_game', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;
    room.phase = 'playing';

    if (room.game === 'humano') startHumano(code, room);
    else if (room.game === 'hangman') startHangman(code, room);
    else if (room.game === 'survival') startSurvival(code, room);
  });

  socket.on('play_again', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;
    // Swap roles for humano
    if (room.game === 'humano') {
      const oldH = room.humanId; const oldI = room.interrogatorId;
      room.humanId = oldI; room.interrogatorId = oldH;
      room.players.forEach(p => { p.role = p.id === room.humanId ? 'human' : 'interrogator'; });
    }
    room.phase = 'lobby';
    room.allAnswers = []; room.activeAnswers = []; room.extraContext = null; room.eliminationRound = 0;
    room.word = ''; room.guessed = []; room.wrongGuesses = 0;
    if (room.survivalInterval) { clearInterval(room.survivalInterval); room.survivalInterval = null; }
    io.to(code).emit('rematch_ready', { players: room.players, leaderboard: room.leaderboard });
  });

  // ── HUMANO EVENTS ──
  socket.on('submit_question', async ({ question }) => {
    const code = socket.roomCode; const room = rooms[code];
    if (!room || room.game !== 'humano') return;
    room.question = question; room.phase = 'human_answer';
    if (room.profile) {
      const covered = await classifyQ(question);
      if (!covered) {
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
    const code = socket.roomCode; const room = rooms[code];
    if (!room) return;
    room.extraContext = context;
    io.to(room.humanId).emit('answer_question', { question: room.question });
  });

  socket.on('submit_human_answer', async ({ answer }) => {
    const code = socket.roomCode; const room = rooms[code];
    if (!room || socket.id !== room.humanId) return;
    room.humanAnswer = answer; room.phase = 'generating';
    io.to(room.humanId).emit('generating_bots');
    io.to(room.interrogatorId).emit('generating_bots_wait');
    const bots = await genBotAnswers(room.question, answer, room.profile, room.extraContext, 10);
    const pool = shuffle([
      { id: 'human', answer, isHuman: true, eliminated: false },
      ...bots.map((a, i) => ({ id: `bot${i}`, answer: a, isHuman: false, eliminated: false }))
    ]).map((a, i) => ({ ...a, label: i + 1 }));
    room.allAnswers = pool; room.activeAnswers = [...pool]; room.eliminationRound = 0; room.phase = 'eliminating';
    const visible = pool.map(a => ({ label: a.label, answer: a.answer }));
    io.to(room.interrogatorId).emit('eliminate_now', { question: room.question, answers: visible, remaining: visible.length, eliminationRound: 0 });
    io.to(room.humanId).emit('being_judged', { question: room.question, answers: visible, remaining: visible.length });
  });

  socket.on('submit_elimination', ({ labels, finalGuess }) => {
    const code = socket.roomCode; const room = rooms[code];
    if (!room || socket.id !== room.interrogatorId) return;
    const calcPts = (r) => ({ interrogatorPts: Math.max(1, 10 - r), humanPts: r });

    if (finalGuess) {
      const chosen = room.activeAnswers.find(a => a.label === finalGuess);
      const isHuman = chosen?.isHuman;
      const humanEntry = room.allAnswers.find(a => a.isHuman);
      const { interrogatorPts, humanPts } = calcPts(room.eliminationRound);
      const iP = room.players.find(p => p.id === room.interrogatorId);
      const hP = room.players.find(p => p.id === room.humanId);
      if (isHuman && iP) iP.score += interrogatorPts;
      else if (!isHuman && hP) hP.score += humanPts;
      room.leaderboard = [...room.players].sort((a, b) => b.score - a.score);
      io.to(code).emit('game_result', { isHuman, humanLabel: humanEntry?.label, guessedLabel: finalGuess, humanAnswer: humanEntry?.answer, eliminationRound: room.eliminationRound, interrogatorPts: isHuman ? interrogatorPts : 0, humanPts: isHuman ? 0 : humanPts, players: room.players, leaderboard: room.leaderboard, allAnswers: room.allAnswers });
      return;
    }

    room.eliminationRound++;
    const eliminatedHuman = labels.some(l => room.activeAnswers.find(a => a.label === l)?.isHuman);
    labels.forEach(l => { const e = room.activeAnswers.find(a => a.label === l); if (e) e.eliminated = true; });
    room.activeAnswers = room.activeAnswers.filter(a => !a.eliminated);

    if (eliminatedHuman) {
      const hE = room.allAnswers.find(a => a.isHuman);
      const hP = room.players.find(p => p.id === room.humanId);
      if (hP) hP.score += room.eliminationRound;
      room.leaderboard = [...room.players].sort((a, b) => b.score - a.score);
      io.to(code).emit('game_result', { isHuman: false, humanLabel: hE?.label, humanEliminated: true, humanAnswer: hE?.answer, eliminationRound: room.eliminationRound, interrogatorPts: 0, humanPts: room.eliminationRound, players: room.players, leaderboard: room.leaderboard, allAnswers: room.allAnswers });
      return;
    }
    if (room.activeAnswers.length === 1 && room.activeAnswers[0].isHuman) {
      const hE = room.allAnswers.find(a => a.isHuman);
      const { interrogatorPts } = calcPts(room.eliminationRound);
      const iP = room.players.find(p => p.id === room.interrogatorId);
      if (iP) iP.score += interrogatorPts;
      room.leaderboard = [...room.players].sort((a, b) => b.score - a.score);
      io.to(code).emit('game_result', { isHuman: true, humanLabel: hE?.label, humanAnswer: hE?.answer, foundByElimination: true, eliminationRound: room.eliminationRound, interrogatorPts, humanPts: 0, players: room.players, leaderboard: room.leaderboard, allAnswers: room.allAnswers });
      return;
    }
    const visible = room.activeAnswers.map(a => ({ label: a.label, answer: a.answer }));
    io.to(room.interrogatorId).emit('eliminate_now', { question: room.question, answers: visible, remaining: visible.length, eliminationRound: room.eliminationRound });
    io.to(room.humanId).emit('being_judged', { question: room.question, answers: visible, remaining: visible.length });
  });

  // ── HANGMAN EVENTS ──
  socket.on('hangman_guess', ({ letter }) => {
    const code = socket.roomCode; const room = rooms[code];
    if (!room || room.game !== 'hangman') return;
    const word = room.word;
    if (room.guessed.includes(letter)) return;
    room.guessed.push(letter);
    if (!word.includes(letter)) room.wrongGuesses++;
    const won = word.split('').every(c => room.guessed.includes(c));
    const lost = room.wrongGuesses >= 6;
    io.to(code).emit('hangman_state', { word, guessed: room.guessed, wrongGuesses: room.wrongGuesses, won, lost });
    if (won) {
      const guesser = room.players.find(p => p.role === 'guesser');
      if (guesser) guesser.score += Math.max(1, 6 - room.wrongGuesses);
      room.leaderboard = [...room.players].sort((a, b) => b.score - a.score);
      io.to(code).emit('hangman_over', { won: true, word, players: room.players, leaderboard: room.leaderboard });
    } else if (lost) {
      const drawer = room.players.find(p => p.role === 'drawer');
      if (drawer) drawer.score += 2;
      room.leaderboard = [...room.players].sort((a, b) => b.score - a.score);
      io.to(code).emit('hangman_over', { won: false, word, players: room.players, leaderboard: room.leaderboard });
    }
  });

  socket.on('hangman_new_word', ({ word }) => {
    const code = socket.roomCode; const room = rooms[code];
    if (!room) return;
    room.word = word.toLowerCase();
    room.guessed = []; room.wrongGuesses = 0;
    // Swap roles
    room.players.forEach(p => { p.role = p.role === 'drawer' ? 'guesser' : 'drawer'; });
    io.to(code).emit('hangman_state', { word: room.word, guessed: [], wrongGuesses: 0, won: false, lost: false, players: room.players });
  });

  // ── SURVIVAL EVENTS ──
  socket.on('survival_action', ({ action, dir, powerup }) => {
    const code = socket.roomCode; const room = rooms[code];
    if (!room || room.game !== 'survival') return;
    const p = room.survivalPlayers[socket.id];
    if (!p || !p.alive) return;

    if (action === 'move' && dir) {
      const nx = p.x + (dir === 'left' ? -1 : dir === 'right' ? 1 : 0);
      const ny = p.y + (dir === 'up' ? -1 : dir === 'down' ? 1 : 0);
      if (nx >= 0 && nx < GRID && ny >= 0 && ny < GRID) {
        const blocked = room.barriers.find(b => b.x === nx && b.y === ny);
        if (!blocked) { p.x = nx; p.y = ny; }
      }
    } else if (action === 'shoot' && dir) {
      // Simple: remove first mob in direction
      let tx = p.x, ty = p.y;
      for (let i = 0; i < GRID; i++) {
        tx += dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
        ty += dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
        const mi = room.mobs.findIndex(m => m.x === tx && m.y === ty);
        if (mi >= 0) { room.mobs.splice(mi, 1); break; }
        if (tx < 0 || tx >= GRID || ty < 0 || ty >= GRID) break;
      }
    } else if (action === 'barrier' && p.barriers > 0 && dir) {
      const bx = p.x + (dir === 'left' ? -1 : dir === 'right' ? 1 : 0);
      const by = p.y + (dir === 'up' ? -1 : dir === 'down' ? 1 : 0);
      if (bx >= 0 && bx < GRID && by >= 0 && by < GRID) {
        room.barriers.push({ x: bx, y: by, hp: 2 });
        p.barriers--;
      }
    } else if (action === 'heal' && p.powerups > 0) {
      p.hp = Math.min(p.maxHp, p.hp + 2);
      p.powerups--;
    } else if (action === 'shield' && p.shields > 0) {
      p.shielded = 3; // last 3 turns
      p.shields--;
    }

    p.actedThisTurn = true;
    checkAllActed(code, room);
    broadcastSurvival(code, room);
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    if (room.survivalInterval) clearInterval(room.survivalInterval);
    io.to(code).emit('player_left');
    delete rooms[code];
  });
});

// ── GAME STARTERS ──────────────────────────────────────────────
function startHumano(code, room) {
  room.eliminationRound = 0; room.allAnswers = []; room.activeAnswers = []; room.extraContext = null;
  room.gameCount = (room.gameCount || 0) + 1;
  io.to(code).emit('game_started', { players: room.players });
  io.to(room.interrogatorId).emit('your_turn_to_ask');
  io.to(room.humanId).emit('waiting_for_question');
}

function startHangman(code, room) {
  const word = HANGMAN_WORDS[Math.floor(Math.random() * HANGMAN_WORDS.length)];
  room.word = word; room.guessed = []; room.wrongGuesses = 0;
  const drawer = room.players.find(p => p.role === 'drawer');
  const guesser = room.players.find(p => p.role === 'guesser');
  io.to(drawer?.id).emit('hangman_drawer', { word });
  io.to(guesser?.id).emit('hangman_state', { word, guessed: [], wrongGuesses: 0, won: false, lost: false });
  io.to(code).emit('hangman_started', { players: room.players });
}

function startSurvival(code, room) {
  const players = {};
  const positions = shuffle([[5,5],[14,14],[5,14],[14,5]]);
  room.players.forEach((p, i) => {
    players[p.id] = {
      id: p.id, name: p.name,
      x: positions[i][0], y: positions[i][1],
      hp: 5, maxHp: 5, alive: true,
      barriers: 3, shields: 2, powerups: 2,
      shielded: 0, actedThisTurn: false,
    };
  });
  room.survivalPlayers = players;
  room.mobs = spawnMobs(4, players, []);
  room.barriers = [];
  room.turn = 0; room.tick = 0; room.aiActive = false;

  io.to(code).emit('survival_started', { players, mobs: room.mobs, barriers: room.barriers, grid: GRID });

  // Tick every 3s
  room.survivalInterval = setInterval(() => survivalTick(code, room), 3000);
}

function survivalTick(code, room) {
  if (!rooms[code]) return;
  room.tick++;
  room.turn++;

  // Increase difficulty every 5 turns
  if (room.turn % 5 === 0) {
    const newMobCount = Math.min(3 + Math.floor(room.turn / 5), 6);
    room.mobs.push(...spawnMobs(newMobCount, room.survivalPlayers, room.barriers));
    // Random barriers from mobs
    if (room.turn % 10 === 0) {
      const attempts = Math.floor(room.turn / 10);
      for (let i = 0; i < attempts; i++) {
        const x = Math.floor(Math.random() * GRID);
        const y = Math.floor(Math.random() * GRID);
        const occupied = Object.values(room.survivalPlayers).find(p => p.x === x && p.y === y);
        if (!occupied) room.barriers.push({ x, y, hp: 1 });
      }
    }
  }

  // Activate AI after 40 ticks (~2 min)
  if (room.tick >= 40 && !room.aiActive) {
    room.aiActive = true;
    io.to(code).emit('survival_ai_activated');
  }

  // Move mobs
  room.mobs = moveMobsBasic(room.mobs, room.survivalPlayers, room.barriers, room.aiActive);

  // Check attacks
  room.mobs.forEach(mob => {
    if (mob.attacking) {
      const p = room.survivalPlayers[mob.attacking];
      if (p && p.alive) {
        if (p.shielded > 0) { p.shielded--; }
        else { p.hp -= mob.type === 'tank' ? 2 : 1; }
        if (p.hp <= 0) { p.hp = 0; p.alive = false; }
      }
    }
  });

  // Decay barrier hp when mob passes
  room.barriers = room.barriers.filter(b => {
    const mobOn = room.mobs.find(m => m.x === b.x && m.y === b.y);
    if (mobOn) b.hp--;
    return b.hp > 0;
  });

  // Reset actions
  Object.values(room.survivalPlayers).forEach(p => { p.actedThisTurn = false; });

  broadcastSurvival(code, room);

  const alive = Object.values(room.survivalPlayers).filter(p => p.alive);
  if (alive.length === 0) {
    clearInterval(room.survivalInterval);
    room.survivalInterval = null;
    // Score = turns survived
    room.players.forEach(p => { p.score += room.turn; });
    room.leaderboard = [...room.players].sort((a, b) => b.score - a.score);
    io.to(code).emit('survival_over', { turn: room.turn, players: room.players, leaderboard: room.leaderboard });
  }
}

function checkAllActed(code, room) {
  const alive = Object.values(room.survivalPlayers).filter(p => p.alive);
  if (alive.every(p => p.actedThisTurn)) {
    // All acted — advance turn immediately
    survivalTick(code, room);
    if (room.survivalInterval) { clearInterval(room.survivalInterval); }
    room.survivalInterval = setInterval(() => survivalTick(code, room), 3000);
  }
}

function broadcastSurvival(code, room) {
  io.to(code).emit('survival_state', {
    players: room.survivalPlayers,
    mobs: room.mobs,
    barriers: room.barriers,
    turn: room.turn,
    aiActive: room.aiActive,
    grid: GRID,
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Arcade server on port ${PORT}`));
