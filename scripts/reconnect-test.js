const WebSocket=require('ws');
const assert=require('node:assert/strict');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function client(){const ws=new WebSocket(process.env.TEST_URL||'ws://127.0.0.1:3000');const value={ws,state:null,session:null,error:null};ws.on('message',raw=>{const message=JSON.parse(raw);if(message.type==='state')value.state=message.state;if(message.type==='session')value.session=message;if(message.type==='error')value.error=message.message});return value}
async function until(fn,label){for(let i=0;i<120;i++){const value=fn();if(value)return value;await wait(25)}throw new Error(`Délai dépassé: ${label}`)}
const send=(client,type,payload={})=>client.ws.send(JSON.stringify({type,...payload}));

(async()=>{
  const polo=client(),yannick=client();
  await Promise.all([until(()=>polo.ws.readyState===1,'connexion Polo'),until(()=>yannick.ws.readyState===1,'connexion Yannick')]);
  send(polo,'create',{character:'Polo',rounds:1});await until(()=>polo.session,'création de la salle');
  send(yannick,'join',{character:'Yannick',code:polo.session.code});await until(()=>polo.state?.players.length===2&&yannick.session,'arrivée de Yannick');
  send(polo,'start');await until(()=>polo.state?.phase==='bids','début de partie');send(polo,'bid',{bid:0});await until(()=>yannick.state?.turn===1,'tour de Yannick');

  const yannickReconnected=client();await until(()=>yannickReconnected.ws.readyState===1,'nouvelle connexion Yannick');
  send(yannickReconnected,'join',{code:yannick.session.code,playerId:yannick.session.playerId,resumeToken:yannick.session.resumeToken});await until(()=>yannickReconnected.state?.turn===1,'restauration de la session');
  yannick.ws.close();await wait(80);
  await until(()=>polo.state?.players[1].connected===true,'ancienne connexion sans effet sur la nouvelle');
  send(yannickReconnected,'bid',{bid:0});await until(()=>polo.state?.phase==='play','action après reconnexion');
  assert.equal(yannickReconnected.state.viewerId,yannick.session.playerId);
  console.log('Test reconnexion réussi : identité, tour et nouvelle connexion sont conservés après actualisation.');
  polo.ws.close();yannickReconnected.ws.close();
})().catch(error=>{console.error(error);process.exitCode=1});
