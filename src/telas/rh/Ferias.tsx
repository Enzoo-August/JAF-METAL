/* RH — Férias (períodos aquisitivos e data limite como na "Relação de funcionários"), atestados, afastamentos, licenças, folgas e faltas */
import { useEffect, useState } from 'react'
import { App } from '../../app/controle.tsx'
import { API, ErroApp } from '../../lib/api.ts'
import { C, S } from '../../lib/dados.ts'
import * as R from '../../lib/rh.ts'
import type { Funcionario, RhAusencia, TipoAusencia } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { aviso, erro } from '../../ui/avisos.ts'
import { entregar, pdfDocumento } from '../../ui/arquivos.tsx'
import { Btn, Cab, Campo, Chips, Paginado, Tag, Vazio, type OpcaoChip } from '../../ui/base.tsx'
import { useLembrar, type Rota } from '../../ui/ganchos.ts'
import { Ic } from '../../ui/icones.tsx'
import { confirmar, lerForm, modal } from '../../ui/janelas.tsx'
import { Anexos, ativos, cidadeEmpresa, dataExtenso, jornada, LinhaPessoa, nomeF, opcoesPessoas, periodo, pode, razaoEmpresa, sensivel, TagFerias, TIPO_AUS, corAvatar } from './comum.tsx'
import { feriadosMap } from './Ponto.tsx'

// primeiro dia útil depois de uma data (retorno ao trabalho)
export function proximoDiaUtil(d: string): string {
  const j = jornada(), fer = feriadosMap()
  let x = U.somaDias(d, 1)
  for (let i = 0; i < 10 && (fer.has(x) || !j.previstas[R.diaSemana(x)]); i++) x = U.somaDias(x, 1)
  return x
}

export function TelaFerias({ r }: { r: Rota }) {
  const [aba, setAba] = useLembrar('fer.aba', 'ferias')
  useEffect(() => { const q = r.q.get('aba'); if (q) setAba(q) }, [r.hash, r.q, setAba])
  return <>
    <Cab titulo="Férias e ausências" sub="Quem precisa tirar férias, quem está fora e os atestados.">
      {pode() && <Btn txt="Lançar atestado ou falta" icone="mais" data-fer="ausencia" onClick={() => void formAusencia()} />}
      {pode() && sensivel() && <Btn txt="Programar férias" icone="calendario" cls="pri" data-fer="programar" onClick={() => void programarFerias()} />}
    </Cab>
    <nav className="abas-tela"><button type="button" className={aba === 'ferias' ? 'on' : ''} data-aba="ferias" onClick={() => setAba('ferias')}>Férias</button>
      <button type="button" className={aba === 'ausencias' ? 'on' : ''} data-aba="ausencias" onClick={() => setAba('ausencias')}>Atestados, afastamentos e faltas</button>
      <button type="button" className={aba === 'fora' ? 'on' : ''} data-aba="fora" onClick={() => setAba('fora')}>Quem está fora</button></nav>
    {aba === 'ferias' ? <PainelFerias r={r} /> : aba === 'ausencias' ? <ListaAusencias /> : <QuemFora />}
  </>
}

// ------------------------------------------------------------------ painel de férias
function PainelFerias({ r }: { r: Rota }) {
  const [f, setF] = useLembrar('fer.f', 'atencao')
  useEffect(() => { const q = r.q.get('f'); if (q) setF(q === 'vencido' || q === 'vence30' || q === 'vence60' ? q : 'atencao') }, [r.hash, r.q, setF])
  if (!sensivel()) return <QuemFora soFerias />
  const hoje = U.hoje()
  const at = ativos().map(x => ({ f: x, ps: C.periodosFerias(x) })).map(x => ({ ...x, pior: R.feriasPior(x.ps) }))
  const grupo = (s: R.SitFerias) => at.filter(x => x.pior?.situacao === s)
  const programadas = S.lista('rh_ausencias').filter(a => a.tipo === 'ferias' && a.inicio > hoje)
  const agora = S.lista('rh_ausencias').filter(a => a.tipo === 'ferias' && a.inicio <= hoje && (a.fim || a.inicio) >= hoje)
  const venc = grupo('vencido'), v30 = grupo('vence30'), v60 = grupo('vence60')
  const chips: OpcaoChip[] = [{ v: 'atencao', t: 'Precisam de atenção', n: venc.length + v30.length + v60.length }, { v: 'vencido', t: 'Vencidas', n: venc.length }, { v: 'vence30', t: 'Vencem em 30 dias', n: v30.length },
    { v: 'vence60', t: 'Vencem em 60 dias', n: v60.length }, { v: 'emdia', t: 'Em dia', n: grupo('emdia').length + grupo('formando').length + grupo('gozado').length },
    { v: 'agora', t: 'De férias agora', n: agora.length }, { v: 'programadas', t: 'Programadas', n: programadas.length }]
  if (f === 'agora' || f === 'programadas') {
    const l = U.ordenar(f === 'agora' ? agora : programadas, a => a.inicio)
    return <><Chips atual={f} aoEscolher={setF} opcoes={chips} />
      <div className="lista mt">{l.length ? l.map(a => { const p = S.get('funcionarios', a.funcionario_id); return p ? <LinhaPessoa key={a.id} f={p} href={`#/funcionario/${p.id}?aba=ferias`} sub={periodo(a.inicio, a.fim)}
        direita={<small>volta {U.dataCurta(proximoDiaUtil(a.fim || a.inicio))}</small>} /> : null }) : <Vazio icone="calendario" titulo="Ninguém" />}</div></>
  }
  const l = f === 'atencao' ? [...venc, ...v30, ...v60] : f === 'emdia' ? at.filter(x => !x.pior || ['emdia', 'formando', 'gozado'].includes(x.pior.situacao)) : grupo(f as R.SitFerias)
  const ord = U.ordenar(l, x => x.pior?.limite || '9999')
  return <>
    <Chips atual={f} aoEscolher={setF} opcoes={chips} />
    {f === 'atencao' && !ord.length && <p className="nota verde mt"><Ic n="ok" /> Ninguém com férias vencendo nos próximos 60 dias.</p>}
    <div className="mt" id="lFerias"><Paginado itens={ord} render={({ f: p, pior }) => <LinhaPessoa key={p.id} f={p} href={`#/funcionario/${p.id}?aba=ferias`}
      sub={pior ? `Aquisitivo ${U.dataCurta(pior.inicio)} a ${U.dataCurta(pior.fim)} · ${pior.saldo} dias para tirar` : 'sem data de admissão'}
      direita={pior ? <>{pior.situacao !== 'formando' ? <TagFerias s={pior.situacao} /> : <Tag s={{ cor: 'cinza', txt: 'Adquirindo' }} />}<small>{pior.adquirido ? 'limite ' + U.dataCurta(pior.limite) : 'direito em ' + U.dataCurta(U.somaDias(pior.fim, 1))}</small></> : null} />}
      vazio={<Vazio icone="calendario" titulo="Ninguém aqui" />} /></div>
    <p className="sub mt">Como a planilha: o período aquisitivo é de 12 meses; a <b>data limite</b> é o fim do aquisitivo + 1 ano − 1 mês − 1 dia (dá tempo de os 30 dias caberem antes do prazo da lei). Passou do limite = <b>pagamento em dobro</b>.</p>
  </>
}

function QuemFora({ soFerias = false }: { soFerias?: boolean }) {
  const hoje = U.hoje(), ate = U.somaDias(hoje, 30)
  const l = U.ordenar(S.lista('rh_ausencias').filter(a => (!soFerias || a.tipo === 'ferias') && a.inicio <= ate && (a.fim === null || a.fim >= hoje)), a => a.inicio)
  const agora = l.filter(a => a.inicio <= hoje), logo = l.filter(a => a.inicio > hoje)
  const linha = (a: RhAusencia) => { const p = S.get('funcionarios', a.funcionario_id); return p ? <LinhaPessoa key={a.id} f={p} sub={`${TIPO_AUS[a.tipo]} · ${periodo(a.inicio, a.fim)}`}
    direita={a.fim ? <small>volta {U.dataCurta(proximoDiaUtil(a.fim))}</small> : <Tag s={{ cor: 'amarelo', txt: 'Sem data' }} />} /> : null }
  return <>
    <section className="mt"><h2>Fora hoje <span className="sub">({agora.length})</span></h2><div className="lista mt">{agora.length ? agora.map(linha) : <p className="sub" style={{ padding: 14 }}>Todo mundo trabalhando hoje.</p>}</div></section>
    <section className="mt2"><h2>Nos próximos 30 dias <span className="sub">({logo.length})</span></h2><div className="lista mt">{logo.length ? logo.map(linha) : <p className="sub" style={{ padding: 14 }}>Nada programado.</p>}</div></section>
  </>
}

function ListaAusencias() {
  const [t, setT] = useLembrar('aus.t', '')
  const [m, setM] = useLembrar('aus.m', '')
  let l = S.lista('rh_ausencias').filter(a => a.tipo !== 'ferias')
  const n = (x: string) => l.filter(a => a.tipo === x).length
  const chips: OpcaoChip[] = [{ v: '', t: 'Todos', n: l.length }, ...(['atestado', 'afastamento', 'licenca', 'falta', 'folga', 'declaracao', 'suspensao'] as TipoAusencia[]).filter(x => n(x)).map(x => ({ v: x, t: TIPO_AUS[x], n: n(x) }))]
  if (t) l = l.filter(a => a.tipo === t)
  if (m) l = l.filter(a => a.inicio.slice(0, 7) <= m && (a.fim || '9999').slice(0, 7) >= m)
  l = U.ordenar(l, a => a.inicio, true)
  return <>
    <div className="barra-filtros"><Chips atual={t} aoEscolher={setT} nome="at" opcoes={chips} />
      <input type="month" aria-label="Mês" value={m} onChange={(e) => setM(e.target.value)} className="campo-mes" />{m && <button type="button" className="btn fantasma mini" onClick={() => setM('')}>Todos os meses</button>}</div>
    <div className="mt"><Paginado itens={l} render={a => { const p = S.get('funcionarios', a.funcionario_id); return p ? <div key={a.id} className="linha clicavel" data-aus={a.id} onClick={() => pode() && void formAusencia(p, a)}>
      <span className={corAvatar(p.nome)}>{p.nome.charAt(0)}</span><div className="meio"><b>{p.nome}</b><small>{TIPO_AUS[a.tipo]}{a.motivo ? ' · ' + a.motivo : ''}{sensivel() && a.cid ? ' · CID ' + a.cid : ''} · {periodo(a.inicio, a.fim)}</small></div>
      <div className="lado">{a.abona ? <Tag s={{ cor: 'verde', txt: 'Abonado' }} /> : <Tag s={{ cor: 'vermelho', txt: 'Desconta' }} />}</div></div> : null }}
      vazio={<Vazio icone="calendario" titulo="Nada lançado" texto="Atestados, afastamentos pelo INSS, licenças, folgas e faltas aparecem aqui." />} /></div>
  </>
}

// ------------------------------------------------------------------ na ficha
export function FeriasDaPessoa({ f }: { f: Funcionario }) {
  const sens = sensivel()
  const ps = sens ? C.periodosFerias(f) : []
  const aus = U.ordenar(S.lista('rh_ausencias').filter(a => a.funcionario_id === f.id), a => a.inicio, true)
  return <>
    {pode() && f.ativo && <div className="grupo-btn">{sens && <Btn txt="Programar férias" icone="calendario" cls="pri" data-fer="programar" onClick={() => void programarFerias(f)} />}
      <Btn txt="Lançar atestado ou falta" icone="mais" data-fer="ausencia" onClick={() => void formAusencia(f)} /></div>}
    {sens && <section className="card mt"><h2>Períodos de férias</h2>
      {ps.length ? <div className="tabela-caixa mt"><table className="tabela cartoes"><thead><tr><th>Período aquisitivo</th><th>Data limite</th><th className="num">Tirados</th><th className="num">Saldo</th><th>Situação</th></tr></thead>
        <tbody>{[...ps].reverse().map(p => <tr key={p.inicio}><td className="titulo" data-r="Aquisitivo">{U.data(p.inicio)} a {U.data(p.fim)}</td><td data-r="Data limite">{p.adquirido ? U.data(p.limite) : '—'}</td>
          <td className="num" data-r="Tirados">{p.gozados} dias</td><td className="num" data-r="Saldo">{p.saldo} dias</td><td data-r="Situação"><TagFerias s={p.situacao} /></td></tr>)}</tbody></table></div>
        : <p className="sub">Preencha a data de admissão para o sistema calcular os períodos.</p>}</section>}
    <section className="card mt"><h2>Férias, atestados e ausências</h2>
      {aus.length ? <div className="lista mt">{aus.map(a => <div key={a.id} className={`linha${pode() ? ' clicavel' : ''}`} data-aus={a.id} onClick={() => pode() && void formAusencia(f, a)}>
        <div className="meio"><b>{TIPO_AUS[a.tipo]}{a.motivo ? ' — ' + a.motivo : ''}</b><small>{periodo(a.inicio, a.fim)}{a.tipo === 'ferias' && a.aquisitivo_inicio ? ` · aquisitivo de ${U.dataCurta(a.aquisitivo_inicio)}` : ''}{sens && a.cid ? ' · CID ' + a.cid : ''}</small></div>
        <div className="lado">{a.tipo === 'ferias' && sens && <button type="button" className="btn sec mini" data-aviso={a.id} onClick={(e) => { e.stopPropagation(); void avisoFerias(f, a).catch(erro) }}><Ic n="imprimir" /><span>Aviso</span></button>}
          {a.tipo !== 'ferias' && (a.abona ? <Tag s={{ cor: 'verde', txt: 'Abonado' }} /> : <Tag s={{ cor: 'vermelho', txt: 'Desconta' }} />)}</div></div>)}</div>
        : <p className="sub">Nada lançado.</p>}</section>
  </>
}

// ------------------------------------------------------------------ programar férias
function CamposFerias({ f0 }: { f0: Funcionario | null }) {
  const [fid, setFid] = useState(f0?.id || '')
  const [ini, setIni] = useState('')
  const [dias, setDias] = useState('30')
  const f = S.get('funcionarios', fid)
  const ps = f ? C.periodosFerias(f).filter(p => p.saldo > 0) : []
  const [aq, setAq] = useState('')
  const per = ps.find(p => p.inicio === aq) || ps[0]
  const n = Number(dias) || 0
  const fim = ini && n > 0 ? U.somaDias(ini, n - 1) : ''
  const partes = f && per ? S.lista('rh_ausencias').filter(a => a.funcionario_id === f.id && a.tipo === 'ferias' && a.aquisitivo_inicio === per.inicio).length : 0
  return <>
    {!f0 && <Campo nome="funcionario_id" rotulo="Quem" tipo="select" req valor={fid} opcoes={opcoesPessoas()} attrs={{ onChange: (e: { target: HTMLSelectElement }) => { setFid(e.target.value); setAq('') } }} />}
    {f0 && <input type="hidden" name="funcionario_id" value={f0.id} />}
    {f && (ps.length ? <div className="campo"><label htmlFor="fAq">Período aquisitivo</label>
      <select id="fAq" name="aquisitivo_inicio" value={per?.inicio || ''} onChange={(e) => setAq(e.target.value)}>{ps.map(p => <option key={p.inicio} value={p.inicio}>
        {U.data(p.inicio)} a {U.data(p.fim)} — saldo {p.saldo} dias{p.adquirido ? ` — limite ${U.data(p.limite)}` : ' (ainda adquirindo)'}</option>)}</select>
      {per && <small>{per.situacao === 'vencido' ? '⚠ Já venceu: a lei manda pagar em dobro.' : per.adquirido ? `Tire até ${U.data(per.limite)}.` : 'Período ainda não completou 12 meses (férias antecipadas).'}</small>}</div>
      : <p className="nota">Sem saldo de férias em aberto para esta pessoa.</p>)}
    <div className="linha-campos"><Campo nome="inicio" rotulo="Primeiro dia de férias" tipo="date" req valor={ini} attrs={{ onChange: (e: { target: HTMLInputElement }) => setIni(e.target.value) }} />
      <Campo nome="dias" rotulo="Quantos dias" tipo="select" valor={dias} opcoes={[30, 20, 15, 14, 10, 5].filter(x => !per || x <= per.saldo).map(x => ({ v: String(x), t: `${x} dias` })).concat(per && ![30, 20, 15, 14, 10, 5].includes(per.saldo) ? [{ v: String(per.saldo), t: `${per.saldo} dias (o que falta)` }] : [])}
        attrs={{ onChange: (e: { target: HTMLSelectElement }) => setDias(e.target.value) }} /></div>
    {fim && <p className="nota verde">De <b>{U.data(ini)}</b> a <b>{U.data(fim)}</b> · volta ao trabalho em <b>{U.data(proximoDiaUtil(fim))}</b>{ini < U.somaDias(U.hoje(), 30) ? <><br />⚠ A lei pede avisar a pessoa 30 dias antes (art. 135 da CLT).</> : null}</p>}
    <p className="sub">Regras da CLT (o sistema confere): até 3 partes no mesmo período; uma com 14 dias ou mais e nenhuma com menos de 5.{partes ? ` Esta pessoa já tem ${U.plural(partes, 'parte')} nesse período.` : ''}</p>
    <Campo nome="obs" rotulo="Observação (opcional)" placeholder="Ex.: vendeu 10 dias (abono)" />
  </>
}
export async function programarFerias(f?: Funcionario | null): Promise<void> {
  const r = await modal<{ id: string; fid: string }>({
    titulo: f ? 'Programar férias — ' + f.nome : 'Programar férias',
    corpo: <CamposFerias f0={f || null} />,
    botoes: [{ txt: 'Programar', acao: async (frm) => {
      const d = lerForm(frm)
      if (!d.aquisitivo_inicio) throw new ErroApp('Escolha o período aquisitivo.')
      const fim = U.somaDias(d.inicio, Number(d.dias) - 1)
      const id = await API.rpc<string>('rh_salvar_ausencia', { p: { funcionario_id: d.funcionario_id, tipo: 'ferias', inicio: d.inicio, fim, aquisitivo_inicio: d.aquisitivo_inicio, obs: d.obs } })
      await App.gravou(['rh_ausencias'])
      return { id, fid: d.funcionario_id }
    } }],
  })
  if (!r) return
  const a = S.get('rh_ausencias', r.id), p = S.get('funcionarios', r.fid)
  aviso('Férias programadas.', 'ok', a && p ? { acao: { txt: 'Aviso em PDF', fn: () => avisoFerias(p, a).catch(erro) }, tempo: 9000 } : {})
}

// aviso de férias (CLT art. 135: avisar por escrito com 30 dias de antecedência)
export async function avisoFerias(f: Funcionario, a: RhAusencia): Promise<void> {
  const fim = a.fim || a.inicio, dias = U.dias(a.inicio, fim) + 1
  const aq = a.aquisitivo_inicio
  const fimAq = aq ? U.somaDias(U.somaMeses(aq, 12), -1) : null
  const blob = await pdfDocumento('Aviso de férias', '', (c) => {
    let y = c.y + 4
    y = c.texto(`${cidadeEmpresa()}, ${dataExtenso(U.hoje())}.`, y, { alinhar: 'right' }) + 4
    y = c.texto(`Ao(À) Sr.(a) ${f.nome}`, y, { negrito: true, tam: 11 })
    y = c.texto([f.funcao && 'Função: ' + f.funcao, f.setor && 'Setor: ' + f.setor, f.matricula && 'Matrícula: ' + f.matricula].filter(Boolean).join('   ·   '), y, { tam: 9.5, cor: 80 }) + 5
    y = c.texto(`Nos termos do artigo 135 da Consolidação das Leis do Trabalho (CLT), comunicamos que suas férias${aq && fimAq ? `, relativas ao período aquisitivo de ${U.data(aq)} a ${U.data(fimAq)},` : ''} serão concedidas conforme abaixo:`, y, { tam: 10.5 }) + 3
    c.tabela({ ...c.estilo, startY: y, head: [['Início das férias', 'Término', 'Dias', 'Retorno ao trabalho']], body: [[U.data(a.inicio), U.data(fim), String(dias), U.data(proximoDiaUtil(fim))]],
      styles: { ...c.estilo.styles, fontSize: 11, halign: 'center', cellPadding: 3 } })
    y = c.doc.lastAutoTable.finalY + 8
    if (a.obs) y = c.texto('Observação: ' + a.obs, y, { tam: 10 }) + 2
    y = c.texto('Solicitamos que, no retorno, apresente-se no horário habitual de trabalho. O pagamento das férias (com o adicional de 1/3) será feito até 2 dias antes do início do período (art. 145 da CLT).', y, { tam: 10 }) + 22
    c.assinatura(razaoEmpresa(), 'Empregador', 14, y, 80)
    c.assinatura(f.nome, 'Ciente em ____/____/________', c.W - 94, y, 80)
  })
  await entregar(blob, `Aviso de ferias ${f.nome} ${a.inicio}.pdf`)
}

// ------------------------------------------------------------------ atestado, afastamento, licença, folga, falta
const TIPOS_FORM: [TipoAusencia, string, string][] = [
  ['atestado', 'Atestado médico', 'Dias abonados com atestado'], ['afastamento', 'Afastamento (INSS)', 'Mais de 15 dias, auxílio-doença, acidente'],
  ['licenca', 'Licença', 'Maternidade, paternidade, casamento, luto…'], ['falta', 'Falta', 'Sem justificativa (desconta)'],
  ['folga', 'Folga', 'Folga combinada / banco de horas'], ['declaracao', 'Declaração de horas', 'Consulta, exame (parte do dia)'],
]
const LICENCAS: [string, number][] = [['Maternidade', 120], ['Paternidade', 5], ['Casamento (gala)', 3], ['Falecimento de familiar (nojo)', 2], ['Doação de sangue', 1], ['Alistamento eleitoral', 2], ['Outra', 0]]
function CamposAusencia({ f0, a }: { f0: Funcionario | null; a: Partial<RhAusencia> }) {
  const [tipo, setTipo] = useState<TipoAusencia>(a.tipo && a.tipo !== 'ferias' && a.tipo !== 'suspensao' ? a.tipo : 'atestado')
  const [ini, setIni] = useState(a.inicio || U.hoje())
  const [semFim, setSemFim] = useState(!!a.id && a.fim === null)
  const [fim, setFim] = useState(a.fim || a.inicio || U.hoje())
  const [lic, setLic] = useState(a.motivo || '')
  const dias = !semFim && fim >= ini ? U.dias(ini, fim) + 1 : 0
  const podeSemFim = tipo === 'afastamento' || tipo === 'licenca' || tipo === 'atestado'
  return <>
    {!f0 && <Campo nome="funcionario_id" rotulo="Quem" tipo="select" req valor={a.funcionario_id} opcoes={opcoesPessoas()} />}
    {f0 && <input type="hidden" name="funcionario_id" value={f0.id} />}
    <div className="campo"><label>O que é</label><div className="opcoes">{TIPOS_FORM.map(([v, t, d]) => <label key={v} className="opcao"><input type="radio" name="tipo" value={v} checked={tipo === v} onChange={() => setTipo(v)} /><span><b>{t}</b><small>{d}</small></span></label>)}</div></div>
    {tipo === 'licenca' && <Campo nome="motivo" rotulo="Qual licença" tipo="select" valor={lic} opcoes={[{ v: '', t: 'Escolha' }, ...LICENCAS.map(([t, n]) => ({ v: t, t: n ? `${t} (${U.plural(n, 'dia')})` : t }))]}
      attrs={{ onChange: (e: { target: HTMLSelectElement }) => { setLic(e.target.value); const n = LICENCAS.find(x => x[0] === e.target.value)?.[1]; if (n) setFim(U.somaDias(ini, n - 1)) } }} />}
    <div className="linha-campos"><div className="campo"><label htmlFor="ausIni">{tipo === 'falta' ? 'Dia da falta' : 'Início'} <i className="req">*</i></label>
        <input id="ausIni" type="date" name="inicio" required value={ini} onChange={(e) => { setIni(e.target.value); if (fim < e.target.value) setFim(e.target.value) }} /></div>
      {!semFim && <div className="campo"><label htmlFor="ausFim">Último dia <i className="req">*</i></label>
        <input id="ausFim" type="date" name="fim" required value={fim} min={ini} onChange={(e) => setFim(e.target.value)} />{dias ? <small>{U.plural(dias, 'dia')}</small> : null}</div>}</div>
    {podeSemFim && <label className="check"><input type="checkbox" checked={semFim} onChange={(e) => setSemFim(e.target.checked)} /> <span>Ainda não tem data para voltar</span></label>}
    {(tipo === 'atestado' || tipo === 'afastamento') && sensivel() && <div className="linha-campos"><Campo nome="cid" rotulo="CID (opcional)" valor={a.cid} placeholder="Ex.: J11" ajuda="Dado de saúde: só RH, Escritório e Dono veem." />
      {tipo === 'atestado' && <Campo nome="motivo" rotulo="Médico / observação" valor={a.motivo} />}</div>}
    {tipo !== 'licenca' && tipo !== 'atestado' && tipo !== 'afastamento' && <Campo nome="motivo" rotulo="Motivo (opcional)" valor={a.motivo} />}
    <label className="check"><input type="checkbox" name="abona" defaultChecked={a.id ? a.abona : tipo !== 'falta'} key={'ab' + tipo} /> <span>Dia pago (abonado) — desmarque se for descontar</span></label>
    <Campo nome="obs" rotulo="Observação" valor={a.obs} />
    {a.id && <Anexos tabela="rh_ausencias" registro={a.id} titulo="Atestado / documento" />}
    {tipo === 'afastamento' && <p className="sub">Os 15 primeiros dias são pagos pela empresa; depois disso é o INSS. Enquanto durar, a pessoa aparece como “Afastado” e o ponto fica travado.</p>}
  </>
}
export async function formAusencia(f?: Funcionario | null, a?: RhAusencia): Promise<void> {
  if (a?.tipo === 'ferias') { if (f) return editarFerias(f, a); return }
  if (a?.tipo === 'suspensao') { aviso('Suspensão se muda em Advertências (ela trava os dias sozinha).'); return }
  const b: Partial<RhAusencia> = a || {}
  await modal({
    titulo: a ? `${TIPO_AUS[a.tipo]} — ${nomeF(a.funcionario_id)}` : f ? 'Lançar — ' + f.nome : 'Lançar atestado, afastamento ou falta',
    corpo: <CamposAusencia f0={f || null} a={b} />,
    botoes: [...(a ? [{ txt: 'Apagar', cls: 'perigo-txt', validar: false, acao: async () => {
      if (!(await confirmar('Apagar este lançamento?', { ok: 'Apagar', perigo: true }))) return false
      await API.rpc('rh_excluir_ausencia', { p_id: a.id }); await App.gravou(['rh_ausencias'], { inteira: ['rh_ausencias'] }); aviso('Apagado.')
    } }] : []), { txt: a ? 'Salvar' : 'Lançar', acao: async (frm: HTMLFormElement) => {
      const d = lerForm(frm)
      await API.rpc('rh_salvar_ausencia', { p: { id: a?.id, funcionario_id: d.funcionario_id, tipo: d.tipo, inicio: d.inicio, fim: d.fim || null, motivo: d.motivo, cid: d.cid, abona: d.abona, obs: d.obs } })
      await App.gravou(['rh_ausencias', 'funcionarios'], { inteira: ['rh_ausencias'] }); aviso('Lançado.')
    } }],
  })
}
async function editarFerias(f: Funcionario, a: RhAusencia) {
  await modal({
    titulo: 'Férias — ' + f.nome,
    corpo: <><p>{periodo(a.inicio, a.fim)}{a.aquisitivo_inicio ? ` · aquisitivo de ${U.data(a.aquisitivo_inicio)}` : ''}</p>
      <div className="linha-campos"><Campo nome="inicio" rotulo="Primeiro dia" tipo="date" req valor={a.inicio} /><Campo nome="fim" rotulo="Último dia" tipo="date" req valor={a.fim} /></div>
      <Campo nome="obs" rotulo="Observação" valor={a.obs} />
      <div className="grupo-btn"><button type="button" className="btn sec" onClick={() => void avisoFerias(f, a).catch(erro)}><Ic n="imprimir" /><span>Aviso de férias (PDF)</span></button></div></>,
    botoes: [{ txt: 'Apagar', cls: 'perigo-txt', validar: false, acao: async () => {
      if (!(await confirmar('Apagar estas férias?', { detalhe: 'Os dias voltam para o saldo do período.', ok: 'Apagar', perigo: true }))) return false
      await API.rpc('rh_excluir_ausencia', { p_id: a.id }); await App.gravou(['rh_ausencias'], { inteira: ['rh_ausencias'] }); aviso('Férias apagadas.')
    } }, { txt: 'Salvar', acao: async (frm) => {
      const d = lerForm(frm)
      await API.rpc('rh_salvar_ausencia', { p: { id: a.id, funcionario_id: f.id, tipo: 'ferias', inicio: d.inicio, fim: d.fim, aquisitivo_inicio: a.aquisitivo_inicio, obs: d.obs } })
      await App.gravou(['rh_ausencias']); aviso('Férias salvas.')
    } }],
  })
}
