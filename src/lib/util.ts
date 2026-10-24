/* JAF Metal — utilidades (formatação, datas, busca). Sem React e sem DOM no topo: roda também no Node (testes). */

const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nfQ = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 })
const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

type Num = number | string | null | undefined

// ---------- texto
export const sem = (s: unknown): string => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export const limpa = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim()
export const cap = (s: unknown): string => { const t = String(s ?? ''); return t.charAt(0).toUpperCase() + t.slice(1) }
export const plural = (n: number, um: string, varios?: string): string => `${qtd(n)} ${Math.abs(n) === 1 ? um : (varios || um + 's')}`

// ---------- números
export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let t = String(v).trim().replace(/[R$\s]/g, '')
  if (!t) return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
export const r2 = (n: Num): number => Math.round((Number(n) || 0) * 100) / 100
export const r4 = (n: Num): number => Math.round((Number(n) || 0) * 10000) / 10000
export const moeda = (n: Num): string => (n === null || n === undefined || n === '') ? '—' : 'R$ ' + nf2.format(Number(n) || 0)
export const moeda0 = (n: Num): string => 'R$ ' + nf0.format(Math.round(Number(n) || 0))
export const dec = (n: Num): string => nf2.format(Number(n) || 0)
export const qtd = (n: Num): string => nfQ.format(Number(n) || 0)
export const pct = (n: Num): string => nf0.format(Math.round((Number(n) || 0) * 100)) + '%'
// valor para pôr dentro de um campo (sem separador de milhar)
export const campoNum = (n: Num, casas = 2): string => (n === null || n === undefined || n === '') ? '' : String(Number(Number(n).toFixed(casas))).replace('.', ',')
// preço com até 4 casas, sem zeros sobrando depois dos centavos
export const campoPreco = (n: Num): string => campoNum(n, 4).replace(/(,\d\d)0+$/, '$1')

// ---------- datas (sempre no fuso de São Paulo)
export const hoje = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
export const agoraSP = (): Date => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
export const d = (iso: string | null | undefined): Date | null => {
  if (!iso) return null
  const [y, m, dd] = String(iso).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, dd)
}
export const iso = (dt: Date): string => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
export const somaDias = (i: string, n: number): string => { const x = d(i)!; x.setDate(x.getDate() + n); return iso(x) }
export const somaMeses = (i: string, n: number): string => {
  const x = d(i)!; const dia = x.getDate(); x.setDate(1); x.setMonth(x.getMonth() + n)
  const ult = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate(); x.setDate(Math.min(dia, ult)); return iso(x)
}
export const dias = (a: string, b: string): number => Math.round((d(b)!.getTime() - d(a)!.getTime()) / 86400000) // b − a em dias
export const data = (i: string | null | undefined): string => { if (!i) return '—'; const s = String(i).slice(0, 10).split('-'); return `${s[2]}/${s[1]}/${s[0]}` }
export const dataCurta = (i: string | null | undefined): string => { if (!i) return '—'; const s = String(i).slice(0, 10).split('-'); return `${s[2]}/${s[1]}/${s[0].slice(2)}` }
export const dataHora = (ts: string | null | undefined): string => {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}
export const mes = (i: string): string => d(i)!.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '').replace(' de ', '/')
export const nomeMes = (m: number): string => ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][m - 1]
export const relativo = (i: string | null | undefined): string => {
  if (!i) return ''
  const n = dias(hoje(), i)
  if (n === 0) return 'hoje'
  if (n === 1) return 'amanhã'
  if (n === -1) return 'ontem'
  if (n > 1 && n < 7) return `em ${n} dias`
  if (n < -1 && n > -7) return `há ${-n} dias`
  return data(i)
}

// ---------- ids
export const uuid = (): string => globalThis.crypto.randomUUID()

// ---------- busca por relevância (palavras em qualquer ordem). campos(x): [texto principal, ...outros]
export function buscar<T>(lista: readonly T[], termo: string, campos: (x: T) => string[], limite = 0): T[] {
  const t = sem(limpa(termo))
  if (!t) return limite ? lista.slice(0, limite) : lista.slice()
  const palavras = t.split(' ')
  const tj = t.replace(/[\s.\-/]/g, '')
  const res: [number, T][] = []
  for (const item of lista) {
    const cs = campos(item).map(c => sem(c))
    const tudo = cs.join(' ')
    if (!palavras.every(p => tudo.includes(p))) {
      // código digitado sem espaço/ponto: "dnmg150604" acha "DNMG 150604"
      if (!(tj.length >= 3 && cs[0].replace(/[\s.\-/]/g, '').includes(tj))) continue
    }
    const c0 = cs[0], c0j = c0.replace(/[\s.\-/]/g, '')
    let s = 0
    if (c0 === t || c0j === tj) s = 1000
    else if (c0.startsWith(t) || c0j.startsWith(tj)) s = 500
    else if (c0.split(/[\s(/]/).some(w => w.startsWith(palavras[0]))) s = 200
    else if (cs.slice(1).some(c => c.startsWith(t))) s = 150
    else if (c0.includes(t)) s = 100
    s -= c0.length / 1000
    res.push([s, item])
  }
  res.sort((a, b) => b[0] - a[0])
  const out = res.map(r => r[1])
  return limite ? out.slice(0, limite) : out
}

// ---------- listas
export function agrupar<T, K>(lista: readonly T[], chave: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>()
  for (const x of lista) { const k = chave(x); let g = m.get(k); if (!g) m.set(k, g = []); g.push(x) }
  return m
}
export function soma<T>(lista: readonly T[], f: keyof T | ((x: T) => unknown)): number {
  return lista.reduce((s, x) => s + (Number(typeof f === 'function' ? f(x) : x[f]) || 0), 0)
}
export function ordenar<T>(lista: readonly T[], f: (x: T) => string | number, desc = false): T[] {
  return lista.slice().sort((a, b) => { const x = f(a), y = f(b); const r = x < y ? -1 : x > y ? 1 : 0; return desc ? -r : r })
}
export const unicos = <T,>(l: readonly T[]): T[] => [...new Set(l)]

// ---------- telefone, site
export const tel = (t: unknown): string => String(t || '').replace(/\(0xx(\d\d)\)/i, '($1)').trim()
export const telZap = (t: unknown): string => { let x = String(t || '').replace(/^\(0xx/i, '(').replace(/\D/g, ''); if (!x) return ''; if (x.length <= 11) x = '55' + x; return x }
export const ehCelular = (t: unknown): boolean => /^\d{2}9\d{8}$/.test(String(t || '').replace(/^\(0xx/i, '(').replace(/\D/g, ''))
export const site = (s: unknown): string => { const t = String(s || '').trim(); if (!t || /^mailto:/i.test(t)) return ''; return /^https?:\/\//i.test(t) ? t : 'https://' + t }

// ---------- navegador
export const debounce = <A extends unknown[]>(fn: (...a: A) => void, ms = 200) => {
  let t: ReturnType<typeof setTimeout> | undefined
  return (...a: A) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }
}
export async function copiar(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true } catch {
    const t = document.createElement('textarea'); t.value = texto; document.body.appendChild(t); t.select()
    let ok = false; try { ok = document.execCommand('copy') } catch { /* sem cópia */ } t.remove(); return ok
  }
}
export const lerLocal = <T,>(k: string, padrao: T): T => { try { const v = localStorage.getItem(k); return v === null ? padrao : JSON.parse(v) as T } catch { return padrao } }
export const gravarLocal = (k: string, v: unknown): void => { try { if (v === null || v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)) } catch { /* modo privado */ } }

// salva um arquivo: no celular abre o "compartilhar"; no computador, "Salvar como" quando dá
export async function salvarArquivo(blob: Blob, nome: string): Promise<boolean> {
  const arq = new File([blob], nome, { type: blob.type })
  const celular = matchMedia('(pointer: coarse)').matches
  if (celular && navigator.canShare && navigator.canShare({ files: [arq] })) {
    // no iPhone o "compartilhar" só vale logo depois do toque; se demorou, quem chamou mostra um botão novo
    try { await navigator.share({ files: [arq], title: nome }); return true } catch (e) { if ((e as Error).name === 'AbortError') return false; throw e }
  }
  const w = window as Window & { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }
  if (w.showSaveFilePicker && !celular) {
    try {
      const ext = nome.split('.').pop() || ''
      const h = await w.showSaveFilePicker({ suggestedName: nome, id: 'jaf-' + ext,
        types: [{ description: ext.toUpperCase(), accept: { [blob.type || 'application/octet-stream']: ['.' + ext] } }] })
      const s = await h.createWritable(); await s.write(blob); await s.close(); return true
    } catch (e) { if ((e as Error).name === 'AbortError') return false }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
  return true
}
