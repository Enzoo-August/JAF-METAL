// Roda os testes de tela num navegador de verdade (sem ninguém clicando), no build de TESTE (dados inventados).
// Usado pelo GitHub Actions; também roda no computador:
//   npm run build:teste && node testes/ui-ci.mjs
// Opcional: CANAL=msedge (ou chrome) para usar o navegador já instalado em vez do Chromium do Playwright.
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from 'playwright'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pasta = path.join(raiz, 'dist-teste')
if (!existsSync(path.join(pasta, 'index.html'))) { console.log('Falta o build de teste: rode "npm run build:teste" antes.'); process.exit(2) }

// servidor simples só para esta pasta
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.data': 'application/octet-stream', '.tar.gz': 'application/gzip' }
const servidor = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p.endsWith('/')) p += 'index.html'
  const arq = path.join(pasta, path.normalize(p))
  if (!arq.startsWith(pasta)) { res.writeHead(404); res.end(); return }
  let corpo // lê direto (sem conferir antes e ler depois): não existe = 404
  try { corpo = readFileSync(arq) } catch { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream' })
  res.end(corpo)
}).listen(0, '127.0.0.1')
await new Promise(ok => servidor.once('listening', ok))
const URL_BASE = `http://localhost:${servidor.address().port}`

const roteiro = readFileSync(path.join(raiz, 'testes', 'roteiro-ui.js'), 'utf8')
const auditoria = readFileSync(path.join(raiz, 'testes', 'auditoria.js'), 'utf8')
const navegador = await chromium.launch(process.env.CANAL ? { channel: process.env.CANAL } : {})
let falhou = false

async function abrir(largura, altura, toque) {
  const ctx = await navegador.newContext({ viewport: { width: largura, height: altura }, hasTouch: !!toque, isMobile: !!toque, deviceScaleFactor: 1 })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => { console.log('  ERRO NA PÁGINA:', e.message); falhou = true })
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) console.log('  console:', m.text().slice(0, 300)) })
  await p.goto(URL_BASE + '/?banco=memoria', { waitUntil: 'load' })
  await p.waitForFunction(() => document.querySelector('#fLogin') || document.querySelector('.casca'), null, { timeout: 180000 })
  return { ctx, p }
}

// 1) roteiro completo pelas telas: computador e celular (com toque)
for (const [w, h, toque] of [[1366, 768, false], [375, 812, true]]) {
  const { ctx, p } = await abrir(w, h, toque)
  await p.evaluate((codigo) => { (0, eval)(codigo); window.roteiro() }, roteiro)
  await p.waitForFunction(() => window.__r?.fim, null, { timeout: 400000 })
  const r = await p.evaluate(() => window.__r)
  console.log(`Roteiro pelas telas (${w}x${h}): ${r.ok} OK, ${r.falhas.length} falha(s)`)
  r.falhas.forEach(f => console.log('  ✗ ' + f))
  if (r.falhas.length) falhou = true
  await ctx.close()
}

// 2) varredura de layout, 7 perfis, celular / tablet / computador
for (const [w, h, toque, sat] of [[375, 812, true, 47], [360, 640, true, 24], [768, 1024, true, 0], [1366, 768, false, 0]]) {
  const { ctx, p } = await abrir(w, h, toque)
  await p.evaluate((codigo) => { (0, eval)(codigo) }, auditoria)
  const r = await p.evaluate(async (opt) => window.auditarPerfis(opt), { sat, toque })
  const total = Object.values(r.res).reduce((s, l) => s + l.length, 0)
  console.log(`Layout ${r.tam}: ${total} problema(s)`)
  for (const [perfil, l] of Object.entries(r.res)) l.slice(0, 10).forEach(x => console.log(`  ✗ [${perfil}] ${x}`))
  if (total) falhou = true
  await ctx.close()
}

await navegador.close()
servidor.close()
process.exit(falhou ? 1 : 0)
