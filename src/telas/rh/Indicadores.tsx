/* RH — Indicadores (a "Planilha de Indicadores de RH" dentro do sistema): rotatividade, equipe, treinamentos,
 * horas extras e absenteísmo, receitas e custos, com alertas automáticos do mês. Quase tudo vem sozinho do cadastro,
 * do ponto e dos treinamentos; só a receita bruta e os custos que o sistema não conhece são lançados à mão. */
import { useState, type ReactNode } from 'react'
import { App } from '../../app/controle.tsx'
import { API } from '../../lib/api.ts'
import { S } from '../../lib/dados.ts'
import * as R from '../../lib/rh.ts'
import type { Funcionario, RhPonto } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { aviso } from '../../ui/avisos.ts'
import { entregar, excel, pdfDocumento } from '../../ui/arquivos.tsx'
import { Btn, Cab, Vazio } from '../../ui/base.tsx'
import { useLembrar } from '../../ui/ganchos.ts'
import { lerForm, modal } from '../../ui/janelas.tsx'
import { Barras } from '../Relatorios.tsx'
import { pode, salarioHE } from './comum.tsx'
import { feriadosMap, resumoDe } from './Ponto.tsx'

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const FAIXAS: [string, number, number][] = [['Até 25 anos', 0, 25], ['26 a 33 anos', 26, 33], ['34 a 43 anos', 34, 43], ['44 a 53 anos', 44, 53], ['54 a 60 anos', 54, 60], ['Mais de 60 anos', 61, 200]]
const pct1 = (x: number) => (x * 100).toFixed(1).replace('.', ',') + '%'
const fimMes = (m: string) => U.somaDias(U.somaMeses(m + '-01', 1), -1)
const naEmpresa = (f: Funcionario, dia: string) => !!f.admissao && f.admissao <= dia && (!f.demissao || f.demissao >= dia)
const mesesEntre = (a: string, b: string) => { const x = U.d(a)!, y = U.d(b)!; let n = (y.getFullYear() - x.getFullYear()) * 12 + y.getMonth() - x.getMonth(); if (y.getDate() < x.getDate()) n--; return Math.max(0, n) }

interface Mes {
  m: string; ini: number; fim: number; adm: number; desl: number; turnover: number
  folha: number; heValor: number; heHoras: number; prev: number; perdidas: number; absent: number
  receita: number | null; beneficios: number; encargos: number; outros: number; custo: number
}
interface Ind {
  ano: number; ate: string; meses: Mes[]
  ativos: Funcionario[]; adm: number; desl: number; fimAno: number; permanencia: number; aprov: number | null; aprovN: string; turnover: number
  motivos: { t: string; v: number }[]; sexo: { t: string; v: number }[]; faixa: { t: string; v: number }[]; escol: { t: string; v: number }[]; tipo: { t: string; v: number }[]; setor: { t: string; v: number }[]
  treinos: number; treinados: number; horasTreino: number; planoFeito: number; planoTotal: number
}

function contar(l: string[]): { t: string; v: number }[] {
  const m = new Map<string, number>(); for (const x of l) m.set(x, (m.get(x) || 0) + 1)
  return [...m.entries()].map(([t, v]) => ({ t, v })).sort((a, b) => b.v - a.v)
}

function calcular(ano: number): Ind {
  const hoje = U.hoje(), a = String(ano)
  const ate = a === hoje.slice(0, 4) ? hoje : `${a}-12-31`
  const fs = S.lista('funcionarios'), fer = feriadosMap()
  const pp = new Map<string, RhPonto[]>()
  for (const p of S.lista('rh_ponto')) { if (!p.data.startsWith(a)) continue; const k = p.funcionario_id + '|' + p.data.slice(0, 7); let l = pp.get(k); if (!l) pp.set(k, l = []); l.push(p) }
  const lanc = new Map(S.lista('rh_indicadores').map(x => [x.competencia.slice(0, 7), x]))
  const meses: Mes[] = []
  for (let i = 1; i <= 12; i++) {
    const m = `${a}-${String(i).padStart(2, '0')}`, ini = m + '-01', fim = fimMes(m)
    if (ini > ate) break
    const adm = fs.filter(f => f.admissao?.startsWith(m)).length, desl = fs.filter(f => f.demissao?.startsWith(m)).length
    const q0 = fs.filter(f => naEmpresa(f, U.somaDias(ini, -1))).length, q1 = fs.filter(f => naEmpresa(f, fim < ate ? fim : ate)).length
    let folha = 0, heValor = 0, heHoras = 0, prev = 0, perdidas = 0
    for (const f of fs) {
      if (!f.admissao || f.admissao > fim || (f.demissao && f.demissao < ini)) continue
      if (naEmpresa(f, fim < ate ? fim : ate)) folha += salarioHE(f, m)
      const ps = pp.get(f.id + '|' + m)
      const r = resumoDe(f, m, ps || [], fer)
      heValor += r.valores.total; heHoras += r.he + r.he100
      for (const d of r.dias) {
        if (d.rotulo === 'FÉRIAS' || d.rotulo === 'Fora do contrato' || d.data > ate) continue
        prev += d.prev; perdidas += d.atraso + (d.falta ? d.prev : 0)
      }
    }
    const l = lanc.get(m)
    const beneficios = Number(l?.beneficios) || 0, encargos = Number(l?.encargos) || 0, outros = Number(l?.outros) || 0
    meses.push({ m, ini: q0, fim: q1, adm, desl, turnover: q1 ? (adm + desl) / 2 / q1 : 0, folha, heValor, heHoras, prev, perdidas, absent: prev ? perdidas / prev : 0,
      receita: l?.receita != null ? Number(l.receita) : null, beneficios, encargos, outros, custo: folha + heValor + beneficios + encargos + outros })
  }
  const ativos = fs.filter(f => f.ativo && f.situacao !== 'desligado')
  const admAno = fs.filter(f => f.admissao?.startsWith(a)), deslAno = fs.filter(f => f.demissao?.startsWith(a))
  const fimAno = fs.filter(f => naEmpresa(f, ate)).length
  // experiência (30 + 30 dias): dos admitidos no ano cujo prazo já acabou, quantos ficaram
  const expFim = admAno.filter(f => U.somaDias(f.admissao!, 59) <= ate)
  const passou = expFim.filter(f => !f.demissao || f.demissao > U.somaDias(f.admissao!, 59))
  const naData = fs.filter(f => naEmpresa(f, ate))
  const priv = (f: Funcionario) => S.get('funcionarios_privado', f.id)
  const idadeFaixa = (f: Funcionario) => { const n = R.idade(priv(f)?.nascimento || null, ate); return n === null ? 'Sem data de nascimento' : (FAIXAS.find(([, x, y]) => n >= x && n <= y)?.[0] || '—') }
  // treinamentos concluídos no ano (nível 2 ou mais com data) e plano do ano
  const itens = new Map(S.lista('rh_matriz_itens').map(x => [x.id, x]))
  const niveis = S.lista('rh_matriz_niveis').filter(n => n.nivel >= 2 && n.data?.startsWith(a) && n.data <= ate)
  const plano = S.lista('rh_plano_treinos').filter(p => p.data?.startsWith(a) && p.status !== 'cancelado')
  return {
    ano, ate, meses, ativos, adm: admAno.length, desl: deslAno.length, fimAno,
    permanencia: naData.length ? U.soma(naData, f => mesesEntre(f.admissao!, ate)) / naData.length : 0,
    aprov: expFim.length ? passou.length / expFim.length : null, aprovN: `${passou.length} de ${expFim.length}`,
    turnover: fimAno ? (admAno.length + deslAno.length) / 2 / fimAno : 0,
    motivos: contar(deslAno.map(f => f.motivo_demissao || 'Sem motivo informado')),
    sexo: contar(naData.map(f => { const s = U.sem(priv(f)?.sexo || '').toLowerCase(); return s.startsWith('f') ? 'Feminino' : s.startsWith('m') ? 'Masculino' : 'Não informado' })),
    faixa: FAIXAS.map(([t]) => ({ t, v: naData.filter(f => idadeFaixa(f) === t).length })).filter(x => x.v),
    escol: contar(naData.map(f => priv(f)?.instrucao || 'Não informado')),
    tipo: contar(naData.map(f => S.get('rh_cargos', f.cargo_id)?.tipo || 'Sem tipo de cargo')),
    setor: contar(naData.map(f => f.setor || 'Sem setor')),
    treinos: niveis.length, treinados: new Set(niveis.map(n => n.funcionario_id)).size, horasTreino: U.soma(niveis, n => Number(itens.get(n.item_id)?.carga_horaria) || 0),
    planoFeito: plano.filter(p => p.status === 'realizado').length, planoTotal: plano.length,
  }
}

// alertas e dicas do mês (como a aba "AD" da planilha)
function alertas(ind: Ind, m: string): { tom: 'bom' | 'ruim' | 'neutro'; t: string; txt: string }[] {
  const i = ind.meses.findIndex(x => x.m === m); if (i < 0) return []
  const x = ind.meses[i], y = i > 0 ? ind.meses[i - 1] : null
  const r: { tom: 'bom' | 'ruim' | 'neutro'; t: string; txt: string }[] = []
  const varia = (a: number, b: number) => b ? (a - b) / b : (a ? 1 : 0)
  if (y) {
    const v = varia(x.turnover, y.turnover)
    r.push(v > 0.001 ? { tom: 'ruim', t: 'Turnover', txt: `O turnover subiu ${pct1(v)} em relação ao mês anterior (${pct1(y.turnover)} → ${pct1(x.turnover)}). Vale entender o motivo: mais desligamentos? falta de valorização? Quanto menor, melhor para a equipe e os resultados.` }
      : { tom: 'bom', t: 'Turnover', txt: `O turnover ficou estável ou caiu (${pct1(y.turnover)} → ${pct1(x.turnover)}). Bom sinal de satisfação da equipe.` })
    const va = x.absent - y.absent
    r.push(va > 0.002 ? { tom: 'ruim', t: 'Absenteísmo', txt: `O absenteísmo (faltas e atrasos) subiu de ${pct1(y.absent)} para ${pct1(x.absent)}. Veja no ponto quem concentrou as faltas.` }
      : { tom: 'bom', t: 'Absenteísmo', txt: `O absenteísmo ficou estável ou caiu (${pct1(y.absent)} → ${pct1(x.absent)}).` })
    const vh = varia(x.heValor, y.heValor)
    if (x.heValor || y.heValor) r.push(vh > 0.1 ? { tom: 'ruim', t: 'Horas extras', txt: `O gasto com horas extras subiu ${pct1(vh)} (${U.moeda0(y.heValor)} → ${U.moeda0(x.heValor)}). Se for constante, pode valer contratar ou usar banco de horas.` }
      : { tom: 'bom', t: 'Horas extras', txt: `O gasto com horas extras ficou sob controle (${U.moeda0(y.heValor)} → ${U.moeda0(x.heValor)}).` })
    if (x.receita && y.receita && x.fim && y.fim) {
      const rx = x.receita / x.fim, ry = y.receita / y.fim, vr = varia(rx, ry)
      r.push(vr >= 0 ? { tom: 'bom', t: 'Receita por funcionário', txt: `Cada funcionário gerou ${U.moeda0(rx)} de receita (antes ${U.moeda0(ry)}): ${pct1(vr)} a mais. A equipe está produzindo mais.` }
        : { tom: 'ruim', t: 'Receita por funcionário', txt: `A receita por funcionário caiu ${pct1(-vr)} (${U.moeda0(ry)} → ${U.moeda0(rx)}). Veja se a queda foi de vendas ou se a equipe cresceu antes da demanda.` })
    }
  }
  if (x.receita == null && pode()) r.push({ tom: 'neutro', t: 'Receita do mês', txt: 'A receita bruta deste mês ainda não foi lançada: toque em “Lançar receitas e custos” para ver receita e custo por funcionário.' })
  return r
}

export function TelaIndicadores() {
  const anoAtual = Number(U.hoje().slice(0, 4))
  const [ano, setAno] = useLembrar('ind.ano', anoAtual)
  const ind = calcular(ano)
  const ultimo = ind.meses.at(-1)?.m || `${ano}-01`
  const [mesAlerta, setMesAlerta] = useState(ultimo)
  const mAl = ind.meses.some(x => x.m === mesAlerta) ? mesAlerta : ultimo
  const anos = U.unicos([anoAtual, ...S.lista('funcionarios').map(f => Number((f.admissao || '').slice(0, 4))).filter(n => n >= anoAtual - 6)]).sort((a, b) => b - a)
  const tot = (k: keyof Mes) => U.soma(ind.meses, x => Number(x[k]) || 0)
  const receitaAno = ind.meses.some(x => x.receita != null) ? U.soma(ind.meses, x => x.receita || 0) : null
  const mediaFunc = ind.meses.length ? U.soma(ind.meses, x => x.fim) / ind.meses.length : 0
  return <>
    <Cab titulo="Indicadores de RH" sub={`${S.cfg<{ razao?: string }>('empresa', {}).razao || 'JAF Metal'} — ${ano}${ind.ate < `${ano}-12-31` ? ` (até ${U.data(ind.ate)})` : ''}`}>
      {pode() && <Btn txt="Lançar receitas e custos" icone="dinheiro" cls="pri" data-ind="lancar" onClick={() => void lancar(ano)} />}
      <Btn txt="PDF" icone="imprimir" data-ind="pdf" onClick={() => pdfIndicadores(ind)} />
      <Btn txt="Excel" icone="planilha" data-ind="excel" onClick={() => excelIndicadores(ind)} />
    </Cab>
    <div className="barra-filtros"><select aria-label="Ano" value={ano} onChange={(e) => setAno(Number(e.target.value))} data-ind="ano">{anos.map(a => <option key={a} value={a}>{a}</option>)}</select></div>

    <h2 className="mt">1. Rotatividade</h2>
    <div className="grade g4 mt">
      <Kpi t="Admissões no ano" v={String(ind.adm)} s={`${U.plural(ind.desl, 'desligamento')}`} />
      <Kpi t="Funcionários" v={String(ind.fimAno)} s={`em ${U.data(ind.ate)}`} />
      <Kpi t="Turnover do ano" v={pct1(ind.turnover)} s="(admissões + saídas) ÷ 2 ÷ funcionários" alerta={ind.turnover > 0.25} />
      <Kpi t="Passaram na experiência" v={ind.aprov === null ? '—' : pct1(ind.aprov)} s={ind.aprov === null ? 'ninguém terminou a experiência' : ind.aprovN + ' admitidos'} />
    </div>
    <p className="sub mt">Tempo médio de casa de quem está na empresa: <b>{Math.round(ind.permanencia)} meses</b> ({R.tempoCasa(U.somaMeses(ind.ate, -Math.round(ind.permanencia)), ind.ate)}).</p>
    <Tabela id="tRot" cab={['Mês', 'Início do mês', 'Admissões', 'Desligamentos', 'Fim do mês', 'Turnover']}
      linhas={ind.meses.map(x => [MESES[Number(x.m.slice(5)) - 1], x.ini, x.adm, x.desl, x.fim, pct1(x.turnover)])}
      total={['Ano', ind.meses[0]?.ini ?? '', ind.adm, ind.desl, ind.fimAno, pct1(ind.turnover)]} />
    <div className="grade g2 mt">
      <Quadro t="Motivos de desligamento">{ind.motivos.length ? <Barras itens={ind.motivos} fmt={String} /> : <p className="sub">Nenhum desligamento no ano.</p>}</Quadro>
      <Quadro t="Funcionários no fim de cada mês"><Barras itens={ind.meses.map(x => ({ t: MESES[Number(x.m.slice(5)) - 1], v: x.fim }))} fmt={String} /></Quadro>
    </div>

    <h2 className="mt2">2. Equipe <small className="fraco">(em {U.data(ind.ate)})</small></h2>
    <div className="grade g2 mt">
      <Quadro t="Sexo"><Barras itens={ind.sexo} fmt={String} /></Quadro>
      <Quadro t="Faixa etária"><Barras itens={ind.faixa} fmt={String} /></Quadro>
      <Quadro t="Escolaridade"><Barras itens={ind.escol} fmt={String} /></Quadro>
      <Quadro t="Tipo de cargo">{ind.tipo.length ? <Barras itens={ind.tipo} fmt={String} /> : null}<p className="sub">O tipo vem do cadastro de cargos (RH → Ajustes → Cargos).</p></Quadro>
    </div>

    <h2 className="mt2">3. Treinamentos</h2>
    <div className="grade g4 mt">
      <Kpi t="Treinamentos concluídos" v={String(ind.treinos)} s="nas matrizes, no ano" />
      <Kpi t="Pessoas treinadas" v={String(ind.treinados)} s={ind.fimAno ? pct1(ind.treinados / ind.fimAno) + ' da equipe' : ''} />
      <Kpi t="Horas de treinamento" v={R.horas(ind.horasTreino)} s={ind.treinados ? R.horas(ind.horasTreino / ind.treinados) + ' por pessoa treinada' : 'carga horária dos itens'} />
      <Kpi t="Plano do ano" v={`${ind.planoFeito} de ${ind.planoTotal}`} s="treinamentos realizados" />
    </div>

    <h2 className="mt2">4. Horas extras, absenteísmo, receitas e custos</h2>
    <div className="grade g4 mt">
      <Kpi t="Receita bruta do ano" v={receitaAno === null ? '—' : U.moeda0(receitaAno)} s={receitaAno !== null && mediaFunc ? U.moeda0(receitaAno / mediaFunc) + ' por funcionário' : 'lance em “Lançar receitas e custos”'} />
      <Kpi t="Folha (salários)" v={U.moeda0(tot('folha'))} s="soma dos salários de cada mês" />
      <Kpi t="Horas extras" v={U.moeda0(tot('heValor'))} s={R.horas(tot('heHoras')) + ' no ano'} />
      <Kpi t="Custo total" v={U.moeda0(tot('custo'))} s={receitaAno ? pct1(tot('custo') / receitaAno) + ' da receita' : 'salários + HE + benefícios + encargos'} />
    </div>
    <Tabela id="tCustos" cab={['Mês', 'Receita bruta', 'Receita / func.', 'Folha', 'Horas extras', 'Benefícios', 'Encargos', 'Outros', 'Custo total', 'Custo / func.', 'Absenteísmo']}
      linhas={ind.meses.map(x => [MESES[Number(x.m.slice(5)) - 1], x.receita == null ? '—' : U.moeda0(x.receita), x.receita && x.fim ? U.moeda0(x.receita / x.fim) : '—', U.moeda0(x.folha), U.moeda0(x.heValor),
        x.beneficios ? U.moeda0(x.beneficios) : '', x.encargos ? U.moeda0(x.encargos) : '', x.outros ? U.moeda0(x.outros) : '', U.moeda0(x.custo), x.fim ? U.moeda0(x.custo / x.fim) : '—', pct1(x.absent)])}
      total={['Ano', receitaAno === null ? '—' : U.moeda0(receitaAno), receitaAno && mediaFunc ? U.moeda0(receitaAno / mediaFunc) : '—', U.moeda0(tot('folha')), U.moeda0(tot('heValor')), U.moeda0(tot('beneficios')),
        U.moeda0(tot('encargos')), U.moeda0(tot('outros')), U.moeda0(tot('custo')), mediaFunc ? U.moeda0(tot('custo') / mediaFunc) : '—', pct1(tot('prev') ? tot('perdidas') / tot('prev') : 0)]} />
    <p className="sub mt">Folha = salário de cada pessoa no mês (pela linha do tempo). Horas extras = valor calculado no ponto. Absenteísmo = faltas e atrasos ÷ horas previstas. Benefícios, encargos e outros custos são lançados à mão.</p>

    <h2 className="mt2">5. Alertas e dicas do mês</h2>
    <div className="barra-filtros mt"><select aria-label="Mês dos alertas" value={mAl} onChange={(e) => setMesAlerta(e.target.value)} data-ind="mes">{ind.meses.map(x => <option key={x.m} value={x.m}>{U.cap(U.nomeMes(Number(x.m.slice(5))))}</option>)}</select></div>
    <div className="lista mt" id="alertasInd">{alertas(ind, mAl).map((a, i) => <div key={i} className={`nota ${a.tom === 'ruim' ? 'vermelha' : a.tom === 'bom' ? 'verde' : 'amarela'} mt`}><b>{a.t}:</b> {a.txt}</div>)}
      {!alertas(ind, mAl).length && <Vazio icone="relatorio" titulo="Sem comparação" texto="O primeiro mês do ano não tem mês anterior para comparar." />}</div>
  </>
}
const Kpi = ({ t, v, s, alerta }: { t: string; v: string; s?: string; alerta?: boolean }) => <div className={`kpi${alerta ? ' alerta' : ''}`}><small>{t}</small><b>{v}</b>{s && <span>{s}</span>}</div>
const Quadro = ({ t, children }: { t: string; children: ReactNode }) => <section className="card"><h3>{t}</h3><div className="mt">{children}</div></section>
function Tabela({ id, cab, linhas, total }: { id: string; cab: string[]; linhas: (string | number)[][]; total?: (string | number)[] }) {
  return <div className="tabela-caixa mt"><table className="tabela" id={id}><thead><tr>{cab.map((c, i) => <th key={i} className={i ? 'num' : ''}>{c}</th>)}</tr></thead>
    <tbody>{linhas.map((l, n) => <tr key={n}>{l.map((c, i) => <td key={i} className={i ? 'num' : ''}>{c}</td>)}</tr>)}</tbody>
    {total && <tfoot><tr>{total.map((c, i) => <td key={i} className={i ? 'num' : ''}>{c}</td>)}</tr></tfoot>}</table></div>
}

// receita bruta e custos que o sistema não conhece, mês a mês
async function lancar(ano: number) {
  const lanc = new Map(S.lista('rh_indicadores').filter(x => x.competencia.startsWith(String(ano))).map(x => [Number(x.competencia.slice(5, 7)), x]))
  const v = (n: number | null | undefined) => n == null ? '' : U.campoNum(n)
  await modal({
    titulo: `Receitas e custos de ${ano}`, largura: 'larga',
    corpo: <>
      <p className="sub">Receita bruta total da empresa e os custos que não estão no sistema. Salários e horas extras o sistema já calcula sozinho.</p>
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

function linhasExport(ind: Ind) {
  const geral = [['Admissões no ano', ind.adm], ['Desligamentos no ano', ind.desl], ['Funcionários em ' + U.data(ind.ate), ind.fimAno], ['Turnover do ano', pct1(ind.turnover)],
    ['Índice de aprovação na experiência', ind.aprov === null ? '—' : `${pct1(ind.aprov)} (${ind.aprovN})`], ['Tempo médio de casa (meses)', Math.round(ind.permanencia)],
    ['Treinamentos concluídos', ind.treinos], ['Pessoas treinadas', ind.treinados], ['Horas de treinamento', R.horas(ind.horasTreino)], ['Plano do ano realizado', `${ind.planoFeito} de ${ind.planoTotal}`]]
  const rot = ind.meses.map(x => [MESES[Number(x.m.slice(5)) - 1], x.ini, x.adm, x.desl, x.fim, pct1(x.turnover)])
  const cus = ind.meses.map(x => [MESES[Number(x.m.slice(5)) - 1], x.receita ?? '', x.receita && x.fim ? U.r2(x.receita / x.fim) : '', U.r2(x.folha), U.r2(x.heValor), x.beneficios || '', x.encargos || '', x.outros || '', U.r2(x.custo), x.fim ? U.r2(x.custo / x.fim) : '', pct1(x.absent)])
  const equipe = [...ind.sexo.map(x => ['Sexo', x.t, x.v]), ...ind.faixa.map(x => ['Faixa etária', x.t, x.v]), ...ind.escol.map(x => ['Escolaridade', x.t, x.v]), ...ind.tipo.map(x => ['Tipo de cargo', x.t, x.v]),
    ...ind.motivos.map(x => ['Motivo de desligamento', x.t, x.v])]
  return { geral, rot, cus, equipe }
}
async function excelIndicadores(ind: Ind) {
  const { geral, rot, cus, equipe } = linhasExport(ind)
  const obj = (cab: string[], l: (string | number)[][]) => l.map(r => Object.fromEntries(cab.map((c, i) => [c, r[i]])))
  await excel(`Indicadores de RH ${ind.ano}.xlsx`, [['Geral', obj(['Indicador', 'Resultado'], geral)], ['Rotatividade', obj(['Mês', 'Início do mês', 'Admissões', 'Desligamentos', 'Fim do mês', 'Turnover'], rot)],
    ['Receitas e custos', obj(['Mês', 'Receita bruta', 'Receita por funcionário', 'Folha', 'Horas extras', 'Benefícios', 'Encargos', 'Outros', 'Custo total', 'Custo por funcionário', 'Absenteísmo'], cus)],
    ['Equipe', obj(['Grupo', 'Item', 'Pessoas'], equipe)]])
}
async function pdfIndicadores(ind: Ind) {
  const { geral, rot, cus, equipe } = linhasExport(ind)
  const blob = await pdfDocumento('Indicadores de RH', `${ind.ano}${ind.ate < `${ind.ano}-12-31` ? ' — até ' + U.data(ind.ate) : ''}`, (c) => {
    const sec = (t: string, head: string[], body: (string | number)[][], deitar = false) => {
      let y = (c.doc.lastAutoTable?.finalY ?? c.y) + 8
      if (y > c.H - 40) { c.doc.addPage(); y = 20 }
      c.doc.setFont('helvetica', 'bold'); c.doc.setFontSize(10.5); c.doc.setTextColor(20); c.doc.text(t, 14, y); c.doc.setFont('helvetica', 'normal')
      c.tabela({ ...c.estilo, startY: y + 2, head: [head], body: body.map(r => r.map(x => typeof x === 'number' && !Number.isInteger(x) ? U.moeda(x) : String(x))), styles: { ...c.estilo.styles, fontSize: deitar ? 7.2 : 8.4 } })
    }
    sec('Resumo do ano', ['Indicador', 'Resultado'], geral)
    sec('Rotatividade por mês', ['Mês', 'Início', 'Admissões', 'Desligamentos', 'Fim', 'Turnover'], rot)
    sec('Receitas e custos por mês', ['Mês', 'Receita', 'Receita/func.', 'Folha', 'HE', 'Benef.', 'Encargos', 'Outros', 'Custo', 'Custo/func.', 'Absent.'], cus, true)
    sec('Equipe e desligamentos', ['Grupo', 'Item', 'Pessoas'], equipe)
  })
  await entregar(blob, `Indicadores de RH ${ind.ano}.pdf`)
}
