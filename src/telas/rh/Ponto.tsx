/* RH — Ponto e horas extras (a "Planilha de Horas Extras"): lançamento do mês por pessoa, fechamento de todos e exportação para a contabilidade.
 * Conta igual à planilha: horas = saída − entrada − intervalo; previsto 9 h (seg–qui) / 8 h (sex); extra = o que passa;
 * domingo e feriado a 100%; faixas 50% (até 25 h), 60% (+15 h), 80% (+20 h), 100% (resto); Upgrade 60%. */
import { useEffect, useMemo, useState } from 'react'
import { App } from '../../app/controle.tsx'
import { API, ErroApp } from '../../lib/api.ts'
import { S } from '../../lib/dados.ts'
import * as R from '../../lib/rh.ts'
import type { Funcionario, Justificativa, RhPonto } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { aviso, erro } from '../../ui/avisos.ts'
import { excel } from '../../ui/arquivos.tsx'
import { Btn, Cab, Campo, Chips, Vazio } from '../../ui/base.tsx'
import { ir, useLembrar, type Rota } from '../../ui/ganchos.ts'
import { Ic } from '../../ui/icones.tsx'
import { confirmar, lerForm, modal } from '../../ui/janelas.tsx'
import { ativos, jornada, pode, salarioHE, sensivel } from './comum.tsx'

const JUST: [Justificativa | '', string][] = [['', '—'], ['atestado', 'Atestado'], ['declaracao', 'Declaração'], ['licenca', 'Licença'], ['folga', 'Folga'], ['compensado', 'Compensado (banco)'], ['abonado', 'Abonado'], ['falta', 'Falta']]
const mesAtual = () => U.hoje().slice(0, 7)
const nomeMesAno = (m: string) => `${U.nomeMes(Number(m.slice(5, 7)))} de ${m.slice(0, 4)}`
const outroMes = (m: string, n: number) => U.somaMeses(m + '-01', n).slice(0, 7)
const hm = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : '')

export const feriadosMap = (): Map<string, string> => new Map(S.lista('rh_feriados').map(f => [f.data, f.nome]))
export const mesFechado = (fid: string, m: string): boolean => S.lista('rh_ponto_meses').some(x => x.funcionario_id === fid && x.competencia.slice(0, 7) === m)

// resumo de um mês de uma pessoa (usado aqui, na ficha e nos relatórios)
export function resumoDe(f: Funcionario, m: string, pontos?: RhPonto[], feriados = feriadosMap()): R.ResumoMes {
  const j = jornada()
  const [ano, mes] = [Number(m.slice(0, 4)), Number(m.slice(5, 7))]
  const ps = pontos ?? S.lista('rh_ponto').filter(p => p.funcionario_id === f.id && p.data.startsWith(m))
  return R.resumoMes(ano, mes, {
    pontos: ps, ausencias: S.lista('rh_ausencias').filter(a => a.funcionario_id === f.id), feriados, fechado: mesFechado(f.id, m),
    upgrade: f.registro === 'Upgrade', salarioHora: sensivel() ? salarioHE(f) / j.divisor : 0, admissao: f.admissao, demissao: f.demissao,
  }, j)
}
// quem aparece no mês: ativos + quem saiu durante o mês
const pessoasDoMes = (m: string) => U.ordenar(S.lista('funcionarios').filter(f => (f.ativo || (f.demissao && f.demissao.slice(0, 7) >= m)) && (!f.admissao || f.admissao.slice(0, 7) <= m)), f => U.sem(f.nome))

export function TelaPonto({ r }: { r: Rota }) {
  const fid = r.q.get('f')
  const [m, setM] = useLembrar('ponto.m', mesAtual())
  useEffect(() => { const q = r.q.get('m'); if (q && /^\d{4}-\d\d$/.test(q)) setM(q) }, [r.hash, r.q, setM])
  const f = fid ? S.get('funcionarios', fid) : null
  return f ? <PontoPessoa f={f} m={m} setM={setM} /> : <Fechamento m={m} setM={setM} />
}

function SeletorMes({ m, setM }: { m: string; setM: (m: string) => void }) {
  return <div className="seletor-mes"><button type="button" className="icone-btn" aria-label="Mês anterior" data-mes="-1" onClick={() => setM(outroMes(m, -1))}><Ic n="voltar" /></button>
    <b>{U.cap(nomeMesAno(m))}</b><button type="button" className="icone-btn" aria-label="Próximo mês" data-mes="1" onClick={() => setM(outroMes(m, 1))}><Ic n="seta" /></button></div>
}

// ------------------------------------------------------------------ todos do mês (fechamento)
function Fechamento({ m, setM }: { m: string; setM: (m: string) => void }) {
  const [f, setF] = useLembrar('ponto.f', 'todos')
  const sens = sensivel()
  const fer = feriadosMap()
  const porPessoa = U.agrupar(S.lista('rh_ponto').filter(p => p.data.startsWith(m)), p => p.funcionario_id)
  const linhas = pessoasDoMes(m).map(x => ({ f: x, r: resumoDe(x, m, porPessoa.get(x.id) || [], fer), dias: (porPessoa.get(x.id) || []).length, fechado: mesFechado(x.id, m) }))
  const comHE = linhas.filter(l => l.r.he + l.r.he100 > 0), comFalta = linhas.filter(l => l.r.faltas > 0 || l.r.atraso > 0), abertos = linhas.filter(l => !l.fechado)
  const vis = f === 'he' ? comHE : f === 'faltas' ? comFalta : f === 'abertos' ? abertos : linhas
  const tot = { he: U.soma(linhas, l => l.r.he + l.r.he100), v: U.soma(linhas, l => l.r.valores.total), faltas: U.soma(linhas, l => l.r.faltas) }
  const j = jornada()
  return <>
    <Cab titulo="Ponto e horas extras" sub="Escolha a pessoa para lançar o cartão de ponto do mês.">
      {pode() && <Btn txt="Lançar para várias pessoas" icone="equipe" data-ponto="varios" onClick={() => void lancarVarios(m)} />}
      {sens && <Btn txt="Exportar para a contabilidade" icone="planilha" cls="pri" data-ponto="exportar" onClick={() => exportarFechamento(m, linhas)} />}
    </Cab>
    <SeletorMes m={m} setM={setM} />
    <div className="grade g3 mt">
      <div className="kpi"><small>Horas extras no mês</small><b>{R.horas(tot.he)}</b><span>{U.plural(comHE.length, 'pessoa')}</span></div>
      {sens && <div className="kpi"><small>Valor das horas extras</small><b>{U.moeda0(tot.v)}</b><span>sem encargos</span></div>}
      <div className={`kpi${tot.faltas ? ' alerta' : ''}`}><small>Faltas</small><b>{tot.faltas}</b><span>{U.plural(comFalta.length, 'pessoa')} com falta ou atraso</span></div>
    </div>
    <div className="barra-filtros mt"><Chips atual={f} aoEscolher={setF} nome="pf" opcoes={[{ v: 'todos', t: 'Todos', n: linhas.length }, { v: 'he', t: 'Com hora extra', n: comHE.length }, { v: 'faltas', t: 'Com falta ou atraso', n: comFalta.length }, { v: 'abertos', t: 'Mês não fechado', n: abertos.length }]} /></div>
    {vis.length ? <div className="tabela-caixa"><table className="tabela cartoes" id="tPonto"><thead><tr><th>Pessoa</th><th className="num">Dias lançados</th><th className="num">50%</th><th className="num">60%</th><th className="num">80%</th><th className="num">100%</th>
      <th className="num">Faltas</th><th className="num">Atrasos</th>{sens && <th className="num">Valor HE</th>}<th>Mês</th></tr></thead>
      <tbody>{vis.map(({ f: x, r: s, dias, fechado }) => <tr key={x.id} className="clicavel" data-pessoa={x.id} onClick={() => ir(`#/rh/ponto?f=${x.id}&m=${m}`)}>
        <td className="titulo" data-r="Pessoa"><b>{x.nome}</b><div className="peq">{[x.funcao, x.registro].filter(Boolean).join(' · ')}</div></td>
        <td className="num" data-r="Dias lançados">{dias}</td><td className="num" data-r="50%">{s.faixas.p50 ? R.horas(s.faixas.p50) : ''}</td><td className="num" data-r="60%">{s.faixas.p60 ? R.horas(s.faixas.p60) : ''}</td>
        <td className="num" data-r="80%">{s.faixas.p80 ? R.horas(s.faixas.p80) : ''}</td><td className="num" data-r="100%">{s.faixas.p100 ? R.horas(s.faixas.p100) : ''}</td>
        <td className="num" data-r="Faltas">{s.faltas || ''}</td><td className="num" data-r="Atrasos">{s.atraso ? R.horas(s.atraso) : ''}</td>
        {sens && <td className="num" data-r="Valor HE">{s.valores.total ? U.moeda(s.valores.total) : ''}</td>}
        <td data-r="Mês">{fechado ? <span className="tag t-verde">Fechado</span> : <span className="tag t-cinza">Aberto</span>}</td></tr>)}</tbody></table></div>
      : <Vazio icone="relogio" titulo="Ninguém aqui" texto="Mude o filtro ou o mês." />}
    {pode() && abertos.length > 0 && <div className="grupo-btn mt"><Btn txt={`Fechar o mês de todos (${abertos.length})`} icone="cadeado" data-ponto="fecharTodos" onClick={async () => {
      const branco = j.branco === 'falta' ? U.soma(abertos, l => l.r.semLancamento) : 0
      if (!(await confirmar(`Fechar ${nomeMesAno(m)} de ${U.plural(abertos.length, 'pessoa')}?`, { detalhe: (branco ? `${U.plural(branco, 'dia útil', 'dias úteis')} sem lançamento vão contar como FALTA. ` : '') + 'Depois de fechado, o ponto do mês só muda reabrindo.', ok: 'Fechar o mês' }))) return
      try { for (const l of abertos) await API.rpc('rh_fechar_mes', { p_func: l.f.id, p_competencia: m + '-01', p_fechar: true }); await App.gravou(['rh_ponto_meses'], { inteira: ['rh_ponto_meses'] }); aviso('Mês fechado.') } catch (e) { erro(e) }
    }} /></div>}
    <p className="sub mt">Regras: {j.previstas.slice(1, 6).map((h, i) => `${R.NOME_DIA[i + 1]} ${h} h`).join(', ')}; sábado e domingo descanso. Tolerância de {j.tolerancia.marcacao} min por marcação (até {j.tolerancia.dia} min no dia, CLT art. 58).
      {j.branco === 'normal' ? ' Dia sem lançamento conta como trabalhado normal (lance só o que foi diferente: extra, falta, atraso, atestado).' : ' Dia útil sem lançamento vira falta ao fechar o mês.'} {pode() && <a href="#/rh/ajustes?aba=jornada">Mudar regras</a>}</p>
  </>
}

async function exportarFechamento(m: string, linhas: { f: Funcionario; r: R.ResumoMes }[]) {
  const fech = linhas.map(({ f, r }) => ({
    ID: f.matricula || '', Nome: f.nome, Cargo: f.funcao || '', Registro: f.registro || '', Salário: salarioHE(f) || null,
    'HE 50% (h)': U.r2(r.faixas.p50), 'HE 60% (h)': U.r2(r.faixas.p60), 'HE 80% (h)': U.r2(r.faixas.p80), 'HE 100% (h)': U.r2(r.faixas.p100),
    'Faltas (dias)': r.faltas, DSR: r.dsr, 'Atrasos (h)': U.r2(r.atraso), 'Abonadas (h)': U.r2(r.abonado),
    'Valor 50%': U.r2(r.valores.p50), 'Valor 60%': U.r2(r.valores.p60), 'Valor 80%': U.r2(r.valores.p80), 'Valor 100%': U.r2(r.valores.p100), 'Valor total HE': U.r2(r.valores.total),
  }))
  // lançamentos dia a dia, como a aba "Lançamentos" da planilha
  const hoje = U.hoje()
  const dias = linhas.flatMap(({ f, r }) => r.dias.filter(d => S.lista('rh_ponto').some(p => p.funcionario_id === f.id && p.data === d.data) || d.tipo === 'ausencia' || d.falta).map(d => {
    const p = S.lista('rh_ponto').find(x => x.funcionario_id === f.id && x.data === d.data)
    return { Data: U.d(d.data), Nome: f.nome, Dia: R.NOME_DIA[R.diaSemana(d.data)], Entrada: hm(p?.e1), 'Início intervalo': hm(p?.s1), 'Término intervalo': hm(p?.e2), Saída: hm(p?.s2),
      'Horas trabalhadas': U.r2(d.trab), Status: d.data <= hoje ? 'Ok' : 'Previsão', 'Horas previstas': d.prev, 'Horas extras': U.r2(d.he), 'Horas 100%': U.r2(d.he100),
      Absenteísmo: U.r2(d.falta ? d.prev : d.atraso), Ocorrência: d.rotulo }
  }))
  await excel(`Fechamento ponto ${m}.xlsx`, [['Fechamento', fech], ['Lançamentos', dias]], true)
}

// mesmo horário para várias pessoas (ex.: sábado de hora extra da produção)
async function lancarVarios(m: string) {
  const lista = ativos()
  const setores = U.unicos(lista.map(f => f.setor || 'Sem setor'))
  await modal({
    titulo: 'Lançar o mesmo horário para várias pessoas', largura: 'larga',
    corpo: <>
      <div className="linha-campos"><Campo nome="data" rotulo="Dia" tipo="date" valor={m === mesAtual() ? U.hoje() : m + '-01'} req /></div>
      <div className="linha-campos l4"><Campo nome="e1" rotulo="Entrada" tipo="time" valor="07:00" /><Campo nome="s1" rotulo="Saída almoço" tipo="time" valor="12:00" />
        <Campo nome="e2" rotulo="Volta almoço" tipo="time" valor="13:00" /><Campo nome="s2" rotulo="Saída" tipo="time" valor="17:00" /></div>
      <p className="sub">Sem almoço? Deixe “Saída almoço” e “Volta almoço” vazios e use só Entrada e Saída… ou ao contrário.</p>
      <EscolherPessoas lista={lista} setores={setores} />
    </>,
    botoes: [{ txt: 'Lançar', acao: async (frm) => {
      const d = lerForm(frm)
      const ids = [...frm.querySelectorAll<HTMLInputElement>('input[name^="p_"]:checked')].map(x => x.name.slice(2))
      if (!ids.length) throw new ErroApp('Marque pelo menos uma pessoa.')
      const dia = { data: d.data, e1: d.e1 || null, s1: d.s1 || null, e2: d.e2 || null, s2: d.s2 || null }
      if (!dia.e1 && !dia.e2) throw new ErroApp('Preencha os horários.')
      if (!dia.e2 && dia.s1 === null && d.s2) { dia.s1 = d.s2; dia.s2 = null }
      const erros: string[] = []
      for (const id of ids) {
        try { await API.rpc('rh_salvar_ponto', { p: { funcionario_id: id, dias: [dia] } }) } catch (e) { erros.push(`${S.get('funcionarios', id)?.nome}: ${(e as Error).message}`) }
      }
      await App.gravou(['rh_ponto'])
      if (erros.length) { aviso(`${ids.length - erros.length} lançado(s). ${erros.length} com problema.`, 'erro'); throw new ErroApp(erros.join('\n')) }
      aviso(`Lançado para ${U.plural(ids.length, 'pessoa')}.`)
    } }],
  })
}
function EscolherPessoas({ lista, setores }: { lista: Funcionario[]; setores: string[] }) {
  const [s, setS] = useState('')
  const vis = s ? lista.filter(f => (f.setor || 'Sem setor') === s) : lista
  const marcar = (v: boolean) => document.querySelectorAll<HTMLInputElement>('.escolher-pessoas input[type=checkbox]').forEach(c => { if (!c.closest('[hidden]')) c.checked = v })
  return <div className="campo"><label>Quem</label>
    <div className="barra-filtros"><select aria-label="Setor" value={s} onChange={(e) => setS(e.target.value)}><option value="">Todos os setores</option>{setores.map(x => <option key={x}>{x}</option>)}</select>
      <button type="button" className="btn fantasma mini" onClick={() => marcar(true)}>Marcar todos</button><button type="button" className="btn fantasma mini" onClick={() => marcar(false)}>Desmarcar</button></div>
    <div className="escolher-pessoas">{lista.map(f => <label key={f.id} className="check" hidden={!vis.includes(f)}><input type="checkbox" name={'p_' + f.id} /> <span>{f.nome}<small className="fraco"> · {f.setor || 'sem setor'}</small></span></label>)}</div></div>
}

// ------------------------------------------------------------------ cartão de ponto de uma pessoa no mês
type Linha = { e1: string; s1: string; e2: string; s2: string; justificativa: string; obs: string }
const vazia: Linha = { e1: '', s1: '', e2: '', s2: '', justificativa: '', obs: '' }
function PontoPessoa({ f, m, setM }: { f: Funcionario; m: string; setM: (m: string) => void }) {
  const [versao, setVersao] = useState(0)
  return <Cartao key={f.id + m + versao} f={f} m={m} setM={setM} recarregar={() => setVersao(v => v + 1)} />
}
function Cartao({ f, m, setM, recarregar }: { f: Funcionario; m: string; setM: (m: string) => void; recarregar: () => void }) {
  const j = jornada()
  const fechado = mesFechado(f.id, m)
  const editar = pode() && !fechado
  const salvos = useMemo(() => new Map(S.lista('rh_ponto').filter(p => p.funcionario_id === f.id && p.data.startsWith(m)).map(p => [p.data, p])), [f.id, m])
  const inicial = (): Record<string, Linha> => {
    const o: Record<string, Linha> = {}
    for (const [d, p] of salvos) o[d] = { e1: hm(p.e1), s1: hm(p.s1), e2: hm(p.e2), s2: hm(p.s2), justificativa: p.justificativa || '', obs: p.obs || '' }
    return o
  }
  const [lin, setLin] = useState<Record<string, Linha>>(inicial)
  const [sujos, setSujos] = useState<Set<string>>(new Set())
  const [ocup, setOcup] = useState(false)
  useEffect(() => {
    if (!sujos.size) return
    const av = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', av)
    return () => window.removeEventListener('beforeunload', av)
  }, [sujos])
  const fer = feriadosMap()
  const pontos: RhPonto[] = Object.entries(lin).map(([data, l]) => ({ id: data, funcionario_id: f.id, data, e1: l.e1 || null, s1: l.s1 || null, e2: l.e2 || null, s2: l.s2 || null, justificativa: (l.justificativa || null) as Justificativa | null, obs: l.obs || null, atualizado_em: '' }))
  const res = resumoDe(f, m, pontos, fer)
  const mudar = (d: string, campo: keyof Linha, v: string) => { setLin(o => ({ ...o, [d]: { ...(o[d] || vazia), [campo]: v } })); setSujos(s => new Set(s).add(d)) }
  const hoje = U.hoje()
  const pessoas = pessoasDoMes(m)
  const idx = pessoas.findIndex(x => x.id === f.id)
  const trocar = async (h: string) => { if (sujos.size && !(await confirmar('Sair sem salvar o ponto?', { detalhe: 'O que você mudou neste mês será perdido.', ok: 'Sair sem salvar', perigo: true }))) return; ir(h) }

  const preencher = () => {
    let n = 0
    const novo = { ...lin }, sj = new Set(sujos)
    for (const d of res.dias) {
      if (d.data > hoje || d.travado || d.tipo === 'feriado' || d.prev <= 0 || d.tipo === 'ausencia') continue
      const l = novo[d.data]
      if (l && (l.e1 || l.e2 || l.justificativa)) continue
      const p = j.padrao[R.diaSemana(d.data)]; if (!p) continue
      novo[d.data] = { ...(l || vazia), ...p }; sj.add(d.data); n++
    }
    setLin(novo); setSujos(sj)
    aviso(n ? `${U.plural(n, 'dia preenchido', 'dias preenchidos')} com o horário padrão. Confira e toque em Salvar.` : 'Nada para preencher: os dias úteis até hoje já têm lançamento.')
  }
  const salvar = async () => {
    setOcup(true)
    try {
      const dias = [...sujos].sort().map(d => ({ data: d, ...lin[d], justificativa: lin[d]?.justificativa || null }))
      await API.rpc('rh_salvar_ponto', { p: { funcionario_id: f.id, dias } })
      await S.recarregarDe('rh_ponto', 'funcionario_id', f.id)
      aviso('Ponto salvo.'); setSujos(new Set()); recarregar()
    } catch (e) { erro(e) } finally { setOcup(false) }
  }
  const fecharReabrir = async () => {
    if (!fechado && sujos.size) { aviso('Salve antes de fechar o mês.', 'erro'); return }
    const msg = fechado ? `Reabrir ${nomeMesAno(m)}?` : `Fechar ${nomeMesAno(m)} de ${f.nome.split(' ')[0]}?`
    const det = fechado ? 'O ponto do mês volta a aceitar mudanças.' : (j.branco === 'falta' && res.semLancamento ? `${U.plural(res.semLancamento, 'dia útil', 'dias úteis')} sem lançamento vão contar como falta. ` : '') + 'Depois de fechado, só muda reabrindo.'
    if (!(await confirmar(msg, { detalhe: det, ok: fechado ? 'Reabrir' : 'Fechar o mês' }))) return
    try { await API.rpc('rh_fechar_mes', { p_func: f.id, p_competencia: m + '-01', p_fechar: !fechado }); await App.gravou(['rh_ponto_meses'], { inteira: ['rh_ponto_meses'] }); recarregar() } catch (e) { erro(e) }
  }
  return <>
    <a className="voltar" href="#/rh/ponto" onClick={(e) => { e.preventDefault(); void trocar('#/rh/ponto') }}><Ic n="voltar" /> Todos do mês</a>
    <header className="cab"><div><h1>{f.nome}</h1><p className="sub">{[f.funcao, f.registro, f.horario].filter(Boolean).join(' · ')}</p></div>
      <div className="acoes">
        <button type="button" className="icone-btn" aria-label="Pessoa anterior" disabled={idx <= 0} onClick={() => void trocar(`#/rh/ponto?f=${pessoas[idx - 1]?.id}&m=${m}`)}><Ic n="voltar" /></button>
        <select aria-label="Trocar pessoa" value={f.id} onChange={(e) => void trocar(`#/rh/ponto?f=${e.target.value}&m=${m}`)} className="sel-pessoa">{pessoas.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select>
        <button type="button" className="icone-btn" aria-label="Próxima pessoa" disabled={idx < 0 || idx >= pessoas.length - 1} onClick={() => void trocar(`#/rh/ponto?f=${pessoas[idx + 1]?.id}&m=${m}`)}><Ic n="seta" /></button>
      </div></header>
    <SeletorMes m={m} setM={async (x) => { if (sujos.size && !(await confirmar('Trocar de mês sem salvar?', { ok: 'Trocar sem salvar', perigo: true }))) return; setM(x) }} />
    <div className="grade g4 mt totais-ponto">
      <div className="kpi"><small>Trabalhadas</small><b>{R.horas(res.trab)}</b><span>previsto {R.horas(res.prev)}</span></div>
      <div className="kpi"><small>Horas extras</small><b>{R.horas(res.he + res.he100)}</b><span>{[res.faixas.p50 && `${R.horas(res.faixas.p50)} a 50%`, res.faixas.p60 && `${R.horas(res.faixas.p60)} a 60%`, res.faixas.p80 && `${R.horas(res.faixas.p80)} a 80%`, res.faixas.p100 && `${R.horas(res.faixas.p100)} a 100%`].filter(Boolean).join(' · ') || 'nenhuma'}</span></div>
      <div className={`kpi${res.faltas ? ' alerta' : ''}`}><small>Faltas e atrasos</small><b>{res.faltas} {res.faltas === 1 ? 'falta' : 'faltas'}</b><span>{res.atraso ? R.horas(res.atraso) + ' de atraso' : 'sem atraso'}{res.dsr ? ` · perde ${U.plural(res.dsr, 'DSR')}` : ''}</span></div>
      {sensivel() ? <div className="kpi"><small>Valor das extras</small><b>{U.moeda(res.valores.total)}</b><span>hora {U.moeda(res.valorHora)}{f.registro === 'Upgrade' && j.upgrade60 ? ' · Upgrade 60%' : ''}</span></div>
        : <div className="kpi"><small>Abonadas</small><b>{R.horas(res.abonado)}</b><span>atestado, folga…</span></div>}
    </div>
    {fechado && <p className="nota verde mt"><Ic n="cadeado" /> Mês fechado. {pode() ? 'Para mudar, toque em Reabrir o mês.' : ''}</p>}
    {editar && <div className="grupo-btn mt barra-ponto">
      <Btn txt="Preencher horário padrão" icone="relogio" data-ponto="padrao" onClick={preencher} />
      <button type="button" className={`btn pri${ocup ? ' carregando' : ''}`} data-ponto="salvar" disabled={!sujos.size || ocup} onClick={() => void salvar()}><Ic n="ok" /><span>{sujos.size ? `Salvar (${U.plural(sujos.size, 'dia')})` : 'Salvo'}</span></button>
    </div>}
    <div className="ponto mt" id="gradePonto" role="table" aria-label={'Ponto de ' + nomeMesAno(m)}>
      <div className="ponto-cab" role="row"><span>Dia</span><span>Entrada</span><span>Saída almoço</span><span>Volta</span><span>Saída</span><span>Ocorrência</span><span className="num">Horas</span><span className="num">Extra</span></div>
      {res.dias.map(d => {
        const l = lin[d.data] || vazia, dw = R.diaSemana(d.data)
        const bloqueado = !editar || d.travado
        const cls = ['ponto-dia', d.tipo, d.falta ? 'falta' : '', d.data === hoje ? 'hoje' : '', d.data > hoje ? 'futuro' : '', sujos.has(d.data) ? 'sujo' : ''].filter(Boolean).join(' ')
        return <div key={d.data} className={cls} role="row" data-dia={d.data}>
          <span className="pd-dia"><b>{d.data.slice(8)}</b> {R.NOME_DIA[dw]}{d.rotulo && <small>{d.rotulo}</small>}</span>
          {d.travado ? <span className="pd-trava">{d.rotulo}</span> : <>
            {(['e1', 's1', 'e2', 's2'] as const).map(k => <input key={k} type="time" aria-label={`${({ e1: 'Entrada', s1: 'Saída almoço', e2: 'Volta almoço', s2: 'Saída' })[k]} dia ${d.data.slice(8)}`} value={l[k]} disabled={bloqueado}
              onChange={(e) => mudar(d.data, k, e.target.value)} data-campo={k} />)}
            <select aria-label={'Ocorrência dia ' + d.data.slice(8)} value={l.justificativa} disabled={bloqueado} onChange={(e) => mudar(d.data, 'justificativa', e.target.value)} data-campo="justificativa">
              {JUST.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></>}
          <span className="num pd-h">{d.trab ? R.horas(d.trab) : ''}{d.atraso ? <small className="negativo">−{R.horas(d.atraso)}</small> : null}</span>
          <span className="num pd-x">{d.he ? R.horas(d.he) : ''}{d.he100 ? <b className="cem">{R.horas(d.he100)}</b> : ''}</span>
        </div>
      })}
    </div>
    <p className="sub mt">Domingo e feriado: toda hora conta a 100% (em azul). Dias de férias, afastamento e suspensão ficam travados. {fer.size === 0 && pode() ? <>Nenhum feriado cadastrado — <a href="#/rh/ajustes?aba=feriados">cadastrar feriados</a>.</> : null}</p>
    {editar && sujos.size > 0 && <div className="barra-salvar"><span>{U.plural(sujos.size, 'dia alterado', 'dias alterados')}</span>
      <button type="button" className={`btn pri${ocup ? ' carregando' : ''}`} disabled={ocup} onClick={() => void salvar()}><Ic n="ok" /><span>Salvar</span></button></div>}
    {pode() && <div className="grupo-btn mt"><Btn txt={fechado ? 'Reabrir o mês' : 'Fechar o mês'} icone="cadeado" data-ponto="fechar" onClick={fecharReabrir} /></div>}
  </>
}

// ------------------------------------------------------------------ na ficha: últimos meses
export function PontoDaPessoa({ f }: { f: Funcionario }) {
  const meses = Array.from({ length: 6 }, (_, i) => outroMes(mesAtual(), -i))
  const fer = feriadosMap()
  return <section className="card"><div className="card-cab"><h2>Últimos meses</h2><a className="btn sec mini" href={`#/rh/ponto?f=${f.id}&m=${mesAtual()}`}><Ic n="relogio" /><span>Abrir o ponto</span></a></div>
    <div className="tabela-caixa"><table className="tabela cartoes"><thead><tr><th>Mês</th><th className="num">Trabalhadas</th><th className="num">Extras</th><th className="num">Faltas</th><th className="num">Atrasos</th>{sensivel() && <th className="num">Valor HE</th>}</tr></thead>
      <tbody>{meses.map(m => { const r = resumoDe(f, m, undefined, fer)
        return <tr key={m} className="clicavel" onClick={() => ir(`#/rh/ponto?f=${f.id}&m=${m}`)}><td className="titulo" data-r="Mês">{U.cap(nomeMesAno(m))}{mesFechado(f.id, m) ? ' ✓' : ''}</td>
          <td className="num" data-r="Trabalhadas">{R.horas(r.trab)}</td><td className="num" data-r="Extras">{r.he + r.he100 ? R.horas(r.he + r.he100) : ''}</td><td className="num" data-r="Faltas">{r.faltas || ''}</td>
          <td className="num" data-r="Atrasos">{r.atraso ? R.horas(r.atraso) : ''}</td>{sensivel() && <td className="num" data-r="Valor HE">{r.valores.total ? U.moeda(r.valores.total) : ''}</td>}</tr> })}</tbody></table></div></section>
}
