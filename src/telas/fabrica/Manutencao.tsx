/* Manutenção (planilhas "Manutenção" e "Manut. Preventiva"):
 *  - Ordens de serviço (aba "OS"): corretiva, preventiva, preditiva e melhoria, com nº, solicitante, responsável, peças e aprovação;
 *  - Preventiva (abas de check-list por máquina + "Plano Anual"): preencher o check-list, ver o plano do ano e o histórico;
 *  - Indicadores (aba "Indicadores"): OS por tipo, horas paradas, tempo médio de reparo e gastos do ano. */
import { App } from '../../app/controle.tsx'
import { API } from '../../lib/api.ts'
import { C, S } from '../../lib/dados.ts'
import { Perm } from '../../lib/perm.ts'
import type { Manutencao, Maquina, Preventiva } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { entregar, excel, pdfDocumento } from '../../ui/arquivos.tsx'
import { aviso } from '../../ui/avisos.ts'
import { BuscaLista, Btn, Cab, Campo, Chips, Paginado, Tag, Vazio } from '../../ui/base.tsx'
import { useLembrar, type Rota } from '../../ui/ganchos.ts'
import { confirmar, lerForm, modal } from '../../ui/janelas.tsx'
import { formManutencao, TIPO_MANUT } from '../Maquinas.tsx'
import { ComTabelas } from './comum.tsx'

const ST: Record<string, [string, 'vermelho' | 'amarelo' | 'verde']> = { aberta: ['Aberta', 'vermelho'], andamento: ['Em andamento', 'amarelo'], concluida: ['Concluída', 'verde'] }
const GRUPOS = ['Máquina', 'Dispositivo', 'Ferramenta', 'Predial', 'Outro']

// ================================================================ ordens de serviço
function LinhaOS({ m }: { m: Manutencao }) {
  const mq = S.get('maquinas', m.maquina_id), [st, cor] = ST[m.status] || [m.status, 'cinza']
  return <div className="linha clicavel" data-os={m.numero || m.id} onClick={() => void formManutencao(S.get('manutencoes', m.id) || m)}><div className="meio">
    <b>{m.numero ? 'OS ' + m.numero + ' · ' : ''}{C.nomeMaquina(mq) || m.equipamento || '—'}</b>
    <small>{[m.problema.slice(0, 90), U.dataCurta(m.data), TIPO_MANUT[m.tipo], m.responsavel || m.solicitante].filter(Boolean).join(' · ')}</small></div>
    <div className="lado"><Tag s={{ txt: st, cor }} />{m.horas_parada ? <small>{U.qtd(m.horas_parada)} h parada</small> : null}</div></div>
}

export function TelaOS(_: { r: Rota }) {
  const [f, setF] = useLembrar('os.f', 'aberta')
  const [t, setT] = useLembrar('os.t', '')
  const [busca, setBusca] = useLembrar('os.busca', '')
  const todas = S.lista('manutencoes')
  let l = t ? todas.filter(m => m.tipo === t) : todas
  if (f === 'aberta') l = l.filter(m => m.status !== 'concluida')
  else if (f !== 'todas') l = l.filter(m => m.status === f)
  l = busca.trim() ? U.buscar(l, busca, m => { const q = S.get('maquinas', m.maquina_id); return [String(m.numero || ''), q?.codigo || '', q?.nome || '', m.problema, m.solucao || '', m.responsavel || '', m.solicitante || ''] })
    : U.ordenar(l, m => m.data + String(m.numero || 0).padStart(6, '0'), true)
  return <>
    <Cab titulo="Ordens de serviço" sub="Chamados e serviços de manutenção (aba OS da planilha)">
      <Btn txt="Abrir OS" icone="chave" cls="pri" data-os-acao="nova" onClick={() => void formManutencao({ tipo: 'corretiva' })} />
      <Btn txt="Excel" icone="planilha" cls="fantasma" onClick={() => excel('Ordens de servico.xlsx', [['OS', l.map(m => { const q = S.get('maquinas', m.maquina_id)
        return { 'Nº OS': m.numero || '', Data: U.data(m.data), Equipamento: C.nomeMaquina(q), Tipo: TIPO_MANUT[m.tipo], Solicitante: m.solicitante || '', 'Descrição do problema': m.problema,
          'Serviço executado': m.solucao || '', Responsável: m.responsavel || '', Prazo: m.prazo ? U.data(m.prazo) : '', 'Peças substituídas': m.pecas || '', 'Horas parada': m.horas_parada ?? '',
          'Custo total': Perm.pode('precos') ? m.custo_servico : '', 'Aprovação': m.aprovacao || '', Conclusão: m.concluida_em ? U.data(m.concluida_em) : '', Status: ST[m.status]?.[0] || m.status } })]])} />
    </Cab>
    <div className="barra-filtros"><BuscaLista id="bOS" valor={busca} placeholder="Nº da OS, máquina, problema, responsável" aoMudar={setBusca} /></div>
    <Chips atual={f} aoEscolher={setF} opcoes={[{ v: 'aberta', t: 'Em aberto', n: todas.filter(m => m.status !== 'concluida').length }, { v: 'concluida', t: 'Concluídas' }, { v: 'todas', t: 'Todas' }]} />
    <Chips nome="t" atual={t} aoEscolher={setT} opcoes={[{ v: '', t: 'Todos os tipos' }, ...Object.entries(TIPO_MANUT).map(([v, x]) => ({ v, t: x.replace(' (problema)', '') }))]} />
    <div className="mt" id="lOS"><Paginado itens={l} render={m => <LinhaOS key={m.id} m={m} />} vazio={<Vazio icone="chave" titulo="Nenhuma OS aqui" />} /></div>
  </>
}

// impressão da OS (mesmos campos da aba "OS")
export async function imprimirOS(m: Manutencao): Promise<void> {
  const q = S.get('maquinas', m.maquina_id)
  const blob = await pdfDocumento(`Ordem de Serviço${m.numero ? ' nº ' + m.numero : ''}`, TIPO_MANUT[m.tipo] + ' · ' + (ST[m.status]?.[0] || ''), (c) => {
    c.tabela({ ...c.estilo, startY: c.y + 2, theme: 'grid', columnStyles: { 0: { cellWidth: 45, fontStyle: 'bold', fillColor: [240, 243, 247] } },
      body: [['Equipamento', C.nomeMaquina(q) || m.equipamento || ''], ['Local / setor', [q?.local, q?.setor].filter(Boolean).join(' · ')], ['Data', U.data(m.data)], ['Solicitante', m.solicitante || ''],
        ['Responsável', m.responsavel || ''], ['Prazo', m.prazo ? U.data(m.prazo) : ''], ['Horas parada', m.horas_parada ? U.qtd(m.horas_parada) : ''], ['Conclusão', m.concluida_em ? U.data(m.concluida_em) : '']] })
    let y = c.doc.lastAutoTable.finalY + 6
    for (const [k, v] of [['Descrição do problema', m.problema], ['Serviço executado', m.solucao], ['Peças substituídas / fornecedor / valor', m.pecas], ['Aprovação após manutenção', m.aprovacao]] as [string, string | null][]) {
      y = c.texto(k, y, { tam: 9.5, negrito: true }); y = c.texto(v || '\n\n', y, { tam: 10 }) + 4
    }
    const yy = Math.max(y + 20, 255)
    c.assinatura('Executado por', m.responsavel || '', 14, yy, 80); c.assinatura('Aprovado por (produção)', '', c.W - 94, yy, 80)
  })
  await entregar(blob, `OS ${m.numero || ''}.pdf`)
}

// ================================================================ preventiva
const comPlano = (m: Maquina) => m.ativo && (!!m.preventiva_dias || (m.checklist || []).length > 0)
const ultimaPrev = (maqId: string): Preventiva | null => U.ordenar(S.lista('preventivas').filter(p => p.maquina_id === maqId), p => p.data, true)[0] || null

export function TelaPreventiva(_: { r: Rota }) {
  return <ComTabelas tabs={['preventivas', 'registros']}>{() => <Preventivas />}</ComTabelas>
}

function Preventivas() {
  const [g, setG] = useLembrar('prev.g', '')
  const [aba, setAba] = useLembrar('prev.aba', 'plano')
  const [busca, setBusca] = useLembrar('prev.busca', '')
  const ano = Number(U.hoje().slice(0, 4))
  let maqs = S.lista('maquinas').filter(comPlano).filter(m => !g || m.grupo === g)
  maqs = busca.trim() ? U.buscar(maqs, busca, m => [m.codigo || '', m.nome, m.setor || '', m.local || '']) : U.ordenar(maqs, m => (m.codigo || '') + U.sem(m.nome))
  const pend = S.lista('registros').filter(r => r.tipo === 'pendencia' && !/conclu|ok/i.test(r.status || '')).length
  const venc = maqs.filter(m => C.situacaoMaquina(m).cod === 'prevvencida').length
  const hist = U.ordenar(S.lista('preventivas').filter(p => !g || S.get('maquinas', p.maquina_id)?.grupo === g), p => p.data, true)
  const mesHoje = Number(U.hoje().slice(5, 7))
  const celula = (m: Maquina, mes: number) => {
    const pref = `${ano}-${String(mes).padStart(2, '0')}`
    const feito = S.lista('preventivas').some(p => p.maquina_id === m.id && p.data.startsWith(pref))
      || S.lista('manutencoes').some(x => x.maquina_id === m.id && x.tipo === 'preventiva' && x.status === 'concluida' && (x.concluida_em || x.data).startsWith(pref))
    if (feito) return <td key={mes} className="feito">✓</td>
    const prox = C.proximaPreventiva(m)
    if (prox && prox.startsWith(pref)) return <td key={mes} className={mes < mesHoje || prox < U.hoje() ? 'vencido' : 'devido'}>•</td>
    return <td key={mes} />
  }
  return <>
    <Cab titulo="Preventiva" sub="Plano anual, check-list de cada equipamento e pendências">
      <a className="btn sec" href="#/reg/pendencia"><span>Pendências{pend ? ` (${pend})` : ''}</span></a>
    </Cab>
    <div className="barra-filtros"><BuscaLista id="bPrev" valor={busca} placeholder="Código ou nome do equipamento" aoMudar={setBusca} /></div>
    <Chips atual={aba} aoEscolher={setAba} nome="aba" opcoes={[{ v: 'plano', t: `Plano ${ano}`, n: venc || null }, { v: 'lista', t: 'Equipamentos' }, { v: 'hist', t: 'Histórico' }]} />
    <Chips nome="g" atual={g} aoEscolher={setG} opcoes={[{ v: '', t: 'Todos' }, ...GRUPOS.map(x => ({ v: x, t: x === 'Máquina' ? 'Máquinas' : x === 'Predial' ? 'Predial' : x + 's' }))]} />
    {aba === 'plano' && <section className="card mt"><p className="sub">✓ feita · <span className="tag t-amarelo">•</span> prevista · <span className="tag t-vermelho">•</span> vencida. Toque no equipamento para preencher o check-list.</p>
      <div className="rolagem-x" ref={rolarAoMes}><table className="plano-ano" id="tPlano"><thead><tr><th>Equipamento</th>{Array.from({ length: 12 }, (_, i) => <th key={i} className={String(ano) === U.hoje().slice(0, 4) && i + 1 === Number(U.hoje().slice(5, 7)) ? 'mes-atual' : undefined}>{U.nomeMes(i + 1).slice(0, 3)}</th>)}</tr></thead>
        <tbody>{maqs.map(m => <tr key={m.id} className="clicavel" style={{ cursor: 'pointer' }} onClick={() => void preencher(m)}><td>{C.nomeMaquina(m)}</td>{Array.from({ length: 12 }, (_, i) => celula(m, i + 1))}</tr>)}</tbody></table></div>
      {!maqs.length && <p className="sub">Nenhum equipamento com preventiva programada. Em Máquinas, informe "preventiva a cada (dias)" e o check-list.</p>}</section>}
    {aba === 'lista' && <div className="lista mt">{maqs.map(m => { const u = C.ultimaPreventiva(m.id), prox = C.proximaPreventiva(m)
      return <div key={m.id} className="linha clicavel" data-prev-maq={m.codigo || m.nome} onClick={() => void preencher(m)}><div className="meio"><b>{C.nomeMaquina(m)}</b>
        <small>{[m.grupo, m.local || m.setor, `${(m.checklist || []).length} itens no check-list`, m.preventiva_dias ? `a cada ${m.preventiva_dias} dias` : ''].filter(Boolean).join(' · ')}</small></div>
        <div className="lado"><Tag s={C.situacaoMaquina(m)} /><small>{u ? 'última ' + U.dataCurta(u) : 'sem registro'}{prox ? ' · próxima ' + U.dataCurta(prox) : ''}</small></div></div> })}</div>}
    {aba === 'hist' && <div className="mt"><Paginado itens={hist} render={p => { const m = S.get('maquinas', p.maquina_id); const ruins = p.resultados.filter(r => r.situacao && !/^ok$/i.test(r.situacao)).length
      return <div key={p.id} className="linha clicavel" onClick={() => m && void preencher(m, p)}><div className="meio"><b>{C.nomeMaquina(m)} · {U.data(p.data)}</b>
        <small>{[p.responsavel, U.plural(p.resultados.length, 'item', 'itens'), ruins ? `${ruins} com observação` : 'tudo ok', p.os ? 'OS ' + p.os : ''].filter(Boolean).join(' · ')}</small></div></div> }}
      vazio={<Vazio icone="ok" titulo="Nenhum check-list preenchido" />} /></div>}
  </>
}

// no celular o plano abre já no mês atual (a coluna do equipamento fica parada)
function rolarAoMes(el: HTMLDivElement | null): void {
  if (!el || el.dataset.rolou) return
  const th = el.querySelector<HTMLElement>('th.mes-atual'), prim = el.querySelector<HTMLElement>('th')
  if (!th || !prim) return
  el.dataset.rolou = '1'
  el.scrollLeft = Math.max(0, th.offsetLeft - prim.offsetWidth - th.offsetWidth)
}

export async function preencher(m: Maquina, p?: Preventiva): Promise<unknown> {
  // abre de qualquer lugar (Início, barra de baixo): garante as tabelas antes de montar a janela
  await S.garantir(['preventivas'])
  const itens = p ? p.resultados.map(r => r.item) : (m.checklist || [])
  const ult = p ? null : ultimaPrev(m.id)
  const ed = Perm.pode('manut_editar')
  return modal({
    titulo: `Preventiva · ${C.nomeMaquina(m)}`, largura: 'larga',
    corpo: <>
      {ult && <p className="sub">Última: {U.data(ult.data)}{ult.responsavel ? ' por ' + ult.responsavel : ''}.</p>}
      <div className="linha-campos"><Campo nome="data" rotulo="Data" tipo="date" valor={p?.data || U.hoje()} /><Campo nome="responsavel" rotulo="Responsável" valor={p?.responsavel || API.sessao?.nome} />
        <Campo nome="os" rotulo="Nº da OS (se abriu)" valor={p?.os} /></div>
      {itens.length ? <div className="mt">{itens.map((it, i) => <div key={i} className="check-item"><span>{it}</span>
        <input name={'it_' + i} list="sitPrev" defaultValue={p?.resultados[i]?.situacao ?? ''} placeholder="Ok, Corrigir…" aria-label={it} disabled={!ed} /></div>)}
        <datalist id="sitPrev">{['Ok', 'Corrigir', 'Trocar', 'Não se aplica'].map(s => <option key={s} value={s} />)}</datalist></div>
        : <p className="sub">Este equipamento ainda não tem check-list. {Perm.pode('maquinas_editar') ? 'Cadastre os itens em Máquinas → Editar.' : ''}</p>}
      <Campo nome="obs" rotulo="Observações / ocorrências" tipo="area" linhas={2} valor={p?.obs} />
    </>,
    botoes: [
      { txt: 'Imprimir', cls: 'sec', validar: false, acao: async (f: HTMLFormElement) => { await imprimirCheck(m, p, f); return false } },
      ...(p && ed ? [{ txt: 'Excluir', cls: 'fantasma', validar: false, acao: async () => {
        if (!await confirmar('Excluir este check-list?', { ok: 'Excluir', perigo: true })) return false
        await API.rpc('excluir_preventiva', { p_id: p.id }); await App.gravou(['preventivas'], { inteira: ['preventivas'] }); aviso('Excluído.'); return true } }] : []),
      ...(ed ? [{ txt: p ? 'Salvar' : 'Registrar preventiva', acao: async (f: HTMLFormElement) => {
        const d = lerForm(f)
        const resultados = itens.map((item, i) => ({ item, situacao: String(d['it_' + i] || '') }))
        if (!f.dataset.envio) f.dataset.envio = p?.id || U.uuid()
        await API.rpc('salvar_preventiva', { p: { id: f.dataset.envio, maquina_id: m.id, data: d.data, responsavel: d.responsavel, os: d.os, obs: d.obs, resultados } })
        await App.gravou(['preventivas']); aviso('Preventiva registrada.')
        const ruins = resultados.filter(r => r.situacao && !/^(ok|não se aplica)$/i.test(r.situacao))
        if (!p && ruins.length && await confirmar(`${U.plural(ruins.length, 'item', 'itens')} precisa${ruins.length > 1 ? 'm' : ''} de correção. Abrir uma OS?`, { ok: 'Abrir OS', nao: 'Agora não' }))
          void formManutencao({ maquina_id: m.id, tipo: 'corretiva', problema: 'Preventiva de ' + U.data(String(d.data)) + ': ' + ruins.map(r => `${r.item} (${r.situacao})`).join('; ') })
        return true
      } }] : []),
    ],
  })
}

async function imprimirCheck(m: Maquina, p: Preventiva | undefined, f: HTMLFormElement) {
  const d = lerForm(f)
  const itens = p ? p.resultados.map(r => r.item) : (m.checklist || [])
  const blob = await pdfDocumento('Check-list de manutenção preventiva', C.nomeMaquina(m), (c) => {
    c.tabela({ ...c.estilo, startY: c.y + 2, theme: 'grid', body: [['Equipamento', C.nomeMaquina(m)], ['Local', [m.local, m.setor].filter(Boolean).join(' · ')], ['Data', d.data ? U.data(String(d.data)) : ''],
      ['Responsável', String(d.responsavel || '')], ['OS', String(d.os || '')]], columnStyles: { 0: { cellWidth: 40, fontStyle: 'bold', fillColor: [240, 243, 247] } } })
    c.tabela({ ...c.estilo, startY: c.doc.lastAutoTable.finalY + 5, head: [['#', 'Item verificado', 'Situação']], styles: { ...c.estilo.styles, minCellHeight: 7 },
      body: itens.map((it, i) => [i + 1, it, String(d['it_' + i] || '')]), columnStyles: { 0: { cellWidth: 8 }, 2: { cellWidth: 40 } } })
    let y = c.doc.lastAutoTable.finalY + 6
    y = c.texto('Observações: ' + (d.obs || ''), y, { tam: 10 })
    c.assinatura('Responsável', String(d.responsavel || ''), 14, Math.max(y + 20, 262), 80)
  })
  await entregar(blob, `Preventiva ${m.codigo || m.nome}.pdf`)
}

// ================================================================ indicadores
export function TelaManutInd(_: { r: Rota }) {
  return <ComTabelas tabs={['registros', 'preventivas']}>{() => <Indicadores />}</ComTabelas>
}
function Indicadores() {
  const [ano, setAno] = useLembrar('mind.ano', U.hoje().slice(0, 4))
  const os = S.lista('manutencoes').filter(m => m.data.startsWith(ano))
  const regs = S.lista('registros').filter(r => (r.data || '').startsWith(ano))
  const precos = Perm.pode('precos')
  const anos = U.unicos([U.hoje().slice(0, 4), ...S.lista('manutencoes').map(m => m.data.slice(0, 4))]).sort().reverse()
  const meses = Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`)
  const corr = os.filter(m => m.tipo === 'corretiva')
  const horas = U.soma(corr, 'horas_parada')
  const linha = (pref: string) => {
    const o = os.filter(m => m.data.startsWith(pref)), r = regs.filter(x => (x.data || '').startsWith(pref))
    return { corr: o.filter(m => m.tipo === 'corretiva').length, prev: o.filter(m => m.tipo === 'preventiva').length + S.lista('preventivas').filter(p => p.data.startsWith(pref)).length,
      pred: o.filter(m => m.tipo === 'preditiva' || m.tipo === 'melhoria').length, horas: U.soma(o, 'horas_parada'),
      serv: U.soma(o, 'custo_servico') + U.soma(r.filter(x => x.tipo === 'servico_manut'), 'valor'), gastos: U.soma(r.filter(x => x.tipo === 'gasto_manut' || x.tipo === 'ferramentaria'), 'valor') }
  }
  const tot = linha(ano)
  const porMaq = U.ordenar([...U.agrupar(corr, m => m.maquina_id)].map(([id, l]) => ({ m: S.get('maquinas', id), n: l.length, h: U.soma(l, 'horas_parada') })), x => -(x.h * 1000 + x.n)).slice(0, 10)
  return <>
    <Cab titulo="Indicadores da manutenção" sub="OS, horas paradas e gastos do ano (aba Indicadores)">
      <select value={ano} onChange={(e) => setAno(e.target.value)} aria-label="Ano">{anos.map(a => <option key={a}>{a}</option>)}</select>
    </Cab>
    <div className="grade g4">
      <div className="kpi"><small>OS corretivas</small><b>{corr.length}</b><span>{tot.prev} preventivas · {tot.pred} preditivas/melhorias</span></div>
      <div className="kpi"><small>Horas paradas</small><b>{U.qtd(horas)} h</b><span>tempo médio de reparo {corr.length ? U.qtd(U.r2(horas / corr.length)) : 0} h</span></div>
      {precos && <div className="kpi"><small>Serviços</small><b>{U.moeda0(tot.serv)}</b><span>OS + prestadores</span></div>}
      {precos && <div className="kpi"><small>Gastos (compras)</small><b>{U.moeda0(tot.gastos)}</b><span>fluxo de caixa + ferramentaria</span></div>}
    </div>
    <section className="card mt"><div className="card-cab"><h2>Mês a mês</h2></div><div className="rolagem-x"><table className="tabela-fab" id="tMInd"><thead><tr><th>Mês</th><th className="n">Corretivas</th><th className="n">Preventivas</th>
      <th className="n so-largo">Preditivas</th><th className="n">Horas paradas</th>{precos && <><th className="n">Serviços</th><th className="n">Gastos</th></>}</tr></thead>
      <tbody>{meses.map(p => { const x = linha(p); return <tr key={p}><td>{U.cap(U.nomeMes(Number(p.slice(5))))}</td><td className="n">{x.corr}</td><td className="n">{x.prev}</td><td className="n so-largo">{x.pred}</td>
        <td className="n">{U.qtd(x.horas)}</td>{precos && <><td className="n">{U.moeda0(x.serv)}</td><td className="n">{U.moeda0(x.gastos)}</td></>}</tr> })}</tbody></table></div></section>
    {porMaq.length > 0 && <section className="card mt"><div className="card-cab"><h2>Equipamentos que mais pararam</h2></div><div className="lista">{porMaq.map((x, i) =>
      <a key={i} className="linha" href={x.m ? '#/maquina/' + x.m.id : '#/os'}><div className="meio"><b>{C.nomeMaquina(x.m) || '—'}</b><small>{U.plural(x.n, 'corretiva')}</small></div><div className="lado"><b>{U.qtd(x.h)} h</b></div></a>)}</div></section>}
  </>
}
