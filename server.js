// ══════════════════════════════════════════════════════════════
// JL Arcade — server.js (punto de entrada limpio)
// Cada juego vive en games/<nombre>/ — editar sin miedo
// ══════════════════════════════════════════════════════════════
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const https      = require('https');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db     = require('./db');
const auth   = require('./auth');

// ── MÓDULOS DE JUEGOS ─────────────────────────────────────────
const { registerDndRoutes, registerDndSockets } = require('./games/dnd/dnd-handlers');
const { emptySurvivalRoom, registerSurvivalSockets, startSurvival, GRID, BASE_SHOOT_RANGE } = require('./games/survival/survival');
const { registerHumanoSockets }  = require('./games/humano/humano');
const { registerHangmanSockets } = require('./games/hangman/hangman');

// ── AUTH MIDDLEWARE ───────────────────────────────────────────
function requireAuth(req, res, next) {
  const h = req.headers.authorization;
  if(!h || !h.startsWith('Bearer ')) return res.status(401).json({error:'No autenticado'});
  const payload = auth.verifyToken(h.slice(7));
  if(!payload) return res.status(401).json({error:'Token inválido'});
  req.user = payload;
  next();
}

// ── AUTH ROUTES ───────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  try {
    const {username, password, displayName} = req.body;
    if(!username||!password) return res.status(400).json({error:'Faltan campos'});
    if(username.length<3||username.length>20) return res.status(400).json({error:'Usuario: 3-20 caracteres'});
    if(password.length<4) return res.status(400).json({error:'Contraseña mín. 4 caracteres'});
    const existing = await db.getUserByUsername(username);
    if(existing) return res.status(409).json({error:'Nombre de usuario ya existe'});
    const hash = await auth.hashPassword(password);
    const user = await db.createUser(username, hash, displayName);
    const token = auth.signToken(user.id, user.username);
    res.json({token, user:{id:user.id, username:user.username, displayName:user.display_name}});
  } catch(e) { console.error('Register error:', e.message); res.status(500).json({error:'Error al registrar'}); }
});

app.post('/api/login', async (req, res) => {
  try {
    const {username, password} = req.body;
    if(!username||!password) return res.status(400).json({error:'Faltan campos'});
    const user = await db.getUserByUsername(username);
    if(!user) return res.status(401).json({error:'Usuario o contraseña incorrectos'});
    const ok = await auth.verifyPassword(password, user.password_hash);
    if(!ok) return res.status(401).json({error:'Usuario o contraseña incorrectos'});
    const token = auth.signToken(user.id, user.username);
    res.json({token, user:{id:user.id, username:user.username, displayName:user.display_name}});
  } catch(e) { console.error('Login error:', e.message); res.status(500).json({error:'Error al iniciar sesión'}); }
});

app.get('/api/me', requireAuth, async (req, res) => {
  const user = await db.getUserById(req.user.userId);
  if(!user) return res.status(404).json({error:'Usuario no encontrado'});
  res.json({user:{id:user.id, username:user.username, displayName:user.display_name}});
});

app.get('/api/sv-leaderboard', async (req, res) => {
  try {
    const [solo, duo] = await Promise.all([db.getSvLeaderboard('solo',20), db.getSvLeaderboard('duo',20)]);
    res.json({solo, duo});
  } catch(e) { res.json({solo:[], duo:[]}); }
});

// ── CHARACTER & UNIVERSE REST ENDPOINTS ──────────────────────
app.get('/api/universes', async (req, res) => {
  try { res.json(await db.getUniverses()); } catch(e) { res.json([]); }
});
app.get('/api/universes/:id', async (req, res) => {
  try {
    const u = await db.getUniverseById(req.params.id);
    if(!u) return res.status(404).json({error:'Universo no encontrado'});
    res.json(u);
  } catch(e) { res.status(500).json({error:'Error'}); }
});
app.get('/api/universes/:id/history', async (req, res) => {
  try {
    const [history, legends] = await Promise.all([db.getUniverseHistory(req.params.id,30), db.getUniverseLegends(req.params.id)]);
    res.json({history, legends});
  } catch(e) { res.json({history:[],legends:[]}); }
});
app.get('/api/universes/:id/missions', async (req, res) => {
  const minLv=parseInt(req.query.minLevel)||1, maxLv=parseInt(req.query.maxLevel)||20;
  try { res.json(await db.getMissionsForUniverse(req.params.id, minLv, maxLv)); } catch(e) { res.json([]); }
});
app.get('/api/characters', requireAuth, async (req, res) => {
  try { res.json(await db.getCharactersByUser(req.user.userId)); } catch(e) { res.json([]); }
});
app.get('/api/characters/:id', requireAuth, async (req, res) => {
  try {
    const c = await db.getCharacterById(req.params.id);
    if(!c) return res.status(404).json({error:'No encontrado'});
    if(c.user_id!==req.user.userId) return res.status(403).json({error:'No autorizado'});
    res.json(c);
  } catch(e) { res.status(500).json({error:'Error'}); }
});
app.get('/api/characters/:id/adventures', requireAuth, async (req, res) => {
  try {
    const c = await db.getCharacterById(req.params.id);
    if(!c||c.user_id!==req.user.userId) return res.status(403).json({error:'No autorizado'});
    res.json(await db.getCharacterAdventures(req.params.id));
  } catch(e) { res.json([]); }
});
app.get('/api/dnd/resume/:characterId', requireAuth, async (req, res) => {
  try {
    const ongoing = await db.getOngoingAdventure(req.params.characterId);
    if(!ongoing || !ongoing.session_data?.lastScene) return res.json({hasOngoing:false});
    const snap = ongoing.session_data;
    res.json({
      hasOngoing: true,
      adventureId: ongoing.id,
      missionTitle: snap.missionTitle || ongoing.mission_title || 'Aventura',
      location: snap.currentLocation,
      chapter: snap.chapter || 1,
      lastNarration: snap.lastScene?.narration?.slice(0,200) || '',
      savedAt: snap.savedAt,
    });
  } catch(e) { res.json({hasOngoing:false}); }
});
app.get('/api/dnd/shop/:universeId', async (req, res) => {
  try { res.json({items: await db.getShopItems(req.params.universeId)}); }
  catch(e) { res.json({items:[]}); }
});

// ── REGISTRAR RUTAS D&D (skills, adventures, etc.) ────────────
registerDndRoutes(app, requireAuth);

// ── CLAUDE API (para ahorcado solo y humano) ──────────────────
function callClaude(prompt, maxTokens) {
  return new Promise((resolve) => {
    const body = JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:maxTokens||100,messages:[{role:'user',content:prompt}]});
    const options = {hostname:'api.anthropic.com',path:'/v1/messages',method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':(process.env.ANTHROPIC_API_KEY||'').trim(),'anthropic-version':'2023-06-01','Content-Length':Buffer.byteLength(body)}};
    // Timeout de 25s para evitar que la promesa quede colgada
    const timer = setTimeout(() => resolve(null), 25000);
    const req = https.request(options,(res)=>{
      let data='';
      res.on('data',c=>data+=c);
      res.on('end',()=>{
        clearTimeout(timer);
        try{resolve(JSON.parse(data).content.map(b=>b.text||'').join('').replace(/```json|```/g,'').trim());}
        catch{resolve(null);}
      });
    });
    req.on('error',()=>{ clearTimeout(timer); resolve(null); });
    req.setTimeout(25000, ()=>{ req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

// ── HELPERS COMPARTIDOS ───────────────────────────────────────
const rooms = {};
function genCode() { return Math.random().toString(36).substring(2,7).toUpperCase(); }
function shuffle(arr) {
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}

// ¿Quién es Humano? — sin perfiles hardcodeados
// El estilo se aprende solo de las partidas reales jugadas (writing_samples)
// Cada jugador tiene su propio estilo acumulado en la DB
async function genBotAnswers(q,humanAnswer,profile,extra,count,writingSamples,bannedWords){
  // ── Estilo real del humano ────────────────────────────────
  let styleSection='';
  if(writingSamples&&writingSamples.length>0){
    const ex=writingSamples.slice(0,12).map((s,i)=>`[${i+1}] P:"${s.question}" → R:"${s.answer}"`).join('\n');
    styleSection=`\n\nESTILO REAL DEL HUMANO — copia EXACTAMENTE este patrón de escritura:\n${ex}\nAnálisis obligatorio antes de escribir: ¿usa mayúsculas? ¿qué tan largas son sus respuestas? ¿usa puntuación o no? ¿tiene muletillas? ¿qué tan formal/informal es? Replica todo eso.`;
  }

  // ── Palabras prohibidas de este grupo ────────────────────
  const bannedList=(bannedWords&&bannedWords.length>0)
    ? bannedWords.map(w=>typeof w==='object'?w.word:w).join(', ')
    : '';
  const bannedSection=bannedList
    ? `\n\nPALABRAS PROHIBIDAS (este grupo las detecta como IA — NUNCA las uses): ${bannedList}`
    : '';

  // ── Palabras IA universales siempre prohibidas ────────────
  const neverUse=`\n\nPALABRAS DE IA QUE NUNCA PUEDES USAR (son marcadores obvios de IA):\nfascinante, interesante, sin duda, por supuesto, ciertamente, en efecto, absolutamente, definitivamente, profundamente, reflexionar, considerar, explorar, navegar, comprender, en términos de, en el contexto de, es importante, cabe destacar, cabe señalar, a menudo, generalmente, fundamentalmente, en última instancia, en este sentido, al respecto, podría decirse, me parece que sería, es crucial, resulta evidente, vale la pena`;

  // ── Contexto extra (instrucciones del jugador) ────────────
  // ESTAS INSTRUCCIONES SON LEY — no opcionales, no ignorar
  const instruccion=extra
    ? `\n\nINSTRUCCIÓN OBLIGATORIA DEL JUGADOR (sigue esto al pie de la letra en TODAS las respuestas, sin excepción): "${extra}"\nEsta instrucción tiene prioridad sobre todo lo demás. Si dice "responde en una palabra", todas las respuestas son de una palabra. Si dice "responde como si fueras un niño", usa lenguaje infantil. Obedece sin importar qué.`
    : '';

  const humanLen=humanAnswer.split(' ').length;
  const lenRule=`\n\nLONGITUD: La respuesta humana tiene ${humanLen} palabras. Cada bot debe responder con ${humanLen<=3?'1-4':humanLen<=8?humanLen+'-'+(humanLen+3):(humanLen-2)+'-'+(humanLen+3)} palabras. NUNCA hagas respuestas más largas que esto.`;

  const prompt=`Eres un imitador humano en el juego "¿Quién es Humano?". Generas respuestas que parezcan escritas por un humano real.${styleSection}${bannedSection}${neverUse}${instruccion}${lenRule}

PREGUNTA: "${q}"
RESPUESTA DEL HUMANO REAL: "${humanAnswer}"

REGLAS (todas obligatorias, ninguna es sugerencia):
• Genera exactamente ${count} respuestas distintas entre sí y distintas a la del humano
• Cada respuesta debe sonar como habla cotidiana real — sin florituras, sin frases elaboradas
• Copia el nivel de informalidad, los errores tipográficos, la puntuación del humano
• Si el humano responde con una palabra, tú también. Si usa punto final, tú también.
• NO empieces respuestas con "Yo", "Pues", "La verdad", "Creo que" si el humano no lo hace
• NUNCA pongas explicaciones entre paréntesis o aclaraciones que un humano no pondría

Responde SOLO con JSON válido, sin texto previo ni explicación:
{"answers":["respuesta1",...,"respuesta${count}"]}
(exactamente ${count} elementos en el array)`;

  const t=await callClaude(prompt,2800);
  // Null-safe: si callClaude falla o timeout, devolver fallback inmediatamente
  if(!t) return Array.from({length:count},(_,i)=>[
    'no sé la verdad','pues más o menos','jaja eso es difícil','depende del día',
    'ni idea','eso varía mucho','toca pensarlo','a veces sí','uf complicado','como siempre'
  ][i%10]);
  try{
    const clean=t.replace(/```json|```/g,'').trim();
    const p=JSON.parse(clean);
    if(Array.isArray(p.answers)&&p.answers.length>0){
      // Rellenar si devolvió menos de los pedidos
      while(p.answers.length<count) p.answers.push(['claro','depende','quizás','a veces','ni idea'][p.answers.length%5]);
      return p.answers.slice(0,count);
    }
    throw 0;
  }
  catch{
    return Array.from({length:count},(_,i)=>[
      'no sé la verdad','pues más o menos','jaja eso es difícil','depende del día',
      'ni idea','eso varía mucho','toca pensarlo','a veces sí','uf complicado','como siempre'
    ][i%10]);
  }
}
async function claudeAskQuestion(round,totalRounds,profile){
  // profile ya no se usa — preguntas genéricas que valen para cualquier jugador
  const t=await callClaude(`Eres interrogador en el juego "¿Quién es Humano?". Genera UNA pregunta corta (máx 15 palabras) para ronda ${round}/${totalRounds}. La pregunta debe ser personal y provocar respuestas únicas que sean difíciles de imitar. Evita preguntas sobre nombres, lugares específicos o datos personales. Solo JSON: {"question":"..."}`,200);
  try{return JSON.parse(t).question;}catch{return '¿Qué harías si tuvieras un día libre sin ninguna obligación?';}
}
async function claudeGuessHuman(answers,question){
  const t=await callClaude(`Eres interrogador. Pregunta: "${question}". Respuestas: ${JSON.stringify(answers.map(a=>({label:a.label,answer:a.answer})))}\nAnaliza cuál es más humana y auténtica. Solo JSON: {"guess": NUMERO, "reasoning": "explicación breve"}`,300);
  try{const r=JSON.parse(t);return{guess:r.guess,reasoning:r.reasoning};}catch{return{guess:answers[Math.floor(Math.random()*answers.length)]?.label,reasoning:'Intuición.'};}
}

const HM_WORDS=['javascript','programacion','universidad','colombia','bucaramanga','medellin','contaduria','psicologia','computadora','telefono','cumpleanos','noviembre','diciembre','septiembre','octubre','chocolate','aguacate','mariposa','elefante','cocodrilo','helicoptero','submarino','dinosaurio','periodista','arquitecto'];

const socketUsers = {};

// ── SOCKET ────────────────────────────────────────────────────
const helpers = { genCode, shuffle, emptySurvivalRoom, callClaude,
                  genBotAnswers, claudeAskQuestion, claudeGuessHuman, HM_WORDS, db,
                  rooms, io, GRID, BASE_SHOOT_RANGE,
                  startHumanoSoloRound, startHangman, startHangmanSolo };

const handleDndSocket      = registerDndSockets(io, rooms, socketUsers, helpers);
const handleSurvivalSocket = registerSurvivalSockets(io, rooms, socketUsers);
const handleHumanoSocket   = registerHumanoSockets ? registerHumanoSockets(io, rooms, socketUsers, helpers) : null;
const handleHangmanSocket  = registerHangmanSockets ? registerHangmanSockets(io, rooms, socketUsers, helpers) : null;

io.on('connection', (socket) => {

  socket.on('authenticate', ({token}) => {
    if(!token){delete socketUsers[socket.id];return;}
    const payload=auth.verifyToken(token);
    if(payload){socketUsers[socket.id]={userId:payload.userId,username:payload.username};socket.emit('authenticated',{userId:payload.userId,username:payload.username});}
  });

  socket.on('create_room', ({name, game, solo}) => {
    const code = genCode();
    const authUser = socketUsers[socket.id];
    const displayName = authUser ? authUser.username : name;
    rooms[code] = {
      game, phase:'lobby', solo:!!solo,
      players:[{id:socket.id,name:displayName,role:'human',score:0,userId:authUser?.userId||null}],
      humanId:socket.id, interrogatorId:null,
      profile:null, // sin perfil hardcodeado — el estilo se aprende de partidas reales
      extraContext:null,allAnswers:[],activeAnswers:[],eliminationRound:0,leaderboard:[],
      totalRounds:3,currentRound:1,newQuestionCount:0,
      hm:{word:'',guessed:[],wrongGuesses:0},
      sv:emptySurvivalRoom(),
    };
    socket.join(code); socket.roomCode=code;
    if(solo){
      rooms[code].phase='playing';
      if(game==='humano'){rooms[code].interrogatorId='claude'; startHumanoSolo(code,rooms[code]);}
      else if(game==='hangman') startHangmanSolo(code,rooms[code]);
      else if(game==='survival') startSurvival(code,rooms[code],io);
      else if(game==='dnd'){socket.emit('room_created',{code,game,players:rooms[code].players});}
    } else {
      socket.emit('room_created',{code,game,players:rooms[code].players});
    }
  });

  socket.on('join_room', ({name,code}) => {
    const room=rooms[code];
    if(!room) return socket.emit('error','Sala no encontrada');
    if(room.phase!=='lobby') return socket.emit('error','La partida ya comenzó');
    const authUser = socketUsers[socket.id];
    const displayName = authUser ? authUser.username : name;
    const role=room.game==='survival'?'player':room.game==='hangman'?'guesser':room.game==='dnd'?'player':'interrogator';
    room.players.push({id:socket.id,name:displayName,role,score:0,userId:authUser?.userId||null});
    if(role==='interrogator') room.interrogatorId=socket.id;
    socket.join(code); socket.roomCode=code;
    io.to(code).emit('player_joined',{players:room.players});
    socket.emit('joined_room',{code,game:room.game,role,players:room.players});
  });

  socket.on('configure_game', ({totalRounds}) => {
    const code=socket.roomCode,room=rooms[code];
    if(!room||room.game!=='humano') return;
    room.totalRounds=Math.max(1,Math.min(10,totalRounds||3));
    io.to(code).emit('game_configured',{totalRounds:room.totalRounds});
  });

  socket.on('start_game', () => {
    const code=socket.roomCode,room=rooms[code];
    if(!room) return; room.phase='playing';
    if(room.game==='humano') startHumano(code,room);
    else if(room.game==='hangman') startHangman(code,room);
    else if(room.game==='survival') startSurvival(code,room,io);
  });

  socket.on('play_again', () => {
    const code=socket.roomCode,room=rooms[code];
    if(!room) return;
    if(room.game==='humano'&&!room.solo){[room.humanId,room.interrogatorId]=[room.interrogatorId,room.humanId];room.players.forEach(p=>{p.role=p.id===room.humanId?'human':'interrogator';});}
    if(room.game==='hangman') room.players.forEach(p=>{p.role=p.role==='drawer'?'guesser':'drawer';});
    room.allAnswers=[];room.activeAnswers=[];room.extraContext=null;room.eliminationRound=0;
    room.currentRound=1;room.newQuestionCount=0;
    room.players.forEach(p=>p.score=0);
    room.hm={word:'',guessed:[],wrongGuesses:0};
    room.sv=emptySurvivalRoom();
    room.phase='playing';
    if(room.solo){
      if(room.game==='humano'){room.interrogatorId='claude';startHumanoSolo(code,room);}
      else if(room.game==='hangman') startHangmanSolo(code,room);
      else if(room.game==='survival') startSurvival(code,room,io);
    } else {
      room.phase='lobby';
      io.to(code).emit('rematch_ready',{players:room.players,leaderboard:room.leaderboard,totalRounds:room.totalRounds||3});
    }
  });

  socket.on('get_global_lb', async () => {
    try { const rows = await db.getHumanoLeaderboard(20); socket.emit('global_lb',{leaderboard:rows}); }
    catch(e) { socket.emit('global_lb',{leaderboard:[]}); }
  });

  // ── DELEGAR A MÓDULOS DE JUEGO ────────────────────────────
  if(handleHumanoSocket)   handleHumanoSocket(socket);
  if(handleHangmanSocket)  handleHangmanSocket(socket);
  if(handleSurvivalSocket) handleSurvivalSocket(socket);
  if(handleDndSocket)      handleDndSocket(socket);

  socket.on('disconnect', () => {
    delete socketUsers[socket.id];
    const code=socket.roomCode;
    if(!code||!rooms[code]) return;
    io.to(code).emit('player_left');
    delete rooms[code];
  });
});

// ── GAME STARTERS (humano/hangman — usan callClaude) ──────────
async function startHumanoSolo(code, room) {
  room.eliminationRound=0;room.allAnswers=[];room.activeAnswers=[];room.extraContext=null;
  room.currentRound=1;room.newQuestionCount=0;
  io.to(code).emit('game_started',{players:room.players,totalRounds:room.totalRounds||3,solo:true});
  startHumanoSoloRound(code,room);
}
async function startHumanoSoloRound(code, room) {
  if(!rooms[code]) return;
  const question=await claudeAskQuestion(room.currentRound,room.totalRounds||3,room.profile);
  room.question=question;
  io.to(code).emit('solo_claude_question',{question,currentRound:room.currentRound,totalRounds:room.totalRounds||3});
  io.to(room.humanId).emit('answer_question',{question});
}
function startHumano(code,room){
  room.eliminationRound=0;room.allAnswers=[];room.activeAnswers=[];room.extraContext=null;
  room.currentRound=1;room.newQuestionCount=0;
  const tr=room.totalRounds||3;
  io.to(code).emit('game_started',{players:room.players,totalRounds:tr});
  io.to(room.interrogatorId).emit('your_turn_to_ask',{currentRound:1,totalRounds:tr});
  io.to(room.humanId).emit('waiting_for_question',{currentRound:1,totalRounds:tr});
}
function startHangman(code,room){
  const word=HM_WORDS[Math.floor(Math.random()*HM_WORDS.length)];
  room.hm={word,guessed:[],wrongGuesses:0};
  const d=room.players.find(p=>p.role==='drawer');
  const g=room.players.find(p=>p.role==='guesser');
  io.to(d?.id).emit('hangman_drawer',{word});
  io.to(g?.id).emit('hangman_state',{word,guessed:[],wrongGuesses:0,won:false,lost:false});
  io.to(code).emit('hangman_started',{players:room.players});
}
async function startHangmanSolo(code, room) {
  if(!rooms[code]) return;
  const t=await callClaude(`Elige UNA palabra en español para ahorcado. 5-12 letras, sin acentos ni espacios, dificultad media. Solo JSON: {"word":"..."}`,100);
  let word;
  try{word=JSON.parse(t).word.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s/g,'');}
  catch{word=HM_WORDS[Math.floor(Math.random()*HM_WORDS.length)];}
  room.hm={word,guessed:[],wrongGuesses:0};
  room.players[0].role='guesser';
  io.to(code).emit('hangman_started',{players:room.players,solo:true});
  io.to(room.players[0].id).emit('hangman_state',{word,guessed:[],wrongGuesses:0,won:false,lost:false});
}

const PORT = process.env.PORT || 3000;
db.initDB().then(() => {
  server.listen(PORT, () => console.log(`JL Arcade on port ${PORT}`));
}).catch(err => {
  console.error('DB init failed, starting without DB:', err.message);
  server.listen(PORT, () => console.log(`JL Arcade on port ${PORT} (no DB)`));
});
