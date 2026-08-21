const COLORS={red:'Rouge',yellow:'Jaune',violet:'Violet',gray:'Gris',brown:'Urgentiste',green:'Chirurgien',blue:'Anesthésiste'};
const icons={
  brown:`<svg class="med-icon" viewBox="0 0 48 48" aria-label="Stéthoscope"><path d="M13 8v10a9 9 0 0 0 18 0V8"/><path d="M9 8h8M27 8h8M22 28v3a8 8 0 0 0 16 0v-2"/><circle cx="38" cy="25" r="4"/></svg>`,
  green:`<svg class="med-icon" viewBox="0 0 48 48" aria-label="Bistouri"><path d="M7 41l3 2 19-21-3-4z"/><path d="M26 18L39 2v5c-1 6-5 12-10 15z" fill="white"/><path d="M10 39l17-19"/></svg>`,
  blue:`<svg class="med-icon" viewBox="0 0 48 48" aria-label="Seringue"><path d="M14 29l15-15 7 7-15 15z"/><path d="M33 18L44 7M10 25l5 5M20 35l5 5M17 33L9 41M5 37l8 8"/><path d="M19 29l4 4M22 26l4 4M25 23l4 4"/></svg>`
};
const CHARACTERS=[['Pascal','pascal-pirate.png'],['Mathieu','mathieu-luchador.png'],['Pierre','pierre-halloween.png'],['Adela','adela-egyptienne.png'],['JB','jb-cosmonaute.png?v=20260819-2'],['Romain','romain-poulet.png'],['Natacha','natacha-princesse.png'],['Fanny','fanny-exploratrice.png'],['Félix','felix-cyborg.png'],['Youri','youri-paladin.png?v=20260819-2'],['Quentin','quentin-dictateur.png'],['Nicolas','nicolas-vigilante.png'],['Yannick','yannick-cardinal.png?v=20260819-2'],['Cecilia','cecilia-infirmiere.png'],['Thibault','thibault-aventurier.png'],['Polo','polo-dandy.png'],['Édouard','edouard-aviateur.png'],['Justin','justin-judoka.png'],['Charlotte','charlotte-cavaliere.png?v=20260819-2'],["Catoire d’Arabie",'catoire-arabie.png'],['Rémy','remy-shaolin.png'],['Olivier','olivier-cycliste.png?v=20260820-3'],['Raphaël','raphael-scaphandrier.png?v=20260819-3'],['Éric','eric-druide.png'],['Cyril','cyril-alchimiste.png'],['Rémi','remi-berserker.png'],['Thomas','thomas-capitaine-sous-marin.png'],['Benjamin','benjamin-sherif.png'],['Edwin','edwin-zadiste.png'],['Alexandre','alexandre-hercule-satan.png?v=20260819-2'],['Erwan','erwan-bucheron.png'],['Ravin','ravin-pizzaiolo.png?v=20260820-1']];
const FEMININE_HAND_CHARACTERS=new Set(['Adela','Natacha','Fanny','Cecilia','Charlotte']);
const $=id=>document.getElementById(id);let socket,state,openLobbies=[],session=JSON.parse(localStorage.getItem('duel-session')||'null'),lastChatCount=0,reconnectTimer=null,connectionNumber=0,leavingRoom=false,errorTimer=null,swRegistration=null,deferredInstallPrompt=null,pushEndpoint='',pushPublicKey='',pendingSpectatorName='',podiumPresented=false;
const invitedCode=new URLSearchParams(location.search).get('join')?.trim().toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,5)||'';
// Un joueur qui actualise son lien d'invitation doit conserver son identité.
// On oublie l'ancienne session uniquement si le lien vise une autre salle.
if(invitedCode&&session?.code!==invitedCode){session=null;localStorage.removeItem('duel-session')}
const special=c=>['brown','green','blue'].includes(c);const normalizedCharacter=name=>name==='Adéla'?'Adela':name;const characterFile=name=>CHARACTERS.find(c=>c[0]===normalizedCharacter(name))?.[1]||CHARACTERS[0][1];
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function dieHTML(d,clickable=false){if(d.hidden)return `<button class="die back" disabled></button>`;const face=special(d.color)&&d.face==='symbol'?icons[d.color]:d.face==='flag'?'<span class="flag">⚑</span>':`<span class="value">${d.face??'?'}</span>`;return `<button class="die ${d.color} ${clickable?'clickable':''}" ${clickable?`data-die="${d.id}"`:''}>${face}</button>`}
function bidGestureHTML(player,index,compact=false){
  if(!Number.isInteger(player.bid))return '<b>—</b>';
  const side=index%2?'from-right':'from-left',character=normalizedCharacter(player.character||player.name),feminine=FEMININE_HAND_CHARACTERS.has(character),dedicatedFeminine=feminine&&player.bid>5;
  const handStyle=dedicatedFeminine?'feminine-hands dedicated-feminine':feminine?'feminine-hands':character==='Yannick'?'yannick-hands':'';
  const source=dedicatedFeminine?`assets/bids/feminine/bid-${player.bid}.png?v=20260819-4`:`assets/bids/bid-${player.bid}.png?v=20260819-3`;
  return `<span class="bid-gesture ${side} ${handStyle} ${compact?'compact':''}"><img src="${source}" alt="${player.bid} pli${player.bid>1?'s':''}"><em>${player.bid}</em></span>`
}
function bidsAreRevealed(){return state.phase!=='bids'&&state.players.length>0&&state.players.every(player=>Number.isInteger(player.bid))}
function shouldShowBidReveal(){return bidsAreRevealed()&&state.phase==='play'&&state.trick===1&&state.played.length===0}
function bidRevealHTML(mobile=false){return `<div class="${mobile?'mobile-bid-reveal':'bid-reveal-grid'}">${state.players.map((player,index)=>`<div class="revealed-bid"><span>${esc(player.name)}</span>${bidGestureHTML(player,index)}</div>`).join('')}</div>`}
function connect(){
  clearTimeout(reconnectTimer);const attempt=++connectionNumber,protocol=location.protocol==='https:'?'wss':'ws';
  $('connectionBanner').classList.toggle('hidden',!state);const nextSocket=new WebSocket(`${protocol}://${location.host}`);socket=nextSocket;
  nextSocket.onopen=()=>{if(attempt!==connectionNumber)return nextSocket.close();$('connectionStatus').textContent='Serveur connecté.';$('connectionBanner').classList.add('hidden');if(session?.code&&session?.playerId)send('join',{code:session.code,playerId:session.playerId})};
  nextSocket.onclose=()=>{if(attempt!==connectionNumber||leavingRoom)return;$('connectionStatus').textContent='Connexion perdue — resynchronisation…';$('connectionBanner').classList.toggle('hidden',!state);reconnectTimer=setTimeout(connect,1500)};
  nextSocket.onmessage=e=>{if(attempt!==connectionNumber)return;const m=JSON.parse(e.data);if(m.type==='lobbies'){openLobbies=Array.isArray(m.lobbies)?m.lobbies:[];renderOpenChallenges()}if(m.type==='session'){session={code:m.code,playerId:m.playerId};localStorage.setItem('duel-session',JSON.stringify(session))}if(m.type==='state'){state=m.state;$('connectionBanner').classList.add('hidden');render();if(state.viewerRole==='spectator'&&pendingSpectatorName){const name=pendingSpectatorName;pendingSpectatorName='';send('renameSpectator',{name})}}if(m.type==='left')returnHome();if(m.type==='closed'||m.type==='kicked'){alert(m.message);leavingRoom=false;returnHome()}if(m.type==='joinUnavailable'){exitInvitationMode(true);showError(`${m.message} Vous pouvez ${m.canSpectate?'l’observer avec le code conservé, ou ':''}créer ou rejoindre un autre défi.`)}if(m.type==='error')showError(m.message)}
}
function resynchronize(){if(document.visibilityState!=='visible')return;if(!socket||socket.readyState!==WebSocket.OPEN){connect();return}if(session?.code&&session?.playerId)send('join',{code:session.code,playerId:session.playerId})}
function send(type,payload={}){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type,...payload}));else showError('Le serveur n’est pas encore connecté.')}
function identity(){const c=CHARACTERS[Number($('characterSelect').value)];return{name:c[0],character:c[0]}}
function createRoom(){const who=identity();if(who){session=null;localStorage.removeItem('duel-session');send('create',{...who,rounds:Number($('roundCount').value),maxPlayers:Number($('maxPlayers').value),pushEndpoint})}}
function spectatorName(){return $('spectatorNameInput').value.trim().replace(/\s+/g,' ').slice(0,24)}
function createOrganizer(){session=null;localStorage.removeItem('duel-session');send('create',{name:spectatorName(),organizer:true,rounds:Number($('roundCount').value),maxPlayers:Number($('maxPlayers').value),pushEndpoint})}
function joinRoom(){const who=identity(),code=$('roomCodeInput').value.trim().toUpperCase();if(who&&code){session=null;localStorage.removeItem('duel-session');send('join',{...who,code})}else if(who)showError('Indiquez le code de la salle.')}
function joinSpectatorRoom(){const code=$('roomCodeInput').value.trim().toUpperCase();if(!code)return showError('Indiquez le code de la salle.');pendingSpectatorName=spectatorName();session=null;localStorage.removeItem('duel-session');send('join',{code,spectator:true,name:pendingSpectatorName})}
function exitInvitationMode(keepCode=false){
  $('lobby').classList.remove('invited-lobby');$('inviteNotice').classList.add('hidden');$('joinButton').textContent='REJOINDRE';
  if(!keepCode)$('roomCodeInput').value='';
  const url=new URL(location.href);url.searchParams.delete('join');history.replaceState(null,'',`${url.pathname}${url.search}${url.hash}`);
}
function renderOpenChallenges(){
  const list=$('openChallengesList'),counter=$('openChallengeCount');if(!list||!counter)return;
  counter.textContent=String(openLobbies.length);
  list.innerHTML=openLobbies.length?openLobbies.map(room=>`<article class="open-challenge"><div><strong>${esc(room.host)} lance un défi</strong><small>${room.rounds} manche${room.rounds>1?'s':''} · ${room.players}/${room.maxPlayers} joueurs</small></div><div class="open-challenge-actions"><button data-open-room="${esc(room.code)}">JOUER</button><button class="observe-challenge" data-observe-room="${esc(room.code)}">OBSERVER</button></div></article>`).join(''):'<p>Aucun défi ouvert pour le moment.</p>';
  list.querySelectorAll('[data-open-room]').forEach(button=>button.onclick=()=>{$('roomCodeInput').value=button.dataset.openRoom;joinRoom()});
  list.querySelectorAll('[data-observe-room]').forEach(button=>button.onclick=()=>{$('roomCodeInput').value=button.dataset.observeRoom;joinSpectatorRoom()});
}
const iosDevice=()=>/iphone|ipad|ipod/i.test(navigator.userAgent);
const standaloneApp=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const vapidBytes=value=>{const padding='='.repeat((4-value.length%4)%4),base64=(value+padding).replace(/-/g,'+').replace(/_/g,'/'),raw=atob(base64);return Uint8Array.from([...raw].map(char=>char.charCodeAt(0)))};
async function syncPushSubscription(subscription){
  const response=await fetch('/api/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:subscription.toJSON()})});
  if(!response.ok)throw new Error('Enregistrement de l’alerte impossible.');pushEndpoint=subscription.endpoint;
}
async function refreshPushUI(){
  const button=$('pushToggleButton'),status=$('pushStatus'),install=$('installAppButton');if(!button||!status)return;
  if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window)){button.disabled=true;button.textContent='ALERTES NON COMPATIBLES';status.textContent='Ce navigateur ne permet pas les notifications Web Push.';return}
  if(iosDevice()&&!standaloneApp()){button.disabled=false;button.textContent='📲 INSTALLER POUR LES ALERTES';install.classList.add('hidden');status.textContent='Sur iPhone : Partager → Sur l’écran d’accueil, puis ouvrez l’application.';return}
  const subscription=swRegistration?await swRegistration.pushManager.getSubscription():null;pushEndpoint=subscription?.endpoint||'';
  if(!pushPublicKey&&!subscription){button.disabled=true;button.textContent='ALERTES EN ATTENTE';status.textContent='La configuration des notifications doit être terminée sur Render.';install.classList.toggle('hidden',!deferredInstallPrompt||standaloneApp());return}
  button.disabled=false;button.textContent=subscription?'🔕 DÉSACTIVER LES ALERTES':'🔔 ACTIVER LES ALERTES';button.classList.toggle('enabled',!!subscription);
  status.textContent=subscription?'Alertes actives sur cet appareil.':'Soyez prévenu lorsqu’un nouveau défi est lancé.';
  install.classList.toggle('hidden',!deferredInstallPrompt||standaloneApp());
}
async function togglePush(){
  if(iosDevice()&&!standaloneApp()){showError('Sur iPhone, utilisez Partager → Sur l’écran d’accueil, puis ouvrez l’application installée.');return}
  try{
    if(!swRegistration)swRegistration=await navigator.serviceWorker.ready;
    if(pushEndpoint){const current=await swRegistration.pushManager.getSubscription(),endpoint=current?.endpoint||pushEndpoint;if(current)await current.unsubscribe();await fetch('/api/push/subscribe',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint})});pushEndpoint='';await refreshPushUI();return}
    if(!pushPublicKey)throw new Error('Les clés de notification ne sont pas encore configurées sur Render.');
    const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('Les notifications n’ont pas été autorisées.');
    const subscription=await swRegistration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:vapidBytes(pushPublicKey)});
    await syncPushSubscription(subscription);await refreshPushUI();
  }catch(error){showError(error.message||'Impossible d’activer les alertes sur cet appareil.')}
}
async function initPWA(){
  if(!('serviceWorker'in navigator))return refreshPushUI();
  try{swRegistration=await navigator.serviceWorker.register('/sw.js?v=1');await navigator.serviceWorker.ready;const config=await fetch('/api/push/public-key',{cache:'no-store'}).then(response=>response.json());pushPublicKey=config.enabled?config.publicKey:'';const existing=await swRegistration.pushManager.getSubscription();if(existing)await syncPushSubscription(existing);await refreshPushUI()}catch(error){console.error(error);$('pushStatus').textContent='Les alertes sont momentanément indisponibles.'}
}
function initAnonymousAnalytics(){
  let visitorId=localStorage.getItem('duel-anonymous-visitor');if(!visitorId){visitorId=crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`;localStorage.setItem('duel-anonymous-visitor',visitorId)}
  fetch('/api/analytics/visit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({visitorId}),keepalive:true}).catch(()=>{});
}
async function installApp(){if(!deferredInstallPrompt)return;await deferredInstallPrompt.prompt();deferredInstallPrompt=null;await refreshPushUI()}
function invitationUrl(){const url=new URL(location.href);url.search='';url.hash='';url.searchParams.set('join',state.code);return url.toString()}
function invitationText(){return `Je t’invite à jouer à Duel Urgensses ! Rejoins directement ma partie : ${invitationUrl()}`}
async function copyInvitation(){try{await navigator.clipboard.writeText(invitationUrl());$('copyInviteButton').textContent='LIEN COPIÉ !';setTimeout(()=>$('copyInviteButton').textContent='COPIER LE LIEN',1400)}catch{showError('Impossible de copier le lien sur cet appareil.')}}
async function shareInvitation(){if(navigator.share){try{await navigator.share({title:'Duel Urgensses',text:'Je t’invite à jouer à Duel Urgensses !',url:invitationUrl()});return}catch(error){if(error.name==='AbortError')return}}await copyInvitation()}
function showError(message){
  const status=$('connectionStatus'),toast=$('errorToast');
  status.textContent=message;status.classList.add('error');toast.textContent=message;toast.classList.remove('hidden');
  clearTimeout(errorTimer);errorTimer=setTimeout(()=>{toast.classList.add('hidden');status.classList.remove('error')},5000);
}
async function showLeaderboard(){
  $('leaderboardDialog').showModal();$('leaderboardBody').innerHTML='<p class="leaderboard-loading">Chargement du classement…</p>';
  try{const response=await fetch('/api/leaderboard',{cache:'no-store'});if(!response.ok)throw new Error();const rows=await response.json();$('leaderboardBody').innerHTML=rows.length?`<div class="leaderboard-table"><div class="leaderboard-row leaderboard-head"><span>RANG</span><span>PERSONNAGE</span><span>POINTS</span><span>V</span><span>PARTIES</span><span>TAUX</span></div>${rows.map((r,i)=>`<div class="leaderboard-row"><b class="rank">${i+1}</b><span class="leaderboard-character"><img src="assets/characters/${characterFile(r.character)}" alt=""><strong>${esc(r.character)}</strong></span><b>${r.points}</b><span>${r.wins}</span><span>${r.games}</span><span>${r.winRate}%</span></div>`).join('')}</div>`:'<p class="leaderboard-empty">Le Hall of Fame attend sa première partie terminée.</p>'}catch{$('leaderboardBody').innerHTML='<p class="leaderboard-empty">Le classement est momentanément indisponible.</p>'}
}
function showGallery(){
  $('galleryGrid').innerHTML=CHARACTERS.map(([name,file])=>`<article class="gallery-card"><div><img src="assets/characters/${file}" alt="${esc(name)}" loading="lazy"></div><h3>${esc(name)}</h3></article>`).join('');
  $('galleryDialog').showModal();
}
function returnHome(){
  if(leavingRoom&&state===null)return;
  leavingRoom=true;clearTimeout(reconnectTimer);connectionNumber++;
  localStorage.removeItem('duel-session');session=null;state=null;
  try{socket.onclose=null;socket.close()}catch{}
  const url=new URL(location.href);url.search='';url.hash='';location.replace(url.toString());
}
function leaveCurrentRoom(askConfirmation=true){
  if(leavingRoom)return;
  if(askConfirmation&&!confirm('Quitter cette partie et revenir à l’accueil ?'))return;
  leavingRoom=true;
  // Le retour local ne dépend plus de la réponse du serveur : indispensable sur mobile/4G.
  if(socket?.readyState===WebSocket.OPEN){
    try{socket.send(JSON.stringify({type:'leave'}))}catch{}
    setTimeout(()=>{leavingRoom=false;returnHome()},180);
  }else{
    leavingRoom=false;returnHome();
  }
}
function render(){$('lobby').classList.toggle('hidden',!!state);$('waitingRoom').classList.toggle('hidden',!state||state.status!=='lobby');$('game').classList.toggle('hidden',!state||state.status==='lobby');$('chatPanel').classList.toggle('hidden',!state);$('leaveButton').classList.toggle('hidden',!state);$('spectatorModeNotice').classList.toggle('hidden',!state||state.viewerRole!=='spectator'||state.status==='lobby');renderChat();if(state.status==='lobby'){podiumPresented=false;if($('podiumDialog').open)$('podiumDialog').close();return renderWaiting()}renderGame()}
function matchChronicles(ranked){
  if(!ranked.length)return[];
  const notes=[],best=ranked[0].score,winners=ranked.filter(player=>player.score===best);
  if(winners.length>1)notes.push(`⚔️ ${winners.map(player=>player.name).join(' et ')} refusent de se départager : même score, même droit de fanfaronner.`);
  else notes.push(`🏆 ${ranked[0].name} transforme ${ranked[0].score} points en prise de pouvoir parfaitement assumée.`);
  const zero=[...ranked].sort((a,b)=>(b.zeroSuccesses||0)-(a.zeroSuccesses||0))[0];
  const exact=[...ranked].sort((a,b)=>(b.exactRounds||0)-(a.exactRounds||0))[0];
  const tricks=[...ranked].sort((a,b)=>(b.totalTricks||0)-(a.totalTricks||0))[0];
  const bold=[...ranked].sort((a,b)=>(b.boldestBid||0)-(a.boldestBid||0))[0];
  if((zero?.zeroSuccesses||0)>0)notes.push(`🫥 ${zero.name} réussit ${zero.zeroSuccesses} pari${zero.zeroSuccesses>1?'s':''} à zéro : gagner en ne prenant rien, un art très spécialisé.`);
  if(notes.length<3&&(exact?.exactRounds||0)>0)notes.push(`🎯 ${exact.name} vise juste ${exact.exactRounds} fois. À ce stade, ce n’est plus un pari, c’est une ordonnance.`);
  if(notes.length<3&&(tricks?.totalTricks||0)>0)notes.push(`🧹 ${tricks.name} ramasse ${tricks.totalTricks} pli${tricks.totalTricks>1?'s':''}. Il ne restait presque plus rien sur la table.`);
  if(notes.length<3&&(bold?.boldestBid||0)>=4)notes.push(`🔥 ${bold.name} ose annoncer ${bold.boldestBid} plis. La prudence a quitté le service.`);
  const last=ranked.at(-1);if(notes.length<2&&last&&last.score===0)notes.push(`🩹 ${last.name} termine à zéro point, mais avec une expérience de terrain désormais considérable.`);
  return notes.slice(0,3);
}
function showFinalPodium(){
  if(podiumPresented||state.phase!=='over')return;podiumPresented=true;
  const ranked=[...state.players].sort((a,b)=>b.score-a.score||b.tricks-a.tricks||a.name.localeCompare(b.name,'fr')),best=ranked[0]?.score,winners=ranked.filter(player=>player.score===best),winnerNames=winners.map(player=>player.name);
  const title=winners.length>1?`ÉGALITÉ ENTRE ${winnerNames.map(esc).join(' ET ')}`:`${esc(winnerNames[0]||'')} REMPORTE LE DUEL !`;
  const top=ranked.slice(0,3),visual=top.length===2?[top[1],top[0]]:top.length>=3?[top[1],top[0],top[2]]:top;
  const chronicles=matchChronicles(ranked);
  $('podiumBody').innerHTML=`<h2>${title}</h2><p class="podium-subtitle">Classement final · ${state.totalRounds} manche${state.totalRounds>1?'s':''}</p><div class="podium-stage podium-${visual.length}">${visual.map(player=>{const place=ranked.indexOf(player)+1,champion=player.score===best;return `<article class="podium-place place-${place} ${champion?'champion':''}"><div class="podium-avatar"><span class="podium-rays"></span><img src="assets/characters/${characterFile(player.character)}" alt="${esc(player.name)}"></div><div class="podium-step"><b>${place}</b><strong>${esc(player.name)}</strong><span>${player.score} points</span><small>${player.totalTricks??0} pli${(player.totalTricks??0)>1?'s':''}</small></div></article>`}).join('')}</div>${ranked.length>3?`<ol class="podium-rest">${ranked.slice(3).map((player,index)=>`<li><b>${index+4}. ${esc(player.name)}</b><span>${player.score} points</span></li>`).join('')}</ol>`:''}<section class="podium-chronicles"><h3>LA CHRONIQUE DU DUEL</h3>${chronicles.map(note=>`<p>${esc(note)}</p>`).join('')}</section>`;
  const host=state.viewerId===state.hostId;$('podiumLobbyButton').classList.toggle('hidden',!host);$('podiumNewRoomButton').classList.toggle('hidden',!host);$('podiumDialog').showModal();
}
function kickButton(player){return state.viewerId===state.hostId&&player.id!==state.hostId?`<button class="kick-player" data-kick="${player.id}" title="Exclure ${esc(player.name)}">EXCLURE</button>`:''}
function bindKickButtons(scope=document){scope.querySelectorAll('[data-kick]').forEach(button=>button.onclick=()=>{const player=state.players.find(p=>p.id===button.dataset.kick);if(player&&confirm(`Exclure ${player.name} de la salle ?`))send('kick',{playerId:player.id})})}
function renderWaiting(){$('copyCode').textContent=state.code;const host=state.viewerId===state.hostId,spectators=state.spectators.map(s=>`<div class="waiting-player spectator"><span class="spectator-icon">👁</span><span><b>${esc(s.name)}</b><small>ORGANISATEUR / SPECTATEUR${s.id===state.hostId?' · HÔTE':''}</small></span><i class="${s.connected?'online':''}"></i></div>`).join('');$('waitingPlayers').innerHTML=spectators+state.players.map(p=>`<div class="waiting-player"><img src="assets/characters/${characterFile(p.character)}" alt=""><span><b>${esc(p.name)}</b><small>${esc(p.character)}${p.id===state.hostId?' · HÔTE':''}${p.connected?'':' · DÉCONNECTÉ'}</small></span><i class="${p.connected?'online':''}"></i>${kickButton(p)}</div>`).join('');$('onlineStartButton').classList.toggle('hidden',!host);$('waitingCapacityLabel').classList.toggle('hidden',!host);$('waitingRoundsLabel').classList.toggle('hidden',!host);$('waitingMaxPlayers').value=String(state.maxPlayers||6);$('waitingRoundCount').value=String(state.totalRounds||8);$('waitingHint').textContent=host?(state.players.length<2?`En attente d’au moins deux joueurs actifs… (${state.players.length}/${state.maxPlayers})`:`${state.players.length}/${state.maxPlayers} joueurs · ${state.totalRounds} manches. Vous pouvez lancer la partie.`):`L’hôte lancera la partie · ${state.players.length}/${state.maxPlayers} joueurs · ${state.totalRounds} manches.`;bindKickButtons($('waitingPlayers'))}
function renderChat(){if(!state)return;const box=$('chatMessages'),atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<40;box.innerHTML=state.chat.map(m=>`<div class="chat-message ${m.role==='spectator'?'spectator':''}"><b>${esc(m.sender)}</b><span>${esc(m.text)}</span></div>`).join('')||'<p class="chat-empty">Le chat est ouvert. Soyez le premier à parler.</p>';if(atBottom)box.scrollTop=box.scrollHeight;if(state.chat.length>lastChatCount&&$('chatPanel').classList.contains('collapsed'))$('chatBadge').textContent=String(state.chat.length-lastChatCount);lastChatCount=state.chat.length}
function legalIds(){const me=state.players.find(p=>p.id===state.viewerId);if(!me||state.phase!=='play'||state.players[state.turn]?.id!==state.viewerId)return new Set();if(!state.leadColor)return new Set(me.dice.map(d=>d.id));const matching=me.dice.filter(d=>d.color===state.leadColor);return new Set((matching.length?[...matching,...me.dice.filter(d=>special(d.color))]:me.dice).map(d=>d.id))}
function renderGame(){const legal=legalIds();$('roundValue').textContent=`${state.round} / ${state.totalRounds}`;$('trickValue').textContent=`${state.trick} / ${state.round}`;$('leadColor').textContent=state.leadColor?COLORS[state.leadColor].toUpperCase():'—';$('phaseValue').textContent={bids:'PARIS',play:'LANCER',result:'RÉSULTAT',over:'TERMINÉ'}[state.phase]||state.phase;const spectatorTotal=(state.spectators||[]).filter(s=>s.connected).length,spectatorCounter=$('spectatorCount');spectatorCounter.querySelector('strong').textContent=String(spectatorTotal);spectatorCounter.setAttribute('aria-label',`${spectatorTotal} spectateur${spectatorTotal>1?'s':''} connecté${spectatorTotal>1?'s':''}`);spectatorCounter.title=`${spectatorTotal} spectateur${spectatorTotal>1?'s':''} actuellement connecté${spectatorTotal>1?'s':''}`;$('game').dataset.phase=state.phase;$('playersGrid').dataset.count=state.players.length;const arena=document.querySelector('.multiplayer-arena');arena.dataset.playerCount=state.players.length;arena.classList.toggle('radial-arena',state.players.length>=3);
  $('playersGrid').innerHTML=state.players.map((p,i)=>{const active=i===state.turn&&['bids','play'].includes(state.phase),mine=p.id===state.viewerId,side=i%2?'right-avatar':'left-avatar',bidDisplay=`<b class="metric-number bid-number">${p.bid??'—'}</b>`;return `<article class="player-card ${active?'active':''} ${mine?'is-me':''}"><div class="turn-indicator"><span>${mine?'À VOUS DE JOUER':'À SON TOUR'}</span><b>▼</b></div><div class="avatar-zone ${side}" aria-hidden="true"><div class="avatar-aura"></div><img class="character-sprite" src="assets/characters/${characterFile(p.character)}" alt=""><div class="avatar-shadow"></div></div><div class="player-head"><h3>${esc(p.name)}</h3><strong>${p.score}</strong></div><div class="metrics"><span class="bid-metric">PARI ${bidDisplay}</span><span class="trick-metric">PLIS <b class="metric-number">${p.tricks}</b></span>${mine?'<span>VOUS</span>':''}</div><div class="dice-rack">${p.dice.map(d=>dieHTML(d,legal.has(d.id))).join('')}</div>${p.connected?'':'<small class="disconnected">HORS CONNEXION</small>'}${kickButton(p)}</article>`}).join('');document.querySelectorAll('[data-die]').forEach(el=>el.onclick=()=>send('play',{dieId:el.dataset.die}));bindKickButtons($('playersGrid'));$('playedDice').innerHTML=state.played.map(x=>`<div class="played-slot">${dieHTML(x.die)}<small>${esc(state.players[x.player].name)}</small></div>`).join('');$('bidReveal').classList.toggle('hidden',!shouldShowBidReveal());$('bidReveal').innerHTML=shouldShowBidReveal()?`<h3>PARIS RÉVÉLÉS !</h3>${bidRevealHTML()}`:'';$('bidControls').innerHTML='';$('nextButton').classList.add('hidden');$('resetButton').classList.add('hidden');$('newRoomButton').classList.add('hidden');const turnPlayer=state.players[state.turn],myTurn=turnPlayer?.id===state.viewerId;
  if(state.phase==='bids'){$('message').innerHTML=`<strong>PARI DE ${esc(turnPlayer.name.toUpperCase())}</strong><br><span>${myTurn?'Choisissez le nombre de plis que vous allez remporter.':'En attente de son pari…'}</span>`;if(myTurn){$('bidControls').innerHTML=Array.from({length:state.round+1},(_,n)=>`<button data-bid="${n}">${n}</button>`).join('');document.querySelectorAll('[data-bid]').forEach(el=>el.onclick=()=>send('bid',{bid:+el.dataset.bid}))}}
  if(state.phase==='play')$('message').innerHTML=`<strong>AU TOUR DE ${esc(turnPlayer.name.toUpperCase())}</strong><br><span>${myTurn?'Choisissez maintenant l’un de vos dés illuminés.':'Son choix apparaîtra ici.'}</span>`;if(state.phase==='result'){$('message').textContent=`Pli remporté par ${state.players[state.leader].name}.`;$('nextButton').classList.toggle('hidden',state.players[state.leader].id!==state.viewerId)}if(state.phase==='over'){const max=Math.max(...state.players.map(p=>p.score)),winners=state.players.filter(p=>p.score===max).map(p=>p.name);$('message').textContent=winners.length>1?`Égalité : ${winners.join(' et ')}.`:`${winners[0]} remporte le duel !`;$('playedDice').innerHTML='<strong>DUEL TERMINÉ</strong>';const host=state.viewerId===state.hostId;$('resetButton').classList.toggle('hidden',!host);$('newRoomButton').classList.toggle('hidden',!host);showFinalPodium()}renderMobileStage()}
function renderMobileStage(){
  const me=state.players.find(p=>p.id===state.viewerId),turnPlayer=state.players[state.turn],myTurn=turnPlayer?.id===state.viewerId,legal=legalIds(),played=state.played.map(x=>`<div class="mobile-played-die">${dieHTML(x.die)}<small>${esc(state.players[x.player].name)}</small></div>`).join('');
  const hand=me?me.dice.map(d=>dieHTML(d,state.phase==='play'&&legal.has(d.id))).join(''):'';let title='',instruction='',actions='';
  if(state.phase==='bids'){title=myTurn?'À VOUS DE PARIER':`${turnPlayer.name} prépare son pari`;instruction=myTurn?'Combien de plis pensez-vous remporter ? Appuyez simplement sur un nombre.':'Patientez un instant. Vos dés restent visibles ci-dessous.';if(myTurn)actions=`<div class="mobile-big-actions">${Array.from({length:state.round+1},(_,n)=>`<button data-mobile-bid="${n}">${n}<small>pli${n>1?'s':''}</small></button>`).join('')}</div>`}
  if(state.phase==='play'){title=myTurn?'À VOUS DE JOUER':`Au tour de ${turnPlayer.name}`;instruction=myTurn?'Appuyez sur l’un des dés illuminés. Les autres sont interdits pour ce pli.':'Le dé joué apparaîtra automatiquement ici.'}
  if(state.phase==='result'){const winner=state.players[state.leader];title=`${winner.name} remporte le pli`;instruction=winner.id===state.viewerId?'Vous avez la main pour continuer.':'Le vainqueur va lancer le pli suivant.';if(winner.id===state.viewerId)actions='<button class="mobile-continue" data-mobile-next>PLI SUIVANT</button>'}
  if(state.phase==='over'){const max=Math.max(...state.players.map(p=>p.score)),winners=state.players.filter(p=>p.score===max).map(p=>p.name),host=state.viewerId===state.hostId;title=winners.length>1?'Égalité !':`${winners[0]} gagne !`;instruction='La partie est terminée.';if(host)actions='<button class="mobile-continue" data-mobile-reset>RETOURNER DANS LE SALON</button><button class="mobile-new-room" data-mobile-new-room>NOUVELLE SALLE</button>'}
  const scores=`<div class="mobile-scoreboard">${state.players.map((p,i)=>`<div class="${i===state.turn&&['bids','play'].includes(state.phase)?'active':''}"><span>${esc(p.name)}</span><b>${p.score} pts</b><small><span>${p.tricks} pli${p.tricks>1?'s':''}</span><i class="mobile-bid-chip">PARI ${Number.isInteger(p.bid)?p.bid:'—'}</i></small>${state.viewerId===state.hostId&&p.id!==state.hostId?`<button class="mobile-kick" data-kick="${p.id}">EXCLURE</button>`:''}</div>`).join('')}</div>`;
  const avatars=state.players.map((p,i)=>`<div class="mobile-avatar ${i===state.turn&&['bids','play'].includes(state.phase)?'active':''} ${p.id===state.viewerId?'is-me':''}"><img src="assets/characters/${characterFile(p.character)}" alt="${esc(p.name)}"><small>${esc(p.name)}</small></div>`).join('');
  const revealedBids=shouldShowBidReveal()?`<div class="mobile-block mobile-revealed-bids"><h3>PARIS RÉVÉLÉS !</h3>${bidRevealHTML(true)}</div>`:'';
  $('mobileStage').innerHTML=`${scores}<div class="mobile-step"><span>ÉTAPE EN COURS</span><h2>${esc(title)}</h2><p>${esc(instruction)}</p></div>${revealedBids}${played?`<div class="mobile-block"><h3>DÉS JOUÉS</h3><div class="mobile-played">${played}</div></div>`:''}${me&&state.phase!=='over'?`<div class="mobile-block mobile-hand"><h3>VOS DÉS</h3><div class="mobile-dice">${hand}</div></div>`:''}${actions}<div class="mobile-avatar-dock">${avatars}</div>`;
  document.querySelectorAll('[data-mobile-die]').forEach(()=>{});$('mobileStage').querySelectorAll('[data-die]').forEach(el=>el.onclick=()=>send('play',{dieId:el.dataset.die}));$('mobileStage').querySelectorAll('[data-mobile-bid]').forEach(el=>el.onclick=()=>send('bid',{bid:+el.dataset.mobileBid}));$('mobileStage').querySelector('[data-mobile-next]')?.addEventListener('click',()=>send('next'));$('mobileStage').querySelector('[data-mobile-reset]')?.addEventListener('click',()=>send('reset'));$('mobileStage').querySelector('[data-mobile-new-room]')?.addEventListener('click',()=>send('newRoom'));bindKickButtons($('mobileStage'));
}
function init(){
  const options=CHARACTERS.map(([name],i)=>`<option value="${i}">${name}</option>`).join('');$('characterSelect').innerHTML=options;
  if(invitedCode){$('roomCodeInput').value=invitedCode;$('invitedRoomCode').textContent=invitedCode;$('inviteNotice').classList.remove('hidden');$('joinButton').textContent='REJOINDRE LA PARTIE';$('lobby').classList.add('invited-lobby')}
  $('createButton').onclick=createRoom;$('organizerButton').onclick=createOrganizer;$('joinButton').onclick=joinRoom;$('joinSpectatorButton').onclick=joinSpectatorRoom;$('cancelInviteButton').onclick=()=>exitInvitationMode(false);$('pushToggleButton').onclick=togglePush;$('installAppButton').onclick=installApp;$('roomCodeInput').oninput=e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z2-9]/g,'');$('roomCodeInput').onkeydown=e=>{if(e.key==='Enter')joinRoom()};
  $('onlineStartButton').onclick=()=>send('start');$('waitingMaxPlayers').onchange=e=>{const value=Number(e.target.value);if(value<state.players.length){e.target.value=String(state.maxPlayers);return showError(`Il y a déjà ${state.players.length} joueurs dans la salle.`)}send('settings',{maxPlayers:value,rounds:state.totalRounds})};$('waitingRoundCount').onchange=e=>send('settings',{maxPlayers:state.maxPlayers,rounds:Number(e.target.value)});$('nextButton').onclick=()=>send('next');$('resetButton').onclick=()=>send('reset');$('newRoomButton').onclick=()=>send('newRoom');$('leaveButton').onclick=()=>leaveCurrentRoom(true);$('cancelWaitingButton').onclick=()=>leaveCurrentRoom(false);$('shareInviteButton').onclick=shareInvitation;$('directInviteButton').onclick=()=>{location.href=`https://wa.me/?text=${encodeURIComponent(invitationText())}`};$('copyInviteButton').onclick=copyInvitation;$('copyCode').onclick=async()=>{await navigator.clipboard.writeText(state.code);$('copyCode').textContent='COPIÉ !';setTimeout(()=>$('copyCode').textContent=state.code,1000)};
  $('chatHeader').onclick=()=>{$('chatPanel').classList.toggle('collapsed');$('chatBadge').textContent=''};
  $('chatForm').onsubmit=e=>{e.preventDefault();const text=$('chatInput').value.trim();if(text){send('chat',{text});$('chatInput').value=''}};
  $('rulesButton').onclick=()=>$('rulesDialog').showModal();$('closeRules').onclick=()=>$('rulesDialog').close();$('legend').innerHTML=['brown','green','blue'].map(c=>`<div class="legend-item">${dieHTML({color:c,face:'symbol'})}<span>${COLORS[c]}</span></div>`).join('');connect()
  $('leaderboardButton').onclick=showLeaderboard;$('closeLeaderboard').onclick=()=>$('leaderboardDialog').close();
  $('galleryButton').onclick=showGallery;$('closeGallery').onclick=()=>$('galleryDialog').close();document.addEventListener('visibilitychange',resynchronize);window.addEventListener('online',resynchronize);window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;refreshPushUI()});window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;refreshPushUI()});initPWA();initAnonymousAnalytics();
  $('closePodium').onclick=$('podiumCloseButton').onclick=()=>$('podiumDialog').close();$('podiumLobbyButton').onclick=()=>{if($('podiumDialog').open)$('podiumDialog').close();send('reset')};$('podiumNewRoomButton').onclick=()=>{if($('podiumDialog').open)$('podiumDialog').close();send('newRoom')};
}
init();
