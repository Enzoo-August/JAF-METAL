/* Compras: pedidos de compra, recebimento e lista de compras */
import { useEffect, useRef, useState } from 'react'
import { App } from '../app/controle.tsx'
import { API, ErroApp } from '../lib/api.ts'
import { C, S, type ItemCompra } from '../lib/dados.ts'
import { Perm } from '../lib/perm.ts'
import type { Fornecedor, Peca, PedidoCompra } from '../lib/tipos.ts'
import * as U from '../lib/util.ts'
import { aviso } from '../ui/avisos.ts'
import { entregar, excel, pdfPedido, pdfTabela, prepararPdf, type ColunaPdf } from '../ui/arquivos.tsx'
import { BuscaLista, Btn, Cab, Campo, Chips, Dl, Paginado, Tag, Texto, Vazio, Voltar, type OpcaoChip } from '../ui/base.tsx'
import { ComboFornecedor, ComboPeca, type ComboApi } from '../ui/Combo.tsx'
import { useLembrar, type Rota } from '../ui/ganchos.ts'
import { Ic } from '../ui/icones.tsx'
import { confirmar, lerForm, modal, useJanela } from '../ui/janelas.tsx'
import { form as formConta, LinhaConta } from './Financeiro.tsx'
import { LinhaMov } from './Movimentos.tsx'

export function TelaCompras({ r }: { r: Rota }) {
  if (r.nome === 'pedido') return <Ficha id={r.id!} />
  if (r.sub === 'lista') return <ListaCompras />
  return <Lista r={r} />
}
export const tituloCompras = (r: Rota) => r.nome === 'pedido' ? 'Pedido nº ' + (S.get('pedidos_compra', r.id)?.numero || '') : r.sub === 'lista' ? 'Lista de compras' : 'Pedidos de compra'

// ---------------------------------------------------------------- lista de pedidos
function filtrar(f: string, busca: string): PedidoCompra[] {
  let l = S.lista('pedidos_compra')
  const sit = (p: PedidoCompra) => C.situacaoPedido(p).cod
  if (f === 'aberto') l = l.filter(p => p.status === 'aguardando')
  else if (f === 'atrasado') l = l.filter(p => sit(p) === 'atrasado')
  else if (f === 'hoje') l = l.filter(p => sit(p) === 'hoje')
  else if (f === 'recebido') l = l.filter(p => p.status === 'recebido')
  else if (f === 'cancelado') l = l.filter(p => p.status === 'cancelado')
  else if (f === 'semconta') l = l.filter(p => C.semConta(p))
  if (busca.trim()) {
    const t = U.sem(busca.trim()).split(' ')
    l = l.filter(p => { const txt = U.sem([p.numero, S.get('fornecedores', p.fornecedor_id)?.nome, p.documento, p.obs,
      ...C.itensDoPedido(p.id).map(i => { const pc = S.get('pecas', i.peca_id); return pc ? pc.codigo + ' ' + pc.descricao : '' })].join(' '))
      return t.every(x => txt.includes(x)) })
  }
  return l.slice().sort((a, b) => f === 'aberto' || f === 'atrasado' || f === 'hoje' ? ((a.prazo || '9') < (b.prazo || '9') ? -1 : 1) : (b.numero - a.numero))
}

export function LinhaPedido({ p }: { p: PedidoCompra }) {
  const f = S.get('fornecedores', p.fornecedor_id)
  const nomes = C.itensDoPedido(p.id).map(i => S.get('pecas', i.peca_id)?.codigo).filter(Boolean)
  return <a className="linha" href={'#/pedido/' + p.id}>
    <div className="meio"><b>Nº {p.numero} · {f?.nome || '—'}</b>
      <small>{nomes.slice(0, 4).join(', ')}{nomes.length > 4 ? ` +${nomes.length - 4}` : ''} · pedido em {U.dataCurta(p.data)}{p.prazo ? ' · entrega ' + U.dataCurta(p.prazo) : ''}</small></div>
    <div className="lado"><b>{U.moeda(C.totalPedido(p))}</b><Tag s={C.situacaoPedido(p)} /></div></a>
}

function Lista({ r }: { r: Rota }) {
  const [f, setF] = useLembrar('compras.f', 'aberto')
  const [busca, setBusca] = useLembrar('compras.busca', '')
  useEffect(() => { const q = r.q.get('f'); if (q) setF(q) }, [r.hash, r.q, setF])
  const n = (x: string) => filtrar(x, busca).length
  const lc = C.listaCompras().filter(x => !x.jaPedido).length
  const chips: OpcaoChip[] = [{ v: 'aberto', t: 'Em aberto', n: n('aberto') }, { v: 'atrasado', t: 'Atrasados', n: n('atrasado') }, { v: 'hoje', t: 'Chegam hoje', n: n('hoje') },
    { v: 'recebido', t: 'Recebidos' }, { v: 'cancelado', t: 'Cancelados' }, { v: 'todos', t: 'Todos' }]
  if (Perm.pode('financeiro')) chips.push({ v: 'semconta', t: 'Sem conta lançada', n: n('semconta') || null })
  const l = filtrar(f, busca)
  return <>
    <Cab titulo="Pedidos de compra" sub="O que foi pedido aos fornecedores e o que já chegou">
      <Btn txt="Novo pedido" icone="mais" cls="pri" data-c="novo" onClick={() => void form({})} />
      <a className="btn sec" href="#/compras/lista"><Ic n="lista" /><span>Lista de compras{lc ? ` (${lc})` : ''}</span></a>
    </Cab>
    <div className="barra-filtros"><BuscaLista id="bPed" valor={busca} placeholder="Número, fornecedor, peça ou documento" aoMudar={setBusca} /></div>
    <Chips atual={f} aoEscolher={setF} opcoes={chips} />
    <p className="sub mt" id="resPed">{U.plural(l.length, 'pedido')} · {U.moeda(U.soma(l, p => C.totalPedido(p)))}</p>
    <Paginado key={f + '|' + busca} itens={l} passo={50} render={(p) => <LinhaPedido key={p.id} p={p} />}
      vazio={<Vazio icone="compras" titulo={f === 'aberto' ? 'Nenhum pedido aguardando' : 'Nenhum pedido aqui'} texto="Use a Lista de compras para ver o que está faltando." />} />
  </>
}

// ---------------------------------------------------------------- ficha do pedido
function Ficha({ id }: { id: string }) {
  useEffect(() => { prepararPdf() }, [])
  const p = S.get('pedidos_compra', id)
  if (!p) return <Vazio icone="compras" titulo="Pedido não encontrado"><a className="btn pri" href="#/compras">Voltar aos pedidos</a></Vazio>
  const f = S.get('fornecedores', p.fornecedor_id)
  const itens = C.itensDoPedido(p.id), sit = C.situacaoPedido(p)
  const aberto = p.status === 'aguardando'
  const pendente = itens.some(i => i.recebido < i.qtd)
  const recebeu = itens.some(i => i.recebido > 0)
  const movs = S.lista('movimentos').filter(m => itens.some(i => i.id === m.pedido_item_id)).sort((a, b) => b.seq - a.seq)
  const contas = Perm.pode('financeiro') ? S.lista('lancamentos').filter(l => l.pedido_id === p.id) : []
  const atraso = aberto && p.prazo && p.prazo < U.hoje() ? U.dias(p.prazo, U.hoje()) : 0
  return <>
    <Voltar para="#/compras" txt="Pedidos de compra" />
    <header className="cab"><div><h1>Pedido nº {p.numero} <Tag s={sit} /></h1>
      <p className="sub"><a href={'#/fornecedor/' + p.fornecedor_id}>{f?.nome || ''}</a> · pedido em {U.data(p.data)}{p.prazo ? ` · entrega combinada ${U.data(p.prazo)}` : ''}{p.recebido_em ? ` · recebido em ${U.data(p.recebido_em)}` : ''}</p></div>
      <div className="acoes">
        {aberto && <Btn txt="Receber" icone="entrada" cls="pri" data-p="receber" onClick={() => void receber(p)} />}
        <Btn txt="PDF" icone="imprimir" data-p="pdf" onClick={async () => entregar(await pdfPedido(p), `Pedido de compra ${p.numero} - ${f?.nome || ''}.pdf`)} />
        <Btn txt="Enviar" icone="whatsapp" data-p="enviar" onClick={() => void enviar(p)} />
        {aberto && <Btn txt="Editar" icone="lapis" data-p="editar" onClick={() => void form({ pedido: p })} />}
        <Btn txt="Duplicar" icone="copiar" cls="fantasma" data-p="duplicar" onClick={() => void form({ fornecedor_id: p.fornecedor_id, itens: itens.map(i => ({ peca: S.get('pecas', i.peca_id), qtd: i.qtd, preco: i.valor / i.qtd })) })} />
        {aberto && <Btn txt={recebeu ? 'Encerrar' : 'Cancelar'} icone="x" cls="fantasma" data-p="cancelar" onClick={() => void cancelar(p)} />}
        {!aberto && pendente && <Btn txt="Reabrir" icone="desfazer" cls="fantasma" data-p="reabrir" onClick={async () => { await API.rpc('reabrir_pedido', { p_id: p.id }); await App.gravou(['pedidos_compra']); aviso('Pedido reaberto.') }} />}
      </div></header>
    {atraso > 0 && <p className="nota vermelha">Atrasado há {U.plural(atraso, 'dia')}. {f && (f.celular || f.telefone) ? `Ligue ou mande mensagem para ${f.contato || f.nome}: ${U.tel(f.celular || f.telefone)}.` : ''}</p>}
    <section className="card mt"><div className="tabela-caixa"><table className="tabela cartoes">
      <thead><tr><th>Código</th><th>Descrição</th><th className="num">Pedido</th><th className="num">Chegou</th><th className="num">Falta</th><th className="num">Preço</th><th className="num">Total</th></tr></thead>
      <tbody>{itens.map(i => { const pc = S.get('pecas', i.peca_id); const falta = Math.max(0, i.qtd - i.recebido)
        return <tr key={i.id}><td data-r="Código" className="titulo mono"><a href={'#/peca/' + i.peca_id}>{pc?.codigo || ''}</a></td><td data-r="Descrição">{pc?.descricao || ''}</td>
          <td data-r="Pedido" className="num">{U.qtd(i.qtd)}</td><td data-r="Chegou" className="num">{U.qtd(i.recebido)}</td>
          <td data-r="Falta" className="num" style={falta && p.status !== 'cancelado' ? { color: 'var(--vermelho)', fontWeight: 700 } : undefined}>{U.qtd(falta)}</td>
          <td data-r="Preço" className="num">{U.moeda(i.valor / i.qtd)}</td><td data-r="Total" className="num">{U.moeda(i.valor)}</td></tr> })}</tbody>
      <tfoot>{p.frete ? <tr><td colSpan={6} className="dir">Frete</td><td className="num">{U.moeda(p.frete)}</td></tr> : null}<tr><td colSpan={6} className="dir">Total do pedido</td><td className="num">{U.moeda(C.totalPedido(p))}</td></tr></tfoot>
    </table></div>
      <Dl pares={[['Documento / referência', p.documento || ''], ['Observações', p.obs ? <Texto t={p.obs} /> : ''], ['Lançado por', S.nomeUsuario(p.criado_por)]]} /></section>
    {movs.length > 0 && <section className="card mt"><div className="card-cab"><h2>Recebimentos</h2></div><div className="lista">{movs.map(m => <LinhaMov key={m.id} m={m} />)}</div></section>}
    {Perm.pode('financeiro') && <section className="card mt"><div className="card-cab"><h2>Contas a pagar deste pedido</h2>
      <Btn txt="Lançar conta" icone="mais" cls="sec mini" data-p="conta" onClick={() => void formConta({ tipo: 'pagar', descricao: 'Compra - pedido nº ' + p.numero, categoria: 'Compras / almoxarifado', valor: C.totalPedido(p), fornecedor_id: p.fornecedor_id, pedido_id: p.id, documento: p.documento })} /></div>
      {contas.length ? <div className="lista">{contas.map(l => <LinhaConta key={l.id} l={l} />)}</div> : <p className="sub">{p.status === 'recebido' ? 'Nenhuma conta lançada para este pedido.' : 'A conta pode ser lançada ao receber.'}</p>}</section>}
  </>
}

async function cancelar(p: PedidoCompra) {
  const recebeu = C.itensDoPedido(p.id).some(i => i.recebido > 0)
  await modal({
    titulo: recebeu ? `Encerrar o pedido nº ${p.numero}` : `Cancelar o pedido nº ${p.numero}`,
    corpo: <><p>{recebeu ? 'Parte do pedido já chegou. Encerrar fecha o pedido com o que chegou; o resto deixa de ser esperado.' : 'O pedido fica marcado como cancelado (não é apagado).'}</p>
      <Campo nome="motivo" rotulo="Motivo (opcional)" placeholder="Ex.: fornecedor sem estoque" /></>,
    botoes: [{ txt: recebeu ? 'Encerrar pedido' : 'Cancelar pedido', cls: 'perigo', acao: async (f) => {
      await API.rpc('cancelar_pedido', { p_id: p.id, p_motivo: lerForm(f).motivo || null })
      await App.gravou(['pedidos_compra'])
      aviso(recebeu ? 'Pedido encerrado.' : 'Pedido cancelado.')
    } }],
    fecharTxt: 'Voltar',
  })
}

// texto para WhatsApp / e-mail
function textoPedido(p: PedidoCompra): string {
  const f = S.get('fornecedores', p.fornecedor_id), emp = S.cfg<{ nome?: string }>('empresa', {})
  return `Olá${f?.contato ? ', ' + f.contato.split(' ')[0] : ''}! Segue o pedido de compra nº ${p.numero} da ${emp.nome || 'JAF Metal'}:\n\n` +
    C.itensDoPedido(p.id).map(i => { const pc = S.get('pecas', i.peca_id); return `• ${U.qtd(i.qtd)} ${pc?.unidade || 'un'} — ${pc?.codigo} (${pc?.descricao})${i.valor ? ' — ' + U.moeda(i.valor / i.qtd) + ' cada' : ''}` }).join('\n') +
    `\n\nTotal: ${U.moeda(C.totalPedido(p))}${p.prazo ? `\nEntrega combinada: ${U.data(p.prazo)}` : ''}${p.documento ? `\nReferência: ${p.documento}` : ''}\n\nPor favor, confirme o recebimento e informe o nº ${p.numero} na nota fiscal. Obrigado!`
}
export async function enviar(p: PedidoCompra | null): Promise<void> {
  if (!p) return
  const f = S.get('fornecedores', p.fornecedor_id)
  const txt = textoPedido(p)
  const zap = U.telZap(U.ehCelular(f?.celular) ? f?.celular : (U.ehCelular(f?.telefone) ? f?.telefone : f?.celular || ''))
  await modal({
    titulo: 'Enviar pedido ao fornecedor',
    corpo: <>
      <p className="sub">O PDF é o jeito mais completo. Se preferir, mande o texto abaixo.</p>
      <div className="grupo-btn">
        <Btn txt="PDF do pedido" icone="imprimir" cls="pri" data-e="pdf" onClick={async () => entregar(await pdfPedido(p), `Pedido de compra ${p.numero} - ${f?.nome || ''}.pdf`)} />
        {zap && <a className="btn sec" target="_blank" rel="noopener" href={`https://wa.me/${zap}?text=${encodeURIComponent(txt)}`}><Ic n="whatsapp" /><span>WhatsApp</span></a>}
        {f?.email && <a className="btn sec" href={`mailto:${f.email}?subject=${encodeURIComponent('Pedido de compra nº ' + p.numero)}&body=${encodeURIComponent(txt)}`}><Ic n="email" /><span>E-mail</span></a>}
        <Btn txt="Copiar texto" icone="copiar" data-e="copiar" onClick={async () => aviso((await U.copiar(txt)) ? 'Texto copiado.' : 'Não deu para copiar.')} />
      </div>
      {!zap && !f?.email && <p className="nota amarela mt">Cadastre o celular ou o e-mail do fornecedor para enviar direto.</p>}
      <pre className="texto-pre mt">{txt}</pre>
    </>,
  })
}

// ---------------------------------------------------------------- formulário (novo / editar)
interface ItemIni { id?: string; peca: Peca | null; qtd?: number | null; preco?: number | null; recebido?: number }
interface OptForm { pedido?: PedidoCompra; fornecedor_id?: string | null; itens?: ItemIni[] }
interface Linha { k: number; id: string; peca: Peca | null; qtd: string; preco: string; recebido: number }
let kLinha = 0
const novaLinha = (it: ItemIni = { peca: null }): Linha => ({ k: ++kLinha, id: it.id || '', peca: it.peca, qtd: it.qtd ? U.campoNum(it.qtd, 3) : '', preco: it.preco ? U.campoPreco(it.preco) : '', recebido: it.recebido || 0 })

export async function form(opt: OptForm = {}): Promise<{ id: string; numero: number } | null> {
  const ed = opt.pedido
  const itensIni: ItemIni[] = ed ? C.itensDoPedido(ed.id).map(i => ({ id: i.id, peca: S.get('pecas', i.peca_id), qtd: i.qtd, preco: i.valor / i.qtd, recebido: i.recebido })) : (opt.itens || [])
  const r = await modal<{ id: string; numero: number }>({
    titulo: ed ? `Editar pedido nº ${ed.numero}` : 'Novo pedido de compra', largura: 'larga',
    corpo: <FormPedido ed={ed} fornIni={S.get('fornecedores', ed?.fornecedor_id || opt.fornecedor_id)} itensIni={itensIni} />,
    botoes: [{ txt: ed ? 'Salvar pedido' : 'Criar pedido', acao: async (f) => {
      const d = lerForm(f)
      const itens = [...f.querySelectorAll<HTMLElement>('.item-ped')].map(rw => { const inp = rw.querySelector<HTMLInputElement>('[name=ipeca]')!
        return { id: rw.dataset.item || null, peca_id: inp.dataset.comboId || '', qtd: U.num(rw.querySelector<HTMLInputElement>('[name=iqtd]')!.value), preco: U.num(rw.querySelector<HTMLInputElement>('[name=ipreco]')!.value), txt: inp.value } })
      const bad = itens.find(i => i.txt && !i.peca_id)
      if (bad) throw new ErroApp(`A peça “${bad.txt}” não foi encontrada. Escolha da lista ou cadastre a peça antes.`)
      const validos = itens.filter(i => i.peca_id)
      if (!validos.length) throw new ErroApp('Coloque pelo menos uma peça.')
      const semQtd = validos.find(i => !((i.qtd ?? 0) > 0)); if (semQtd) throw new ErroApp(`Informe a quantidade de ${S.get('pecas', semQtd.peca_id)?.codigo}.`)
      const rep = validos.find((i, n) => validos.findIndex(x => x.peca_id === i.peca_id) !== n)
      if (rep) throw new ErroApp(`A peça ${S.get('pecas', rep.peca_id)?.codigo} está duas vezes. Junte numa linha só.`)
      if (!f.dataset.envio) f.dataset.envio = ed?.id || U.uuid()
      const res = await API.rpc<{ id: string; numero: number }>('salvar_pedido', { p: { id: f.dataset.envio, data: d.data, fornecedor_id: d.fornecedor_id, documento: d.documento || null, prazo: d.prazo || null,
        frete: d.frete || 0, obs: d.obs || (ed?.obs === 'Importado da planilha' ? ed.obs : null),
        itens: validos.map(i => ({ id: i.id, peca_id: i.peca_id, qtd: i.qtd, valor: U.r2((i.qtd || 0) * (i.preco || 0)) })) } })
      await App.gravou(['pedidos_compra', 'pedido_itens'], { inteira: ['pedido_itens'] })
      aviso(ed ? 'Pedido salvo.' : `Pedido nº ${res.numero} criado.`)
      return res
    } }],
  })
  if (r && !ed) { location.hash = '#/pedido/' + r.id; setTimeout(() => void enviar(S.get('pedidos_compra', r.id)), 400) }
  return r
}

function FormPedido({ ed, fornIni, itensIni }: { ed?: PedidoCompra; fornIni: Fornecedor | null; itensIni: ItemIni[] }) {
  const j = useJanela()
  const [fornId, setFornId] = useState(fornIni?.id || '')
  const [linhas, setLinhas] = useState<Linha[]>(() => itensIni.length ? itensIni.map(novaLinha) : [novaLinha()])
  const [data, setData] = useState(ed?.data || U.hoje())
  const [prazo, setPrazo] = useState(ed?.prazo || '')
  const [frete, setFrete] = useState(U.campoNum(ed?.frete))
  const focar = useRef<number | null>(null)
  useEffect(() => { if (focar.current) { document.querySelector<HTMLInputElement>(`.item-ped[data-k="${focar.current}"] [name=ipeca]`)?.focus(); focar.current = null } })

  const mudar = (k: number, m: Partial<Linha>) => setLinhas(ls => ls.map(l => l.k === k ? { ...l, ...m } : l))
  const faltando = fornId ? C.listaCompras().filter(x => !x.jaPedido && x.peca.fornecedor_id === fornId) : []
  const total = (U.num(frete) || 0) + U.soma(linhas, l => (U.num(l.qtd) || 0) * (U.num(l.preco) || 0))
  const sujar = () => { if (j.form) j.form.dataset.sujo = '1' }

  return <>
    <div className="linha-campos">
      <div style={{ gridColumn: 'span 2' }}><ComboFornecedor id="pForn" nome="fornecedor_id" rotulo="Fornecedor" req placeholder="Digite para buscar" inicial={fornIni}
        aoEscolher={(x) => setFornId(x.id)} aoLimpar={() => setFornId('')} /></div>
      <div className="campo"><label htmlFor="pData">Data do pedido</label><input id="pData" name="data" type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
    </div>
    <div className="linha-campos">
      <Campo nome="documento" rotulo="Proposta / referência" valor={ed?.documento} placeholder="Ex.: Proposta 51850, WhatsApp, pedido online…" />
      <div className="campo"><label htmlFor="pPrazo">Entrega combinada</label><input id="pPrazo" name="prazo" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
        <div className="grupo-btn" style={{ marginTop: 6 }}>{[3, 7, 15, 30].map(d => <button key={d} type="button" className="btn fantasma mini" data-prazo={d}
          onClick={() => { setPrazo(U.somaDias(data || U.hoje(), d)); sujar() }}>+{d} dias</button>)}</div></div>
    </div>
    <h3 className="mt">Peças</h3>
    <div className="itens-ped" id="pItens">{linhas.map(l => <LinhaItem key={l.k} l={l} fornId={fornId} mudar={(m) => mudar(l.k, m)}
      tirar={() => setLinhas(ls => { const r = ls.filter(x => x.k !== l.k); return r.length ? r : [novaLinha()] })} />)}</div>
    <div className="grupo-btn">
      <button type="button" className="btn sec mini" data-add onClick={() => { const n = novaLinha(); focar.current = n.k; setLinhas(ls => [...ls, n]) }}><Ic n="mais" /><span>Adicionar peça</span></button>
      <button type="button" className="btn fantasma mini" data-sug hidden={!faltando.length} onClick={() => {
        const ja = new Set(linhas.map(l => l.peca?.id).filter(Boolean))
        const novas = faltando.filter(x => !ja.has(x.peca.id)).map(x => { const u = C.ultimaEntrada(x.peca.id, fornId) || C.ultimaEntrada(x.peca.id); return novaLinha({ peca: x.peca, qtd: x.sugerido, preco: u?.preco_unit }) })
        setLinhas(ls => [...ls.filter(l => l.peca), ...novas]); sujar()
      }}><Ic n="lista" /><span>Pôr o que está faltando deste fornecedor ({faltando.length})</span></button>
    </div>
    <div className="linha-campos mt">
      <div className="campo"><label htmlFor="pFrete">Frete</label><div className="prefixo"><span>R$</span><input id="pFrete" name="frete" inputMode="decimal" autoComplete="off" data-num="dinheiro" value={frete} onChange={(e) => setFrete(e.target.value)} /></div></div>
      <Campo nome="obs" rotulo="Observações" valor={ed?.obs && ed.obs !== 'Importado da planilha' ? ed.obs : ''} />
    </div>
    <div className="total-linha"><span>Total do pedido</span><b id="pTotal">{U.moeda(total)}</b></div>
  </>
}

function LinhaItem({ l, fornId, mudar, tirar }: { l: Linha; fornId: string; mudar: (m: Partial<Linha>) => void; tirar: () => void }) {
  const combo = useRef<ComboApi<Peca>>(null)
  const qtdRef = useRef<HTMLInputElement>(null)
  const p = l.peca ? S.get('pecas', l.peca.id) : null
  const s = p ? C.sugestao(p) : null
  const q = U.num(l.qtd) || 0, v = U.num(l.preco) || 0
  return <div className="item-ped" data-item={l.id} data-k={l.k}>
    <ComboPeca ref={combo} nome="ipeca" rotulo="Peça" placeholder="Código ou nome" inicial={l.peca} readOnly={l.recebido > 0}
      aoEscolher={(x) => {
        const u = C.ultimaEntrada(x.id, fornId) || C.ultimaEntrada(x.id)
        const sug = C.sugestao(x).sugerido
        mudar({ peca: x, preco: l.preco || (u ? U.campoPreco(u.preco_unit) : ''), qtd: l.qtd || (sug ? U.campoNum(sug, 3) : '') })
        setTimeout(() => qtdRef.current?.focus(), 30)
      }}
      aoLimpar={() => mudar({ peca: null })} />
    <div className="campo"><label>Qtd</label><input ref={qtdRef} name="iqtd" inputMode="decimal" data-num="qtd" value={l.qtd} onChange={(e) => mudar({ qtd: e.target.value })} /></div>
    <div className="campo"><label>Preço unit.</label><div className="prefixo"><span>R$</span><input name="ipreco" inputMode="decimal" data-num="dinheiro" value={l.preco} onChange={(e) => mudar({ preco: e.target.value })} /></div></div>
    <button type="button" className="icone-btn" data-del aria-label="Tirar a peça" disabled={l.recebido > 0} title={l.recebido > 0 ? 'Já chegou: não dá para tirar' : undefined} onClick={tirar}><Ic n="lixo" /></button>
    <div className="info"><span className="iinfo">{p && s ? `Estoque ${U.qtd(p.estoque)} · mín ${U.qtd(p.est_min)} · máx ${U.qtd(p.est_max)}${s.pendente ? ' · ' + U.qtd(s.pendente) + ' já a caminho' : ''}${l.recebido > 0 ? ' · já chegaram ' + U.qtd(l.recebido) : ''}` : ''}</span> <b className="itot">{q && v ? '= ' + U.moeda(q * v) : ''}</b></div>
  </div>
}

// ---------------------------------------------------------------- receber
export async function receber(p: PedidoCompra | null): Promise<void> {
  if (!p) return
  const fin = Perm.pode('financeiro')
  await modal({
    titulo: `Receber pedido nº ${p.numero}`, largura: 'larga',
    corpo: <FormReceber p={p} />,
    botoes: [{ txt: 'Confirmar recebimento', icone: 'ok', acao: async (f) => {
      const d = lerForm(f)
      const its = [...f.querySelectorAll<HTMLInputElement>('.rec')].map(i => ({ item_id: i.dataset.item!, qtd: U.num(i.value) || 0, falta: Number(i.dataset.falta) }))
      const mais = its.find(i => i.qtd > i.falta)
      if (mais && !(await confirmar('Chegou mais do que faltava em alguma peça. Confirmar assim mesmo?', { ok: 'Sim, chegou a mais' }))) return false
      if (its.some(i => i.qtd < 0)) throw new ErroApp('Quantidade negativa não vale.')
      if (!its.some(i => i.qtd > 0) && !d.encerrar) throw new ErroApp('Informe quanto chegou de pelo menos uma peça.')
      if (!f.dataset.envio) f.dataset.envio = U.uuid()
      const conta = fin && d.lancar && d.cvalor > 0 ? { valor: d.cvalor, vencimento: d.cvenc, parcelas: d.cparc, intervalo: '30' } : null
      const r = await API.rpc<{ status: string }>('receber_pedido', { p: { pedido_id: p.id, chave: f.dataset.envio, data: d.data, documento: d.documento || null,
        itens: its.filter(i => i.qtd > 0).map(({ item_id, qtd }) => ({ item_id, qtd })), encerrar: !!d.encerrar, conta } })
      await App.gravou(['pecas', 'movimentos', 'pedidos_compra', 'pedido_itens', 'lancamentos'], { inteira: ['pedido_itens'] })
      aviso(r.status === 'recebido' ? `Pedido nº ${p.numero} recebido e estoque atualizado.` : 'Recebimento lançado. O resto continua aguardando.')
    } }],
  })
}

function FormReceber({ p }: { p: PedidoCompra }) {
  const fin = Perm.pode('financeiro')
  // a lista de peças é a do momento em que a janela abriu (não muda enquanto a pessoa confere)
  const [itens] = useState(() => C.itensDoPedido(p.id).filter(i => i.recebido < i.qtd))
  const [jaTemConta] = useState(() => S.lista('lancamentos').some(l => l.pedido_id === p.id))
  const [primeiraVez] = useState(() => !C.itensDoPedido(p.id).some(i => i.recebido > 0))
  const [chegou, setChegou] = useState<Record<string, string>>(() => Object.fromEntries(itens.map(i => [i.id, U.campoNum(i.qtd - i.recebido, 3)])))
  const [lancar, setLancar] = useState(!jaTemConta)
  const [cvalor, setCvalor] = useState<string | null>(null) // null = acompanha o total
  let total = 0, parcial = false
  for (const i of itens) { const n = U.num(chegou[i.id]) || 0; total += n * (i.valor / i.qtd); if (n < i.qtd - i.recebido) parcial = true }
  total = U.r2(total + (primeiraVez ? Number(p.frete) || 0 : 0))
  return <>
    <p className="sub">{S.get('fornecedores', p.fornecedor_id)?.nome || ''}. Confira cada peça. Se chegou só uma parte, mude a quantidade — o resto continua aguardando.</p>
    <div className="tabela-caixa"><table className="tabela"><thead><tr><th>Peça</th><th className="num">Falta</th><th className="num" style={{ width: 130 }}>Chegou agora</th></tr></thead>
      <tbody>{itens.map(i => { const pc = S.get('pecas', i.peca_id); const falta = i.qtd - i.recebido
        return <tr key={i.id}><td><b className="mono">{pc?.codigo}</b><div className="peq">{pc?.descricao} · {U.moeda(i.valor / i.qtd)} cada</div></td><td className="num">{U.qtd(falta)}</td>
          <td className="num"><input className="rec" data-item={i.id} data-falta={falta} data-preco={i.valor / i.qtd} inputMode="decimal" value={chegou[i.id]} aria-label={'Chegou de ' + pc?.codigo}
            onChange={(e) => setChegou(c => ({ ...c, [i.id]: e.target.value }))}
            style={{ width: '100%', minHeight: 40, textAlign: 'right', border: '1px solid var(--borda-forte)', borderRadius: 6, padding: '4px 8px', font: 'inherit', fontSize: 16, background: 'var(--cartao)', color: 'var(--texto)' }} /></td></tr> })}</tbody></table></div>
    <div className="linha-campos mt">
      <Campo nome="documento" rotulo="Nota fiscal" placeholder={p.documento ? 'Em branco = ' + p.documento : 'Ex.: NF 000.044.892'} />
      <Campo nome="data" rotulo="Data que chegou" tipo="date" valor={U.hoje()} attrs={{ max: U.hoje() }} />
    </div>
    <div id="rParcial">{parcial && <Campo nome="encerrar" rotulo="Não vai chegar o resto: encerrar o pedido assim mesmo" tipo="check" />}</div>
    {fin ? <div className="card mt" style={{ background: 'var(--cartao-2)' }}>
      <label className="check"><input type="checkbox" name="lancar" checked={lancar} onChange={(e) => setLancar(e.target.checked)} /> <span>Lançar a conta a pagar agora</span></label>
      <div id="rConta" className="linha-campos l3" hidden={!lancar}>
        <div className="campo"><label htmlFor="rcValor">Valor</label><div className="prefixo"><span>R$</span><input id="rcValor" name="cvalor" inputMode="decimal" autoComplete="off" data-num="dinheiro"
          value={cvalor ?? U.campoNum(total)} onChange={(e) => setCvalor(e.target.value)} /></div></div>
        <Campo nome="cvenc" rotulo="1º vencimento" tipo="date" valor={U.somaDias(U.hoje(), 30)} />
        <Campo nome="cparc" rotulo="Parcelas" tipo="select" opcoes={[1, 2, 3, 4, 5, 6].map(n => ({ v: n, t: n === 1 ? 'À vista / 1×' : n + '× (a cada 30 dias)' }))} />
      </div>{jaTemConta && <p className="sub">Este pedido já tem conta lançada.</p>}</div>
      : <p className="sub mt">A conta a pagar é lançada pelo escritório.</p>}
    <p className="mt">Valor recebendo agora: <b id="rTotal">{U.moeda(total)}</b></p>
  </>
}

// ---------------------------------------------------------------- lista de compras
function ListaCompras() {
  const [verMinimo, setVerMinimo] = useLembrar('compras.minimo', false)
  const lc = C.listaCompras()
  const pedir = lc.filter(x => !x.jaPedido), ja = lc.filter(x => x.jaPedido)
  const minimo: ItemCompra[] = verMinimo ? S.lista('pecas').filter(p => p.ativo && C.situacao(p).cod === 'minimo').map(p => ({ peca: p, ...C.sugestao(p), jaPedido: false })).filter(x => x.sugerido > 0) : []
  const grupos = U.agrupar([...pedir, ...minimo], x => x.peca.fornecedor_id || '')
  const ordem = [...grupos.keys()].sort((a, b) => (S.get('fornecedores', a)?.nome || 'zzz').localeCompare(S.get('fornecedores', b)?.nome || 'zzz', 'pt-BR'))
  const totalGeral = U.soma([...pedir, ...minimo], x => x.sugerido * (C.ultimaEntrada(x.peca.id)?.preco_unit || 0))
  const ultimo = (pid: string, fid: string) => C.ultimaEntrada(pid, fid || undefined) || C.ultimaEntrada(pid)

  const gerar = (fid: string, sec: HTMLElement | null) => {
    if (!sec) return
    const itens = [...sec.querySelectorAll<HTMLInputElement>('.sel:checked')].map(c => { const p = S.get('pecas', c.dataset.peca!)!
      return { peca: p, qtd: U.num(sec.querySelector<HTMLInputElement>(`.qtdc[data-peca="${p.id}"]`)!.value), preco: ultimo(p.id, fid)?.preco_unit } }).filter(i => (i.qtd ?? 0) > 0)
    if (!itens.length) { aviso('Marque pelo menos uma peça com quantidade.', 'erro'); return }
    void form({ fornecedor_id: fid || null, itens })
  }
  return <>
    <Voltar para="#/compras" txt="Pedidos de compra" />
    <Cab titulo="Lista de compras" sub={<>Peças abaixo do mínimo. A sugestão completa até o máximo, já descontando o que está a caminho. Estimativa: <b>{U.moeda0(totalGeral)}</b>.</>}>
      <Btn txt="PDF" icone="imprimir" data-l="pdf" onClick={() => exportarLista('pdf')} />
      <Btn txt="Excel" icone="baixar" data-l="excel" onClick={() => exportarLista('excel')} />
    </Cab>
    <label className="check"><input type="checkbox" name="verMinimo" checked={verMinimo} onChange={(e) => setVerMinimo(e.target.checked)} /> <span>Mostrar também as que estão exatamente no mínimo</span></label>
    {!ordem.length ? <Vazio icone="ok" titulo="Nada para comprar" texto="Nenhuma peça está abaixo do mínimo agora." /> : ordem.map(fid => {
      const f = S.get('fornecedores', fid), itens = grupos.get(fid)!
      const tot = U.soma(itens, x => x.sugerido * (ultimo(x.peca.id, fid)?.preco_unit || 0))
      return <section key={fid + itens.length} className="card mt" data-grupo={fid}><div className="card-cab"><h2>{f ? <a href={'#/fornecedor/' + f.id}>{f.nome}</a> : 'Sem fornecedor definido'} <span className="sub">· {U.plural(itens.length, 'peça')} · ≈ {U.moeda0(tot)}</span></h2>
        <button type="button" className="btn pri mini" data-gerar={fid} onClick={(e) => gerar(fid, e.currentTarget.closest('[data-grupo]'))}><Ic n="compras" /><span>Gerar pedido</span></button></div>
        <div className="tabela-caixa"><table className="tabela cartoes"><thead><tr><th style={{ width: 34 }}></th><th>Peça</th><th className="num">Estoque</th><th className="num">Mín / Máx</th><th className="num">A caminho</th><th className="num">Comprar</th><th className="num">Último preço</th></tr></thead>
          <tbody>{itens.map(x => { const u = ultimo(x.peca.id, fid)
            return <tr key={x.peca.id}><td data-r="Incluir"><input type="checkbox" className="sel" data-peca={x.peca.id} defaultChecked aria-label={'Incluir ' + x.peca.codigo} style={{ width: 20, height: 20, accentColor: 'var(--marca)' }} /></td>
              <td data-r="Peça" className="titulo"><a className="mono" href={'#/peca/' + x.peca.id}>{x.peca.codigo}</a><div className="peq">{x.peca.descricao}{x.peca.utilizacao ? ' · ' + x.peca.utilizacao : ''}</div></td>
              <td data-r="Estoque" className="num" style={{ color: 'var(--vermelho)', fontWeight: 700 }}>{U.qtd(x.peca.estoque)}</td><td data-r="Mín / Máx" className="num">{U.qtd(x.peca.est_min)} / {U.qtd(x.peca.est_max)}</td>
              <td data-r="A caminho" className="num">{x.pendente ? U.qtd(x.pendente) : '—'}</td>
              <td data-r="Comprar" className="num"><input className="qtdc" data-peca={x.peca.id} inputMode="decimal" defaultValue={U.campoNum(x.sugerido, 3)} aria-label={'Quantidade de ' + x.peca.codigo}
                style={{ width: 80, minHeight: 36, textAlign: 'right', border: '1px solid var(--borda-forte)', borderRadius: 6, padding: '2px 8px', font: 'inherit', fontSize: 16, background: 'var(--cartao)', color: 'var(--texto)' }} /></td>
              <td data-r="Último preço" className="num">{u ? U.moeda(u.preco_unit) : '—'}</td></tr> })}</tbody></table></div></section>
    })}
    {ja.length > 0 && <section className="card mt"><div className="card-cab"><h2>Já pedidas, aguardando chegar</h2></div><div className="lista">{ja.map(x => <a key={x.peca.id} className="linha" href={'#/peca/' + x.peca.id}>
      <div className="meio"><b><span className="codigo">{x.peca.codigo}</span> · {x.peca.descricao}</b><small>estoque {U.qtd(x.peca.estoque)} · mínimo {U.qtd(x.peca.est_min)}</small></div>
      <div className="lado"><b>{U.qtd(x.pendente)}</b><small>a caminho</small></div></a>)}</div></section>}
  </>
}

async function exportarLista(tipo: 'pdf' | 'excel') {
  const lc = C.listaCompras().filter(x => !x.jaPedido)
  if (tipo === 'excel') {
    return excel(`Lista de compras JAF ${U.hoje()}.xlsx`, [['Lista de Compras', lc.map(x => { const u = C.ultimaEntrada(x.peca.id); return { 'Fornecedor': S.get('fornecedores', x.peca.fornecedor_id)?.nome || '', 'Código': x.peca.codigo, 'Descrição': x.peca.descricao,
      'Estoque': x.peca.estoque, 'Mínimo': x.peca.est_min, 'Máximo': x.peca.est_max, 'A caminho': x.pendente, 'Comprar': x.sugerido, 'Último preço': u?.preco_unit || null, 'Estimativa (R$)': U.r2(x.sugerido * (u?.preco_unit || 0)) } })]])
  }
  const col: ColunaPdf[] = [{ t: 'Código', w: 40, mono: true }, { t: 'Descrição' }, { t: 'Estoque', w: 16, alinhar: 'right' }, { t: 'Mín/Máx', w: 20, alinhar: 'right' }, { t: 'A caminho', w: 18, alinhar: 'right' }, { t: 'Comprar', w: 18, alinhar: 'right' }, { t: 'Último preço', w: 24, alinhar: 'right' }]
  const blob = await pdfTabela('Lista de compras', `Peças abaixo do mínimo em ${U.data(U.hoje())}`, col, [], {
    grupos: [...U.agrupar(lc, x => x.peca.fornecedor_id || '').entries()].map(([fid, itens]) => ({ titulo: S.get('fornecedores', fid)?.nome || 'Sem fornecedor definido',
      linhas: itens.map(x => [x.peca.codigo, x.peca.descricao, U.qtd(x.peca.estoque), `${U.qtd(x.peca.est_min)}/${U.qtd(x.peca.est_max)}`, x.pendente ? U.qtd(x.pendente) : '—', U.qtd(x.sugerido), U.moeda(C.ultimaEntrada(x.peca.id)?.preco_unit)]) })) })
  return entregar(blob, `Lista de compras JAF ${U.hoje()}.pdf`)
}
