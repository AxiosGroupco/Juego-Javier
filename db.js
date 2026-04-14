const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?{rejectUnauthorized:false}:false });

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL, display_name VARCHAR(100), created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS writing_samples (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, question TEXT NOT NULL, answer TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW());
    CREATE INDEX IF NOT EXISTS idx_writing_user ON writing_samples(user_id);
    CREATE TABLE IF NOT EXISTS survival_scores (id SERIAL PRIMARY KEY, player_names TEXT NOT NULL, turns INTEGER NOT NULL, mobs_defeated INTEGER NOT NULL DEFAULT 0, mode VARCHAR(10) NOT NULL CHECK (mode IN ('solo','duo')), played_at TIMESTAMP DEFAULT NOW());
    CREATE INDEX IF NOT EXISTS idx_sv_mode ON survival_scores(mode, turns DESC);
    CREATE TABLE IF NOT EXISTS dnd_adventures (id SERIAL PRIMARY KEY, title TEXT NOT NULL, summary TEXT, theme TEXT, adventure_json JSONB NOT NULL, play_count INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS dnd_sessions (id SERIAL PRIMARY KEY, adventure_id INTEGER REFERENCES dnd_adventures(id), player_names TEXT NOT NULL, outcome VARCHAR(20) DEFAULT 'ongoing', chapters_completed INTEGER DEFAULT 0, played_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS universes (id SERIAL PRIMARY KEY, name VARCHAR(200) NOT NULL, slug VARCHAR(120) UNIQUE NOT NULL, description TEXT, lore JSONB NOT NULL DEFAULT '{}', atmosphere VARCHAR(50) DEFAULT 'epic', is_base BOOLEAN DEFAULT false, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, active_heroes INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS universe_history (id SERIAL PRIMARY KEY, universe_id INTEGER REFERENCES universes(id) ON DELETE CASCADE, character_id INTEGER, character_name VARCHAR(200), event_type VARCHAR(50) NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, impact_level INTEGER DEFAULT 1, happened_at TIMESTAMP DEFAULT NOW());
    CREATE INDEX IF NOT EXISTS idx_univ_hist ON universe_history(universe_id, happened_at DESC);
    CREATE TABLE IF NOT EXISTS characters (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, universe_id INTEGER REFERENCES universes(id) ON DELETE SET NULL, name VARCHAR(200) NOT NULL, class VARCHAR(50) NOT NULL, backstory TEXT, appearance JSONB DEFAULT '{}', learned_skills JSONB DEFAULT '[]', items JSONB DEFAULT '[]', level INTEGER DEFAULT 1, xp INTEGER DEFAULT 0, hp INTEGER DEFAULT 20, max_hp INTEGER DEFAULT 20, stamina INTEGER DEFAULT 0, max_stamina INTEGER DEFAULT 0, mana INTEGER DEFAULT 0, max_mana INTEGER DEFAULT 0, str_stat INTEGER DEFAULT 10, dex_stat INTEGER DEFAULT 10, int_stat INTEGER DEFAULT 10, cha_stat INTEGER DEFAULT 10, conditions JSONB DEFAULT '[]', status VARCHAR(20) DEFAULT 'alive', death_reason TEXT, adventures_completed INTEGER DEFAULT 0, total_kills INTEGER DEFAULT 0, legendary_deeds JSONB DEFAULT '[]', last_location TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());
    CREATE INDEX IF NOT EXISTS idx_char_user ON characters(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_char_universe ON characters(universe_id, status);
    CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, universe_id INTEGER REFERENCES universes(id) ON DELETE CASCADE, title TEXT NOT NULL, summary TEXT, min_level INTEGER DEFAULT 1, max_level INTEGER DEFAULT 4, difficulty VARCHAR(20) DEFAULT 'normal', mission_json JSONB NOT NULL DEFAULT '{}', times_played INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());
    CREATE INDEX IF NOT EXISTS idx_missions_univ ON missions(universe_id, min_level);
    CREATE TABLE IF NOT EXISTS character_adventures (id SERIAL PRIMARY KEY, character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE, mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL, universe_id INTEGER REFERENCES universes(id) ON DELETE SET NULL, session_data JSONB DEFAULT '{}', outcome VARCHAR(20) DEFAULT 'ongoing', impact_summary TEXT, chapters_completed INTEGER DEFAULT 0, started_at TIMESTAMP DEFAULT NOW(), finished_at TIMESTAMP);
    CREATE INDEX IF NOT EXISTS idx_charadv ON character_adventures(character_id, outcome);
  `);
  const ex = await pool.query('SELECT COUNT(*) FROM universes WHERE is_base=true');
  if(parseInt(ex.rows[0].count)===0) await seedBaseUniverses();
  console.log('DB initialized');
}

async function seedBaseUniverses() {
  const bases = [
    {name:'Aethoria — El Reino Fragmentado',slug:'aethoria',desc:'Un continente de magia arcana donde cinco reinos en guerra buscan los fragmentos del Cristal Eterno.',atm:'epic',lore:{age:'La Tercera Era, año 847',continents:['Valdenmoor (norte frío, reinos guerreros)','Las Tierras Doradas (centro próspero, disputado)','El Abismo Sur (sur misterioso, peligroso)'],factions:['Reino de Aldrath — militaristas expansionistas','La República de Mer — comerciantes con ejércitos mercenarios','El Culto del Vacío — quieren el Cristal para destruir el mundo','Los Guardianes Grises — orden secreta que protege los fragmentos'],currentConflict:'La guerra de los cinco reinos lleva 40 años sin resolverse. El Cristal Eterno, fragmentado en cinco piezas, otorga poder absoluto a quien lo complete. Tres fragmentos han cambiado de manos este año.',hooks:['¿Quién traicionó al último rey unificado hace 40 años?','Los muertos caminan en el Abismo Sur sin explicación','Dicen que hay un sexto fragmento que ninguna facción conoce'],cosmology:'Los dioses abandonaron Aethoria hace 200 años tras la Gran Ruptura. Solo quedan sus ecos en templos y reliquias que aún conservan poder.'}},
    {name:'Noctis Profunda — Bajo la Luna Roja',slug:'noctis',desc:'Un mundo perpetuamente oscuro gobernado por vampiros, donde los humanos sobreviven en ciudades amuralladas de luz.',atm:'horror',lore:{age:'El Siglo Eterno, sin año conocido',continents:['Las Ciudades Vela (islas de luz artificial)','El Dominio Oscuro (continente principal bajo perpetua noche)','Las Catacumbas Profundas (red subterránea que nadie ha explorado completa)'],factions:['Las Casas Vampíricas — nobleza de la oscuridad, luchan entre sí','La Orden de la Llama — resistencia humana que custodia el fuego sagrado','Los Cazadores sin Nombre — asesinos que cazan vampiros por pago','Los Aulladores — hombres lobo que no se alinean con ningún bando'],currentConflict:'La Casa Mordain intenta extinguir los últimos faros de luz para conquistar las ciudades amuralladas. La Orden de la Llama tiene una semana antes de que el último faro se apague.',hooks:['La luna roja lleva 300 años sin cambiar de fase','¿Qué hay más allá del horizonte de oscuridad total?','Un vampiro anciano busca activamente su propia redención'],cosmology:'El sol fue robado por el Archi-Vampiro Mordain en la Noche Eterna. Solo la Llama Sagrada, fragmento de la luz solar original, mantiene la esperanza de recuperarlo.'}},
    {name:'Ferrania — La Era del Vapor y el Acero',slug:'ferrania',desc:'Mundo steampunk donde la magia fue reemplazada por ingeniería de vapor y las corporaciones luchan por el éter-combustible.',atm:'adventure',lore:{age:'Año Industrial 312',continents:['Gran Ferrania (metrópolis central, humo y acero)','Las Colonias del Éter (sur explotado, pueblos rebeldes)','Las Tierras Salvajes (oeste sin industrializar, magia aún presente)'],factions:['Corporación Vulcano — monopolio del éter, ejército privado','El Parlamento Libre — democracia frágil intentando regular las corporaciones','Los Saqueadores del Éter — piratas del aire y tierra','La Hermandad Mágica Clandestina — los últimos usuarios de magia real'],currentConflict:'Las reservas de éter-combustible se agotan. Vulcano encontró el último gran yacimiento bajo tierras indígenas. El Parlamento debate. Los saqueadores atacan los convoyes de transporte.',hooks:['La magia no murió, fue suprimida activamente por alguien','¿Quién saboteó el Gran Tren Estelar hace 10 años?','Un autómata antiguo despertó con memorias de la era mágica'],cosmology:'Los antiguos dioses son ahora llamados "leyes de la física". Sus templos se convirtieron en centrales de vapor sin que nadie supiera lo que eran. Algunos ingenieros sienten algo extraño al trabajar en ellos.'}},
    {name:'Yomigaeru — Tierra de los Espíritus',slug:'yomigaeru',desc:'Archipiélago oriental mítico donde el mundo de los vivos y el de los espíritus coexisten peligrosamente.',atm:'mysterious',lore:{age:'Era del Velo Roto, año 1203',continents:['El Archipiélago del Sol Naciente (doce islas habitadas)','Las Islas Fantasma (islas que aparecen y desaparecen)','El Plano del Crepúsculo (mundo espiritual accesible por ciertos rituales)'],factions:['El Shogunato Imperial — orden y tradición a cualquier costo','Los Clanes del Viento — guerreros nómadas que sirven al mejor postor','La Corte de los Espíritus Mayores — seres no humanos con sus propias agendas','Los Onmyōji — exorcistas que el Shogunato ahora persigue'],currentConflict:'El Velo entre mundos se adelgaza. Espíritus vengativos cruzan al mundo de los vivos. El Shogunato culpa a los Onmyōji y los persigue. Sin los Onmyōji, el mundo se pierde.',hooks:['El Emperador lleva 40 años sin envejecer ni un día','Niños nacidos este año no tienen sombra','Un espíritu Dragón busca su cuerpo físico, perdido hace siglos'],cosmology:'Los dioses son espíritus mayores en el Plano del Crepúsculo. Se puede negociar con ellos pero todo trato tiene precio. Los más antiguos ya no recuerdan que alguna vez fueron adorados.'}},
    {name:'Escombros del Mañana — El Mundo Roto',slug:'escombros',desc:'Post-apocalipsis fantástico. La civilización colapsó hace 300 años. Entre las ruinas crecen mutaciones, cultos y supervivientes.',atm:'dark',lore:{age:'Año Post-Extinción 312',continents:['Las Ruinas del Centro (megalópolis destruida, la más peligrosa)','La Zona Verde (naturaleza mutante que reconquista el mundo)','El Bunker (últimas ciudades subterráneas de la humanidad)'],factions:['Los Arquitectos — reconstrucción a cualquier precio','El Culto de la Extinción — creen que el fin fue correcto y debe completarse','Los Mutantes Libres — los "evolucionados" que buscan aceptación','Mercaderes de la Chatarra — neutrales, venden a todos, saben secretos'],currentConflict:'Los Arquitectos encontraron planos de la antigua civilización. El Culto quiere destruirlos. Los Mutantes quieren acceso a los conocimientos médicos para curar su condición. Todos convergen en las Ruinas del Centro.',hooks:['¿Qué causó realmente la Gran Extinción hace 300 años?','Una IA de la era antigua acaba de despertar en las ruinas','Hay niños que nacen con poderes que recuerdan a la magia que existía antes'],cosmology:'Los dioses murieron en la Gran Extinción. Sus cadáveres son los cráteres radiactivos. Algunos dicen que aún se puede extraer poder de ellos, pero el precio es la cordura.'}}
  ];
  for(const u of bases){
    await pool.query('INSERT INTO universes(name,slug,description,lore,atmosphere,is_base) VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(slug) DO NOTHING',[u.name,u.slug,u.desc,JSON.stringify(u.lore),u.atm]);
  }
  console.log('Base universes seeded');
}

// USUARIOS
async function createUser(u,h,d){const r=await pool.query('INSERT INTO users(username,password_hash,display_name)VALUES($1,$2,$3)RETURNING id,username,display_name',[u.toLowerCase(),h,d||u]);return r.rows[0];}
async function getUserByUsername(u){const r=await pool.query('SELECT * FROM users WHERE username=$1',[u.toLowerCase()]);return r.rows[0]||null;}
async function getUserById(id){const r=await pool.query('SELECT id,username,display_name FROM users WHERE id=$1',[id]);return r.rows[0]||null;}
// WRITING
async function saveWritingSample(uid,q,a){await pool.query('INSERT INTO writing_samples(user_id,question,answer)VALUES($1,$2,$3)',[uid,q,a]);}
async function getWritingSamples(uid,lim=15){const r=await pool.query('SELECT question,answer FROM writing_samples WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2',[uid,lim]);return r.rows;}
async function getHumanoLeaderboard(lim=20){const r=await pool.query('SELECT u.display_name AS name,COUNT(ws.id)AS score FROM users u LEFT JOIN writing_samples ws ON ws.user_id=u.id GROUP BY u.id,u.display_name HAVING COUNT(ws.id)>0 ORDER BY score DESC LIMIT $1',[lim]);return r.rows.map(row=>({name:row.name,score:Number(row.score)}));}
// SURVIVAL
async function saveSvScore(pn,t,m,mo){await pool.query('INSERT INTO survival_scores(player_names,turns,mobs_defeated,mode)VALUES($1,$2,$3,$4)',[pn,t,m,mo]);}
async function getSvLeaderboard(mode,lim=20){const r=await pool.query('SELECT player_names,turns,mobs_defeated,played_at FROM survival_scores WHERE mode=$1 ORDER BY turns DESC,mobs_defeated DESC LIMIT $2',[mode,lim]);return r.rows;}
// DND LEGACY
async function saveDndAdventure(title,summary,theme,aj){const r=await pool.query('INSERT INTO dnd_adventures(title,summary,theme,adventure_json)VALUES($1,$2,$3,$4)RETURNING id',[title,summary,theme,JSON.stringify(aj)]);return r.rows[0].id;}
async function getDndAdventures(lim=20){const r=await pool.query('SELECT id,title,summary,theme,play_count,created_at FROM dnd_adventures ORDER BY play_count DESC,created_at DESC LIMIT $1',[lim]);return r.rows;}
async function getDndAdventureById(id){const r=await pool.query('SELECT * FROM dnd_adventures WHERE id=$1',[id]);if(!r.rows[0])return null;return{...r.rows[0],adventure_json:r.rows[0].adventure_json};}
async function incrementDndPlayCount(id){await pool.query('UPDATE dnd_adventures SET play_count=play_count+1 WHERE id=$1',[id]);}
async function saveDndSession(aid,pn,oc,ch){await pool.query('INSERT INTO dnd_sessions(adventure_id,player_names,outcome,chapters_completed)VALUES($1,$2,$3,$4)',[aid,pn,oc,ch]);}
// UNIVERSOS
async function getUniverses(){const r=await pool.query('SELECT u.*,(SELECT COUNT(*)FROM characters c WHERE c.universe_id=u.id AND c.status=\'alive\')AS active_heroes,(SELECT COUNT(*)FROM universe_history h WHERE h.universe_id=u.id)AS event_count FROM universes u ORDER BY u.is_base DESC,u.created_at ASC');return r.rows;}
async function getUniverseById(id){const r=await pool.query('SELECT * FROM universes WHERE id=$1',[id]);return r.rows[0]||null;}
async function createUniverse(uid,name,desc,lore,atm){const slug=name.toLowerCase().replace(/[^a-z0-9]/g,'-').replace(/-+/g,'-').slice(0,80)+'-'+Date.now();const r=await pool.query('INSERT INTO universes(name,slug,description,lore,atmosphere,is_base,created_by)VALUES($1,$2,$3,$4,$5,false,$6)RETURNING *',[name,slug,desc,JSON.stringify(lore),atm,uid]);return r.rows[0];}
async function updateUniverseLore(id,patch){await pool.query('UPDATE universes SET lore=lore||$1::jsonb,updated_at=NOW() WHERE id=$2',[JSON.stringify(patch),id]);}
// HISTORIA
async function addUniverseEvent(uid,cid,cname,etype,title,desc,impact){const r=await pool.query('INSERT INTO universe_history(universe_id,character_id,character_name,event_type,title,description,impact_level)VALUES($1,$2,$3,$4,$5,$6,$7)RETURNING *',[uid,cid,cname,etype,title,desc,impact||1]);return r.rows[0];}
async function getUniverseHistory(uid,lim=30){const r=await pool.query('SELECT * FROM universe_history WHERE universe_id=$1 ORDER BY happened_at DESC LIMIT $2',[uid,lim]);return r.rows;}
async function getUniverseLegends(uid){const r=await pool.query('SELECT * FROM universe_history WHERE universe_id=$1 AND impact_level>=3 ORDER BY impact_level DESC,happened_at DESC LIMIT 20',[uid]);return r.rows;}
// PERSONAJES
async function createCharacter(uid,univ_id,d){const r=await pool.query('INSERT INTO characters(user_id,universe_id,name,class,backstory,appearance,learned_skills,items,level,xp,hp,max_hp,stamina,max_stamina,mana,max_mana,str_stat,dex_stat,int_stat,cha_stat)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)RETURNING *',[uid,univ_id,d.name,d.class,d.backstory||'',JSON.stringify(d.appearance||{}),JSON.stringify(d.learnedSkills||[]),JSON.stringify(d.items||[]),d.level||1,d.xp||0,d.hp||20,d.maxHp||20,d.stamina||0,d.maxStamina||0,d.mana||0,d.maxMana||0,d.str||10,d.dex||10,d.int||10,d.cha||10]);return r.rows[0];}
async function getCharactersByUser(uid){const r=await pool.query('SELECT c.*,u.name AS universe_name,u.atmosphere AS universe_atmosphere,u.slug AS universe_slug FROM characters c LEFT JOIN universes u ON u.id=c.universe_id WHERE c.user_id=$1 ORDER BY CASE c.status WHEN \'alive\' THEN 0 ELSE 1 END,c.level DESC,c.updated_at DESC',[uid]);return r.rows;}
async function getCharacterById(id){const r=await pool.query('SELECT c.*,u.name AS universe_name,u.lore AS universe_lore,u.atmosphere AS universe_atmosphere FROM characters c LEFT JOIN universes u ON u.id=c.universe_id WHERE c.id=$1',[id]);return r.rows[0]||null;}
async function updateCharacter(id,upd){const allowed=['hp','max_hp','stamina','max_stamina','mana','max_mana','str_stat','dex_stat','int_stat','cha_stat','level','xp','items','learned_skills','conditions','last_location','adventures_completed','total_kills','legendary_deeds','status','death_reason'];const fields=[];const vals=[];let idx=1;for(const[k,v]of Object.entries(upd)){if(allowed.includes(k)){fields.push(`${k}=$${idx++}`);vals.push(typeof v==='object'?JSON.stringify(v):v);}}if(!fields.length)return;vals.push(id);await pool.query(`UPDATE characters SET ${fields.join(',')},updated_at=NOW() WHERE id=$${idx}`,vals);}
async function killCharacter(id,reason){await pool.query('UPDATE characters SET status=\'dead\',death_reason=$1,updated_at=NOW() WHERE id=$2',[reason,id]);}
// MISIONES
async function getMissionsForUniverse(uid,minLv=1,maxLv=20){const r=await pool.query('SELECT * FROM missions WHERE universe_id=$1 AND min_level<=$2 AND max_level>=$3 ORDER BY min_level ASC,times_played ASC LIMIT 20',[uid,maxLv,minLv]);return r.rows;}
async function saveMission(uid,title,summary,minLv,maxLv,diff,mj){const r=await pool.query('INSERT INTO missions(universe_id,title,summary,min_level,max_level,difficulty,mission_json)VALUES($1,$2,$3,$4,$5,$6,$7)RETURNING id',[uid,title,summary,minLv,maxLv,diff,JSON.stringify(mj)]);return r.rows[0].id;}
async function getMissionById(id){const r=await pool.query('SELECT * FROM missions WHERE id=$1',[id]);return r.rows[0]||null;}
async function incrementMissionPlayCount(id){await pool.query('UPDATE missions SET times_played=times_played+1 WHERE id=$1',[id]);}
// AVENTURAS
async function startCharacterAdventure(cid,mid,uid,sd){const r=await pool.query('INSERT INTO character_adventures(character_id,mission_id,universe_id,session_data)VALUES($1,$2,$3,$4)RETURNING id',[cid,mid||null,uid,JSON.stringify(sd||{})]);return r.rows[0].id;}
async function updateCharacterAdventure(id,sd,oc,imp,ch){await pool.query('UPDATE character_adventures SET session_data=$1,outcome=$2,impact_summary=$3,chapters_completed=$4,finished_at=CASE WHEN $2!=\'ongoing\' THEN NOW() ELSE finished_at END WHERE id=$5',[JSON.stringify(sd),oc||'ongoing',imp||null,ch||0,id]);}
async function saveFullSession(advId, fullSnapshot){
  // Saves complete session state for resume — called after every player action
  await pool.query('UPDATE character_adventures SET session_data=$1 WHERE id=$2',[JSON.stringify(fullSnapshot),advId]);
}
async function getOngoingAdventure(characterId){
  const r=await pool.query('SELECT ca.*,m.title AS mission_title,m.mission_json FROM character_adventures ca LEFT JOIN missions m ON m.id=ca.mission_id WHERE ca.character_id=$1 AND ca.outcome=\'ongoing\' ORDER BY ca.started_at DESC LIMIT 1',[characterId]);
  return r.rows[0]||null;
}
async function getShopItems(universeId){
  // Returns available shop items for a universe (static + dynamic)
  return [
    {id:'potion_hp',name:'Poción de Curación',desc:'Restaura 2d4+2 HP',cost:50,effect:{stat:'hp',change:7},icon:'🧪'},
    {id:'potion_greater',name:'Poción Mayor',desc:'Restaura 4d4+4 HP',cost:120,effect:{stat:'hp',change:16},icon:'💊'},
    {id:'antidote',name:'Antídoto',desc:'Elimina condición de veneno',cost:40,effect:{stat:'condition',condition:'envenenado',remove:true},icon:'🌿'},
    {id:'elixir_stamina',name:'Elixir de Estamina',desc:'+10 Estamina',cost:60,effect:{stat:'stamina',change:10},icon:'⚡'},
    {id:'elixir_mana',name:'Elixir de Maná',desc:'+10 Maná',cost:60,effect:{stat:'mana',change:10},icon:'🔮'},
    {id:'scroll_shield',name:'Pergamino de Escudo',desc:'+5 CA este combate',cost:80,effect:{stat:'condition',condition:'escudado',remove:false},icon:'📜'},
    {id:'torch_bundle',name:'Antorchas x5',desc:'Ilumina zonas oscuras',cost:20,effect:{stat:'items',item:'Antorcha x5',change:1},icon:'🕯️'},
    {id:'rope_50ft',name:'Cuerda (15m)',desc:'Útil para escalar y explorar',cost:15,effect:{stat:'items',item:'Cuerda (15m)',change:1},icon:'🪢'},
    {id:'rations_3',name:'Raciones x3',desc:'Descanso seguro: +2 HP/turno',cost:25,effect:{stat:'items',item:'Raciones x3',change:1},icon:'🥩'},
    {id:'lockpick',name:'Ganzúas',desc:'Abre cerraduras (Pícaro: ventaja)',cost:35,effect:{stat:'items',item:'Ganzúas',change:1},icon:'🔑'},
    {id:'spellbook',name:'Grimorio Arcano',desc:'Mago: +2 INT este capítulo',cost:100,effect:{stat:'int',change:2},icon:'📕'},
    {id:'blade_poison',name:'Veneno de Hoja',desc:'Próximo ataque: +1d6 veneno',cost:75,effect:{stat:'items',item:'Veneno de Hoja',change:1},icon:'🗡️'},
    {id:'smoke_bomb',name:'Bomba de Humo',desc:'Escape garantizado una vez',cost:90,effect:{stat:'items',item:'Bomba de Humo',change:1},icon:'💨'},
    {id:'gold_coins',name:'Monedas de Oro x10',desc:'Moneda para comercio e influencia',cost:0,effect:null,icon:'🪙'},
  ];
}
async function getCharacterGold(charId){
  const r=await pool.query('SELECT (items::jsonb) AS items FROM characters WHERE id=$1',[charId]);
  const items=r.rows[0]?.items||[];
  const goldItem=items.find?.(i=>typeof i==='object'&&i.id==='gold')||null;
  return goldItem?.amount||0;
}
async function getCharacterAdventures(cid){const r=await pool.query('SELECT ca.*,m.title AS mission_title FROM character_adventures ca LEFT JOIN missions m ON m.id=ca.mission_id WHERE ca.character_id=$1 ORDER BY ca.started_at DESC',[cid]);return r.rows;}

module.exports={initDB,createUser,getUserByUsername,getUserById,saveWritingSample,getWritingSamples,getHumanoLeaderboard,saveSvScore,getSvLeaderboard,saveDndAdventure,getDndAdventures,getDndAdventureById,incrementDndPlayCount,saveDndSession,getUniverses,getUniverseById,createUniverse,updateUniverseLore,addUniverseEvent,getUniverseHistory,getUniverseLegends,createCharacter,getCharactersByUser,getCharacterById,updateCharacter,killCharacter,getMissionsForUniverse,saveMission,getMissionById,incrementMissionPlayCount,startCharacterAdventure,updateCharacterAdventure,getCharacterAdventures,saveFullSession,getOngoingAdventure,getShopItems};
