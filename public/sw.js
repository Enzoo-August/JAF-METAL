/* JAF Metal — funciona como aplicativo e abre sem internet (só consulta).
 * Arquivos do site: busca na rede primeiro (sempre a versão nova); sem rede, usa a cópia guardada.
 * Bibliotecas externas (versão fixa): guardadas.
 * Banco (Supabase): nunca guardado aqui. */
const CACHE = 'jaf-2.0.0';

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return;
  if (url.hostname === 'brasilapi.com.br' || url.hostname === 'viacep.com.br') return;
  const externo = url.origin !== location.origin;
  if (externo) {
    // CDN com versão fixa no endereço: pode guardar
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const r = await c.match(req);
      if (r) return r;
      const n = await fetch(req);
      if (n.ok) c.put(req, n.clone());
      return n;
    }));
    return;
  }
  e.respondWith(fetch(req).then((n) => {
    if (n.ok) { const cp = n.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
    return n;
  }).catch(() => caches.match(req, { ignoreSearch: false }).then(r => r || caches.match('./'))));
});
