/* Ordens de Fabricação (planilha PCP: "Ordem de Fabricação" = FORM.034 e "OF Conjunto" = FORM.042).
 * Mesma numeração da planilha: componente AA0001 (ex.: 260123), conjunto AA00001 (ex.: 2600045). */
import { useState } from 'react'
import { App } from '../../app/controle.tsx'
import { API } from '../../lib/api.ts'
import { C, S } from '../../lib/dados.ts'
import { Perm } from '../../lib/perm.ts'
import type { OF, Produto } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { entregar, excel, pdfDocumento } from '../../ui/arquivos.tsx'
import { aviso } from '../../ui/avisos.ts'
import { BuscaLista, Btn, Cab, Campo, Chips, Dl, Paginado, Tag, Texto, Vazio, Voltar } from '../../ui/base.tsx'
import { ComboMaquina } from '../../ui/Combo.tsx'
import { useLembrar, type Rota } from '../../ui/ganchos.ts'
import { confirmar, lerForm, modal } from '../../ui/janelas.tsx'
import { ComboProduto, ComTabelas, nr } from './comum.tsx'

const TABS = ['produtos', 'produto_estrutura', 'mp_lotes', 'ofs', 'vendas'] as const

export const ofPorNumero = (n: number | string | null | undefined): OF | null => {
  const k = Number(String(n ?? '').replace(/\D/g, '')); if (!k) return null
  return S.lista('ofs').find(o => o.numero === k) || null
}

export function LinhaOF({ o }: { o: OF }) {
  const p = S.get('produtos', o.produto_id), st = C.situacaoOF(o)
  return <a className="linha" href={'#/of/' + o.id} data-of={o.numero}><div className="meio"><b>OF {nr(o.numero)} · {p?.codigo || '?'}</b>
    <small>{[p?.descricao, U.qtd(o.qtd) + ' pç', o.ri ? 'R.I. ' + o.ri : '', o.tipo === 'conjunto' ? 'conjunto' : '', 'emitida ' + U.dataCurta(o.emitida_em)].filter(Boolean).join(' · ')}</small></div>
    <div className="lado"><Tag s={st} />{o.produzido !== null && o.produzido !== undefined ? <small>{U.qtd(o.produzido)} produzidas</small> : null}</div></a>
}

export function TelaOFs({ r }: { r: Rota }) {
  return <ComTabelas tabs={[...TABS]}>{() => r.nome === 'of' && r.id ? <Ficha id={r.id} /> : <Lista />}</ComTabelas>
}
export const tituloOFs = (r: Rota) => { if (r.nome === 'of' && r.id) { const o = S.get('ofs', r.id); return o ? 'OF ' + o.numero : 'OF' } return 'Ordens de fabricação' }

function Lista() {
  const [f, setF] = useLembrar('of.f', 'aberta')
  const [t, setT] = useLembrar('of.t', '')
  const [busca, setBusca] = useLembrar('of.busca', '')
  const todas = S.lista('ofs')
  const sit = (o: OF) => C.situacaoOF(o)
  const n = { aberta: 0, atrasada: 0 }
  for (const o of todas) if (o.status === 'aberta') { n.aberta++; if (sit(o).atrasada) n.atrasada++ }
  let l = todas.filter(o => (!t || o.tipo === t))
  if (f === 'aberta') l = l.filter(o => o.status === 'aberta')
  else if (f === 'atrasada') l = l.filter(o => sit(o).atrasada)
  else if (f !== 'todas') l = l.filter(o => o.status === f)
  l = busca.trim()
    ? U.buscar(l, busca, o => { const p = S.get('produtos', o.produto_id); return [String(o.numero), p?.codigo || '', p?.descricao || '', o.ri ? String(o.ri) : '', o.emitido_por || '', o.realizado_por || ''] })
    : U.ordenar(l, o => o.numero, true)
  return <>
    <Cab titulo="Ordens de fabricação" sub="As OFs da planilha do PCP: emitir, apontar o que foi feito e encerrar">
      {Perm.pode('of_emitir') && <Btn txt="Nova OF" icone="mais" cls="pri" data-of-acao="nova" onClick={() => void formOF()} />}
      <Btn txt="Excel" icone="planilha" cls="fantasma" onClick={() => exportar(l)} />
    </Cab>
    <div className="barra-filtros"><BuscaLista id="bOF" valor={busca} placeholder="Nº da OF, código, R.I., quem emitiu" aoMudar={setBusca} /></div>
    <Chips atual={f} aoEscolher={setF} opcoes={[{ v: 'aberta', t: 'Em aberto', n: n.aberta }, { v: 'atrasada', t: 'Atrasadas', n: n.atrasada || null }, { v: 'encerrada', t: 'Encerradas' }, { v: 'cancelada', t: 'Canceladas' }, { v: 'todas', t: 'Todas' }]} />
    <Chips nome="t" atual={t} aoEscolher={setT} opcoes={[{ v: '', t: 'Componentes e conjuntos' }, { v: 'componente', t: 'Componentes (FORM.034)' }, { v: 'conjunto', t: 'Conjuntos (FORM.042)' }]} />
    <div className="mt" id="lOF"><Paginado itens={l} render={o => <LinhaOF key={o.id} o={o} />}
      vazio={<Vazio icone="producao" titulo="Nenhuma OF aqui" texto={Perm.pode('of_emitir') ? 'Toque em Nova OF para emitir uma ordem de fabricação.' : ''} />} /></div>
  </>
}

function exportar(l: OF[]) {
  return excel('Ordens de fabricacao.xlsx', [['OFs', l.map(o => { const p = S.get('produtos', o.produto_id)
    return { 'Nº OF': o.numero, Tipo: o.tipo === 'conjunto' ? 'Conjunto' : 'Componente', Data: U.data(o.emitida_em), 'Código Produto': p?.codigo || '', Descrição: p?.descricao || '',
      Qde: o.qtd, RI: o.ri ?? '', 'Qde Kg': o.kg ?? '', Emitido: o.emitido_por || '', 'Qde Prod.': o.produzido ?? '', Realizado: o.realizado_por || '',
      'Data realizada': o.realizada_em ? U.data(o.realizada_em) : '', Prazo: o.prazo ? U.data(o.prazo) : '', Status: C.situacaoOF(o).txt, Obs: o.obs || '' } })]])
}

function Ficha({ id }: { id: string }) {
  const o = S.get('ofs', id)
  if (!o) return <Vazio icone="producao" titulo="OF não encontrada"><a className="btn pri" href="#/ofs">Voltar</a></Vazio>
  const p = S.get('produtos', o.produto_id), st = C.situacaoOF(o)
  const lote = C.loteDoRI(o.ri), mp = lote ? S.get('produtos', lote.produto_id) : null
  const pai = S.get('ofs', o.pai_id), filhas = S.lista('ofs').filter(x => x.pai_id === o.id)
  const venda = S.get('vendas', o.venda_id), maq = S.get('maquinas', o.maquina_id)
  const pcp = Perm.pode('of_emitir'), ap = Perm.pode('of_apontar')
  return <>
    <Voltar para="#/ofs" txt="Ordens de fabricação" />
    <header className="cab"><div><h1>OF {nr(o.numero)} <Tag s={st} /></h1><p className="sub">{o.tipo === 'conjunto' ? 'OF de conjunto (FORM.042)' : 'OF de componente (FORM.034)'} · {p ? <a href={'#/produto/' + p.id}>{p.codigo} — {p.descricao}</a> : '?'}</p></div>
      <div className="acoes">
        {o.status === 'aberta' && ap && <Btn txt="Apontar / encerrar" icone="ok" cls="pri" data-of-acao="apontar" onClick={() => void apontar(o)} />}
        <Btn txt="Imprimir" icone="imprimir" data-of-acao="imprimir" onClick={() => imprimirOF(o)} />
        {o.status === 'aberta' && pcp && <Btn txt="Editar" icone="lapis" cls="fantasma" data-of-acao="editar" onClick={() => void formOF(o)} />}
        {o.status === 'aberta' && pcp && <Btn txt="Cancelar OF" icone="x" cls="fantasma" data-of-acao="cancelar" onClick={() => cancelar(o)} />}
        {o.status !== 'aberta' && pcp && <Btn txt="Reabrir" icone="desfazer" cls="fantasma" data-of-acao="reabrir" onClick={() => reabrir(o)} />}
      </div></header>
    <div className="grade g4">
      <div className="kpi"><small>Quantidade</small><b>{U.qtd(o.qtd)}</b><span>{p?.operacao || 'peças'}</span></div>
      <div className="kpi"><small>Produzido</small><b>{o.produzido === null ? '—' : U.qtd(o.produzido)}</b><span>{o.realizado_por ? 'por ' + o.realizado_por : 'ainda não apontado'}</span></div>
      <div className="kpi"><small>R.I. (lote de material)</small><b>{o.ri || '—'}</b><span>{lote ? `${mp?.codigo || ''} · saldo ${U.qtd(C.saldoLote(lote))}` : o.ri ? 'sem entrada lançada' : o.tipo === 'conjunto' ? 'conjunto' : 'falta informar'}</span></div>
      <div className="kpi"><small>Material</small><b>{o.kg ? U.qtd(o.kg) : '—'}</b><span>{p?.mp_unidade || 'kg'}{p?.mp_codigo ? ' de ' + p.mp_codigo : ''}</span></div>
    </div>
    <section className="card mt"><Dl pares={[['Emitida', `${U.data(o.emitida_em)}${o.emitido_por ? ' por ' + o.emitido_por : ''}`], ['Prazo', o.prazo ? U.data(o.prazo) : ''],
      ['Realizada', o.realizada_em ? `${U.data(o.realizada_em)}${o.realizado_por ? ' por ' + o.realizado_por : ''}` : ''],
      ['Pedido do cliente', venda ? `${venda.cliente_nome || ''} · pedido ${venda.pedido || '—'} · ${U.qtd(venda.qtd)} pç para ${U.data(venda.prazo)}` : ''],
      ['Máquina', maq ? C.nomeMaquina(maq) : ''], ['OF do conjunto', pai ? <a href={'#/of/' + pai.id}>OF {pai.numero}</a> : ''],
      ['Observações', o.obs ? <Texto t={o.obs} /> : '']]} /></section>
    {o.tipo === 'conjunto' && <section className="card mt"><div className="card-cab"><h2>Componentes do conjunto</h2><span className="sub">OF de cada componente</span></div>
      {o.componentes.length ? <div className="rolagem-x"><table className="tabela-fab"><thead><tr><th>Código</th><th className="so-largo">Descrição</th><th className="n">Qtd</th><th>OF comp.</th></tr></thead>
        <tbody>{o.componentes.map((c, i) => { const cp = C.produtoPorCodigo(c.codigo), ref = ofPorNumero(c.ref)
          return <tr key={i}><td>{cp ? <a href={'#/produto/' + cp.id}>{c.codigo}</a> : c.codigo}</td><td className="so-largo">{cp?.descricao || ''}</td><td className="n">{U.qtd(c.qtd)}</td>
            <td>{ref ? <a href={'#/of/' + ref.id}>{ref.numero}</a> : c.ref || '—'}{ref ? <> <Tag s={C.situacaoOF(ref)} /></> : null}</td></tr> })}</tbody></table></div>
        : <p className="sub">Este conjunto não tem estrutura cadastrada. Cadastre os componentes em Produtos.</p>}</section>}
    {filhas.length > 0 && <section className="card mt"><div className="card-cab"><h2>OFs geradas para os componentes</h2></div><div className="lista">{filhas.map(x => <LinhaOF key={x.id} o={x} />)}</div></section>}
  </>
}

// ---------------------------------------------------------------- emitir / editar
function CorpoOF({ b }: { b: Partial<OF> }) {
  const [prod, setProd] = useState<Produto | null>(S.get('produtos', b.produto_id))
  const [q, setQ] = useState<number>(Number(b.qtd) || 0)
  const temEstr = !!prod && C.componentes(prod.id).length > 0
  const mp = prod?.mp_codigo ? C.produtoPorCodigo(prod.mp_codigo) : null
  const lotes = mp ? U.ordenar(S.lista('mp_lotes').filter(l => l.produto_id === mp.id && l.status === 'Aprovado' && C.saldoLote(l) > 0), l => l.ri) : []
  const precisa = prod?.mp_qtd && q ? U.r4(q * Number(prod.mp_qtd)) : 0
  return <>
    <ComboProduto id="ofProd" nome="produto_id" rotulo="Código do produto" classe="peca" req placeholder="Código JAF ou descrição" inicial={prod} readOnly={!!b.id}
      aoEscolher={setProd} aoLimpar={() => setProd(null)} />
    <div className="linha-campos">
      <Campo nome="qtd" rotulo="Quantidade (peças)" tipo="qtd" req valor={U.campoNum(b.qtd, 3)} attrs={{ onInput: (e: { target: HTMLInputElement }) => setQ(U.num(e.target.value) || 0) }} />
      <Campo nome="emitida_em" rotulo="Data" tipo="date" valor={b.emitida_em || U.hoje()} />
      <Campo nome="prazo" rotulo="Prazo" tipo="date" valor={b.prazo} />
    </div>
    {prod && !temEstr && <>
      <div className="linha-campos">
        <Campo nome="ri" rotulo="R.I. do material" tipo="num" valor={b.ri} attrs={{ list: 'lRI' }} ajuda={mp ? `Material: ${mp.codigo}` : 'Produto sem matéria-prima cadastrada'} />
        <Campo nome="kg" rotulo={`Material (${prod.mp_unidade || 'kg'})`} tipo="qtd" valor={U.campoNum(b.kg, 3)} placeholder={precisa ? U.qtd(precisa) : ''} ajuda={precisa ? `Pelo cadastro: ${U.qtd(precisa)} (${U.qtd(prod.mp_qtd)} por peça). Em branco = calcula sozinho.` : ''} />
      </div>
      <datalist id="lRI">{lotes.map(l => <option key={l.id} value={l.ri}>{`saldo ${U.qtd(C.saldoLote(l))} · ${U.dataCurta(l.data)}`}</option>)}</datalist>
      {mp && !lotes.length && <p className="sub"><b>Atenção:</b> não há lote de {mp.codigo} com saldo. Lance a entrada em Matéria-prima.</p>}
      {lotes.length > 0 && <p className="sub">Lotes com saldo: {lotes.slice(0, 6).map(l => `R.I. ${l.ri} (${U.qtd(C.saldoLote(l))})`).join(' · ')}</p>}
    </>}
    {prod && temEstr && <div className="card mt" style={{ boxShadow: 'none' }}><b>Conjunto — componentes por {q ? U.qtd(q) : '1'} pç</b>
      <ul className="sub" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{C.componentes(prod.id).map(e => { const f = S.get('produtos', e.filho_id); return <li key={e.id}>{f?.codigo} — {U.qtd(Number(e.qtd) * (q || 1))} {e.unidade}</li> })}</ul>
      {!b.id && <Campo nome="gerar_componentes" rotulo="Emitir também as OFs dos componentes que são fabricados aqui" tipo="check" valor={true} />}</div>}
    <ComboMaquina id="ofMaq" nome="maquina_id" rotulo="Máquina (opcional)" placeholder="Onde vai ser feita" inicial={S.get('maquinas', b.maquina_id)} />
    <Campo nome="emitido_por" rotulo="Emitido por" valor={b.emitido_por || API.sessao?.nome} />
    <Campo nome="obs" rotulo="Observações" tipo="area" linhas={2} valor={b.obs} />
  </>
}

export async function formOF(b: Partial<OF> = {}): Promise<string | null> {
  // abre de qualquer lugar (Início, barra de baixo): garante as tabelas antes de montar a janela
  await S.garantir(['produtos', 'produto_estrutura', 'mp_lotes', 'ofs'])
  const novo = !b.id
  return modal<string>({
    titulo: novo ? 'Nova ordem de fabricação' : `Editar OF ${b.numero}`,
    corpo: <CorpoOF b={b} />,
    botoes: [{ txt: novo ? 'Emitir OF' : 'Salvar', acao: async (f) => {
      const d = lerForm(f)
      if (!f.dataset.envio) f.dataset.envio = b.id || U.uuid()
      const r = await API.rpc<{ id: string; numero: number; componentes: number }>('emitir_of', { p: { ...d, id: f.dataset.envio, venda_id: b.venda_id || null, pai_id: b.pai_id || null } })
      await App.gravou(['ofs'])
      aviso(novo ? `OF ${r.numero} emitida${r.componentes ? ` (+ ${U.plural(r.componentes, 'OF')} de componente)` : ''}.` : 'OF salva.')
      if (novo) location.hash = '#/of/' + r.id
      return r.id
    } }],
  })
}

// ---------------------------------------------------------------- apontar (o que a planilha chama de "Qde Prod.", "Realizado" e "Status")
export async function apontar(o: OF): Promise<unknown> {
  // abre de qualquer lugar (Início, barra de baixo): garante as tabelas antes de montar a janela
  await S.garantir(['produtos', 'ofs'])
  const p = S.get('produtos', o.produto_id)
  const salvar = (encerrar: boolean) => async (f: HTMLFormElement) => {
    const d = lerForm(f)
    if (encerrar && (d.produzido === null || d.produzido === undefined)) throw new Error('Informe quantas peças foram produzidas')
    await API.rpc('apontar_of', { p: { ...d, id: o.id, status: encerrar ? 'encerrada' : 'aberta' } })
    await App.gravou(['ofs']); aviso(encerrar ? `OF ${o.numero} encerrada.` : 'Apontamento salvo.'); return true
  }
  return modal({
    titulo: `Apontar OF ${o.numero}`,
    corpo: <>
      <p className="sub">{p?.codigo} — {p?.descricao} · {U.qtd(o.qtd)} pç</p>
      <div className="linha-campos">
        <Campo nome="produzido" rotulo="Qtde produzida" tipo="qtd" valor={U.campoNum(o.produzido ?? null, 3)} placeholder={U.qtd(o.qtd)} foco />
        <Campo nome="realizada_em" rotulo="Data" tipo="date" valor={o.realizada_em || U.hoje()} />
      </div>
      {o.tipo === 'componente' && <div className="linha-campos">
        <Campo nome="ri" rotulo="R.I. do material" tipo="num" valor={o.ri} />
        <Campo nome="kg" rotulo="Material usado (kg)" tipo="qtd" valor={U.campoNum(o.kg, 3)} />
      </div>}
      <Campo nome="realizado_por" rotulo="Realizado por" valor={o.realizado_por || API.sessao?.nome} />
      <Campo nome="obs" rotulo="Observação (opcional)" tipo="area" linhas={2} />
    </>,
    botoes: [{ txt: 'Salvar sem encerrar', cls: 'sec', acao: salvar(false) }, { txt: 'Encerrar OF', acao: salvar(true) }],
  })
}

async function cancelar(o: OF) {
  if (!await confirmar(`Cancelar a OF ${o.numero}?`, { detalhe: 'O material dela volta para o saldo do lote.', ok: 'Cancelar OF', nao: 'Voltar', perigo: true })) return
  await API.rpc('apontar_of', { p: { id: o.id, status: 'cancelada' } }); await App.gravou(['ofs']); aviso('OF cancelada.')
}
async function reabrir(o: OF) {
  if (!await confirmar(`Reabrir a OF ${o.numero}?`, { ok: 'Reabrir' })) return
  await API.rpc('apontar_of', { p: { id: o.id, status: 'aberta' } }); await App.gravou(['ofs']); aviso('OF reaberta.')
}

// ---------------------------------------------------------------- impressão (mesmos campos do FORM.034 / FORM.042)
export async function imprimirOF(o: OF): Promise<void> {
  const p = S.get('produtos', o.produto_id), lote = C.loteDoRI(o.ri), venda = S.get('vendas', o.venda_id)
  const conj = o.tipo === 'conjunto'
  const blob = await pdfDocumento(`Ordem de Fabricação nº ${o.numero}`, conj ? 'FORM.042 — OF de conjunto' : 'FORM.034 — OF de componente', (c) => {
    const linhas: [string, string][] = [['Código do produto', p?.codigo || ''], ['Descrição', p?.descricao || ''], ['Operação', p?.operacao || ''],
      ['Quantidade', U.qtd(o.qtd) + ' pç'], ['Data de emissão', U.data(o.emitida_em)], ['Emitido por', o.emitido_por || ''], ['Prazo', o.prazo ? U.data(o.prazo) : '']]
    if (!conj) linhas.push(['Matéria-prima', p?.mp_codigo ? `${p.mp_codigo} (${U.qtd(p.mp_qtd)} ${p.mp_unidade || 'kg'} por peça)` : ''],
      ['R.I.', o.ri ? String(o.ri) + (lote ? ` — NF ${lote.nota || '—'} · ${lote.fornecedor_nome || ''}` : '') : ''], ['Material (kg)', o.kg ? U.qtd(o.kg) : ''])
    if (venda) linhas.push(['Pedido do cliente', `${venda.cliente_nome || ''} · ${venda.pedido || ''}`])
    c.tabela({ ...c.estilo, startY: c.y + 2, body: linhas.filter(l => l[1]), theme: 'grid', columnStyles: { 0: { cellWidth: 48, fontStyle: 'bold', fillColor: [240, 243, 247] } } })
    let y = c.doc.lastAutoTable.finalY + 6
    if (conj) {
      c.tabela({ ...c.estilo, startY: y, head: [['#', 'Código', 'Descrição', 'Qtd', 'OF comp.', 'R.I.']],
        body: o.componentes.map((x, i) => { const cp = C.produtoPorCodigo(x.codigo), ref = ofPorNumero(x.ref); return [i + 1, x.codigo, cp?.descricao || '', U.qtd(x.qtd), x.ref || '', ref?.ri || ''] }),
        columnStyles: { 0: { cellWidth: 8 }, 3: { halign: 'right' } } })
      y = c.doc.lastAutoTable.finalY + 6
    }
    c.tabela({ ...c.estilo, startY: y, head: [['Apontamento', '']], theme: 'grid', styles: { ...c.estilo.styles, minCellHeight: 9 },
      body: [['Qtde produzida', o.produzido !== null ? U.qtd(o.produzido) : ''], ['Realizado por', o.realizado_por || ''], ['Data', o.realizada_em ? U.data(o.realizada_em) : ''], ['Status', C.situacaoOF(o).txt]],
      columnStyles: { 0: { cellWidth: 48, fontStyle: 'bold' } } })
    y = c.doc.lastAutoTable.finalY + 6
    if (o.obs) y = c.texto('Observações: ' + o.obs, y + 2, { tam: 9 })
    c.assinatura('Emitido por', o.emitido_por || '', 14, Math.max(y + 22, 250), 80)
    c.assinatura('Realizado por', o.realizado_por || '', c.W - 94, Math.max(y + 22, 250), 80)
  })
  await entregar(blob, `OF ${o.numero}.pdf`)
}
