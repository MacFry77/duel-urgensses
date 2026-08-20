const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
let webPush = null;
try { webPush = require('web-push'); } catch {}

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const COLORS = ['red', 'yellow', 'violet', 'gray', 'brown', 'green', 'blue'];
const SPECIAL = new Set(['brown', 'green', 'blue']);
const COUNTS = { red: 7, yellow: 7, violet: 8, gray: 8, brown: 1, green: 3, blue: 2 };
const rooms = new Map();
const DATA_DIR = path.join(ROOT, 'data');
const LEADERBOARD_FILE = process.env.LEADERBOARD_FILE || path.join(DATA_DIR, 'leaderboard.json');
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'https://duel-urgensses.onrender.com/';
const persistenceTimers = new Map();
const persistenceChains = new Map();
let atomicPersistenceUnavailable=false;
const normalizeCharacter = name => name === 'Adéla' ? 'Adela' : name;
let pushConfigurationValid=false;
if(webPush&&SUPABASE_URL&&SUPABASE_KEY&&VAPID_PUBLIC_KEY&&VAPID_PRIVATE_KEY){try{webPush.setVapidDetails(VAPID_SUBJECT,VAPID_PUBLIC_KEY.trim(),VAPID_PRIVATE_KEY.trim());pushConfigurationValid=true}catch(error){console.error('Notifications désactivées : clés VAPID invalides.',error.message)}}
const pushEnabled = () => pushConfigurationValid;

const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8' };
const readLocalResults = () => { try { return JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8')); } catch { return []; } };
const writeLocalResults = rows => { fs.mkdirSync(path.dirname(LEADERBOARD_FILE), {recursive:true}); fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(rows.slice(-5000), null, 2)); };
async function readResults(){
  if(SUPABASE_URL&&SUPABASE_KEY){const response=await fetch(`${SUPABASE_URL}/rest/v1/duel_results?select=character,result,score,tricks,played_at&order=played_at.desc&limit=5000`,{headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`}});if(response.ok)return response.json();console.error('Lecture Supabase impossible :',response.status);}
  return readLocalResults();
}
async function saveResults(rows){
  if(SUPABASE_URL&&SUPABASE_KEY){const response=await fetch(`${SUPABASE_URL}/rest/v1/duel_results`,{method:'POST',headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(rows)});if(response.ok)return;console.error('Écriture Supabase impossible :',response.status);}
  writeLocalResults([...readLocalResults(),...rows]);
}
const persistenceEnabled = () => Boolean(SUPABASE_URL && SUPABASE_KEY);
const supabaseHeaders = extra => ({apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`,...extra});
const validSubscription = value => value && typeof value.endpoint==='string' && value.endpoint.startsWith('https://') && value.endpoint.length<2048 && value.keys && typeof value.keys.p256dh==='string' && typeof value.keys.auth==='string';
async function readJsonBody(req,limit=12000){
  let body='';for await(const chunk of req){body+=chunk;if(body.length>limit)throw new Error('Requête trop volumineuse');}
  return JSON.parse(body||'{}');
}
async function savePushSubscription(subscription,userAgent=''){
  if(!pushEnabled()||!validSubscription(subscription))return false;
  const response=await fetch(`${SUPABASE_URL}/rest/v1/duel_push_subscriptions?on_conflict=endpoint`,{method:'POST',headers:supabaseHeaders({'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'}),body:JSON.stringify({endpoint:subscription.endpoint,subscription,user_agent:String(userAgent).slice(0,500),updated_at:new Date().toISOString()}),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error(`Abonnement Supabase refusé (${response.status})`);return true;
}
async function deletePushSubscription(endpoint){
  if(!persistenceEnabled()||typeof endpoint!=='string')return;
  await fetch(`${SUPABASE_URL}/rest/v1/duel_push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`,{method:'DELETE',headers:supabaseHeaders({Prefer:'return=minimal'}),signal:AbortSignal.timeout(5000)});
}
async function notifyOpenChallenge(room,excludedEndpoint=''){
  if(!pushEnabled())return;
  const response=await fetch(`${SUPABASE_URL}/rest/v1/duel_push_subscriptions?select=endpoint,subscription`,{headers:supabaseHeaders(),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error(`Lecture des abonnements impossible (${response.status})`);
  const subscriptions=await response.json(),host=members(room).find(member=>member.id===room.hostId)?.name||'Un joueur';
  const payload=JSON.stringify({title:'⚔️ Nouveau défi Duel Urgensses',body:`${host} cherche des adversaires · ${room.players.length}/${room.maxPlayers} joueurs · ${room.totalRounds} manches`,url:`/?join=${room.code}`,tag:`duel-${room.code}`});
  await Promise.allSettled(subscriptions.filter(row=>row.endpoint!==excludedEndpoint).map(async row=>{
    try{await webPush.sendNotification(row.subscription,payload,{TTL:900,urgency:'high'});}catch(error){if(error.statusCode===404||error.statusCode===410)await deletePushSubscription(row.endpoint);else console.error('Notification Web Push impossible :',error.statusCode||error.message);}
  }));
}
const roomSnapshot = room => ({
  code:room.code,status:room.status,hostId:room.hostId,totalRounds:room.totalRounds,maxPlayers:room.maxPlayers,
  revision:Number(room.revision)||0,
  round:room.round,trick:room.trick,phase:room.phase,leader:room.leader,turn:room.turn,
  leadColor:room.leadColor,played:room.played,message:room.message||'',chat:room.chat,
  resultRecorded:room.resultRecorded,
  players:room.players.map(({ws,...player})=>player),
  spectators:room.spectators.map(({ws,...spectator})=>spectator)
});
async function persistRoom(snapshot){
  if(!persistenceEnabled())return;
  if(!atomicPersistenceUnavailable){
    const atomic=await fetch(`${SUPABASE_URL}/rest/v1/rpc/duel_save_active_game`,{method:'POST',headers:supabaseHeaders({'Content-Type':'application/json'}),body:JSON.stringify({p_code:snapshot.code,p_state:snapshot,p_revision:snapshot.revision}),signal:AbortSignal.timeout(5000)});
    if(atomic.ok)return;
    if(atomic.status!==404&&atomic.status!==400){console.error('Sauvegarde atomique impossible :',atomic.status,await atomic.text());return}
    atomicPersistenceUnavailable=true;console.warn('Fonction Supabase duel_save_active_game absente : sauvegarde de compatibilité utilisée.');
  }
  const current=await fetch(`${SUPABASE_URL}/rest/v1/duel_active_games?code=eq.${encodeURIComponent(snapshot.code)}&select=state`,{headers:supabaseHeaders(),signal:AbortSignal.timeout(5000)});
  if(current.ok){const rows=await current.json(),revision=Number(rows[0]?.state?.revision)||0;if(revision>snapshot.revision)return}
  const response=await fetch(`${SUPABASE_URL}/rest/v1/duel_active_games?on_conflict=code`,{method:'POST',headers:supabaseHeaders({'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'}),body:JSON.stringify({code:snapshot.code,state:snapshot,updated_at:new Date().toISOString()}),signal:AbortSignal.timeout(5000)});
  if(!response.ok)console.error('Sauvegarde de la partie impossible :',response.status,await response.text());
}
function queuePersist(room){
  if(!persistenceEnabled())return;
  const snapshot=roomSnapshot(room);clearTimeout(persistenceTimers.get(room.code));
  persistenceTimers.set(room.code,setTimeout(()=>{
    persistenceTimers.delete(room.code);const previous=persistenceChains.get(room.code)||Promise.resolve();
    const next=previous.catch(()=>{}).then(()=>persistRoom(snapshot)).catch(error=>console.error('Sauvegarde Supabase différée :',error.message));
    persistenceChains.set(room.code,next);next.finally(()=>{if(persistenceChains.get(room.code)===next)persistenceChains.delete(room.code)});
  },25));
}
function deletePersistedRoom(roomCode){
  if(!persistenceEnabled())return;
  clearTimeout(persistenceTimers.get(roomCode));persistenceTimers.delete(roomCode);
  const previous=persistenceChains.get(roomCode)||Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{const response=await fetch(`${SUPABASE_URL}/rest/v1/duel_active_games?code=eq.${encodeURIComponent(roomCode)}`,{method:'DELETE',headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`,Prefer:'return=minimal'},signal:AbortSignal.timeout(5000)});if(!response.ok)console.error('Suppression de la sauvegarde impossible :',response.status)}).catch(error=>console.error('Suppression Supabase différée :',error.message));
  persistenceChains.set(roomCode,next);next.finally(()=>{if(persistenceChains.get(roomCode)===next)persistenceChains.delete(roomCode)});
}
async function restoreRooms(){
  if(!persistenceEnabled())return;
  const since=new Date(Date.now()-24*60*60*1000).toISOString();
  const response=await fetch(`${SUPABASE_URL}/rest/v1/duel_active_games?select=code,state&updated_at=gte.${encodeURIComponent(since)}`,{headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`},signal:AbortSignal.timeout(5000)});
  if(!response.ok){console.error('Restauration des parties impossible :',response.status);return;}
  const rows=await response.json();
  for(const row of rows){const saved=row.state;if(!saved||saved.code!==row.code||!Array.isArray(saved.players)||!Array.isArray(saved.spectators))continue;saved.revision=Math.max(0,Number(saved.revision)||0);saved.maxPlayers=Math.max(2,Math.min(6,Number(saved.maxPlayers)||6));saved.players=saved.players.map(player=>({...player,ws:null}));saved.spectators=saved.spectators.map(spectator=>({...spectator,ws:null}));saved.chat=Array.isArray(saved.chat)?saved.chat:[];saved.played=Array.isArray(saved.played)?saved.played:[];rooms.set(saved.code,saved)}
  if(rows.length)console.log(`${rooms.size} partie(s) restaurée(s) depuis Supabase.`);
}
const aggregateResults = rows => [...rows.reduce((map,row)=>{const character=normalizeCharacter(row.character),value=map.get(character)||{character,games:0,wins:0,losses:0,draws:0,points:0,tricks:0};value.games++;value[row.result==='win'?'wins':row.result==='draw'?'draws':'losses']++;value.points+=Number(row.score)||0;value.tricks+=Number(row.tricks)||0;map.set(character,value);return map;},new Map()).values()].map(r=>({...r,winRate:Math.round(r.wins/r.games*100)})).sort((a,b)=>b.points-a.points||b.wins-a.wins||b.winRate-a.winRate||a.character.localeCompare(b.character,'fr'));
const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if(urlPath==='/api/push/public-key') { res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify({enabled:pushEnabled(),publicKey:pushEnabled()?VAPID_PUBLIC_KEY:''})); }
  if(urlPath==='/api/push/subscribe'&&req.method==='POST') { try{const body=await readJsonBody(req),saved=await savePushSubscription(body.subscription,req.headers['user-agent']);res.writeHead(saved?204:503);return res.end();}catch(error){console.error(error);res.writeHead(400);return res.end('Abonnement invalide');} }
  if(urlPath==='/api/push/subscribe'&&req.method==='DELETE') { try{const body=await readJsonBody(req);await deletePushSubscription(body.endpoint);res.writeHead(204);return res.end();}catch(error){console.error(error);res.writeHead(400);return res.end('Désabonnement invalide');} }
  if(urlPath==='/api/leaderboard') { try { const rows=aggregateResults(await readResults());res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify(rows)); } catch(error){console.error(error);res.writeHead(500);return res.end('Classement indisponible');} }
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.resolve(ROOT, relative);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('Introuvable');
  }
  res.writeHead(200, {'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream','Cache-Control':'no-cache'});
  fs.createReadStream(file).pipe(res);
});
const wss = new WebSocketServer({ server });

const id = () => crypto.randomBytes(8).toString('hex');
const code = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value;
  do { value = Array.from({length:5}, () => alphabet[crypto.randomInt(alphabet.length)]).join(''); } while (rooms.has(value));
  return value;
};
const send = (ws, type, payload={}) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({type,...payload}));
const shuffle = array => {
  const result = [...array];
  for (let i=result.length-1;i>0;i--) { const j=crypto.randomInt(i+1); [result[i],result[j]]=[result[j],result[i]]; }
  return result;
};
const makePool = () => shuffle(Object.entries(COUNTS).flatMap(([color,n]) => Array.from({length:n},()=>({id:id(),color,face:null}))));
const roll = die => {
  if (SPECIAL.has(die.color)) die.face = crypto.randomInt(6) < 4 ? 'symbol' : 'flag';
  else if (die.color === 'gray') die.face = crypto.randomInt(2) ? crypto.randomInt(1,7) : 'flag';
  else die.face = crypto.randomInt(1,7);
  return die;
};
const publicState = (room, viewerId) => ({
  code: room.code, status: room.status, hostId: room.hostId, totalRounds: room.totalRounds,maxPlayers:room.maxPlayers,
  round: room.round, trick: room.trick, phase: room.phase, leader: room.leader,
  turn: room.turn, leadColor: room.leadColor, played: room.played,
  message: room.message || '', viewerId,
  viewerRole: room.spectators.some(s=>s.id===viewerId) ? 'spectator' : 'player',
  spectators: room.spectators.map(s=>({id:s.id,name:s.name,connected:!!s.ws})),
  chat: room.chat,
  players: room.players.map(p => ({
    id:p.id,name:p.name,character:p.character,score:p.score,
    // Pendant les paris, chacun ne voit que son propre choix. Les paris sont
    // révélés simultanément lorsque le dernier joueur a choisi.
    bid:room.phase==='bids'&&p.id!==viewerId?null:p.bid,
    tricks:p.tricks,connected:!!p.ws,
    dice:p.id===viewerId?p.dice:p.dice.map(()=>({hidden:true}))
  }))
});
const members = room => [...room.players,...room.spectators];
const lobbySummaries = source => [...source.values()].filter(room=>room.status==='lobby'&&members(room).some(member=>member.ws)&&room.players.length<room.maxPlayers).map(room=>{
  const host=members(room).find(member=>member.id===room.hostId);
  return {code:room.code,host:host?.name||'Hôte',players:room.players.length,maxPlayers:room.maxPlayers,rounds:room.totalRounds};
});
const broadcastLobbies = () => {const lobbies=lobbySummaries(rooms);wss.clients.forEach(client=>send(client,'lobbies',{lobbies}))};
function transferHost(room){
  if(room.status==='playing')return null;
  const current=members(room).find(member=>member.id===room.hostId);
  if(current?.ws)return current;
  const successor=room.players.find(player=>player.ws)||room.spectators.find(spectator=>spectator.ws)||null;
  if(successor)room.hostId=successor.id;
  return successor;
}
const broadcast = room => {room.revision=(Number(room.revision)||0)+1;members(room).forEach(p => p.ws && send(p.ws,'state',{state:publicState(room,p.id)}));queuePersist(room);broadcastLobbies()};
const fail = (ws, message) => send(ws,'error',{message});
const currentPlayer = room => room.players[room.turn];

function deal(room) {
  const pool=makePool();
  room.players.forEach(p=>{p.dice=pool.splice(0,room.round).map(roll);p.bid=null;p.tricks=0;});
  room.phase='bids';room.turn=0;room.trick=1;room.played=[];room.leadColor=null;room.message='';
}
function legalDice(room, player) {
  if (!room.leadColor) return player.dice;
  const matching=player.dice.filter(d=>d.color===room.leadColor);
  return matching.length ? [...matching,...player.dice.filter(d=>SPECIAL.has(d.color))] : player.dice;
}
function resolve(room) {
  const plays=room.played;
  const syms=plays.filter(p=>SPECIAL.has(p.die.color)&&p.die.face==='symbol');
  if(syms.length){
    const types=[...new Set(syms.map(p=>p.die.color))];
    if(types.length===3)return syms.filter(p=>p.die.color==='brown').at(-1).player;
    if(types.length===1)return syms.at(-1).player;
    const beats={brown:'green',green:'blue',blue:'brown'};
    const winningType=types.find(a=>types.some(b=>beats[a]===b));
    return syms.filter(p=>p.die.color===winningType).at(-1).player;
  }
  const nums=plays.filter(p=>typeof p.die.face==='number');
  if(!nums.length)return plays.at(-1).player;
  return nums.reduce((a,b)=>b.die.face>=a.die.face?b:a).player;
}
function scoreRound(room){room.players.forEach(p=>{if(p.bid===p.tricks)p.score+=p.bid===0?room.round*10:p.tricks*20;});}
function cleanDisplayName(value){return String(value||'').replace(/[\u0000-\u001f\u007f]/g,'').trim().replace(/\s+/g,' ').slice(0,24)}
function removePlayer(room,targetId){
  const removedIndex=room.players.findIndex(p=>p.id===targetId);if(removedIndex<0)return null;
  const [removed]=room.players.splice(removedIndex,1);removed.ws&&send(removed.ws,'kicked',{message:'Vous avez été exclu de cette salle par l’hôte.'});
  room.played=room.played.filter(play=>play.player!==removedIndex).map(play=>({...play,player:play.player>removedIndex?play.player-1:play.player}));
  if(room.players.length<2&&room.status==='playing'){
    room.status='lobby';room.phase='lobby';room.round=1;room.trick=1;room.turn=0;room.leader=0;room.leadColor=null;room.played=[];
    room.players.forEach(p=>{p.score=0;p.bid=null;p.tricks=0;p.dice=[]});return removed;
  }
  if(!room.players.length){room.turn=0;room.leader=0;return removed}
  room.leader=room.leader===removedIndex?0:room.leader>removedIndex?room.leader-1:room.leader;
  room.turn=room.turn>removedIndex?room.turn-1:room.turn;room.turn%=room.players.length;
  if(room.phase==='bids'&&room.players.every(p=>Number.isInteger(p.bid))){room.phase='play';room.turn=room.leader}
  if(room.phase==='play'&&room.played.length===room.players.length){const winner=resolve(room);room.players[winner].tricks++;room.players[winner].totalTricks=(room.players[winner].totalTricks||0)+1;room.leader=winner;room.turn=winner;room.phase='result'}
  return removed;
}
function recordFinishedGame(room){
  if(room.resultRecorded)return;room.resultRecorded=true;const best=Math.max(...room.players.map(p=>p.score)),winners=room.players.filter(p=>p.score===best);
  const now=new Date().toISOString(),gameId=id();const rows=room.players.map(p=>({game_id:gameId,character:normalizeCharacter(p.character),result:winners.length>1&&p.score===best?'draw':p.score===best?'win':'loss',score:p.score,tricks:p.totalTricks||0,played_at:now}));saveResults(rows).catch(console.error);
}
function nextStep(room){
  if(room.players.every(p=>p.dice.length===0)){
    scoreRound(room);
    if(room.round===room.totalRounds){room.phase='over';room.status='finished';recordFinishedGame(room);}
    else{room.round++;deal(room);}
  }else{room.trick++;room.phase='play';room.played=[];room.leadColor=null;room.turn=room.leader;}
}
function handle(ws, msg){
  if(msg.type==='create'){
    const roomCode=code(), playerId=id();
    const room={code:roomCode,status:'lobby',hostId:playerId,revision:0,totalRounds:Math.max(1,Math.min(8,Number(msg.rounds)||8)),maxPlayers:Math.max(2,Math.min(6,Number(msg.maxPlayers)||6)),round:1,trick:1,phase:'lobby',leader:0,turn:0,leadColor:null,played:[],players:[],spectators:[],chat:[],resultRecorded:false};
    if(msg.organizer)room.spectators.push({id:playerId,name:cleanDisplayName(msg.name)||'Organisateur',ws});
    else {const character=normalizeCharacter(String(msg.character||'Personnage').slice(0,24));room.players.push({id:playerId,name:character,character,score:0,bid:null,tricks:0,dice:[],ws});}
    rooms.set(roomCode,room);ws.room=roomCode;ws.playerId=playerId;send(ws,'session',{code:roomCode,playerId});broadcast(room);notifyOpenChallenge(room,String(msg.pushEndpoint||'')).catch(error=>console.error('Alerte de défi impossible :',error.message));return;
  }
  if(msg.type==='join'){
    const room=rooms.get(String(msg.code||'').toUpperCase());if(!room)return fail(ws,'Salle introuvable.');
    let player=room.players.find(p=>p.id===msg.playerId), spectator=room.spectators.find(p=>p.id===msg.playerId);
    if(player){player.ws=ws;}
    else if(spectator){spectator.ws=ws;player=spectator;}
    else{
      if(msg.spectator){
        if(room.spectators.length>=20)return fail(ws,'Le nombre maximal de spectateurs est atteint.');
        const number=room.spectators.filter(s=>s.name.startsWith('Spectateur')).length+1;
        player={id:id(),name:cleanDisplayName(msg.name)||(number===1?'Spectateur':`Spectateur ${number}`),ws};room.spectators.push(player);
      }else{
        const character=normalizeCharacter(String(msg.character||'').slice(0,24));
        const reclaim=character&&room.players.find(p=>p.character===character&&!p.ws);
        if(reclaim){player=reclaim;player.ws=ws;}
        else{
        if(room.status!=='lobby')return fail(ws,'La partie a déjà commencé. Rejoignez-la comme spectateur.');
        if(room.players.length>=room.maxPlayers)return fail(ws,`Cette salle est complète (${room.maxPlayers} joueurs maximum).`);
        if(room.players.some(p=>p.character===character))return fail(ws,'Ce personnage est déjà pris. Choisissez-en un autre.');
        player={id:id(),name:character,character,score:0,bid:null,tricks:0,dice:[],ws};room.players.push(player);
        }
      }
    }
    ws.room=room.code;ws.playerId=player.id;send(ws,'session',{code:room.code,playerId:player.id});broadcast(room);return;
  }
  const room=rooms.get(ws.room), player=room?.players.find(p=>p.id===ws.playerId), spectator=room?.spectators.find(p=>p.id===ws.playerId), actor=player||spectator;if(!room||!actor)return fail(ws,'Vous devez rejoindre une salle.');
  if(msg.type==='chat'){
    const text=String(msg.text||'').trim().slice(0,300);if(!text)return;
    room.chat.push({id:id(),sender:actor.name,text,time:Date.now(),role:spectator?'spectator':'player'});if(room.chat.length>100)room.chat.shift();broadcast(room);return;
  }
  if(msg.type==='renameSpectator'){
    if(!spectator)return fail(ws,'Seul un spectateur peut utiliser ce nom.');
    const name=cleanDisplayName(msg.name);if(!name)return fail(ws,'Le nom du spectateur est vide.');
    spectator.name=name;broadcast(room);return;
  }
  if(msg.type==='settings'){
    if(actor.id!==room.hostId)return fail(ws,"Seul l'hôte peut modifier la salle.");
    if(room.status!=='lobby')return fail(ws,'Les réglages ne peuvent être modifiés que dans la salle d’attente.');
    const maxPlayers=Math.max(2,Math.min(6,Number(msg.maxPlayers)||room.maxPlayers));
    const totalRounds=Math.max(1,Math.min(8,Number(msg.rounds)||room.totalRounds));
    if(maxPlayers<room.players.length)return fail(ws,`Il y a déjà ${room.players.length} joueurs dans la salle.`);
    room.maxPlayers=maxPlayers;room.totalRounds=totalRounds;broadcast(room);return;
  }
  if(msg.type==='kick'){
    if(actor.id!==room.hostId)return fail(ws,"Seul l'hôte peut exclure un joueur.");
    if(msg.playerId===room.hostId)return fail(ws,"L'hôte ne peut pas s'exclure lui-même.");
    if(!removePlayer(room,String(msg.playerId||'')))return fail(ws,'Joueur introuvable.');
    broadcast(room);return;
  }
  if(msg.type==='leave'){
    if(actor.id===room.hostId){
      room.players=room.players.filter(p=>p.id!==actor.id);room.spectators=room.spectators.filter(p=>p.id!==actor.id);
      const successor=transferHost(room);
      if(successor)broadcast(room);
      else{members(room).forEach(m=>m.ws&&send(m.ws,'closed',{message:'La salle a été fermée par son créateur.'}));rooms.delete(room.code);deletePersistedRoom(room.code);broadcastLobbies();}
    }
    else{if(player)removePlayer(room,actor.id);else room.spectators=room.spectators.filter(p=>p.id!==actor.id);broadcast(room);}
    ws.room=null;ws.playerId=null;send(ws,'left');return;
  }
  if(msg.type==='start'){
    if(actor.id!==room.hostId)return fail(ws,"Seul l'hôte peut lancer la partie.");
    if(room.players.length<2)return fail(ws,'Il faut au moins deux joueurs.');
    if(room.players.length*room.totalRounds>36)return fail(ws,`Avec ${room.players.length} joueurs, choisissez au maximum ${Math.floor(36/room.players.length)} manches.`);
    room.status='playing';room.resultRecorded=false;room.players.forEach(p=>{p.score=0;p.totalTricks=0});room.round=1;room.leader=0;deal(room);broadcast(room);return;
  }
  if(msg.type==='reset'){
    if(actor.id!==room.hostId)return fail(ws,"Seul l'hôte peut recommencer la partie.");
    if(room.phase!=='over')return fail(ws,'Le retour au salon est disponible uniquement lorsque la partie est terminée.');
    room.status='lobby';room.phase='lobby';room.round=1;room.trick=1;room.turn=0;room.leader=0;room.leadColor=null;room.played=[];room.resultRecorded=false;
    room.players.forEach(p=>{p.score=0;p.bid=null;p.tricks=0;p.dice=[];});broadcast(room);return;
  }
  if(msg.type==='newRoom'){
    if(actor.id!==room.hostId)return fail(ws,"Seul l'hôte peut créer une nouvelle salle.");
    const organizer=!!spectator,roomCode=code(),playerId=id();actor.ws=null;broadcast(room);
    const fresh={code:roomCode,status:'lobby',hostId:playerId,revision:0,totalRounds:room.totalRounds,maxPlayers:room.maxPlayers,round:1,trick:1,phase:'lobby',leader:0,turn:0,leadColor:null,played:[],players:[],spectators:[],chat:[],resultRecorded:false};
    if(organizer)fresh.spectators.push({id:playerId,name:'Organisateur',ws});
    else fresh.players.push({id:playerId,name:actor.character,character:actor.character,score:0,bid:null,tricks:0,dice:[],ws});
    rooms.set(roomCode,fresh);ws.room=roomCode;ws.playerId=playerId;send(ws,'session',{code:roomCode,playerId});broadcast(fresh);return;
  }
  if(!player)return fail(ws,'Vous observez cette partie et ne pouvez pas jouer.');
  if(room.status!=='playing')return fail(ws,'La partie n’est pas en cours.');
  if(currentPlayer(room)?.id!==player.id)return fail(ws,"Ce n'est pas votre tour.");
  if(msg.type==='bid'&&room.phase==='bids'){
    const bid=Number(msg.bid);if(!Number.isInteger(bid)||bid<0||bid>room.round)return fail(ws,'Pari invalide.');
    player.bid=bid;
    if(room.turn<room.players.length-1)room.turn++;else{room.phase='play';room.turn=room.leader;}
    broadcast(room);return;
  }
  if(msg.type==='play'&&room.phase==='play'){
    const die=legalDice(room,player).find(d=>d.id===msg.dieId);if(!die)return fail(ws,'Ce dé ne peut pas être joué.');
    player.dice=player.dice.filter(d=>d.id!==die.id);
    if(!room.leadColor&&!SPECIAL.has(die.color))room.leadColor=die.color;
    room.played.push({player:room.turn,die});
    if(room.played.length===room.players.length){const winner=resolve(room);room.players[winner].tricks++;room.players[winner].totalTricks=(room.players[winner].totalTricks||0)+1;room.leader=winner;room.turn=winner;room.phase='result';}
    else room.turn=(room.turn+1)%room.players.length;
    broadcast(room);return;
  }
  if(msg.type==='next'&&room.phase==='result'){nextStep(room);broadcast(room);return;}
  fail(ws,'Action impossible.');
}
wss.on('connection',ws=>{ws.isAlive=true;send(ws,'lobbies',{lobbies:lobbySummaries(rooms)});ws.on('pong',()=>ws.isAlive=true);ws.on('message',raw=>{try{handle(ws,JSON.parse(raw));}catch(e){console.error(e);fail(ws,'Action invalide.');}});ws.on('close',()=>{const room=rooms.get(ws.room),p=room&&members(room).find(x=>x.id===ws.playerId);if(p&&p.ws===ws){p.ws=null;transferHost(room);broadcast(room);}else broadcastLobbies();});});
setInterval(()=>{wss.clients.forEach(ws=>{if(!ws.isAlive)return ws.terminate();ws.isAlive=false;ws.ping();});},25000).unref();
setInterval(()=>{for(const [roomCode,room] of rooms)if(members(room).every(p=>!p.ws)){rooms.delete(roomCode);deletePersistedRoom(roomCode)}},30*60*1000).unref();
if(require.main===module){
  restoreRooms().catch(error=>console.error('Restauration Supabase impossible :',error.message)).finally(()=>server.listen(PORT,()=>console.log(`Duel Urgensses écoute sur http://localhost:${PORT}`)));
}
module.exports={resolve,publicState,aggregateResults,removePlayer,transferHost,lobbySummaries};
