// ── D&D — API Routes + Socket Handlers ────────────────────────
// games/dnd/dnd-handlers.js
// Edita este archivo para cambiar D&D sin tocar otros juegos

const dnd    = require('./dnd');
const skills = require('./skills');
const db     = require('../../db');

// ── API ROUTES ────────────────────────────────────────────────
function registerDndRoutes(app, requireAuth) {
app.get('/api/dnd/adventures', async (req,res) => {
  try { res.json(await db.getDndAdventures(30)); }
  catch(e) { res.json([]); }
});

app.post('/api/dnd/adventures/generate', async (req,res) => {
  const {theme, playerCount} = req.body;
  try {
    const adventure = await dnd.generateAdventure(theme, playerCount||1);
    if(!adventure) return res.status(500).json({error:'No se pudo generar la aventura'});
    const id = await db.saveDndAdventure(adventure.title, adventure.summary, theme, adventure);
    res.json({id, ...adventure});
  } catch(e) {
    console.error('DnD generate error:', e.message);
    res.status(500).json({error:'Error generando aventura'});
  }
});

// API: obtener árbol de habilidades por clase
app.get('/api/dnd/skills/:class', (req,res) => {
  const cls = req.params.class;
  const classSkills = skills.ALL_SKILLS[cls];
  if(!classSkills) return res.status(400).json({error:'Clase inválida'});
  // También incluir habilidades de otras clases (con costo marcado)
  const otherSkills = Object.entries(skills.ALL_SKILLS)
    .filter(([k])=>k!==cls)
    .flatMap(([k,arr])=>arr.map(s=>({...s, otherClass:k, cost: s.cost*2})))
    .filter(s=>s.cat!=='Universal');
  res.json({
    own: classSkills,
    other: otherSkills,
    baseStats: skills.CLASS_STATS[cls],
    resource: skills.CLASS_RESOURCE[cls]
  });
});

app.get('/api/dnd/shop/:universeId', async (req,res) => {
  try {
    const items = await db.getShopItems(req.params.universeId);
    res.json({items});
  } catch(e) { res.json({items:[]}); }
});

app.get('/api/dnd/resume/:characterId', requireAuth, async (req,res) => {
  try {
    const ongoing = await db.getOngoingAdventure(req.params.characterId);
    if(!ongoing || !ongoing.session_data?.lastScene) return res.json({hasOngoing:false});
    res.json({
      hasOngoing: true,
      adventureId: ongoing.id,
      missionTitle: ongoing.mission_title,
      chapter: ongoing.session_data.chapter || 1,
      location: ongoing.session_data.currentLocation,
      lastNarration: ongoing.session_data.lastScene?.narration?.slice(0,200)+'...',
      savedAt: ongoing.session_data.savedAt,
    });
  } catch(e) { res.json({hasOngoing:false}); }
});

app.get('/api/dnd/adventures/:id', async (req,res) => {
  try {
    const row = await db.getDndAdventureById(req.params.id);
    if(!row) return res.status(404).json({error:'No encontrada'});
    res.json({id:row.id, ...row.adventure_json, play_count:row.play_count});
  } catch(e) { res.status(500).json({error:'Error'}); }
});


app.get('/api/universes', async (req,res) => {
  try { res.json(await db.getUniverses()); }
  catch(e) { res.json([]); }
});

app.get('/api/universes/:id', async (req,res) => {
  try {
    const u = await db.getUniverseById(req.params.id);
    if(!u) return res.status(404).json({error:'Universo no encontrado'});
    res.json(u);
  } catch(e) { res.status(500).json({error:'Error'}); }
});

app.get('/api/universes/:id/history', async (req,res) => {
  try {
    const [history, legends] = await Promise.all([
      db.getUniverseHistory(req.params.id, 30),
      db.getUniverseLegends(req.params.id)
    ]);
    res.json({history, legends});
  } catch(e) { res.json({history:[], legends:[]}); }
});

app.get('/api/universes/:id/missions', async (req,res) => {
  const minLv = parseInt(req.query.minLevel)||1;
  const maxLv = parseInt(req.query.maxLevel)||20;
  try { res.json(await db.getMissionsForUniverse(req.params.id, minLv, maxLv)); }
  catch(e) { res.json([]); }
});

app.get('/api/characters', requireAuth, async (req,res) => {
  try { res.json(await db.getCharactersByUser(req.user.userId)); }
  catch(e) { res.json([]); }
});

app.get('/api/characters/:id', requireAuth, async (req,res) => {
  try {
    const c = await db.getCharacterById(req.params.id);
    if(!c) return res.status(404).json({error:'Personaje no encontrado'});
    if(c.user_id!==req.user.userId) return res.status(403).json({error:'No autorizado'});
    res.json(c);
  } catch(e) { res.status(500).json({error:'Error'}); }
});

app.get('/api/characters/:id/adventures', requireAuth, async (req,res) => {
  try {
    const c = await db.getCharacterById(req.params.id);
    if(!c||c.user_id!==req.user.userId) return res.status(403).json({error:'No autorizado'});
    res.json(await db.getCharacterAdventures(req.params.id));
  } catch(e) { res.json([]); }
});

}

// ── SOCKET HANDLERS ───────────────────────────────────────────
// Recibe referencias del server.js principal
function registerDndSockets(io, rooms, socketUsers, { genCode, emptySurvivalRoom }) {
  return function(socket) {
// ── DND SOCKETS — UNIVERSOS PERSISTENTES ───────────────────────

  // ── PERSONAJES ────────────────────────────────────────────────
  socket.on('dnd_get_my_characters', async () => {
    const authUser = socketUsers[socket.id];
    if(!authUser) return socket.emit('dnd_error','Debes iniciar sesión');
    try {
      const chars = await db.getCharactersByUser(authUser.userId);
      socket.emit('dnd_my_characters', {characters: chars});
    } catch(e) { console.error('get_chars error:', e.message); socket.emit('dnd_error','Error cargando personajes'); }
  });

  socket.on('dnd_create_character', async ({universeId, name, characterClass, backstory, appearance, statPoints, learnedSkills}) => {
    const authUser = socketUsers[socket.id];
    if(!authUser) return socket.emit('dnd_error','Debes iniciar sesión para crear un personaje');
    try {
      const baseStats = skills.CLASS_STATS[characterClass] || skills.CLASS_STATS['Guerrero'];
      const resource  = skills.CLASS_RESOURCE[characterClass] || 'stamina';
      const hp   = (baseStats.maxHp||20) + (statPoints?.hp||0);
      const strS = (baseStats.str||10) + (statPoints?.str||0);
      const dexS = (baseStats.dex||10) + (statPoints?.dex||0);
      const intS = (baseStats.int||10) + (statPoints?.int||0);
      const chaS = (baseStats.cha||10) + (statPoints?.cha||0);
      const char = await db.createCharacter(authUser.userId, universeId, {
        name, class: characterClass, backstory: backstory||'',
        appearance: appearance||{},
        learnedSkills: learnedSkills||[],
        items: [],
        level: 1, xp: 0,
        hp, maxHp: hp,
        stamina: baseStats.stamina||0, maxStamina: baseStats.maxStamina||0,
        mana: baseStats.mana||0, maxMana: baseStats.maxMana||0,
        str: strS, dex: dexS, int: intS, cha: chaS,
      });
      socket.emit('dnd_character_created', {character: char});
    } catch(e) { console.error('create_char error:', e.message); socket.emit('dnd_error','Error creando personaje: '+e.message); }
  });

  // ── UNIVERSOS ────────────────────────────────────────────────
  socket.on('dnd_get_universes', async () => {
    try {
      const universes = await db.getUniverses();
      socket.emit('dnd_universes', {universes});
    } catch(e) { socket.emit('dnd_universes', {universes:[]}); }
  });

  socket.on('dnd_get_universe_history', async ({universeId}) => {
    try {
      const [history, legends] = await Promise.all([
        db.getUniverseHistory(universeId, 20),
        db.getUniverseLegends(universeId)
      ]);
      socket.emit('dnd_universe_history', {history, legends});
    } catch(e) { socket.emit('dnd_universe_history', {history:[],legends:[]}); }
  });

  socket.on('dnd_create_universe', async ({name, description, atmosphere}) => {
    const authUser = socketUsers[socket.id];
    if(!authUser) return socket.emit('dnd_error','Debes iniciar sesión');
    if(!name||name.length<3) return socket.emit('dnd_error','El nombre debe tener al menos 3 caracteres');
    try {
      socket.emit('dnd_processing', {message:'Forjando el universo...'});
      const lore = await dnd.generateUniverseLore(name, description||'', atmosphere||'epic');
      if(!lore) return socket.emit('dnd_error','Error generando el universo, intenta de nuevo');
      const universe = await db.createUniverse(authUser.userId, name, description||'', lore, atmosphere||'epic');
      socket.emit('dnd_universe_created', {universe: {...universe, lore}});
    } catch(e) { console.error('create_universe error:', e.message); socket.emit('dnd_error','Error creando universo'); }
  });

  // ── INTRO AL UNIVERSO + MISIONES ─────────────────────────────
  socket.on('dnd_enter_universe', async ({characterId, universeId}) => {
    const authUser = socketUsers[socket.id];
    if(!authUser) return socket.emit('dnd_error','Debes iniciar sesión');
    try {
      // ── FASE 1: queries DB en paralelo (rápido, ~50-100ms) ─────────
      const [character, universe, history, legends, existingMissions] = await Promise.all([
        db.getCharacterById(characterId),
        db.getUniverseById(universeId),
        db.getUniverseHistory(universeId, 20),
        db.getUniverseLegends(universeId),
        db.getMissionsForUniverse(universeId, 1, 25),
      ]);

      if(!character) return socket.emit('dnd_error','Personaje no encontrado');
      if(!universe)  return socket.emit('dnd_error','Universo no encontrado');
      if(character.user_id !== authUser.userId) return socket.emit('dnd_error','No es tu personaje');
      if(character.status !== 'alive') return socket.emit('dnd_error','Este personaje ha caído');

      const charData = {
        ...character, level:character.level||1, backstory:character.backstory||'',
        class:character.class||'Guerrero', characterClass:character.class||'Guerrero',
        learnedSkills:character.learned_skills||[],
        adventures_completed:character.adventures_completed||0,
      };

      // ── FASE 2: enviar datos estáticos YA (universo, historia, personaje) ──
      // El cliente puede mostrar la pantalla inmediatamente con los datos del universo
      // Join universe room for global events (other players' actions)
      socket.join(`universe_${universeId}`);

      socket.emit('dnd_universe_data', {
        character: charData,
        universe,
        history: history.slice(0,8),
        legends,
      });

      // ── FASE 3A: misiones en caché → enviar sin esperar a Claude ────
      let cachedMissions = [];
      if(existingMissions.length >= 3) {
        cachedMissions = existingMissions.slice(0,4).map(m=>({
          id:m.id, title:m.title, summary:m.summary,
          minLevel:m.min_level, maxLevel:m.max_level,
          difficulty:m.difficulty, ...(m.mission_json||{})
        }));
        // Enviar misiones en caché inmediatamente (sin Claude)
        socket.emit('dnd_missions_ready', {missions: cachedMissions});
      }

      // ── FASE 3B: intro narrativa (Claude, ~2-3s) ────────────────────
      // Se genera en paralelo con lo que ya vio el usuario
      const introNarration = await dnd.generateUniverseIntroOnly(universe, charData, legends);
      socket.emit('dnd_intro_ready', {
        introNarration: introNarration || universe.lore?.openingNarration || `Bienvenido a ${universe.name}.`
      });

      // ── FASE 3C: generar nuevas misiones solo si no había caché ─────
      if(cachedMissions.length < 3) {
        const rawMissions = await dnd.generateMissionsOnly(universe, charData, history);
        const savedMissions = [];
        for(const m of (rawMissions||[])) {
          if(!m.title) continue;
          try {
            const mid = await db.saveMission(
              universeId, m.title, m.summary||'', m.minLevel||1,
              m.maxLevel||4, m.difficulty||'normal',
              {hook:m.hook, reward:m.reward, location:m.location, antagonist:m.antagonist}
            );
            savedMissions.push({...m, id:mid});
          } catch(e) { savedMissions.push({...m, id:null}); }
        }
        socket.emit('dnd_missions_ready', {missions: savedMissions});
      }

    } catch(e) { console.error('enter_universe error:', e.message); socket.emit('dnd_error','Error cargando el universo'); }
  });

  // ── INICIAR MISIÓN ────────────────────────────────────────────
  socket.on('dnd_start_mission', async ({characterId, missionId, universeId}) => {
    const authUser = socketUsers[socket.id];
    if(!authUser) return socket.emit('dnd_error','Debes iniciar sesión');
    try {
      const [character, universe, mission] = await Promise.all([
        db.getCharacterById(characterId),
        db.getUniverseById(universeId),
        missionId ? db.getMissionById(missionId) : Promise.resolve(null)
      ]);
      if(!character||character.user_id!==authUser.userId) return socket.emit('dnd_error','Personaje inválido');
      if(!universe) return socket.emit('dnd_error','Universo no encontrado');
      if(character.status!=='alive') return socket.emit('dnd_error','Este personaje ha caído en combate');

      const charData = {
        id: socket.id,
        name: character.name, characterName: character.name, characterClass: character.class,
        level: character.level||1, xp: character.xp||0,
        hp: character.hp, maxHp: character.max_hp,
        str: character.str_stat, dex: character.dex_stat, int: character.int_stat, cha: character.cha_stat,
        stamina: character.stamina, maxStamina: character.max_stamina,
        mana: character.mana, maxMana: character.max_mana,
        learnedSkills: character.learned_skills||[],
        items: character.items||[],
        backstory: character.backstory||'',
        adventures_completed: character.adventures_completed||0,
        legendary_deeds: character.legendary_deeds||[],
        dbCharacterId: character.id,
      };

      socket.emit('dnd_processing', {message:'El Dungeon Master prepara tu aventura...'});

      const missionData = mission ? {...(mission.mission_json||{}), title:mission.title, summary:mission.summary} : {title:'Aventura libre', summary:'Una aventura espontánea en el universo'};
      const adventure = await dnd.generateAdventure(missionData, universe, charData);
      if(!adventure) return socket.emit('dnd_error','Error generando la aventura');

      const code = genCode();
      rooms[code] = {game:'dnd', phase:'playing', solo:true, players:[{id:socket.id, name:character.name, role:'player', score:0, userId:authUser.userId}], sv:emptySurvivalRoom(), hm:{word:'',guessed:[],wrongGuesses:0}, humanId:socket.id, interrogatorId:null, extraContext:null, allAnswers:[], activeAnswers:[], eliminationRound:0, leaderboard:[], totalRounds:3, currentRound:1, newQuestionCount:0, profile:null};
      socket.join(code); socket.roomCode = code;

      // Crear registro de aventura en DB
      const dbAdventureId = await db.startCharacterAdventure(character.id, missionId||null, universeId, {});
      if(mission) await db.incrementMissionPlayCount(missionId);

      // Leyendas para el DM
      const legends = await db.getUniverseLegends(universeId);
      const session = dnd.createDndSession(code, adventure, [charData], universeId, universe.name, missionData.title, dbAdventureId);
      session.dbCharacterId = character.id;
      session.dbAdventureId = dbAdventureId;
      session.universeLegends = legends;

      const musicParams = dnd.getMusicParams('mysterious','exploration');
      const initialChoices = [
        {id:'A', text:'Explorar los alrededores con cautela', risk:'low', diceType:'d20', stat:'DEX'},
        {id:'B', text:'Adentrarse directamente', risk:'high', diceType:'d20', stat:'STR'},
        {id:'C', text:'Preparar el campamento y planificar', risk:'low', diceType:'d20', stat:'INT'}
      ];

      socket.emit('dnd_mission_started', {
        adventure, session: dnd.serializeSession(session),
        musicParams, narration: adventure.openingScene,
        choices: initialChoices, code,
      });
      session.phase = 'decision';
      session.currentChoices = initialChoices;

    } catch(e) { console.error('start_mission error:', e.message); socket.emit('dnd_error','Error iniciando la misión'); }
  });

  // ── ACCIÓN DEL JUGADOR ────────────────────────────────────────
  socket.on('dnd_action', async ({code, choiceId, customAction}) => {
    const room = rooms[code];
    const session = dnd.getDndSession(code);
    if(!room || !session) return;
    if(session.phase !== 'decision') return socket.emit('dnd_error','No es momento de actuar');

    const player = session.players.find(p=>p.id===socket.id);
    if(!player || !player.alive) return socket.emit('dnd_error','Tu personaje no puede actuar');

    const actionText = customAction || choiceId || '';
    const diceRoll = dnd.executeActionRoll(actionText, player, player.characterClass);
    session.pendingActions[socket.id] = {action:actionText, diceRoll};

    io.to(code).emit('dnd_dice_rolled', {playerId:socket.id, playerName:player.characterName||player.name, diceRoll, action:actionText});
    io.to(code).emit('dnd_action_received', {playerId:socket.id, playerName:player.characterName||player.name, choiceId:customAction?`"${customAction}"`:choiceId, diceRollDesc:diceRoll.description, pendingCount:Object.keys(session.pendingActions).length, totalPlayers:session.players.filter(p=>p.alive).length});

    const alivePlayers = session.players.filter(p=>p.alive);
    const allActed = alivePlayers.every(p=>session.pendingActions[p.id]);

    if(allActed) {
      session.phase = 'processing';
      io.to(code).emit('dnd_processing', {message:'El Dungeon Master delibera...'});

      const actionsDesc = alivePlayers.map(p=>{const pend=session.pendingActions[p.id];const act=typeof pend==='object'?pend.action:pend;return`${p.characterName||p.name} eligió: ${act}`;}).join(' | ');
      const lead = alivePlayers[0];
      const leadPending = session.pendingActions[lead.id];
      const leadDiceRoll = typeof leadPending==='object' ? leadPending.diceRoll : null;
      session.pendingActions = {};

      if(leadDiceRoll?.critical) dnd.grantXPAll(session, dnd.XP_REWARDS.critical_hit, 'golpe crítico', io, code);

      try {
        const sceneResult = await dnd.generateScene(session, actionsDesc, lead, leadDiceRoll, session.universeLegends||[]);
        const effectsLog = [];

        if(leadDiceRoll?.damageResult && leadDiceRoll.success) {
          effectsLog.push(`⚔️ Daño: ${leadDiceRoll.damageResult.rolls.join('+')}+${leadDiceRoll.damageResult.bonus}=${leadDiceRoll.damageResult.total}${leadDiceRoll.critical?' ⭐CRÍTICO':''}`);
        }

        if(sceneResult.mechanicalEffects) {
          for(const fx of sceneResult.mechanicalEffects) {
            const target = session.players.find(p=>p.id===fx.playerId)||session.players[0];
            if(!target) continue;
            if(fx.stat==='hp') {
              const prev = target.hp;
              target.hp = Math.max(0, Math.min(target.maxHp, target.hp+(fx.change||0)));
              if(target.hp===0 && prev>0) {
                target.alive = false;
                const ds = dnd.deathSavingThrow(target);
                if(ds.died) effectsLog.push(`💀 ${target.characterName} ha MUERTO (3 fallos de muerte)`);
                else if(ds.stabilized) { target.alive=true; effectsLog.push(`🙏 ${target.characterName} se estabiliza (d20=20)`); }
                else effectsLog.push(`⚠️ ${target.characterName} INCONSCIENTE — ${ds.successes}✅ ${ds.failures}❌`);
              } else if(target.hp>0 && !target.dead) {
                target.alive=true;
                effectsLog.push(`${fx.change>0?'❤️':'💔'} ${target.characterName}: ${fx.change>0?'+':''}${fx.change} HP → ${target.hp}/${target.maxHp}`);
                if(target.hp<=Math.floor(target.maxHp*0.15)&&fx.change<0) dnd.grantXP(session,target.id,dnd.XP_REWARDS.near_death,'sobrevivir HP bajo',io,code);
              }
            } else if(['str','dex','int','cha'].includes(fx.stat)) {
              target[fx.stat]=Math.max(1,(target[fx.stat]||10)+(fx.change||0));
              effectsLog.push(`📊 ${target.characterName}: ${fx.stat.toUpperCase()} ${fx.change>=0?'+':''}${fx.change}`);
            } else if(fx.stat==='stamina'||fx.stat==='mana') {
              const resMax=target['max'+fx.stat.charAt(0).toUpperCase()+fx.stat.slice(1)]||0;
              target[fx.stat]=Math.max(0,Math.min(resMax,(target[fx.stat]||0)+(fx.change||0)));
              effectsLog.push(`${fx.stat==='mana'?'🔮':'⚡'} ${target.characterName}: ${fx.stat.toUpperCase()} ${fx.change>=0?'+':''}${fx.change}`);
            } else if(fx.stat==='items'&&fx.item) {
              if(!target.items) target.items=[];
              if(fx.change>0){target.items.push(fx.item);effectsLog.push(`🎒 ${target.characterName} obtuvo: ${fx.item}`);}
              else{target.items=target.items.filter(i=>i!==fx.item);effectsLog.push(`🗑 ${target.characterName} perdió: ${fx.item}`);}
            } else if(fx.stat==='condition') {
              if(!target.conditions) target.conditions=[];
              if(fx.remove){target.conditions=target.conditions.filter(c=>c!==fx.condition);effectsLog.push(`✨ ${target.characterName}: condición ${fx.condition} retirada`);}
              else if(fx.condition&&!target.conditions.includes(fx.condition)){target.conditions.push(fx.condition);effectsLog.push(`🔮 ${target.characterName}: ${fx.condition}`);}
            }
          }
        }

        if(sceneResult.currentLocation) session.currentLocation=sceneResult.currentLocation;
        session.history.push({player:lead.characterName||lead.name, action:actionsDesc, dice:leadDiceRoll?`${leadDiceRoll.icon} ${leadDiceRoll.label}`:'', outcome:sceneResult.narration?.substring(0,100)+'...'});
        if(session.history.length>20) session.history=session.history.slice(-20);

        // XP
        if(sceneResult.xpGrants&&Array.isArray(sceneResult.xpGrants)) {
          for(const grant of sceneResult.xpGrants) {
            if(grant.toAll) dnd.grantXPAll(session,grant.amount||10,grant.reason||'acción',io,code);
            else if(grant.playerId) dnd.grantXP(session,grant.playerId,grant.amount||10,grant.reason||'acción',io,code);
          }
        }
        if(sceneResult.chapterComplete) {
          dnd.grantXPAll(session,dnd.XP_REWARDS.chapter_complete,'capítulo completado',io,code);
          session.chapter=Math.min(session.chapter+1,session.adventure.estimatedChapters||5);
        }

        // Impacto en universo (inline)
        if(sceneResult.universeImpact?.hasImpact && session.universeId) {
          try {
            await db.addUniverseEvent(session.universeId, session.dbCharacterId, lead.characterName||lead.name,
              sceneResult.sceneType||'action', sceneResult.universeImpact.impactTitle,
              sceneResult.universeImpact.impactDescription, sceneResult.universeImpact.impactLevel||1);
            // Recargar leyendas si el impacto es alto
            if((sceneResult.universeImpact.impactLevel||1)>=3) {
              session.universeLegends = await db.getUniverseLegends(session.universeId);
            }
            io.to(code).emit('dnd_universe_event', {event: sceneResult.universeImpact});
            // Broadcast to ALL players subscribed to this universe (not just in this session)
            io.to(`universe_${session.universeId}`).emit('dnd_universe_event_global', {
              event: sceneResult.universeImpact,
              heroName: lead.characterName||lead.name,
              universeName: session.universeName,
            });
          } catch(e) { console.error('universe event error:', e.message); }
        }

        // Sincronizar personaje en DB (HP, recursos, items, nivel)
        if(session.dbCharacterId) {
          const p = session.players[0];
          try {
            await db.updateCharacter(session.dbCharacterId, {
              hp:p.hp, max_hp:p.maxHp,
              stamina:p.stamina||0, max_stamina:p.maxStamina||0,
              mana:p.mana||0, max_mana:p.maxMana||0,
              str_stat:p.str, dex_stat:p.dex, int_stat:p.int, cha_stat:p.cha,
              level:p.level||1, xp:p.xp||0,
              items:p.items||[], learned_skills:p.learnedSkills||[],
              conditions:p.conditions||[], last_location:session.currentLocation,
            });
          } catch(e) { console.error('updateChar error:', e.message); }
        }
        // Actualizar sesión de aventura
        if(session.dbAdventureId) {
          // ── FULL SESSION SAVE (enables resume) ─────────────────────
          try {
            const p0 = session.players[0];
            const snapshot = {
              chapter: session.chapter,
              currentLocation: session.currentLocation,
              history: session.history.slice(-15),
              lastScene: {
                narration: sceneResult.narration,
                choices: sceneResult.choices,
                sceneType: sceneResult.sceneType,
                mood: sceneResult.mood,
              },
              players: session.players.map(p=>({
                id:p.id, characterName:p.characterName, characterClass:p.characterClass,
                hp:p.hp, maxHp:p.maxHp, stamina:p.stamina, maxStamina:p.maxStamina,
                mana:p.mana, maxMana:p.maxMana, str:p.str, dex:p.dex, int:p.int, cha:p.cha,
                level:p.level, xp:p.xp, items:p.items, learnedSkills:p.learnedSkills,
                conditions:p.conditions, alive:p.alive, dead:p.dead,
              })),
              adventure: { title:session.adventure?.title, questGoal:session.adventure?.questGoal,
                           estimatedChapters:session.adventure?.estimatedChapters,
                           enemyAC:session.adventure?.enemyAC, bossAC:session.adventure?.bossAC,
                           startingItems:session.adventure?.startingItems },
              missionTitle: session.missionTitle,
              universeName: session.universeName,
              universeLegendIds: (session.universeLegends||[]).map(l=>l.id),
              savedAt: new Date().toISOString(),
            };
            await db.saveFullSession(session.dbAdventureId, snapshot);
          } catch(e) { console.error('saveFullSession error:', e.message); }
        }

        const musicParams = dnd.getMusicParams(sceneResult.mood||'mysterious', sceneResult.sceneType||'exploration');

        // Game over: todos muertos o gameOver del DM
        if(sceneResult.gameOver || session.players.every(p=>!p.alive&&p.dead)) {
          session.phase='gameover';
          // Matar personaje permanentemente si murió en combate
          for(const p of session.players) {
            if(p.dead && p.dbCharacterId) {
              try {
                await db.killCharacter(p.dbCharacterId, sceneResult.gameOverReason||'Cayó en combate');
                // Calcular impacto del legado
                const universe = await db.getUniverseById(session.universeId);
                // Solo generar impacto si el personaje tuvo aventuras o nivel > 1
                const charLvl = p.level||1;
                if(universe && (charLvl >= 2 || session.chapter > 1)) {
                  const charFull = await db.getCharacterById(p.dbCharacterId);
                  const impact = await dnd.generateAdventureImpact(session, {...charFull, class:charFull.class||p.characterClass, level:charLvl, adventures_completed:charFull?.adventures_completed||0}, universe, 'defeat');
                  if(impact?.hasImpact && impact.impactLevel>=2) {
                    await db.addUniverseEvent(session.universeId, p.dbCharacterId, p.characterName, 'death', `La caída de ${p.characterName}`, impact.impactDescription, impact.impactLevel);
                  }
                }
              } catch(e) { console.error('kill char error:', e.message); }
            }
          }
          if(session.dbAdventureId) { try { await db.updateCharacterAdventure(session.dbAdventureId,{history:session.history.slice(-10)},'defeat',sceneResult.narration?.substring(0,200),session.chapter); } catch(e){} }
          io.to(code).emit('dnd_gameover', {narration:sceneResult.narration, reason:sceneResult.gameOverReason||'El héroe cayó en la oscuridad...', session:dnd.serializeSession(session), musicParams:dnd.getMusicParams('horror','combat')});
          return;
        }

        // Victoria
        if(sceneResult.chapterComplete && session.chapter>=(session.adventure.estimatedChapters||5)) {
          session.phase='victory';
          // Actualizar personaje: aventura completada, XP final
          if(session.dbCharacterId) {
            const p = session.players[0];
            try {
              const charFull = await db.getCharacterById(session.dbCharacterId);
              const newAdvsCompleted = (charFull?.adventures_completed||0)+1;
              const universe = await db.getUniverseById(session.universeId);
              // Impacto de victoria
              const impact = universe ? await dnd.generateAdventureImpact(session, {...charFull, class:p.characterClass, level:p.level||1, adventures_completed:newAdvsCompleted}, universe, 'victory') : {hasImpact:false};
              await db.updateCharacter(session.dbCharacterId, {
                level:p.level||1, xp:p.xp||0, hp:p.hp, max_hp:p.maxHp,
                adventures_completed: newAdvsCompleted,
                last_location: session.currentLocation,
              });
              if(impact?.hasImpact) {
                await db.addUniverseEvent(session.universeId, session.dbCharacterId, p.characterName||p.name, 'victory', impact.impactTitle, impact.impactDescription, impact.impactLevel||1);
                // Si es leyenda (nivel 3+), añadir a hazañas del personaje
                if((impact.impactLevel||1)>=3) {
                  const deeds = charFull?.legendary_deeds||[];
                  deeds.push(impact.impactTitle);
                  await db.updateCharacter(session.dbCharacterId, {legendary_deeds:deeds.slice(-10)});
                }
              }
              if(session.dbAdventureId) await db.updateCharacterAdventure(session.dbAdventureId,{history:session.history.slice(-10)},'victory',impact?.impactDescription||'Victoria',session.chapter);
              io.to(code).emit('dnd_victory', {narration:sceneResult.narration, session:dnd.serializeSession(session), musicParams:dnd.getMusicParams('triumphant','rest'), impactSummary:impact?.hasImpact?impact.impactDescription:null});
            } catch(e) { console.error('victory update error:', e.message); io.to(code).emit('dnd_victory', {narration:sceneResult.narration, session:dnd.serializeSession(session), musicParams:dnd.getMusicParams('triumphant','rest')}); }
          }
          return;
        }

        session.phase='decision';
        session.currentChoices=sceneResult.choices||[];
        session.sceneData=sceneResult;

        io.to(code).emit('dnd_scene', {narration:sceneResult.narration, choices:sceneResult.choices, effectsLog, diceRoll:leadDiceRoll, session:dnd.serializeSession(session), musicParams, sceneType:sceneResult.sceneType, mood:sceneResult.mood, chapter:session.chapter, location:session.currentLocation});

      } catch(e) {
        console.error('DnD scene error:', e.message);
        session.phase='decision';
        io.to(code).emit('dnd_error','Error generando escena, intenta de nuevo');
      }
    }
  });

  // ── RESUME ADVENTURE ─────────────────────────────────────────
  socket.on('dnd_resume_adventure', async ({characterId}) => {
    const authUser = socketUsers[socket.id];
    if(!authUser) return socket.emit('dnd_error','Debes iniciar sesión');
    try {
      const [ongoing, character] = await Promise.all([
        db.getOngoingAdventure(characterId),
        db.getCharacterById(characterId)
      ]);
      if(!ongoing || !ongoing.session_data?.lastScene) return socket.emit('dnd_error','No hay aventura guardada para continuar');
      if(character.user_id !== authUser.userId) return socket.emit('dnd_error','No es tu personaje');

      const snap = ongoing.session_data;
      const universe = await db.getUniverseById(ongoing.universe_id);
      const legends = await db.getUniverseLegends(ongoing.universe_id);

      // Reconstruct adventure object from snapshot
      const adventure = {
        ...snap.adventure,
        title: snap.adventure?.title || snap.missionTitle || 'Aventura',
        openingScene: '',
        setting: snap.currentLocation,
        startingItems: snap.adventure?.startingItems || [],
      };

      // Create a new room + session from the snapshot
      const code = genCode();
      rooms[code] = {
        game:'dnd', phase:'playing', solo:true,
        players:[{id:socket.id, name:character.name, role:'player', score:0, userId:authUser.userId}],
        sv:emptySurvivalRoom(), hm:{word:'',guessed:[],wrongGuesses:0},
        humanId:socket.id, interrogatorId:null,
        extraContext:null, allAnswers:[], activeAnswers:[],
        eliminationRound:0, leaderboard:[], totalRounds:3, currentRound:1,
        newQuestionCount:0, profile:null
      };
      socket.join(code); socket.roomCode = code;

      // Restore player state from snapshot
      const savedPlayer = snap.players?.[0] || {};
      const charData = {
        id: socket.id,
        characterName: savedPlayer.characterName || character.name,
        characterClass: savedPlayer.characterClass || character.class,
        ...savedPlayer,
        dbCharacterId: character.id,
        backstory: character.backstory || '',
        legendary_deeds: character.legendary_deeds || [],
        adventures_completed: character.adventures_completed || 0,
      };

      const session = dnd.createDndSession(code, adventure, [charData], ongoing.universe_id, universe?.name||'Universo', snap.missionTitle||'Aventura', ongoing.id);
      session.chapter = snap.chapter || 1;
      session.currentLocation = snap.currentLocation || adventure.setting;
      session.history = snap.history || [];
      session.universeLegends = legends;
      session.dbCharacterId = character.id;
      session.dbAdventureId = ongoing.id;
      session._backstoryShown = true;

      // Restore player from snapshot more precisely
      const sp = session.players[0];
      Object.assign(sp, charData);
      sp.id = socket.id;

      const musicParams = dnd.getMusicParams(snap.lastScene?.mood||'mysterious', snap.lastScene?.sceneType||'exploration');

      socket.emit('dnd_resumed', {
        code,
        session: dnd.serializeSession(session),
        lastScene: snap.lastScene,
        choices: snap.lastScene?.choices || [],
        musicParams,
        chapter: session.chapter,
        location: session.currentLocation,
        missionTitle: snap.missionTitle,
        universeName: universe?.name,
        savedAt: snap.savedAt,
      });
      session.phase = 'decision';
      session.currentChoices = snap.lastScene?.choices || [];

    } catch(e) { console.error('resume error:', e.message); socket.emit('dnd_error','Error al continuar la aventura'); }
  });

  // ── SHOP ─────────────────────────────────────────────────────
  socket.on('dnd_buy_item', async ({code, itemId}) => {
    const session = dnd.getDndSession(code);
    if(!session) return socket.emit('dnd_error','Sesión no encontrada');
    const player = session.players.find(p=>p.id===socket.id);
    if(!player) return socket.emit('dnd_error','Jugador no encontrado');

    const shopItems = await db.getShopItems(session.universeId||0);
    const item = shopItems.find(i=>i.id===itemId);
    if(!item) return socket.emit('dnd_error','Ítem no encontrado');

    // Check gold — gold tracked as item in player.items array
    if(!player.items) player.items=[];
    const goldIdx = player.items.findIndex(i=>typeof i==='object'&&i.id==='gold');
    const gold = goldIdx>=0 ? (player.items[goldIdx].amount||0) : 0;
    if(item.cost>0 && gold < item.cost) return socket.emit('dnd_error',`Necesitas ${item.cost} monedas de oro (tienes ${gold})`);

    // Deduct gold
    if(item.cost>0) {
      if(goldIdx>=0) player.items[goldIdx].amount = gold - item.cost;
      else player.items.push({id:'gold',name:'Monedas de Oro',amount:-item.cost});
    }

    // Apply item effect
    const fx = item.effect;
    if(fx) {
      if(fx.stat==='hp') { player.hp=Math.min(player.maxHp,(player.hp||0)+fx.change); }
      else if(fx.stat==='stamina') { player.stamina=Math.min(player.maxStamina,(player.stamina||0)+fx.change); }
      else if(fx.stat==='mana') { player.mana=Math.min(player.maxMana,(player.mana||0)+fx.change); }
      else if(fx.stat==='int') { player.int=(player.int||10)+fx.change; }
      else if(fx.stat==='items' && fx.item) { player.items.push(fx.item); }
      else if(fx.stat==='condition') {
        if(!player.conditions) player.conditions=[];
        if(fx.remove) player.conditions=player.conditions.filter(c=>c!==fx.condition);
        else if(!player.conditions.includes(fx.condition)) player.conditions.push(fx.condition);
      }
    }

    session.log=session.log||[];
    session.log.push(`🛒 ${player.characterName} compró: ${item.icon} ${item.name}`);
    socket.emit('dnd_item_bought', {item, session: dnd.serializeSession(session)});
    io.to(code).emit('dnd_scene_update', {session: dnd.serializeSession(session), log: session.log.slice(-3)});

    // Sync to DB
    if(session.dbCharacterId) {
      try { await db.updateCharacter(session.dbCharacterId, {items:player.items, hp:player.hp, stamina:player.stamina||0, mana:player.mana||0, int_stat:player.int||10, conditions:player.conditions||[]}); } catch(e) {}
    }
  });

  // ── MULTIPLAYER D&D ───────────────────────────────────────────
  socket.on('dnd_create_party', async ({universeId, missionId, characterId}) => {
    const authUser = socketUsers[socket.id];
    if(!authUser) return socket.emit('dnd_error','Debes iniciar sesión');
    try {
      const [character, universe, mission] = await Promise.all([
        db.getCharacterById(characterId),
        universeId ? db.getUniverseById(universeId) : Promise.resolve(null),
        missionId  ? db.getMissionById(missionId)   : Promise.resolve(null),
      ]);
      if(!character||character.user_id!==authUser.userId) return socket.emit('dnd_error','Personaje inválido');
      if(character.status!=='alive') return socket.emit('dnd_error','Este personaje ha caído');
      // universe can be null — chosen later in lobby

      const code = genCode();
      rooms[code] = {
        game:'dnd', phase:'lobby', solo:false,
        players:[{id:socket.id, name:character.name, role:'player', score:0, userId:authUser.userId}],
        sv:emptySurvivalRoom(), hm:{word:'',guessed:[],wrongGuesses:0},
        humanId:socket.id, interrogatorId:null, extraContext:null, allAnswers:[],
        activeAnswers:[], eliminationRound:0, leaderboard:[], totalRounds:3,
        currentRound:1, newQuestionCount:0, profile:null,
        dndParty: [{
          socketId: socket.id,
          characterId: character.id,
          characterName: character.name,
          characterClass: character.class,
          userId: authUser.userId,
          dbCharacter: character,
        }],
        dndUniverseId: universeId,
        dndMissionId: missionId||null,
        dndMission: mission,
        dndUniverse: universe,
      };
      socket.join(code); socket.roomCode = code;
      socket.emit('dnd_party_created', {code, universe: {name:universe.name,atmosphere:universe.atmosphere}, mission: mission?{title:mission.title}:null, party: rooms[code].dndParty.map(p=>({socketId:p.socketId,characterName:p.characterName,characterClass:p.characterClass}))});
    } catch(e) { console.error('create_party error:', e.message); socket.emit('dnd_error','Error creando sala'); }
  });

  socket.on('dnd_join_party', async ({code, characterId}) => {
    const authUser = socketUsers[socket.id];
    if(!authUser) return socket.emit('dnd_error','Debes iniciar sesión');
    const room = rooms[code];
    if(!room||room.game!=='dnd'||room.phase!=='lobby') return socket.emit('dnd_error','Sala no disponible');
    if((room.dndParty||[]).length>=4) return socket.emit('dnd_error','La sala ya está llena (máx 4)');
    try {
      const character = await db.getCharacterById(characterId);
      if(!character||character.user_id!==authUser.userId) return socket.emit('dnd_error','Personaje inválido');
      if(character.status!=='alive') return socket.emit('dnd_error','Este personaje ha caído');
      room.players.push({id:socket.id, name:character.name, role:'player', score:0, userId:authUser.userId});
      room.dndParty.push({socketId:socket.id, characterId:character.id, characterName:character.name, characterClass:character.class, userId:authUser.userId, dbCharacter:character});
      socket.join(code); socket.roomCode=code;
      io.to(code).emit('dnd_party_updated', {party: room.dndParty.map(p=>({socketId:p.socketId,characterName:p.characterName,characterClass:p.characterClass})), code});
    } catch(e) { socket.emit('dnd_error','Error uniéndose'); }
  });

  socket.on('dnd_start_party', async ({code, universeId, missionId}) => {
    const authUser = socketUsers[socket.id];
    const room = rooms[code];
    if(!room||room.game!=='dnd'||room.phase!=='lobby') return socket.emit('dnd_error','Sala no disponible');
    if(room.players[0]?.id!==socket.id) return socket.emit('dnd_error','Solo el host puede iniciar');
    if((room.dndParty||[]).length<1) return socket.emit('dnd_error','Necesitas al menos 1 jugador');
    // Use universeId/missionId from event (chosen in lobby) or fall back to room data
    const useUniverseId = universeId || room.dndUniverseId;
    const useMissionId  = missionId  || room.dndMissionId;
    if(!useUniverseId) return socket.emit('dnd_error','Elige un universo primero');
    try {
      room.phase='playing';
      // Load universe and mission if not already in room
      if(!room.dndUniverse || room.dndUniverse.id !== useUniverseId) {
        room.dndUniverse = await db.getUniverseById(useUniverseId);
        room.dndUniverseId = useUniverseId;
      }
      if(useMissionId && !room.dndMission) {
        room.dndMission = await db.getMissionById(useMissionId);
        room.dndMissionId = useMissionId;
      }
      const missionData = room.dndMission ? {...(room.dndMission.mission_json||{}),title:room.dndMission.title,summary:room.dndMission.summary} : {title:'Aventura grupal',summary:'Una aventura en grupo'};
      const anyCharData = {name:room.dndParty[0].characterName, class:room.dndParty[0].characterClass, level:room.dndParty[0].dbCharacter?.level||1};
      io.to(code).emit('dnd_processing',{message:'El Dungeon Master prepara la aventura del grupo...'});
      const adventure = await dnd.generateAdventure(missionData, room.dndUniverse, anyCharData);
      if(!adventure) return io.to(code).emit('dnd_error','Error generando aventura');
      const legends = await db.getUniverseLegends(room.dndUniverseId);
      const charDataArray = room.dndParty.map(p=>({
        id: p.socketId,
        characterName:p.characterName, name:p.characterName,
        characterClass:p.characterClass,
        level:p.dbCharacter?.level||1, xp:p.dbCharacter?.xp||0,
        hp:p.dbCharacter?.hp||20, maxHp:p.dbCharacter?.max_hp||20,
        str:p.dbCharacter?.str_stat||10, dex:p.dbCharacter?.dex_stat||10,
        int:p.dbCharacter?.int_stat||10, cha:p.dbCharacter?.cha_stat||10,
        stamina:p.dbCharacter?.stamina||0, maxStamina:p.dbCharacter?.max_stamina||0,
        mana:p.dbCharacter?.mana||0, maxMana:p.dbCharacter?.max_mana||0,
        learnedSkills:p.dbCharacter?.learned_skills||[], items:p.dbCharacter?.items||[],
        backstory:p.dbCharacter?.backstory||'', dbCharacterId:p.characterId,
      }));
      const dbAdvId = await db.startCharacterAdventure(room.dndParty[0].characterId, room.dndMissionId||null, room.dndUniverseId, {});
      const session = dnd.createDndSession(code, adventure, charDataArray, room.dndUniverseId, room.dndUniverse.name, missionData.title, dbAdvId);
      session.universeLegends=legends; session.dbCharacterId=room.dndParty[0].characterId; session.dbAdventureId=dbAdvId;
      const initialChoices=[{id:'A',text:'Explorar con cautela',risk:'low',diceType:'d20',stat:'DEX'},{id:'B',text:'Adentrarse directo',risk:'high',diceType:'d20',stat:'STR'},{id:'C',text:'Planificar',risk:'low',diceType:'d20',stat:'INT'}];
      io.to(code).emit('dnd_mission_started',{adventure,session:dnd.serializeSession(session),musicParams:dnd.getMusicParams('mysterious','exploration'),narration:adventure.openingScene,choices:initialChoices,code});
      session.phase='decision'; session.currentChoices=initialChoices;
    } catch(e) { console.error('start_party error:',e.message); io.to(code).emit('dnd_error','Error iniciando aventura grupal'); }
  });

  // ── UNIVERSE NOTIFICATIONS (broadcast to all in universe) ────
  socket.on('dnd_subscribe_universe', ({universeId}) => {
    socket.join(`universe_${universeId}`);
  });
  socket.on('dnd_unsubscribe_universe', ({universeId}) => {
    socket.leave(`universe_${universeId}`);
  });

  // ── LEVEL UP / PUNTOS ──────────────────────────────────────────
  socket.on('dnd_spend_points', ({code, skillId, statKey}) => {
    const session = dnd.getDndSession(code);
    if(!session) return socket.emit('dnd_error','Sesión no encontrada');
    const player = session.players.find(p=>p.id===socket.id);
    if(!player) return socket.emit('dnd_error','Jugador no encontrado');

    if(skillId) {
      if(!(player.skillPtsAvailable>0)) return socket.emit('dnd_error','Sin puntos de habilidad');
      const skill = skills.SKILL_INDEX[skillId];
      if(!skill) return socket.emit('dnd_error','Habilidad inválida');
      const reqMet=!skill.req?.length||skill.req.every(r=>(player.learnedSkills||[]).includes(r));
      if(!reqMet) return socket.emit('dnd_error','Necesitas las habilidades requeridas primero');
      if((player.learnedSkills||[]).includes(skillId)) return socket.emit('dnd_error','Ya tienes esta habilidad');
      const has5=(player.learnedSkills||[]).some(id=>skills.SKILL_INDEX[id]?.stars===5);
      if(skill.stars===5&&has5) return socket.emit('dnd_error','Solo 1 habilidad de 5⭐');
      const ownClass=skills.ALL_SKILLS[player.characterClass]||[];
      const isOwn=ownClass.some(s=>s.id===skillId)||skill.cat==='Universal';
      const cost=isOwn?1:2;
      if(player.skillPtsAvailable<cost) return socket.emit('dnd_error',`Necesitas ${cost} puntos`);
      player.learnedSkills=[...(player.learnedSkills||[]),skillId];
      player.skillPtsAvailable-=cost;
      player.pendingLevelUp=player.skillPtsAvailable>0||player.statPtsAvailable>0;
      socket.emit('dnd_points_spent',{type:'skill',skillId,remaining:player.skillPtsAvailable,statRemaining:player.statPtsAvailable});
      io.to(code).emit('dnd_scene_update',{session:dnd.serializeSession(session)});
    }
    if(statKey&&['str','dex','int','cha','hp'].includes(statKey)) {
      if(!(player.statPtsAvailable>0)) return socket.emit('dnd_error','Sin puntos de stat');
      player[statKey]=(player[statKey]||10)+1;
      if(statKey==='hp'){player.maxHp++;player.hp++;}
      player.statPtsAvailable--;
      player.pendingLevelUp=player.skillPtsAvailable>0||player.statPtsAvailable>0;
      socket.emit('dnd_points_spent',{type:'stat',statKey,newVal:player[statKey],remaining:player.skillPtsAvailable,statRemaining:player.statPtsAvailable});
      io.to(code).emit('dnd_scene_update',{session:dnd.serializeSession(session)});
    }
  });

  // Host updates universe/mission selection — broadcast to room
  socket.on('dnd_party_config', ({code, universeId, missionId, universeName, missionTitle}) => {
    const room = rooms[code];
    if(!room||room.game!=='dnd') return;
    if(room.players[0]?.id !== socket.id) return; // only host
    room.dndUniverseId = universeId;
    room.dndMissionId  = missionId||null;
    // Broadcast to all in room so joiners see current selection
    io.to(code).emit('dnd_party_updated', {
      party: room.dndParty.map(p=>({socketId:p.socketId,characterName:p.characterName,characterClass:p.characterClass})),
      code,
      universeId, missionId, universeName, missionTitle
    });
  });

  socket.on('disconnect', () => {
    delete socketUsers[socket.id];
    // Leave all universe rooms
    const code=socket.roomCode;
    if(!code||!rooms[code]) return;
    io.to(code).emit('player_left');
    delete rooms[code];
  });
  };
}

module.exports = { registerDndRoutes, registerDndSockets };
