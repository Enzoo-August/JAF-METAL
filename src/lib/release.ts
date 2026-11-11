/* Programação de entregas do cliente (release): lê o arquivo que o cliente manda — texto exportado do sistema dele
 * (SAP e parecidos), CSV ou Excel — e devolve as entregas: código da peça, pedido/contrato, data e quantidade.
 * O sistema descobre sozinho qual coluna é o quê (pelo conteúdo e pelo cadastro dos produtos); dá para trocar na tela.
 * Nada sai do aparelho aqui: só o que a pessoa confirmar vai para o banco. */

export class ErroRelease extends Error {}

export interface Grade { nome: string; linhas: string[][]; colunas: number }
export type CampoRel = 'codigo' | 'qtd' | 'prazo' | 'pedido' | 'descricao' | 'nf' | 'nf_data' | 'nf_qtd'
export type Mapa = Partial<Record<CampoRel, number>>          // campo → coluna (0, 1, 2…)
export interface LinhaRel { codigo: string; pedido: string; prazo: string; qtd: number; descricao: string }
export interface UltimaNF { codigo: string; nf: string; data: string | null; qtd: number | null }
export interface Leitura { linhas: LinhaRel[]; ignoradas: number; ultimas: UltimaNF[]; de: string; ate: string; pecas: number }

const limpa = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim()

// "1.490" → 1490 · "240,000" → 240 · "1,5" → 1.5 · "12.5" → 12.5
export function numBR(s: string): number | null {
  let t = limpa(s).replace(/\s/g, '')
  if (!t || !/^-?[\d.,]+$/.test(t) || !/\d/.test(t)) return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// 05.11.2026 · 05/11/2026 · 05/11/26 · 05-11-2026 · 2026-11-05 → 2026-11-05
export function dataBR(s: string): string | null {
  const t = limpa(s)
  let d = 0, m = 0, a = 0
  let r = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})$/.exec(t)
  if (r) { d = +r[1]; m = +r[2]; a = +r[3]; if (a < 100) a += 2000 }
  else if ((r = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(t))) { a = +r[1]; m = +r[2]; d = +r[3] }
  else return null
  if (a < 2000 || a > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(a, m - 1, d)
  if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// a data que vem no nome do arquivo ("RELEASE 03.11.2026.TXT")
export function dataDoNome(nome: string): string | null {
  const r = /(\d{2})[.\-_ ](\d{2})[.\-_ ](\d{4})/.exec(nome) || /(\d{2})[.\-_](\d{2})[.\-_](\d{2})(?!\d)/.exec(nome)
  return r ? dataBR(`${r[1]}/${r[2]}/${r[3]}`) : null
}

// ------------------------------------------------------------------ arquivo → grade de células
function separar(texto: string): string[][] {
  const ls = texto.split(/\r?\n/)
  const cheias = ls.filter(l => l.trim())
  let sep = '\t'
  for (const s of ['\t', ';', '|', ',']) {
    const ok = cheias.filter(l => l.split(s).length >= 4).length
    if (ok >= Math.max(1, cheias.length * 0.6)) { sep = s; break }
  }
  return ls.map(l => l.split(sep).map(c => limpa(c.replace(/^"(.*)"$/, '$1'))))
}

export async function lerGrade(arq: File): Promise<Grade> {
  if (arq.size > 15 * 1024 * 1024) throw new ErroRelease('Arquivo grande demais (o limite é 15 MB).')
  const buf = await arq.arrayBuffer()
  let linhas: string[][]
  if (/\.(xlsx|xlsm|xls)$/i.test(arq.name)) {
    const X = await import('xlsx')
    const wb = X.read(buf, { cellDates: true })
    // a aba com mais linhas
    let melhor: unknown[][] = []
    for (const n of wb.SheetNames) {
      const l = X.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: true, defval: '' })
      if (l.length > melhor.length) melhor = l
    }
    linhas = melhor.map(l => (l as unknown[]).map(c => {
      if (c instanceof Date) return `${String(c.getDate()).padStart(2, '0')}/${String(c.getMonth() + 1).padStart(2, '0')}/${c.getFullYear()}`
      if (typeof c === 'number') return String(c).replace('.', ',')
      return limpa(c)
    }))
  } else {
    const bytes = new Uint8Array(buf)
    if (bytes.subarray(0, 4000).includes(0)) throw new ErroRelease('Este arquivo não é de texto. Use o arquivo .TXT, .CSV ou Excel que o cliente mandou.')
    let texto: string
    try { texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { texto = new TextDecoder('windows-1252').decode(bytes) }
    linhas = separar(texto.replace(/^﻿/, ''))
  }
  const colunas = linhas.reduce((n, l) => Math.max(n, l.length), 0)
  if (!linhas.some(l => l.filter(Boolean).length >= 3)) throw new ErroRelease('Não achei linhas de pedido neste arquivo. Confira se é o arquivo da programação (release) do cliente.')
  return { nome: arq.name, linhas, colunas }
}

// ------------------------------------------------------------------ qual coluna é o quê
const DICAS: [CampoRel, RegExp][] = [
  ['nf_data', /(dt|data).*(nf|nota|receb)|ult.*(entrega|receb)/], ['nf_qtd', /(qtd|quant).*(nf|nota|receb)/], ['nf', /^(nf|nota|n[ºo°.]? ?nf|nota fiscal)/],
  ['prazo', /entrega|prazo|data|date|dt\b|venc/], ['qtd', /qtd|qtde|quant|saldo|qty/],
  ['pedido', /pedido|ordem|contrato|programa|\bpo\b|\boc\b|doc/], ['descricao', /descri|denomina|texto|nome/], ['codigo', /c[oó]d|material|pe[cç]a|part|produto|refer/],
]
const semAcento = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

interface Col { n: number; cheias: number; datas: number; nums: number; ids: number; nfs: number; letras: number; conhecidos: number; distintos: number; tam: number }

function estatisticas(g: Grade, conhecidos: Set<string>): { cols: Col[]; dados: string[][] } {
  const dados = g.linhas.filter(l => l.filter(Boolean).length >= 3)
  const cols: Col[] = []
  for (let n = 0; n < g.colunas; n++) {
    const vals = dados.map(l => l[n] || '').filter(Boolean)
    cols.push({
      n, cheias: vals.length,
      datas: vals.filter(v => dataBR(v)).length,
      nums: vals.filter(v => numBR(v) !== null).length,
      ids: vals.filter(v => /^\d{6,}$/.test(v)).length,
      nfs: vals.filter(v => /^\d{3,}-\d{1,3}$/.test(v)).length,
      letras: vals.filter(v => /[a-zA-ZÀ-ú]{3}/.test(v)).length,
      conhecidos: vals.filter(v => conhecidos.has(v.toLowerCase())).length,
      distintos: new Set(vals).size,
      tam: vals.length ? vals.reduce((s, v) => s + v.length, 0) / vals.length : 0,
    })
  }
  return { cols, dados }
}

// conhecidos: códigos do cadastro (código do cliente e código JAF), em minúsculas
export function detectar(g: Grade, conhecidos: Set<string>): Mapa {
  const { cols, dados } = estatisticas(g, conhecidos)
  const m: Mapa = {}
  const livre = (c: Col) => !Object.values(m).includes(c.n)
  const maior = (l: Col[], f: (c: Col) => number): Col | undefined => l.filter(livre).sort((a, b) => f(b) - f(a))[0]
  const quase = (parte: number, c: Col, min = 0.8) => c.cheias > 0 && parte / c.cheias >= min && c.cheias >= dados.length * 0.5

  // 1) cabeçalho, se tiver (a primeira linha só de nomes)
  const cab = g.linhas.slice(0, 15).find(l => l.filter(Boolean).length >= 3 && l.filter(c => c && numBR(c) === null && !dataBR(c)).length >= l.filter(Boolean).length * 0.8
    && l.some(c => DICAS.some(([, re]) => re.test(semAcento(c)))))
  // a coluna em que mais códigos batem com o cadastro é a do código (vale mais que o nome da coluna)
  const pelaBase = cols.filter(x => x.cheias > 0 && x.conhecidos / x.cheias >= 0.3).sort((a, b) => b.conhecidos - a.conhecidos)[0]
  if (pelaBase) m.codigo = pelaBase.n
  if (cab) {
    for (const [campo, re] of DICAS) {
      if (m[campo] !== undefined) continue
      const n = cab.findIndex((c, k) => !!c && re.test(semAcento(c)) && !Object.values(m).includes(k))
      if (n >= 0) m[campo] = n
    }
  }
  // 2) pelo conteúdo
  const nf = maior(cols.filter(c => quase(c.nfs, c)), c => c.cheias)
  if (m.nf === undefined && nf) m.nf = nf.n
  if (m.prazo === undefined) { const c = maior(cols.filter(x => quase(x.datas, x)), x => x.distintos); if (c) m.prazo = c.n }
  if (m.nf !== undefined && m.nf_data === undefined) { const c = cols.filter(x => livre(x) && quase(x.datas, x) && x.n > m.nf!)[0]; if (c) m.nf_data = c.n }
  if (m.codigo === undefined) {
    const c = maior(cols.filter(x => x.cheias > 0 && x.conhecidos / x.cheias >= 0.3), x => x.conhecidos)
      || maior(cols.filter(x => quase(x.cheias, x) && x.datas === 0 && x.letras < x.cheias * 0.9 && x.tam >= 4 && x.tam <= 25 && x.distintos > 1 && x.nums < x.cheias * 0.9), x => x.distintos)
    if (c) m.codigo = c.n
  }
  if (m.pedido === undefined) { const c = maior(cols.filter(x => quase(x.ids, x) && x.distintos > 1), x => x.distintos); if (c) m.pedido = c.n }
  if (m.qtd === undefined) {
    const c = maior(cols.filter(x => quase(x.nums, x, 0.9) && x.datas < x.cheias * 0.2 && x.ids < x.cheias * 0.5 && x.distintos > 1 && (m.nf_data === undefined || x.n < m.nf_data)), x => x.distintos)
      || maior(cols.filter(x => quase(x.nums, x, 0.9) && x.datas < x.cheias * 0.2 && x.ids < x.cheias * 0.5 && x.distintos > 1), x => x.distintos)
    if (c) m.qtd = c.n
  }
  if (m.nf_data !== undefined && m.nf_qtd === undefined) { const c = cols.filter(x => livre(x) && quase(x.nums, x, 0.9) && x.n > m.nf_data!)[0]; if (c) m.nf_qtd = c.n }
  if (m.descricao === undefined) { const c = maior(cols.filter(x => quase(x.letras, x, 0.7) && x.tam >= 6 && x.distintos > 1), x => x.distintos); if (c) m.descricao = c.n }
  return m
}

// exemplo de cada coluna (para a pessoa escolher na tela)
export function exemplos(g: Grade): string[] {
  const dados = g.linhas.filter(l => l.filter(Boolean).length >= 3)
  const ex: string[] = []
  for (let n = 0; n < g.colunas; n++) ex.push((dados.find((l, i) => i >= Math.min(2, dados.length - 1) && l[n]) || dados.find(l => l[n]) || [])[n] || '')
  return ex
}

// ------------------------------------------------------------------ grade + mapa → entregas
export function montar(g: Grade, m: Mapa, conhecidos: Set<string>): Leitura {
  const linhas: LinhaRel[] = [], ultimas = new Map<string, UltimaNF>()
  let ignoradas = 0
  const cel = (l: string[], n: number | undefined) => (n === undefined ? '' : l[n] || '')
  for (const l of g.linhas) {
    if (l.filter(Boolean).length < 3) continue
    const prazo = dataBR(cel(l, m.prazo)), qtd = numBR(cel(l, m.qtd))
    let codigo = cel(l, m.codigo), descricao = cel(l, m.descricao)
    if (!codigo) {
      // código junto do texto ("B40.010.569 - EIXO"): acha pelo cadastro
      for (const c of l) {
        const p = c.split(/\s+-\s+|\s{2,}/)[0]
        if (p && p !== c && conhecidos.has(p.toLowerCase())) { codigo = p; descricao = c.slice(p.length).replace(/^[\s-]+/, ''); break }
      }
      if (!codigo && descricao.includes(' - ')) { const p = descricao.split(' - ')[0].trim(); if (/\d/.test(p) && !/\s/.test(p)) { codigo = p; descricao = descricao.slice(descricao.indexOf(' - ') + 3).trim() } }
    }
    if (!prazo || qtd === null || qtd < 0 || !codigo) { if (prazo || qtd !== null) ignoradas++; continue }
    linhas.push({ codigo, pedido: cel(l, m.pedido), prazo, qtd, descricao })
    const nf = cel(l, m.nf)
    if (nf && !ultimas.has(codigo)) ultimas.set(codigo, { codigo, nf, data: dataBR(cel(l, m.nf_data)), qtd: numBR(cel(l, m.nf_qtd)) })
  }
  // linha de cabeçalho não conta como ignorada
  const datas = linhas.map(x => x.prazo).sort()
  return { linhas, ignoradas: Math.max(0, ignoradas), ultimas: [...ultimas.values()], de: datas[0] || '', ate: datas[datas.length - 1] || '', pecas: new Set(linhas.map(x => x.codigo.toLowerCase())).size }
}
