/* RH — Ajustes: cargos (CBO e a quem responde), setores (gestor), feriados e as regras do ponto (jornada, tolerância, faixas de hora extra) */
import { useEffect, useState } from 'react'
import { App } from '../../app/controle.tsx'
import { API, ErroApp } from '../../lib/api.ts'
import { S } from '../../lib/dados.ts'
import * as R from '../../lib/rh.ts'
import type { RhCargo, RhSetor } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { aviso, erro } from '../../ui/avisos.ts'
import { BuscaLista, Btn, Cab, Campo, Vazio } from '../../ui/base.tsx'
import { useLembrar, type Rota } from '../../ui/ganchos.ts'
import { Ic } from '../../ui/icones.tsx'
import { confirmar, lerForm, modal } from '../../ui/janelas.tsx'
import { jornada, nomeF, opcoesPessoas, opcoesSetores, salarioCargo, sensivel } from './comum.tsx'

// tipos de cargo (os da planilha "Cargo e salário" + os já usados)
const TIPOS_CARGO = ['Administrativo', 'Gestor Direto', 'Logística', 'Montagem', 'Pintura', 'Produção', 'Qualidade', 'Solda', 'Usinagem', 'Comercial', 'Diretoria']
const pessoasDoCargo = (id: string) => S.lista('funcionarios').filter(f => f.ativo && f.situacao !== 'desligado' && f.cargo_id === id)
const salarioDe = (fid: string) => Number(S.get('funcionarios_privado', fid)?.salario) || 0

export function TelaAjustesRH({ r }: { r: Rota }) {
  const [aba, setAba] = useLembrar('aj.aba', 'cargos')
  useEffect(() => { const q = r.q.get('aba'); if (q) setAba(q) }, [r.hash, r.q, setAba])
  return <>
    <Cab titulo="Ajustes do RH" sub="Cadastros de apoio e as regras usadas nas contas." />
    <nav className="abas-tela">{([['cargos', 'Cargos'], ['setores', 'Setores'], ['feriados', 'Feriados'], ['jornada', 'Regras do ponto']] as const).map(([k, t]) =>
      <button key={k} type="button" data-aba={k} className={aba === k ? 'on' : ''} onClick={() => setAba(k)}>{t}</button>)}</nav>
    {aba === 'cargos' ? <Cargos /> : aba === 'setores' ? <Setores /> : aba === 'feriados' ? <Feriados /> : <Jornada />}
  </>
}

// ------------------------------------------------------------------ cargos
function Cargos() {
  const [busca, setBusca] = useState('')
  let l = U.ordenar(S.lista('rh_cargos'), c => (c.ativo ? '0' : '1') + U.sem(c.nome))
  if (busca.trim()) l = U.buscar(l, busca, c => [c.nome, c.tipo || '', c.setor || '', c.cbo || ''])
  const sens = sensivel()
  return <>
    <div className="barra-filtros"><BuscaLista id="bCargo" valor={busca} placeholder="Buscar cargo" aoMudar={setBusca} />
      <Btn txt="Novo cargo" icone="mais" cls="pri" data-aj="cargo" onClick={() => void formCargo()} /></div>
    {sens && <p className="sub mt">O salário do cargo é o valor de referência. Ao mudar, dá para atualizar de uma vez o salário de todas as pessoas do cargo.</p>}
    <div className="lista mt">{l.length ? l.map(c => { const ps = pessoasDoCargo(c.id), sal = salarioCargo(c.id)
      const dif = sens && sal ? ps.filter(f => salarioDe(f.id) !== sal).length : 0
      return <div key={c.id} className="linha clicavel" data-cargo={c.id} onClick={() => void formCargo(c)}><div className="meio"><b>{c.nome}{!c.ativo && <> <span className="tag t-cinza">inativo</span></>}</b>
        <small>{[c.tipo, c.cbo && 'CBO ' + c.cbo, c.setor, c.superior_id && 'responde a ' + (S.get('rh_cargos', c.superior_id)?.nome || '')].filter(Boolean).join(' · ') || '—'}</small>
        {dif > 0 && <small className="amarelo-txt">{U.plural(dif, 'pessoa')} com salário diferente do cargo</small>}</div>
        <div className="lado">{sens && <b>{sal ? U.moeda(sal) : '—'}</b>}<small>{U.plural(ps.length, 'pessoa')}</small></div></div> })
      : <Vazio icone="equipe" titulo="Nenhum cargo" texto="Cadastre os cargos com CBO e a quem cada um responde: isso monta o organograma." />}</div>
  </>
}
// salário do cargo + "atualizar todas as pessoas" (a vigência só aparece se marcar)
function SalarioDoCargo({ c }: { c?: RhCargo }) {
  const ps = c ? pessoasDoCargo(c.id) : []
  const atual = c ? salarioCargo(c.id) : 0
  const [sal, setSal] = useState(atual ? U.campoNum(atual) : '')
  const [aplicar, setAplicar] = useState(false)
  const novo = U.num(sal) || 0
  const mudam = ps.filter(f => novo > 0 && salarioDe(f.id) !== novo)
  return <>
    <Campo nome="salario_cargo" rotulo="Salário do cargo" tipo="dinheiro" valor={sal} attrs={{ onChange: (e: { target: HTMLInputElement }) => setSal(e.target.value) }} />
    {c && ps.length > 0 && novo > 0 && <label className="check"><input type="checkbox" name="aplicar" checked={aplicar} onChange={(e) => setAplicar(e.target.checked)} />
      <span>Atualizar o salário das pessoas deste cargo para {U.moeda(novo)} <small className="fraco">({mudam.length ? `${U.plural(mudam.length, 'pessoa muda', 'pessoas mudam')} de ${U.plural(ps.length, 'pessoa')}` : 'todas já ganham esse valor'})</small></span></label>}
    {aplicar && mudam.length > 0 && <>
      <Campo nome="vigencia" rotulo="Vale a partir de" tipo="date" valor={U.hoje()} req ajuda="Entra na linha do tempo de cada pessoa (motivo: Reajuste do cargo). As horas extras passam a usar o novo salário." />
      <ul className="lista-simples">{mudam.slice(0, 12).map(f => <li key={f.id}>{f.nome}: {U.moeda(salarioDe(f.id))} → {U.moeda(novo)}</li>)}{mudam.length > 12 && <li>… e mais {mudam.length - 12}</li>}</ul>
    </>}
  </>
}
async function formCargo(c?: RhCargo) {
  await modal({
    titulo: c ? 'Cargo' : 'Novo cargo',
    corpo: <>
      <div className="linha-campos"><Campo nome="nome" rotulo="Nome do cargo" valor={c?.nome} req /><Campo nome="cbo" rotulo="CBO" valor={c?.cbo} placeholder="Ex.: 7212-15" /></div>
      <div className="linha-campos"><Campo nome="tipo" rotulo="Tipo do cargo" valor={c?.tipo} attrs={{ list: 'lTiposCargo' }} placeholder="Ex.: Produção" />
        <datalist id="lTiposCargo">{U.unicos([...TIPOS_CARGO, ...S.lista('rh_cargos').map(x => x.tipo).filter((x): x is string => !!x)]).map(x => <option key={x} value={x} />)}</datalist>
        {sensivel() ? <SalarioDoCargo c={c} /> : <span />}</div>
      <div className="linha-campos"><Campo nome="setor" rotulo="Setor" tipo="select" valor={c?.setor} opcoes={opcoesSetores()} />
        <Campo nome="superior_id" rotulo="Responde ao cargo" tipo="select" valor={c?.superior_id} opcoes={[{ v: '', t: '— (topo)' }, ...U.ordenar(S.lista('rh_cargos').filter(x => x.ativo && x.id !== c?.id), x => U.sem(x.nome)).map(x => ({ v: x.id, t: x.nome }))]} /></div>
      <Campo nome="descricao" rotulo="Descrição das atividades (opcional)" tipo="area" linhas={3} valor={c?.descricao} />
      {c && <Campo nome="ativo" rotulo="Cargo em uso" tipo="check" valor={c.ativo} />}
    </>,
    botoes: [{ txt: 'Salvar', acao: async (frm) => {
      const d = lerForm(frm)
      const id = await API.rpc<string>('rh_salvar_cargo', { p: { nome: d.nome, cbo: d.cbo, tipo: d.tipo, setor: d.setor, descricao: d.descricao, id: c?.id, superior_id: d.superior_id || null, ativo: c ? d.ativo : true } })
      let n = 0
      if (sensivel()) {
        const sal = U.num(d.salario_cargo) || null, antes = c ? salarioCargo(c.id) || null : null
        if (sal !== antes || d.aplicar) n = await API.rpc<number>('rh_salario_cargo', { p: { cargo_id: id, salario: sal, aplicar: !!d.aplicar, vigencia: d.vigencia || null } })
      }
      await App.gravou(['rh_cargos', 'rh_cargos_salarios', 'funcionarios', ...(n ? ['funcionarios_privado', 'rh_historico'] as const : [])], { inteira: ['rh_cargos_salarios', ...(n ? ['rh_historico'] as const : [])] })
      aviso(n ? `Cargo salvo. Salário atualizado para ${U.plural(n, 'pessoa')}.` : 'Cargo salvo.')
    } }],
  })
}

// ------------------------------------------------------------------ setores
function Setores() {
  const cad = S.lista('rh_setores')
  const usados = U.unicos(S.lista('funcionarios').filter(f => f.ativo).map(f => f.setor).filter((x): x is string => !!x))
  const soltos = usados.filter(s => !cad.some(c => c.nome === s))
  return <>
    <div className="grupo-btn"><Btn txt="Novo setor" icone="mais" cls="pri" data-aj="setor" onClick={() => void formSetor()} /></div>
    <div className="lista mt">{U.ordenar(cad, s => U.sem(s.nome)).map(s => { const n = S.lista('funcionarios').filter(f => f.ativo && f.setor === s.nome).length
      return <div key={s.id} className="linha clicavel" onClick={() => void formSetor(s)}><div className="meio"><b>{s.nome}{!s.ativo && <> <span className="tag t-cinza">inativo</span></>}</b><small>{s.gestor_id ? 'Gestor: ' + nomeF(s.gestor_id) : 'sem gestor'}</small></div>
        <div className="lado"><b>{n}</b><small>{n === 1 ? 'pessoa' : 'pessoas'}</small></div></div> })}
      {!cad.length && !soltos.length && <Vazio icone="equipe" titulo="Nenhum setor" />}</div>
    {soltos.length > 0 && <section className="card mt"><h2>Setores usados nos cadastros, mas sem gestor definido</h2><div className="grupo-btn mt">{soltos.map(s =>
      <button key={s} type="button" className="btn sec mini" onClick={() => void formSetor(undefined, s)}><Ic n="mais" /><span>{s}</span></button>)}</div></section>}
  </>
}
async function formSetor(s?: RhSetor, nome?: string) {
  await modal({
    titulo: s ? 'Setor' : 'Novo setor',
    corpo: <>
      <Campo nome="nome" rotulo="Nome do setor" valor={s?.nome || nome} req ajuda={s ? 'Mudar o nome leva junto as pessoas e cargos do setor.' : ''} />
      <Campo nome="gestor_id" rotulo="Gestor" tipo="select" valor={s?.gestor_id} opcoes={opcoesPessoas('—')} />
      {s && <Campo nome="ativo" rotulo="Setor em uso" tipo="check" valor={s.ativo} />}
    </>,
    botoes: [{ txt: 'Salvar', acao: async (frm) => {
      const d = lerForm(frm)
      await API.rpc('rh_salvar_setor', { p: { ...d, id: s?.id, gestor_id: d.gestor_id || null, ativo: s ? d.ativo : true } })
      await App.gravou(['rh_setores', 'funcionarios', 'rh_cargos']); aviso('Setor salvo.')
    } }],
  })
}

// ------------------------------------------------------------------ feriados
function pascoa(ano: number): string {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}
export function feriadosDoAno(ano: number): [string, string][] {
  const p = pascoa(ano), y = String(ano)
  return ([[`${y}-01-01`, 'Confraternização Universal'], [`${y}-01-25`, 'Aniversário de São Paulo'], [U.somaDias(p, -48), 'Carnaval (segunda)'], [U.somaDias(p, -47), 'Carnaval (terça)'],
    [U.somaDias(p, -2), 'Sexta-feira Santa'], [`${y}-04-21`, 'Tiradentes'], [`${y}-05-01`, 'Dia do Trabalho'], [U.somaDias(p, 60), 'Corpus Christi'],
    [`${y}-07-09`, 'Revolução Constitucionalista'], [`${y}-09-07`, 'Independência do Brasil'], [`${y}-10-12`, 'Nossa Senhora Aparecida'], [`${y}-11-02`, 'Finados'],
    [`${y}-11-15`, 'Proclamação da República'], [`${y}-11-20`, 'Dia da Consciência Negra'], [`${y}-12-25`, 'Natal']] as [string, string][]).sort((a, b) => a[0] < b[0] ? -1 : 1)
}
function Feriados() {
  const [ano, setAno] = useLembrar('aj.ano', U.hoje().slice(0, 4))
  const l = U.ordenar(S.lista('rh_feriados').filter(f => f.data.startsWith(ano)), f => f.data)
  const anos = U.unicos([String(Number(U.hoje().slice(0, 4)) - 1), U.hoje().slice(0, 4), String(Number(U.hoje().slice(0, 4)) + 1), ...S.lista('rh_feriados').map(f => f.data.slice(0, 4))]).sort()
  const faltam = feriadosDoAno(Number(ano)).filter(([d]) => !l.some(f => f.data === d))
  return <>
    <div className="barra-filtros"><select aria-label="Ano" value={ano} onChange={(e) => setAno(e.target.value)}>{anos.map(a => <option key={a}>{a}</option>)}</select>
      <Btn txt="Novo feriado" icone="mais" data-aj="feriado" onClick={() => void formFeriado(ano)} />
      {faltam.length > 0 && <Btn txt={`Cadastrar feriados de ${ano}`} icone="calendario" cls="pri" data-aj="feriadosAno" onClick={() => void sugerirFeriados(Number(ano), faltam)} />}</div>
    <div className="lista mt">{l.length ? l.map(f => <div key={f.id} className="linha"><span className="sinal ent"><Ic n="calendario" /></span>
      <div className="meio"><b>{f.nome}</b><small>{U.data(f.data)} · {['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][R.diaSemana(f.data)]}</small></div>
      <button type="button" className="icone-btn" aria-label={'Apagar ' + f.nome} onClick={async () => {
        if (!(await confirmar(`Apagar o feriado ${f.nome} (${U.data(f.data)})?`, { ok: 'Apagar', perigo: true }))) return
        try { await API.rpc('rh_salvar_feriado', { p_data: f.data, p_nome: f.nome, p_excluir: true }); await App.gravou(['rh_feriados'], { inteira: ['rh_feriados'] }) } catch (e) { erro(e) }
      }}><Ic n="lixo" /></button></div>) : <Vazio icone="calendario" titulo={`Nenhum feriado em ${ano}`} texto="Feriado conta hora extra a 100% e não é dia previsto de trabalho." />}</div>
    <p className="sub mt">Pontes e feriados municipais de outras cidades: use “Novo feriado”.</p>
  </>
}
async function formFeriado(ano: string) {
  await modal({
    titulo: 'Novo feriado',
    corpo: <div className="linha-campos"><Campo nome="data" rotulo="Data" tipo="date" req valor={ano === U.hoje().slice(0, 4) ? U.hoje() : ano + '-01-01'} /><Campo nome="nome" rotulo="Nome" req placeholder="Ex.: Ponte de feriado" /></div>,
    botoes: [{ txt: 'Salvar', acao: async (frm) => { const d = lerForm(frm); await API.rpc('rh_salvar_feriado', { p_data: d.data, p_nome: d.nome, p_excluir: false }); await App.gravou(['rh_feriados'], { inteira: ['rh_feriados'] }) } }],
  })
}
async function sugerirFeriados(ano: number, l: [string, string][]) {
  await modal({
    titulo: `Feriados de ${ano}`,
    corpo: <><p className="sub">Nacionais, do estado e da cidade de São Paulo. Desmarque o que a empresa não folga.</p>
      {l.map(([d, n]) => <label key={d} className="check"><input type="checkbox" name={'f_' + d} defaultChecked={!n.startsWith('Carnaval')} /> <span>{U.data(d)} — {n}</span></label>)}</>,
    botoes: [{ txt: 'Cadastrar', acao: async (frm) => {
      const marc = l.filter(([d]) => (frm.elements.namedItem('f_' + d) as HTMLInputElement)?.checked)
      for (const [d, n] of marc) await API.rpc('rh_salvar_feriado', { p_data: d, p_nome: n, p_excluir: false })
      await App.gravou(['rh_feriados'], { inteira: ['rh_feriados'] }); aviso(`${U.plural(marc.length, 'feriado cadastrado', 'feriados cadastrados')}.`)
    } }],
  })
}

// ------------------------------------------------------------------ regras do ponto
function Jornada() {
  const j = jornada()
  const [ocup, setOcup] = useState(false)
  const salvar = async (frm: HTMLFormElement) => {
    const d = lerForm(frm)
    const previstas = [0, 1, 2, 3, 4, 5, 6].map(i => Number(U.num(d['p' + i])) || 0)
    if (previstas.some(h => h < 0 || h > 12)) throw new ErroApp('Horas previstas por dia: de 0 a 12.')
    const padrao = [0, 1, 2, 3, 4, 5, 6].map(i => d['e1_' + i] && d['s2_' + i] ? { e1: d['e1_' + i], s1: d['s1_' + i] || '', e2: d['e2_' + i] || '', s2: d['s2_' + i] } : null)
    const nova: R.Jornada = { previstas, padrao, tolerancia: { ligada: !!d.tol, marcacao: Number(d.tolm) || 0, dia: Number(d.told) || 0 }, divisor: Number(U.num(d.divisor)) || 220,
      faixas: [Number(U.num(d.f1)) || 0, Number(U.num(d.f2)) || 0, Number(U.num(d.f3)) || 0], upgrade60: !!d.upgrade60, branco: d.branco === 'falta' ? 'falta' : 'normal' }
    await API.rpc('salvar_config', { p_chave: 'rh', p_valor: { ...S.cfg<Record<string, unknown>>('rh', {}), jornada: nova } })
    await App.gravou(['config']); aviso('Regras salvas.')
  }
  return <form className="card" id="fJornada" onSubmit={async (e) => { e.preventDefault(); setOcup(true); try { await salvar(e.currentTarget) } catch (x) { erro(x) } finally { setOcup(false) } }}>
    <h2>Jornada (CLT, 44 horas por semana)</h2>
    <div className="tabela-caixa mt"><table className="tabela jornada"><thead><tr><th>Dia</th><th>Horas previstas</th><th>Entrada</th><th>Saída almoço</th><th>Volta</th><th>Saída</th></tr></thead>
      <tbody>{[1, 2, 3, 4, 5, 6, 0].map(i => { const p = j.padrao[i]
        return <tr key={i}><td><b>{['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][i]}</b></td>
          <td><input name={'p' + i} inputMode="decimal" defaultValue={U.campoNum(j.previstas[i], 2)} aria-label="Horas previstas" className="mini-campo" /></td>
          {(['e1', 's1', 'e2', 's2'] as const).map(k => <td key={k}><input type="time" name={`${k}_${i}`} defaultValue={p?.[k] || ''} aria-label={k} /></td>)}</tr> })}</tbody></table></div>
    <p className="sub">Total previsto na semana: {R.horas(U.soma(j.previstas, x => x))}. O horário de cada dia é usado na tolerância e no botão “Preencher horário padrão”.</p>
    <h3 className="mt">Tolerância (CLT art. 58 §1º)</h3>
    <label className="check"><input type="checkbox" name="tol" defaultChecked={j.tolerancia.ligada} /> <span>Ignorar pequenas diferenças de marcação</span></label>
    <div className="linha-campos"><Campo nome="tolm" rotulo="Até quantos minutos por marcação" tipo="num" valor={j.tolerancia.marcacao} /><Campo nome="told" rotulo="Até quantos minutos no dia" tipo="num" valor={j.tolerancia.dia} /></div>
    <h3 className="mt">Horas extras</h3>
    <div className="linha-campos"><Campo nome="f1" rotulo="Primeiras horas a 50%" tipo="num" valor={j.faixas[0]} /><Campo nome="f2" rotulo="Próximas horas a 60%" tipo="num" valor={j.faixas[1]} />
      <Campo nome="f3" rotulo="Próximas horas a 80%" tipo="num" valor={j.faixas[2]} /><Campo nome="divisor" rotulo="Divisor (horas do mês)" tipo="num" valor={j.divisor} /></div>
    <p className="sub">O que passar das faixas vai a 100%. Domingo e feriado: sempre 100%. Valor da hora = salário ÷ divisor.</p>
    <label className="check"><input type="checkbox" name="upgrade60" defaultChecked={j.upgrade60} /> <span>Registro Upgrade: toda hora extra a 60% (como na planilha)</span></label>
    <h3 className="mt">Dia útil sem lançamento</h3>
    <div className="opcoes"><label className="opcao"><input type="radio" name="branco" value="normal" defaultChecked={j.branco === 'normal'} /><span><b>Conta como dia normal</b><small>Lanço só o que foi diferente (extra, falta, atraso, atestado) — como a planilha.</small></span></label>
      <label className="opcao"><input type="radio" name="branco" value="falta" defaultChecked={j.branco === 'falta'} /><span><b>Vira falta ao fechar o mês</b><small>Lanço o cartão de ponto inteiro todo dia.</small></span></label></div>
    <div className="grupo-btn mt"><button type="submit" className={`btn pri${ocup ? ' carregando' : ''}`} disabled={ocup} data-aj="salvarJornada"><Ic n="ok" /><span>Salvar regras</span></button></div>
  </form>
}
