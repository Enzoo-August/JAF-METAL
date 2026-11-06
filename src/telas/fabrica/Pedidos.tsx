/* Pedidos de clientes (planilha "Controle de Pedidos"): o que cada cliente pediu, prazo, quanto já foi entregue e o saldo.
 * Situação igual à da planilha: Ok (entregue) · Aguardando (no prazo) · Atenção (vence hoje) · Atraso · Cancelado.
 * Necessidade (aba "Necessidade" da planilha): o saldo dos pedidos explodido pela estrutura → peças e matéria-prima. */
import { useState } from 'react'
import { App } from '../../app/controle.tsx'
import { API } from '../../lib/api.ts'
import { C, S } from '../../lib/dados.ts'
import { Perm } from '../../lib/perm.ts'
import type { Venda } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { excel } from '../../ui/arquivos.tsx'
import { aviso } from '../../ui/avisos.ts'
import { BuscaLista, Btn, Cab, Campo, Chips, Dl, Paginado, Tag, Vazio } from '../../ui/base.tsx'
import { ComboCliente } from '../../ui/Combo.tsx'
import { useLembrar, type Rota } from '../../ui/ganchos.ts'
import { confirmar, lerForm, modal } from '../../ui/janelas.tsx'
import { ComboProduto, ComTabelas } from './comum.tsx'
import { formOF } from './OFs.tsx'
import { cancelarNecessidade, formNecessidade, pedidosPorFornecedor } from './Compra.tsx'
import { Ic } from '../../ui/icones.tsx'

const TABS = ['produtos', 'produto_estrutura', 'vendas', 'vendas_entregas', 'ofs', 'mp_lotes'] as const

function LinhaVenda({ v }: { v: Venda }) {
  const st = C.situacaoVenda(v), s = C.saldoVenda(v)
  return <div className="linha clicavel" data-venda={v.id} onClick={() => void detalhe(v.id)}><div className="meio"><b>{v.cliente_nome || '—'} · {v.codigo || v.descricao}</b>
    <small>{[v.codigo ? v.descricao : '', v.codigo_cliente, v.pedido ? 'pedido ' + v.pedido : '', 'prazo ' + U.dataCurta(v.prazo)].filter(Boolean).join(' · ')}</small></div>
    <div className="lado"><b>{U.qtd(Math.max(0, s))}</b><small>de {U.qtd(v.qtd)}</small><Tag s={st} /></div></div>
}

export function TelaPedidos({ r }: { r: Rota }) {
  return <ComTabelas tabs={[...TABS]}>{() => r.nome === 'necessidade' ? <ComTabelas tabs={['necessidades']}>{() => <Necessidade r={r} />}</ComTabelas> : <Lista />}</ComTabelas>
}

function Lista() {
  const [f, setF] = useLembrar('ven.f', 'aberto')
  const [cli, setCli] = useLembrar('ven.cli', '')
  const [busca, setBusca] = useLembrar('ven.busca', '')
  const todas = S.lista('vendas')
  const cod = (v: Venda) => C.situacaoVenda(v).cod
  const cont: Record<string, number> = {}
  for (const v of todas) { const c = cod(v); cont[c] = (cont[c] || 0) + 1 }
  let l = cli ? todas.filter(v => (v.cliente_id || v.cliente_nome) === cli) : todas
  if (f === 'aberto') l = l.filter(v => ['aguardando', 'atencao', 'atraso'].includes(cod(v)))
  else if (f !== 'todos') l = l.filter(v => cod(v) === f)
  l = busca.trim() ? U.buscar(l, busca, v => [v.codigo || '', v.descricao || '', v.codigo_cliente || '', v.pedido || '', v.cliente_nome || ''])
    : U.ordenar(l, v => (v.prazo || '9999') + (v.cliente_nome || ''), f !== 'aberto' && f !== 'atraso' && f !== 'atencao')
  const clientes = U.ordenar([...new Map(todas.map(v => [v.cliente_id || v.cliente_nome || '', v.cliente_nome || '—'])).entries()], x => U.sem(x[1]))
  const abertas = todas.filter(v => ['aguardando', 'atencao', 'atraso'].includes(cod(v)))
  const mes = U.hoje().slice(0, 7)
  const entMes = S.lista('vendas_entregas').filter(e => e.data.startsWith(mes))
  const fatMes = U.soma(entMes, e => Number(e.qtd) * Number(S.get('vendas', e.venda_id)?.valor || 0))
  const carteira = U.soma(abertas, v => C.saldoVenda(v) * Number(v.valor || 0))
  return <>
    <Cab titulo="Pedidos de clientes" sub="Controle de pedidos: o que cada cliente pediu, prazo e entregas">
      {Perm.pode('vendas_editar') && <Btn txt="Novo pedido" icone="mais" cls="pri" data-ven="novo" onClick={() => void formVenda()} />}
      {Perm.pode('necessidade') && <a className="btn sec" href="#/necessidade"><span>Necessidade</span></a>}
      <Btn txt="Excel" icone="planilha" cls="fantasma" onClick={() => exportar(l)} />
    </Cab>
    <div className="grade g4">
      <div className="kpi"><small>Itens em aberto</small><b>{abertas.length}</b><span>{U.plural(new Set(abertas.map(v => v.cliente_nome)).size, 'cliente')}</span></div>
      <div className="kpi"><small>Em atraso</small><b style={{ color: cont.atraso ? 'var(--vermelho)' : undefined }}>{cont.atraso || 0}</b><span>{cont.atencao ? cont.atencao + ' vencem hoje' : 'itens'}</span></div>
      {carteira > 0 && <div className="kpi"><small>Carteira (saldo × preço)</small><b>{U.moeda0(carteira)}</b><span>a entregar</span></div>}
      <div className="kpi"><small>Entregue no mês</small><b>{fatMes > 0 ? U.moeda0(fatMes) : U.qtd(U.soma(entMes, 'qtd'))}</b><span>{fatMes > 0 ? U.plural(entMes.length, 'entrega') : 'peças'}</span></div>
    </div>
    <div className="barra-filtros mt"><BuscaLista id="bVen" valor={busca} placeholder="Código, pedido, código do cliente" aoMudar={setBusca} />
      <select value={cli} onChange={(e) => setCli(e.target.value)} aria-label="Cliente" data-ven-cli="1"><option value="">Todos os clientes</option>{clientes.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
    <Chips atual={f} aoEscolher={setF} opcoes={[{ v: 'aberto', t: 'Em aberto', n: abertas.length }, { v: 'atraso', t: 'Atraso', n: cont.atraso || null }, { v: 'atencao', t: 'Atenção (hoje)', n: cont.atencao || null },
      { v: 'aguardando', t: 'Aguardando' }, { v: 'ok', t: 'Entregues' }, { v: 'cancelado', t: 'Cancelados' }, { v: 'todos', t: 'Todos' }]} />
    <div className="mt" id="lVen"><Paginado itens={l} render={v => <LinhaVenda key={v.id} v={v} />} vazio={<Vazio icone="cliente" titulo="Nenhum pedido aqui" />} /></div>
  </>
}

function exportar(l: Venda[]) {
  return excel('Controle de Pedidos.xlsx', [['Pedidos', l.map(v => ({ Cliente: v.cliente_nome || '', 'Cód. JAF': v.codigo || '', 'Cód. Cliente': v.codigo_cliente || '', Descrição: v.descricao || '',
    Pedido: v.pedido || '', Prazo: v.prazo ? U.data(v.prazo) : '', Qde: v.qtd, Entregue: v.entregue || 0, Saldo: C.saldoVenda(v), 'Preço unit.': v.valor || '',
    'Data entrega': v.entregue_em ? U.data(v.entregue_em) : '', Situação: C.situacaoVenda(v).txt, Obs: v.obs || '' }))]])
}

// ---------------------------------------------------------------- um item de pedido
export async function detalhe(id: string): Promise<unknown> {
  // abre de qualquer lugar (Início, barra de baixo): garante as tabelas antes de montar a janela
  await S.garantir(['produtos', 'vendas', 'vendas_entregas', 'ofs'])
  const v = S.get('vendas', id); if (!v) return
  const ents = U.ordenar(S.lista('vendas_entregas').filter(e => e.venda_id === v.id), e => e.data, true)
  const ofs = S.lista('ofs').filter(o => o.venda_id === v.id)
  const prod = S.get('produtos', v.produto_id) || C.produtoPorCodigo(v.codigo)
  const ed = Perm.pode('vendas_editar'), s = C.saldoVenda(v)
  return modal({
    titulo: `${v.cliente_nome || ''} · ${v.codigo || v.descricao}`, largura: 'larga',
    corpo: <>
      <p><Tag s={C.situacaoVenda(v)} /> {prod ? <a href={'#/produto/' + prod.id}>{prod.codigo} — {prod.descricao}</a> : v.descricao}</p>
      <div className="grade g3 mt"><div className="kpi"><small>Pedido</small><b>{U.qtd(v.qtd)}</b><span>prazo {U.data(v.prazo)}</span></div>
        <div className="kpi"><small>Entregue</small><b>{U.qtd(v.entregue)}</b><span>{v.entregue_em ? 'última ' + U.dataCurta(v.entregue_em) : 'nada ainda'}</span></div>
        <div className="kpi"><small>Saldo</small><b>{U.qtd(Math.max(0, s))}</b>{prod ? <span>{U.qtd(C.emOFAberta(prod.id))} em OF aberta</span> : null}</div></div>
      <div className="mt"><Dl pares={[['Pedido do cliente', v.pedido || ''], ['Código do cliente', v.codigo_cliente || ''], ['Preço unitário', v.valor ? U.moeda(v.valor) : ''], ['Observações', v.obs || '']]} /></div>
      {ents.length > 0 && <><h3 className="mt">Entregas</h3><div className="lista">{ents.map(e => <div key={e.id} className="linha"><div className="meio"><b>{U.qtd(e.qtd)} pç em {U.data(e.data)}</b><small>{e.nf ? 'NF ' + e.nf : ''}{e.obs ? ' · ' + e.obs : ''}</small></div>
        {ed && <div className="lado"><button type="button" className="icone-btn mini" aria-label="Desfazer entrega" onClick={async () => {
          if (!await confirmar('Desfazer esta entrega?', { ok: 'Desfazer', perigo: true })) return
          await API.rpc('excluir_entrega', { p_id: e.id }); await App.gravou(['vendas', 'vendas_entregas'], { inteira: ['vendas_entregas'] }); aviso('Entrega desfeita.')
        }}>✕</button></div>}</div>)}</div></>}
      {ofs.length > 0 && <p className="sub mt">OFs deste pedido: {ofs.map(o => <a key={o.id} href={'#/of/' + o.id} style={{ marginRight: 8 }}>{o.numero}</a>)}</p>}
    </>,
    botoes: ed ? [
      ...(prod && s > 0 && Perm.pode('of_emitir') ? [{ txt: 'Emitir OF', cls: 'sec', validar: false, acao: async () => { void formOF({ produto_id: prod.id, qtd: Math.max(0, s - C.emOFAberta(prod.id)) || s, prazo: v.prazo, venda_id: v.id }); return true } }] : []),
      { txt: 'Editar', cls: 'sec', validar: false, acao: async () => { void formVenda(v); return true } },
      ...(s > 0 && !v.cancelado ? [{ txt: 'Registrar entrega', validar: false, acao: async () => { void entregar(v); return true } }] : []),
    ] : [],
  })
}

export async function formVenda(b: Partial<Venda> = {}): Promise<unknown> {
  // abre de qualquer lugar (Início, barra de baixo): garante as tabelas antes de montar a janela
  await S.garantir(['produtos', 'vendas'])
  const novo = !b.id
  const salvar = (outro: boolean) => async (f: HTMLFormElement) => {
    const d = lerForm(f)
    if (!f.dataset.envio) f.dataset.envio = b.id || U.uuid()
    await API.rpc('salvar_venda', { p: { ...d, id: f.dataset.envio, cliente_nome: d.cliente_id ? null : b.cliente_nome } })
    await App.gravou(['vendas']); aviso(novo ? 'Item do pedido lançado.' : 'Pedido salvo.')
    if (outro) setTimeout(() => void formVenda({ cliente_id: d.cliente_id as string, pedido: d.pedido as string, prazo: d.prazo as string }), 300)
    return true
  }
  return modal({
    titulo: novo ? 'Novo pedido de cliente' : 'Editar pedido',
    corpo: <>
      <ComboCliente id="venCli" nome="cliente_id" rotulo="Cliente" req={!b.cliente_nome} placeholder="Nome do cliente" inicial={S.get('clientes', b.cliente_id)} />
      {!b.cliente_id && b.cliente_nome && <p className="sub">Na planilha: {b.cliente_nome}</p>}
      <div className="linha-campos"><Campo nome="pedido" rotulo="Nº do pedido do cliente" valor={b.pedido} /><Campo nome="prazo" rotulo="Prazo de entrega" tipo="date" req valor={b.prazo} /></div>
      <ComboProduto id="venProd" nome="produto_id" rotulo="Código JAF" placeholder="Código ou descrição" classe="peca" inicial={S.get('produtos', b.produto_id)} />
      <div className="linha-campos"><Campo nome="codigo_cliente" rotulo="Código do cliente" valor={b.codigo_cliente} ajuda="Em branco = o do cadastro do produto" />
        <Campo nome="descricao" rotulo="Descrição (se não tem código)" valor={b.produto_id ? '' : b.descricao} /></div>
      <div className="linha-campos"><Campo nome="qtd" rotulo="Quantidade" tipo="qtd" req valor={U.campoNum(b.qtd, 3)} />
        <Campo nome="valor" rotulo="Preço unitário" tipo="dinheiro" valor={U.campoNum(b.valor, 4)} /></div>
      <Campo nome="obs" rotulo="Observações" tipo="area" linhas={2} valor={b.obs} />
      {!novo && <Campo nome="cancelado" rotulo="Item cancelado pelo cliente" tipo="check" valor={b.cancelado} />}
    </>,
    botoes: [...(novo ? [{ txt: 'Salvar e lançar outro item', cls: 'sec', acao: salvar(true) }] : []), { txt: novo ? 'Lançar' : 'Salvar', acao: salvar(false) }],
  })
}

export async function entregar(v: Venda): Promise<unknown> {
  // abre de qualquer lugar (Início, barra de baixo): garante as tabelas antes de montar a janela
  await S.garantir(['vendas', 'vendas_entregas'])
  return modal({
    titulo: 'Registrar entrega',
    corpo: <><p className="sub">{v.cliente_nome} · {v.codigo || v.descricao} · saldo {U.qtd(C.saldoVenda(v))}</p>
      <div className="linha-campos"><Campo nome="qtd" rotulo="Quantidade entregue" tipo="qtd" req valor={U.campoNum(C.saldoVenda(v), 3)} foco />
        <Campo nome="data" rotulo="Data" tipo="date" valor={U.hoje()} /><Campo nome="nf" rotulo="Nota fiscal" /></div>
      <Campo nome="obs" rotulo="Observação" /></>,
    botoes: [{ txt: 'Registrar', acao: async (f) => {
      if (!f.dataset.envio) f.dataset.envio = U.uuid()
      await API.rpc('entregar_venda', { p: { ...lerForm(f), venda_id: v.id } }); await App.gravou(['vendas', 'vendas_entregas'], { inteira: ['vendas_entregas'] }); aviso('Entrega registrada.'); return true
    } }],
  })
}

// ---------------------------------------------------------------- necessidade (MRP)
function Necessidade({ r }: { r: Rota }) {
  const [ate, setAte] = useLembrar('nec.ate', '')
  const [aba, setAba] = useState(() => r.q.get('aba') || (API.sessao?.perfil === 'comercial' ? 'mp' : 'pecas'))
  const [sel, setSel] = useState<Set<string>>(new Set())
  const comprar = Perm.pode('compras_mp'), verPed = Perm.pode('compras_ver'), lancar = Perm.pode('necessidade_criar')
  const vendas = S.lista('vendas').filter(v => !v.cancelado && C.saldoVenda(v) > 0 && (!ate || (v.prazo || '') <= ate))
  const n = C.necessidade(vendas)
  const est = C.estoqueMP()
  const pecas = U.ordenar([...n.pecas].map(([id, q]) => { const p = S.get('produtos', id)!; const em = C.emOFAberta(id); return { p, q, em, falta: Math.max(0, U.r4(q - em)) } }).filter(x => x.p), x => -x.falta)
  // matéria-prima: o que falta comprar = necessário − estoque − o que já está em pedido de compra
  const mps = U.ordenar([...n.mp].map(([id, q]) => { const p = S.get('produtos', id)!; const e = est.get(id) || 0; const ped = verPed ? C.pendenteMP(id) : 0
    return { p, q, e, ped, falta: Math.max(0, U.r4(q - e - ped)) } }).filter(x => x.p), x => -x.falta)
  const manuais = S.lista('necessidades').filter(x => x.status === 'aberta').sort((a, b) => (a.prazo || '9') < (b.prazo || '9') ? -1 : 1)
  const viraram = S.lista('necessidades').filter(x => x.status === 'pedido').sort((a, b) => a.atualizado_em < b.atualizado_em ? 1 : -1).slice(0, 5)
  const semCad = vendas.filter(v => !(v.produto_id ? S.get('produtos', v.produto_id) : C.produtoPorCodigo(v.codigo)))
  const un = (id: string) => C.unidadeMP(id)
  const marcar = (k: string, on: boolean) => setSel(x => { const y = new Set(x); if (on) y.add(k); else y.delete(k); return y })
  const fazerPedido = async () => {
    const itens = [...sel].map(k => {
      if (k.startsWith('n:')) { const ne = S.get('necessidades', k.slice(2)); return ne && ne.status === 'aberta' ? { produto_id: ne.produto_id, qtd: ne.qtd, necessidades: [ne.id] } : null }
      const x = mps.find(m => m.p.id === k.slice(2)); return x && x.falta > 0 ? { produto_id: x.p.id, qtd: Math.ceil(x.falta) } : null
    }).filter((x): x is NonNullable<typeof x> => !!x)
    if (!itens.length) { aviso('Marque pelo menos um material.', 'erro'); return }
    const feitos = await pedidosPorFornecedor(itens)
    if (feitos) setSel(new Set())
  }
  const Ck = ({ k, rot }: { k: string; rot: string }) => comprar ? <input type="checkbox" className="nec-ck" checked={sel.has(k)} onChange={(e) => marcar(k, e.target.checked)} aria-label={'Comprar ' + rot} data-sel={k} /> : null
  const nMp = mps.filter(x => x.falta > 0).length + manuais.length
  return <>
    <Cab titulo={API.sessao?.perfil === 'comercial' ? 'O que comprar' : 'Necessidade'} sub={aba === 'mp' ? 'Matéria-prima que falta para os pedidos de clientes e o que o PCP pediu' : 'O que falta fabricar e comprar para atender os pedidos em aberto'}>
      {lancar && !comprar && <Btn txt="Pedir compra" icone="mais" cls="pri" data-n="lancar" onClick={() => formNecessidade()} />}
      <Btn txt="Excel" icone="planilha" cls="fantasma" onClick={() => excel('Necessidade.xlsx', [
        ['Peças', pecas.map(x => ({ Código: x.p.codigo, Descrição: x.p.descricao, Necessário: x.q, 'Em OF aberta': x.em, 'Falta emitir OF': x.falta }))],
        ['Matéria-prima', mps.map(x => ({ Material: x.p.codigo, Descrição: x.p.descricao, Necessário: x.q, 'Saldo em estoque': x.e, ...(verPed ? { 'Em pedido de compra': x.ped } : {}), 'Falta comprar': x.falta }))],
        ['Pedidos do PCP', manuais.map(x => ({ Material: S.get('produtos', x.produto_id)?.codigo || '', Quantidade: x.qtd, Unidade: un(x.produto_id), 'Precisa até': x.prazo ? U.data(x.prazo) : '', 'Pedido por': x.criado_nome || '', Motivo: x.motivo || '' }))]])} />
    </Cab>
    <div className="barra-filtros"><label className="sub" htmlFor="necAte">Pedidos com prazo até</label>
      <input id="necAte" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />{ate && <button type="button" className="btn fantasma" onClick={() => setAte('')}>Todos</button>}</div>
    <Chips atual={aba} aoEscolher={(v) => { setAba(v); setSel(new Set()) }} opcoes={[{ v: 'pecas', t: 'Peças e conjuntos', n: pecas.filter(x => x.falta > 0).length }, { v: 'mp', t: 'Matéria-prima', n: nMp }]} />
    {aba === 'pecas'
      ? <>
        <p className="sub">{U.plural(vendas.length, 'item', 'itens')} de pedido em aberto. A conta usa a estrutura de cada conjunto e o consumo de material de cada peça (cadastro em Produtos).</p>
        <section className="card mt"><div className="rolagem-x"><table className="tabela-fab" id="tNecP"><thead><tr><th>Código</th><th className="so-largo">Descrição</th><th className="n">Necessário</th><th className="n">Em OF</th><th className="n">Falta</th><th /></tr></thead>
        <tbody>{pecas.map(x => <tr key={x.p.id}><td><a href={'#/produto/' + x.p.id}>{x.p.codigo}</a></td><td className="so-largo">{x.p.descricao}</td><td className="n">{U.qtd(x.q)}</td><td className="n">{U.qtd(x.em)}</td>
          <td className="n"><b style={{ color: x.falta ? 'var(--vermelho)' : undefined }}>{U.qtd(x.falta)}</b></td>
          <td>{x.falta > 0 && Perm.pode('of_emitir') && (x.p.mp_codigo || C.componentes(x.p.id).length > 0) ? <button type="button" className="btn fantasma mini" onClick={() => void formOF({ produto_id: x.p.id, qtd: x.falta })}>Emitir OF</button> : null}</td></tr>)}</tbody></table></div>
        {!pecas.length && <p className="sub">Nada a fabricar para os pedidos em aberto.</p>}</section></>
      : <>
        <section className="card mt" id="necPcp"><div className="card-cab"><h2>Pedidos do PCP</h2>{manuais.length > 0 && <span className="sub">{U.plural(manuais.length, 'pedido')}</span>}</div>
          {manuais.length ? <div className="lista nec-lista" id="tNecPcp">{manuais.map(x => { const p = S.get('produtos', x.produto_id)
            return <div key={x.id} className={'linha' + (sel.has('n:' + x.id) ? ' marcada' : '')} data-nec={x.id}><Ck k={'n:' + x.id} rot={p?.codigo || ''} />
              <div className="meio"><b className="mono">{p?.codigo}</b><small>{p?.descricao}</small><small>{[x.criado_nome ? 'pedido por ' + x.criado_nome : '', x.motivo].filter(Boolean).join(' · ')}</small></div>
              <div className="lado"><b>{U.qtd(x.qtd)} {un(x.produto_id)}</b><small>{x.prazo ? 'até ' + U.dataCurta(x.prazo) : 'sem prazo'}</small></div>
              {lancar && <div className="nec-acoes"><button type="button" className="icone-btn mini" aria-label="Editar" onClick={() => formNecessidade(x)}><Ic n="lapis" /></button>
                <button type="button" className="icone-btn mini" aria-label="Cancelar" data-cancelar={x.id} onClick={() => cancelarNecessidade(x)}><Ic n="x" /></button></div>}</div> })}</div>
            : <p className="sub">Nada pedido pelo PCP agora.{lancar && !comprar ? ' Use “Pedir compra” para mandar uma necessidade ao Comercial.' : ''}</p>}
          {viraram.length > 0 && <p className="peq mt">Já viraram pedido de compra: {viraram.map(x => `${S.get('produtos', x.produto_id)?.codigo || ''} (${U.qtd(x.qtd)} ${un(x.produto_id)})`).join(', ')}.</p>}
        </section>
        <section className="card mt"><div className="card-cab"><h2>Para os pedidos de clientes</h2></div>
          <p className="sub">Calculado sozinho: estrutura de cada conjunto × saldo dos pedidos, descontando o estoque{verPed ? ' e o que já está em pedido de compra' : ''}.</p>
          {mps.length > 0 && <div className="lista nec-lista mt" id="tNecM">{mps.map(x => <div key={x.p.id} className={'linha' + (sel.has('a:' + x.p.id) ? ' marcada' : '')}>
            {comprar && (x.falta > 0 ? <Ck k={'a:' + x.p.id} rot={x.p.codigo} /> : <span className="nec-ck vazio" />)}
            <div className="meio"><b className="mono">{x.p.codigo}</b><small>{x.p.descricao}</small>
              <small>Precisa {U.qtd(x.q)} · estoque {U.qtd(x.e)}{verPed && x.ped ? ` · em pedido ${U.qtd(x.ped)}` : ''} {un(x.p.id)}</small></div>
            <div className="lado">{x.falta ? <><b style={{ color: 'var(--vermelho)' }}>{U.qtd(x.falta)} {un(x.p.id)}</b><small>falta comprar</small></> : <Tag s={{ txt: 'Ok', cor: 'verde' }} />}</div></div>)}</div>}
          {!mps.length && <p className="sub">Nenhuma matéria-prima calculada (as peças precisam ter o material cadastrado).</p>}</section>
        {comprar && <div className="barra-acao" id="necBarra">
          <span>{sel.size ? U.plural(sel.size, 'material marcado', 'materiais marcados') : 'Marque o que vai comprar'}</span>
          <Btn txt="Fazer pedido de compra" icone="compras" cls="pri" data-n="pedido" disabled={!sel.size} onClick={fazerPedido} />
        </div>}
      </>}
    {semCad.length > 0 && <p className="sub mt">{U.plural(semCad.length, 'item', 'itens')} de pedido sem cadastro técnico ficaram fora da conta: {U.unicos(semCad.map(v => v.codigo || v.descricao || '')).slice(0, 12).join(', ')}{semCad.length > 12 ? '…' : ''}</p>}
  </>
}

export const detalheVenda = detalhe
