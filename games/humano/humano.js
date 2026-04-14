// ── ¿QUIÉN ES HUMANO? — Socket Handlers ─────────────────────
// games/humano/humano.js
// Edita este archivo para cambiar el juego sin tocar otros

const db = require('../../db');

function registerHumanoSockets(io, rooms, socketUsers, helpers) {
  const { genBotAnswers, claudeAskQuestion, claudeGuessHuman, startHumanoSoloRound } = helpers;
  return function(socket) {
// ── HUMANO ──
  socket.on('submit_question', async ({question}) => {
    const code=socket.roomCode,room=rooms[code];
    if(!room||room.game!=='humano') return;
    room.question=question;
    room.extraContext=null;
    // Mostrar al humano la pregunta + opción de dar instrucciones a los bots
    io.to(room.humanId).emit('answer_question',{question, canAddInstructions:true});
    if(room.interrogatorId!=='claude') io.to(room.interrogatorId).emit('waiting_for_answers',{question});
  });

  socket.on('submit_extra_context', ({context}) => {
    const code=socket.roomCode,room=rooms[code];
    if(!room) return;
    room.extraContext=context;
    io.to(room.humanId).emit('answer_question',{question:room.question});
  });

  socket.on('submit_human_answer', async ({answer, instructions}) => {
    const code=socket.roomCode,room=rooms[code];
    if(!room||socket.id!==room.humanId) return;
    // instructions: texto que el humano escribe para que los bots lo sigan
    // extraContext ya puede venir de submit_extra_context también
    if(instructions) room.extraContext=instructions;
    room.humanAnswer=answer;
    io.to(room.humanId).emit('generating_bots');
    if(room.interrogatorId!=='claude') io.to(room.interrogatorId).emit('generating_bots_wait');

    const humanPlayer=room.players.find(p=>p.id===room.humanId);
    let writingSamples=[], bannedWords=[];

    // Clave de sala basada en los userIds — persistente entre partidas del mismo grupo
    const playerIds=room.players.map(p=>p.userId||p.name||p.id).sort().join('_');
    const roomKey=`humano_${playerIds}`;
    room._roomKey=roomKey;

    if(humanPlayer?.userId){
      try{
        await db.saveWritingSample(humanPlayer.userId,room.question,answer);
        writingSamples=await db.getWritingSamples(humanPlayer.userId,20);
      }catch(e){console.error('DB write sample error:',e);}
    }
    try{ bannedWords=await db.getBannedWords(roomKey); }catch(e){}

    const bots=await genBotAnswers(room.question,answer,room.profile,room.extraContext,10,writingSamples,bannedWords);
    const pool=shuffle([
      {id:'human',answer,isHuman:true,eliminated:false},
      ...bots.map((a,i)=>({id:`bot${i}`,answer:a,isHuman:false,eliminated:false}))
    ]).map((a,i)=>({...a,label:i+1}));
    room.allAnswers=pool; room.activeAnswers=[...pool]; room.eliminationRound=0;
    const visible=pool.map(a=>({label:a.label,answer:a.answer}));

    // Auto-aprender palabras prohibidas después de cada ronda
    if(room._roomKey){
      try{
        const botTexts=bots.filter(Boolean);
        const newBanned=await db.detectAndLearnBannedWords(room._roomKey,botTexts,answer);
        if(newBanned.length>0){
          // Notificar a los jugadores qué palabras aprendió
          io.to(code).emit('banned_words_learned',{words:newBanned});
        }
      }catch(e){}
    }

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

  // ── GESTIÓN DE PALABRAS PROHIBIDAS ───────────────────────
  socket.on('add_banned_word', async ({word}) => {
    const code=socket.roomCode,room=rooms[code];
    if(!room||room.game!=='humano') return;
    const playerIds=room.players.map(p=>p.userId||p.name||p.id).sort().join('_');
    const roomKey=`humano_${playerIds}`;
    try{
      await db.addBannedWord(roomKey,word.trim());
      const updated=await db.getBannedWords(roomKey);
      io.to(code).emit('banned_words_updated',{words:updated});
    }catch(e){console.error('add_banned_word:',e);}
  });

  socket.on('remove_banned_word', async ({word}) => {
    const code=socket.roomCode,room=rooms[code];
    if(!room||room.game!=='humano') return;
    const playerIds=room.players.map(p=>p.userId||p.name||p.id).sort().join('_');
    const roomKey=`humano_${playerIds}`;
    try{
      await db.removeBannedWord(roomKey,word);
      const updated=await db.getBannedWords(roomKey);
      io.to(code).emit('banned_words_updated',{words:updated});
    }catch(e){}
  });

  socket.on('get_banned_words', async () => {
    const code=socket.roomCode,room=rooms[code];
    if(!room||room.game!=='humano') return;
    const playerIds=room.players.map(p=>p.userId||p.name||p.id).sort().join('_');
    const roomKey=`humano_${playerIds}`;
    try{
      const words=await db.getBannedWords(roomKey);
      socket.emit('banned_words_updated',{words});
    }catch(e){ socket.emit('banned_words_updated',{words:[]}); }
  });
  };
}

module.exports = { registerHumanoSockets };
