const test = require('node:test');
const assert = require('node:assert/strict');
const { resolve, publicState } = require('../server');

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
