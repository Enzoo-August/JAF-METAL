/* RH — Indicadores. Na frente, os dois que o RH acompanha (fórmulas do documento do RH):
 *   Turnover     = [(admissões + desligamentos) ÷ 2] ÷ efetivo médio × 100, efetivo médio = (início + fim do mês) ÷ 2
 *   Absenteísmo  = (horas de falta injustificada + horas de falta justificada) ÷ horas previstas × 100
 * com meta (o RH muda), o mês ou o ano, Matriz/Filial, gráfico de 12 meses e histórico desde 2018.
 * Os meses da planilha antiga (ou digitados pelo RH) valem sobre o cálculo do sistema. Horas extras entram como complemento.
 * Em "Mais indicadores" ficam equipe, treinamentos, receitas e custos e as dicas do mês. */
import { useState, type ReactNode } from 'react'
import { App } from '../../app/controle.tsx'
import { API } from '../../lib/api.ts'
import { S } from '../../lib/dados.ts'
import * as R from '../../lib/rh.ts'
import type { Funcionario, RhIndicador, RhPonto } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { aviso } from '../../ui/avisos.ts'
import { entregar, excel, pdfDocumento } from '../../ui/arquivos.tsx'
import { Btn, Cab, Campo, Chips, Vazio } from '../../ui/base.tsx'
import { useLembrar } from '../../ui/ganchos.ts'
import { lerForm, modal } from '../../ui/janelas.tsx'
import { Barras } from '../Relatorios.tsx'
import { totaisBeneficios } from './Beneficios.tsx'
import { pode, salarioHE, sensivel } from './comum.tsx'
import { feriadosMap, resumoDe } from './Ponto.tsx'

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const FAIXAS: [string, number, number][] = [['Até 25 anos', 0, 25], ['26 a 33 anos', 26, 33], ['34 a 43 anos', 34, 43], ['44 a 53 anos', 44, 53], ['54 a 60 anos', 54, 60], ['Mais de 60 anos', 61, 200]]
const pc = (x: number | null) => x === null ? '—' : x.toFixed(2).replace('.', ',') + '%'
const pct1 = (x: number) => (x * 100).toFixed(1).replace('.', ',') + '%'
const h0 = (x: number) => U.qtd(Math.round(x))
const nomeM = (m: string) => MESES[Number(m.slice(5)) - 1]
const fimMes = (m: string) => U.somaDias(U.somaMeses(m + '-01', 1), -1)
const naEmpresa = (f: Funcionario, dia: string) => !!f.admissao && f.admissao <= dia && (!f.demissao || f.demissao >= dia)
const mesesEntre = (a: string, b: string) => { const x = U.d(a)!, y = U.d(b)!; let n = (y.getFullYear() - x.getFullYear()) * 12 + y.getMonth() - x.getMonth(); if (y.getDate() < x.getDate()) n--; return Math.max(0, n) }
export const turnoverDe = (ini: number, fim: number, adm: number, dem: number): number | null => { const em = (ini + fim) / 2; return em > 0 ? (adm + dem) / 2 / em * 100 : null }
export const absenteismoDe = (injust: number, just: number, prev: number): number | null => prev > 0 ? (injust + just) / prev * 100 : null

type Reg = 'todas' | 'Matriz' | 'Filial'
type Foco = '' | 'turnover' | 'absent'
export const metasRH = (): { turnover: number; absent: number } => {
  const x = S.cfg<{ metas?: { turnover?: number; absenteismo?: number } }>('rh', {}).metas || {}
  return { turnover: x.turnover ?? 2, absent: x.absenteismo ?? 1.5 }
}

interface Base { ini: number; fim: number; adm: number; dem: number; prev: number; injust: number; just: number; he: number }
interface Mes extends Base {
  m: string; fechado: boolean; origem: 'sistema' | 'planilha' | 'manual'; turnover: number | null; absent: number | null; afast: number | null
  sis: Base & { temPonto: boolean }   // o que o sistema calcula (mostra ao digitar)
  folha: number; heValor: number; receita: number | null; beneficios: number; benefAuto: boolean; encargos: number; outros: number; custo: number
}
interface Ind {
  ano: number; reg: Reg; ate: string; meses: Mes[]; turnAno: number | null; absAno: number | null; nBase: number; heAno: number
  ativos: Funcionario[]; adm: number; desl: number; fimAno: number; permanencia: number; aprov: number | null; aprovN: string
  motivos: { t: string; v: number }[]; sexo: { t: string; v: number }[]; faixa: { t: string; v: number }[]; escol: { t: string; v: number }[]; tipo: { t: string; v: number }[]
  treinos: number; treinados: number; horasTreino: number; planoFeito: number; planoTotal: number
}

function contar(l: string[]): { t: string; v: number }[] {
  const m = new Map<string, number>(); for (const x of l) m.set(x, (m.get(x) || 0) + 1)
  return [...m.entries()].map(([t, v]) => ({ t, v })).sort((a, b) => b.v - a.v)
}

function calcular(ano: number, reg: Reg): Ind {
  const hoje = U.hoje(), a = String(ano), mesHoje = hoje.slice(0, 7)
  const ate = a === hoje.slice(0, 4) ? hoje : `${a}-12-31`
  const fs = S.lista('funcionarios').filter(f => reg === 'todas' || f.registro === reg), fer = feriadosMap()
  const pp = new Map<string, RhPonto[]>()
  for (const p of S.lista('rh_ponto')) { if (!p.data.startsWith(a)) continue; const k = p.funcionario_id + '|' + p.data.slice(0, 7); let l = pp.get(k); if (!l) pp.set(k, l = []); l.push(p) }
  const lanc = new Map(S.lista('rh_indicadores').map(x => [x.competencia.slice(0, 7), x]))
  const meses: Mes[] = []
  for (let i = 1; i <= 12; i++) {
    const m = `${a}-${String(i).padStart(2, '0')}`, ini = m + '-01', fim = fimMes(m)
    if (ini > ate) break
    const corte = fim < ate ? fim : ate
    const sis = { ini: fs.filter(f => naEmpresa(f, U.somaDias(ini, -1))).length, fim: fs.filter(f => naEmpresa(f, corte)).length,
      adm: fs.filter(f => f.admissao?.startsWith(m)).length, dem: fs.filter(f => f.demissao?.startsWith(m)).length, prev: 0, injust: 0, just: 0, he: 0, temPonto: false }
    let folha = 0, heValor = 0
    for (const f of fs) {
      if (!f.admissao || f.admissao > fim || (f.demissao && f.demissao < ini)) continue
      if (naEmpresa(f, corte)) folha += salarioHE(f, m)
      const ps = pp.get(f.id + '|' + m)
      if (!ps?.length) continue
      sis.temPonto = true
      const r = resumoDe(f, m, ps, fer)
      heValor += r.valores.total; sis.he += r.he + r.he100
      for (const d of r.dias) {
        if (d.rotulo === 'FÉRIAS' || d.rotulo === 'Fora do contrato' || d.tipo === 'vazio' || d.data > ate) continue
        sis.prev += d.prev; sis.injust += d.atraso + (d.falta ? d.prev : 0); sis.just += d.abonado
      }
    }
    // a planilha antiga ou o número digitado valem sobre o cálculo (só no total da empresa: são números da empresa toda)
    const l = reg === 'todas' && lanc.get(m)?.origem ? lanc.get(m)! : null
    const usa = (v: number | null | undefined, s: number) => l && v != null ? Number(v) : s
    const fimM = usa(l?.fim, sis.fim), adm = usa(l?.adm, sis.adm), dem = usa(l?.dem, sis.dem)
    const iniPlan = l && l.ini == null && l.fim != null ? (meses.at(-1)?.fim ?? (() => { const dez = lanc.get(`${ano - 1}-12`); return dez?.origem && dez.fim != null ? Number(dez.fim) : fimM - adm + dem })()) : null
    const iniM = iniPlan ?? usa(l?.ini, sis.ini)
    const temAbs = l && (l.prev_h != null || l.injust_h != null || l.just_h != null)
    const prev = temAbs ? Number(l.prev_h) || 0 : sis.temPonto ? sis.prev : 0
    const injust = temAbs ? Number(l.injust_h) || 0 : sis.injust, just = temAbs ? Number(l.just_h) || 0 : sis.just
    const lr = lanc.get(m)
    const benefAuto = lr?.beneficios == null && reg === 'todas'
    const beneficios = lr?.beneficios != null && reg === 'todas' ? Number(lr.beneficios) : benefAuto ? totaisBeneficios(m).empresa : 0
    const encargos = reg === 'todas' ? Number(lr?.encargos) || 0 : 0, outros = reg === 'todas' ? Number(lr?.outros) || 0 : 0
    meses.push({
      m, fechado: m < mesHoje, origem: l?.origem || 'sistema', ini: iniM, fim: fimM, adm, dem, prev, injust, just, he: usa(l?.he_h, sis.he), afast: l?.afast ?? null, sis,
      turnover: turnoverDe(iniM, fimM, adm, dem), absent: absenteismoDe(injust, just, prev),
      folha, heValor, receita: reg === 'todas' && lr?.receita != null ? Number(lr.receita) : null, beneficios, benefAuto, encargos, outros, custo: folha + heValor + beneficios + encargos + outros,
    })
  }
  // o ano: turnover = média dos meses fechados; absenteísmo = soma das horas ÷ soma das previstas
  const fech = meses.filter(x => x.fechado), base = fech.length ? fech : meses
  const comT = base.filter(x => x.turnover !== null), comA = base.filter(x => x.absent !== null)
  const turnAno = comT.length ? U.soma(comT, x => x.turnover!) / comT.length : null
  const absAno = comA.length ? absenteismoDe(U.soma(comA, x => x.injust), U.soma(comA, x => x.just), U.soma(comA, x => x.prev)) : null

  const ativos = fs.filter(f => f.ativo && f.situacao !== 'desligado')
  const admAno = fs.filter(f => f.admissao?.startsWith(a)), deslAno = fs.filter(f => f.demissao?.startsWith(a))
  const naData = fs.filter(f => naEmpresa(f, ate))
  const expFim = admAno.filter(f => U.somaDias(f.admissao!, 59) <= ate)
  const passou = expFim.filter(f => !f.demissao || f.demissao > U.somaDias(f.admissao!, 59))
  const priv = (f: Funcionario) => S.get('funcionarios_privado', f.id)
  const idadeFaixa = (f: Funcionario) => { const n = R.idade(priv(f)?.nascimento || null, ate); return n === null ? 'Sem data de nascimento' : (FAIXAS.find(([, x, y]) => n >= x && n <= y)?.[0] || '—') }
  const ids = new Set(fs.map(f => f.id))
  const itens = new Map(S.lista('rh_matriz_itens').map(x => [x.id, x]))
  const niveis = S.lista('rh_matriz_niveis').filter(n => ids.has(n.funcionario_id) && n.nivel >= 2 && n.data?.startsWith(a) && n.data <= ate)
  const plano = S.lista('rh_plano_treinos').filter(p => p.data?.startsWith(a) && p.status !== 'cancelado')
  return {
    ano, reg, ate, meses, turnAno, absAno, nBase: base.length, heAno: U.soma(meses, x => x.he),
    ativos, adm: admAno.length, desl: deslAno.length, fimAno: naData.length,
    permanencia: naData.length ? U.soma(naData, f => mesesEntre(f.admissao!, ate)) / naData.length : 0,
    aprov: expFim.length ? passou.length / expFim.length : null, aprovN: `${passou.length} de ${expFim.length}`,
    motivos: contar(deslAno.map(f => priv(f)?.motivo_demissao || 'Sem motivo informado')),
    sexo: contar(naData.map(f => { const s = U.sem(priv(f)?.sexo || '').toLowerCase(); return s.startsWith('f') ? 'Feminino' : s.startsWith('m') ? 'Masculino' : 'Não informado' })),
    faixa: FAIXAS.map(([t]) => ({ t, v: naData.filter(f => idadeFaixa(f) === t).length })).filter(x => x.v),
    escol: contar(naData.map(f => priv(f)?.instrucao || 'Não informado')),
    tipo: contar(naData.map(f => S.get('rh_cargos', f.cargo_id)?.tipo || 'Sem tipo de cargo')),
    treinos: niveis.length, treinados: new Set(niveis.map(n => n.funcionario_id)).size, horasTreino: U.soma(niveis, n => Number(itens.get(n.item_id)?.carga_horaria) || 0),
    planoFeito: plano.filter(p => p.status === 'realizado').length, planoTotal: plano.length,
  }
}

// dicas do mês (horas extras e receita; turnover e absenteísmo já aparecem contra a meta)
function dicas(ind: Ind, m: string): { tom: 'bom' | 'ruim' | 'neutro'; t: string; txt: string }[] {
  const i = ind.meses.findIndex(x => x.m === m); if (i < 0) return []
  const x = ind.meses[i], y = i > 0 ? ind.meses[i - 1] : null
  const r: { tom: 'bom' | 'ruim' | 'neutro'; t: string; txt: string }[] = []
  const varia = (a: number, b: number) => b ? (a - b) / b : (a ? 1 : 0)
  if (y) {
    const vh = varia(x.he, y.he)
    if (x.he || y.he) r.push(vh > 0.1 ? { tom: 'ruim', t: 'Horas extras', txt: `As horas extras subiram ${pct1(vh)} (${h0(y.he)} h → ${h0(x.he)} h). Se for constante, pode valer contratar ou usar banco de horas.` }
      : { tom: 'bom', t: 'Horas extras', txt: `As horas extras ficaram sob controle (${h0(y.he)} h → ${h0(x.he)} h).` })
    if (x.receita && y.receita && x.fim && y.fim) {
      const rx = x.receita / x.fim, ry = y.receita / y.fim, vr = varia(rx, ry)
      r.push(vr >= 0 ? { tom: 'bom', t: 'Receita por funcionário', txt: `Cada funcionário gerou ${U.moeda0(rx)} de receita (antes ${U.moeda0(ry)}): ${pct1(vr)} a mais.` }
        : { tom: 'ruim', t: 'Receita por funcionário', txt: `A receita por funcionário caiu ${pct1(-vr)} (${U.moeda0(ry)} → ${U.moeda0(rx)}). Veja se a queda foi de vendas ou se a equipe cresceu antes da demanda.` })
    }
  }
  if (x.receita == null && pode() && ind.reg === 'todas') r.push({ tom: 'neutro', t: 'Receita do mês', txt: 'A receita bruta deste mês ainda não foi lançada: use “Receitas e custos” para ver receita e custo por funcionário.' })
  return r
}

export function TelaIndicadores() {
  const anoAtual = Number(U.hoje().slice(0, 4))
  const [ano, setAno] = useLembrar('ind.ano', anoAtual)
  const [reg, setReg] = useLembrar<string>('ind.reg', 'todas')
  const [visao, setVisao] = useLembrar<string>('ind.visao', 'mes')
  const [foco, setFoco] = useLembrar<Foco>('ind.foco', '')
  const [mesSel, setMesSel] = useState('')
  const ind = calcular(ano, reg as Reg)
  const metas = metasRH()
  const padrao = ind.meses.filter(x => x.fechado).at(-1) || ind.meses.at(-1)
  const x = ind.meses.find(y => y.m === mesSel) || padrao
  const ant = x ? ind.meses[ind.meses.indexOf(x) - 1] : undefined
  const primeiro = Math.min(anoAtual, ...S.lista('rh_indicadores').map(l => Number(l.competencia.slice(0, 4))), ...S.lista('funcionarios').map(f => Number((f.admissao || '').slice(0, 4)) || anoAtual).filter(n => n >= anoAtual - 8))
  const anos = Array.from({ length: anoAtual - primeiro + 1 }, (_, i) => anoAtual - i)
  const ehAno = visao === 'ano'
  const vT = ehAno ? ind.turnAno : x?.turnover ?? null, vA = ehAno ? ind.absAno : x?.absent ?? null
  const comp = (v: number | null, a: number | null | undefined) => v === null || a == null ? '' : `${pc(a)} no mês anterior`
  const subAno = `${ind.nBase === 12 ? 'ano inteiro' : U.plural(ind.nBase, 'mês', 'meses')}${ind.meses.some(y => !y.fechado) && ind.nBase ? ' fechados' : ''}`
  const trocar = (f: Foco) => setFoco(foco === f ? '' : f)
  return <>
    <Cab titulo="Indicadores de RH" sub={`${reg === 'todas' ? 'Empresa toda' : reg} · ${ano}${ind.ate < `${ano}-12-31` ? ` (até ${U.data(ind.ate)})` : ''}`}>
      {pode() && <Btn txt="Metas" icone="lapis" data-ind="metas" onClick={() => void editarMetas()} />}
      <Btn txt="PDF" icone="imprimir" data-ind="pdf" onClick={() => void pdfIndicadores(ind)} />
      <Btn txt="Excel" icone="planilha" data-ind="excel" onClick={() => void excelIndicadores(ind)} />
    </Cab>
    <div className="barra-filtros">
      <select aria-label="Ano" value={ano} onChange={(e) => { setAno(Number(e.target.value)); setMesSel('') }} data-ind="ano">{anos.map(a => <option key={a} value={a}>{a}</option>)}</select>
      {!ehAno && <select aria-label="Mês" value={x?.m || ''} onChange={(e) => setMesSel(e.target.value)} data-ind="mes">{ind.meses.map(y => <option key={y.m} value={y.m}>{U.cap(U.nomeMes(Number(y.m.slice(5))))}{y.fechado ? '' : ' (em andamento)'}</option>)}</select>}
    </div>
    <Chips nome="vis" atual={visao} aoEscolher={setVisao} opcoes={[{ v: 'mes', t: 'Mês' }, { v: 'ano', t: 'Ano (12 meses)' }]} />
    <Chips nome="reg" atual={reg} aoEscolher={setReg} opcoes={[{ v: 'todas', t: 'Empresa toda' }, { v: 'Matriz', t: 'Matriz' }, { v: 'Filial', t: 'Filial' }]} />

    {!ind.meses.length ? <Vazio icone="relatorio" titulo="Sem meses neste ano" /> : <>
      <div className="ind-cards mt" id="indCards">
        <Cartao id="turnover" t="Turnover" v={vT} meta={metas.turnover} on={foco === 'turnover'} onClick={() => trocar('turnover')}
          sub={ehAno ? `média de ${subAno}` : comp(vT, ant?.turnover)} rodape={ehAno ? `${ind.adm} admissões · ${ind.desl} desligamentos` : x ? `${x.adm} admiss${x.adm === 1 ? 'ão' : 'ões'} · ${x.dem} desligamento${x.dem === 1 ? '' : 's'} · efetivo médio ${U.qtd((x.ini + x.fim) / 2)}` : ''} />
        <Cartao id="absent" t="Absenteísmo" v={vA} meta={metas.absent} on={foco === 'absent'} onClick={() => trocar('absent')}
          sub={ehAno ? subAno : comp(vA, ant?.absent)} rodape={ehAno ? `${h0(U.soma(ind.meses, y => y.injust + y.just))} h de falta de ${h0(U.soma(ind.meses, y => y.prev))} h previstas`
            : x ? (x.absent === null ? 'sem ponto lançado no mês' : `${h0(x.injust + x.just)} h de falta (${h0(x.just)} h justificadas) de ${h0(x.prev)} h previstas`) : ''} />
      </div>
      <div className="grade g3 mt" id="indCompl">
        <div className="kpi"><small>Horas extras</small><b>{h0(ehAno ? ind.heAno : x?.he || 0)} h</b><span>{ehAno ? 'no ano' : ant ? `${h0(ant.he)} h no mês anterior` : 'no mês'}</span></div>
        <div className="kpi"><small>Funcionários</small><b>{ehAno ? ind.meses.at(-1)?.fim ?? 0 : x?.fim ?? 0}</b><span>no fim {ehAno ? 'do período' : 'do mês'}</span></div>
        {sensivel() && (() => {   // o valor só existe nos meses com ponto no sistema (o histórico da planilha traz só as horas)
          const comPonto = ehAno ? ind.meses.filter(y => y.sis.temPonto).length : x?.sis.temPonto ? 1 : 0
          return <div className="kpi" id="indHeValor"><small>Valor das horas extras</small>
            <b>{comPonto ? U.moeda0(ehAno ? U.soma(ind.meses, y => y.heValor) : x?.heValor || 0) : '—'}</b>
            <span>{!comPonto ? `sem ponto no sistema neste ${ehAno ? 'ano' : 'mês'}` : ehAno && comPonto < ind.meses.length ? `calculado pelo ponto (${comPonto} ${comPonto === 1 ? 'mês' : 'meses'})` : 'calculado pelo ponto'}</span></div>
        })()}
      </div>
      {!foco && <p className="sub mt">Toque em Turnover ou Absenteísmo para ver os 12 meses, o gráfico e de onde vem cada número.</p>}
      {foco && <Detalhe ind={ind} foco={foco} meta={foco === 'turnover' ? metas.turnover : metas.absent} />}
    </>}

    <details className="card mt2 mais-ind" id="maisInd">
      <summary><b>Mais indicadores</b> <small className="fraco">equipe, treinamentos, receitas e custos, dicas do mês</small></summary>
      <MaisIndicadores ind={ind} />
    </details>
  </>
}

function Cartao({ id, t, v, meta, sub, rodape, on, onClick }: { id: string; t: string; v: number | null; meta: number; sub: string; rodape: string; on: boolean; onClick: () => void }) {
  const ruim = v !== null && v > meta
  return <button type="button" className={`ind-card${v === null ? ' sem' : ruim ? ' ruim' : ''}${on ? ' on' : ''}`} data-ind-card={id} aria-pressed={on} onClick={onClick}>
    <small>{t}</small><span className="ind-valor">{pc(v)}</span>
    <span className="ind-meta"><span>Meta: até {pc(meta)}</span><b className={v === null ? '' : ruim ? 'txt-vermelho' : 'txt-verde'}>{v === null ? 'sem dados' : ruim ? 'acima da meta' : 'dentro da meta'}</b></span>
    {sub && <span className="ind-meta"><span>{sub}</span></span>}
    {rodape && <span className="ind-meta"><span>{rodape}</span></span>}
  </button>
}

function Grafico({ meses, ano, val, meta }: { meses: Mes[]; ano: number; val: (x: Mes) => number | null; meta: number }) {
  const todos = MESES.map((_, i) => meses.find(x => x.m === `${ano}-${String(i + 1).padStart(2, '0')}`))
  const max = Math.max(meta * 1.3, ...meses.map(val).filter((n): n is number => n !== null)) || 1
  return <div className="ind-graf mt" role="img" aria-label="Gráfico dos 12 meses">
    {todos.map((x, i) => { const v = x ? val(x) : null
      return <div key={i} className={`col-g${v === null ? ' vazio' : v > meta ? ' ruim' : ''}`} title={`${MESES[i]}: ${pc(v)}`}>
        <em>{v === null ? '' : v.toFixed(1).replace('.', ',')}</em><i style={{ height: v === null ? 2 : `calc((100% - 34px) * ${Math.min(1, v / max)})` }} /><span>{MESES[i]}</span></div> })}
    <div className="meta-linha" style={{ bottom: `calc(18px + (100% - 52px) * ${meta / max})` }}><b>meta {pc(meta)}</b></div>
  </div>
}

const ORIG: Record<Mes['origem'], string> = { sistema: 'Sistema', planilha: 'Planilha antiga', manual: 'Digitado pelo RH' }
function Detalhe({ ind, foco, meta }: { ind: Ind; foco: Exclude<Foco, ''>; meta: number }) {
  const T = foco === 'turnover'
  const editar = pode() && ind.reg === 'todas'
  const clique = (x: Mes) => editar ? () => void editarMes(x) : undefined
  return <section className="card mt" id="indDetalhe">
    <h2>{T ? 'Turnover' : 'Absenteísmo'} mês a mês · {ind.ano}</h2>
    <p className="sub">{T ? 'Turnover = [(admissões + desligamentos) ÷ 2] ÷ efetivo médio × 100. Efetivo médio = (funcionários no início + no fim do mês) ÷ 2.'
      : 'Absenteísmo = (horas de falta sem justificativa + horas de falta justificada) ÷ horas previstas × 100. Atrasos entram como falta sem justificativa; atestados e abonos como justificada.'}</p>
    <Grafico meses={ind.meses} ano={ind.ano} val={x => T ? x.turnover : x.absent} meta={meta} />
    <div className="tabela-caixa mt"><table className="tabela tabela-ind" id={T ? 'tTurn' : 'tAbs'}>
      <thead><tr><th>Mês</th><th className="num">{T ? 'Turnover' : <><span className="so-largo">Absenteísmo</span><span className="so-estreito">Absenteísmo</span></>}</th>
        {T ? <><th className="num so-largo">Início</th><th className="num so-largo">Fim</th><th className="num so-largo">Efetivo médio</th>
          <th className="num so-largo">Admissões</th><th className="num so-largo">Desligamentos</th><th className="num so-estreito-cel">Adm/Desl</th></>
        : <><th className="num so-largo">Horas previstas</th><th className="num so-largo">Sem justificativa</th><th className="num so-largo">Justificadas</th><th className="num so-estreito-cel">Faltas (h)</th></>}<th className="so-largo">Origem</th></tr></thead>
      <tbody>{ind.meses.map(x => { const v = T ? x.turnover : x.absent
        return <tr key={x.m} className={editar ? 'clicavel' : ''} data-ind-mes={x.m} onClick={clique(x)}>
          <td>{nomeM(x.m)}{x.fechado ? '' : ' *'}{x.origem !== 'sistema' && <small className="so-estreito col-sub">{ORIG[x.origem]}</small>}</td>
          <td className={'num' + (v !== null && v > meta ? ' ruim' : '')}><b>{pc(v)}</b></td>
          {T ? <><td className="num so-largo">{x.ini}</td><td className="num so-largo">{x.fim}</td><td className="num so-largo">{U.qtd((x.ini + x.fim) / 2)}</td><td className="num so-largo">{x.adm}</td><td className="num so-largo">{x.dem}</td><td className="num so-estreito-cel">{x.adm} / {x.dem}</td></>
            : <><td className="num so-largo">{x.prev ? h0(x.prev) : '—'}</td><td className="num so-largo">{x.prev ? h0(x.injust) : '—'}</td><td className="num so-largo">{x.prev ? h0(x.just) : '—'}</td>
              <td className="num so-estreito-cel">{x.prev ? <>{h0(x.injust + x.just)}<small className="col-sub">de {h0(x.prev)}</small></> : '—'}</td></>}
          <td className="so-largo"><small>{ORIG[x.origem]}</small></td></tr> })}</tbody>
      <tfoot><tr><td>Ano<small className="so-estreito col-sub">{T ? 'média dos meses' : 'soma das horas'}</small></td>
        <td className={'num' + ((T ? ind.turnAno : ind.absAno) !== null && (T ? ind.turnAno! : ind.absAno!) > meta ? ' ruim' : '')}><b>{pc(T ? ind.turnAno : ind.absAno)}</b></td>
        {T ? <><td className="num so-largo">{ind.meses[0]?.ini}</td><td className="num so-largo">{ind.meses.at(-1)?.fim}</td><td className="so-largo" /><td className="num so-largo">{U.soma(ind.meses, x => x.adm)}</td><td className="num so-largo">{U.soma(ind.meses, x => x.dem)}</td><td className="num so-estreito-cel">{U.soma(ind.meses, x => x.adm)} / {U.soma(ind.meses, x => x.dem)}</td></>
        : <><td className="num so-largo">{h0(U.soma(ind.meses, x => x.prev))}</td><td className="num so-largo">{h0(U.soma(ind.meses, x => x.injust))}</td><td className="num so-largo">{h0(U.soma(ind.meses, x => x.just))}</td>
          <td className="num so-estreito-cel">{h0(U.soma(ind.meses, x => x.injust + x.just))}<small className="col-sub">de {h0(U.soma(ind.meses, x => x.prev))}</small></td></>}
        <td className="so-largo"><small>{T ? 'média dos meses' : 'soma das horas'}</small></td></tr></tfoot>
    </table></div>
    <p className="sub mt">{ind.meses.some(x => !x.fechado) && '* mês em andamento. '}{T ? 'O turnover do ano é a média dos meses fechados.' : 'O absenteísmo do ano soma as horas de todos os meses fechados.'}
      {' '}{editar ? 'Toque num mês para corrigir os números (o que você digitar vale sobre o cálculo do sistema).' : ind.reg !== 'todas' ? 'Matriz e Filial são calculadas pelo cadastro e pelo ponto; os números da planilha antiga são da empresa toda.' : ''}</p>
  </section>
}

function MaisIndicadores({ ind }: { ind: Ind }) {
  const [mesDica, setMesDica] = useState('')
  const tot = (k: 'folha' | 'heValor' | 'beneficios' | 'encargos' | 'outros' | 'custo') => U.soma(ind.meses, x => x[k])
  const receitaAno = ind.meses.some(x => x.receita != null) ? U.soma(ind.meses, x => x.receita || 0) : null
  const mediaFunc = ind.meses.length ? U.soma(ind.meses, x => x.fim) / ind.meses.length : 0
  const mD = ind.meses.find(x => x.m === mesDica)?.m || ind.meses.at(-1)?.m || ''
  const ds = dicas(ind, mD)
  const sens = sensivel()
  return <div className="mt">
    <h2>Equipe <small className="fraco">(em {U.data(ind.ate)})</small></h2>
    <div className="grade g4 mt">
      <Kpi t="Funcionários" v={String(ind.fimAno)} s={`em ${U.data(ind.ate)}`} />
      <Kpi t="Passaram na experiência" v={ind.aprov === null ? '—' : pct1(ind.aprov)} s={ind.aprov === null ? 'ninguém terminou a experiência' : ind.aprovN + ' admitidos'} />
      <Kpi t="Tempo médio de casa" v={`${Math.round(ind.permanencia)} meses`} s={R.tempoCasa(U.somaMeses(ind.ate, -Math.round(ind.permanencia)), ind.ate)} />
      <Kpi t="Desligamentos no ano" v={String(ind.desl)} s={`${ind.adm} admissões`} />
    </div>
    <div className="grade g2 mt">
      <Quadro t="Motivos de desligamento">{ind.motivos.length ? <Barras itens={ind.motivos} fmt={String} /> : <p className="sub">Nenhum desligamento no ano.</p>}</Quadro>
      <Quadro t="Sexo"><Barras itens={ind.sexo} fmt={String} /></Quadro>
      <Quadro t="Faixa etária"><Barras itens={ind.faixa} fmt={String} /></Quadro>
      <Quadro t="Escolaridade"><Barras itens={ind.escol} fmt={String} /></Quadro>
      <Quadro t="Tipo de cargo">{ind.tipo.length ? <Barras itens={ind.tipo} fmt={String} /> : null}<p className="sub">O tipo vem do cadastro de cargos (RH → Ajustes → Cargos).</p></Quadro>
    </div>

    <h2 className="mt2">Treinamentos</h2>
    <div className="grade g4 mt">
      <Kpi t="Treinamentos concluídos" v={String(ind.treinos)} s="nas matrizes, no ano" />
      <Kpi t="Pessoas treinadas" v={String(ind.treinados)} s={ind.fimAno ? pct1(ind.treinados / ind.fimAno) + ' da equipe' : ''} />
      <Kpi t="Horas de treinamento" v={R.horas(ind.horasTreino)} s={ind.treinados ? R.horas(ind.horasTreino / ind.treinados) + ' por pessoa treinada' : 'carga horária dos itens'} />
      <Kpi t="Plano do ano" v={`${ind.planoFeito} de ${ind.planoTotal}`} s="treinamentos realizados" />
    </div>

    {sens && <>
      <div className="barra-filtros mt2"><h2 style={{ flex: 1, margin: 0 }}>Receitas e custos</h2>{pode() && ind.reg === 'todas' && <Btn txt="Receitas e custos" icone="dinheiro" cls="mini" data-ind="lancar" onClick={() => void lancar(ind.ano)} />}</div>
      <div className="grade g4 mt">
        <Kpi t="Receita bruta do ano" v={receitaAno === null ? '—' : U.moeda0(receitaAno)} s={receitaAno !== null && mediaFunc ? U.moeda0(receitaAno / mediaFunc) + ' por funcionário' : 'lance em “Receitas e custos”'} />
        <Kpi t="Folha (salários)" v={U.moeda0(tot('folha'))} s="soma dos salários de cada mês" />
        <Kpi t="Benefícios" v={U.moeda0(tot('beneficios'))} s={ind.meses.some(x => x.benefAuto && x.beneficios) ? 'parte da empresa, do cadastro de benefícios' : 'lançados à mão'} />
        <Kpi t="Custo total" v={U.moeda0(tot('custo'))} s={receitaAno ? pct1(tot('custo') / receitaAno) + ' da receita' : 'salários + HE + benefícios + encargos'} />
      </div>
      <Tabela id="tCustos" cab={['Mês', 'Receita bruta', 'Receita / func.', 'Folha', 'Horas extras', 'Benefícios', 'Encargos', 'Outros', 'Custo total', 'Custo / func.']}
        linhas={ind.meses.map(x => [nomeM(x.m), x.receita == null ? '—' : U.moeda0(x.receita), x.receita && x.fim ? U.moeda0(x.receita / x.fim) : '—', U.moeda0(x.folha), U.moeda0(x.heValor),
          x.beneficios ? U.moeda0(x.beneficios) : '', x.encargos ? U.moeda0(x.encargos) : '', x.outros ? U.moeda0(x.outros) : '', U.moeda0(x.custo), x.fim ? U.moeda0(x.custo / x.fim) : '—'])}
        total={['Ano', receitaAno === null ? '—' : U.moeda0(receitaAno), receitaAno && mediaFunc ? U.moeda0(receitaAno / mediaFunc) : '—', U.moeda0(tot('folha')), U.moeda0(tot('heValor')), U.moeda0(tot('beneficios')),
          U.moeda0(tot('encargos')), U.moeda0(tot('outros')), U.moeda0(tot('custo')), mediaFunc ? U.moeda0(tot('custo') / mediaFunc) : '—']} />
      <p className="sub mt">Folha = salário de cada pessoa no mês. Horas extras = valor calculado no ponto. Benefícios: o que foi lançado à mão ou, se o mês estiver em branco, a parte da empresa no cadastro de benefícios.</p>
    </>}

    <h2 className="mt2">Dicas do mês</h2>
    <div className="barra-filtros mt"><select aria-label="Mês das dicas" value={mD} onChange={(e) => setMesDica(e.target.value)} data-ind="mesDica">{ind.meses.map(x => <option key={x.m} value={x.m}>{U.cap(U.nomeMes(Number(x.m.slice(5))))}</option>)}</select></div>
    <div className="lista mt" id="alertasInd">{ds.map((a, i) => <div key={i} className={`nota ${a.tom === 'ruim' ? 'vermelha' : a.tom === 'bom' ? 'verde' : 'amarela'} mt`}><b>{a.t}:</b> {a.txt}</div>)}
      {!ds.length && <Vazio icone="relatorio" titulo="Sem comparação" texto="O primeiro mês do ano não tem mês anterior para comparar." />}</div>
  </div>
}
const Kpi = ({ t, v, s, alerta }: { t: string; v: string; s?: string; alerta?: boolean }) => <div className={`kpi${alerta ? ' alerta' : ''}`}><small>{t}</small><b>{v}</b>{s && <span>{s}</span>}</div>
const Quadro = ({ t, children }: { t: string; children: ReactNode }) => <section className="card"><h3>{t}</h3><div className="mt">{children}</div></section>
function Tabela({ id, cab, linhas, total }: { id: string; cab: string[]; linhas: (string | number)[][]; total?: (string | number)[] }) {
  return <div className="tabela-caixa mt"><table className="tabela" id={id}><thead><tr>{cab.map((c, i) => <th key={i} className={i ? 'num' : ''}>{c}</th>)}</tr></thead>
    <tbody>{linhas.map((l, n) => <tr key={n}>{l.map((c, i) => <td key={i} className={i ? 'num' : ''}>{c}</td>)}</tr>)}</tbody>
    {total && <tfoot><tr>{total.map((c, i) => <td key={i} className={i ? 'num' : ''}>{c}</td>)}</tr></tfoot>}</table></div>
}

// ---------------------------------------------------------------- metas
async function editarMetas(): Promise<void> {
  const m = metasRH()
  await modal({
    titulo: 'Metas dos indicadores',
    corpo: <><p className="sub">O cartão fica vermelho quando o indicador passa da meta.</p>
      <div className="linha-campos l2"><Campo nome="turnover" rotulo="Turnover: até (%)" tipo="num" req valor={U.campoNum(m.turnover, 2)} foco /><Campo nome="absenteismo" rotulo="Absenteísmo: até (%)" tipo="num" req valor={U.campoNum(m.absent, 2)} /></div></>,
    botoes: [{ txt: 'Salvar', acao: async (f) => {
      const d = lerForm(f)
      const t = Number(d.turnover), a = Number(d.absenteismo)
      if (!(t > 0 && t <= 100) || !(a > 0 && a <= 100)) throw new Error('Meta entre 0 e 100%')
      await API.rpc('salvar_config', { p_chave: 'rh', p_valor: { ...S.cfg<Record<string, unknown>>('rh', {}), metas: { turnover: t, absenteismo: a } } })
      await App.gravou(['config']); aviso('Metas salvas.'); return true
    } }],
  })
}

// ---------------------------------------------------------------- números de um mês (vale sobre o cálculo)
const CAMPOS_MES: [keyof RhIndicador & string, string, keyof Base][] = [['ini', 'Funcionários no início do mês', 'ini'], ['fim', 'Funcionários no fim do mês', 'fim'], ['adm', 'Admissões', 'adm'], ['dem', 'Desligamentos', 'dem'],
  ['prev_h', 'Horas previstas', 'prev'], ['injust_h', 'Horas de falta sem justificativa', 'injust'], ['just_h', 'Horas de falta justificada', 'just'], ['he_h', 'Horas extras', 'he']]
async function editarMes(x: Mes): Promise<void> {
  const l = S.lista('rh_indicadores').find(r => r.competencia.startsWith(x.m))
  const mes = Number(x.m.slice(5)), ano = Number(x.m.slice(0, 4))
  const gravar = async (vals: Record<string, number | null>) => {
    await API.rpc('rh_salvar_indicadores', { p: { ano, meses: [{ mes, ...vals }] } })
    await App.gravou(['rh_indicadores'], { inteira: ['rh_indicadores'] })
  }
  await modal({
    titulo: `Números de ${U.nomeMes(mes)}/${ano}`,
    corpo: <><p className="sub">Em branco = o sistema calcula (o número cinza). {l?.origem === 'planilha' ? 'Este mês veio da planilha antiga do RH.' : l?.origem === 'manual' ? 'Este mês foi digitado pelo RH.' : ''}</p>
      <div className="linha-campos l2">{CAMPOS_MES.map(([k, t, s]) => <Campo key={k} nome={k} rotulo={t} tipo="qtd" valor={l?.[k] != null ? U.campoNum(Number(l[k]), 2) : ''}
        placeholder={k.endsWith('_h') && !x.sis.temPonto ? 'sem ponto' : U.campoNum(U.r2(x.sis[s]), 2)} />)}</div></>,
    botoes: [
      ...(l?.origem ? [{ txt: 'Voltar ao cálculo', cls: 'fantasma', validar: false, acao: async () => { await gravar(Object.fromEntries(CAMPOS_MES.map(([k]) => [k, null]))); aviso('O mês voltou a ser calculado pelo sistema.'); return true } }] : []),
      { txt: 'Salvar', acao: async (f) => {
        const d = lerForm(f)
        await gravar(Object.fromEntries(CAMPOS_MES.map(([k]) => [k, d[k] == null || d[k] === '' ? null : Number(d[k])])))
        aviso('Mês salvo.'); return true
      } }],
  })
}

// receita bruta e custos que o sistema não conhece, mês a mês
async function lancar(ano: number) {
  const lanc = new Map(S.lista('rh_indicadores').filter(x => x.competencia.startsWith(String(ano))).map(x => [Number(x.competencia.slice(5, 7)), x]))
  const v = (n: number | null | undefined) => n == null ? '' : U.campoNum(n)
  await modal({
    titulo: `Receitas e custos de ${ano}`, largura: 'larga',
    corpo: <>
      <p className="sub">Receita bruta da empresa e os custos que não estão no sistema. Salários, horas extras e benefícios cadastrados o sistema já calcula (benefícios em branco = usa o cadastro).</p>
      <div className="tabela-caixa"><table className="tabela tabela-form" id="tLancInd"><thead><tr><th>Mês</th><th className="num">Receita bruta</th><th className="num">Benefícios</th><th className="num">Encargos</th><th className="num">Outros custos</th></tr></thead>
        <tbody>{MESES.map((m, i) => { const x = lanc.get(i + 1)
          return <tr key={m}><td>{m}</td>{(['receita', 'beneficios', 'encargos', 'outros'] as const).map(k => <td key={k}><input name={`${k}_${i + 1}`} inputMode="decimal" aria-label={`${k} ${m}`} defaultValue={v(x?.[k])} /></td>)}</tr> })}</tbody></table></div>
    </>,
    botoes: [{ txt: 'Salvar', acao: async (frm) => {
      const d = lerForm(frm)
      const meses = MESES.map((_, i) => ({ mes: i + 1, receita: U.num(d[`receita_${i + 1}`]), beneficios: U.num(d[`beneficios_${i + 1}`]), encargos: U.num(d[`encargos_${i + 1}`]), outros: U.num(d[`outros_${i + 1}`]) }))
      await API.rpc('rh_salvar_indicadores', { p: { ano, meses } })
      await App.gravou(['rh_indicadores'], { inteira: ['rh_indicadores'] }); aviso('Salvo.')
    } }],
  })
}

// ---------------------------------------------------------------- PDF e Excel
function linhasExport(ind: Ind) {
  const metas = metasRH()
  const resumo: (string | number)[][] = [['Turnover do ano', pc(ind.turnAno), `até ${pc(metas.turnover)}`, ind.turnAno === null ? '—' : ind.turnAno > metas.turnover ? 'Acima da meta' : 'Dentro da meta'],
    ['Absenteísmo do ano', pc(ind.absAno), `até ${pc(metas.absent)}`, ind.absAno === null ? '—' : ind.absAno > metas.absent ? 'Acima da meta' : 'Dentro da meta'],
    ['Horas extras no ano', h0(ind.heAno) + ' h', '', ''], ['Admissões / desligamentos', `${U.soma(ind.meses, x => x.adm)} / ${U.soma(ind.meses, x => x.dem)}`, '', '']]
  const turn = ind.meses.map(x => [nomeM(x.m), x.ini, x.fim, U.r2((x.ini + x.fim) / 2), x.adm, x.dem, pc(x.turnover), ORIG[x.origem]])
  const abs = ind.meses.map(x => [nomeM(x.m), U.r2(x.prev), U.r2(x.injust), U.r2(x.just), pc(x.absent), U.r2(x.he), ORIG[x.origem]])
  return { resumo, turn, abs }
}
async function excelIndicadores(ind: Ind) {
  const { resumo, turn, abs } = linhasExport(ind)
  const obj = (cab: string[], l: (string | number | null)[][]) => l.map(r => Object.fromEntries(cab.map((c, i) => [c, r[i]])))
  const sens = sensivel()
  const abas: [string, Record<string, unknown>[]][] = [['Resumo', obj(['Indicador', 'Resultado', 'Meta', 'Situação'], resumo)],
    ['Turnover', obj(['Mês', 'Início', 'Fim', 'Efetivo médio', 'Admissões', 'Desligamentos', 'Turnover', 'Origem'], turn)],
    ['Absenteísmo e HE', obj(['Mês', 'Horas previstas', 'Falta sem justificativa (h)', 'Falta justificada (h)', 'Absenteísmo', 'Horas extras (h)', 'Origem'], abs)],
    ['Equipe', obj(['Grupo', 'Item', 'Pessoas'], [...ind.sexo.map(x => ['Sexo', x.t, x.v]), ...ind.faixa.map(x => ['Faixa etária', x.t, x.v]), ...ind.escol.map(x => ['Escolaridade', x.t, x.v]),
      ...ind.tipo.map(x => ['Tipo de cargo', x.t, x.v]), ...ind.motivos.map(x => ['Motivo de desligamento', x.t, x.v])])]]
  if (sens) abas.push(['Receitas e custos', obj(['Mês', 'Receita bruta', 'Folha', 'Horas extras (R$)', 'Benefícios', 'Encargos', 'Outros', 'Custo total'],
    ind.meses.map(x => [nomeM(x.m), x.receita, U.r2(x.folha), U.r2(x.heValor), U.r2(x.beneficios), x.encargos, x.outros, U.r2(x.custo)]))])
  await excel(`Indicadores de RH ${ind.ano}${ind.reg === 'todas' ? '' : ' ' + ind.reg}.xlsx`, abas)
}
async function pdfIndicadores(ind: Ind) {
  const { resumo, turn, abs } = linhasExport(ind)
  const blob = await pdfDocumento('Indicadores de RH', `${ind.reg === 'todas' ? 'Empresa toda' : ind.reg} · ${ind.ano}${ind.ate < `${ind.ano}-12-31` ? ' — até ' + U.data(ind.ate) : ''}`, (c) => {
    const sec = (t: string, head: string[], body: (string | number)[][], nota?: string) => {
      let y = (c.doc.lastAutoTable?.finalY ?? c.y) + 8
      if (y > c.H - 50) { c.doc.addPage(); y = 20 }
      c.doc.setFont('helvetica', 'bold'); c.doc.setFontSize(10.5); c.doc.setTextColor(20); c.doc.text(t, 14, y); c.doc.setFont('helvetica', 'normal')
      if (nota) { c.doc.setFontSize(7.8); c.doc.setTextColor(90); c.doc.text(nota, 14, y + 4.5); y += 4.5 }
      c.tabela({ ...c.estilo, startY: y + 2, head: [head], body: body.map(r => r.map(x => typeof x === 'number' && !Number.isInteger(x) ? U.dec(x) : String(x))), styles: { ...c.estilo.styles, fontSize: 8.4 } })
    }
    sec('Resumo do ano', ['Indicador', 'Resultado', 'Meta', 'Situação'], resumo)
    sec('Turnover por mês', ['Mês', 'Início', 'Fim', 'Efetivo médio', 'Admissões', 'Deslig.', 'Turnover', 'Origem'], turn, 'Turnover = [(admissões + desligamentos) ÷ 2] ÷ efetivo médio × 100; efetivo médio = (início + fim) ÷ 2. Ano = média dos meses fechados.')
    sec('Absenteísmo e horas extras por mês', ['Mês', 'Horas previstas', 'Sem justif. (h)', 'Justificadas (h)', 'Absenteísmo', 'Horas extras', 'Origem'], abs, 'Absenteísmo = (faltas sem justificativa + justificadas, em horas) ÷ horas previstas × 100. Ano = soma das horas.')
  })
  await entregar(blob, `Indicadores de RH ${ind.ano}${ind.reg === 'todas' ? '' : ' ' + ind.reg}.pdf`)
}
