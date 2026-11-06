/* Compra de matéria-prima: pedido de compra com prévia antes do PDF e necessidade lançada pelo PCP.
   Lições do Upgrade aplicadas: o recebimento é ligado ao item do pedido (não a datas), o mesmo toque não grava duas vezes,
   a prévia mostra exatamente o que vai para o fornecedor, e nada some quando um pedido é cancelado. */
import { useEffect, useRef, useState } from 'react'
import { App } from '../../app/controle.tsx'
import { API, ErroApp } from '../../lib/api.ts'
import { C, S } from '../../lib/dados.ts'
import type { Fornecedor, Necessidade, PedidoCompra, Produto } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { aviso } from '../../ui/avisos.ts'
import { verPedido } from '../../ui/arquivos.tsx'
import { Campo } from '../../ui/base.tsx'
import { ComboFornecedor } from '../../ui/Combo.tsx'
import { Ic } from '../../ui/icones.tsx'
import { confirmar, lerForm, modal, useJanela } from '../../ui/janelas.tsx'
import { ComboProduto } from './comum.tsx'

// ---------------------------------------------------------------- ajudas
// último preço pago pelo material (do mesmo fornecedor, se tiver)
export function ultimoPrecoMP(produtoId: string, fornId?: string | null): number | null {
  let melhor: { data: string; preco: number } | null = null
  for (const i of S.lista('pedido_itens')) {
    if (i.produto_id !== produtoId || !(i.qtd > 0) || !(i.valor > 0)) continue
    const p = S.get('pedidos_compra', i.pedido_id)
    if (!p || p.status === 'cancelado' || (fornId && p.fornecedor_id !== fornId)) continue
    if (!melhor || p.data > melhor.data) melhor = { data: p.data, preco: i.valor / i.qtd }
  }
  return melhor ? U.r4(melhor.preco) : (fornId ? ultimoPrecoMP(produtoId) : null)
}
// de quem o material costuma ser comprado (último pedido ou último R.I.)
export function ultimoFornecedorMP(produtoId: string): string | null {
  let melhor: { data: string; id: string } | null = null
  for (const i of S.lista('pedido_itens')) {
    if (i.produto_id !== produtoId) continue
    const p = S.get('pedidos_compra', i.pedido_id)
    if (p && p.status !== 'cancelado' && (!melhor || p.data > melhor.data)) melhor = { data: p.data, id: p.fornecedor_id }
  }
  for (const l of S.lista('mp_lotes')) if (l.produto_id === produtoId && l.fornecedor_id && (!melhor || l.data > melhor.data)) melhor = { data: l.data, id: l.fornecedor_id }
  return melhor?.id || null
}

// ---------------------------------------------------------------- pedido de compra de matéria-prima
export interface ItemMP { produto_id: string; qtd?: number | null; preco?: number | null }
interface OptMP { pedido?: PedidoCompra; fornecedor_id?: string | null; itens?: ItemMP[]; necessidades?: string[]; titulo?: string }
interface Linha { k: number; id: string; mat: Produto | null; qtd: string; preco: string; recebido: number }
let kLinha = 0
const novaLinha = (it: { id?: string; mat: Produto | null; qtd?: number | null; preco?: number | null; recebido?: number } = { mat: null }): Linha =>
  ({ k: ++kLinha, id: it.id || '', mat: it.mat, qtd: it.qtd ? U.campoNum(it.qtd, 3) : '', preco: it.preco ? U.campoPreco(it.preco) : '', recebido: it.recebido || 0 })

interface Rascunho { fornecedor: Fornecedor | null; data: string; prazo: string; documento: string; frete: number; obs: string; itens: { id: string | null; mat: Produto; qtd: number; preco: number }[] }

export async function formPedidoMP(opt: OptMP = {}): Promise<{ id: string; numero: number } | null> {
  const ed = opt.pedido
  const linhasIni = ed
    ? C.itensDoPedido(ed.id).map(i => novaLinha({ id: i.id, mat: S.get('produtos', i.produto_id), qtd: i.qtd, preco: i.valor / i.qtd, recebido: i.recebido }))
    : (opt.itens || []).map(i => novaLinha({ mat: S.get('produtos', i.produto_id), qtd: i.qtd, preco: i.preco ?? ultimoPrecoMP(i.produto_id, opt.fornecedor_id) }))
  const r = await modal<{ id: string; numero: number }>({
    titulo: ed ? `Editar pedido nº ${ed.numero}` : opt.titulo || 'Pedido de compra de matéria-prima', largura: 'larga',
    corpo: <FormMP ed={ed} fornIni={S.get('fornecedores', ed?.fornecedor_id || opt.fornecedor_id)} linhasIni={linhasIni} />,
    botoes: [{ txt: 'Ver prévia', icone: 'olho', cls: 'pri', acao: async (f) => {
      const d = lerForm(f)
      const forn = S.get('fornecedores', d.fornecedor_id)
      if (!forn) throw new ErroApp('Escolha o fornecedor.')
      const brutos = [...f.querySelectorAll<HTMLElement>('.item-ped')].map(rw => { const inp = rw.querySelector<HTMLInputElement>('[name=imat]')!
        return { id: rw.dataset.item || null, produto_id: inp.dataset.comboId || '', txt: inp.value,
          qtd: U.num(rw.querySelector<HTMLInputElement>('[name=iqtd]')!.value), preco: U.num(rw.querySelector<HTMLInputElement>('[name=ipreco]')!.value) } })
      const bad = brutos.find(i => i.txt && !i.produto_id)
      if (bad) throw new ErroApp(`O material “${bad.txt}” não foi encontrado. Escolha da lista.`)
      const validos = brutos.filter(i => i.produto_id)
      if (!validos.length) throw new ErroApp('Coloque pelo menos um material no pedido.')
      const nome = (id: string) => S.get('produtos', id)?.codigo || ''
      const semQtd = validos.find(i => !((i.qtd ?? 0) > 0)); if (semQtd) throw new ErroApp(`Informe a quantidade de ${nome(semQtd.produto_id)}.`)
      const rep = validos.find((i, n) => validos.findIndex(x => x.produto_id === i.produto_id) !== n)
      if (rep) throw new ErroApp(`O material ${nome(rep.produto_id)} está duas vezes. Junte numa linha só.`)
      const ras: Rascunho = { fornecedor: forn, data: d.data || U.hoje(), prazo: d.prazo || '', documento: d.documento || '', frete: Number(d.frete) || 0, obs: d.obs || '',
        itens: validos.map(i => ({ id: i.id, mat: S.get('produtos', i.produto_id)!, qtd: i.qtd || 0, preco: i.preco || 0 })) }
      const semPreco = ras.itens.filter(i => !i.preco)
      // a prévia: o que vai sair no PDF, antes de gravar
      const ok = await modal<boolean>({
        titulo: 'Prévia do pedido', largura: 'larga', fecharTxt: 'Voltar e corrigir',
        corpo: <Previa r={ras} numero={ed?.numero} semPreco={semPreco.length} />,
        botoes: [{ txt: ed ? 'Salvar e gerar PDF' : 'Gerar pedido e PDF', icone: 'imprimir', acao: () => true }],
      })
      if (!ok) return false
      if (!f.dataset.envio) f.dataset.envio = ed?.id || U.uuid()
      const res = await API.rpc<{ id: string; numero: number }>('salvar_pedido', { p: { id: f.dataset.envio, tipo: 'mp', data: ras.data, fornecedor_id: forn.id,
        documento: ras.documento || null, prazo: ras.prazo || null, frete: ras.frete, obs: ras.obs || null,
        itens: ras.itens.map(i => ({ id: i.id, produto_id: i.mat.id, qtd: i.qtd, valor: U.r2(i.qtd * i.preco) })),
        necessidades: ed ? [] : opt.necessidades || [] } })
      await App.gravou(['pedidos_compra', 'pedido_itens', 'necessidades'], { inteira: ['pedido_itens'] })
      aviso(ed ? 'Pedido salvo.' : `Pedido nº ${res.numero} criado.`)
      return res
    } }],
  })
  if (r) {
    const p = S.get('pedidos_compra', r.id)
    if (p) await verPedido(p, `Pedido de compra nº ${p.numero} gerado — confira e mande ao fornecedor`)
  }
  return r
}

function FormMP({ ed, fornIni, linhasIni }: { ed?: PedidoCompra; fornIni: Fornecedor | null; linhasIni: Linha[] }) {
  const j = useJanela()
  const [fornId, setFornId] = useState(fornIni?.id || '')
  const [linhas, setLinhas] = useState<Linha[]>(() => linhasIni.length ? linhasIni : [novaLinha()])
  const [data, setData] = useState(ed?.data || U.hoje())
  const [prazo, setPrazo] = useState(ed?.prazo || '')
  const [frete, setFrete] = useState(U.campoNum(ed?.frete))
  const focar = useRef<number | null>(null)
  useEffect(() => { if (focar.current) { document.querySelector<HTMLInputElement>(`.item-ped[data-k="${focar.current}"] [name=imat]`)?.focus(); focar.current = null } })
  const mudar = (k: number, m: Partial<Linha>) => setLinhas(ls => ls.map(l => l.k === k ? { ...l, ...m } : l))
  const total = (U.num(frete) || 0) + U.soma(linhas, l => (U.num(l.qtd) || 0) * (U.num(l.preco) || 0))
  const sujar = () => { if (j.form) j.form.dataset.sujo = '1' }
  return <>
    <div className="linha-campos">
      <div style={{ gridColumn: 'span 2' }}><ComboFornecedor id="mpForn" nome="fornecedor_id" rotulo="Fornecedor" req placeholder="Digite para buscar" inicial={fornIni}
        aoEscolher={(x) => { setFornId(x.id); setLinhas(ls => ls.map(l => l.mat && !l.preco ? { ...l, preco: U.campoPreco(ultimoPrecoMP(l.mat.id, x.id)) } : l)) }} aoLimpar={() => setFornId('')} /></div>
      <div className="campo"><label htmlFor="mpData">Data do pedido</label><input id="mpData" name="data" type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
    </div>
    <div className="linha-campos">
      <Campo nome="documento" rotulo="Proposta / referência" valor={ed?.documento} placeholder="Ex.: Orçamento 1234, WhatsApp…" />
      <div className="campo"><label htmlFor="mpPrazo">Entrega combinada</label><input id="mpPrazo" name="prazo" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
        <div className="grupo-btn" style={{ marginTop: 6 }}>{[3, 7, 15, 30].map(d => <button key={d} type="button" className="btn fantasma mini" data-prazo={d}
          onClick={() => { setPrazo(U.somaDias(data || U.hoje(), d)); sujar() }}>+{d} dias</button>)}</div></div>
    </div>
    <h3 className="mt">Materiais</h3>
    <div className="itens-ped" id="mpItens">{linhas.map(l => <LinhaMat key={l.k} l={l} fornId={fornId} mudar={(m) => mudar(l.k, m)}
      tirar={() => setLinhas(ls => { const r = ls.filter(x => x.k !== l.k); return r.length ? r : [novaLinha()] })} />)}</div>
    <div className="grupo-btn">
      <button type="button" className="btn sec mini" data-add onClick={() => { const n = novaLinha(); focar.current = n.k; setLinhas(ls => [...ls, n]) }}><Ic n="mais" /><span>Adicionar material</span></button>
    </div>
    <div className="linha-campos mt">
      <div className="campo"><label htmlFor="mpFrete">Frete</label><div className="prefixo"><span>R$</span><input id="mpFrete" name="frete" inputMode="decimal" autoComplete="off" data-num="dinheiro" value={frete} onChange={(e) => setFrete(e.target.value)} /></div></div>
      <Campo nome="obs" rotulo="Observações para o fornecedor" valor={ed?.obs || ''} placeholder="Ex.: mandar certificado do material" />
    </div>
    <div className="total-linha"><span>Total do pedido</span><b id="mpTotal">{U.moeda(total)}</b></div>
  </>
}

function LinhaMat({ l, fornId, mudar, tirar }: { l: Linha; fornId: string; mudar: (m: Partial<Linha>) => void; tirar: () => void }) {
  const qtdRef = useRef<HTMLInputElement>(null)
  const un = l.mat ? C.unidadeMP(l.mat.id) : 'kg'
  const q = U.num(l.qtd) || 0, v = U.num(l.preco) || 0
  const est = l.mat ? C.estoqueMP().get(l.mat.id) || 0 : 0, cam = l.mat ? C.pendenteMP(l.mat.id) : 0
  return <div className="item-ped" data-item={l.id} data-k={l.k}>
    <ComboProduto nome="imat" rotulo="Material" classe="mp" placeholder="Código ou descrição" inicial={l.mat} readOnly={l.recebido > 0}
      aoEscolher={(x) => { mudar({ mat: x, preco: l.preco || U.campoPreco(ultimoPrecoMP(x.id, fornId)) }); setTimeout(() => qtdRef.current?.focus(), 30) }}
      aoLimpar={() => mudar({ mat: null })} />
    <div className="campo"><label>Qtd ({un})</label><input ref={qtdRef} name="iqtd" inputMode="decimal" data-num="qtd" value={l.qtd} onChange={(e) => mudar({ qtd: e.target.value })} /></div>
    <div className="campo"><label>Preço por {un}</label><div className="prefixo"><span>R$</span><input name="ipreco" inputMode="decimal" data-num="dinheiro" value={l.preco} onChange={(e) => mudar({ preco: e.target.value })} /></div></div>
    <button type="button" className="icone-btn" data-del aria-label="Tirar o material" disabled={l.recebido > 0} title={l.recebido > 0 ? 'Já chegou: não dá para tirar' : undefined} onClick={tirar}><Ic n="lixo" /></button>
    <div className="info"><span className="iinfo">{l.mat ? `Estoque ${U.qtd(est)} ${un}${cam ? ` · ${U.qtd(cam)} ${un} já a caminho` : ''}${l.recebido > 0 ? ` · já chegaram ${U.qtd(l.recebido)} ${un}` : ''}` : ''}</span> <b className="itot">{q && v ? '= ' + U.moeda(q * v) : ''}</b></div>
  </div>
}

// a folha como vai sair no PDF
function Previa({ r, numero, semPreco }: { r: Rascunho; numero?: number; semPreco: number }) {
  const emp = S.cfg<{ nome?: string }>('empresa', {})
  const f = r.fornecedor
  const sub = U.soma(r.itens, i => i.qtd * i.preco)
  return <>
    <p className="sub">Confira antes de gerar. É isto que vai no PDF para o fornecedor.</p>
    {semPreco > 0 && <p className="nota amarela">{semPreco === 1 ? 'Um material está sem preço.' : `${semPreco} materiais estão sem preço.`} Se ainda não sabe o preço, pode gerar assim mesmo e corrigir depois.</p>}
    <div className="folha-previa" id="mpPrevia">
      <div className="fp-cab"><b>{emp.nome || 'JAF Metal'}</b><span>Pedido de compra {numero ? 'nº ' + numero : '(o número sai ao gerar)'}</span></div>
      <div className="fp-linha"><span>Data: {U.data(r.data)}</span>{r.prazo && <span>Entrega combinada: {U.data(r.prazo)}</span>}</div>
      <div className="fp-forn"><small>FORNECEDOR</small><b>{f?.razao || f?.nome}</b>
        <span>{[f?.cnpj ? 'CNPJ ' + f.cnpj : '', f?.contato ? 'Contato: ' + f.contato : '', U.tel(f?.celular || f?.telefone), f?.email || ''].filter(Boolean).join(' · ')}</span></div>
      <div className="fp-itens">{r.itens.map((i, n) => { const un = C.unidadeMP(i.mat.id)
        return <div key={i.mat.id} className="fp-item"><span className="fp-n">{n + 1}</span>
          <div className="fp-desc"><b className="mono">{i.mat.codigo}</b><small>{i.mat.descricao}</small></div>
          <div className="fp-val"><small>{U.qtd(i.qtd)} {un} × {i.preco ? U.moeda(i.preco) + '/' + un : 'sem preço'}</small><b>{U.moeda(i.qtd * i.preco)}</b></div></div> })}</div>
      <div className="fp-tot">
        {r.frete > 0 && <><span>Subtotal</span><b>{U.moeda(sub)}</b><span>Frete</span><b>{U.moeda(r.frete)}</b></>}
        <span>Total</span><b className="grande">{U.moeda(sub + r.frete)}</b>
      </div>
      {(r.documento || r.obs) && <p className="peq">{r.documento && <>Referência: {r.documento}<br /></>}{r.obs && <>Observações: {r.obs}</>}</p>}
    </div>
  </>
}

// vários materiais de fornecedores diferentes: um pedido (e um PDF) para cada fornecedor, um depois do outro
export async function pedidosPorFornecedor(lista: (ItemMP & { necessidades?: string[] })[]): Promise<number> {
  // o mesmo material escolhido duas vezes (necessidade do PCP + pedidos de clientes) vira uma linha só
  const juntos = new Map<string, ItemMP & { necessidade: string[] }>()
  for (const i of lista) {
    const j = juntos.get(i.produto_id)
    if (j) { j.qtd = U.r4((j.qtd || 0) + (i.qtd || 0)); j.necessidade.push(...(i.necessidades || [])) }
    else juntos.set(i.produto_id, { produto_id: i.produto_id, qtd: i.qtd, preco: i.preco, necessidade: [...(i.necessidades || [])] })
  }
  const itens = [...juntos.values()]
  const grupos = U.agrupar(itens, i => ultimoFornecedorMP(i.produto_id) || '')
  const ordem = [...grupos.keys()].sort((a, b) => (S.get('fornecedores', a)?.nome || 'zzz').localeCompare(S.get('fornecedores', b)?.nome || 'zzz', 'pt-BR'))
  let feitos = 0
  for (const [n, fid] of ordem.entries()) {
    const g = grupos.get(fid)!
    const r = await formPedidoMP({ fornecedor_id: fid || null, itens: g, necessidades: g.flatMap(i => i.necessidade),
      titulo: ordem.length > 1 ? `Pedido ${n + 1} de ${ordem.length}${fid ? ' — ' + (S.get('fornecedores', fid)?.nome || '') : ' — escolha o fornecedor'}` : undefined })
    if (!r) { if (n < ordem.length - 1) aviso(`Parou aqui. ${feitos ? U.plural(feitos, 'pedido feito') + '. ' : ''}O que falta continua na lista.`); break }
    feitos++
  }
  return feitos
}

// ---------------------------------------------------------------- necessidade lançada à mão (PCP)
export async function formNecessidade(ed?: Necessidade): Promise<void> {
  await modal({
    titulo: ed ? 'Editar necessidade' : 'Lançar necessidade de compra',
    corpo: <FormNec ed={ed} />,
    botoes: [{ txt: ed ? 'Salvar' : 'Mandar para o Comercial', icone: 'enviar', acao: async (f) => {
      const d = lerForm(f)
      if (!d.produto_id) throw new ErroApp('Escolha o material.')
      if (!(Number(d.qtd) > 0)) throw new ErroApp('Informe a quantidade.')
      if (!f.dataset.envio) f.dataset.envio = ed?.id || U.uuid()
      await API.rpc('salvar_necessidade', { p: { id: f.dataset.envio, produto_id: d.produto_id, qtd: d.qtd, prazo: d.prazo || null, motivo: d.motivo || null } })
      await App.gravou(['necessidades'])
      aviso(ed ? 'Necessidade salva.' : 'Necessidade lançada. O Comercial já vê na lista de compra.')
    } }],
  })
}
function FormNec({ ed }: { ed?: Necessidade }) {
  const [mat, setMat] = useState<Produto | null>(S.get('produtos', ed?.produto_id))
  const un = mat ? C.unidadeMP(mat.id) : 'kg'
  return <>
    <p className="sub">O Comercial recebe na lista “O que comprar” e faz o pedido ao fornecedor.</p>
    <ComboProduto id="nMat" nome="produto_id" rotulo="Material" classe="mp" req placeholder="Código ou descrição" inicial={mat} aoEscolher={setMat} aoLimpar={() => setMat(null)} />
    {mat && <p className="peq">Estoque: {U.qtd(C.estoqueMP().get(mat.id) || 0)} {un}{C.pendenteMP(mat.id) ? ` · ${U.qtd(C.pendenteMP(mat.id))} ${un} já em pedido de compra` : ''}</p>}
    <div className="linha-campos">
      <Campo nome="qtd" rotulo={`Quantidade (${un})`} tipo="qtd" valor={ed?.qtd} req />
      <Campo nome="prazo" rotulo="Precisa até" tipo="date" valor={ed?.prazo} />
    </div>
    <Campo nome="motivo" rotulo="Para quê / observação" valor={ed?.motivo} placeholder="Ex.: OF 1234, pedido do cliente X, estoque de segurança" />
  </>
}
export async function cancelarNecessidade(n: Necessidade): Promise<void> {
  if (!(await confirmar(`Cancelar a necessidade de ${U.qtd(n.qtd)} ${C.unidadeMP(n.produto_id)} de ${S.get('produtos', n.produto_id)?.codigo || ''}?`, { ok: 'Sim, cancelar' }))) return
  await API.rpc('cancelar_necessidade', { p_id: n.id, p_motivo: null })
  await App.gravou(['necessidades'])
  aviso('Necessidade cancelada.')
}
