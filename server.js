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
// Faces exactes des dés physiques. Un dé reste secret et non lancé dans la
// main du joueur ; le serveur choisit une de ces six faces au moment du jeu.
const DIE_FACES = {
  violet:[1,1,2,2,3,3],
  yellow:[3,3,4,4,5,5],
  red:[5,5,6,6,7,7],
  gray:['flag','flag','flag',1,1,6],
  brown:['symbol','symbol','symbol','symbol','flag','flag'],
  green:['symbol','symbol','symbol','symbol','flag','flag'],
  blue:['symbol','symbol','symbol','symbol','flag','flag']
};
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
const hostTransferTimers = new Map();
const ROOM_EMPTY_GRACE_MS=60*60*1000;
const HOST_TRANSFER_GRACE_MS=30*1000;
const SPECTATOR_RECONNECT_GRACE_MS=10*60*1000;
const MAX_WS_PAYLOAD=32*1024;
const MAX_WS_BUFFER=512*1024;
const MAX_CHAT_LENGTH=1000;
let atomicPersistenceUnavailable=false;
const normalizeCharacter = name => name === 'Adéla' ? 'Adela' : name;
let pushConfigurationValid=false;
if(webPush&&SUPABASE_URL&&SUPABASE_KEY&&VAPID_PUBLIC_KEY&&VAPID_PRIVATE_KEY){try{webPush.setVapidDetails(VAPID_SUBJECT,VAPID_PUBLIC_KEY.trim(),VAPID_PRIVATE_KEY.trim());pushConfigurationValid=true}catch(error){console.error('Notifications désactivées : clés VAPID invalides.',error.message)}}
const pushEnabled = () => pushConfigurationValid;

const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8' };
const readLocalResults = () => { try { return JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8')); } catch { return []; } };
const writeLocalResults = rows => { fs.mkdirSync(path.dirname(LEADERBOARD_FILE), {recursive:true}); fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(rows.slice(-5000), null, 2)); };
async function readResults(){
  if(SUPABASE_URL&&SUPABASE_KEY){let response=await fetch(`${SUPABASE_URL}/rest/v1/duel_results?select=character,result,score,tricks,rounds,played_at&order=played_at.desc&limit=5000`,{headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`}});if(response.ok)return response.json();if(response.status===400){response=await fetch(`${SUPABASE_URL}/rest/v1/duel_results?select=character,result,score,tricks,played_at&order=played_at.desc&limit=5000`,{headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`}});if(response.ok)return response.json()}console.error('Lecture Supabase impossible :',response.status);}
  return readLocalResults();
}
async function saveResults(rows){
  if(SUPABASE_URL&&SUPABASE_KEY){let response=await fetch(`${SUPABASE_URL}/rest/v1/duel_results`,{method:'POST',headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(rows),signal:AbortSignal.timeout(5000)});if(response.ok)return;if(response.status===400){const legacyRows=rows.map(({rounds,...row})=>row);response=await fetch(`${SUPABASE_URL}/rest/v1/duel_results`,{method:'POST',headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(legacyRows),signal:AbortSignal.timeout(5000)});if(response.ok)return}throw new Error(`Écriture Supabase refusée (${response.status})`);}
  writeLocalResults([...readLocalResults(),...rows]);
}
const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
async function retry(operation,label,attempts=4){
  let lastError;
  for(let attempt=0;attempt<attempts;attempt++){
    try{return await operation()}catch(error){lastError=error;if(attempt<attempts-1)await wait(500*2**attempt)}
  }
  console.error(`${label} après ${attempts} tentatives :`,lastError?.message||lastError);throw lastError;
}
async function trackAnalytics(eventType,{visitorId='',roomCode='',playerCount=0,rounds=0}={}){
  if(!persistenceEnabled())return;
  const visitorHash=visitorId?crypto.createHash('sha256').update(`${SUPABASE_KEY}:${String(visitorId).slice(0,100)}`).digest('hex'):null;
  const response=await fetch(`${SUPABASE_URL}/rest/v1/duel_analytics_events`,{method:'POST',headers:supabaseHeaders({'Content-Type':'application/json',Prefer:'return=minimal'}),body:JSON.stringify({event_type:eventType,visitor_hash:visitorHash,room_code:String(roomCode||'').slice(0,12)||null,player_count:Number(playerCount)||0,rounds:Number(rounds)||0}),signal:AbortSignal.timeout(5000)});
  if(!response.ok)console.error('Statistique non enregistrée :',response.status);
}
const analyticsDay=value=>new Intl.DateTimeFormat('fr-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
async function analyticsSummary(days=35){
  const safeDays=Math.max(7,Math.min(90,Number(days)||35)),since=new Date(Date.now()-safeDays*86400000).toISOString();
  const response=await fetch(`${SUPABASE_URL}/rest/v1/duel_analytics_events?select=event_type,visitor_hash,room_code,player_count,rounds,created_at&created_at=gte.${encodeURIComponent(since)}&order=created_at.asc&limit=10000`,{headers:supabaseHeaders(),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error(`Lecture des statistiques impossible (${response.status})`);
  const events=await response.json(),daily=new Map(),periodVisitors=new Set();
  for(const event of events){const day=analyticsDay(event.created_at),row=daily.get(day)||{date:day,connections:0,uniqueVisitors:new Set(),roomsCreated:0,gamesStarted:0,gamesCompleted:0};if(event.event_type==='visit'){row.connections++;if(event.visitor_hash){row.uniqueVisitors.add(event.visitor_hash);periodVisitors.add(event.visitor_hash)}}if(event.event_type==='room_created')row.roomsCreated++;if(event.event_type==='game_started')row.gamesStarted++;if(event.event_type==='game_completed')row.gamesCompleted++;daily.set(day,row)}
  const rows=[...daily.values()].map(row=>({...row,uniqueVisitors:row.uniqueVisitors.size})),totals=rows.reduce((sum,row)=>({connections:sum.connections+row.connections,uniqueVisitors:periodVisitors.size,roomsCreated:sum.roomsCreated+row.roomsCreated,gamesStarted:sum.gamesStarted+row.gamesStarted,gamesCompleted:sum.gamesCompleted+row.gamesCompleted}),{connections:0,uniqueVisitors:0,roomsCreated:0,gamesStarted:0,gamesCompleted:0});
  const today=analyticsDay(Date.now()),todayStats=rows.find(row=>row.date===today)||{date:today,connections:0,uniqueVisitors:0,roomsCreated:0,gamesStarted:0,gamesCompleted:0};
  return {generatedAt:new Date().toISOString(),days:safeDays,today:todayStats,totals,daily:rows,live:{rooms:rooms.size,players:[...rooms.values()].reduce((n,r)=>n+r.players.filter(p=>p.ws).length,0),spectators:[...rooms.values()].reduce((n,r)=>n+r.spectators.filter(p=>p.ws).length,0)}};
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
async function notifyHostOfJoin(room,joiningPlayer){
  if(!pushEnabled()||!room.joinAlertsEnabled||!room.hostPushEndpoint)return;
  const host=members(room).find(member=>member.id===room.hostId);
  if(host?.ws&&host.visible!==false)return;
  const response=await fetch(`${SUPABASE_URL}/rest/v1/duel_push_subscriptions?endpoint=eq.${encodeURIComponent(room.hostPushEndpoint)}&select=endpoint,subscription`,{headers:supabaseHeaders(),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error(`Lecture de l’abonnement hôte impossible (${response.status})`);
  const row=(await response.json())[0];if(!row)return;
  const payload=JSON.stringify({title:'👋 Un joueur a rejoint votre salle',body:`${joiningPlayer.name} est arrivé · ${room.players.length}/${room.maxPlayers} joueurs`,url:`/?join=${room.code}`,tag:`duel-arrival-${room.code}`});
  try{await webPush.sendNotification(row.subscription,payload,{TTL:600,urgency:'high'});}catch(error){if(error.statusCode===404||error.statusCode===410)await deletePushSubscription(row.endpoint);else throw error}
}
const roomSnapshot = room => ({
  code:room.code,status:room.status,hostId:room.hostId,totalRounds:room.totalRounds,maxPlayers:room.maxPlayers,
  revision:Number(room.revision)||0,chronicleSeed:room.chronicleSeed||'',
  round:room.round,trick:room.trick,phase:room.phase,leader:room.leader,turn:room.turn,
  leadColor:room.leadColor,played:room.played,message:room.message||'',chat:room.chat,
  resultRecorded:room.resultRecorded,
  joinAlertsEnabled:Boolean(room.joinAlertsEnabled),hostPushEndpoint:room.hostPushEndpoint||'',
  players:room.players.map(({ws,...player})=>player),
  spectators:room.spectators.map(({ws,...spectator})=>spectator)
});
async function persistRoom(snapshot){
  if(!persistenceEnabled())return;
  if(!atomicPersistenceUnavailable){
    const atomic=await fetch(`${SUPABASE_URL}/rest/v1/rpc/duel_save_active_game`,{method:'POST',headers:supabaseHeaders({'Content-Type':'application/json'}),body:JSON.stringify({p_code:snapshot.code,p_state:snapshot,p_revision:snapshot.revision}),signal:AbortSignal.timeout(5000)});
    if(atomic.ok)return;
    if(atomic.status!==404&&atomic.status!==400)throw new Error(`Sauvegarde atomique refusée (${atomic.status}) ${await atomic.text()}`);
    atomicPersistenceUnavailable=true;console.warn('Fonction Supabase duel_save_active_game absente : sauvegarde de compatibilité utilisée.');
  }
  const current=await fetch(`${SUPABASE_URL}/rest/v1/duel_active_games?code=eq.${encodeURIComponent(snapshot.code)}&select=state`,{headers:supabaseHeaders(),signal:AbortSignal.timeout(5000)});
  if(current.ok){const rows=await current.json(),revision=Number(rows[0]?.state?.revision)||0;if(revision>snapshot.revision)return}
  const response=await fetch(`${SUPABASE_URL}/rest/v1/duel_active_games?on_conflict=code`,{method:'POST',headers:supabaseHeaders({'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'}),body:JSON.stringify({code:snapshot.code,state:snapshot,updated_at:new Date().toISOString()}),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error(`Sauvegarde de la partie refusée (${response.status}) ${await response.text()}`);
}
function queuePersist(room){
  if(!persistenceEnabled())return;
  const snapshot=roomSnapshot(room);clearTimeout(persistenceTimers.get(room.code));
  persistenceTimers.set(room.code,setTimeout(()=>{
    persistenceTimers.delete(room.code);const previous=persistenceChains.get(room.code)||Promise.resolve();
    const next=previous.catch(()=>{}).then(()=>retry(()=>persistRoom(snapshot),`Sauvegarde Supabase ${snapshot.code}`)).catch(()=>{});
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
  for(const row of rows){const saved=row.state;if(!saved||saved.code!==row.code||!Array.isArray(saved.players)||!Array.isArray(saved.spectators))continue;saved.revision=Math.max(0,Number(saved.revision)||0);saved.chronicleSeed=String(saved.chronicleSeed||crypto.randomUUID());saved.maxPlayers=Math.max(2,Math.min(6,Number(saved.maxPlayers)||6));saved.emptySince=Date.now();saved.joinAlertsEnabled=Boolean(saved.joinAlertsEnabled);saved.hostPushEndpoint=String(saved.hostPushEndpoint||'');saved.players=saved.players.map(player=>({...player,resumeToken:player.resumeToken||null,disconnectedAt:Date.now(),exactRounds:Number(player.exactRounds)||0,zeroSuccesses:Number(player.zeroSuccesses)||0,missedRounds:Number(player.missedRounds)||0,totalBid:Number(player.totalBid)||0,boldestBid:Number(player.boldestBid)||0,roundHistory:Array.isArray(player.roundHistory)?player.roundHistory:[],dice:Array.isArray(player.dice)?player.dice.map(die=>({...die,faces:facesFor(die.color),face:null})):[],visible:false,ws:null}));saved.spectators=saved.spectators.map(spectator=>({...spectator,resumeToken:spectator.resumeToken||null,disconnectedAt:Date.now(),visible:false,ws:null}));saved.chat=Array.isArray(saved.chat)?saved.chat:[];saved.played=Array.isArray(saved.played)?saved.played.map(play=>({...play,die:{...play.die,faces:facesFor(play.die.color)}})):[];rooms.set(saved.code,saved)}
  if(rows.length)console.log(`${rooms.size} partie(s) restaurée(s) depuis Supabase.`);
}
const aggregateResults = rows => {
  const aggregated=[...rows.reduce((map,row)=>{const character=normalizeCharacter(row.character),value=map.get(character)||{character,games:0,wins:0,losses:0,draws:0,points:0,tricks:0,rounds:0};value.games++;value[row.result==='win'?'wins':row.result==='draw'?'draws':'losses']++;value.points+=Number(row.score)||0;value.tricks+=Number(row.tricks)||0;value.rounds+=Math.max(1,Math.min(8,Number(row.rounds)||8));map.set(character,value);return map;},new Map()).values()];
  const totalPoints=aggregated.reduce((sum,row)=>sum+row.points,0),totalRounds=aggregated.reduce((sum,row)=>sum+row.rounds,0),leagueRate=totalRounds?totalPoints/totalRounds:0,priorRounds=20;
  return aggregated.map(row=>({...row,winRate:Math.round(row.wins/row.games*100),pointsPerRound:Number((row.points/row.rounds).toFixed(1)),performance:Number(((row.points+leagueRate*priorRounds)/(row.rounds+priorRounds)).toFixed(1))})).sort((a,b)=>b.points-a.points||b.wins-a.wins||b.winRate-a.winRate||a.character.localeCompare(b.character,'fr'));
};
const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if(urlPath==='/api/push/public-key') { res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify({enabled:pushEnabled(),publicKey:pushEnabled()?VAPID_PUBLIC_KEY:''})); }
  if(urlPath==='/api/push/subscribe'&&req.method==='POST') { try{const body=await readJsonBody(req),saved=await savePushSubscription(body.subscription,req.headers['user-agent']);res.writeHead(saved?204:503);return res.end();}catch(error){console.error(error);res.writeHead(400);return res.end('Abonnement invalide');} }
  if(urlPath==='/api/push/subscribe'&&req.method==='DELETE') { try{const body=await readJsonBody(req);await deletePushSubscription(body.endpoint);res.writeHead(204);return res.end();}catch(error){console.error(error);res.writeHead(400);return res.end('Désabonnement invalide');} }
  if(urlPath==='/api/leaderboard') { try { const rows=aggregateResults(await readResults());res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify(rows)); } catch(error){console.error(error);res.writeHead(500);return res.end('Classement indisponible');} }
  if(urlPath==='/api/analytics/visit'&&req.method==='POST'){try{const body=await readJsonBody(req,1000);trackAnalytics('visit',{visitorId:body.visitorId}).catch(error=>console.error('Visite non comptée :',error.message));res.writeHead(204);return res.end()}catch{res.writeHead(400);return res.end('Identifiant invalide')}}
  if(urlPath==='/api/admin/stats'){try{if(!persistenceEnabled())throw new Error('Supabase non configuré');const data=await analyticsSummary(new URL(req.url,'http://localhost').searchParams.get('days'));res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify(data))}catch(error){console.error(error);res.writeHead(503);return res.end('Statistiques indisponibles')}}
  const relative = urlPath === '/' ? 'index.html' : urlPath === '/admin-stats' ? 'admin-stats.html' : urlPath.replace(/^\/+/, '');
  const file = path.resolve(ROOT, relative);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('Introuvable');
  }
  const stat=fs.statSync(file),extension=path.extname(file).toLowerCase();
  const etag=`W/\"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}\"`;
  const modified=stat.mtime.toUTCString();
  const versioned=new URL(req.url,'http://localhost').searchParams.has('v');
  const isDocument=extension==='.html'||extension==='.webmanifest';
  const cacheControl=isDocument
    ? 'no-cache, max-age=0, must-revalidate'
    : versioned
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=0, must-revalidate';
  const headers={'Content-Type':mime[extension]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':cacheControl,'ETag':etag,'Last-Modified':modified};
  const notModified=req.headers['if-none-match']===etag||(!req.headers['if-none-match']&&req.headers['if-modified-since']===modified);
  if(notModified){delete headers['Content-Length'];res.writeHead(304,headers);return res.end()}
  res.writeHead(200,headers);
  if(req.method==='HEAD')return res.end();
  fs.createReadStream(file).pipe(res);
});
const wss = new WebSocketServer({server,maxPayload:MAX_WS_PAYLOAD});

const id = () => crypto.randomBytes(8).toString('hex');
const code = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value;
  do { value = Array.from({length:5}, () => alphabet[crypto.randomInt(alphabet.length)]).join(''); } while (rooms.has(value));
  return value;
};
const send = (ws, type, payload={}) => {
  if(ws.readyState!==WebSocket.OPEN)return false;
  if(ws.bufferedAmount>MAX_WS_BUFFER){try{ws.terminate()}catch{}return false}
  ws.send(JSON.stringify({type,...payload}));return true;
};
const shuffle = array => {
  const result = [...array];
  for (let i=result.length-1;i>0;i--) { const j=crypto.randomInt(i+1); [result[i],result[j]]=[result[j],result[i]]; }
  return result;
};
const facesFor = color => [...(DIE_FACES[color]||[])];
const makePool = () => shuffle(Object.entries(COUNTS).flatMap(([color,n]) => Array.from({length:n},()=>({id:id(),color,faces:facesFor(color),face:null}))));
const roll = die => {
  const faces=Array.isArray(die.faces)&&die.faces.length===6?die.faces:facesFor(die.color);
  die.faces=facesFor(die.color);
  die.face=faces[crypto.randomInt(faces.length)];
  return die;
};
const publicState = (room, viewerId) => ({
  code: room.code, status: room.status, hostId: room.hostId, revision:Number(room.revision)||0,chronicleSeed:room.chronicleSeed||'',totalRounds: room.totalRounds,maxPlayers:room.maxPlayers,
  round: room.round, trick: room.trick, phase: room.phase, leader: room.leader,
  turn: room.turn, leadColor: room.leadColor, played: room.played,
  message: room.message || '', viewerId,
  joinAlertsEnabled:Boolean(room.joinAlertsEnabled),
  viewerRole: room.spectators.some(s=>s.id===viewerId) ? 'spectator' : 'player',
  spectators: room.spectators.map(s=>({id:s.id,name:s.name,connected:!!s.ws})),
  chat: room.chat,
  players: room.players.map(p => ({
    id:p.id,name:p.name,character:p.character,score:p.score,
    // Pendant les paris, chacun ne voit que son propre choix. Les paris sont
    // révélés simultanément lorsque le dernier joueur a choisi.
    bid:room.phase==='bids'&&p.id!==viewerId?null:p.bid,
    tricks:p.tricks,totalTricks:p.totalTricks||0,exactRounds:p.exactRounds||0,
    zeroSuccesses:p.zeroSuccesses||0,missedRounds:p.missedRounds||0,
    totalBid:p.totalBid||0,boldestBid:p.boldestBid||0,roundHistory:Array.isArray(p.roundHistory)?p.roundHistory:[],connected:!!p.ws,
    dice:p.id===viewerId?p.dice:p.dice.map(()=>({hidden:true}))
  }))
});
const members = room => [...room.players,...room.spectators];
const lobbySummaries = source => [...source.values()].filter(room=>room.status==='lobby'&&room.phase==='lobby'&&members(room).some(member=>member.ws)&&room.players.length<room.maxPlayers).map(room=>{
  const host=members(room).find(member=>member.id===room.hostId);
  return {code:room.code,host:host?.name||'Hôte',players:room.players.length,maxPlayers:room.maxPlayers,rounds:room.totalRounds};
});
const activeGameSummaries = source => [...source.values()].filter(room=>room.status==='playing'&&room.phase!=='over'&&members(room).some(member=>member.ws)).map(room=>{
  const host=members(room).find(member=>member.id===room.hostId);
  return {code:room.code,host:host?.name||'Hôte',players:room.players.length,maxPlayers:room.maxPlayers,round:room.round,totalRounds:room.totalRounds,spectators:room.spectators.filter(spectator=>spectator.ws).length};
}).sort((a,b)=>a.host.localeCompare(b.host,'fr'));
const broadcastLobbies = () => {const lobbies=lobbySummaries(rooms),activeGames=activeGameSummaries(rooms);wss.clients.forEach(client=>send(client,'lobbies',{lobbies,activeGames}))};
function transferHost(room,{force=false}={}){
  if(room.status==='playing'&&!force)return null;
  const current=members(room).find(member=>member.id===room.hostId);
  if(current?.ws)return current;
  const successor=room.players.find(player=>player.ws)||room.spectators.find(spectator=>spectator.ws)||null;
  if(successor){room.hostId=successor.id;room.hostPushEndpoint=successor.pushEndpoint||'';room.joinAlertsEnabled=Boolean(room.joinAlertsEnabled&&room.hostPushEndpoint)}
  return successor;
}
const sendState=(room,member)=>member?.ws&&send(member.ws,'state',{state:publicState(room,member.id)});
const refreshPresence=room=>{const empty=members(room).every(member=>!member.ws);room.emptySince=empty?(room.emptySince||Date.now()):null};
const broadcast = (room,{lists=false,persist=true}={}) => {
  room.revision=(Number(room.revision)||0)+1;refreshPresence(room);
  members(room).forEach(member=>sendState(room,member));if(persist)queuePersist(room);if(lists)broadcastLobbies();
};
function scheduleHostTransfer(room){
  clearTimeout(hostTransferTimers.get(room.code));
  if(members(room).find(member=>member.id===room.hostId)?.ws)return;
  const timer=setTimeout(()=>{hostTransferTimers.delete(room.code);if(!rooms.has(room.code))return;const successor=transferHost(room,{force:true});if(successor)broadcast(room,{lists:true})},HOST_TRANSFER_GRACE_MS);
  hostTransferTimers.set(room.code,timer);
}
const fail = (ws, message) => send(ws,'error',{message});
const currentPlayer = room => room.players[room.turn];
const nextClockwise = (room, from=room.turn) => room.players.length ? (from+1)%room.players.length : 0;
function nextClockwiseUnbid(room,from=room.turn){
  let candidate=from;
  for(let step=0;step<room.players.length;step++){
    candidate=nextClockwise(room,candidate);
    if(!Number.isInteger(room.players[candidate]?.bid))return candidate;
  }
  return from;
}

function deal(room) {
  const pool=makePool();
  room.players.forEach(p=>{p.dice=pool.splice(0,room.round);p.bid=null;p.tricks=0;});
  room.phase='bids';room.turn=room.leader;room.trick=1;room.played=[];room.leadColor=null;room.message='';
}
function startMatch(room){
  room.status='playing';room.resultRecorded=false;room.chronicleSeed=crypto.randomUUID();
  room.players.forEach(p=>{p.score=0;p.totalTricks=0;p.exactRounds=0;p.zeroSuccesses=0;p.missedRounds=0;p.totalBid=0;p.boldestBid=0;p.roundHistory=[]});
  room.round=1;room.leader=0;deal(room);
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
function scoreRound(room){room.players.forEach(p=>{const bid=Number(p.bid),tricks=Number(p.tricks),round=Math.max(1,Number(room.round)||1),scoreBefore=Number(p.score)||0,exact=Number.isInteger(bid)&&Number.isInteger(tricks)&&bid===tricks;p.score=scoreBefore;p.totalBid=(Number(p.totalBid)||0)+(Number.isInteger(bid)?bid:0);p.boldestBid=Math.max(Number(p.boldestBid)||0,Number.isInteger(bid)?bid:0);if(exact){p.exactRounds=(Number(p.exactRounds)||0)+1;if(bid===0)p.zeroSuccesses=(Number(p.zeroSuccesses)||0)+1;p.score+=bid===0?round*10:tricks*20}else p.missedRounds=(Number(p.missedRounds)||0)+1;(p.roundHistory||(p.roundHistory=[])).push({round,bid:Number.isInteger(bid)?bid:null,tricks:Number.isInteger(tricks)?tricks:0,exact,scoreBefore,points:p.score-scoreBefore,scoreAfter:p.score});});}
function cleanDisplayName(value){return String(value||'').replace(/[\u0000-\u001f\u007f]/g,'').trim().replace(/\s+/g,' ').slice(0,24)}
function removePlayer(room,targetId,{notify=true}={}){
  const removedIndex=room.players.findIndex(p=>p.id===targetId);if(removedIndex<0)return null;
  const [removed]=room.players.splice(removedIndex,1);if(notify&&removed.ws)send(removed.ws,'kicked',{message:'Vous avez été exclu de cette salle par l’hôte.'});
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
  const now=new Date().toISOString(),gameId=id();const rows=room.players.map(p=>({game_id:gameId,character:normalizeCharacter(p.character),result:winners.length>1&&p.score===best?'draw':p.score===best?'win':'loss',score:p.score,tricks:p.totalTricks||0,rounds:room.totalRounds,played_at:now}));retry(()=>saveResults(rows),`Enregistrement du résultat ${gameId}`).catch(()=>{});
  trackAnalytics('game_completed',{roomCode:room.code,playerCount:room.players.length,rounds:room.totalRounds}).catch(error=>console.error('Fin de partie non comptée :',error.message));
}
function nextStep(room){
  if(room.players.every(p=>p.dice.length===0)){
    scoreRound(room);
    if(room.round===room.totalRounds){room.phase='over';room.status='finished';recordFinishedGame(room);}
    else{room.round++;deal(room);}
  }else{room.trick++;room.phase='play';room.played=[];room.leadColor=null;room.turn=room.leader;}
}
function replaceSocket(member,ws){
  const previous=member.ws;
  if(previous&&previous!==ws){
    previous.room=null;previous.playerId=null;
    try{previous.close(4001,'Connexion remplacée');}catch{}
  }
  member.ws=ws;member.disconnectedAt=null;
}
const makeMemberSession=member=>({playerId:member.id,resumeToken:member.resumeToken||(member.resumeToken=id())});
const sendSession=(ws,room,member)=>send(ws,'session',{code:room.code,...makeMemberSession(member)});
function detachMember(room,actor,{notify=false}={}){
  if(!actor)return;
  if(room.players.some(player=>player.id===actor.id))removePlayer(room,actor.id,{notify:false});
  else room.spectators=room.spectators.filter(spectator=>spectator.id!==actor.id);
  if(notify&&actor.ws)send(actor.ws,'left');
}
function handle(ws, msg){
  if(msg.type==='create'){
    const roomCode=code(), playerId=id();
    const room={code:roomCode,status:'lobby',hostId:playerId,revision:0,emptySince:null,totalRounds:Math.max(1,Math.min(8,Number(msg.rounds)||8)),maxPlayers:Math.max(2,Math.min(6,Number(msg.maxPlayers)||6)),round:1,trick:1,phase:'lobby',leader:0,turn:0,leadColor:null,played:[],players:[],spectators:[],chat:[],resultRecorded:false,joinAlertsEnabled:false,hostPushEndpoint:String(msg.pushEndpoint||'')};
    if(msg.organizer)room.spectators.push({id:playerId,resumeToken:id(),name:cleanDisplayName(msg.name)||'Organisateur',pushEndpoint:String(msg.pushEndpoint||''),visible:true,disconnectedAt:null,ws});
    else {const character=normalizeCharacter(String(msg.character||'Personnage').slice(0,24));room.players.push({id:playerId,resumeToken:id(),name:character,character,pushEndpoint:String(msg.pushEndpoint||''),visible:true,score:0,bid:null,tricks:0,dice:[],disconnectedAt:null,ws});}
    const actor=members(room)[0];rooms.set(roomCode,room);ws.room=roomCode;ws.playerId=playerId;sendSession(ws,room,actor);broadcast(room,{lists:true});trackAnalytics('room_created',{roomCode,playerCount:room.players.length,rounds:room.totalRounds}).catch(error=>console.error('Salle non comptée :',error.message));notifyOpenChallenge(room,String(msg.pushEndpoint||'')).catch(error=>console.error('Alerte de défi impossible :',error.message));return;
  }
  if(msg.type==='join'){
    const room=rooms.get(String(msg.code||'').toUpperCase());if(!room)return send(ws,'joinUnavailable',{message:'Ce défi n’existe plus.',canSpectate:false});
    let player=room.players.find(p=>p.id===msg.playerId), spectator=room.spectators.find(p=>p.id===msg.playerId);
    const sameConnection=(player?.ws===ws||spectator?.ws===ws);
    const resumeAllowed=member=>member&&(member.resumeToken?member.resumeToken===String(msg.resumeToken||''):!member.ws);
    if(player&&resumeAllowed(player)){replaceSocket(player,ws);}
    else if(spectator&&resumeAllowed(spectator)){replaceSocket(spectator,ws);player=spectator;}
    else if(player||spectator){return fail(ws,'Cette session est déjà utilisée ou son accès a expiré.');}
    else{
      if(msg.spectator){
        if(room.spectators.filter(item=>item.ws||Date.now()-(item.disconnectedAt||0)<SPECTATOR_RECONNECT_GRACE_MS).length>=20)return fail(ws,'Le nombre maximal de spectateurs est atteint.');
        const number=room.spectators.filter(s=>s.name.startsWith('Spectateur')).length+1;
        player={id:id(),resumeToken:id(),name:cleanDisplayName(msg.name)||(number===1?'Spectateur':`Spectateur ${number}`),pushEndpoint:String(msg.pushEndpoint||''),visible:true,disconnectedAt:null,ws};room.spectators.push(player);
      }else{
        const character=normalizeCharacter(String(msg.character||'').slice(0,24));
        const reclaim=character&&room.players.find(p=>p.character===character&&!p.ws&&!p.resumeToken);
        if(reclaim){player=reclaim;replaceSocket(player,ws);}
        else{
        if(room.status!=='lobby'||room.phase!=='lobby')return send(ws,'joinUnavailable',{message:'La partie a déjà commencé.',canSpectate:true});
        if(room.players.length>=room.maxPlayers)return send(ws,'joinUnavailable',{message:`Cette salle est complète (${room.maxPlayers} joueurs maximum).`,canSpectate:true});
        if(room.players.some(p=>p.character===character))return fail(ws,'Ce personnage est déjà pris. Choisissez-en un autre.');
        player={id:id(),resumeToken:id(),name:character,character,pushEndpoint:String(msg.pushEndpoint||''),visible:true,score:0,bid:null,tricks:0,dice:[],disconnectedAt:null,ws};room.players.push(player);
        notifyHostOfJoin(room,player).catch(error=>console.error('Alerte d’arrivée impossible :',error.message));
        }
      }
    }
    if(player.id===room.hostId){clearTimeout(hostTransferTimers.get(room.code));hostTransferTimers.delete(room.code)}ws.room=room.code;ws.playerId=player.id;sendSession(ws,room,player);
    if(sameConnection){sendState(room,player);return}
    broadcast(room,{lists:true});if(!members(room).find(member=>member.id===room.hostId)?.ws)scheduleHostTransfer(room);return;
  }
  const room=rooms.get(ws.room), player=room?.players.find(p=>p.id===ws.playerId), spectator=room?.spectators.find(p=>p.id===ws.playerId), actor=player||spectator;if(!room||!actor)return fail(ws,'Vous devez rejoindre une salle.');
  if(msg.type==='visibility'){actor.visible=Boolean(msg.visible);return}
  if(msg.type==='joinAlerts'){
    if(actor.id!==room.hostId)return fail(ws,"Seul l'hôte peut programmer ces alertes.");
    if(msg.enabled&&!String(msg.pushEndpoint||actor.pushEndpoint||room.hostPushEndpoint))return fail(ws,'Activez d’abord les alertes sur cet appareil.');
    actor.pushEndpoint=String(msg.pushEndpoint||actor.pushEndpoint||'');room.hostPushEndpoint=actor.pushEndpoint;room.joinAlertsEnabled=Boolean(msg.enabled&&room.hostPushEndpoint);broadcast(room);return;
  }
  if(msg.type==='chat'){
    const text=String(msg.text||'').trim();if(!text)return send(ws,'chatRejected',{actionId:msg.actionId,message:'Le message est vide.'});if(text.length>MAX_CHAT_LENGTH)return send(ws,'chatRejected',{actionId:msg.actionId,message:`Le message dépasse ${MAX_CHAT_LENGTH} caractères.`});
    const entry={id:id(),sender:actor.name,text,time:Date.now(),role:spectator?'spectator':'player',clientActionId:String(msg.actionId||'').slice(0,120)};room.chat.push(entry);if(room.chat.length>100)room.chat.shift();room.revision=(Number(room.revision)||0)+1;
    members(room).forEach(member=>member.ws&&send(member.ws,'chat',{entry,revision:room.revision}));send(ws,'chatAccepted',{actionId:msg.actionId,entryId:entry.id});queuePersist(room);return;
  }
  if(msg.type==='renameSpectator'){
    if(!spectator)return fail(ws,'Seul un spectateur peut utiliser ce nom.');
    const name=cleanDisplayName(msg.name);if(!name)return fail(ws,'Le nom du spectateur est vide.');
    spectator.name=name;broadcast(room,{lists:true});return;
  }
  if(msg.type==='settings'){
    if(actor.id!==room.hostId)return fail(ws,"Seul l'hôte peut modifier la salle.");
    if(room.status!=='lobby')return fail(ws,'Les réglages ne peuvent être modifiés que dans la salle d’attente.');
    const maxPlayers=Math.max(2,Math.min(6,Number(msg.maxPlayers)||room.maxPlayers));
    const totalRounds=Math.max(1,Math.min(8,Number(msg.rounds)||room.totalRounds));
    if(maxPlayers<room.players.length)return fail(ws,`Il y a déjà ${room.players.length} joueurs dans la salle.`);
    room.maxPlayers=maxPlayers;room.totalRounds=totalRounds;broadcast(room,{lists:true});return;
  }
  if(msg.type==='kick'){
    if(actor.id!==room.hostId)return fail(ws,"Seul l'hôte peut exclure un joueur.");
    if(msg.playerId===room.hostId)return fail(ws,"L'hôte ne peut pas s'exclure lui-même.");
    if(!removePlayer(room,String(msg.playerId||'')))return fail(ws,'Joueur introuvable.');
    broadcast(room,{lists:true});return;
  }
  if(msg.type==='leave'){
    if(actor.id===room.hostId){
      clearTimeout(hostTransferTimers.get(room.code));hostTransferTimers.delete(room.code);
      detachMember(room,actor);
      const successor=transferHost(room,{force:true});
      if(successor)broadcast(room,{lists:true});
      else{members(room).forEach(m=>m.ws&&send(m.ws,'closed',{message:'La salle a été fermée par son créateur.'}));rooms.delete(room.code);deletePersistedRoom(room.code);broadcastLobbies();}
    }
    else{if(player)removePlayer(room,actor.id,{notify:false});else room.spectators=room.spectators.filter(p=>p.id!==actor.id);broadcast(room,{lists:true});}
    ws.room=null;ws.playerId=null;send(ws,'left');return;
  }
  if(msg.type==='start'){
    if(actor.id!==room.hostId)return fail(ws,"Seul l'hôte peut lancer la partie.");
    if(room.players.length<2)return fail(ws,'Il faut au moins deux joueurs.');
    if(room.players.length*room.totalRounds>36)return fail(ws,`Avec ${room.players.length} joueurs, choisissez au maximum ${Math.floor(36/room.players.length)} manches.`);
    startMatch(room);broadcast(room,{lists:true});trackAnalytics('game_started',{roomCode:room.code,playerCount:room.players.length,rounds:room.totalRounds}).catch(error=>console.error('Départ non compté :',error.message));return;
  }
  if(msg.type==='rematch'){
    if(actor.id!==room.hostId)return fail(ws,"Seul l'hôte peut lancer la revanche.");
    if(room.phase!=='over')return fail(ws,'La revanche est disponible uniquement à la fin de la partie.');
    if(room.players.length<2||room.players.some(p=>!p.ws))return fail(ws,'Tous les joueurs doivent être reconnectés pour lancer la revanche.');
    startMatch(room);broadcast(room,{lists:true});trackAnalytics('game_started',{roomCode:room.code,playerCount:room.players.length,rounds:room.totalRounds,rematch:true}).catch(error=>console.error('Revanche non comptée :',error.message));return;
  }
  if(msg.type==='reset'){
    if(actor.id!==room.hostId)return fail(ws,"Seul l'hôte peut recommencer la partie.");
    if(room.phase!=='over')return fail(ws,'Le retour au salon est disponible uniquement lorsque la partie est terminée.');
    room.status='lobby';room.phase='lobby';room.round=1;room.trick=1;room.turn=0;room.leader=0;room.leadColor=null;room.played=[];room.resultRecorded=false;
    room.players.forEach(p=>{p.score=0;p.bid=null;p.tricks=0;p.dice=[];});broadcast(room,{lists:true});return;
  }
  if(msg.type==='newRoom'){
    if(actor.id!==room.hostId)return fail(ws,"Seul l'hôte peut créer une nouvelle salle.");
    clearTimeout(hostTransferTimers.get(room.code));hostTransferTimers.delete(room.code);
    const organizer=!!spectator,roomCode=code(),playerId=id(),rounds=room.totalRounds,maxPlayers=room.maxPlayers,character=actor.character;detachMember(room,actor);const successor=transferHost(room,{force:true});if(successor)broadcast(room,{lists:true});else{rooms.delete(room.code);deletePersistedRoom(room.code)}
    const fresh={code:roomCode,status:'lobby',hostId:playerId,revision:0,emptySince:null,totalRounds:rounds,maxPlayers,round:1,trick:1,phase:'lobby',leader:0,turn:0,leadColor:null,played:[],players:[],spectators:[],chat:[],resultRecorded:false,joinAlertsEnabled:false,hostPushEndpoint:actor.pushEndpoint||''};
    if(organizer)fresh.spectators.push({id:playerId,resumeToken:id(),name:'Organisateur',pushEndpoint:actor.pushEndpoint||'',visible:true,disconnectedAt:null,ws});
    else fresh.players.push({id:playerId,resumeToken:id(),name:character,character,pushEndpoint:actor.pushEndpoint||'',visible:true,score:0,bid:null,tricks:0,dice:[],disconnectedAt:null,ws});
    const freshActor=members(fresh)[0];rooms.set(roomCode,fresh);ws.room=roomCode;ws.playerId=playerId;sendSession(ws,fresh,freshActor);broadcast(fresh,{lists:true});trackAnalytics('room_created',{roomCode,playerCount:fresh.players.length,rounds:fresh.totalRounds}).catch(error=>console.error('Salle non comptée :',error.message));return;
  }
  if(!player)return fail(ws,'Vous observez cette partie et ne pouvez pas jouer.');
  if(room.status!=='playing')return fail(ws,'La partie n’est pas en cours.');
  if(currentPlayer(room)?.id!==player.id)return fail(ws,"Ce n'est pas votre tour.");
  if(msg.type==='bid'&&room.phase==='bids'){
    const bid=Number(msg.bid);if(!Number.isInteger(bid)||bid<0||bid>room.round)return fail(ws,'Pari invalide.');
    player.bid=bid;
    if(room.players.every(candidate=>Number.isInteger(candidate.bid))){room.phase='play';room.turn=room.leader;}
    else room.turn=nextClockwiseUnbid(room,room.turn);
    broadcast(room);return;
  }
  if(msg.type==='play'&&room.phase==='play'){
    const die=legalDice(room,player).find(d=>d.id===msg.dieId);if(!die)return fail(ws,'Ce dé ne peut pas être joué.');
    roll(die);
    player.dice=player.dice.filter(d=>d.id!==die.id);
    if(!room.leadColor&&!SPECIAL.has(die.color))room.leadColor=die.color;
    room.played.push({player:room.turn,die});
    if(room.played.length===room.players.length){const winner=resolve(room);room.players[winner].tricks++;room.players[winner].totalTricks=(room.players[winner].totalTricks||0)+1;room.leader=winner;room.turn=winner;room.phase='result';}
    else room.turn=nextClockwise(room,room.turn);
    broadcast(room);return;
  }
  if(msg.type==='next'&&room.phase==='result'){nextStep(room);broadcast(room,{lists:room.phase==='over'});return;}
  fail(ws,'Action impossible.');
}
const VALID_MESSAGE_TYPES=new Set(['create','join','visibility','joinAlerts','chat','renameSpectator','settings','kick','leave','start','rematch','reset','newRoom','bid','play','next']);
const validMessage=message=>message&&typeof message==='object'&&!Array.isArray(message)&&VALID_MESSAGE_TYPES.has(message.type);
wss.on('connection',ws=>{
  ws.isAlive=true;ws.seenActions=new Set();ws.rateWindow=Date.now();ws.rateCount=0;ws.lastChatAt=0;
  send(ws,'lobbies',{lobbies:lobbySummaries(rooms),activeGames:activeGameSummaries(rooms)});
  ws.on('pong',()=>ws.isAlive=true);
  ws.on('message',raw=>{try{
    const now=Date.now();if(now-ws.rateWindow>1000){ws.rateWindow=now;ws.rateCount=0}if(++ws.rateCount>40)return fail(ws,'Trop d’actions simultanées. Patientez un instant.');
    const msg=JSON.parse(raw.toString());if(!validMessage(msg))return fail(ws,'Action invalide.');
    if(msg.type==='chat'&&now-ws.lastChatAt<250)return send(ws,'chatRejected',{actionId:typeof msg.actionId==='string'?msg.actionId.slice(0,80):'',message:'Vous envoyez les messages trop rapidement.'});if(msg.type==='chat')ws.lastChatAt=now;
    const actionId=typeof msg.actionId==='string'?msg.actionId.slice(0,80):'';
    if(actionId&&ws.seenActions.has(actionId))return send(ws,'ack',{actionId});
    if(actionId){ws.seenActions.add(actionId);if(ws.seenActions.size>100)ws.seenActions.delete(ws.seenActions.values().next().value)}
    handle(ws,msg);if(actionId)send(ws,'ack',{actionId});
  }catch(error){console.error(error);fail(ws,'Action invalide.');}});
  ws.on('close',()=>{
    const room=rooms.get(ws.room),member=room&&members(room).find(item=>item.id===ws.playerId);
    if(member&&member.ws===ws){member.ws=null;member.visible=false;member.disconnectedAt=Date.now();refreshPresence(room);if(member.id===room.hostId)scheduleHostTransfer(room);broadcast(room,{lists:true});}
    else broadcastLobbies();
  });
});
setInterval(()=>{wss.clients.forEach(ws=>{if(!ws.isAlive)return ws.terminate();ws.isAlive=false;ws.ping();});},25000).unref();
setInterval(()=>{
  const now=Date.now();let listsChanged=false;
  for(const [roomCode,room] of rooms){
    const before=room.spectators.length;room.spectators=room.spectators.filter(spectator=>spectator.ws||!spectator.disconnectedAt||now-spectator.disconnectedAt<SPECTATOR_RECONNECT_GRACE_MS);if(room.spectators.length!==before){broadcast(room);listsChanged=true}
    refreshPresence(room);if(room.emptySince&&now-room.emptySince>=ROOM_EMPTY_GRACE_MS){clearTimeout(hostTransferTimers.get(roomCode));hostTransferTimers.delete(roomCode);rooms.delete(roomCode);deletePersistedRoom(roomCode);listsChanged=true}
  }
  if(listsChanged)broadcastLobbies();
},60*1000).unref();
if(require.main===module){
  restoreRooms().catch(error=>console.error('Restauration Supabase impossible :',error.message)).finally(()=>server.listen(PORT,()=>console.log(`Duel Urgensses écoute sur http://localhost:${PORT}`)));
}
module.exports={resolve,publicState,aggregateResults,removePlayer,transferHost,lobbySummaries,activeGameSummaries,replaceSocket,scoreRound,startMatch,facesFor,makePool,roll,nextClockwise};
