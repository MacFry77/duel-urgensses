const test = require('node:test');
const assert = require('node:assert/strict');
const { resolve, publicState, aggregateResults, removePlayer, transferHost, lobbySummaries, activeGameSummaries, replaceSocket, scoreRound, startMatch, facesFor, makePool, roll, nextClockwise } = require('../server');

const symbol = color => ({color, face:'symbol'});
const flag = color => ({color, face:'flag'});
const played = dice => ({played:dice.map((die, player) => ({player, die}))});

test('le tour suit toujours le même sens horaire et boucle sans inversion', () => {
  const room={players:[{id:'a'},{id:'b'},{id:'c'},{id:'d'}]};
  const order=[];let turn=0;
  for(let step=0;step<8;step++){order.push(turn);turn=nextClockwise(room,turn)}
  assert.deepEqual(order,[0,1,2,3,0,1,2,3]);
});

test('chaque couleur respecte exactement les six faces de la notice', () => {
  assert.deepEqual(facesFor('violet'),[1,1,2,2,3,3]);
  assert.deepEqual(facesFor('yellow'),[3,3,4,4,5,5]);
  assert.deepEqual(facesFor('red'),[5,5,6,6,7,7]);
  assert.deepEqual(facesFor('gray'),['flag','flag','flag',1,1,6]);
  for(const color of ['brown','green','blue'])assert.deepEqual(facesFor(color),['symbol','symbol','symbol','symbol','flag','flag']);
});

test('les dés distribués restent non lancés jusqu’au moment où ils sont joués', () => {
  const pool=makePool();
  assert.equal(pool.length,36);
  assert.ok(pool.every(die=>die.face===null&&die.faces.length===6));
  const die=pool[0],allowed=facesFor(die.color);roll(die);
  assert.ok(allowed.includes(die.face));
});

for (const [winner, loser, label] of [
  ['brown', 'green', 'Urgentiste bat Chirurgien'],
  ['green', 'blue', 'Chirurgien bat Anesthésiste'],
  ['blue', 'brown', 'Anesthésiste bat Urgentiste']
]) {
  test(`${label}, quel que soit l'ordre de jeu`, () => {
    assert.equal(resolve(played([symbol(winner), symbol(loser)])), 0);
    assert.equal(resolve(played([symbol(loser), symbol(winner)])), 1);
  });
}

test('si les trois symboles apparaissent, Urgentiste gagne', () => {
  assert.equal(resolve(played([symbol('green'), symbol('blue'), symbol('brown')])), 2);
});

test('un drapeau blanc Urgentiste vaut zéro face à un symbole Chirurgien', () => {
  assert.equal(resolve(played([flag('brown'), symbol('green')])), 1);
});

test('à valeur numérique identique, le dernier dé joué gagne', () => {
  const die = color => ({color, face:4});
  assert.equal(resolve(played([die('red'), die('red'), die('red')])), 2);
});

test('une revanche remet les scores à zéro et redémarre avec les mêmes joueurs', () => {
  const room={status:'finished',phase:'over',resultRecorded:true,round:4,leader:1,turn:1,trick:4,played:[{player:0,die:{color:'red',face:3}}],leadColor:'red',players:[
    {id:'a',score:80,totalTricks:4,exactRounds:2,zeroSuccesses:1,missedRounds:2,totalBid:7,boldestBid:3,dice:[],bid:2,tricks:1},
    {id:'b',score:60,totalTricks:3,exactRounds:1,zeroSuccesses:0,missedRounds:3,totalBid:6,boldestBid:2,dice:[],bid:1,tricks:0}
  ]};
  startMatch(room);
  assert.equal(room.status,'playing');assert.equal(room.phase,'bids');assert.equal(room.round,1);assert.equal(room.resultRecorded,false);
  assert.deepEqual(room.players.map(player=>player.score),[0,0]);assert.deepEqual(room.players.map(player=>player.totalTricks),[0,0]);
  assert.ok(room.players.every(player=>player.dice.length===1));
});

test('chaque nouveau match reçoit une nouvelle graine de chronique', () => {
  const room={status:'finished',phase:'over',resultRecorded:true,round:2,players:[
    {id:'a',score:40,dice:[]},{id:'b',score:20,dice:[]}
  ]};
  startMatch(room);const firstSeed=room.chronicleSeed;
  room.status='finished';room.phase='over';startMatch(room);
  assert.ok(firstSeed);assert.notEqual(room.chronicleSeed,firstSeed);
});

test('le décompte mémorise les faits servant aux chroniques de fin', () => {
  const room={round:3,players:[
    {bid:0,tricks:0,score:0},
    {bid:4,tricks:3,score:20}
  ]};
  scoreRound(room);
  assert.deepEqual(room.players[0],{bid:0,tricks:0,score:30,totalBid:0,boldestBid:0,exactRounds:1,zeroSuccesses:1,roundHistory:[{round:3,bid:0,tricks:0,exact:true,scoreBefore:0,points:30,scoreAfter:30}]});
  assert.deepEqual(room.players[1],{bid:4,tricks:3,score:20,totalBid:4,boldestBid:4,missedRounds:1,roundHistory:[{round:3,bid:4,tricks:3,exact:false,scoreBefore:20,points:0,scoreAfter:20}]});
});

for(let round=1;round<=8;round++){
  test(`un pari zéro réussi en manche ${round} rapporte ${round*10} points`, () => {
    // Alterne valeurs numériques et valeurs restaurées depuis le stockage.
    const restored=round%2===0,room={round:restored?String(round):round,players:[{bid:restored?'0':0,tricks:restored?'0':0,score:40}]};
    scoreRound(room);
    assert.equal(room.players[0].score,40+round*10);
    assert.equal(room.players[0].zeroSuccesses,1);
    assert.equal(room.players[0].roundHistory[0].points,round*10);
  });
}

test('un pari zéro raté ne rapporte aucun point', () => {
  const room={round:8,players:[{bid:0,tricks:1,score:40}]};
  scoreRound(room);
  assert.equal(room.players[0].score,40);
  assert.equal(room.players[0].zeroSuccesses,undefined);
  assert.equal(room.players[0].roundHistory[0].points,0);
});

test('une absence de pari ne peut pas être confondue avec un pari zéro', () => {
  const room={round:8,players:[{bid:null,tricks:0,score:40}]};
  scoreRound(room);
  assert.equal(room.players[0].score,40);
  assert.equal(room.players[0].roundHistory[0].exact,false);
});

test('les paris adverses restent secrets puis sont révélés ensemble', () => {
  const room = {
    code:'ABCDE',status:'playing',hostId:'p1',totalRounds:3,round:1,trick:1,
    phase:'bids',leader:0,turn:1,leadColor:null,played:[],message:'',
    spectators:[],chat:[],players:[
      {id:'p1',name:'Pascal',character:'Pascal',score:0,bid:1,tricks:0,ws:{},dice:[]},
      {id:'p2',name:'Pierre',character:'Pierre',score:0,bid:null,tricks:0,ws:{},dice:[]}
    ]
  };

  assert.equal(publicState(room, 'p1').players[0].bid, 1);
  assert.equal(publicState(room, 'p2').players[0].bid, null);

  room.players[1].bid = 0;
  room.phase = 'play';
  assert.deepEqual(publicState(room, 'p2').players.map(player => player.bid), [1, 0]);
});

test('le Hall of Fame classe d’abord selon les points cumulés', () => {
  const rows = aggregateResults([
    {character:'Pascal',result:'win',score:20,tricks:1},
    {character:'Pascal',result:'win',score:20,tricks:1},
    {character:'Natacha',result:'loss',score:70,tricks:2}
  ]);
  assert.deepEqual(rows.map(row => row.character), ['Natacha', 'Pascal']);
  assert.equal(rows[0].points, 70);
  assert.equal(rows[1].wins, 2);
});

test('l’indice de performance récompense les points par manche avec une pondération initiale', () => {
  const rows=aggregateResults([
    {character:'Fanny',result:'win',score:160,tricks:5,rounds:8},
    {character:'Fanny',result:'win',score:160,tricks:5,rounds:8},
    {character:'Catoire d’Arabie',result:'loss',score:120,tricks:4,rounds:4}
  ]);
  const fanny=rows.find(row=>row.character==='Fanny'),catoire=rows.find(row=>row.character==='Catoire d’Arabie');
  assert.equal(fanny.pointsPerRound,20);
  assert.equal(catoire.pointsPerRound,30);
  assert.ok(catoire.performance>fanny.performance);
});

test('exclure le joueur dont c’est le tour transmet la main au suivant', () => {
  const room = {
    status:'playing',phase:'play',round:2,trick:1,turn:1,leader:0,leadColor:null,played:[],
    players:[
      {id:'p1',score:0,bid:0,tricks:0,dice:[]},
      {id:'p2',score:0,bid:0,tricks:0,dice:[]},
      {id:'p3',score:0,bid:0,tricks:0,dice:[]}
    ]
  };
  assert.equal(removePlayer(room, 'p2').id, 'p2');
  assert.deepEqual(room.players.map(player => player.id), ['p1', 'p3']);
  assert.equal(room.turn, 1);
  assert.equal(room.status, 'playing');
});

test('une partie repasse en attente si une exclusion laisse un seul joueur', () => {
  const room = {
    status:'playing',phase:'play',round:3,trick:1,turn:1,leader:0,leadColor:'red',played:[],
    players:[
      {id:'p1',score:20,bid:1,tricks:1,dice:[{id:'a'}]},
      {id:'p2',score:0,bid:0,tricks:0,dice:[{id:'b'}]}
    ]
  };
  removePlayer(room, 'p2');
  assert.equal(room.status, 'lobby');
  assert.equal(room.phase, 'lobby');
  assert.equal(room.players[0].score, 0);
});

test("la déconnexion de l'hôte en attente transmet le contrôle au premier joueur connecté", () => {
  const room={status:'lobby',hostId:'host',players:[
    {id:'host',ws:null},{id:'p2',ws:{}},{id:'p3',ws:{}}
  ],spectators:[{id:'s1',ws:{}}]};
  assert.equal(transferHost(room).id,'p2');
  assert.equal(room.hostId,'p2');
});

test("un spectateur connecté devient hôte si aucun joueur n'est disponible", () => {
  const room={status:'finished',hostId:'host',players:[{id:'host',ws:null},{id:'p2',ws:null}],spectators:[{id:'s1',ws:{}}]};
  assert.equal(transferHost(room).id,'s1');
  assert.equal(room.hostId,'s1');
});

test("l'hôte n'est pas transféré au milieu d'une partie", () => {
  const room={status:'playing',hostId:'host',players:[{id:'host',ws:null},{id:'p2',ws:{}}],spectators:[]};
  assert.equal(transferHost(room),null);
  assert.equal(room.hostId,'host');
});

test("après le délai de grâce, l'hôte peut être transféré pendant une partie", () => {
  const room={status:'playing',hostId:'host',players:[{id:'host',ws:null},{id:'p2',ws:{}}],spectators:[]};
  assert.equal(transferHost(room,{force:true}).id,'p2');
  assert.equal(room.hostId,'p2');
});

test('les états publics exposent leur révision pour écarter les messages anciens', () => {
  const room={code:'ABCDE',status:'lobby',hostId:'p1',revision:17,totalRounds:4,maxPlayers:6,round:1,trick:1,phase:'lobby',leader:0,turn:0,leadColor:null,played:[],message:'',chat:[],spectators:[],players:[{id:'p1',name:'Pascal',character:'Pascal',score:0,bid:null,tricks:0,dice:[],ws:{}}]};
  assert.equal(publicState(room,'p1').revision,17);
});

test('le panneau ne publie que les défis ouverts, connectés et non complets', () => {
  const connected = {};
  const source = new Map([
    ['OPEN', {code:'OPEN',status:'lobby',phase:'lobby',hostId:'h',totalRounds:5,maxPlayers:4,players:[{id:'h',name:'Pascal',ws:connected}],spectators:[]}],
    ['FULL', {code:'FULL',status:'lobby',phase:'lobby',hostId:'a',totalRounds:3,maxPlayers:2,players:[{id:'a',name:'A',ws:connected},{id:'b',name:'B',ws:connected}],spectators:[]}],
    ['PLAY', {code:'PLAY',status:'playing',phase:'play',hostId:'c',totalRounds:8,maxPlayers:6,players:[{id:'c',name:'C',ws:connected}],spectators:[]}],
    ['STALE', {code:'STALE',status:'lobby',phase:'play',hostId:'s',totalRounds:8,maxPlayers:6,players:[{id:'s',name:'S',ws:connected}],spectators:[]}],
    ['OFF', {code:'OFF',status:'lobby',phase:'lobby',hostId:'d',totalRounds:2,maxPlayers:6,players:[{id:'d',name:'D',ws:null}],spectators:[]}]
  ]);
  assert.deepEqual(lobbySummaries(source), [{code:'OPEN',host:'Pascal',players:1,maxPlayers:4,rounds:5}]);
});

test('la liste des parties en cours indique leur hôte et ignore les parties terminées', () => {
  const connected={};const source=new Map([
    ['LIVE',{code:'LIVE',status:'playing',phase:'play',hostId:'h',round:3,totalRounds:6,maxPlayers:4,players:[{id:'h',name:'Pascal',ws:connected},{id:'p',name:'Pierre',ws:connected}],spectators:[]}],
    ['OVER',{code:'OVER',status:'finished',phase:'over',hostId:'o',round:6,totalRounds:6,maxPlayers:4,players:[{id:'o',name:'Olivier',ws:connected}],spectators:[]}],
    ['OFF',{code:'OFF',status:'playing',phase:'play',hostId:'x',round:2,totalRounds:4,maxPlayers:4,players:[{id:'x',name:'X',ws:null}],spectators:[]}]
  ]);
  assert.deepEqual(activeGameSummaries(source),[{code:'LIVE',host:'Pascal',players:2,maxPlayers:4,round:3,totalRounds:6,spectators:0}]);
});

test("une reconnexion révoque l'ancienne socket avant de donner le contrôle à la nouvelle", () => {
  const closed=[];
  const previous={room:'ABCDE',playerId:'p1',close:(code,reason)=>closed.push({code,reason})};
  const current={};
  const player={id:'p1',ws:previous};
  replaceSocket(player,current);
  assert.equal(player.ws,current);
  assert.equal(previous.room,null);
  assert.equal(previous.playerId,null);
  assert.deepEqual(closed,[{code:4001,reason:'Connexion remplacée'}]);
});

test('resynchroniser sur la même socket ne la ferme pas', () => {
  let closed=false;
  const current={close:()=>{closed=true}};
  const player={id:'p1',ws:current};
  replaceSocket(player,current);
  assert.equal(closed,false);
  assert.equal(player.ws,current);
});
