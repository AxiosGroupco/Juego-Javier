// ── D&D MODULE — JL Arcade · Universos Persistentes ───────────
const https = require('https');
const skills = require('./skills');

// ── DADOS ──────────────────────────────────────────────────────
const DICE={d4:()=>Math.floor(Math.random()*4)+1,d6:()=>Math.floor(Math.random()*6)+1,d8:()=>Math.floor(Math.random()*8)+1,d10:()=>Math.floor(Math.random()*10)+1,d12:()=>Math.floor(Math.random()*12)+1,d20:()=>Math.floor(Math.random()*20)+1};
function rollDice(count,type){let total=0;const rolls=[];for(let i=0;i<count;i++){const r=DICE[type]();rolls.push(r);total+=r;}return{total,rolls,type,count};}
function statModifier(stat){return Math.floor(((stat||10)-10)/2);}
function damageRoll(cls,critical=false){const cfg={Guerrero:{count:1,type:'d10',bonus:2},Mago:{count:2,type:'d6',bonus:0},Picaro:{count:1,type:'d8',bonus:1},Bardo:{count:1,type:'d8',bonus:0}};const c=cfg[cls]||{count:1,type:'d6',bonus:0};const count=critical?c.count*2:c.count;const result=rollDice(count,c.type);return{...result,bonus:c.bonus,total:result.total+c.bonus,critical};}
function resolveActionCheck(action,player){const a=(action||'').toLowerCase();if(/atac|golpe|corta|lucha|embiste|hacha|espada|hiere|apuñal/.test(a))return{type:'attack',stat:player.str,dc:13,statName:'STR'};if(/sigilo|escond|roba|salta|trepa|esquiva|huye|furtivo|acrobac/.test(a))return{type:'skill',stat:player.dex,dc:12,statName:'DEX'};if(/hechi|conjur|magi|runa|arcano|invoca|encanta/.test(a))return{type:'spell',stat:player.int,dc:14,statName:'INT'};if(/convenc|negocia|persuad|miente|enga|canta|inspira|intimida/.test(a))return{type:'social',stat:player.cha,dc:11,statName:'CHA'};if(/investiga|busca|examina|identific|descifra|recuerda|analiza/.test(a))return{type:'investigation',stat:player.int,dc:12,statName:'INT'};return{type:'general',stat:10,dc:12,statName:'general'};}
function executeActionRoll(action,player,cls){const check=resolveActionCheck(action,player);const roll=DICE.d20();const mod=statModifier(check.stat);const total=roll+mod;const critical=roll===20,fumble=roll===1,success=critical||(!fumble&&total>=check.dc);let outcome;if(fumble)outcome='fumble';else if(total>=check.dc+5)outcome='critical_success';else if(success)outcome='success';else if(total>=check.dc-3)outcome='partial';else outcome='failure';let dmg=null;if((check.type==='attack'||check.type==='spell')&&success)dmg=damageRoll(cls,critical);const icon={fumble:'💀',failure:'❌',partial:'⚠️',success:'✅',critical_success:'⭐'}[outcome]||'🎲';const label={fumble:'¡FALLO CRÍTICO!',failure:'Fallo',partial:'Éxito parcial',success:'Éxito',critical_success:'¡ÉXITO CRÍTICO!'}[outcome];return{roll,modifier:mod,total,dc:check.dc,statName:check.statName,checkType:check.type,outcome,success,critical,fumble,damageResult:dmg,icon,label,description:`${icon} d20: **${roll}** (${check.statName} ${mod>=0?'+':''}${mod}=${total} vs DC ${check.dc}) — ${label}`};}
function deathSavingThrow(player){if(!player.deathSaves)player.deathSaves={successes:0,failures:0};const roll=DICE.d20();if(roll===20){player.hp=1;player.alive=true;player.deathSaves={successes:0,failures:0};return{roll,stabilized:true,miraculous:true};}if(roll===1)player.deathSaves.failures+=2;else if(roll>=10)player.deathSaves.successes++;else player.deathSaves.failures++;if(player.deathSaves.successes>=3){player.deathSaves={successes:0,failures:0};return{roll,stabilized:true};}if(player.deathSaves.failures>=3){player.alive=false;player.dead=true;return{roll,died:true};}return{roll,successes:player.deathSaves.successes,failures:player.deathSaves.failures};}

// ── CLAUDE ─────────────────────────────────────────────────────
function callClaude(messages,maxTokens=1500,system=''){return new Promise((resolve)=>{const body=JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:maxTokens,system:system||undefined,messages});const options={hostname:'api.anthropic.com',path:'/v1/messages',method:'POST',headers:{'Content-Type':'application/json','x-api-key':(process.env.ANTHROPIC_API_KEY||'').trim(),'anthropic-version':'2023-06-01','Content-Length':Buffer.byteLength(body)}};const req=https.request(options,(res)=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>{try{const parsed=JSON.parse(data);const text=parsed.content.map(b=>b.text||'').join('').replace(/```json\n?|```/g,'').trim();resolve(text);}catch{resolve(null);}});});req.on('error',()=>resolve(null));req.write(body);req.end();});}

const DM_SYSTEM=`Eres el Dungeon Master de universos persistentes de D&D 5e compartidos entre muchos jugadores.
Las acciones de cada personaje moldean permanentemente la historia del universo.
MECÁNICAS D&D 5e: Modificadores stat=floor((stat-10)/2). Respeta SIEMPRE el resultado del d20.
fumble(1)=algo sale MUY mal. failure=falla. partial=éxito con costo. success=éxito. critical_success(20)=algo extraordinario.
CA enemigos: básicos 10-12, soldados 13-15, jefes 16-18.
CONDICIONES: aturdido, envenenado, asustado, paralizado.
MUERTE: 0HP=inconsciente(tiradas de salvación). dead=muerto permanente.
RECURSOS: Guerrero/Pícaro ESTAMINA, Mago/Bardo MANÁ.
LEGADOS: Menciona eventos pasados de otros héroes si son relevantes para crear continuidad.
Usa los nombres de los personajes. RESPONDE en español. FORMATO: JSON estricto sin markdown.`;

// ── GENERADORES ────────────────────────────────────────────────
async function generateUniverseLore(name,description,atmosphere){
  const prompt=`Crea el lore completo de un universo de fantasía llamado "${name}".
Descripción: "${description}". Atmósfera: "${atmosphere}".
Responde SOLO JSON:
{"age":"nombre de la era y año","continents":["continente1 — desc breve","continente2","continente3"],"factions":["Facción1 — rol","Facción2","Facción3","Facción4"],"currentConflict":"conflicto principal (2-3 oraciones)","hooks":["Misterio1","Misterio2","Misterio3"],"cosmology":"dioses/magia/fuerzas cósmicas (2 oraciones)","openingNarration":"narración épica de introducción (3-4 párrafos, segunda persona)"}`;
  const result=await callClaude([{role:'user',content:prompt}],1500,DM_SYSTEM);
  try{return JSON.parse(result);}catch{return null;}
}

// ── GENERACIÓN SEPARADA: intro y misiones son independientes ──
// Intro: pequeña, rápida (~1-2s), se muestra primero
async function generateUniverseIntroOnly(universe,character,legends){
  const lore=universe.lore||{};
  const legsCtx=legends.slice(0,2).map(l=>`${l.title}(${l.character_name||'?'})`).join(', ')||'ninguna';
  const prompt=`Universo: "${universe.name}" — ${(lore.currentConflict||'').slice(0,100)}
Personaje: ${character.name} (${character.class} Nv${character.level||1}) — "${(character.backstory||'').slice(0,100)}"
Leyendas conocidas: ${legsCtx}

Escribe SOLO una narración de bienvenida: 2 párrafos breves. Conecta la historia del personaje con el universo. Directo y dramático.`;
  return await callClaude([{role:'user',content:prompt}],500,DM_SYSTEM);
}

// Misiones: puede reutilizar caché de DB, solo se llama si no hay misiones guardadas
async function generateMissionsOnly(universe,character,history){
  const lore=universe.lore||{};
  const univCtx=`${lore.age||''} Conflicto: ${(lore.currentConflict||'').slice(0,80)}`;
  const histCtx=history.slice(0,4).map(h=>h.title).join(', ')||'Sin eventos previos';
  const charLevel=character.level||1;
  const prompt=`Universo: "${universe.name}" — ${univCtx}
Historia: ${histCtx}
Personaje: ${character.name} (${character.class} Nv${charLevel}) — "${(character.backstory||'').slice(0,80)}"

Crea 4 misiones. JSON array SOLAMENTE:
[{"title":"nombre corto","summary":"1 oración","hook":"por qué este personaje (10 palabras)","minLevel":1,"maxLevel":3,"difficulty":"easy","location":"lugar","antagonist":"enemigo"},
{"title":"","summary":"","hook":"","minLevel":${charLevel},"maxLevel":${charLevel+2},"difficulty":"normal","location":"","antagonist":""},
{"title":"","summary":"","hook":"","minLevel":${charLevel+1},"maxLevel":${charLevel+4},"difficulty":"hard","location":"","antagonist":""},
{"title":"","summary":"","hook":"","minLevel":${charLevel+3},"maxLevel":${charLevel+6},"difficulty":"legendary","location":"","antagonist":""}]`;
  const result=await callClaude([{role:'user',content:prompt}],700,DM_SYSTEM);
  try{const p=JSON.parse(result);return Array.isArray(p)?p:[];}catch{return[];}
}

// Alias para compatibilidad con código heredado
async function generateUniverseEntry(universe,character,history,legends){
  const[introNarration,missions]=await Promise.all([
    generateUniverseIntroOnly(universe,character,legends),
    generateMissionsOnly(universe,character,history)
  ]);
  return{introNarration,missions};
}
async function generateUniverseIntro(universe,character,legends){
  return generateUniverseIntroOnly(universe,character,legends);
}
async function generateMissions(universe,character,history,count=4){
  const m=await generateMissionsOnly(universe,character,history);
  return m.slice(0,count);
}

async function generateAdventure(missionData,universe,character){
  const prompt=`Crea una aventura D&D para la misión "${missionData.title||missionData}" en el universo "${universe.name}".\nLore: ${JSON.stringify(universe.lore)}\nPersonaje: ${character.name} (${character.class} Nivel ${character.level})\nBackstory: "${character.backstory||''}"\nMisión: ${missionData.summary||''}\nAntagonista: ${missionData.antagonist||'desconocido'}\nUbicación: ${missionData.location||'el universo'}\n\nRespode SOLO JSON:\n{"title":"título","summary":"resumen 2 oraciones","setting":"descripción del lugar","mainVillain":"nombre y descripción","questGoal":"objetivo concreto","openingScene":"apertura dramática 3-4 párrafos segunda persona conectando backstory","atmosphere":"dark|epic|mysterious|horror|adventure","estimatedChapters":4,"startingItems":["Poción de Curación (2d4+2 HP)","Antorcha x3"],"enemyAC":12,"bossAC":16}`;
  const result=await callClaude([{role:'user',content:prompt}],1000,DM_SYSTEM);
  try{return JSON.parse(result);}catch{return null;}
}

async function generateAdventureImpact(session,character,universe,outcome){
  const prompt=`Personaje: ${character.name} (${character.class} Nivel ${character.level}) ${outcome==='victory'?'completó':'falló/murió en'} "${session.missionTitle||session.adventure?.title}" en "${universe.name}".\nHistorial:\n${session.history.slice(-6).map(h=>`${h.player}: ${h.action}`).join('\n')||'Sin historial'}\nNivel: ${character.level}, aventuras completadas: ${character.adventures_completed||0}\n\nGenera impacto en el universo.\n- Nivel 1-2 sin aventuras y murió: sin impacto (hasImpact:false)\n- Completó aventura: impacto local\n- Nivel 5+: puede ser legendario\nResponde SOLO JSON:\n{"hasImpact":false,"impactTitle":"título corto","impactDescription":"1-2 oraciones","impactLevel":1,"updateLore":false,"lorePatch":{}}\nimpactLevel: 1=menor,2=notable,3=significativo,4=épico,5=legendario`;
  const result=await callClaude([{role:'user',content:prompt}],400,DM_SYSTEM);
  try{return JSON.parse(result);}catch{return{hasImpact:false};}
}

async function generateScene(session,actionTaken,actingPlayer,diceRollResult,universeLegends){
  // ── Descripción compacta del grupo (sin backstory repetida) ──
  const partyDesc=session.players.map(p=>{
    const rk=p.resource||'stamina';const rc=p[rk]||0;const rm=p['max'+rk.charAt(0).toUpperCase()+rk.slice(1)]||0;
    const mod=s=>(statModifier(s)>=0?'+':'')+statModifier(s);
    const base=`${p.characterName}(${p.characterClass} Nv${p.level||1},HP:${p.hp}/${p.maxHp},${rk.toUpperCase()}:${rc}/${rm},STR${mod(p.str)} DEX${mod(p.dex)} INT${mod(p.int)} CHA${mod(p.cha)})`;
    const cond=(p.conditions||[]).length?` [${p.conditions.join(',')}]`:'';
    const dying=p.hp===0?` INCONS(${p.deathSaves?.successes||0}✅${p.deathSaves?.failures||0}❌)`:'';
    // Backstory solo en turno 1; después solo nombre de hazaña reciente
    const extra=!session._backstoryShown&&p.backstory?` BS:"${p.backstory.slice(0,80)}"`:
      (p.legendary_deeds?.length?` [${p.legendary_deeds.slice(-1)[0]?.slice(0,40)||''}]`:'');
    return base+cond+dying+extra;
  }).join('\n');
  session._backstoryShown=true;
  // Solo 2 leyendas recortadas a 80 chars para minimizar tokens
  const legsCtx=universeLegends&&universeLegends.length>0?'\nLEYENDAS: '+universeLegends.slice(0,2).map(l=>`${l.title}(${l.character_name||'?'})`).join('; '):'';
  const diceInfo=diceRollResult?`\nDADOS (RESPETAR): d20:${diceRollResult.roll} ${diceRollResult.statName}(${diceRollResult.modifier>=0?'+':''}${diceRollResult.modifier})=${diceRollResult.total} vs DC ${diceRollResult.dc} → ${diceRollResult.outcome.toUpperCase()} — ${diceRollResult.label}${diceRollResult.damageResult?`\nDAÑO:[${diceRollResult.damageResult.rolls.join('+')}]+${diceRollResult.damageResult.bonus}=${diceRollResult.damageResult.total}${diceRollResult.critical?' ⭐CRÍTICO':''}`:''}`:'';
  const prompt=`UNIVERSO: ${session.universeName||'Desconocido'}\nAVENTURA: ${session.adventure?.title}\nOBJETIVO: ${session.adventure?.questGoal}\nCAPÍTULO: ${session.chapter}/${session.adventure?.estimatedChapters||5}\nUBICACIÓN: ${session.currentLocation}\nMISIÓN: ${session.missionTitle||'Aventura libre'}\n${legsCtx}\nGRUPO:\n${partyDesc}\nHISTORIAL:\n${session.history.slice(-3).map(h=>`${h.player}: ${(h.action||'').slice(0,60)}${h.dice?' '+h.dice:''}`).join('\n')||'Inicio'}\nACCIÓN: "${actionTaken}"${diceInfo}\nCA ENEMIGOS:${session.adventure?.enemyAC||12} CA JEFE:${session.adventure?.bossAC||16}\n\nJSON ESTRICTO:\n{"narration":"narración 2 párrafos","mechanicalEffects":[{"playerId":"id","stat":"hp|stamina|mana|items|condition","change":0,"item":"","condition":"","remove":false,"reason":""}],"currentLocation":"lugar","choices":[{"id":"A","text":"opción","risk":"low|medium|high","diceType":"d20","stat":"STR"},{"id":"B","text":"opción","risk":"medium","diceType":"d20","stat":"DEX"},{"id":"C","text":"opción","risk":"low","diceType":"d20","stat":"CHA"}],"sceneType":"combat|exploration|puzzle|rest|boss","mood":"tense|calm|epic|horror|triumphant|mysterious","chapterComplete":false,"gameOver":false,"gameOverReason":"","universeImpact":{"hasImpact":false,"impactTitle":"","impactDescription":"","impactLevel":1},"xpGrants":[{"reason":"enemy_defeated","amount":25,"toAll":true}]}`;
  const result=await callClaude([{role:'user',content:prompt}],900,DM_SYSTEM);
  try{return JSON.parse(result);}catch{return{narration:result||'El DM contempla...',mechanicalEffects:[],currentLocation:session.currentLocation,choices:[{id:'A',text:'Avanzar con cautela',risk:'low',diceType:'d20',stat:'DEX'},{id:'B',text:'Atacar',risk:'high',diceType:'d20',stat:'STR'},{id:'C',text:'Buscar otra ruta',risk:'medium',diceType:'d20',stat:'INT'}],sceneType:'exploration',mood:'mysterious',chapterComplete:false,gameOver:false,universeImpact:{hasImpact:false}};}
}

// ── MÚSICA ─────────────────────────────────────────────────────
function getMusicParams(mood,sceneType){const p={tense_combat:{tempo:160,scale:'minor',baseFreq:55,reverb:0.3,drone:true,arpSpeed:0.15},tense_exploration:{tempo:80,scale:'minor',baseFreq:49,reverb:0.6,drone:true,arpSpeed:0.3},calm_rest:{tempo:60,scale:'major',baseFreq:65,reverb:0.8,drone:false,arpSpeed:0.5},calm_exploration:{tempo:70,scale:'major',baseFreq:55,reverb:0.7,drone:false,arpSpeed:0.4},epic_combat:{tempo:180,scale:'minor',baseFreq:41,reverb:0.2,drone:true,arpSpeed:0.1},epic_boss:{tempo:140,scale:'minor',baseFreq:37,reverb:0.4,drone:true,arpSpeed:0.12},horror_combat:{tempo:100,scale:'dim',baseFreq:46,reverb:0.5,drone:true,arpSpeed:0.2},horror_exploration:{tempo:50,scale:'dim',baseFreq:41,reverb:0.9,drone:true,arpSpeed:0.6},triumphant_rest:{tempo:90,scale:'major',baseFreq:65,reverb:0.5,drone:false,arpSpeed:0.35},mysterious_puzzle:{tempo:65,scale:'phrygian',baseFreq:52,reverb:0.8,drone:true,arpSpeed:0.45},mysterious_exploration:{tempo:55,scale:'phrygian',baseFreq:49,reverb:0.85,drone:true,arpSpeed:0.5}};const k=`${mood}_${sceneType}`;return p[k]||p[`${mood}_exploration`]||p.mysterious_exploration;}

// ── XP / NIVEL ─────────────────────────────────────────────────
const XP_TABLE=[0,300,900,2700,6500,14000,23000,34000,48000,64000,85000];
const XP_REWARDS={chapter_complete:80,boss_killed:100,puzzle_solved:50,enemy_defeated:25,clever_action:30,near_death:20,sacrifice:40,critical_hit:10};
function getXpToNextLevel(level){return XP_TABLE[Math.min(level,XP_TABLE.length-1)]||85000;}
function grantXP(session,playerId,amount,reason,io,code){const player=session.players.find(p=>p.id===playerId);if(!player||!player.alive)return;player.xp=(player.xp||0)+amount;session.log=session.log||[];session.log.push(`✨ ${player.characterName} +${amount} XP (${reason})`);checkLevelUp(player,session,io,code);}
function grantXPAll(session,amount,reason,io,code){session.players.filter(p=>p.alive).forEach(p=>{p.xp=(p.xp||0)+amount;checkLevelUp(p,session,io,code);});session.log=session.log||[];session.log.push(`✨ Todo el grupo +${amount} XP (${reason})`);}
function checkLevelUp(player,session,io,code){const needed=getXpToNextLevel(player.level||1);if(player.xp>=needed&&(player.level||1)<10){player.level=(player.level||1)+1;player.xp-=needed;player.skillPtsAvailable=(player.skillPtsAvailable||0)+2;player.statPtsAvailable=(player.statPtsAvailable||0)+1;const hpByClass={Guerrero:6,Picaro:4,Mago:3,Bardo:4};const hpGain=Math.max(1,(hpByClass[player.characterClass]||4)+statModifier(player.str||10));player.maxHp+=hpGain;player.hp=Math.min(player.hp+hpGain,player.maxHp);if(player.maxStamina>0)player.maxStamina+=3;if(player.maxMana>0)player.maxMana+=3;player.pendingLevelUp=true;session.log=session.log||[];session.log.push(`🎉 ${player.characterName} → Nivel ${player.level}`);if(io&&code)io.to(code).emit('dnd_level_up',{playerId:player.id,playerName:player.characterName,newLevel:player.level,skillPtsAvailable:player.skillPtsAvailable,statPtsAvailable:player.statPtsAvailable});checkLevelUp(player,session,io,code);}}

// ── SESIONES ───────────────────────────────────────────────────
const dndSessions={};
function createDndSession(code,adventure,players,universeId,universeName,missionTitle,dbSessionId){dndSessions[code]={adventure,universeId,universeName:universeName||'Universo',missionTitle:missionTitle||'',dbSessionId:dbSessionId||null,players:players.map(p=>{const baseStats=skills.CLASS_STATS[p.characterClass]||skills.CLASS_STATS['Guerrero'];const resource=skills.CLASS_RESOURCE[p.characterClass]||'stamina';return{...baseStats,...p,id:p.id||`player_${Math.random().toString(36).slice(2,7)}`,str:(baseStats.str||10)+(p.statPoints?.str||0),dex:(baseStats.dex||10)+(p.statPoints?.dex||0),int:(baseStats.int||10)+(p.statPoints?.int||0),cha:(baseStats.cha||10)+(p.statPoints?.cha||0),hp:(baseStats.hp||20)+(p.statPoints?.hp||0),maxHp:(baseStats.maxHp||20)+(p.statPoints?.hp||0),stamina:baseStats.stamina||0,maxStamina:baseStats.maxStamina||0,mana:baseStats.mana||0,maxMana:baseStats.maxMana||0,resource,learnedSkills:p.learnedSkills||[],items:adventure.startingItems?[...adventure.startingItems]:[],alive:true,dead:false,conditions:[],deathSaves:{successes:0,failures:0},actionsThisTurn:0,xp:p.xp||0,level:p.level||1,skillPtsAvailable:0,statPtsAvailable:0,pendingLevelUp:false,dbCharacterId:p.dbCharacterId||null,backstory:p.backstory||'',adventures_completed:p.adventures_completed||0,legendary_deeds:p.legendary_deeds||[]};}),chapter:1,currentLocation:adventure.setting||'La aventura comienza',history:[],phase:'intro',currentChoices:[],pendingActions:{},sceneData:null,log:[],createdAt:Date.now()};return dndSessions[code];}
function getDndSession(code){return dndSessions[code]||null;}
function deleteDndSession(code){delete dndSessions[code];}
function serializeSession(session){return{players:session.players.map(p=>({...p,xpToNext:getXpToNextLevel(p.level||1)})),chapter:session.chapter,currentLocation:session.currentLocation,phase:session.phase,adventureTitle:session.adventure?.title,estimatedChapters:session.adventure?.estimatedChapters||5,universeName:session.universeName,missionTitle:session.missionTitle};}

module.exports={generateAdventure,generateScene,getMusicParams,generateUniverseLore,generateUniverseIntroOnly,generateMissionsOnly,generateUniverseIntro,generateMissions,generateAdventureImpact,createDndSession,getDndSession,deleteDndSession,serializeSession,grantXP,grantXPAll,XP_REWARDS,getXpToNextLevel,checkLevelUp,executeActionRoll,deathSavingThrow,rollDice,DICE,statModifier};
