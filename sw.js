const ICON='/assets/icons/duel-urgensses-192.png';

self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  let data={};try{data=event.data?.json()||{}}catch{data={body:event.data?.text()||''}}
  event.waitUntil(self.registration.showNotification(data.title||'Duel Urgensses',{
    body:data.body||'Un nouveau défi vous attend.',icon:ICON,badge:ICON,tag:data.tag||'duel-urgensses',renotify:true,
    data:{url:data.url||'/'},vibrate:[120,70,120]
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||'/',self.location.origin).href;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
    for(const client of clients){if('navigate'in client)await client.navigate(target);if('focus'in client)return client.focus()}
    return self.clients.openWindow?self.clients.openWindow(target):undefined;
  }));
});
