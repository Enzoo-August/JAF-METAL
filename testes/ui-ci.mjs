// Roda os testes de tela num navegador de verdade (sem ninguém clicando).
// Usado pelo GitHub Actions; também roda no computador.
//   URL=http://localhost:8000 node testes/ui-ci.mjs
// Precisa do pacote "playwright" (ou "playwright-core" com um Chrome/Edge instalado: CANAL=msedge).
import { createRequire } from 'node:module'
import path from 'node:path'

const req = createRequire(path.join(process.env.PLAYWRIGHT_DIR || process.cwd(), 'package.json'))
let pw
try { pw = req('playwright') } catch (e) { pw = req('playwright-core') }
const URL_BASE = process.env.URL || 'http://localhost:8000'
const navegador = await pw.chromium.launch(process.env.CANAL ? { channel: process.env.CANAL } : {})
let falhou = false

async function abrir(largura, altura, toque) {
  const ctx = await navegador.newContext({ viewport: { width: largura, height: altura }, hasTouch: !!toque, isMobile: !!toque, deviceScaleFactor: 1 })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => { console.log('  ERRO NA PÁGINA:', e.message); falhou = true })
  await p.goto(URL_BASE + '/?modo=teste&banco=memoria', { waitUntil: 'load' })
  await p.waitForFunction(() => document.querySelector('#fLogin') || document.querySelector('.casca'), null, { timeout: 120000 })
  return { ctx, p }
}

// 1) roteiro completo pelas telas: computador e celular (com toque)
for (const [w, h, toque] of [[1366, 768, false], [375, 812, true]]) {
  const { ctx, p } = await abrir(w, h, toque)
  await p.evaluate(async () => { eval(await fetch('testes/roteiro-ui.js').then(r => r.text())); window.roteiro(); })
  await p.waitForFunction(() => window.__r?.fim, null, { timeout: 300000 })
  const r = await p.evaluate(() => window.__r)
  console.log(`Roteiro pelas telas (${w}x${h}): ${r.ok} OK, ${r.falhas.length} falha(s)`)
  r.falhas.forEach(f => console.log('  ✗ ' + f))
  if (r.falhas.length) falhou = true
  await ctx.close()
}

// 2) varredura de layout, 4 perfis, celular / tablet / computador
for (const [w, h, toque, sat] of [[375, 812, true, 47], [360, 640, true, 24], [768, 1024, true, 0], [1366, 768, false, 0]]) {
  const { ctx, p } = await abrir(w, h, toque)
  await p.evaluate(async () => { eval(await fetch('testes/auditoria.js').then(r => r.text())); })
  const r = await p.evaluate(async (opt) => window.auditarPerfis(opt), { sat, toque })
  const total = Object.values(r.res).reduce((s, l) => s + l.length, 0)
  console.log(`Layout ${r.tam}: ${total} problema(s)`)
  for (const [perfil, l] of Object.entries(r.res)) l.slice(0, 10).forEach(x => console.log(`  ✗ [${perfil}] ${x}`))
  if (total) falhou = true
  await ctx.close()
}

await navegador.close()
process.exit(falhou ? 1 : 0)
