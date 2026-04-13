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

const db = require('./db');
const auth = require('./auth');

function requireAuth(req,res,next){
  const h=req.headers.authorization;
  if(!h||!h.startsWith('Bearer ')) return res.status(401).json({error:'No autenticado'});
  const payload=auth.verifyToken(h.slice(7));
  if(!payload) return res.status(401).json({error:'Token inválido'});
  req.user=payload;
  next();
}

app.post('/api/register', async (req,res) => {
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
        try { resolve(JSON.parse(data).content.map(b=>b.text||'').join('').replace(/```json|```/g,'').trim()); }
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
async function classifyQ(q){
  const t=await callClaude(`Perfil:${JAVIER_PROFILE}\nPregunta:"${q}"\n¿Respuesta deducible? Solo: {"covered":true} o {"covered":false}`,50);
  try{return JSON.parse(t).covered===true;}catch{return false;}
}

// ── BOT GENERATION ─────────────────────────────────────────────
async function genBotAnswers(q, humanAnswer, profile, extra, count, writingSamples) {
  let styleSection = '';
  if (writingSamples && writingSamples.length > 0) {
    const examples = writingSamples.slice(0,8).map((s,i)=>`E${i+1}: "${s.question}" → "${s.answer}"`).join('\n');
    styleSection = `\nESTILO HUMANO:\n${examples}\nImita exactamente este estilo.`;
  }
  const t = await callClaude(`Juego imitación.${profile?`\nPERFIL:${profile}`:''}${extra?`\nEXTRA:"${extra}"`:''}${styleSection}
Pregunta:"${q}" Respuesta humana:"${humanAnswer}"
Genera EXACTAMENTE ${count} respuestas alternativas plausibles, distintas entre sí y al humano.
Solo JSON:{"answers":["r1","r2",...]}`, 2500);
  try {
    const p = JSON.parse(t);
    if (p.answers?.length >= count) return p.answers.slice(0, count);
    throw 0;
  } catch {
    return Array.from({length:count},(_,i)=>
      ['No sé cómo explicarlo.','Pues depende.','Jaja buena pregunta.','Uno se adapta.',
       'Difícil decirlo.','Honestamente no sé.','Creo que bien.','Cada quien lo ve diferente.',
       'Habría que verlo.','Lo que toca hacer.'][i%10]
    );
  }
}

// ── CLAUDE SOLO HUMANO ─────────────────────────────────────────
async function claudeAskQuestion(round, totalRounds, profile) {
  const t = await callClaude(`Eres interrogador en un juego de imitación. ${profile?`Perfil del humano: ${profile}`:''}
Genera UNA pregunta original y personal para ronda ${round}/${totalRounds}. Corta (máx 15 palabras), que provoque respuestas reveladoras y difíciles de imitar.
Solo JSON: {"question":"..."}`, 200);
  try { return JSON.parse(t).question; }
  catch { return '¿Qué harías si tuvieras un día libre sin ninguna obligación?'; }
}

async function claudeGuessHuman(answers, question) {
  const t = await callClaude(`Eres interrogador. Pregunta: "${question}". Respuestas: ${JSON.stringify(answers.map(a=>({label:a.label,answer:a.answer})))}
Analiza cuál es más humana y auténtica. Solo JSON: {"guess": NUMERO, "reasoning": "explicación breve"}`, 300);
  try { const r=JSON.parse(t); return {guess:r.guess, reasoning:r.reasoning}; }
  catch { return {guess:answers[Math.floor(Math.random()*answers.length)]?.label, reasoning:'Intuición.'}; }
}

// ── HANGMAN ────────────────────────────────────────────────────
const HM_WORDS=['javascript','programacion','universidad','colombia','bucaramanga','medellin','contaduria','psicologia','computadora','telefono','cumpleanos','noviembre','diciembre','septiembre','octubre','chocolate','aguacate','mariposa','elefante','cocodrilo','helicoptero','submarino','dinosaurio','periodista','arquitecto'];

// ── SURVIVAL ───────────────────────────────────────────────────
const GRID = 16;
const MOVE_RANGE = 1;
const BASE_SHOOT_RANGE = 32; // alcance total del mapa

function emptySurvivalRoom(){
  return {svPlayers:{},mobs:[],barriers:[],torretas:[],turn:0,phase:'player_turn',
    log:[],mobsDefeated:0,spawnCounter:0,aiActive:false};
}
function inBounds(x,y){return x>=0&&x<GRID&&y>=0&&y<GRID;}
function manhattan(a,b){return Math.abs(a.x-b.x)+Math.abs(a.y-b.y);}

function genDrop(mob) {
  if(mob.type==='boss') return 'boss_kill'; // recompensa especial de boss
  if(Math.random()>0.25) return null;
  const drops=['heal','shield','barrier','ammo','upgrade_point'];
  const pool=mob.type==='tank'?['heal','shield','barrier','upgrade_point','upgrade_point']:drops;
  return pool[Math.floor(Math.random()*pool.length)];
}

function applyBossReward(sv, player, log, emitFn) {
  // Recompensa significativa por matar boss:
  // +2 puntos de mejora, curación completa, +2 escudos, +3 curaciones
  player.upgradePoints=(player.upgradePoints||0)+2;
  player.hp=player.maxHp; // curación completa
  player.shields=(player.shields||0)+2;
  player.heals=(player.heals||0)+3;
  log.push(`🏆 ¡BOSS eliminado! ${player.name}: +2 mejoras, vida full, +2 escudos, +3 curaciones!`);
  // Notificar al cliente con evento especial
  if(emitFn) emitFn('sv_boss_reward',{
    playerName: player.name,
    rewards: {upgradePoints:2, healFull:true, shields:2, heals:3}
  });
}

function applyDrop(sv, player, drop, log, emitFn) {
  if(drop==='heal'){player.heals++;log.push(`💊 Drop: curación → ${player.name}`);}
  else if(drop==='shield'){player.shields++;log.push(`🛡 Drop: escudo → ${player.name}`);}
  else if(drop==='barrier'){player.barriers++;log.push(`🧱 Drop: barrera → ${player.name}`);}
  else if(drop==='ammo'){log.push(`🔫 Drop: munición → ${player.name}`);}
  else if(drop==='boss_kill'){ applyBossReward(sv, player, log, emitFn); }
  else if(drop==='upgrade_point'){
    player.upgradePoints=(player.upgradePoints||0)+1;
    log.push(`⭐ Drop: ¡mejora disponible → ${player.name}!`);
  }
}

function getUpgradeOptions() {
  const all=[
    {id:'max_hp',label:'❤️ +3 Vida máxima'},
    {id:'damage',label:'⚔️ +1 Daño por disparo'},
    {id:'range',label:'🎯 +3 Alcance disparo'},
    {id:'max_barriers',label:'🧱 +2 Capacidad barreras'},
    {id:'actions',label:'⚡ +1 Acción por turno'},
    {id:'torreta',label:'🤖 Construir torreta'},
    {id:'heal_power',label:'💊 +2 Potencia curación'},
    {id:'shield_dur',label:'🛡 +2 Duración escudo'},
    {id:'upgrade_torreta',label:'🔧 Mejorar torreta cercana'},
  ];
  return shuffle(all).slice(0,3);
}

function applyUpgrade(sv, player, upgradeId) {
  switch(upgradeId){
    case 'max_hp': player.maxHp+=3; player.hp=Math.min(player.hp+3,player.maxHp); break;
    case 'damage': player.damage=(player.damage||1)+1; break;
    case 'range': player.shootRange=(player.shootRange||BASE_SHOOT_RANGE)+3; break;
    case 'max_barriers': player.maxBarriers=(player.maxBarriers||5)+2; player.barriers+=2; break;
    case 'actions': player.maxActions=(player.maxActions||1)+1; break;
    case 'torreta': player.torretasInventario=(player.torretasInventario||0)+1; break;
    case 'heal_power': player.healPower=(player.healPower||2)+2; break;
    case 'shield_dur': player.shieldDur=(player.shieldDur||3)+2; break;
    case 'upgrade_torreta':
      // Mejorar stats base del jugador para torretas futuras y las existentes
      player.torretaDmg=(player.torretaDmg||1)+1;
      player.torretaRange=(player.torretaRange||6)+1;
      player.torretaHp=(player.torretaHp||10)+3;
      sv.torretas.filter(t=>t.ownerId===player.id).forEach(t=>{
        t.damage=player.torretaDmg;
        t.range=player.torretaRange;
        t.maxHp=player.torretaHp;
        t.hp=Math.min(t.hp+3,t.maxHp);
      });
      break;
  }
}

function spawnMobs(sv, count) {
  const occ=new Set([
    ...Object.values(sv.svPlayers).map(p=>`${p.x},${p.y}`),
    ...sv.mobs.map(m=>`${m.x},${m.y}`),
    ...sv.barriers.map(b=>`${b.x},${b.y}`),
    ...sv.torretas.map(t=>`${t.x},${t.y}`)
  ]);
  const turn=sv.turn||1;
  const hpScale=Math.floor(turn/15); // DIFICULTAD AUMENTADA: +1 HP cada 15 turnos (antes 30)
  // Escalar también con mejoras de jugadores pero muy suavizado
  const avgDmg=Object.values(sv.svPlayers).reduce((s,p)=>s+(p.damage||1),0)/Math.max(1,Object.values(sv.svPlayers).length);
  const dmgScale=Math.max(0,Math.floor((avgDmg-1)*0.3)); // muy poco impacto

  for(let i=0;i<count;i++){
    let x,y,tries=0;
    do{
      const s=Math.floor(Math.random()*4);
      if(s===0){x=0;y=Math.floor(Math.random()*GRID);}
      else if(s===1){x=GRID-1;y=Math.floor(Math.random()*GRID);}
      else if(s===2){x=Math.floor(Math.random()*GRID);y=0;}
      else{x=Math.floor(Math.random()*GRID);y=GRID-1;}
      tries++;
    }while(occ.has(`${x},${y}`)&&tries<50);

    let type='basic',hp=1+Math.floor(hpScale/2),maxHp,dmg=1;
    const roll=Math.random();
    if(turn>80&&roll<0.08){type='elite';hp=4+hpScale+dmgScale;dmg=3;}
    else if(turn>40&&roll<0.18){type='tank';hp=2+hpScale+Math.floor(dmgScale/2);dmg=2;}
    else{hp=1+Math.floor(hpScale/3);} // básicos muy débiles al inicio
    maxHp=hp;
    sv.mobs.push({id:`m${Date.now()}_${i}`,x,y,hp,maxHp,type,dmg,stunned:0});
    occ.add(`${x},${y}`);
  }
}

function spawnBoss(sv) {
  const turn=sv.turn||1;
  const hpScale=Math.floor(turn/30);
  const avgDmg=Object.values(sv.svPlayers).reduce((s,p)=>s+(p.damage||1),0)/Math.max(1,Object.values(sv.svPlayers).length);
  const sides=[[0,Math.floor(GRID/2)],[GRID-1,Math.floor(GRID/2)],[Math.floor(GRID/2),0],[Math.floor(GRID/2),GRID-1]];
  const [x,y]=sides[Math.floor(Math.random()*sides.length)];
  const bossHp=Math.round((15+hpScale*3)*Math.max(1,avgDmg*0.7));
  sv.mobs.push({id:`boss${Date.now()}`,x,y,hp:bossHp,maxHp:bossHp,type:'boss',dmg:3+Math.floor(hpScale/3),stunned:0});
  return {x,y,hp:bossHp};
}

function moveMobs(sv) {
  const players=Object.values(sv.svPlayers).filter(p=>p.alive);
  const barrierSet=new Set(sv.barriers.map(b=>`${b.x},${b.y}`));
  const torretaSet=new Set(sv.torretas.map(t=>`${t.x},${t.y}`));
  const log=[];
  const turn=sv.turn||1;
  // 0-10: random, 11-30: básico, 31-39: semi, 40+: IA cazadora activa
  const aiLevel=turn<=10?0:turn<=30?1:turn<=39?2:3;

  // ── IA CAZADORA (turno 40+): estrategia dinámica por turno ──
  let globalStrategy='player';
  if(aiLevel===3&&sv.aiActive){
    const hasTorretas=sv.torretas.length>0;
    const hasBarriers=sv.barriers.length>0;
    const roll=Math.random();
    if(hasTorretas&&roll<0.45){
      globalStrategy='destroy_torretas'; // 45%: destruir torretas primero
    } else if(hasBarriers&&roll<0.70){
      globalStrategy='destroy_barriers'; // 25%: destruir barreras para abrir camino
    } else {
      globalStrategy='player'; // 30%: ir directo al jugador
    }
    sv._aiStrategyLabel=globalStrategy;
  }

  sv.mobs=sv.mobs.map(mob=>{
    if(mob.stunned>0){mob.stunned--;return mob;}
    if(!players.length) return mob;

    // Objetivo según estrategia IA
    let target=players.reduce((b,p)=>manhattan(mob,p)<manhattan(mob,b)?p:b,players[0]);
    let targetType='player';

    if(aiLevel===3&&sv.aiActive){
      if(globalStrategy==='destroy_torretas'&&sv.torretas.length>0){
        const nearestTorreta=sv.torretas.reduce((b,t)=>manhattan(mob,t)<manhattan(mob,b)?t:b,sv.torretas[0]);
        if(manhattan(mob,nearestTorreta)<=10){target=nearestTorreta;targetType='torreta';}
      } else if(globalStrategy==='destroy_barriers'&&sv.barriers.length>0){
        const nearestBarrier=sv.barriers.reduce((b,br)=>manhattan(mob,br)<manhattan(mob,b)?br:b,sv.barriers[0]);
        if(manhattan(mob,nearestBarrier)<=8){target=nearestBarrier;targetType='barrier';}
      }
    }

    const dist=manhattan(mob,target);

    // Jefe ataca en área 2
    if(mob.type==='boss'&&dist<=2){
      players.filter(p=>manhattan(mob,p)<=2).forEach(p=>{
        if(p.shielded>0){p.shielded--;log.push(`🛡 ${p.name} bloqueó jefe`);}
        else{p.hp-=mob.dmg;log.push(`💥 JEFE atacó ${p.name} (${mob.dmg}dmg)`);if(p.hp<=0){p.hp=0;p.alive=false;log.push(`☠️ ${p.name} cayó`);}}
      });
      return mob;
    }

    if(targetType==='player'&&dist===1){
      if(target.shielded>0){target.shielded--;log.push(`🛡 ${target.name} bloqueó`);}
      else{target.hp-=mob.dmg;log.push(`💥 ${mob.type} atacó ${target.name}`);if(target.hp<=0){target.hp=0;target.alive=false;log.push(`☠️ ${target.name} cayó`);}}
      return mob;
    }

    const dx=Math.sign(target.x-mob.x),dy=Math.sign(target.y-mob.y);
    let cands=[];
    if(aiLevel===0){
      cands=[{x:mob.x+dx,y:mob.y+dy},{x:mob.x+dx,y:mob.y},{x:mob.x,y:mob.y+dy},
             {x:mob.x+(Math.random()>.5?1:-1),y:mob.y},{x:mob.x,y:mob.y+(Math.random()>.5?1:-1)}];
    } else if(aiLevel===1){
      cands=[{x:mob.x+dx,y:mob.y},{x:mob.x,y:mob.y+dy},{x:mob.x+dx,y:mob.y+dy}];
    } else if(aiLevel===2){
      cands=[{x:mob.x+dx,y:mob.y+dy},{x:mob.x+dx,y:mob.y},{x:mob.x,y:mob.y+dy},{x:mob.x-dy,y:mob.y+dx}];
    } else {
      // IA CAZADORA: movimiento óptimo + flanqueo
      cands=[{x:mob.x+dx,y:mob.y+dy},{x:mob.x+dx,y:mob.y},{x:mob.x,y:mob.y+dy},
             {x:mob.x-dy,y:mob.y+dx},{x:mob.x+dy,y:mob.y-dx},{x:mob.x-dx,y:mob.y+dy}];
    }

    for(const c of cands){
      if(!inBounds(c.x,c.y)) continue;
      if(barrierSet.has(`${c.x},${c.y}`)){
        const bi=sv.barriers.findIndex(b=>b.x===c.x&&b.y===c.y);
        if(bi>=0){sv.barriers[bi].hp--;if(sv.barriers[bi].hp<=0){sv.barriers.splice(bi,1);barrierSet.delete(`${c.x},${c.y}`);log.push('🧱 Barrera destruida');}}
        return mob;
      }
      if(torretaSet.has(`${c.x},${c.y}`)){
        const ti=sv.torretas.findIndex(t=>t.x===c.x&&t.y===c.y);
        if(ti>=0){sv.torretas[ti].hp--;if(sv.torretas[ti].hp<=0){sv.torretas.splice(ti,1);torretaSet.delete(`${c.x},${c.y}`);log.push('💥 Torreta destruida!');}}
        return mob;
      }
      if(!players.find(p=>p.x===c.x&&p.y===c.y)) return {...mob,x:c.x,y:c.y};
    }
    return mob;
  });
  return log;
}


function torretasTurn(sv, code) {
  const log=[];
  const bullets=[]; // para animación cliente

  sv.torretas.forEach(t=>{
    // 1 disparo por turno, resetear al inicio del turno enemigo
    if(t.firedThisTurn) return;

    // Buscar el mob más cercano en rango manhattan
    const inRange=sv.mobs.filter(m=>manhattan(t,m)<=t.range);
    if(!inRange.length) return;

    const target=inRange.reduce((b,m)=>manhattan(t,m)<manhattan(t,b)?m:b,inRange[0]);

    const dx=Math.sign(target.x-t.x);
    const dy=Math.sign(target.y-t.y);

    target.hp-=t.damage;
    t.firedThisTurn=true;

    // Datos del proyectil para el cliente
    bullets.push({fromX:t.x,fromY:t.y,toX:target.x,toY:target.y,color:'#f7c86a'});

    if(target.hp<=0){
      const players=Object.values(sv.svPlayers).filter(p=>p.alive);
      if(players.length){
        const owner=players.find(p=>p.id===t.ownerId)||players.reduce((b,p)=>manhattan(t,p)<manhattan(t,b)?p:b,players[0]);
        sv.mobsDefeated++;
        owner.killCount=(owner.killCount||0)+1;
        const drop=genDrop(target);
        if(drop) applyDrop(sv,owner,drop,log,(evt,data)=>io.to(code).emit(evt,data));
        if(owner.killCount%10===0){
          owner.upgradePoints=(owner.upgradePoints||0)+1;
          log.push(`⭐ ${owner.name}: ${owner.killCount} kills — ¡mejora!`);
        }
      }
      sv.mobs=sv.mobs.filter(m=>m.id!==target.id);
      log.push(`🤖 Torreta eliminó ${target.type}!`);
    } else {
      log.push(`🤖 Torreta → ${target.type} (${target.hp}HP)`);
    }
  });

  // Resetear firedThisTurn para siguiente turno de jugadores
  // (se resetea al inicio del turno del jugador, no aquí)

  return {log, bullets};
}

function checkAllActed(sv){
  return Object.values(sv.svPlayers).filter(p=>p.alive).every(p=>p.acted);
}

// ── SOCKET ─────────────────────────────────────────────────────
const socketUsers = {};

io.on('connection', (socket) => {

  socket.on('authenticate', ({token}) => {
    if(!token){delete socketUsers[socket.id];return;}
    const payload=auth.verifyToken(token);
    if(payload){
      socketUsers[socket.id]={userId:payload.userId,username:payload.username};
      socket.emit('authenticated',{userId:payload.userId,username:payload.username});
    }
  });

  socket.on('create_room', ({name, game, solo}) => {
    const code = genCode();
    const authUser = socketUsers[socket.id];
    const displayName = authUser ? authUser.username : name;
    const useProfile = game==='humano' && isJavier(displayName);
    rooms[code] = {
      game, phase:'lobby', solo:!!solo,
      players:[{id:socket.id,name:displayName,role:'human',score:0,userId:authUser?.userId||null}],
      humanId:socket.id, interrogatorId:null,
      profile:useProfile?JAVIER_PROFILE:null,
      extraContext:null,allAnswers:[],activeAnswers:[],eliminationRound:0,leaderboard:[],
      totalRounds:3,currentRound:1,newQuestionCount:0,
      hm:{word:'',guessed:[],wrongGuesses:0},
      sv:emptySurvivalRoom(),
    };
    socket.join(code); socket.roomCode=code;

    if(solo){
      rooms[code].phase='playing';
      if(game==='humano'){rooms[code].interrogatorId='claude';startHumanoSolo(code,rooms[code]);}
      else if(game==='hangman') startHangmanSolo(code,rooms[code]);
      else if(game==='survival') startSurvival(code,rooms[code]);
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
    const role=room.game==='survival'?'player':room.game==='hangman'?'guesser':'interrogator';
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
    if(!room) return;
    room.phase='playing';
    if(room.game==='humano') startHumano(code,room);
    else if(room.game==='hangman') startHangman(code,room);
    else if(room.game==='survival') startSurvival(code,room);
  });

  socket.on('play_again', () => {
    const code=socket.roomCode,room=rooms[code];
    if(!room) return;
    if(room.game==='humano'&&!room.solo){
      [room.humanId,room.interrogatorId]=[room.interrogatorId,room.humanId];
      room.players.forEach(p=>{p.role=p.id===room.humanId?'human':'interrogator';});
    }
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
      else if(room.game==='survival') startSurvival(code,room);
    } else {
      room.phase='lobby';
      io.to(code).emit('rematch_ready',{players:room.players,leaderboard:room.leaderboard,totalRounds:room.totalRounds||3});
    }
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
        if(room.interrogatorId!=='claude') io.to(room.interrogatorId).emit('waiting_for_answers',{question});
        return;
      }
    }
    room.extraContext=null;
    io.to(room.humanId).emit('answer_question',{question});
    if(room.interrogatorId!=='claude') io.to(room.interrogatorId).emit('waiting_for_answers',{question});
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
    if(room.interrogatorId!=='claude') io.to(room.interrogatorId).emit('generating_bots_wait');

    const humanPlayer=room.players.find(p=>p.id===room.humanId);
    let writingSamples=[];
    if(humanPlayer?.userId){
      try{
        await db.saveWritingSample(humanPlayer.userId,room.question,answer);
        writingSamples=await db.getWritingSamples(humanPlayer.userId,20);
      }catch(e){console.error('DB write sample error:',e);}
    }

    const bots=await genBotAnswers(room.question,answer,room.profile,room.extraContext,10,writingSamples);
    const pool=shuffle([
      {id:'human',answer,isHuman:true,eliminated:false},
      ...bots.map((a,i)=>({id:`bot${i}`,answer:a,isHuman:false,eliminated:false}))
    ]).map((a,i)=>({...a,label:i+1}));
    room.allAnswers=pool; room.activeAnswers=[...pool]; room.eliminationRound=0;
    const visible=pool.map(a=>({label:a.label,answer:a.answer}));

    // Modo solo: Claude adivina
    if(room.solo&&room.interrogatorId==='claude'){
      io.to(room.humanId).emit('being_judged',{question:room.question,answers:visible,remaining:visible.length,currentRound:room.currentRound,totalRounds:room.totalRounds,claudeThinking:true});
      setTimeout(async()=>{
        if(!rooms[code]) return;
        const guess=await claudeGuessHuman(pool,room.question);
        const chosen=pool.find(a=>a.label===guess.guess);
        const hE=pool.find(a=>a.isHuman);
        const isH=!!chosen?.isHuman;
        const hP=room.players.find(p=>p.id===room.humanId);
        if(hP) hP.score+=isH?0:50;
        room.leaderboard=[...room.players].sort((a,b)=>b.score-a.score);
        const totalRounds=room.totalRounds||3;
        const roundDone=room.currentRound>=totalRounds;
        io.to(code).emit('game_result',{
          isHuman:isH,humanLabel:hE?.label,humanAnswer:hE?.answer,
          guessedLabel:guess.guess,eliminationRound:0,
          interrogatorPts:isH?100:0,humanPts:isH?0:50,
          players:room.players,leaderboard:room.leaderboard,
          allAnswers:pool,currentRound:room.currentRound,totalRounds,roundDone,
          claudeReasoning:guess.reasoning,solo:true
        });
        if(!roundDone){
          room.currentRound++;
          room.allAnswers=[];room.activeAnswers=[];room.eliminationRound=0;room.extraContext=null;room.newQuestionCount=0;
          setTimeout(()=>startHumanoSoloRound(code,room),3000);
        }
      },2500);
      return;
    }

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
    io.to(code).emit('score_update',{players:room.players,penaltyMsg:`Nueva pregunta: −${penalty} pts`});
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
        // Siguiente ronda automáticamente
        setTimeout(()=>{
          const tr=room.totalRounds||3;
          io.to(room.interrogatorId).emit('your_turn_to_ask',{currentRound:room.currentRound,totalRounds:tr});
          io.to(room.humanId).emit('waiting_for_question',{currentRound:room.currentRound,totalRounds:tr});
        },3000);
      }
    };

    if(finalGuess){
      const chosen=room.activeAnswers.find(a=>a.label===finalGuess);
      const isH=chosen?.isHuman;
      const hE=room.allAnswers.find(a=>a.isHuman);
      finishRound(isH?interPts(room.eliminationRound):-50,isH?0:humanSurvivePts(room.eliminationRound),
        {isHuman:isH,humanLabel:hE?.label,guessedLabel:finalGuess,humanAnswer:hE?.answer,eliminationRound:room.eliminationRound});
      return;
    }

    room.eliminationRound++;
    const elimH=labels.some(l=>room.activeAnswers.find(a=>a.label===l)?.isHuman);
    labels.forEach(l=>{const e=room.activeAnswers.find(a=>a.label===l);if(e)e.eliminated=true;});
    room.activeAnswers=room.activeAnswers.filter(a=>!a.eliminated);

    if(elimH){
      const hE=room.allAnswers.find(a=>a.isHuman);
      finishRound(-humanSurvivePts(room.eliminationRound),humanSurvivePts(room.eliminationRound),
        {isHuman:false,humanLabel:hE?.label,humanEliminated:true,humanAnswer:hE?.answer,eliminationRound:room.eliminationRound});
      return;
    }
    if(room.activeAnswers.length===1&&room.activeAnswers[0].isHuman){
      const hE=room.allAnswers.find(a=>a.isHuman);
      finishRound(interPts(room.eliminationRound),0,
        {isHuman:true,humanLabel:hE?.label,humanAnswer:hE?.answer,foundByElimination:true,eliminationRound:room.eliminationRound});
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
      if(room.solo) setTimeout(()=>startHangmanSolo(code,room),3000);
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
  socket.on('sv_action', ({action,targetX,targetY,upgradeId}) => {
    const code=socket.roomCode,room=rooms[code];
    if(!room||room.game!=='survival') return;
    const sv=room.sv;
    if(sv.phase!=='player_turn') return;
    const p=sv.svPlayers[socket.id];
    if(!p||!p.alive) return;

    const maxActions=p.maxActions||1;
    if(p.actionsUsed===undefined) p.actionsUsed=0;
    if(action!=='upgrade'&&action!=='place_torreta'&&action!=='end_turn'&&p.actionsUsed>=maxActions) return;

    const barrierSet=new Set(sv.barriers.map(b=>`${b.x},${b.y}`));
    const torretaSet=new Set(sv.torretas.map(t=>`${t.x},${t.y}`));
    const playerSet=new Set(Object.values(sv.svPlayers).filter(x=>x.alive&&x.id!==socket.id).map(x=>`${x.x},${x.y}`));
    let logMsg='';
    const playerDmg=p.damage||1;
    const playerRange=p.shootRange||BASE_SHOOT_RANGE;

    if(action==='upgrade'){
      if(!upgradeId||!(p.upgradePoints>0)){socket.emit('sv_error','Sin puntos de mejora');return;}
      p.upgradePoints--;
      applyUpgrade(sv,p,upgradeId);
      logMsg=`⬆️ ${p.name} mejoró: ${upgradeId}`;
      if(upgradeId==='torreta'){p.pendingTorreta=true;socket.emit('sv_place_torreta',{torretasLeft:p.torretasInventario});sv.log.push(logMsg);broadcastSV(code,room);return;}
    } else if(action==='place_torreta'){
      if(!p.pendingTorreta){socket.emit('sv_error','Sin torreta pendiente');return;}
      if(!inBounds(targetX,targetY)||barrierSet.has(`${targetX},${targetY}`)||torretaSet.has(`${targetX},${targetY}`)){socket.emit('sv_error','Posición inválida');return;}
      if(Math.abs(targetX-p.x)>2||Math.abs(targetY-p.y)>2){socket.emit('sv_error','Muy lejos (rango 2)');return;}
      const tHp=p.torretaHp||10;
      sv.torretas.push({
        id:`t${Date.now()}`,x:targetX,y:targetY,
        hp:tHp,maxHp:tHp,
        damage:p.torretaDmg||1,
        range:p.torretaRange||6,
        active:true,ownerId:socket.id,
        firedThisTurn:false
      });
      p.pendingTorreta=false;
      if(p.torretasInventario>0) p.torretasInventario--;
      logMsg=`🤖 ${p.name} desplegó torreta (${p.torretasInventario||0} restantes)`;
    } else if(action==='deploy_torreta'){
      // Desplegar desde inventario directamente
      if(!(p.torretasInventario>0)){socket.emit('sv_error','Sin torretas en inventario');return;}
      p.pendingTorreta=true;
      socket.emit('sv_place_torreta',{torretasLeft:p.torretasInventario});
      sv.log.push(`🎒 ${p.name} prepara torreta...`);
      broadcastSV(code,room);
      return;
    } else if(action==='move'){
      if(!inBounds(targetX,targetY)||barrierSet.has(`${targetX},${targetY}`)||torretaSet.has(`${targetX},${targetY}`)||playerSet.has(`${targetX},${targetY}`)){socket.emit('sv_error','Posición bloqueada');return;}
      const moveRange=p.maxActions||3; // puede moverse hasta N casillas = acciones disponibles
      if(Math.abs(targetX-p.x)>1||Math.abs(targetY-p.y)>1){socket.emit('sv_error','Solo 1 casilla por acción de movimiento');return;}
      p.x=targetX;p.y=targetY;logMsg=`🚶 ${p.name} se movió`;
    } else if(action==='shoot'){
      const dx=Math.sign(targetX-p.x),dy=Math.sign(targetY-p.y);
      if(dx===0&&dy===0){socket.emit('sv_error','Elige dirección');return;}
      let hit=false,cx=p.x+dx,cy=p.y+dy,steps=0;
      while(inBounds(cx,cy)&&steps<playerRange){
        const bi=sv.barriers.findIndex(b=>b.x===cx&&b.y===cy);
        if(bi>=0){sv.barriers[bi].hp-=playerDmg;if(sv.barriers[bi].hp<=0)sv.barriers.splice(bi,1);logMsg=`🔫 ${p.name} disparó barrera`;hit=true;break;}
        const mi=sv.mobs.findIndex(m=>m.x===cx&&m.y===cy);
        if(mi>=0){
          sv.mobs[mi].hp-=playerDmg;
          if(sv.mobs[mi].hp<=0){
            const killedMob=sv.mobs[mi];
            const isBoss=killedMob.type==='boss';
            const drop=genDrop(killedMob);
            if(drop) applyDrop(sv,p,drop,sv.log,(evt,data)=>io.to(code).emit(evt,data));
            sv.mobs.splice(mi,1);
            sv.mobsDefeated++;
            p.killCount=(p.killCount||0)+1;
            logMsg=isBoss
              ? `🏆 ${p.name} ¡ELIMINÓ AL JEFE! (${p.killCount} kills)`
              : `🎯 ${p.name} eliminó enemigo! (${p.killCount} kills)`;
            if(p.killCount%10===0){
              p.upgradePoints=(p.upgradePoints||0)+1;
              sv.log.push(`⭐ ${p.name}: ${p.killCount} kills → ¡punto de mejora!`);
              socket.emit('sv_upgrade_available',{options:getUpgradeOptions(),killCount:p.killCount,upgradePoints:p.upgradePoints});
            }
            // Si hay upgrade points por boss, notificar upgrade disponible
            if(isBoss && p.upgradePoints>0){
              socket.emit('sv_upgrade_available',{options:getUpgradeOptions(),killCount:p.killCount,upgradePoints:p.upgradePoints});
            }
          } else {
            logMsg=`🔫 ${p.name} dañó ${sv.mobs[mi].type} (${sv.mobs[mi].hp}HP)`;
          }
          hit=true;break;
        }
        cx+=dx;cy+=dy;steps++;
      }
      if(!hit) logMsg=`🔫 ${p.name} disparó al aire`;
      // Emitir proyectil para animación en cliente
      io.to(code).emit('sv_bullet',{fromX:p.x,fromY:p.y,dx,dy,range:steps||playerRange,hitX:cx,hitY:cy,hit});
    } else if(action==='barrier'){
      if(!inBounds(targetX,targetY)||barrierSet.has(`${targetX},${targetY}`)||torretaSet.has(`${targetX},${targetY}`)||playerSet.has(`${targetX},${targetY}`)){socket.emit('sv_error','Posición bloqueada');return;}
      if(Math.abs(targetX-p.x)>1||Math.abs(targetY-p.y)>1){socket.emit('sv_error','Solo adyacente');return;}
      const bHp=p.barrierHp||(p.maxHp*3);
      sv.barriers.push({x:targetX,y:targetY,hp:bHp,maxHp:bHp});
      // barriers es infinito, no decrementar
      logMsg=`🧱 ${p.name} colocó barrera`;
    } else if(action==='heal'){
      if(p.heals<=0){socket.emit('sv_error','Sin curaciones');return;}
      const healAmt=p.healPower||2;
      p.hp=Math.min(p.maxHp,p.hp+healAmt);p.heals--;
      logMsg=`💊 ${p.name} se curó +${healAmt}HP`;
    } else if(action==='shield'){
      if(p.shields<=0){socket.emit('sv_error','Sin escudos');return;}
      const dur=p.shieldDur||3;
      p.shielded=dur;p.shields--;
      logMsg=`🛡 ${p.name} escudo ${dur} turnos`;
    } else if(action==='end_turn'){
      p.actionsUsed=maxActions;
      logMsg=`⏩ ${p.name} pasó turno`;
    }

    if(action!=='upgrade') p.actionsUsed=(p.actionsUsed||0)+1;
    p.acted=p.actionsUsed>=maxActions;

    sv.log.push(logMsg);if(sv.log.length>10)sv.log=sv.log.slice(-10);
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

function startSurvival(code,room){
  const sv=room.sv;
  const positions=shuffle([[2,2],[GRID-3,GRID-3],[2,GRID-3],[GRID-3,2]]);
  const PLAYER_MAX_HP=6;
  const BARRIER_HP=PLAYER_MAX_HP*3; // barreras = 3x vida del jugador

  room.players.forEach((pl,i)=>{
    sv.svPlayers[pl.id]={
      id:pl.id,name:pl.name,x:positions[i][0],y:positions[i][1],
      hp:PLAYER_MAX_HP,maxHp:PLAYER_MAX_HP,alive:true,
      barriers:999, // infinitas
      shields:2,heals:3,shielded:0,
      acted:false,actionsUsed:0,maxActions:3, // 3 acciones por turno
      damage:1,shootRange:BASE_SHOOT_RANGE,
      killCount:0,upgradePoints:0,
      healPower:2,shieldDur:3,maxBarriers:999,pendingTorreta:false,
      barrierHp:BARRIER_HP // HP de cada barrera que pone este jugador
    };
  });

  // 4 torretas en inventario de cada jugador (1 HP — mueren de un golpe)
  Object.values(sv.svPlayers).forEach(p=>{
    p.torretasInventario=4;
    p.torretaDmg=1;
    p.torretaRange=6;
    p.torretaHp=1; // 1 HP: mueren de un solo golpe enemigo
  });

  spawnMobs(sv,3);sv.turn=1;sv.phase='player_turn';
  sv.log=['🎮 ¡Comenzó! 3 acciones/turno · Barreras ∞ · 4 torretas (⚠ 1HP cada una) · IA activa en turno 40.'];
  io.to(code).emit('sv_started',{
    svPlayers:sv.svPlayers,mobs:sv.mobs,barriers:sv.barriers,torretas:sv.torretas,
    grid:GRID,turn:sv.turn,log:sv.log,phase:sv.phase,aiActive:false
  });
  broadcastSV(code,room);
}

function doMobTurn(code,room){
  const sv=room.sv; if(!rooms[code]) return;
  const {log:torretaLog, bullets:torretaBullets}=torretasTurn(sv, code);
  sv.log.push(...torretaLog);
  // Emitir proyectiles de torretas al cliente
  if(torretaBullets&&torretaBullets.length&&code){
    io.to(code).emit('sv_torreta_bullets',{bullets:torretaBullets});
  }
  const mobLog=moveMobs(sv);
  sv.log.push(...mobLog);
  if(sv.log.length>10) sv.log=sv.log.slice(-10);

  // Emitir estrategia IA activa al cliente (para mostrar aviso)
  if(sv.aiActive && sv._aiStrategyLabel){
    const strategyLabels={
      'destroy_torretas':'🤖 IA: ¡A DESTRUIR TORRETAS!',
      'destroy_barriers':'🤖 IA: ¡ROMPER BARRERAS!',
      'player':'🤖 IA: ¡CAZANDO AL JUGADOR!'
    };
    io.to(code).emit('sv_ai_strategy',{label: strategyLabels[sv._aiStrategyLabel]||'🤖 IA activa'});
  }

  const alivePlayers=Object.values(sv.svPlayers).filter(p=>p.alive);
  if(alivePlayers.length===0){
    sv.phase='game_over';
    room.leaderboard=[...room.players].sort((a,b)=>b.score-a.score);
    broadcastSV(code,room);
    io.to(code).emit('sv_over',{turn:sv.turn,players:room.players,leaderboard:room.leaderboard,mobsDefeated:sv.mobsDefeated});
    return;
  }

  sv.turn++; sv.spawnCounter++; sv.phase='player_turn';

  if(sv.turn%20===0){
    const pos=spawnBoss(sv);
    sv.log.push(`👹 ¡JEFE! ${sv.mobs[sv.mobs.length-1].maxHp}HP en (${pos.x},${pos.y})`);
    io.to(code).emit('sv_boss_spawn',{turn:sv.turn});
  }

  if(sv.turn>=40&&!sv.aiActive){
    sv.aiActive=true;
    sv.aiStrategy='dynamic'; // estrategia dinámica: cambia cada turno
    sv.log.push('🧠 ¡IA CAZADORA activada en turno 40 — objetivo: eliminar jugador!');
    io.to(code).emit('sv_ai_on');
  }

  if(sv.spawnCounter>=2){ // DIFICULTAD: oleadas cada 2 turnos (antes cada 3)
    sv.spawnCounter=0;
    const wave=Math.min(1+Math.floor(sv.turn/4),10); // oleadas más grandes y rápidas
    spawnMobs(sv,wave);
    sv.log.push(`🚨 Oleada +${wave} (turno ${sv.turn})`);
  }

  Object.values(sv.svPlayers).filter(p=>p.alive).forEach(p=>{
    if(Math.random()<0.06){p.heals++;sv.log.push(`💊 ${p.name} encontró curación`);}
    if(Math.random()<0.04){p.shields++;sv.log.push(`🛡 ${p.name} encontró escudo`);}
    if(Math.random()<0.05){p.barriers++;sv.log.push(`🧱 ${p.name} encontró materiales`);}
    p.acted=false; p.actionsUsed=0;
    if(p.shielded>0) p.shielded--;
  });
  // Resetear disparo de torretas para el nuevo turno
  sv.torretas.forEach(t=>{ t.firedThisTurn=false; });

  if(sv.log.length>10) sv.log=sv.log.slice(-10);
  broadcastSV(code,room);
}

function broadcastSV(code,room){
  const sv=room.sv;
  io.to(code).emit('sv_state',{
    svPlayers:sv.svPlayers,mobs:sv.mobs,barriers:sv.barriers,torretas:sv.torretas,
    grid:GRID,turn:sv.turn,log:sv.log,phase:sv.phase,
    aiActive:sv.aiActive,mobsDefeated:sv.mobsDefeated
  });
}

const PORT=process.env.PORT||3000;
db.initDB().then(()=>{
  server.listen(PORT,()=>console.log(`Arcade on port ${PORT}`));
}).catch(err=>{
  console.error('DB init failed, starting without DB:', err.message);
  server.listen(PORT,()=>console.log(`Arcade on port ${PORT} (no DB)`));
});
