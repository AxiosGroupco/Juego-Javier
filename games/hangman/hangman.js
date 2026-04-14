// ── AHORCADO — Socket Handlers ───────────────────────────────
// games/hangman/hangman.js
// Edita este archivo para cambiar el ahorcado sin tocar otros

function registerHangmanSockets(io, rooms, socketUsers, helpers) {
  const { HM_WORDS, startHangmanSolo, startHangman } = helpers;
  return function(socket) {
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
  };
}

module.exports = { registerHangmanSockets };
