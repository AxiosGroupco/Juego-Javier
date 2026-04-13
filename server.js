require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const https = require('https');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── AUTH + DB ──────────────────────────────────────────────────
const db = require('./db');
const auth = require('./auth');

// Auth middleware
function requireAuth(req,res,next){
  const h=req.headers.authorization;
  if(!h||!h.startsWith('Bearer ')) return res.status(401).json({error:'No autenticado'});
  const payload=auth.verifyToken(h.slice(7));
  if(!payload) return res.status(401).json({error:'Token inválido'});
  req.user=payload;
  next();
}

// ── REST API ───────────────────────────────────────────────────
app.post('/api/register', async (req,res) => {
  try {
    const {username, password, displayName} = req.body;
    if(!username||!password) return res.status(400).json({error:'Faltan campos'});
    if(username.length<3||username.length>20) return res.status(400).json({error:'Nombre de usuario: 3-20 caracteres'});
    if(password.length<4) return res.status(400).json({error:'Contraseña muy corta (mín. 4 caracteres)'});
    const existing = await db.getUserByUsername(username);
    if(existing) return res.status(409).json({error:'Nombre de usuario ya existe'});
    const hash = await auth.hashPassword(password);
    const user = await db.createUser(username, hash, displayName);
    const token = auth.signToken(user.id, user.username);
    res.json({token, user:{id:user.id, username:user.username, displayName:user.display_name}});
  } catch(e) {
    console.error('Register error:', e.message);
    res.status(500).json({error:'Error al registrar'});
  }
});

app.post('/api/login', async (req,res) => {
  try {
    const {username, password} = req.body;
    if(!username||!password) return res.status(400).json({error:'Faltan campos'});
    const user = await db.getUserByUsername(username);
    if(!user) return res.status(401).json({error:'Usuario o contraseña incorrectos'});
    const ok = await auth.verifyPassword(password, user.password_hash);
    if(!ok) return res.status(401).json({error:'Usuario o contraseña incorrectos'});
    const token = auth.signToken(user.id, user.username);
    res.json({token, user:{id:user.id, username:user.username, displayName:user.display_name}});
  } catch(e) {
    console.error('Login error:', e.message);
    res.status(500).json({error:'Error al iniciar sesión'});
  }
});

app.get('/api/me', requireAuth, async (req,res) => {
  const user = await db.getUserById(req.user.userId);
  if(!user) return res.status(404).json({error:'Usuario no encontrado'});
  res.json({user:{id:user.id, username:user.username, displayName:user.display_name}});
});
setupAuthRoutes(app);

// Init DB on startup
db.initDB().catch(e => console.error('DB init error:', e));

// ── CLAUDE API ─────────────────────────────────────────────────
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
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).content.map(b => b.text||'').join('').replace(/```json|```/g,'').trim()); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

// ── HELPERS ────────────────────────────────────────────────────
const rooms = {};
function genCode() { return Math.random().toString(36).substring(2,7).toUpperCase(); }
function shuffle(arr) {
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}

// ── JAVIER PROFILE ─────────────────────────────────────────────
const JAVIER_PROFILE = `Nombre: Javier Alexis Navas Zúñiga, 22 años (6 abril). Bucaramanga, U. Santo Tomás, Contaduría 9° sem, gradúa octubre. Novia: Laura Tobón, 21 años (13 dic), Psicología 9° sem U. Antioquia Santa Fe, trabaja Corantioquia, vive Sopetrán (Javier dice Medellín). 6 años juntos (Javier dice 7), novios desde 25 oct, se conocieron 15 sep. Apodo de Laura a Javier: panda. Apodo de Javier a Laura: esposa. Colores Laura: rosa/negro/beige. Javier: negro/morado/azul-verde agua marina.`;
function isJavier(n){const x=n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');return x.includes('javier')||x.includes('starling')||x.includes('navas')||x.includes('panda');}
async function classifyQ(q){const t=await callClaude(`Perfil:${JAVIER_PROFILE}\nPregunta:"${q}"\n¿Respuesta deducible? Solo: {"covered":true} o {"covered":false}`,50);try{return JSON.parse(t).covered===true;}catch{return false;}}

// ── STYLE-AWARE BOT GENERATION ─────────────────────────────────
async function genBotAnswers(q, humanAnswer, profile, extra, count, writingSamples) {
  let styleSection = '';
  if (writingSamples && writingSamples.length > 0) {
    const examples = writingSamples.slice(0, 8).map((s,i) =>
      `Ejemplo ${i+1} — Pregunta: "${s.question}" → Respuesta: "${s.answer}"`
    ).join('\n');
    styleSection = `\nESTILO DE ESCRITURA DEL HUMANO (aprende de estos ejemplos reales):
${examples}
INSTRUCCIÓN CRÍTICA: Los bots deben imitar exactamente este estilo — misma longitud aproximada, mismo vocabulario coloquial, mismas muletillas, mismo nivel de detalle, misma puntuación informal. Si el humano usa puntos suspensivos, errores tipográficos, emojis o abreviaciones, los bots también deben hacerlo de forma similar pero con contenido distinto.`;
  }

  const t = await callClaude(`Juego de imitación.${profile?`\nPERFIL BASE:${profile}`:''}${extra?`\nINFO EXTRA:"${extra}"`:''}${styleSection}
Pregunta actual:"${q}"
Respuesta del humano en esta ronda:"${humanAnswer}"
Genera EXACTAMENTE ${count} respuestas alternativas que:
- Imiten el estilo de escritura del humano lo más fielmente posible
- Sean plausibles como respuesta a la pregunta
- Tengan contenido distinto entre sí y distinto a la respuesta humana
- Mantengan la misma longitud aproximada y tono
Solo JSON:{"answers":["r1","r2",...]}`, 2500);

  try {
    const p = JSON.parse(t);
    if (p.answers?.length >= count) return p.answers.slice(0, count);
    throw 0;
  } catch {
    return Array.from({length:count},(_,i)=>
      ['Mmm no lo había pensado así.','Pues uno se adapta.','Difícil explicarlo.','Jaja buena pregunta.',
       'Creo que bien.','Uff complicado.','Honestamente no sé.','Habría que verlo.','Lo que toca.','Cada quien.'][i%10]
    );
  }
}

// ── HANGMAN ────────────────────────────────────────────────────
const HM_WORDS=['javascript','programacion','universidad','colombia','bucaramanga','medellin','contaduria','psicologia','computadora','telefono','cumpleanos','noviembre','diciembre','septiembre','octubre','chocolate','aguacate','mariposa','elefante','cocodrilo','helicoptero','submarino','dinosaurio','periodista','arquitecto'];

// ── SURVIVAL ───────────────────────────────────────────────────
const GRID = 12;
function emptySurvivalRoom(){return{svPlayers:{},mobs:[],barriers:[],turn:0,phase:'player_turn',log:[],mobsDefeated:0,spawnCounter:0,aiActive:false};}
function inBounds(x,y){return x>=0&&x<GRID&&y>=0&&y<GRID;}
function manhattan(a,b){return Math.abs(a.x-b.x)+Math.abs(a.y-b.y);}
function spawnMobs(sv,count){
  const occ=new Set([...Object.values(sv.svPlayers).map(p=>`${p.x},${p.y}`),...sv.mobs.map(m=>`${m.x},${m.y}`),...sv.barriers.map(b=>`${b.x},${b.y}`)]);
  for(let i=0;i<count;i++){
    let x,y,tries=0;
    do{const s=Math.floor(Math.random()*4);if(s===0){x=0;y=Math.floor(Math.random()*GRID);}else if(s===1){x=GRID-1;y=Math.floor(Math.random()*GRID);}else if(s===2){x=Math.floor(Math.random()*GRID);y=0;}else{x=Math.floor(Math.random()*GRID);y=GRID-1;}tries++;}while(occ.has(`${x},${y}`)&&tries<50);
    const isTank=sv.turn>10&&Math.random()<0.3;
    sv.mobs.push({id:`m${Date.now()}_${i}`,x,y,hp:isTank?3:1,maxHp:isTank?3:1,type:isTank?'tank':'basic'});
    occ.add(`${x},${y}`);
  }
}
function moveMobs(sv){
  const players=Object.values(sv.svPlayers).filter(p=>p.alive);
  const barrierSet=new Set(sv.barriers.map(b=>`${b.x},${b.y}`));
  const log=[];
  sv.mobs=sv.mobs.map(mob=>{
    if(!players.length)return mob;
    let target=players.reduce((b,p)=>manhattan(mob,p)<manhattan(mob,b)?p:b,players[0]);
    const dist=manhattan(mob,target);
    if(dist===1){
      if(target.shielded>0){target.shielded--;log.push(`🛡 ${target.name} bloqueó`);}
      else{target.hp-=mob.type==='tank'?2:1;log.push(`💥 ${mob.type==='tank'?'Tank':'Mob'} atacó a ${target.name}`);if(target.hp<=0){target.hp=0;target.alive=false;log.push(`☠️ ${target.name} cayó`);}}
      return mob;
    }
    const dx=Math.sign(target.x-mob.x),dy=Math.sign(target.y-mob.y);
    const cands=sv.aiActive?[{x:mob.x+dx,y:mob.y+dy},{x:mob.x+dx,y:mob.y},{x:mob.x,y:mob.y+dy},{x:mob.x-dy,y:mob.y+dx},{x:mob.x+dy,y:mob.y-dx}]:[{x:mob.x+dx,y:mob.y},{x:mob.x,y:mob.y+dy},{x:mob.x+(Math.random()>.5?1:-1),y:mob.y},{x:mob.x,y:mob.y+(Math.random()>.5?1:-1)}];
    for(const c of cands){
      if(!inBounds(c.x,c.y))continue;
      const bi=sv.barriers.findIndex(b=>b.x===c.x&&b.y===c.y);
      if(bi>=0){sv.barriers[bi].hp--;if(sv.barriers[bi].hp<=0){sv.barriers.splice(bi,1);log.push('🧱 Barrera destruida');}return mob;}
      const op=players.find(p=>p.x===c.x&&p.y===c.y);
      if(!op)return{...mob,x:c.x,y:c.y};
    }
    return mob;
  });
  return log;
}
function checkAllActed(sv){return Object.values(sv.svPlayers).filter(p=>p.alive).every(p=>p.acted);}

// ── SOCKET ─────────────────────────────────────────────────────
// Map socket.id -> authenticated user info
const socketUsers = {};

io.on('connection', (socket) => {

  // ── AUTH via socket ──
  socket.on('auth', ({token}) => {
    const payload = verifyToken(token);
    if (payload) {
      socketUsers[socket.id] = { id: payload.id, username: payload.username, displayName: payload.displayName };
      socket.emit('auth_ok', { user: socketUsers[socket.id] });
    } else {
      socket.emit('auth_fail');
    }
  });

  // ── ROOM MANAGEMENT ──
  socket.on('create_room', ({name, game}) => {
    const code = genCode();
    const authUser = socketUsers[socket.id];
    const displayName = authUser ? authUser.displayName : name;
    const useProfile = game==='humano' && isJavier(displayName);
    rooms[code] = {
      game, phase:'lobby',
      players:[{id:socket.id, name:displayName, role:'human', score:0, userId: authUser?.id||null}],
      humanId:socket.id, interrogatorId:null,
      profile: useProfile ? JAVIER_PROFILE : null,
      extraContext:null, allAnswers:[], activeAnswers:[], eliminationRound:0, leaderboard:[],
      totalRounds:3, currentRound:1, newQuestionCount:0,
      hm:{word:'',guessed:[],wrongGuesses:0},
      sv: emptySurvivalRoom(),
    };
    socket.join(code); socket.roomCode=code;
    socket.emit('room_created',{code,game,players:rooms[code].players});
  });

  socket.on('join_room', ({name,code}) => {
    const room=rooms[code];
    if(!room) return socket.emit('error','Sala no encontrada');
    if(room.phase!=='lobby') return socket.emit('error','La partida ya comenzó');
    const authUser = socketUsers[socket.id];
    const displayName = authUser ? authUser.displayName : name;
    const role=room.game==='survival'?'player':room.game==='hangman'?'guesser':'interrogator';
    room.players.push({id:socket.id,name:displayName,role,score:0,userId:authUser?.id||null});
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
    if(!room) return;
    room.phase='playing';
    if(room.game==='humano') startHumano(code,room);
    else if(room.game==='hangman') startHangman(code,room);
    else if(room.game==='survival') startSurvival(code,room);
  });

  socket.on('play_again', () => {
    const code=socket.roomCode,room=rooms[code];
    if(!room) return;
    if(room.game==='humano'){
      [room.humanId,room.interrogatorId]=[room.interrogatorId,room.humanId];
      room.players.forEach(p=>{p.role=p.id===room.humanId?'human':'interrogator';});
    }
    if(room.game==='hangman'){
      room.players.forEach(p=>{p.role=p.role==='drawer'?'guesser':'drawer';});
    }
    room.phase='lobby';
    room.allAnswers=[];room.activeAnswers=[];room.extraContext=null;room.eliminationRound=0;
    room.currentRound=1;room.newQuestionCount=0;
    room.players.forEach(p=>p.score=0);
    room.hm={word:'',guessed:[],wrongGuesses:0};
    room.sv=emptySurvivalRoom();
    io.to(code).emit('rematch_ready',{players:room.players,leaderboard:room.leaderboard,totalRounds:room.totalRounds||3});
  });

  // ── HUMANO ──
  socket.on('submit_question', async ({question}) => {
    const code=socket.roomCode,room=rooms[code];
    if(!room||room.game!=='humano') return;
    room.question=question;
    if(room.profile){
      const covered=await classifyQ(question);
      if(!covered){
        io.to(room.humanId).emit('need_extra_context',{question});
        io.to(room.interrogatorId).emit('waiting_for_answers',{question});
        return;
      }
    }
    room.extraContext=null;
    io.to(room.humanId).emit('answer_question',{question});
    io.to(room.interrogatorId).emit('waiting_for_answers',{question});
  });

  socket.on('submit_extra_context', ({context}) => {
    const code=socket.roomCode,room=rooms[code];
    if(!room) return;
    room.extraContext=context;
    io.to(room.humanId).emit('answer_question',{question:room.question});
  });

  socket.on('submit_human_answer', async ({answer}) => {
    const code=socket.roomCode,room=rooms[code];
    if(!room||socket.id!==room.humanId) return;
    room.humanAnswer=answer;
    io.to(room.humanId).emit('generating_bots');
    io.to(room.interrogatorId).emit('generating_bots_wait');

    // Save writing sample to DB if user is authenticated
    const humanPlayer = room.players.find(p=>p.id===room.humanId);
    let writingSamples = [];
    if (humanPlayer?.userId) {
      try {
        await db.saveWritingSample(humanPlayer.userId, room.question, answer, code);
        writingSamples = await db.getWritingSamples(humanPlayer.userId, 20);
      } catch(e) { console.error('DB write sample error:', e); }
    }

    const bots=await genBotAnswers(room.question,answer,room.profile,room.extraContext,10,writingSamples);
    const pool=shuffle([
      {id:'human',answer,isHuman:true,eliminated:false},
      ...bots.map((a,i)=>({id:`bot${i}`,answer:a,isHuman:false,eliminated:false}))
    ]).map((a,i)=>({...a,label:i+1}));
    room.allAnswers=pool;room.activeAnswers=[...pool];room.eliminationRound=0;
    const visible=pool.map(a=>({label:a.label,answer:a.answer}));
    io.to(room.interrogatorId).emit('eliminate_now',{
      question:room.question,answers:visible,remaining:visible.length,
      eliminationRound:0,newQuestionPenalty:room.newQuestionCount*25,
      currentRound:room.currentRound,totalRounds:room.totalRounds||3
    });
    io.to(room.humanId).emit('being_judged',{question:room.question,answers:visible,remaining:visible.length,currentRound:room.currentRound,totalRounds:room.totalRounds||3});
  });

  socket.on('request_new_question', () => {
    const code=socket.roomCode,room=rooms[code];
    if(!room||socket.id!==room.interrogatorId) return;
    room.newQuestionCount=(room.newQuestionCount||0)+1;
    const penalty=room.newQuestionCount*25;
    const iP=room.players.find(p=>p.id===room.interrogatorId);
    if(iP) iP.score=Math.max(0,iP.score-penalty);
    room.allAnswers=[];room.activeAnswers=[];room.eliminationRound=0;room.extraContext=null;
    const tr=room.totalRounds||3;
    io.to(room.interrogatorId).emit('your_turn_to_ask',{penalty,newQuestionCount:room.newQuestionCount,currentRound:room.currentRound,totalRounds:tr});
    io.to(room.humanId).emit('waiting_for_question',{currentRound:room.currentRound,totalRounds:tr});
    io.to(code).emit('score_update',{players:room.players,penaltyMsg:`Nueva pregunta solicitada: −${penalty} pts`});
  });

  socket.on('submit_elimination', ({labels,finalGuess}) => {
    const code=socket.roomCode,room=rooms[code];
    if(!room||socket.id!==room.interrogatorId) return;

    const interPts=(r)=>{const pts=[100,75,50,25,10];return pts[Math.min(r,pts.length-1)];};
    const humanSurvivePts=(r)=>r*25;

    const finishRound=(interDelta,humanDelta,resultData)=>{
      const iP=room.players.find(p=>p.id===room.interrogatorId);
      const hP=room.players.find(p=>p.id===room.humanId);
      if(iP) iP.score=Math.max(0,iP.score+interDelta);
      if(hP) hP.score=Math.max(0,hP.score+humanDelta);

      // Save scores to DB
      if(iP?.userId) db.saveScore(iP.userId,'humano','interrogator',Math.max(0,interDelta)).catch(console.error);
      if(hP?.userId) db.saveScore(hP.userId,'humano','human',Math.max(0,humanDelta)).catch(console.error);

      room.leaderboard=[...room.players].sort((a,b)=>b.score-a.score);
      const totalRounds=room.totalRounds||3;
      const roundDone=room.currentRound>=totalRounds;

      io.to(code).emit('game_result',{
        ...resultData,
        interrogatorPts:Math.max(0,interDelta),
        humanPts:Math.max(0,humanDelta),
        players:room.players,leaderboard:room.leaderboard,allAnswers:room.allAnswers,
        currentRound:room.currentRound,totalRounds,roundDone
      });

      if(!roundDone){
        room.currentRound++;
        [room.humanId,room.interrogatorId]=[room.interrogatorId,room.humanId];
        room.players.forEach(p=>{p.role=p.id===room.humanId?'human':'interrogator';});
        room.allAnswers=[];room.activeAnswers=[];room.eliminationRound=0;room.extraContext=null;room.newQuestionCount=0;
      }
    };

    if(finalGuess){
      const chosen=room.activeAnswers.find(a=>a.label===finalGuess);
      const isH=chosen?.isHuman;
      const hE=room.allAnswers.find(a=>a.isHuman);
      const ip=interPts(room.eliminationRound);
      const hp=humanSurvivePts(room.eliminationRound);
      finishRound(isH?ip:-50,isH?0:hp,{isHuman:isH,humanLabel:hE?.label,guessedLabel:finalGuess,humanAnswer:hE?.answer,eliminationRound:room.eliminationRound});
      return;
    }

    room.eliminationRound++;
    const elimH=labels.some(l=>room.activeAnswers.find(a=>a.label===l)?.isHuman);
    labels.forEach(l=>{const e=room.activeAnswers.find(a=>a.label===l);if(e)e.eliminated=true;});
    room.activeAnswers=room.activeAnswers.filter(a=>!a.eliminated);

    if(elimH){
      const hE=room.allAnswers.find(a=>a.isHuman);
      const hp=humanSurvivePts(room.eliminationRound);
      finishRound(-hp,hp,{isHuman:false,humanLabel:hE?.label,humanEliminated:true,humanAnswer:hE?.answer,eliminationRound:room.eliminationRound});
      return;
    }
    if(room.activeAnswers.length===1&&room.activeAnswers[0].isHuman){
      const hE=room.allAnswers.find(a=>a.isHuman);
      const ip=interPts(room.eliminationRound);
      finishRound(ip,0,{isHuman:true,humanLabel:hE?.label,humanAnswer:hE?.answer,foundByElimination:true,eliminationRound:room.eliminationRound});
      return;
    }
    const visible=room.activeAnswers.map(a=>({label:a.label,answer:a.answer}));
    io.to(room.interrogatorId).emit('eliminate_now',{
      question:room.question,answers:visible,remaining:visible.length,
      eliminationRound:room.eliminationRound,newQuestionPenalty:(room.newQuestionCount||0)*25+25,
      currentRound:room.currentRound,totalRounds:room.totalRounds||3
    });
    io.to(room.humanId).emit('being_judged',{question:room.question,answers:visible,remaining:visible.length,currentRound:room.currentRound,totalRounds:room.totalRounds||3});
  });

  // ── HANGMAN ──
  socket.on('hangman_guess', ({letter}) => {
    const code=socket.roomCode,room=rooms[code];
    if(!room||room.game!=='hangman') return;
    const w=room.hm.word;
    if(room.hm.guessed.includes(letter)) return;
    room.hm.guessed.push(letter);
    if(!w.includes(letter)) room.hm.wrongGuesses++;
    const won=w.split('').every(c=>room.hm.guessed.includes(c));
    const lost=room.hm.wrongGuesses>=6;
    io.to(code).emit('hangman_state',{word:w,guessed:room.hm.guessed,wrongGuesses:room.hm.wrongGuesses,won,lost});
    if(won||lost){
      const g=room.players.find(p=>p.role==='guesser');
      const d=room.players.find(p=>p.role==='drawer');
      if(won&&g) g.score+=Math.max(1,6-room.hm.wrongGuesses);
      if(lost&&d) d.score+=2;
      room.leaderboard=[...room.players].sort((a,b)=>b.score-a.score);
      io.to(code).emit('hangman_over',{won,word:w,players:room.players,leaderboard:room.leaderboard});
    }
  });

  socket.on('hangman_new_word', ({word}) => {
    const code=socket.roomCode,room=rooms[code];
    if(!room) return;
    room.hm={word:word.toLowerCase().replace(/\s/g,''),guessed:[],wrongGuesses:0};
    room.players.forEach(p=>{p.role=p.role==='drawer'?'guesser':'drawer';});
    const d=room.players.find(p=>p.role==='drawer');
    const g=room.players.find(p=>p.role==='guesser');
    io.to(d?.id).emit('hangman_drawer',{word:room.hm.word});
    io.to(g?.id).emit('hangman_state',{word:room.hm.word,guessed:[],wrongGuesses:0,won:false,lost:false});
    io.to(code).emit('hangman_started',{players:room.players});
  });

  // ── SURVIVAL ──
  socket.on('sv_action', ({action,targetX,targetY}) => {
    const code=socket.roomCode,room=rooms[code];
    if(!room||room.game!=='survival') return;
    const sv=room.sv;
    if(sv.phase!=='player_turn') return;
    const p=sv.svPlayers[socket.id];
    if(!p||!p.alive||p.acted) return;
    const barrierSet=new Set(sv.barriers.map(b=>`${b.x},${b.y}`));
    const playerSet=new Set(Object.values(sv.svPlayers).filter(x=>x.alive&&x.id!==socket.id).map(x=>`${x.x},${x.y}`));
    let logMsg='';
    if(action==='move'){
      if(!inBounds(targetX,targetY))return;if(barrierSet.has(`${targetX},${targetY}`))return;if(playerSet.has(`${targetX},${targetY}`))return;
      if(Math.abs(targetX-p.x)>1||Math.abs(targetY-p.y)>1)return;
      p.x=targetX;p.y=targetY;logMsg=`🚶 ${p.name} se movió`;
    } else if(action==='shoot'){
      if(Math.abs(targetX-p.x)>1||Math.abs(targetY-p.y)>1)return;
      const dx=Math.sign(targetX-p.x),dy=Math.sign(targetY-p.y);if(dx===0&&dy===0)return;
      let hit=false,cx=p.x+dx,cy=p.y+dy;
      while(inBounds(cx,cy)){
        const bi=sv.barriers.findIndex(b=>b.x===cx&&b.y===cy);
        if(bi>=0){sv.barriers[bi].hp--;if(sv.barriers[bi].hp<=0)sv.barriers.splice(bi,1);logMsg=`🔫 ${p.name} disparó a barrera`;hit=true;break;}
        const mi=sv.mobs.findIndex(m=>m.x===cx&&m.y===cy);
        if(mi>=0){sv.mobs[mi].hp--;if(sv.mobs[mi].hp<=0){sv.mobs.splice(mi,1);sv.mobsDefeated++;logMsg=`🎯 ${p.name} eliminó enemigo!`;}else{logMsg=`🔫 ${p.name} dañó tank`;}hit=true;break;}
        cx+=dx;cy+=dy;
      }
      if(!hit)logMsg=`🔫 ${p.name} disparó al aire`;
    } else if(action==='barrier'){
      if(!inBounds(targetX,targetY))return;if(barrierSet.has(`${targetX},${targetY}`))return;if(playerSet.has(`${targetX},${targetY}`))return;
      if(Math.abs(targetX-p.x)>1||Math.abs(targetY-p.y)>1)return;
      if(p.barriers<=0){socket.emit('sv_error','Sin barreras');return;}
      sv.barriers.push({x:targetX,y:targetY,hp:2});p.barriers--;logMsg=`🧱 ${p.name} colocó barrera`;
    } else if(action==='heal'){
      if(p.heals<=0){socket.emit('sv_error','Sin curaciones');return;}
      p.hp=Math.min(p.maxHp,p.hp+2);p.heals--;logMsg=`💊 ${p.name} se curó`;
    } else if(action==='shield'){
      if(p.shields<=0){socket.emit('sv_error','Sin escudos');return;}
      p.shielded=3;p.shields--;logMsg=`🛡 ${p.name} activó escudo`;
    }
    p.acted=true;
    sv.log.push(logMsg);if(sv.log.length>8)sv.log=sv.log.slice(-8);
    broadcastSV(code,room);
    if(checkAllActed(sv)){sv.phase='mob_turn';broadcastSV(code,room);setTimeout(()=>doMobTurn(code,room),800);}
  });

  socket.on('disconnect', () => {
    delete socketUsers[socket.id];
    const code=socket.roomCode;
    if(!code||!rooms[code]) return;
    io.to(code).emit('player_left');
    delete rooms[code];
  });
});

// ── GAME STARTERS ──────────────────────────────────────────────
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

function startSurvival(code,room){
  const sv=room.sv;
  const positions=shuffle([[2,2],[GRID-3,GRID-3],[2,GRID-3],[GRID-3,2]]);
  room.players.forEach((pl,i)=>{sv.svPlayers[pl.id]={id:pl.id,name:pl.name,x:positions[i][0],y:positions[i][1],hp:5,maxHp:5,alive:true,barriers:3,shields:2,heals:3,shielded:0,acted:false};});
  spawnMobs(sv,3);sv.turn=1;sv.phase='player_turn';
  sv.log=['🎮 ¡La partida comenzó! Elige acción y toca el mapa.'];
  io.to(code).emit('sv_started',{svPlayers:sv.svPlayers,mobs:sv.mobs,barriers:sv.barriers,grid:GRID,turn:sv.turn,log:sv.log,phase:sv.phase,aiActive:false});
}

function doMobTurn(code,room){
  const sv=room.sv;if(!rooms[code])return;
  const mobLog=moveMobs(sv);sv.log.push(...mobLog);if(sv.log.length>8)sv.log=sv.log.slice(-8);
  const alivePlayers=Object.values(sv.svPlayers).filter(p=>p.alive);
  if(alivePlayers.length===0){
    sv.phase='game_over';
    room.players.forEach(p=>{p.score+=sv.turn;if(p.userId)db.saveScore(p.userId,'survival','player',sv.turn).catch(console.error);});
    room.leaderboard=[...room.players].sort((a,b)=>b.score-a.score);
    broadcastSV(code,room);
    io.to(code).emit('sv_over',{turn:sv.turn,players:room.players,leaderboard:room.leaderboard});
    return;
  }
  sv.turn++;sv.spawnCounter++;sv.phase='player_turn';
  if(sv.turn>=15&&!sv.aiActive){sv.aiActive=true;sv.log.push('🤖 ¡IA activada! Los enemigos flanquean.');io.to(code).emit('sv_ai_on');}
  if(sv.spawnCounter>=3){sv.spawnCounter=0;const wave=Math.min(1+Math.floor(sv.turn/5),5);spawnMobs(sv,wave);sv.log.push(`🚨 ¡Oleada! +${wave} enemigos`);}
  Object.values(sv.svPlayers).filter(p=>p.alive).forEach(p=>{
    if(Math.random()<0.15){p.heals++;sv.log.push(`💊 ${p.name} encontró curación`);}
    if(Math.random()<0.08){p.shields++;sv.log.push(`🛡 ${p.name} encontró escudo`);}
    if(Math.random()<0.1){p.barriers++;sv.log.push(`🧱 ${p.name} encontró materiales`);}
    p.acted=false;if(p.shielded>0)p.shielded--;
  });
  if(sv.log.length>8)sv.log=sv.log.slice(-8);
  broadcastSV(code,room);
}

function broadcastSV(code,room){
  const sv=room.sv;
  io.to(code).emit('sv_state',{svPlayers:sv.svPlayers,mobs:sv.mobs,barriers:sv.barriers,grid:GRID,turn:sv.turn,log:sv.log,phase:sv.phase,aiActive:sv.aiActive,mobsDefeated:sv.mobsDefeated});
}

const PORT=process.env.PORT||3000;
// Init DB then start server
db.initDB().then(()=>{
  server.listen(PORT,()=>console.log(`Arcade on port ${PORT}`));
}).catch(err=>{
  console.error('DB init failed, starting without DB:', err.message);
  server.listen(PORT,()=>console.log(`Arcade on port ${PORT} (no DB)`));
});
