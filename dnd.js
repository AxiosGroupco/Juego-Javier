// ── D&D MODULE — JL Arcade ─────────────────────────────────────
// Toda la lógica del juego Dragones y Mazmorras
// IA se encarga de: narración, decisiones, imágenes SVG, música contextual

const https = require('https');
const skills = require('./skills');

// ── CLAUDE API ─────────────────────────────────────────────────
function callClaude(messages, maxTokens=1500, system='') {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system: system || undefined,
      messages
    });
    const options = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': (process.env.ANTHROPIC_API_KEY||'').trim(),
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.content.map(b=>b.text||'').join('').replace(/```json\n?|```/g,'').trim();
          resolve(text);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

// ── SYSTEM PROMPT DEL DUNGEON MASTER ──────────────────────────
const DM_SYSTEM = `Eres un Dungeon Master experto y narrador épico para el juego "Dragones y Mazmorras" de JL Arcade.
Tu trabajo es crear aventuras inmersivas, emocionantes y con consecuencias reales para 1-4 jugadores.

REGLAS CRÍTICAS DEL JUEGO:
- Los jugadores tienen stats: HP, STR (fuerza), DEX (destreza), INT (inteligencia), CHA (carisma).
- RECURSOS: Guerrero/Pícaro usan ESTAMINA. Mago/Bardo usan MANÁ. NUNCA permitas acciones que gasten más recurso del disponible.
- HABILIDADES: Cada personaje tiene habilidades aprendidas específicas. Solo pueden usar lo que tienen aprendido. Si intentan usar algo que no tienen, la acción falla narrativamente.
- STATS IMPORTAN: STR alto = mejores ataques físicos. DEX = sigilo y esquiva. INT = magia poderosa. CHA = persuasión y canciones.
- Cada acción tiene consecuencias mecánicas REALES: modifica HP, recursos, stats, añade/quita items.
- Los personajes pueden morir — da tensión real.
- Mantén coherencia total con la historia y los stats actuales.
- Sé dramático, descriptivo y usa el nombre de los personajes.
- Si un jugador actúa usando una habilidad que no tiene aprendida, la acción falla pero con consecuencia narrativa.
- RESPONDE SIEMPRE en español.

FORMATO DE RESPUESTA: JSON estricto sin markdown extra.`;

// ── GENERADOR DE AVENTURAS ─────────────────────────────────────
const ADVENTURE_THEMES = [
  'mazmorra subterránea con dragón anciano',
  'ciudad élfica bajo asedio de orcos',
  'barco pirata maldito en mar tormentoso',
  'torre del mago loco con puzzles arcanos',
  'aldea maldita con vampiro señor del castillo',
  'ruinas antiguas con guardián golem',
  'bosque encantado con hadas malévolas',
  'cripta de reyes con no-muertos',
  'volcán activo con culto demoníaco',
  'laberinto mental de un dios dormido'
];

async function generateAdventure(theme, playerCount) {
  const prompt = `Crea una aventura completa de D&D con el tema: "${theme}" para ${playerCount} jugador(es).

Responde SOLO con JSON válido:
{
  "title": "Título épico de la aventura",
  "summary": "Resumen en 2-3 oraciones",
  "setting": "Descripción del mundo/lugar principal",
  "mainVillain": "Nombre y descripción breve del antagonista",
  "questGoal": "El objetivo principal de la misión",
  "openingScene": "Narración de apertura dramática (3-4 párrafos, usa segunda persona plural si son varios)",
  "atmosphere": "dark|epic|mysterious|horror|adventure",
  "estimatedChapters": 5,
  "startingItems": ["item1", "item2", "item3"],
  "tags": ["tag1", "tag2"]
}`;

  const result = await callClaude([{role:'user',content:prompt}], 1200, DM_SYSTEM);
  try { return JSON.parse(result); }
  catch { return null; }
}

// ── GENERADOR DE ESCENA / TURNO ────────────────────────────────
async function generateScene(session, actionTaken, actingPlayer) {
  const partyDesc = session.players.map(p => {
    const resKey = p.resource || 'stamina';
    const resCur = p[resKey] || 0;
    const resMax = p['max'+resKey.charAt(0).toUpperCase()+resKey.slice(1)] || 0;
    const skillNames = (p.learnedSkills||[]).map(id=>{
      const sk = skills.SKILL_INDEX[id];
      return sk ? `${sk.name}(${'⭐'.repeat(sk.stars)})` : id;
    }).join(', ');
    return `${p.characterName} (${p.characterClass}, HP:${p.hp}/${p.maxHp}, ` +
      `${resKey.toUpperCase()}:${resCur}/${resMax}, ` +
      `STR:${p.str} DEX:${p.dex} INT:${p.int} CHA:${p.cha})` +
      (skillNames ? `\n  Habilidades: ${skillNames}` : '') +
      (p.items?.length ? `\n  Items: ${p.items.join(', ')}` : '');
  }).join('\n');

  const historySnippet = session.history.slice(-4).map(h=>
    `[${h.player}]: ${h.action} → ${h.outcome}`
  ).join('\n');

  const prompt = `AVENTURA: ${session.adventure.title}
OBJETIVO: ${session.adventure.questGoal}
CAPÍTULO: ${session.chapter}/${session.adventure.estimatedChapters}
UBICACIÓN: ${session.currentLocation}

GRUPO:
${partyDesc}

HISTORIAL RECIENTE:
${historySnippet || 'Inicio de la aventura'}

ACCIÓN DE ${actingPlayer.characterName}: "${actionTaken}"

Genera la respuesta del DM. JSON ESTRICTO:
{
  "narration": "Narración dramática de 2-3 párrafos describiendo qué ocurre tras la acción",
  "mechanicalEffects": [
    {"playerId": "id_del_jugador", "stat": "hp|str|dex|int|cha|items", "change": 0, "item": "nombre si es item", "reason": "por qué"}
  ],
  "currentLocation": "nombre del lugar actual actualizado",
  "choices": [
    {"id": "A", "text": "Primera opción disponible para el grupo", "risk": "low|medium|high"},
    {"id": "B", "text": "Segunda opción", "risk": "low|medium|high"},
    {"id": "C", "text": "Tercera opción", "risk": "low|medium|high"}
  ],
  "sceneType": "combat|exploration|puzzle|dialogue|rest|boss",
  "mood": "tense|calm|epic|horror|triumphant|mysterious",
  "chapterComplete": false,
  "gameOver": false,
  "gameOverReason": "",
  "imagePrompt": "Descripción visual de la escena para generar SVG: personajes, enemigos, ambiente (en inglés, muy descriptivo)"
}`;

  const result = await callClaude([{role:'user',content:prompt}], 2000, DM_SYSTEM);
  try { return JSON.parse(result); }
  catch {
    // Fallback básico
    return {
      narration: result || 'El DM contempla tu acción...',
      mechanicalEffects: [],
      currentLocation: session.currentLocation,
      choices: [
        {id:'A', text:'Avanzar con cautela', risk:'low'},
        {id:'B', text:'Atacar sin dudar', risk:'high'},
        {id:'C', text:'Buscar otra ruta', risk:'medium'}
      ],
      sceneType: 'exploration',
      mood: 'mysterious',
      chapterComplete: false,
      gameOver: false,
      imagePrompt: 'fantasy dungeon scene with adventurers'
    };
  }
}

// ── GENERADOR DE IMAGEN SVG ────────────────────────────────────
async function generateSceneSVG(imagePrompt, mood, sceneType) {
  const moodColors = {
    tense:       {bg:'#1a0a0a', fg:'#cc3333', accent:'#ff6644', sky:'#330000'},
    calm:        {bg:'#0a1a0a', fg:'#44aa66', accent:'#88ddaa', sky:'#001133'},
    epic:        {bg:'#0a0a1a', fg:'#4466cc', accent:'#aabbff', sky:'#000022'},
    horror:      {bg:'#050508', fg:'#551144', accent:'#aa2266', sky:'#110011'},
    triumphant:  {bg:'#1a1500', fg:'#cc9900', accent:'#ffdd44', sky:'#221100'},
    mysterious:  {bg:'#080a12', fg:'#334488', accent:'#6688cc', sky:'#060810'},
  };
  const c = moodColors[mood] || moodColors.mysterious;

  const prompt = `Eres un artista SVG especializado en pixel art de fantasía medieval. 
Crea una ilustración SVG 480x280px para esta escena D&D: "${imagePrompt}"
Mood visual: ${mood}, Tipo de escena: ${sceneType}
Paleta base: fondo ${c.bg}, tonos ${c.fg} y ${c.accent}, cielo ${c.sky}

REGLAS ESTRICTAS:
- SVG puro, sin texto explicativo fuera del SVG
- viewBox="0 0 480 280"
- Incluye: fondo atmosférico, elementos del terreno, siluetas de personajes/enemigos, efectos de luz
- Usa gradientes, formas geométricas, patrones para crear profundidad
- Estilo: pixel art / ilustración estilizada de fantasía
- Solo el tag <svg> y su contenido, nada más

Responde SOLO con el SVG completo comenzando con <svg`;

  const result = await callClaude([{role:'user',content:prompt}], 3000);
  if(result && result.includes('<svg')) {
    // Extraer solo el SVG
    const match = result.match(/<svg[\s\S]*<\/svg>/);
    return match ? match[0] : null;
  }
  // Fallback SVG genérico
  return generateFallbackSVG(mood, sceneType, c);
}

function generateFallbackSVG(mood, sceneType, c) {
  const icons = {
    combat: `<polygon points="240,80 260,140 220,140" fill="${c.accent}" opacity="0.8"/>
             <circle cx="240" cy="160" r="25" fill="${c.fg}" opacity="0.6"/>`,
    exploration: `<rect x="180" y="60" width="120" height="160" fill="${c.fg}" opacity="0.3"/>
                  <rect x="200" y="140" width="80" height="80" fill="${c.bg}" opacity="0.8"/>`,
    boss: `<ellipse cx="240" cy="140" rx="60" ry="80" fill="${c.accent}" opacity="0.4"/>
           <circle cx="240" cy="100" r="30" fill="${c.fg}" opacity="0.7"/>`,
    rest: `<circle cx="240" cy="140" r="40" fill="${c.accent}" opacity="0.3"/>
           <circle cx="240" cy="140" r="20" fill="${c.accent}" opacity="0.6"/>`,
    puzzle: `<rect x="160" y="100" width="40" height="40" fill="${c.fg}" opacity="0.5"/>
             <rect x="220" y="100" width="40" height="40" fill="${c.accent}" opacity="0.5"/>
             <rect x="280" y="100" width="40" height="40" fill="${c.fg}" opacity="0.5"/>`,
    dialogue: `<ellipse cx="240" cy="130" rx="50" ry="60" fill="${c.fg}" opacity="0.4"/>
               <ellipse cx="180" cy="150" rx="30" ry="40" fill="${c.accent}" opacity="0.3"/>`,
  };
  const icon = icons[sceneType] || icons.exploration;

  return `<svg viewBox="0 0 480 280" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%"><stop offset="0%" stop-color="${c.sky}"/><stop offset="100%" stop-color="${c.bg}"/></radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%"><stop offset="0%" stop-color="${c.accent}" stop-opacity="0.4"/><stop offset="100%" stop-color="${c.accent}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="480" height="280" fill="url(#bg)"/>
  <!-- Stars -->
  ${Array.from({length:30},(_,i)=>{
    const x=Math.floor((i*137)%480), y=Math.floor((i*97)%140);
    return `<circle cx="${x}" cy="${y}" r="${i%3===0?1.5:0.8}" fill="#ffffff" opacity="${0.3+i%5*0.1}"/>`;
  }).join('')}
  <!-- Ground -->
  <ellipse cx="240" cy="260" rx="300" ry="60" fill="${c.fg}" opacity="0.15"/>
  <rect x="0" y="220" width="480" height="60" fill="${c.bg}" opacity="0.7"/>
  <!-- Atmosphere glow -->
  <ellipse cx="240" cy="140" rx="140" ry="100" fill="url(#glow)"/>
  <!-- Scene icon -->
  ${icon}
  <!-- Particles -->
  ${Array.from({length:8},(_,i)=>{
    const x=160+i*20, y=80+Math.floor((i*73)%80);
    return `<circle cx="${x}" cy="${y}" r="2" fill="${c.accent}" opacity="${0.4+i%3*0.2}"/>`;
  }).join('')}
</svg>`;
}

// ── GENERADOR DE MÚSICA CONTEXTUAL (parámetros Web Audio) ──────
function getMusicParams(mood, sceneType) {
  const profiles = {
    tense_combat:      {tempo:160, scale:'minor', baseFreq:55,  reverb:0.3, drone:true,  arpSpeed:0.15},
    tense_exploration: {tempo:80,  scale:'minor', baseFreq:49,  reverb:0.6, drone:true,  arpSpeed:0.3},
    calm_rest:         {tempo:60,  scale:'major', baseFreq:65,  reverb:0.8, drone:false, arpSpeed:0.5},
    calm_exploration:  {tempo:70,  scale:'major', baseFreq:55,  reverb:0.7, drone:false, arpSpeed:0.4},
    epic_combat:       {tempo:180, scale:'minor', baseFreq:41,  reverb:0.2, drone:true,  arpSpeed:0.1},
    epic_boss:         {tempo:140, scale:'minor', baseFreq:37,  reverb:0.4, drone:true,  arpSpeed:0.12},
    horror_combat:     {tempo:100, scale:'dim',   baseFreq:46,  reverb:0.5, drone:true,  arpSpeed:0.2},
    horror_exploration:{tempo:50,  scale:'dim',   baseFreq:41,  reverb:0.9, drone:true,  arpSpeed:0.6},
    triumphant_rest:   {tempo:90,  scale:'major', baseFreq:65,  reverb:0.5, drone:false, arpSpeed:0.35},
    mysterious_puzzle: {tempo:65,  scale:'phrygian', baseFreq:52, reverb:0.8, drone:true, arpSpeed:0.45},
    mysterious_exploration:{tempo:55, scale:'phrygian', baseFreq:49, reverb:0.85, drone:true, arpSpeed:0.5},
  };
  const key = `${mood}_${sceneType}`;
  return profiles[key] || profiles[`${mood}_exploration`] || profiles.mysterious_exploration;
}

// ── GESTIÓN DE SESIONES D&D ────────────────────────────────────
const dndSessions = {};

function createDndSession(code, adventure, players) {
  dndSessions[code] = {
    adventure,
    players: players.map(p => {
      // Apply class base stats
      const baseStats = skills.CLASS_STATS[p.characterClass] || skills.CLASS_STATS['Guerrero'];
      const resource = skills.CLASS_RESOURCE[p.characterClass] || 'stamina';
      return {
        ...baseStats,
        ...p,
        id: p.id || `player_${Math.random().toString(36).slice(2,7)}`,
        // Apply stat points distributed
        str: (baseStats.str || 10) + (p.statPoints?.str || 0),
        dex: (baseStats.dex || 10) + (p.statPoints?.dex || 0),
        int: (baseStats.int || 10) + (p.statPoints?.int || 0),
        cha: (baseStats.cha || 10) + (p.statPoints?.cha || 0),
        hp: (baseStats.hp || 20) + (p.statPoints?.hp || 0),
        maxHp: (baseStats.maxHp || 20) + (p.statPoints?.hp || 0),
        stamina: baseStats.stamina || 0,
        maxStamina: baseStats.maxStamina || 0,
        mana: baseStats.mana || 0,
        maxMana: baseStats.maxMana || 0,
        resource,
        learnedSkills: p.learnedSkills || [],
        items: adventure.startingItems ? [...adventure.startingItems] : [],
        alive: true,
        actionsThisTurn: 0
      };
    }),
    chapter: 1,
    currentLocation: adventure.setting || 'La entrada de la mazmorra',
    history: [],
    phase: 'intro',        // intro | decision | waiting | result | gameover | victory
    currentChoices: [],
    pendingActions: {},    // playerId -> choiceId
    turnOrder: [],
    currentTurnIdx: 0,
    sceneData: null,
    createdAt: Date.now()
  };
  return dndSessions[code];
}

function getDndSession(code) { return dndSessions[code] || null; }
function deleteDndSession(code) { delete dndSessions[code]; }

module.exports = {
  generateAdventure,
  generateScene,
  generateSceneSVG,
  getMusicParams,
  createDndSession,
  getDndSession,
  deleteDndSession,
  ADVENTURE_THEMES
};
