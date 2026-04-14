// ── SISTEMA DE HABILIDADES COMPLETO — JL Arcade D&D ──────────
// Formato: { id, name, stars, category, desc, cost, req[], effect{} }
// req: array de IDs de habilidades requeridas (árbol)
// effect: { dmg, heal, resource, buffStat, buffAmt, turns, aoe, special }

// ══════════════════════════════════════════════════════════════
// STATS BASE POR CLASE
// ══════════════════════════════════════════════════════════════
const CLASS_STATS = {
  Guerrero: { hp:25, maxHp:25, str:14, dex:10, int:6,  cha:6,  stamina:20, maxStamina:20, mana:0,  maxMana:0  },
  Mago:     { hp:14, maxHp:14, str:6,  dex:8,  int:16, cha:8,  stamina:0,  maxStamina:0,  mana:20, maxMana:20 },
  Pícaro:   { hp:18, maxHp:18, str:10, dex:14, int:8,  cha:10, stamina:18, maxStamina:18, mana:0,  maxMana:0  },
  Bardo:    { hp:16, maxHp:16, str:8,  dex:12, int:12, cha:16, stamina:0,  maxStamina:0,  mana:18, maxMana:18 },
};

// RECURSO PRINCIPAL POR CLASE
const CLASS_RESOURCE = {
  Guerrero: 'stamina', Mago: 'mana', Pícaro: 'stamina', Bardo: 'mana'
};

// ══════════════════════════════════════════════════════════════
// ÁRBOL DE HABILIDADES — GUERRERO (Estamina)
// ══════════════════════════════════════════════════════════════
const GUERRERO_SKILLS = [
  // ─── COMBATE ───
  { id:'g_golpe',      name:'Golpe Básico',       stars:1, cat:'Combate',    cost:2, req:[],            desc:'Ataque físico simple.',            effect:{dmg:4,  resource:2}  },
  { id:'g_empuje',     name:'Empuje',              stars:1, cat:'Combate',    cost:2, req:[],            desc:'Empuja al enemigo, gana espacio.',  effect:{dmg:2,  resource:2, special:'push'} },
  { id:'g_golpe_f',    name:'Golpe Fuerte',        stars:2, cat:'Combate',    cost:3, req:['g_golpe'],   desc:'Golpe poderoso, puede aturdir.',    effect:{dmg:7,  resource:4, special:'stun_chance'} },
  { id:'g_barrido',    name:'Barrido',             stars:2, cat:'Combate',    cost:3, req:['g_golpe'],   desc:'Golpea a todos los enemigos.',      effect:{dmg:5,  resource:4, aoe:true} },
  { id:'g_carga',      name:'Carga',               stars:2, cat:'Combate',    cost:3, req:['g_empuje'],  desc:'Embiste al enemigo con el escudo.', effect:{dmg:6,  resource:4, special:'push'} },
  { id:'g_aplaste',    name:'Aplaste',             stars:3, cat:'Combate',    cost:4, req:['g_golpe_f'], desc:'Rompe la armadura del enemigo.',    effect:{dmg:10, resource:6, special:'armor_break'} },
  { id:'g_torbellino', name:'Torbellino',          stars:3, cat:'Combate',    cost:4, req:['g_barrido'], desc:'Gira destruyendo todo a su alrededor.',effect:{dmg:8, resource:6, aoe:true} },
  { id:'g_execute',    name:'Golpe Ejecutor',      stars:4, cat:'Combate',    cost:5, req:['g_aplaste','g_torbellino'], desc:'Daño masivo a enemigo debilitado (<30% HP).', effect:{dmg:20, resource:8, special:'execute'} },
  { id:'g_ira',        name:'Ira del Guerrero',    stars:4, cat:'Combate',    cost:5, req:['g_aplaste'], desc:'Entra en frenesí: +50% daño 3 turnos.', effect:{dmg:0, resource:8, buffStat:'str', buffAmt:7, turns:3} },
  { id:'g_titan',      name:'Golpe Titán',         stars:5, cat:'Combate',    cost:6, req:['g_execute'], desc:'El golpe más devastador conocido. Aturde garantizado.', effect:{dmg:35, resource:12, special:'stun'} },

  // ─── DEFENSA ───
  { id:'g_bloqueo',    name:'Bloqueo',             stars:1, cat:'Defensa',    cost:2, req:[],            desc:'Reduce el daño recibido este turno.', effect:{shield:5, resource:2} },
  { id:'g_parada',     name:'Parada',              stars:2, cat:'Defensa',    cost:3, req:['g_bloqueo'], desc:'Contraataca al bloquear.',           effect:{shield:4, dmg:4, resource:3} },
  { id:'g_escudo_f',   name:'Fortaleza',           stars:2, cat:'Defensa',    cost:3, req:['g_bloqueo'], desc:'Escudo que dura 2 turnos.',          effect:{shield:8, resource:4, turns:2} },
  { id:'g_muro',       name:'Muro de Acero',       stars:3, cat:'Defensa',    cost:4, req:['g_escudo_f'], desc:'Invulnerable 1 turno.',             effect:{shield:999, resource:6, turns:1} },
  { id:'g_espinas',    name:'Armadura de Espinas',  stars:3, cat:'Defensa',   cost:4, req:['g_parada'],  desc:'Devuelve daño al atacante.',         effect:{reflect:0.5, resource:5, turns:3} },
  { id:'g_bastión',    name:'Bastión',             stars:4, cat:'Defensa',    cost:5, req:['g_muro','g_espinas'], desc:'Protege también a aliados adyacentes.', effect:{shield:10, aoe:true, resource:8} },
  { id:'g_inmortal',   name:'Último Aliento',      stars:5, cat:'Defensa',    cost:6, req:['g_bastión'], desc:'Al llegar a 0 HP, sobrevive con 1 HP una vez por combate.', effect:{special:'revive', resource:0} },

  // ─── RESISTENCIA ───
  { id:'g_regenerar',  name:'Regeneración',        stars:1, cat:'Resistencia',cost:2, req:[],            desc:'Recupera 3 HP al inicio de cada turno.', effect:{healPerTurn:3, turns:3, resource:2} },
  { id:'g_voluntad',   name:'Voluntad de Hierro',  stars:2, cat:'Resistencia',cost:3, req:['g_regenerar'],desc:'Inmune a estados negativos 2 turnos.', effect:{special:'immune', turns:2, resource:3} },
  { id:'g_adrenalina', name:'Adrenalina',          stars:2, cat:'Resistencia',cost:3, req:['g_regenerar'],desc:'Recupera 4 estamina al golpear.',     effect:{resourceRegen:4, resource:2} },
  { id:'g_piel_roca',  name:'Piel de Roca',        stars:3, cat:'Resistencia',cost:4, req:['g_voluntad'], desc:'-30% daño recibido permanente por 4 turnos.', effect:{damageReduce:0.3, turns:4, resource:5} },
  { id:'g_berserk',    name:'Modo Berserk',        stars:4, cat:'Resistencia',cost:5, req:['g_piel_roca','g_adrenalina'], desc:'A menos HP, más daño y resistencia. Imparable.', effect:{special:'berserk', resource:6} },
  { id:'g_leyenda',    name:'Leyenda Viviente',    stars:5, cat:'Resistencia',cost:6, req:['g_berserk'],  desc:'Al eliminar un enemigo, recupera 8 HP y 6 estamina.', effect:{special:'on_kill_heal', resource:0} },

  // ─── ARMAS ───
  { id:'g_espadachín', name:'Maestría con Espada', stars:1, cat:'Armas',      cost:2, req:[],            desc:'+2 daño con armas de filo.',         effect:{dmgBonus:2, resource:0} },
  { id:'g_hacha',      name:'Especialista Hacha',  stars:1, cat:'Armas',      cost:2, req:[],            desc:'+2 daño y chance de crítico.',       effect:{dmgBonus:2, critChance:0.15, resource:0} },
  { id:'g_lanza',      name:'Lanzero',             stars:2, cat:'Armas',      cost:3, req:['g_espadachín'],desc:'Alcance largo, ataca primero.',     effect:{dmgBonus:3, special:'first_strike', resource:2} },
  { id:'g_doble',      name:'Combate Dual',        stars:2, cat:'Armas',      cost:3, req:['g_espadachín'],desc:'Dos ataques seguidos con -2 dmg c/u.', effect:{hits:2, dmgBonus:-2, resource:4} },
  { id:'g_mazo',       name:'Especialista Mazo',   stars:2, cat:'Armas',      cost:3, req:['g_hacha'],    desc:'Destroza armaduras, ignora escudo.', effect:{dmgBonus:4, special:'pierce_shield', resource:3} },
  { id:'g_forja',      name:'Maestro Armero',      stars:3, cat:'Armas',      cost:4, req:['g_doble','g_mazo'], desc:'Mejora permanente del arma equipada.', effect:{dmgBonus:5, resource:0} },
  { id:'g_armas_master',name:'Maestro de Armas',   stars:5, cat:'Armas',      cost:6, req:['g_forja'],    desc:'Domina cualquier arma, +10 dmg a todos los ataques.', effect:{dmgBonus:10, resource:0} },

  // ─── LIDERAZGO ───
  { id:'g_moral',      name:'Grito de Guerra',     stars:1, cat:'Liderazgo',  cost:2, req:[],            desc:'+2 STR a todos los aliados 2 turnos.',effect:{buffStat:'str', buffAmt:2, aoe:true, turns:2, resource:3} },
  { id:'g_orden',      name:'Orden de Ataque',     stars:2, cat:'Liderazgo',  cost:3, req:['g_moral'],   desc:'El aliado elegido actúa inmediatamente.', effect:{special:'extra_turn_ally', resource:4} },
  { id:'g_sacrificio', name:'Sacrificio Heroico',  stars:3, cat:'Liderazgo',  cost:4, req:['g_orden'],   desc:'Absorbe el daño destinado a un aliado.', effect:{special:'take_hit_for_ally', resource:5} },
  { id:'g_estandarte', name:'Estandarte del Héroe',stars:4, cat:'Liderazgo',  cost:5, req:['g_sacrificio'], desc:'Todos los aliados: +5 a todos los stats 3 turnos.', effect:{buffStat:'all', buffAmt:5, aoe:true, turns:3, resource:8} },
  { id:'g_rey',        name:'Rugido del Rey',      stars:5, cat:'Liderazgo',  cost:6, req:['g_estandarte'], desc:'Desmoraliza enemigos y fortalece aliados simultáneamente.', effect:{debuffEnemy:'all', debuffAmt:-4, buffStat:'all', buffAmt:4, aoe:true, turns:3, resource:10} },

  // ─── EXTRAS ───
  { id:'g_provocar',   name:'Provocar',            stars:1, cat:'Combate',    cost:1, req:[],            desc:'Atrae la atención de los enemigos.',  effect:{special:'taunt', resource:1} },
  { id:'g_intimidar',  name:'Intimidar',           stars:2, cat:'Combate',    cost:3, req:['g_provocar'], desc:'-3 STR al enemigo objetivo 2 turnos.', effect:{debuffEnemy:'str', debuffAmt:-3, turns:2, resource:3} },
  { id:'g_veneno_r',   name:'Resistencia a Veneno',stars:1, cat:'Resistencia',cost:1, req:[],            desc:'Inmune a venenos y estados negativos de Pícaro.', effect:{special:'poison_immune', resource:0} },
  { id:'g_campeón',    name:'Espíritu Campeón',    stars:3, cat:'Liderazgo',  cost:4, req:['g_moral'],   desc:'Al vencer un jefe, +3 a todos los stats permanente.', effect:{special:'on_boss_kill_buff', resource:0} },
];

// ══════════════════════════════════════════════════════════════
// ÁRBOL DE HABILIDADES — MAGO (Maná)
// ══════════════════════════════════════════════════════════════
const MAGO_SKILLS = [
  // ─── FUEGO ───
  { id:'m_chispa',     name:'Chispa',              stars:1, cat:'Elemental',  cost:2, req:[],            desc:'Pequeña llama. Puede incendiar.',   effect:{dmg:4,  resource:2} },
  { id:'m_bola_f',     name:'Bola de Fuego',       stars:2, cat:'Elemental',  cost:3, req:['m_chispa'],  desc:'Explosión en área, quema 2 turnos.',effect:{dmg:8,  resource:4, aoe:true, special:'burn'} },
  { id:'m_lluvia_f',   name:'Lluvia de Meteoros',  stars:3, cat:'Elemental',  cost:5, req:['m_bola_f'],  desc:'Meteoros caen sobre el área.',      effect:{dmg:14, resource:7, aoe:true} },
  { id:'m_fénix',      name:'Invocación Fénix',    stars:5, cat:'Elemental',  cost:8, req:['m_lluvia_f'], desc:'Invoca un fénix que ataca 3 turnos y resucita al mago.', effect:{dmg:18, resource:12, special:'phoenix'} },

  // ─── HIELO ───
  { id:'m_escarcha',   name:'Escarcha',            stars:1, cat:'Elemental',  cost:2, req:[],            desc:'Ralentiza al enemigo.',             effect:{dmg:3,  resource:2, special:'slow'} },
  { id:'m_lanza_h',    name:'Lanza de Hielo',      stars:2, cat:'Elemental',  cost:3, req:['m_escarcha'], desc:'Proyectil que congela 1 turno.',   effect:{dmg:7,  resource:4, special:'freeze'} },
  { id:'m_ventisca',   name:'Ventisca',            stars:3, cat:'Elemental',  cost:5, req:['m_lanza_h'], desc:'Toda el área congelada 2 turnos.',  effect:{dmg:10, resource:7, aoe:true, special:'freeze'} },
  { id:'m_glaciar',    name:'Era Glacial',         stars:5, cat:'Elemental',  cost:8, req:['m_ventisca'], desc:'Congela absolutamente todo en el campo.', effect:{dmg:12, resource:14, aoe:true, special:'freeze', turns:3} },

  // ─── RAYO ───
  { id:'m_descarga',   name:'Descarga Eléctrica',  stars:1, cat:'Elemental',  cost:2, req:[],            desc:'Sacude al enemigo, aturde breve.',  effect:{dmg:4,  resource:2, special:'stun_chance'} },
  { id:'m_rayo',       name:'Rayo',                stars:2, cat:'Elemental',  cost:3, req:['m_descarga'], desc:'Daño alto a un objetivo.',         effect:{dmg:10, resource:4} },
  { id:'m_cadena',     name:'Rayo en Cadena',      stars:3, cat:'Elemental',  cost:5, req:['m_rayo'],    desc:'Salta entre 3 enemigos.',           effect:{dmg:7,  resource:6, hits:3} },
  { id:'m_tormenta',   name:'Tormenta de Rayos',   stars:4, cat:'Elemental',  cost:7, req:['m_cadena'],  desc:'Lluvia eléctrica masiva 3 turnos.', effect:{dmg:9,  resource:10, aoe:true, turns:3} },
  { id:'m_thor',       name:'Juicio del Trueno',   stars:5, cat:'Elemental',  cost:9, req:['m_tormenta'], desc:'Un rayo apocalíptico que paraliza.', effect:{dmg:40, resource:14, special:'paralyze'} },

  // ─── ARCANO ───
  { id:'m_misil',      name:'Misil Mágico',        stars:1, cat:'Arcano',     cost:2, req:[],            desc:'Proyectil arcano certero.',         effect:{dmg:5,  resource:2} },
  { id:'m_escudo_m',   name:'Escudo Arcano',       stars:1, cat:'Arcano',     cost:2, req:[],            desc:'Barrera mágica que absorbe daño.',  effect:{shield:7, resource:3} },
  { id:'m_parpadeo',   name:'Parpadeo',            stars:2, cat:'Arcano',     cost:3, req:['m_misil'],   desc:'Teletransportación instantánea.',   effect:{special:'teleport', resource:3} },
  { id:'m_empuje_m',   name:'Onda Arcana',         stars:2, cat:'Arcano',     cost:3, req:['m_misil'],   desc:'Empuja a todos los enemigos.',      effect:{dmg:4,  resource:3, aoe:true, special:'push'} },
  { id:'m_barrera',    name:'Barrera de Fuerza',   stars:3, cat:'Arcano',     cost:5, req:['m_escudo_m','m_parpadeo'], desc:'Escudo indestructible 2 turnos.',effect:{shield:999, resource:6, turns:2} },
  { id:'m_paradoja',   name:'Paradoja Temporal',   stars:4, cat:'Arcano',     cost:7, req:['m_barrera'], desc:'Revierte el daño recibido en el último turno.', effect:{special:'time_revert', resource:10} },
  { id:'m_singularidad',name:'Singularidad',       stars:5, cat:'Arcano',     cost:9, req:['m_paradoja'], desc:'Agujero negro que destruye todo en el área.', effect:{dmg:30, resource:14, aoe:true, special:'void'} },

  // ─── NIGROMANCIA ───
  { id:'m_drenaje',    name:'Drenaje de Vida',     stars:1, cat:'Nigromancia',cost:2, req:[],            desc:'Roba vida al enemigo.',             effect:{dmg:4,  heal:4, resource:3} },
  { id:'m_maldición',  name:'Maldición',           stars:2, cat:'Nigromancia',cost:4, req:['m_drenaje'], desc:'-4 a todos los stats del enemigo.', effect:{debuffEnemy:'all', debuffAmt:-4, turns:3, resource:4} },
  { id:'m_espectro',   name:'Invocar Espectro',    stars:3, cat:'Nigromancia',cost:5, req:['m_maldición'],desc:'Espectro ataca cada turno por ti.', effect:{dmg:6,  turns:3, resource:6, special:'summon'} },
  { id:'m_lich',       name:'Forma de Lich',       stars:5, cat:'Nigromancia',cost:9, req:['m_espectro'], desc:'Forma no-muerta: inmune a estados negativos, +15 INT.', effect:{buffStat:'int', buffAmt:15, special:'undead_form', resource:12} },

  // ─── ADIVINACIÓN ───
  { id:'m_detectar',   name:'Detectar Magia',      stars:1, cat:'Adivinación',cost:1, req:[],            desc:'Revela objetos y trampas ocultas.', effect:{special:'detect', resource:1} },
  { id:'m_visión',     name:'Visión Arcana',       stars:2, cat:'Adivinación',cost:2, req:['m_detectar'], desc:'Ve debilidades del enemigo.',      effect:{special:'see_weakness', resource:2} },
  { id:'m_profecía',   name:'Profecía',            stars:3, cat:'Adivinación',cost:4, req:['m_visión'],  desc:'Predice y evita el próximo ataque.', effect:{special:'dodge_next', resource:4} },
  { id:'m_oráculo',    name:'El Oráculo',          stars:5, cat:'Adivinación',cost:7, req:['m_profecía'], desc:'Conoce todas las acciones enemigas este combate.', effect:{special:'omniscience', resource:8} },

  // ─── EXTRAS ───
  { id:'m_concentrar', name:'Concentrar Maná',     stars:1, cat:'Arcano',     cost:1, req:[],            desc:'Recupera 4 puntos de maná.',        effect:{resourceRegen:4, resource:0} },
  { id:'m_amplificar', name:'Amplificador',        stars:2, cat:'Arcano',     cost:3, req:['m_concentrar'], desc:'Siguiente hechizo hace +50% daño.', effect:{special:'amplify_next', resource:2} },
  { id:'m_contrahechizo',name:'Contrahechizo',     stars:3, cat:'Arcano',     cost:5, req:['m_escudo_m'], desc:'Niega el hechizo enemigo.',         effect:{special:'counterspell', resource:5} },
  { id:'m_dimension',  name:'Bolsillo Dimensional',stars:2, cat:'Adivinación',cost:2, req:['m_detectar'], desc:'Guarda y extrae objetos al instante.', effect:{special:'pocket', resource:1} },
  { id:'m_maestría',   name:'Maestría Arcana',     stars:4, cat:'Arcano',     cost:6, req:['m_amplificar','m_contrahechizo'], desc:'Reduce el costo de maná de todos los hechizos -2.', effect:{special:'mana_discount', resource:0} },
];

// ══════════════════════════════════════════════════════════════
// ÁRBOL DE HABILIDADES — PÍCARO (Estamina)
// ══════════════════════════════════════════════════════════════
const PICARO_SKILLS = [
  // ─── SIGILO ───
  { id:'p_ocultarse',  name:'Ocultarse',           stars:1, cat:'Sigilo',     cost:2, req:[],            desc:'Se vuelve invisible 1 turno.',      effect:{special:'invisible', resource:2} },
  { id:'p_sombra',     name:'Paso de Sombra',      stars:2, cat:'Sigilo',     cost:3, req:['p_ocultarse'], desc:'Se mueve sin ser detectado.',     effect:{special:'stealth_move', resource:2} },
  { id:'p_emboscada',  name:'Emboscada',           stars:2, cat:'Sigilo',     cost:3, req:['p_ocultarse'], desc:'Ataque desde sigilo: +8 daño.',   effect:{dmg:10, resource:4, special:'from_stealth'} },
  { id:'p_asesino',    name:'Golpe Asesino',       stars:3, cat:'Sigilo',     cost:5, req:['p_emboscada'], desc:'Daño crítico garantizado en sigilo.', effect:{dmg:18, resource:6, special:'guaranteed_crit'} },
  { id:'p_fantasma',   name:'Forma Fantasmal',     stars:4, cat:'Sigilo',     cost:6, req:['p_asesino','p_sombra'], desc:'Atraviesa obstáculos, invulnerable mientras se mueve.', effect:{special:'ghost_form', resource:7} },
  { id:'p_muerte',     name:'Golpe Letal',         stars:5, cat:'Sigilo',     cost:8, req:['p_fantasma'], desc:'Elimina instantáneamente a enemigos con HP<40%.', effect:{special:'instant_kill', resource:10} },

  // ─── VENENOS ───
  { id:'p_veneno_b',   name:'Veneno Básico',       stars:1, cat:'Venenos',    cost:2, req:[],            desc:'Envenena al enemigo (3 daño/turno).', effect:{dmg:2,  poison:3, turns:3, resource:2} },
  { id:'p_parálisis',  name:'Veneno Paralizante',  stars:2, cat:'Venenos',    cost:3, req:['p_veneno_b'], desc:'Paraliza al enemigo 1 turno.',     effect:{dmg:1,  special:'paralyze', turns:1, resource:3} },
  { id:'p_veneno_f',   name:'Veneno Letal',        stars:3, cat:'Venenos',    cost:4, req:['p_parálisis'], desc:'5 daño/turno por 5 turnos.',      effect:{poison:5, turns:5, resource:4} },
  { id:'p_alquimia',   name:'Alquimista',          stars:2, cat:'Venenos',    cost:3, req:['p_veneno_b'], desc:'Crea pociones de veneno y curación.', effect:{special:'craft_potion', resource:2} },
  { id:'p_plague',     name:'Plaga',               stars:4, cat:'Venenos',    cost:6, req:['p_veneno_f','p_alquimia'], desc:'El veneno se contagia entre enemigos.', effect:{poison:4, turns:4, aoe:true, special:'contagious', resource:7} },
  { id:'p_veneno_dios',name:'Veneno Divino',       stars:5, cat:'Venenos',    cost:9, req:['p_plague'],   desc:'Veneno irresistible que ignora inmunidades. 8 daño/turno.', effect:{poison:8, turns:6, special:'pierce_immune', resource:10} },

  // ─── ENGAÑO ───
  { id:'p_mentira',    name:'Mentira',             stars:1, cat:'Engaño',     cost:1, req:[],            desc:'Engaña a un NPC para obtener info.', effect:{special:'deceive_npc', resource:1} },
  { id:'p_disfraz',    name:'Disfraz',             stars:2, cat:'Engaño',     cost:3, req:['p_mentira'],  desc:'Se disfraza como enemigo o NPC.',  effect:{special:'disguise', resource:3} },
  { id:'p_señuelo',    name:'Señuelo',             stars:2, cat:'Engaño',     cost:3, req:['p_mentira'],  desc:'Crea ilusión que distrae enemigos.', effect:{special:'decoy', turns:2, resource:3} },
  { id:'p_pickpocket', name:'Carterista',          stars:2, cat:'Engaño',     cost:2, req:['p_mentira'],  desc:'Roba objeto o arma al enemigo.',   effect:{special:'steal', resource:2} },
  { id:'p_maestro_eng',name:'Maestro del Engaño',  stars:3, cat:'Engaño',     cost:5, req:['p_disfraz','p_señuelo'], desc:'Convence a un enemigo de luchar por el grupo.', effect:{special:'charm_enemy', turns:3, resource:6} },
  { id:'p_ilusión',    name:'Gran Ilusión',        stars:4, cat:'Engaño',     cost:7, req:['p_maestro_eng'], desc:'Crea una ilusión perfecta de cualquier persona u objeto.', effect:{special:'perfect_illusion', resource:8} },
  { id:'p_identidad',  name:'Sin Identidad',       stars:5, cat:'Engaño',     cost:9, req:['p_ilusión'],  desc:'Completamente indetectable para enemigos mágicos y físicos.', effect:{special:'undetectable', turns:5, resource:10} },

  // ─── TRAMPAS ───
  { id:'p_trampa_b',   name:'Trampa Básica',       stars:1, cat:'Trampas',    cost:2, req:[],            desc:'Inmoviliza al enemigo que la pisa.', effect:{special:'trap_immobilize', resource:2} },
  { id:'p_trampa_e',   name:'Trampa Explosiva',    stars:2, cat:'Trampas',    cost:3, req:['p_trampa_b'], desc:'Explota causando daño en área.',   effect:{dmg:8,  aoe:true, special:'trap', resource:3} },
  { id:'p_trampa_v',   name:'Trampa Venenosa',     stars:2, cat:'Trampas',    cost:3, req:['p_trampa_b','p_veneno_b'], desc:'Envenena al enemigo al activarse.', effect:{poison:4, turns:4, special:'trap', resource:3} },
  { id:'p_red',        name:'Red de Cazador',      stars:3, cat:'Trampas',    cost:4, req:['p_trampa_e'], desc:'Atrapa a múltiples enemigos 2 turnos.', effect:{special:'net_aoe', turns:2, resource:4} },
  { id:'p_campo',      name:'Campo Minado',        stars:4, cat:'Trampas',    cost:6, req:['p_red','p_trampa_v'], desc:'Llena el área de trampas invisibles.', effect:{special:'minefield', resource:7} },
  { id:'p_maestro_t',  name:'Maestro Trampero',    stars:5, cat:'Trampas',    cost:8, req:['p_campo'],    desc:'Las trampas duran toda la batalla y se reinician.', effect:{special:'eternal_traps', resource:9} },

  // ─── COMBATE ÁGIL ───
  { id:'p_cuchillo',   name:'Lanzar Cuchillo',     stars:1, cat:'Combate',    cost:2, req:[],            desc:'Ataque a distancia rápido.',        effect:{dmg:5,  resource:2} },
  { id:'p_finta',      name:'Finta',               stars:2, cat:'Combate',    cost:2, req:['p_cuchillo'], desc:'Esquiva el siguiente ataque.',     effect:{special:'dodge_next', resource:2} },
  { id:'p_lluvia_c',   name:'Lluvia de Cuchillos', stars:3, cat:'Combate',    cost:4, req:['p_finta'],   desc:'5 cuchillos a 5 objetivos diferentes.', effect:{dmg:4,  hits:5, resource:5} },
  { id:'p_danza',      name:'Danza de la Muerte',  stars:4, cat:'Combate',    cost:6, req:['p_lluvia_c'], desc:'Ataca 4 veces en un turno.',       effect:{dmg:5,  hits:4, resource:7} },
  { id:'p_tormenta',   name:'Tormenta de Acero',   stars:5, cat:'Combate',    cost:9, req:['p_danza'],   desc:'Golpes ilimitados hasta que falle una esquiva.', effect:{dmg:6,  special:'unlimited_hits', resource:10} },
];

// ══════════════════════════════════════════════════════════════
// ÁRBOL DE HABILIDADES — BARDO (Maná)
// ══════════════════════════════════════════════════════════════
const BARDO_SKILLS = [
  // ─── CANCIONES ───
  { id:'b_cancion_g',  name:'Canción de Guerra',   stars:1, cat:'Canciones',  cost:2, req:[],            desc:'+2 STR a todos los aliados 2 turnos.', effect:{buffStat:'str', buffAmt:2, aoe:true, turns:2, resource:2} },
  { id:'b_cancion_p',  name:'Canción de Paz',      stars:1, cat:'Canciones',  cost:2, req:[],            desc:'Recupera 5 HP a todos los aliados.', effect:{heal:5, aoe:true, resource:2} },
  { id:'b_himno',      name:'Himno Épico',         stars:2, cat:'Canciones',  cost:4, req:['b_cancion_g'], desc:'+4 a todos los stats del grupo 3 turnos.', effect:{buffStat:'all', buffAmt:4, aoe:true, turns:3, resource:5} },
  { id:'b_ballad',     name:'Balada Maldita',      stars:2, cat:'Canciones',  cost:3, req:['b_cancion_p'], desc:'-3 STR y DEX a todos los enemigos.', effect:{debuffEnemy:'all', debuffAmt:-3, aoe:true, turns:3, resource:4} },
  { id:'b_sinfonía',   name:'Gran Sinfonía',       stars:3, cat:'Canciones',  cost:6, req:['b_himno'],    desc:'La música más poderosa: +6 a todos los stats, recupera HP y maná.', effect:{buffStat:'all', buffAmt:6, heal:8, resourceRegen:4, aoe:true, turns:3, resource:7} },
  { id:'b_requiem',    name:'Réquiem',             stars:4, cat:'Canciones',  cost:8, req:['b_sinfonía','b_ballad'], desc:'Los enemigos caen dormidos y pierden voluntad de luchar.', effect:{special:'sleep_all', turns:3, resource:10} },
  { id:'b_maestría_c', name:'Canción Maestra',     stars:5, cat:'Canciones',  cost:10,req:['b_requiem'],  desc:'La canción perfecta: afecta al plano material y astral. Efecto masivo.', effect:{buffStat:'all', buffAmt:10, debuffEnemy:'all', debuffAmt:-8, heal:15, aoe:true, turns:4, resource:14} },

  // ─── INSPIRACIÓN ───
  { id:'b_aliento',    name:'Aliento Heroico',     stars:1, cat:'Inspiración',cost:2, req:[],            desc:'Da un turno extra a un aliado.',    effect:{special:'extra_turn_ally', resource:3} },
  { id:'b_sanar',      name:'Toque Sanador',       stars:1, cat:'Inspiración',cost:2, req:[],            desc:'Sana 8 HP a un aliado.',            effect:{heal:8, resource:2} },
  { id:'b_resurrección',name:'Resurrección',       stars:3, cat:'Inspiración',cost:6, req:['b_sanar'],   desc:'Revive a un aliado caído con 10 HP.', effect:{special:'revive_ally', heal:10, resource:7} },
  { id:'b_barrera_b',  name:'Barrera Bárda',       stars:2, cat:'Inspiración',cost:3, req:['b_sanar'],   desc:'Escudo mágico para un aliado.',     effect:{shield:10, resource:3} },
  { id:'b_éxtasis',    name:'Éxtasis',             stars:4, cat:'Inspiración',cost:7, req:['b_resurrección','b_barrera_b'], desc:'El aliado entra en estado divino: +50% a todo por 3 turnos.', effect:{buffStat:'all', buffAmt:8, turns:3, resource:9} },
  { id:'b_milagro',    name:'Milagro',             stars:5, cat:'Inspiración',cost:10,req:['b_éxtasis'],  desc:'Revive a TODO el grupo muerto y lleno de maná.', effect:{special:'mass_revive', resource:12} },

  // ─── ILUSIÓN ───
  { id:'b_confundir',  name:'Confusión',           stars:1, cat:'Ilusión',    cost:2, req:[],            desc:'El enemigo ataca a su propio aliado.', effect:{special:'confuse', turns:1, resource:2} },
  { id:'b_miedo',      name:'Canción del Miedo',   stars:2, cat:'Ilusión',    cost:3, req:['b_confundir'], desc:'El enemigo huye aterrorizado.',    effect:{special:'flee', resource:3} },
  { id:'b_ilusión_b',  name:'Espejismo',           stars:2, cat:'Ilusión',    cost:3, req:['b_confundir'], desc:'Crea copias ilusorias del grupo.', effect:{special:'mirror_copies', turns:2, resource:3} },
  { id:'b_pesadilla',  name:'Pesadilla',           stars:3, cat:'Ilusión',    cost:5, req:['b_miedo','b_ilusión_b'], desc:'El enemigo ve su peor miedo y queda paralizado.', effect:{special:'nightmare', turns:2, resource:6} },
  { id:'b_caos',       name:'Canción del Caos',    stars:4, cat:'Ilusión',    cost:7, req:['b_pesadilla'], desc:'Todos los enemigos atacan a sus aliados.', effect:{special:'mass_confuse', aoe:true, turns:2, resource:9} },
  { id:'b_realidad',   name:'Quebrar la Realidad', stars:5, cat:'Ilusión',    cost:10,req:['b_caos'],      desc:'La ilusión se vuelve real: los enemigos mueren de terror.', effect:{special:'kill_from_fear', resource:12} },

  // ─── CONOCIMIENTO ───
  { id:'b_lore',       name:'Conocimiento Arcano', stars:1, cat:'Conocimiento',cost:1, req:[],           desc:'Identifica enemigos y sus debilidades.', effect:{special:'identify', resource:1} },
  { id:'b_historia',   name:'Memoria Histórica',   stars:2, cat:'Conocimiento',cost:2, req:['b_lore'],   desc:'Recuerda rutas y secretos del lugar.', effect:{special:'recall_lore', resource:1} },
  { id:'b_negociar',   name:'Gran Negociador',     stars:2, cat:'Conocimiento',cost:2, req:['b_lore'],   desc:'Convence a enemigos de no luchar.', effect:{special:'negotiate', resource:2} },
  { id:'b_sabio',      name:'Sabiduría Ancestral', stars:3, cat:'Conocimiento',cost:4, req:['b_historia','b_negociar'], desc:'El grupo gana +3 INT y +3 CHA permanente en esta aventura.', effect:{buffStat:'int', buffAmt:3, aoe:true, resource:0} },
  { id:'b_consejero',  name:'Consejo Estratégico', stars:4, cat:'Conocimiento',cost:5, req:['b_sabio'],  desc:'Predice la acción del enemigo y permite al grupo actuar primero.', effect:{special:'predict_action', resource:4} },
  { id:'b_omnisciente',name:'Omnisciencia',        stars:5, cat:'Conocimiento',cost:8, req:['b_consejero'], desc:'Conocimiento total del dungeon: sin trampas, sin sorpresas, sin peligro oculto.', effect:{special:'full_map_knowledge', resource:8} },

  // ─── EXTRAS ───
  { id:'b_chiste',     name:'Chiste Terrible',     stars:1, cat:'Ilusión',    cost:1, req:[],            desc:'Distrae al enemigo con un chiste horrible.',effect:{special:'distract', resource:1} },
  { id:'b_moneda',     name:'Mano Rápida',         stars:2, cat:'Conocimiento',cost:2, req:['b_lore'],   desc:'Consigue monedas o información de NPCs.', effect:{special:'persuade_npc', resource:1} },
  { id:'b_dueto',      name:'Dueto',               stars:3, cat:'Canciones',  cost:5, req:['b_cancion_g','b_cancion_p'], desc:'Con otro bardo/aliado, duplica el efecto de canciones.', effect:{special:'duet_amplify', resource:4} },
  { id:'b_encore',     name:'Bis',                 stars:3, cat:'Canciones',  cost:4, req:['b_himno'],   desc:'Repite el efecto del último hechizo sin costo adicional.', effect:{special:'repeat_last', resource:3} },
];

// ══════════════════════════════════════════════════════════════
// HABILIDADES UNIVERSALES (todas las clases, sin costo extra)
// ══════════════════════════════════════════════════════════════
const UNIVERSAL_SKILLS = [
  { id:'u_descanso',   name:'Descanso Rápido',     stars:1, cat:'Universal',  cost:1, req:[],            desc:'Recupera 3 del recurso principal.', effect:{resourceRegen:3, resource:0} },
  { id:'u_observar',   name:'Observar',            stars:1, cat:'Universal',  cost:1, req:[],            desc:'Analiza al enemigo, revela sus stats.', effect:{special:'observe', resource:0} },
  { id:'u_improviso',  name:'Improvisación',       stars:2, cat:'Universal',  cost:2, req:['u_observar'], desc:'Usa el entorno para ventaja táctica.', effect:{special:'use_environment', resource:1} },
  { id:'u_trabajo_eq', name:'Trabajo en Equipo',   stars:2, cat:'Universal',  cost:2, req:[],            desc:'Combo con un aliado: +5 al siguiente daño conjunto.', effect:{special:'combo_ally', resource:2} },
  { id:'u_resistencia',name:'Resistencia Mental',  stars:3, cat:'Universal',  cost:3, req:['u_observar'], desc:'Inmune a efectos de miedo y confusión.', effect:{special:'fear_immune', resource:0} },
];

// ══════════════════════════════════════════════════════════════
// ÍNDICE COMPLETO
// ══════════════════════════════════════════════════════════════
const ALL_SKILLS = {
  Guerrero: [...GUERRERO_SKILLS, ...UNIVERSAL_SKILLS],
  Mago:     [...MAGO_SKILLS,     ...UNIVERSAL_SKILLS],
  Pícaro:   [...PICARO_SKILLS,   ...UNIVERSAL_SKILLS],
  Bardo:    [...BARDO_SKILLS,    ...UNIVERSAL_SKILLS],
};

// Índice plano para lookup rápido
const SKILL_INDEX = {};
[...GUERRERO_SKILLS, ...MAGO_SKILLS, ...PICARO_SKILLS, ...BARDO_SKILLS, ...UNIVERSAL_SKILLS]
  .forEach(s => SKILL_INDEX[s.id] = s);

// Árbol: dado un ID, retorna habilidades que lo requieren (hijos)
function getSkillChildren(skillId, classKey) {
  return (ALL_SKILLS[classKey] || []).filter(s => s.req.includes(skillId));
}

// Validar si un jugador puede tomar una habilidad
function canLearnSkill(skill, learnedIds, playerClass) {
  // Revisar requisitos del árbol
  if(skill.req.length > 0 && !skill.req.every(r => learnedIds.includes(r))) return false;
  // Máximo 1 habilidad de 5 estrellas
  const learned5stars = learnedIds.filter(id => SKILL_INDEX[id]?.stars === 5);
  if(skill.stars === 5 && learned5stars.length >= 1) return false;
  return true;
}

// Costo real de una habilidad (x2 si es de otra clase)
function getSkillCost(skill, playerClass) {
  const isOwn = ALL_SKILLS[playerClass]?.some(s => s.id === skill.id) || skill.cat === 'Universal';
  return isOwn ? skill.cost : skill.cost * 2;
}

// Exportar todo lo necesario
module.exports = {
  CLASS_STATS, CLASS_RESOURCE, ALL_SKILLS, SKILL_INDEX, UNIVERSAL_SKILLS,
  getSkillChildren, canLearnSkill, getSkillCost,
  GUERRERO_SKILLS, MAGO_SKILLS, PICARO_SKILLS, BARDO_SKILLS
};
