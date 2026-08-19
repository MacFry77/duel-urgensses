const test = require('node:test');
const assert = require('node:assert/strict');
const { resolve, publicState, aggregateResults, removePlayer } = require('../server');

const symbol = color => ({color, face:'symbol'});
const flag = color => ({color, face:'flag'});
const played = dice => ({played:dice.map((die, player) => ({player, die}))});

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
