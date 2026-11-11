// Zone5: guarda a app para abrir sem rede. Dados e APIs vão sempre à rede.
const CACHE='zone5-v4';
const SHELL=['./','./index.html','./manifest.webmanifest','./icon.svg','./icon-180.png','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  // rede primeiro (para receber atualizações), cache se estiver offline
  e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c));return r;}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
});
// Lembretes de treino (notificações push)
self.addEventListener('push',e=>{
  let d={};try{d=e.data?e.data.json():{};}catch(_){d={title:'Zone5',body:e.data?e.data.text():''};}
  e.waitUntil(self.registration.showNotification(d.title||'Zone5',{body:d.body||'',icon:'./icon-192.png',badge:'./icon-192.png',tag:'zone5-'+(d.date||'today'),data:{url:'./#hoje'}}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(ws=>{for(const w of ws){if('focus' in w){w.navigate?.(e.notification.data?.url||'./');return w.focus();}}return clients.openWindow(e.notification.data?.url||'./');}));
});
