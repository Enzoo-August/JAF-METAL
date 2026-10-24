// Importa a planilha REAL num banco local (PGlite) e confere peça por peça.
// Nada sai do computador. Os dados reais não são gravados em arquivo nenhum.
// Rodar (depois do npm install):  PLANILHA=<caminho do .xlsm> node testes/importacao-real.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as XLSX from 'xlsx'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import path from 'node:path'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.on('unhandledRejection', e => { console.log('ERRO:', e.message, '|', e.where || ''); process.exit(2) })

// o MESMO código de leitura que o site usa (TypeScript; o Node 22.18+ roda direto)
const Importar = await import(pathToFileURL(path.join(raiz, 'src', 'lib', 'importar.ts')).href)
const U = await import(pathToFileURL(path.join(raiz, 'src', 'lib', 'util.ts')).href)

const wb = XLSX.read(readFileSync(process.env.PLANILHA), { cellDates: true })
const r = Importar.ler(XLSX, wb, path.basename(process.env.PLANILHA))

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

// NADA da aba Fornecedores pode se perder: todo link escondido e toda linha sem nome aparece em algum fornecedor
{
  const ws = wb.Sheets['Fornecedores'], faixa = XLSX.utils.decode_range(ws['!ref'])
  const tudo = (await db.query(`select string_agg(concat_ws(' ', nome, razao, contato, contato2, telefone, celular, email, site, endereco, bairro, cidade, uf, cep, cnpj, ie, qualif_metodo, obs), ' | ') t from public.fornecedores`)).rows[0].t.toLowerCase()
  const k = (s) => String(s).trim().toLowerCase().replace(/^mailto:/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')
  const perdidos = []
  for (let r = 1; r <= faixa.e.r; r++) {
    const nome = ws[XLSX.utils.encode_cell({ r, c: 0 })]?.v
    for (let c = 0; c <= faixa.e.c; c++) {
      const cel = ws[XLSX.utils.encode_cell({ r, c })]; if (!cel) continue
      const vals = []
      if (cel.l?.Target && !cel.l.Target.startsWith('#')) vals.push(cel.l.Target)                                  // link escondido
      if (cel.v !== undefined && cel.v !== null && String(cel.v).trim()) vals.push(String(cel.v).replace(/\s+/g, ' '))   // qualquer valor
      // "O mesmo" (celular = telefone) é conferido abaixo
      for (const v of vals) if (!/^o mesmo$/i.test(v) && !tudo.includes(k(v).split('/')[0])) perdidos.push(`${XLSX.utils.encode_cell({ r, c })}${nome ? '' : ' (linha sem nome)'}: ${v}`)
    }
  }
  conf(perdidos.length === 0, 'nenhum valor, e-mail, site ou link da aba Fornecedores ficou de fora', perdidos.slice(0, 10))
  const oMesmo = XLSX.utils.sheet_to_json(ws, { defval: null }).filter(l => /^o mesmo$/i.test(String(l['CELULAR'] || '').trim())).length
  const celIgual = (await db.query(`select count(*)::int n from public.fornecedores where celular is not null and celular = telefone`)).rows[0].n
  conf(celIgual >= oMesmo, '"O mesmo" na coluna Celular vira o celular igual ao telefone', [celIgual, oMesmo])
}

// campo por campo: cada peça, cada movimentação e cada linha de pedido da planilha está no banco igualzinho
{
  const lp = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  const n3 = (v) => Number(v || 0).toFixed(3), n2 = (v) => Number(v || 0).toFixed(2), n4 = (v) => Number(v || 0).toFixed(4)
  const dia = (d) => d instanceof Date ? new Date(d.getTime() + 12 * 3600e3).toISOString().slice(0, 10) : ''
  const conta = (lista) => { const m = new Map(); for (const x of lista) m.set(x, (m.get(x) || 0) + 1); return m }
  const iguais = (a, b) => { const A = conta(a), B = conta(b); const dif = []; for (const [x, n] of A) if (B.get(x) !== n) dif.push(x); for (const [x, n] of B) if (A.get(x) !== n) dif.push('banco: ' + x); return dif }
  // Peças: código, descrição, utilização (sem os espaços de separação), mínimo, máximo
  const pBanco = (await db.query(`select codigo, descricao, coalesce(replace(utilizacao, ' / ', ' '), '') u, est_min, est_max from public.pecas where ativo`)).rows
    .map(x => [lp(x.codigo), lp(x.descricao), lp(x.u), n3(x.est_min), n3(x.est_max)].join('|'))
  const pPlan = abaP.map(l => [lp(l['Código']), lp(l['Descrição']), lp(String(l['Utilização'] ?? '').split(/\s{2,}|\s\/\s|\s+e\s+(?=[A-Z]{2,4}\s?\d)/).join(' ')), n3(l['Estoque Min.']), n3(l['Estoque Máx.'])].join('|'))
  const dp = iguais(pPlan, pBanco)
  conf(dp.length === 0, `cada peça igual à planilha em código, descrição, utilização, mínimo e máximo (${pPlan.length} peças)`, dp.slice(0, 6))
  // Estoque: data, código, entrada/saída, quantidade, preço, documento
  const mBanco = (await db.query(`select m.data::text d, p.codigo, m.tipo, m.qtd, m.preco_unit, coalesce(m.documento, '') doc from public.movimentos m join public.pecas p on p.id = m.peca_id`)).rows
    .map(x => [x.d, lp(x.codigo), x.tipo, n3(x.qtd), n4(x.preco_unit), lp(x.doc)].join('|'))
  const mPlan = linhasQtd.flatMap(l => [l['Entrada'] > 0 && 'entrada', l['Saída'] > 0 && 'saida'].filter(Boolean).map(t =>
    [dia(l['Data']), lp(l['Código']), t, n3(t === 'entrada' ? l['Entrada'] : l['Saída']), n4(l['R$ Unitário']), lp(l['Documento'])].join('|')))
  const dm = iguais(mPlan, mBanco)
  conf(dm.length === 0, `cada movimentação igual à planilha em data, código, tipo, quantidade, preço e documento (${mPlan.length})`, dm.slice(0, 6))
  // Controle de Pedidos: data, código, quantidade, valor, documento, prazo, situação
  const cBanco = (await db.query(`select pc.data::text d, p.codigo, i.qtd, i.valor, coalesce(pc.documento, '') doc, coalesce(pc.prazo::text, '') pz, pc.status from public.pedido_itens i join public.pedidos_compra pc on pc.id = i.pedido_id join public.pecas p on p.id = i.peca_id`)).rows
    .map(x => [x.d, lp(x.codigo), n3(x.qtd), n2(x.valor), lp(x.doc), x.pz, x.status === 'recebido' ? 'entregue' : 'aguardando'].join('|'))
  const cPlan = wsC.map(l => [dia(l['Data']), lp(l['Código']), n3(l['Qde']), n2(l['Valor']), lp(l['Documento']), dia(l['Prazo']), /entreg/i.test(l['Status'] || '') ? 'entregue' : 'aguardando'].join('|'))
  const dc = iguais(cPlan, cBanco)
  conf(dc.length === 0, `cada linha do Controle de Pedidos igual à planilha (${cPlan.length})`, dc.slice(0, 6))
}
// anotações da aba escondida e linha sem quantidade chegaram ao banco
const comObs = r.pecas.filter(p => p.obs).length
const obsBanco = (await db.query(`select count(*)::int n from public.pecas where obs is not null and obs <> 'Criada na importação: o código só aparecia no Controle de Pedidos'`)).rows[0].n
conf(comObs > 0 && obsBanco === comObs, 'anotações das peças (aba escondida e linha sem quantidade) gravadas no banco', [comObs, obsBanco])
const quebra = (await db.query(`select count(*)::int n from public.fornecedores where obs like '%' || chr(10) || '%'`)).rows[0].n
conf(quebra > 0, 'observações com várias linhas mantêm as quebras de linha', quebra)

console.log(`\n${ok} conferências OK, ${falhas.length} falha(s)`)
for (const f of falhas) console.log('  ✗ ' + f)
process.exit(falhas.length ? 1 : 0)
