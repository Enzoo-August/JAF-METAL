// Importa a planilha REAL num banco local (PGlite) e confere peça por peça.
// Nada sai do computador. Os dados reais não são gravados em arquivo nenhum.
// Rodar:  PGLITE=<pasta com node_modules> PLANILHA=<caminho do .xlsm> node testes/importacao-real.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = process.env.PGLITE || '.'
const req = createRequire(path.join(base, 'package.json'))
const XLSX = req('xlsx')
const imp = (p) => import(pathToFileURL(path.join(base, 'node_modules', '@electric-sql', 'pglite', 'dist', p)).href)
const { PGlite } = await imp('index.js')
const { pgcrypto } = await imp('contrib/pgcrypto.js')
process.on('unhandledRejection', e => { console.log('ERRO:', e.message, '|', e.where || ''); process.exit(2) })

// carrega util.js e importar.js como o navegador faria
const ctx = vm.createContext({ XLSX, console, Intl, Date, Math, Number, String, Object, Array, Set, Map, JSON, RegExp, Error, isFinite, crypto: globalThis.crypto })
for (const f of ['js/util.js', 'js/importar.js']) vm.runInContext(readFileSync(path.join(raiz, f), 'utf8') + '\n;this.U = typeof U !== "undefined" ? U : this.U; this.Importar = typeof Importar !== "undefined" ? Importar : this.Importar;', ctx)
const { U, Importar } = ctx

const wb = XLSX.read(readFileSync(process.env.PLANILHA), { cellDates: true })
const r = Importar.ler(wb, path.basename(process.env.PLANILHA))

let ok = 0; const falhas = []
const conf = (c, nome, extra) => { if (c) ok++; else falhas.push(nome + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')) }

console.log('Fornecedores:', r.fornecedores.length, '| novos (só nas abas):', r.novos.length, r.novos.join(', '))
console.log('Peças:', r.pecas.length, '| Movimentações:', r.movs.length, '| Pedidos:', r.pedidos.length, '(aguardando:', r.pedidos.filter(p => p.status === 'aguardando').length + ')')
console.log('Avisos:'); r.avisos.forEach(a => console.log('  -', a))
console.log('Ignoradas:'); r.ignoradas.forEach(a => console.log('  -', a))
console.log('Ligação de nomes de fornecedor:')
for (const [n, fin] of [...r.mapa.entries()].sort()) { const f = r.fornecedores.find(x => x.nome === fin); console.log(`  ${n.padEnd(36)} → ${fin}${f?.razao ? '  [' + f.razao + ']' : ''}`) }
console.log('Máquinas sugeridas:', r.utils.filter(u => Importar.sugerirMaquina(u)).join(' | '))
console.log('Não sugeridas:', r.utils.filter(u => !Importar.sugerirMaquina(u)).join(' | '))

conf(r.diverg.length === 0, 'estoque da aba Peças = soma da aba Estoque', r.diverg.map(p => p.codigo))
// o esperado vem da própria planilha (nada de número fixo aqui: o repositório é público)
const abaP = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames.find(n => /pe.as/i.test(n))], { defval: null }).filter(l => l['Código'] !== null)
const abaE = XLSX.utils.sheet_to_json(wb.Sheets['Estoque'], { defval: null }).filter(l => l['Data'] && l['Código'])
const linhasQtd = abaE.filter(l => l['Entrada'] > 0 || l['Saída'] > 0)
conf(r.pecas.length === abaP.length, 'todas as peças da aba Peças', [r.pecas.length, abaP.length])
conf(r.movs.length === linhasQtd.length, 'todas as linhas da aba Estoque com quantidade', [r.movs.length, linhasQtd.length])
conf(r.ignoradas.length === abaE.length - linhasQtd.length, 'só ficam de fora as linhas sem quantidade', r.ignoradas)

// grava num banco local de verdade
const db = await PGlite.create({ extensions: { pgcrypto } })
await db.exec(readFileSync(path.join(raiz, 'supabase', 'auth-simulado.sql'), 'utf8'))
await db.exec(readFileSync(path.join(raiz, 'supabase', 'schema.sql'), 'utf8'))
const dono = (await db.query(`select public.primeiro_dono('teste', 'senha-forte-1', 'Teste') as id`)).rows[0].id
const maquinas = r.utils.filter(u => Importar.sugerirMaquina(u)).map(nome => ({ nome }))
const t0 = Date.now()
const res = await db.transaction(async (tx) => {
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: dono })])
  await tx.exec('set local role authenticated')
  return (await tx.query(`select public.importar_planilha($1::jsonb, false) as r`, [JSON.stringify({ fornecedores: r.fornecedores, pecas: r.pecas, maquinas, movimentos: r.movs, pedidos: r.pedidos })])).rows[0].r
})
console.log('Importação no banco:', JSON.stringify(res), `(${Date.now() - t0} ms; o Supabase corta em 8 s)`)
conf(Date.now() - t0 < 4000, 'importação rápida o bastante para o limite do Supabase')
conf(res.movimentos === r.movs.length && res.sem_peca.length === 0, 'todas as movimentações entraram', res)

// confere peça por peça com a coluna "Qde Estoque" da planilha
const est = new Map((await db.query(`select codigo, estoque::float e from public.pecas`)).rows.map(x => [x.codigo.toLowerCase(), x.e]))
const wsP = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames.find(n => /pe.as/i.test(n))], { defval: null })
let iguais = 0, difs = []
for (const l of wsP) { if (l['Código'] === null) continue; const cod = String(l['Código']).replace(/\s+/g, ' ').trim().toLowerCase(); const e = est.get(cod); if (e === Number(l['Qde Estoque'] || 0)) iguais++; else difs.push([cod, l['Qde Estoque'], e]) }
conf(difs.length === 0, `estoque no banco = planilha em todas as peças (${iguais} iguais)`, difs.slice(0, 10))

// totais por ano iguais aos da planilha
const tot = (await db.query(`select extract(year from data)::int ano, sum(case when tipo='entrada' then qtd*preco_unit else 0 end)::float ent, sum(case when tipo='saida' then qtd*preco_unit else 0 end)::float sai from public.movimentos group by 1 order by 1`)).rows
const wsE = XLSX.utils.sheet_to_json(wb.Sheets['Estoque'], { defval: null })
const plan = {}
for (const l of wsE) { if (!(l['Data'] instanceof Date)) continue; const a = l['Data'].getFullYear() + (l['Data'].getHours() > 12 ? 0 : 0); plan[a] = plan[a] || { e: 0, s: 0 }; plan[a].e += (l['Entrada'] || 0) * (l['R$ Unitário'] || 0); plan[a].s += (l['Saída'] || 0) * (l['R$ Unitário'] || 0) }
for (const t of tot) conf(Math.abs(t.ent - (plan[t.ano]?.e || 0)) < 0.01 && Math.abs(t.sai - (plan[t.ano]?.s || 0)) < 0.01, `valores de ${t.ano} iguais à planilha`, [t, plan[t.ano]])

// pedidos
const peds = (await db.query(`select status, count(*)::int n from public.pedidos_compra group by 1 order by 1`)).rows
console.log('Pedidos no banco:', JSON.stringify(peds))
const itens = (await db.query(`select count(*)::int n, sum(valor)::float v from public.pedido_itens`)).rows[0]
const wsC = XLSX.utils.sheet_to_json(wb.Sheets['Controle de Pedidos'], { defval: null }).filter(l => l['Código'])
conf(itens.n === wsC.length, 'todas as linhas do Controle de Pedidos viraram itens', [itens.n, wsC.length])
conf(Math.abs(itens.v - wsC.reduce((s, l) => s + (l['Valor'] || 0), 0)) < 0.01, 'soma dos valores dos pedidos igual à planilha')
const aguard = (await db.query(`select pc.numero, f.nome, pc.prazo::text, string_agg(p.codigo || ' x' || i.qtd, ', ') itens from public.pedidos_compra pc join public.fornecedores f on f.id = pc.fornecedor_id join public.pedido_itens i on i.pedido_id = pc.id join public.pecas p on p.id = i.peca_id where pc.status = 'aguardando' group by 1,2,3 order by 1`)).rows
console.log('Pedidos aguardando:', JSON.stringify(aguard))

// valor do estoque pelo PEPS x saldo em R$ da planilha
const valPeps = (await db.query(`select sum(l.resta * l.preco_unit)::float v from public.pecas p, lateral public._lotes(p.id) l`)).rows[0].v
const saldoPlan = wsE.reduce((s, l) => s + (Number(l['Saldo (R$)']) || 0), 0)
console.log(`Valor do estoque: PEPS ${valPeps.toFixed(2)} | soma "Saldo (R$)" da planilha ${saldoPlan.toFixed(2)}`)
const comprar = (await db.query(`select count(*)::int n from public.pecas where ativo and estoque < est_min`)).rows[0].n
console.log('Peças abaixo do mínimo (Comprar):', comprar)
const comprarPlan = abaP.filter(l => l['Status'] === 'Comprar').length
conf(comprar === comprarPlan, 'lista de compras igual à da planilha (status "Comprar")', [comprar, comprarPlan])

console.log(`\n${ok} conferências OK, ${falhas.length} falha(s)`)
for (const f of falhas) console.log('  ✗ ' + f)
process.exit(falhas.length ? 1 : 0)
