const COLORS={red:'Rouge',yellow:'Jaune',violet:'Violet',gray:'Gris',brown:'Urgentiste',green:'Chirurgien',blue:'Anesthésiste'};
const icons={
  brown:`<svg class="med-icon" viewBox="0 0 48 48"><path d="M10 16h28v20H10zM18 16v-5h12v5M18 25h12M24 19v12"/><path d="M7 21h3M38 21h3"/></svg>`,
  green:`<svg class="med-icon" viewBox="0 0 48 48"><path d="M9 12h30v24H9zM19 12v24M30 12v24M9 20h30"/><path d="M23 26l8-8M26 31l9-9M31 32l4-4"/></svg>`,
  blue:`<svg class="med-icon" viewBox="0 0 48 48"><path d="M15 17c2-5 16-5 18 0l3 12c-3 7-21 7-24 0z"/><path d="M18 20c4 3 8 3 12 0M24 33v7M24 40h10M36 40c3 0 5-2 5-5v-7"/></svg>`
};
const pools={red:7,yellow:7,violet:8,gray:8,brown:1,green:3,blue:2};
const CHARACTERS=[
  ['Pascal','pascal-pirate.png'],['Mathieu','mathieu-luchador.png'],['Pierre','pierre-halloween.png'],['Adéla','adela-egyptienne.png'],
  ['JB','jb-cosmonaute.png'],['Romain','romain-poulet.png'],['Natacha','natacha-princesse.png'],['Fanny','fanny-exploratrice.png'],
  ['Félix','felix-cyborg.png'],['Youri','youri-paladin.png'],['Quentin','quentin-dictateur.png'],['Nicolas','nicolas-vigilante.png'],
  ['Yannick','yannick-cardinal.png'],['Cécilia','cecilia-infirmiere.png'],['Thibault','thibault-aventurier.png'],['Polo','polo-dandy.png'],
  ['Édouard','edouard-aviateur.png'],['Justin','justin-judoka.png'],['Charlotte','charlotte-cavaliere.png'],["Catoire d’Arabie",'catoire-arabie.png'],
  ['Rémy','remy-shaolin.png'],['Olivier','olivier-policier.png'],['Raphaël','raphael-scaphandrier.png'],['Éric','eric-druide.png']
];
let state;
const $=id=>document.getElementById(id);
function special(c){return ['brown','green','blue'].includes(c)}
function makePool(){const p=[];Object.entries(pools).forEach(([color,n])=>{for(let i=0;i<n;i++)p.push({id:crypto.randomUUID(),color,face:null})});return p}
function roll(d){if(special(d.color))d.face=Math.floor(Math.random()*6)<4?'symbol':'flag';else if(d.color==='gray')d.face=Math.random()<.5?'flag':1+Math.floor(Math.random()*6);else d.face=1+Math.floor(Math.random()*6);return d}
function shuffle(a){return [...a].sort(()=>Math.random()-.5)}
function dieHTML(d,clickable=false,hidden=false){if(hidden)return `<button class="die back" disabled></button>`;let face=special(d.color)&&d.face==='symbol'?icons[d.color]:d.face==='flag'?'<span class="flag">⚑</span>':`<span class="value">${d.face??'?'}</span>`;return `<button class="die ${d.color} ${clickable?'clickable':''}" ${clickable?`data-die="${d.id}"`:''}>${face}</button>`}
function selectedCharacter(id){return CHARACTERS[Number($(id).value)]}
function syncCharacterPreviews(){document.querySelector('.left-avatar .character-sprite').src=`assets/characters/${selectedCharacter('p1Character')[1]}`;document.querySelector('.right-avatar .character-sprite').src=`assets/characters/${selectedCharacter('p2Character')[1]}`}
function initCharacterSelectors(){const options=CHARACTERS.map(([name],i)=>`<option value="${i}">${name}</option>`).join('');$('p1Character').innerHTML=options;$('p2Character').innerHTML=options;$('p2Character').value='1';$('p1Character').onchange=syncCharacterPreviews;$('p2Character').onchange=syncCharacterPreviews;syncCharacterPreviews()}
function start(){let pool=shuffle(makePool()),p1=selectedCharacter('p1Character'),p2=selectedCharacter('p2Character'),totalRounds=Math.max(1,Math.min(8,Number($('roundCount').value)||8));state={round:1,totalRounds,trick:1,phase:'bids',leader:0,turn:0,leadColor:null,played:[],players:[{name:p1[0],character:p1[1],score:0,bid:null,tricks:0,dice:[]},{name:p2[0],character:p2[1],score:0,bid:null,tricks:0,dice:[]}],pool};$('lobby').classList.add('hidden');$('game').classList.remove('hidden');deal();render()}
function deal(){state.pool=shuffle(makePool());state.players.forEach(p=>{p.dice=state.pool.splice(0,state.round).map(roll);p.bid=null;p.tricks=0});state.phase='bids';state.turn=0;state.trick=1;state.played=[];state.leadColor=null}
function setBid(n){state.players[state.turn].bid=n;if(state.turn===0)state.turn=1;else{state.phase='play';state.turn=state.leader}render()}
function legalDice(player){if(!state.leadColor)return player.dice;const matching=player.dice.filter(d=>d.color===state.leadColor);return matching.length?[...matching,...player.dice.filter(d=>special(d.color))]:player.dice}
function play(id){const p=state.players[state.turn],legal=legalDice(p),d=legal.find(x=>x.id===id);if(!d)return;if(!state.played.length&&!special(d.color))state.leadColor=d.color;p.dice=p.dice.filter(x=>x.id!==id);state.played.push({player:state.turn,die:d});if(state.played.length===2){state.phase='result';const winner=resolve(state.played);state.players[winner].tricks++;state.leader=winner;state.turn=winner}else state.turn=1-state.turn;render()}
function resolve(plays){const syms=plays.filter(p=>special(p.die.color)&&p.die.face==='symbol');if(syms.length){const types=[...new Set(syms.map(p=>p.die.color))];if(types.length===3)return syms.find(p=>p.die.color==='brown').player;if(types.length===1)return syms[syms.length-1].player;const beats={brown:'green',green:'blue',blue:'brown'};return syms.find(p=>beats[p.die.color]===types.find(t=>t!==p.die.color)).player}const nums=plays.filter(p=>typeof p.die.face==='number');if(!nums.length)return plays[0].player;return nums.reduce((a,b)=>b.die.face>=a.die.face?b:a).player}
function next(){if(state.players.every(p=>p.dice.length===0)){scoreRound();if(state.round===state.totalRounds){state.phase='over'}else{state.round++;deal()}}else{state.trick++;state.phase='play';state.played=[];state.leadColor=null;state.turn=state.leader}render()}
function scoreRound(){state.players.forEach(p=>{if(p.bid===p.tricks)p.score+=p.bid===0?state.round*10:p.tricks*20})}
function render(){const [a,b]=state.players;$('p1Label').textContent=a.name;$('p2Label').textContent=b.name;$('p1Score').textContent=a.score;$('p2Score').textContent=b.score;$('p1Bid').textContent=a.bid??'—';$('p2Bid').textContent=b.bid??'—';$('p1Tricks').textContent=a.tricks;$('p2Tricks').textContent=b.tricks;$('roundValue').textContent=`${state.round} / ${state.totalRounds}`;$('trickValue').textContent=`${state.trick} / ${state.round}`;$('leadColor').textContent=state.leadColor?COLORS[state.leadColor].toUpperCase():'—';$('phaseValue').textContent=state.phase==='bids'?'PARIS':state.phase==='play'?'LANCER':state.phase==='result'?'RÉSULTAT':'TERMINÉ';
  $('game').dataset.phase=state.phase;
  const legal=state.phase==='play'?legalDice(state.players[state.turn]):[];
  $('p1Dice').innerHTML=a.dice.map(d=>dieHTML(d,state.phase==='play'&&state.turn===0&&legal.includes(d),state.phase==='play'&&state.turn!==0)).join('');
  $('p2Dice').innerHTML=b.dice.map(d=>dieHTML(d,state.phase==='play'&&state.turn===1&&legal.includes(d),state.phase==='play'&&state.turn!==1)).join('');
  document.querySelectorAll('[data-die]').forEach(el=>el.onclick=()=>play(el.dataset.die));
  $('player1Card').classList.toggle('active',state.turn===0&&['bids','play'].includes(state.phase));$('player2Card').classList.toggle('active',state.turn===1&&['bids','play'].includes(state.phase));
  $('playedDice').innerHTML=state.played.map(x=>`<div class="played-slot">${dieHTML(x.die)}<small>${state.players[x.player].name}</small></div>`).join('');
  $('bidControls').innerHTML='';$('nextButton').classList.add('hidden');
  if(state.phase==='bids'){$('message').innerHTML=`<strong>PARI DE ${state.players[state.turn].name.toUpperCase()}</strong><br><span>Choisissez le nombre de plis que vous pensez remporter pendant cette manche. Les dés seront jouables après les paris de tous les joueurs.</span>`;$('bidControls').innerHTML=Array.from({length:state.round+1},(_,n)=>`<button data-bid="${n}" aria-label="Parier ${n} pli${n>1?'s':''}">${n}</button>`).join('');document.querySelectorAll('[data-bid]').forEach(el=>el.onclick=()=>setBid(+el.dataset.bid))}
  if(state.phase==='play')$('message').innerHTML=`<strong>AU TOUR DE ${state.players[state.turn].name.toUpperCase()}</strong><br><span>Choisissez maintenant l’un de vos dés illuminés.</span>`;
  if(state.phase==='result'){$('message').textContent=`Pli remporté par ${state.players[state.leader].name}.`;$('nextButton').classList.remove('hidden')}
  if(state.phase==='over'){$('message').textContent=a.score===b.score?'Égalité parfaite.':`${a.score>b.score?a.name:b.name} remporte le duel !`;$('playedDice').innerHTML='<strong>DUEL TERMINÉ</strong>'}
}
initCharacterSelectors();$('startButton').onclick=start;$('nextButton').onclick=next;$('rulesButton').onclick=()=>$('rulesDialog').showModal();$('closeRules').onclick=()=>$('rulesDialog').close();$('legend').innerHTML=['brown','green','blue'].map(c=>`<div class="legend-item">${dieHTML({color:c,face:'symbol'})}<span>${COLORS[c]}</span></div>`).join('');
