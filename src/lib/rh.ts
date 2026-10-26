/* JAF Metal — contas do RH (sem tela, sem banco: roda também no Node para os testes).
 * Ponto (CLT 44 h), horas extras por faixa (como a planilha de horas extras), férias (período aquisitivo/concessivo),
 * experiência 30 + 30, ASO, reciclagem de treinamento e troca de EPI. */
import type { Funcionario, RhAso, RhAusencia, RhEpi, RhMatrizItem, RhNivel, RhPonto } from './tipos.ts'
import * as U from './util.ts'

// ------------------------------------------------------------------ jornada e regras (ficam em config 'rh')
export interface HorarioDia { e1: string; s1: string; e2: string; s2: string }
export interface Jornada {
  previstas: number[]                       // horas previstas por dia da semana (0 = domingo … 6 = sábado)
  padrao: (HorarioDia | null)[]             // horário de referência de cada dia (para a tolerância e o "preencher padrão")
  tolerancia: { ligada: boolean; marcacao: number; dia: number }   // CLT art. 58 §1º: 5 min por marcação, 10 min por dia
  divisor: number                           // horas do mês para achar o valor da hora (220 = 44 h semanais)
  faixas: [number, number, number]          // 25 h a 50%, mais 15 h a 60%, mais 20 h a 80%, o resto a 100%
  upgrade60: boolean                        // registro Upgrade: toda hora extra a 60% (como na planilha)
  branco: 'normal' | 'falta'                // dia útil sem lançamento: trabalhou normal (a planilha só registra exceções) ou falta depois de fechar o mês
}
const SEG_QUI: HorarioDia = { e1: '07:00', s1: '12:00', e2: '13:00', s2: '17:00' }
const SEX: HorarioDia = { e1: '07:00', s1: '12:00', e2: '13:00', s2: '16:00' }
export const JORNADA_PADRAO: Jornada = {
  previstas: [0, 9, 9, 9, 9, 8, 0],
  padrao: [null, SEG_QUI, SEG_QUI, SEG_QUI, SEG_QUI, SEX, null],
  tolerancia: { ligada: true, marcacao: 5, dia: 10 },
  divisor: 220,
  faixas: [25, 15, 20],
  upgrade60: true,
  branco: 'normal',
}
export function jornadaDe(cfg: unknown): Jornada {
  const c = (cfg && typeof cfg === 'object' ? (cfg as { jornada?: Partial<Jornada> }).jornada : null) || {}
  return { ...JORNADA_PADRAO, ...c, tolerancia: { ...JORNADA_PADRAO.tolerancia, ...(c.tolerancia || {}) } }
}

export const min = (h: string | null | undefined): number | null => {
  if (!h) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(h)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
export const hhmm = (minutos: number): string => `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`
// horas decimais → "8h30"
export const horas = (h: number): string => {
  const neg = h < 0, t = Math.round(Math.abs(h) * 60), hh = Math.floor(t / 60), mm = t % 60
  return (neg ? '−' : '') + (mm ? `${hh}h${String(mm).padStart(2, '0')}` : `${hh}h`)
}
export const diaSemana = (iso: string): number => U.d(iso)!.getDay()
export const NOME_DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

// ------------------------------------------------------------------ um dia do ponto
export type TipoDia = 'trabalho' | 'descanso' | 'domingo' | 'feriado' | 'ausencia' | 'vazio'
export interface DiaCalc {
  data: string; tipo: TipoDia; rotulo: string
  prev: number; trab: number; he: number; he100: number; atraso: number; abonado: number; falta: boolean
  travado: boolean                  // férias / afastamento / suspensão: não aceita horário
  tolerado: number                  // minutos ignorados pela tolerância
}
export interface InfoDia { feriado?: string | null; ausencia?: Pick<RhAusencia, 'tipo' | 'abona'> | null; fechado?: boolean; futuro?: boolean }

const ROTULO_AUS: Record<string, string> = { ferias: 'FÉRIAS', atestado: 'ATESTADO', afastamento: 'AFASTADO', licenca: 'LICENÇA', suspensao: 'SUSPENSÃO', folga: 'FOLGA', falta: 'FALTA', declaracao: 'DECLARAÇÃO' }
const ROTULO_JUST: Record<string, string> = { atestado: 'Atestado', declaracao: 'Declaração', licenca: 'Licença', folga: 'Folga', falta: 'Falta', abonado: 'Abonado', compensado: 'Compensado' }
export const TRAVA = new Set(['ferias', 'afastamento', 'licenca', 'suspensao'])

export function calcDia(data: string, p: Pick<RhPonto, 'e1' | 's1' | 'e2' | 's2' | 'justificativa'> | null, info: InfoDia, j: Jornada): DiaCalc {
  const dow = diaSemana(data)
  const feriado = info.feriado || null
  const prev = feriado ? 0 : (j.previstas[dow] || 0)
  const base: DiaCalc = { data, tipo: 'trabalho', rotulo: '', prev, trab: 0, he: 0, he100: 0, atraso: 0, abonado: 0, falta: false, travado: false, tolerado: 0 }
  const aus = info.ausencia
  if (aus) {
    base.tipo = 'ausencia'; base.rotulo = ROTULO_AUS[aus.tipo] || aus.tipo.toUpperCase(); base.travado = TRAVA.has(aus.tipo)
    if (aus.abona) base.abonado = prev; else if (prev > 0) base.falta = true
    return base
  }
  // horários com a tolerância da CLT (cada marcação até X min do horário de referência conta como o horário certo, até Y min no dia)
  const ref = !feriado ? j.padrao[dow] : null
  let restante = j.tolerancia.ligada ? j.tolerancia.dia : 0
  const marca = (v: string | null, r: string | undefined): number | null => {
    const m = min(v); if (m === null) return null
    if (!ref || !r || !j.tolerancia.ligada) return m
    const rm = min(r)!, dif = Math.abs(m - rm)
    if (dif > 0 && dif <= j.tolerancia.marcacao && dif <= restante) { restante -= dif; base.tolerado += dif; return rm }
    return m
  }
  const e1 = marca(p?.e1 ?? null, ref?.e1), s1 = marca(p?.s1 ?? null, ref?.s1), e2 = marca(p?.e2 ?? null, ref?.e2), s2 = marca(p?.s2 ?? null, ref?.s2)
  const trabMin = (e1 !== null && s1 !== null ? s1 - e1 : 0) + (e2 !== null && s2 !== null ? s2 - e2 : 0)
  base.trab = trabMin / 60
  const tem = trabMin > 0
  const just = p?.justificativa || null
  if (feriado) { base.tipo = 'feriado'; base.rotulo = feriado } else if (dow === 0) { base.tipo = 'domingo'; base.rotulo = 'Domingo' }
  else if (prev === 0) { base.tipo = 'descanso'; base.rotulo = dow === 6 ? 'Sábado' : 'Descanso' }
  // hora extra: o que passa do previsto. Domingo e feriado: tudo a 100%.
  const extra = Math.max(0, base.trab - prev)
  if (base.tipo === 'feriado' || base.tipo === 'domingo') base.he100 = extra; else base.he = extra
  if (just) base.rotulo = ROTULO_JUST[just] || just
  if (prev > 0 && base.trab < prev) {
    const falta = prev - base.trab
    if (just === 'falta') { if (!tem) base.falta = true; else base.atraso = falta }
    else if (just) base.abonado = falta
    else if (!tem && j.branco === 'normal') { if (!info.futuro) base.trab = prev; base.rotulo = '' }
    else if (!tem) { if (info.fechado) { base.falta = true; base.rotulo = 'Falta' } else { base.tipo = 'vazio'; base.rotulo = 'Sem lançamento' } }
    else base.atraso = falta
  }
  return base
}

// ------------------------------------------------------------------ o mês de uma pessoa
export interface Faixas { p50: number; p60: number; p80: number; p100: number }
export interface ResumoMes {
  dias: DiaCalc[]; prev: number; trab: number; he: number; he100: number; atraso: number; abonado: number
  faltas: number; semLancamento: number; dsr: number; faixas: Faixas; valorHora: number; valores: Faixas & { total: number }
}
export function diasDoMes(ano: number, mes: number): string[] {
  const n = new Date(ano, mes, 0).getDate()
  return Array.from({ length: n }, (_, i) => `${ano}-${String(mes).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)
}
export function dividirFaixas(he: number, he100: number, upgrade: boolean, j: Jornada): Faixas {
  if (upgrade && j.upgrade60) return { p50: 0, p60: he, p80: 0, p100: he100 }
  const p50 = Math.min(j.faixas[0], he), p60 = Math.min(j.faixas[1], he - p50), p80 = Math.min(j.faixas[2], he - p50 - p60)
  return { p50, p60, p80, p100: he - p50 - p60 - p80 + he100 }
}
export function valoresFaixas(f: Faixas, valorHora: number): Faixas & { total: number } {
  const v = { p50: f.p50 * valorHora * 1.5, p60: f.p60 * valorHora * 1.6, p80: f.p80 * valorHora * 1.8, p100: f.p100 * valorHora * 2 }
  return { ...v, total: v.p50 + v.p60 + v.p80 + v.p100 }
}
export interface DadosMes {
  pontos: RhPonto[]; ausencias: Pick<RhAusencia, 'tipo' | 'abona' | 'inicio' | 'fim'>[]; feriados: Map<string, string>
  fechado: boolean; upgrade: boolean; salarioHora: number; admissao?: string | null; demissao?: string | null; hoje?: string
}
export function resumoMes(ano: number, mes: number, d: DadosMes, j: Jornada): ResumoMes {
  const porDia = new Map(d.pontos.map(p => [p.data, p]))
  const hoje = d.hoje || U.hoje()
  const dias = diasDoMes(ano, mes).map(data => {
    const fora = (d.admissao && data < d.admissao) || (d.demissao && data > d.demissao)
    if (fora) return { data, tipo: 'descanso' as TipoDia, rotulo: 'Fora do contrato', prev: 0, trab: 0, he: 0, he100: 0, atraso: 0, abonado: 0, falta: false, travado: true, tolerado: 0 }
    const aus = d.ausencias.find(a => a.inicio <= data && (a.fim === null || a.fim >= data)) || null
    return calcDia(data, porDia.get(data) || null, { feriado: d.feriados.get(data) || null, ausencia: aus, fechado: d.fechado, futuro: data > hoje }, j)
  })
  const s = (k: 'prev' | 'trab' | 'he' | 'he100' | 'atraso' | 'abonado') => U.soma(dias, k)
  // DSR: semana (domingo a sábado) com falta sem justificativa perde o descanso remunerado
  const semanas = new Set<string>()
  for (const x of dias) if (x.falta && x.tipo !== 'ausencia') semanas.add(U.somaDias(x.data, -diaSemana(x.data)))
  for (const x of dias) if (x.falta && x.tipo === 'ausencia') semanas.add(U.somaDias(x.data, -diaSemana(x.data)))
  const he = s('he'), he100 = s('he100')
  const faixas = dividirFaixas(he, he100, d.upgrade, j)
  return {
    dias, prev: s('prev'), trab: s('trab'), he, he100, atraso: s('atraso'), abonado: s('abonado'),
    faltas: dias.filter(x => x.falta).length, semLancamento: dias.filter(x => x.tipo === 'vazio').length, dsr: semanas.size,
    faixas, valorHora: d.salarioHora, valores: valoresFaixas(faixas, d.salarioHora),
  }
}

// ------------------------------------------------------------------ férias (CLT)
// período aquisitivo: 12 meses de trabalho; concessivo: os 12 meses seguintes (prazo para a empresa dar as férias).
// "Data limite" igual à da planilha: fim do aquisitivo + 1 ano − 1 mês − 1 dia (sobra 1 mês para os 30 dias caberem).
export type SitFerias = 'formando' | 'emdia' | 'vence60' | 'vence30' | 'vencido' | 'gozado'
export interface PeriodoFerias { inicio: string; fim: string; concessivoFim: string; limite: string; gozados: number; saldo: number; adquirido: boolean; situacao: SitFerias }
export function periodosFerias(f: Pick<Funcionario, 'admissao' | 'ferias_base' | 'situacao' | 'demissao'>, ferias: Pick<RhAusencia, 'tipo' | 'inicio' | 'fim' | 'aquisitivo_inicio'>[], hoje = U.hoje()): PeriodoFerias[] {
  const base = f.ferias_base || f.admissao
  if (!base) return []
  const ate = f.demissao && f.demissao < hoje ? f.demissao : hoje
  const r: PeriodoFerias[] = []
  for (let ini = base; ini <= ate && r.length < 60; ini = U.somaMeses(ini, 12)) {
    const fim = U.somaDias(U.somaMeses(ini, 12), -1)
    const d = U.d(fim)!
    const limite = U.somaDias(U.iso(new Date(d.getFullYear() + 1, d.getMonth() - 1, d.getDate())), -1)
    const gozados = U.soma(ferias.filter(a => a.tipo === 'ferias' && a.aquisitivo_inicio === ini), a => U.dias(a.inicio, a.fim || a.inicio) + 1)
    const saldo = Math.max(0, 30 - gozados), adquirido = fim < hoje
    let situacao: SitFerias = 'formando'
    if (saldo === 0) situacao = 'gozado'
    else if (adquirido) { const n = U.dias(hoje, limite); situacao = n < 0 ? 'vencido' : n <= 30 ? 'vence30' : n <= 60 ? 'vence60' : 'emdia' }
    r.push({ inicio: ini, fim, concessivoFim: U.somaMeses(U.somaDias(fim, 1), 12), limite, gozados, saldo, adquirido, situacao })
  }
  return r
}
const PESO_FERIAS: Record<SitFerias, number> = { vencido: 5, vence30: 4, vence60: 3, emdia: 2, formando: 1, gozado: 0 }
export function feriasPior(ps: PeriodoFerias[]): PeriodoFerias | null {
  const abertos = ps.filter(p => p.situacao !== 'gozado' && p.adquirido)
  if (!abertos.length) return ps.filter(p => p.situacao === 'formando').at(-1) || null
  return abertos.sort((a, b) => PESO_FERIAS[b.situacao] - PESO_FERIAS[a.situacao] || (a.inicio < b.inicio ? -1 : 1))[0]
}
export const TXT_FERIAS: Record<SitFerias, string> = { formando: 'Adquirindo', emdia: 'Em dia', vence60: 'Vence em até 60 dias', vence30: 'Vence em até 30 dias', vencido: 'VENCIDO (paga em dobro)', gozado: 'Gozadas' }

// ------------------------------------------------------------------ experiência (30 + 30 dias, como na planilha)
export function experiencia(admissao: string | null, hoje = U.hoje()): { fim1: string; fim2: string; fase: 1 | 2 } | null {
  if (!admissao) return null
  const fim1 = U.somaDias(admissao, 29), fim2 = U.somaDias(fim1, 29)
  if (hoje > fim2 || hoje < admissao) return null
  return { fim1, fim2, fase: hoje <= fim1 ? 1 : 2 }
}

// ------------------------------------------------------------------ ASO, treinamentos, EPI
export type Semaforo = 'verde' | 'amarelo' | 'vermelho'
export function vencimentoAso(a: Pick<RhAso, 'data_exame' | 'periodicidade_meses'>): string { return U.somaMeses(a.data_exame, a.periodicidade_meses || 12) }
export function semaforoData(venc: string | null, hoje = U.hoje(), amarelo = 60): Semaforo | null {
  if (!venc) return null
  const n = U.dias(hoje, venc)
  return n < 0 ? 'vermelho' : n <= amarelo ? 'amarelo' : 'verde'
}
export function ultimoAso(asos: RhAso[], funcId: string): RhAso | null {
  return asos.filter(a => a.funcionario_id === funcId).sort((a, b) => (a.data_exame < b.data_exame ? 1 : -1))[0] || null
}
export function vencimentoTreino(n: Pick<RhNivel, 'nivel' | 'data'>, item: Pick<RhMatrizItem, 'validade_meses'>): string | null {
  return n.nivel >= 2 && n.data && item.validade_meses ? U.somaMeses(n.data, item.validade_meses) : null
}
export function trocaEpi(e: Pick<RhEpi, 'entrega' | 'vida_util_meses'>): string | null { return e.vida_util_meses ? U.somaMeses(e.entrega, e.vida_util_meses) : null }

// ------------------------------------------------------------------ CPF (mesma conta do banco) e máscara (LGPD)
export function cpfValido(c: string | null | undefined): boolean {
  const d = String(c || '').replace(/\D/g, '')
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  for (const n of [9, 10]) {
    let s = 0
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i)
    const r = (s * 10) % 11 % 10
    if (r !== Number(d[n])) return false
  }
  return true
}
export const mascaraCpf = (c: string | null | undefined): string => {
  const d = String(c || '').replace(/\D/g, '')
  return d.length === 11 ? `${d.slice(0, 3)}.***.***-${d.slice(9)}` : (c ? '***' : '')
}
export const mascarar = (t: string | null | undefined, ver = 3): string => {
  const s = String(t || ''); if (!s) return ''
  return s.length <= ver ? '•'.repeat(s.length) : '•'.repeat(Math.max(3, s.length - ver)) + s.slice(-ver)
}
// tempo de casa "3 anos e 8 meses" (como a planilha)
export function tempoCasa(adm: string | null, ate = U.hoje()): string {
  if (!adm) return ''
  const a = U.d(adm)!, b = U.d(ate)!
  let meses = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  if (b.getDate() < a.getDate()) meses--
  const anos = Math.floor(meses / 12), resto = meses % 12
  if (meses < 1) return 'menos de 1 mês'
  return anos ? `${U.plural(anos, 'ano')}${resto ? ' e ' + U.plural(resto, 'mês', 'meses') : ''}` : U.plural(resto, 'mês', 'meses')
}
export const idade = (nasc: string | null, hoje = U.hoje()): number | null => {
  if (!nasc) return null
  const a = U.d(nasc)!, b = U.d(hoje)!
  let n = b.getFullYear() - a.getFullYear()
  if (b.getMonth() < a.getMonth() || (b.getMonth() === a.getMonth() && b.getDate() < a.getDate())) n--
  return n
}

// alíneas do art. 482 da CLT (as mesmas do modelo de advertência da JAF)
export const ART_482: [string, string][] = [
  ['a', 'Ato de improbidade'], ['b', 'Incontinência de conduta ou mau procedimento'], ['c', 'Negociação habitual'], ['d', 'Condenação criminal'],
  ['e', 'Desídia (atrasos, faltas, baixa produção)'], ['f', 'Embriaguez habitual ou em serviço'], ['g', 'Violação de segredo da empresa'],
  ['h', 'Indisciplina ou insubordinação'], ['i', 'Abandono de emprego'], ['j', 'Ato lesivo da honra ou boa fama (agressão verbal ou física)'],
  ['k', 'Prática de jogos de azar'], ['l', 'Atos atentatórios à segurança nacional'],
]
export const CATEGORIAS_DISC: string[] = [
  'Desídia (atrasos, faltas sem justificativa, baixa produção)', 'Insubordinação ou indisciplina', 'Mau procedimento / conduta inadequada',
  'Descumprimento de regras de segurança (EPI)', 'Mau uso de equipamentos / patrimônio', 'Agressão verbal ou física', 'Outros',
]
