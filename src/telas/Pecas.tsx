/* Estoque: lista de peças, ficha da peça, cadastro e contagem */
import { useEffect, useState, type FormEvent } from 'react'
import { App } from '../app/controle.tsx'
import { API, ErroApp, traduzir } from '../lib/api.ts'
import { C, S } from '../lib/dados.ts'
import { Perm } from '../lib/perm.ts'
import type { Peca } from '../lib/tipos.ts'
import * as U from '../lib/util.ts'
import { aviso } from '../ui/avisos.ts'
import { excel } from '../ui/arquivos.tsx'
import { BuscaLista, Btn, Cab, Campo, Chips, Paginado, Tag, Texto, Vazio, Voltar } from '../ui/base.tsx'
import { ComboFornecedor } from '../ui/Combo.tsx'
import { useLembrar, type Rota } from '../ui/ganchos.ts'
import { Ic } from '../ui/icones.tsx'
import { confirmar, lerForm, modal, useJanela } from '../ui/janelas.tsx'
import { form as formPedido } from './Compras.tsx'
import { entrada, LinhaMov, retirar } from './Movimentos.tsx'

function Medidor({ p }: { p: Peca }) {
  const ma = Number(p.est_max) || 0, mi = Number(p.est_min) || 0, e = Math.max(0, Number(p.estoque) || 0)
  const topo = Math.max(ma, mi * 2, e, 1)
  return <div className={`medidor ${C.situacao(p).cor}`} title={`mín ${U.qtd(mi)} · máx ${U.qtd(ma)}`}>
    <i style={{ width: `${Math.min(100, e / topo * 100)}%` }} />{mi > 0 && <u style={{ left: `${mi / topo * 100}%` }} />}</div>
}

export function LinhaPeca({ p }: { p: Peca }) {
  const pend = Perm.pode('compras') ? C.pendente(p.id) : 0
  return <a className="linha" href={'#/peca/' + p.id}>
    <div className="meio"><b><span className="codigo">{p.codigo}</span> · {p.descricao}</b>
      <small>{p.utilizacao || '—'}{p.local ? ' · ' + p.local : ''}{pend ? <> · <span className="fraco">{U.qtd(pend)} a caminho</span></> : null}</small></div>
    <div className="lado"><b>{U.qtd(p.estoque)} <small>{p.unidade}</small></b><Medidor p={p} /></div>
    <div className="lado esconde-celular" style={{ width: 104 }}><Tag s={C.situacao(p)} /></div></a>
}

export function TelaPecas({ r }: { r: Rota }) {
  return r.nome === 'peca' ? <Ficha id={r.id!} /> : <Lista r={r} />
}

// ---------------------------------------------------------------- lista
function Lista({ r }: { r: Rota }) {
  const [busca, setBusca] = useLembrar('pecas.busca', '')
  const [f, setF] = useLembrar('pecas.f', 'todas')
  const [util, setUtil] = useLembrar('pecas.util', '')
  const [forn, setForn] = useLembrar('pecas.forn', '')
  useEffect(() => { const q = r.q.get('f'); if (q) setF(q) }, [r.hash, r.q, setF])

  const todas = S.lista('pecas').filter(p => p.ativo)
  const cont = (c: string) => todas.filter(p => C.situacao(p).cod === c).length
  const utils = U.unicos(todas.map(p => p.utilizacao).filter((x): x is string => !!x)).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const forns = Perm.pode('compras') ? U.ordenar(S.lista('fornecedores').filter(x => todas.some(p => p.fornecedor_id === x.id)), x => U.sem(x.nome)) : []

  let l = f === 'inativas' ? S.lista('pecas').filter(p => !p.ativo) : todas.filter(p => f === 'todas' || C.situacao(p).cod === f)
  if (util) l = l.filter(p => U.sem(p.utilizacao || '').includes(U.sem(util)))
  if (forn) l = l.filter(p => p.fornecedor_id === forn)
  l = busca.trim() ? U.buscar(l, busca, p => [p.codigo, p.descricao, p.utilizacao || '', p.local || '']) : U.ordenar(l, p => U.sem(p.codigo))

  const sub = `${U.plural(todas.length, 'peça')} ativas${Perm.pode('precos') ? ' · ' + U.moeda0(C.valorEstoque()) + ' em estoque' : ''}`
  return <>
    <Cab titulo="Estoque" sub={sub}>
      {Perm.pode('pecas_editar') && <Btn txt="Nova peça" icone="mais" cls="pri" data-acao2="nova" onClick={() => void form()} />}
      {Perm.pode('entrada') && <Btn txt="Contar estoque" icone="contar" data-acao2="contagem" onClick={() => void contagem()} />}
      {Perm.pode('precos') && <Btn txt="Excel" icone="baixar" data-acao2="excel" onClick={() => exportar()} />}
    </Cab>
    <div className="barra-filtros">
      <BuscaLista id="buscaPecas" valor={busca} placeholder="Código, descrição, máquina ou prateleira" aoMudar={setBusca} />
      <select id="fUtil" aria-label="Máquina / utilização" value={util} onChange={(e) => setUtil(e.target.value)}><option value="">Todas as máquinas</option>{utils.map(u => <option key={u}>{u}</option>)}</select>
      {forns.length > 0 && <select id="fForn" aria-label="Fornecedor" value={forn} onChange={(e) => setForn(e.target.value)}><option value="">Todos os fornecedores</option>{forns.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</select>}
    </div>
    <Chips atual={f} aoEscolher={setF} opcoes={[{ v: 'todas', t: 'Todas' }, { v: 'comprar', t: 'Comprar', n: cont('comprar') }, { v: 'minimo', t: 'No mínimo', n: cont('minimo') },
      { v: 'alto', t: 'Estoque alto', n: cont('alto') }, { v: 'zerado', t: 'Sem estoque', n: cont('zerado') }, { v: 'inativas', t: 'Desativadas', n: S.lista('pecas').length - todas.length }]} />
    <p className="sub mt" id="contPecas">{U.plural(l.length, 'peça')}{busca || util || forn || f !== 'todas' ? ' no filtro' : ''}</p>
    <Paginado key={[busca, f, util, forn].join('|')} itens={l} passo={80} render={(p) => <LinhaPeca key={p.id} p={p} />}
      vazio={<Vazio icone="estoque" titulo="Nenhuma peça aqui" texto="Mude o filtro ou a busca." />} />
  </>
}

// ---------------------------------------------------------------- ficha
function Ficha({ id }: { id: string }) {
  const p = S.get('pecas', id)
  if (!p) return <Vazio icone="estoque" titulo="Peça não encontrada"><a className="btn pri" href="#/pecas">Voltar ao estoque</a></Vazio>
  const sit = C.situacao(p), precos = Perm.pode('precos')
  const f = S.get('fornecedores', p.fornecedor_id)
  const lotes = precos ? C.lotes(p.id) : []
  const abertos = Perm.pode('compras') ? C.pedidosAbertosDaPeca(p.id) : []
  const cons12 = C.consumoPeca(p.id, 12)
  const dur = C.duracao(p)
  const ult = precos ? C.ultimaEntrada(p.id) : null
  const sug = C.sugestao(p)

  // consumo por mês (12 meses)
  const meses: { ini: string; fim: string; q: number }[] = []
  for (let i = 11; i >= 0; i--) { const ini = U.somaMeses(U.hoje().slice(0, 8) + '01', -i); meses.push({ ini, fim: U.somaDias(U.somaMeses(ini, 1), -1), q: 0 }) }
  for (const c of C.consumos(m => m.peca_id === p.id && m.data >= meses[0].ini)) { const m = meses.find(x => c.mov.data >= x.ini && c.mov.data <= x.fim); if (m) m.q += c.qtd }
  const maxQ = Math.max(1, ...meses.map(m => m.q))
  const movs = S.lista('movimentos').filter(m => m.peca_id === p.id).slice().reverse()

  return <>
    <Voltar para="#/pecas" txt="Estoque" />
    <header className="cab"><div><p className="codigo mono" style={{ margin: '0 0 4px', color: 'var(--texto-2)' }}>{p.codigo}</p><h1>{p.descricao}</h1>
      <p className="sub">{p.utilizacao || 'Sem utilização definida'}{f ? ' · ' + f.nome : ''}</p></div>
      <div className="acoes">
        <Btn txt="Retirar" icone="retirar" cls="pri" data-f="retirar" onClick={() => void retirar(p)} />
        {Perm.pode('entrada') && <Btn txt="Entrada" icone="entrada" data-f="entrada" onClick={() => void entrada(p)} />}
        {Perm.pode('entrada') && <Btn txt="Contar" icone="contar" data-f="contar" onClick={() => void contarUma(p)} />}
        {Perm.pode('compras') && <Btn txt="Pedir" icone="compras" data-f="pedir" onClick={() => void formPedido({ itens: [{ peca: p, qtd: C.sugestao(p).sugerido || null }], fornecedor_id: p.fornecedor_id })} />}
        {Perm.pode('pecas_editar') && <Btn txt="Editar" icone="lapis" cls="fantasma" data-f="editar" onClick={() => void form(p)} />}
      </div></header>
    <div className="grade g3">
      <section className="card"><small className="fraco">NO ESTOQUE</small><div className="estoque-grande">{U.qtd(p.estoque)}<small>{p.unidade}</small></div>
        <div style={{ marginTop: 10 }}><Tag s={sit} /> <Medidor p={p} /></div>
        <p className="sub mt">Mínimo <b>{U.qtd(p.est_min)}</b> · Máximo <b>{U.qtd(p.est_max)}</b>{p.local ? <> · Local <b>{p.local}</b></> : null}</p>
        {sit.cod === 'comprar' && Perm.pode('compras') && <p className={`nota ${sug.pendente ? '' : 'vermelha'}`}>{sug.pendente ? `Já tem ${U.qtd(sug.pendente)} a caminho.` : 'Abaixo do mínimo.'} {sug.sugerido ? <>Sugestão: comprar <b>{U.qtd(sug.sugerido)}</b> para chegar ao máximo.</> : null}</p>}
      </section>
      <section className="card"><small className="fraco">CONSUMO (12 MESES)</small><div className="estoque-grande">{U.qtd(cons12)}<small>{p.unidade}</small></div>
        <p className="sub mt">Média de <b>{U.qtd(Math.round(cons12 / 12 * 10) / 10)}</b> por mês{dur !== null && <> · o estoque atual dura <b>{dur < 1 ? 'menos de 1 mês' : dur > 24 ? 'mais de 2 anos' : '≈ ' + U.qtd(Math.round(dur * 10) / 10) + ' meses'}</b></>}</p>
        <div className="mini-barras" aria-label="Consumo por mês">{meses.map(m => <i key={m.ini} title={`${U.mes(m.ini)}: ${U.qtd(m.q)}`} style={{ height: `${Math.max(2, m.q / maxQ * 100)}%` }} />)}</div>
        <div className="mini-rot"><span>{U.mes(meses[0].ini)}</span><span>{U.mes(meses[11].ini)}</span></div>
      </section>
      {precos && <section className="card"><small className="fraco">VALOR</small><div className="estoque-grande">{U.moeda(C.valorPeca(p.id))}</div>
        <p className="sub mt">{ult ? <>Último preço: <b>{U.moeda(ult.preco_unit)}</b> em {U.data(ult.data)}{S.get('fornecedores', ult.fornecedor_id) ? ' (' + S.get('fornecedores', ult.fornecedor_id)!.nome + ')' : ''}</> : 'Sem entrada com preço.'}</p>
        <Variacao pecaId={p.id} /></section>}
    </div>
    {lotes.length > 0 && <section className="card mt"><div className="card-cab"><h2>Na prateleira, por nota</h2><span className="sub">a próxima retirada sai do lote mais antigo</span></div>
      <div className="tabela-caixa"><table className="tabela cartoes"><thead><tr><th>Entrada</th><th>Documento</th><th className="num">Restam</th><th className="num">Preço</th><th className="num">Valor</th></tr></thead>
        <tbody>{lotes.map(l => <tr key={l.mov.id}><td data-r="Entrada" className="titulo">{U.data(l.mov.data)}</td><td data-r="Documento">{l.mov.documento || '—'}</td><td data-r="Restam" className="num">{U.qtd(l.resta)}</td><td data-r="Preço" className="num">{U.moeda(l.mov.preco_unit)}</td><td data-r="Valor" className="num">{U.moeda(l.valor)}</td></tr>)}</tbody></table></div></section>}
    {abertos.length > 0 && <section className="card mt"><div className="card-cab"><h2>Pedidos a caminho</h2></div><div className="lista">{abertos.map(({ ped, item }) =>
      <a key={item.id} className="linha" href={'#/pedido/' + ped.id}><div className="meio"><b>Pedido nº {ped.numero} · {S.get('fornecedores', ped.fornecedor_id)?.nome || ''}</b><small>{U.qtd(item.qtd - item.recebido)} de {U.qtd(item.qtd)} faltando chegar</small></div>
        <div className="lado"><Tag s={C.situacaoPedido(ped)} /><small>{ped.prazo ? U.relativo(ped.prazo) : ''}</small></div></a>)}</div></section>}
    {p.obs && <section className="card mt"><h2>Observações</h2><p className="mt"><Texto t={p.obs} /></p></section>}
    <section className="card mt"><div className="card-cab"><h2>Movimentações</h2><span className="sub">{U.plural(movs.length, 'lançamento')}</span></div>
      {movs.length ? <Paginado itens={movs} passo={30} render={(m) => <LinhaMov key={m.id} m={m} />} /> : <p className="sub">Nenhuma movimentação.</p>}</section>
  </>
}

// como o preço mudou (primeira compra x última)
function Variacao({ pecaId }: { pecaId: string }) {
  const ents = S.lista('movimentos').filter(m => m.peca_id === pecaId && m.tipo === 'entrada' && m.preco_unit > 0 && m.motivo !== 'estorno' && m.motivo !== 'ajuste')
  if (ents.length < 2) return null
  const a = ents[0], b = ents[ents.length - 1]
  const v = b.preco_unit / a.preco_unit - 1
  if (Math.abs(v) < 0.01) return <p className="sub">Preço estável desde {U.data(a.data)}.</p>
  return <p className="sub">Desde {U.data(a.data)} o preço {v > 0 ? 'subiu' : 'caiu'} <b style={{ color: `var(--${v > 0 ? 'vermelho' : 'verde'})` }}>{U.pct(Math.abs(v))}</b> ({U.moeda(a.preco_unit)} → {U.moeda(b.preco_unit)}).</p>
}

// ---------------------------------------------------------------- cadastro
const UNIDADES = ['un', 'pç', 'par', 'jogo', 'kit', 'm', 'kg', 'l', 'cx', 'rolo']
export async function form(p?: Peca | null): Promise<string | null> {
  const novo = !p
  const base: Partial<Peca> = p || { unidade: 'un', est_min: 0, est_max: 0, ativo: true }
  const utils = U.unicos([...S.lista('pecas').map(x => x.utilizacao), ...S.lista('maquinas').map(m => m.nome)].filter((x): x is string => !!x)).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const id = await modal<string>({
    titulo: novo ? 'Nova peça' : 'Editar peça',
    corpo: <>
      <div className="linha-campos l2">
        <Campo nome="codigo" rotulo="Código" valor={base.codigo} req ajuda="O código do fabricante ou o seu." />
        <Campo nome="unidade" rotulo="Unidade" valor={base.unidade} tipo="select" opcoes={UNIDADES.map(v => ({ v, t: v }))} />
      </div>
      <Campo nome="descricao" rotulo="Descrição" valor={base.descricao} req />
      <Campo nome="utilizacao" rotulo="Onde é usada (máquina / dispositivo)" valor={base.utilizacao} attrs={{ list: 'listaUtil' }} />
      <datalist id="listaUtil">{utils.map(u => <option key={u} value={u} />)}</datalist>
      {Perm.pode('compras') && <ComboFornecedor id="cForn" nome="fornecedor_id" rotulo="Fornecedor de costume" placeholder="Digite para buscar" inicial={S.get('fornecedores', base.fornecedor_id)} />}
      <div className="linha-campos l3">
        <Campo nome="est_min" rotulo="Estoque mínimo" tipo="qtd" valor={U.campoNum(base.est_min, 3)} ajuda="Abaixo disso: comprar" />
        <Campo nome="est_max" rotulo="Estoque máximo" tipo="qtd" valor={U.campoNum(base.est_max, 3)} ajuda="Compra completa até aqui" />
        <Campo nome="local" rotulo="Prateleira / local" valor={base.local} placeholder="Ex.: A3" />
      </div>
      <Campo nome="obs" rotulo="Observações" tipo="area" valor={base.obs} linhas={2} />
      {!novo && <Campo nome="ativo" rotulo="Peça ativa (desmarque para esconder sem apagar o histórico)" tipo="check" valor={base.ativo} />}
    </>,
    botoes: [{ txt: novo ? 'Cadastrar' : 'Salvar', acao: async (f) => {
      const d = lerForm(f)
      if (!Perm.pode('compras')) d.fornecedor_id = base.fornecedor_id || null
      if (novo) d.ativo = true
      const r = await API.rpc<string>('salvar_peca', { p: { ...d, id: base.id } })
      await App.gravou(['pecas'])
      aviso(novo ? 'Peça cadastrada.' : 'Peça salva.')
      return r
    } }],
  })
  if (id && novo) location.hash = '#/peca/' + id
  return id
}

// ---------------------------------------------------------------- contagem de uma peça
export async function contarUma(p: Peca): Promise<void> {
  await modal({
    titulo: 'Contar estoque — ' + p.codigo,
    corpo: <ContarUma p={p} />,
    botoes: [{ txt: 'Salvar contagem', acao: async (f) => {
      const d = lerForm(f)
      if (d.contado === null || d.contado < 0) throw new ErroApp('Digite a quantidade contada (zero ou mais).')
      const r = await API.rpc<{ diferenca: number }>('contar_estoque', { p_peca: p.id, p_contado: d.contado, p_obs: d.obs || null })
      await App.gravou(['pecas', 'movimentos'])
      aviso(Number(r.diferenca) === 0 ? 'Contagem confere com o sistema.' : `Ajuste de ${Number(r.diferenca) > 0 ? '+' : ''}${U.qtd(r.diferenca)} lançado.`)
    } }],
  })
}
function ContarUma({ p }: { p: Peca }) {
  const [n, setN] = useState<number | null>(null)
  const d = n === null ? null : n - p.estoque
  return <>
    <p className="sub">{p.descricao}</p>
    <p>No sistema: <b>{U.qtd(p.estoque)} {p.unidade}</b>. Conte o que tem na prateleira e digite abaixo.</p>
    <Campo nome="contado" rotulo="Quantidade contada" tipo="qtd" req foco attrs={{ onInput: (e: FormEvent<HTMLInputElement>) => setN(U.num(e.currentTarget.value)) }} />
    <p className="sub" id="difC">{d === null ? '' : d === 0 ? 'Bate com o sistema. Nada muda.' : <>O sistema vai lançar um ajuste de <b>{d > 0 ? '+' : ''}{U.qtd(d)}</b>.</>}</p>
    <Campo nome="obs" rotulo="Motivo (opcional)" placeholder="Ex.: contagem mensal, peça quebrada…" />
  </>
}

// ---------------------------------------------------------------- contagem de várias peças (inventário)
interface CtlInv { limpar?: (id: string) => void }
async function contagem(): Promise<void> {
  const ctl: CtlInv = {}
  await modal({
    titulo: 'Contar estoque (inventário)', largura: 'larga',
    corpo: <Inventario ctl={ctl} />,
    botoes: [{ txt: 'Lançar ajustes', validar: false, acao: async (f, j) => {
      const itens = [...f.querySelectorAll<HTMLInputElement>('.inv')].map(i => ({ id: i.dataset.id!, n: U.num(i.value) })).filter((x): x is { id: string; n: number } => x.n !== null)
      if (itens.some(x => x.n < 0)) throw new ErroApp('Há quantidade negativa. Corrija antes de lançar.')
      const difs = itens.filter(x => x.n !== S.get('pecas', x.id)?.estoque)
      if (!difs.length) { aviso(itens.length ? 'Tudo confere. Nenhum ajuste necessário.' : 'Nenhuma peça foi contada.'); return }
      if (!(await confirmar(`Lançar ${U.plural(difs.length, 'ajuste')} de estoque?`, { ok: 'Lançar ajustes' }))) return false
      let ok = 0; const erros: string[] = []
      for (const x of difs) {
        try { await API.rpc('contar_estoque', { p_peca: x.id, p_contado: x.n, p_obs: 'Inventário' }); ok++; ctl.limpar?.(x.id) }
        catch (e) { erros.push(S.get('pecas', x.id)?.codigo + ': ' + traduzir(e).message) }
        j.erro(`Lançando… ${ok} de ${difs.length}`)
      }
      await App.gravou(['pecas', 'movimentos'])
      if (erros.length) { j.erro(`${ok} ajustes lançados. Não deu certo em ${erros.length}: ${erros.join(' | ')}`); j.limparSujo(); return false }
      aviso(`${U.plural(ok, 'ajuste')} lançado${ok > 1 ? 's' : ''}.`)
    } }],
  })
}
function Inventario({ ctl }: { ctl: CtlInv }) {
  useJanela()
  const [busca, setBusca] = useState('')
  const [util, setUtil] = useState('')
  const [valores, setValores] = useState<Record<string, string>>({})
  const [feitos, setFeitos] = useState<Set<string>>(new Set())
  ctl.limpar = (id) => { setValores(v => ({ ...v, [id]: '' })); setFeitos(s => new Set(s).add(id)) }
  const pecas = U.ordenar(S.lista('pecas').filter(p => p.ativo), p => U.sem(p.codigo))
  const utils = U.unicos(pecas.map(p => p.utilizacao).filter((x): x is string => !!x)).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const t = U.sem(busca.trim())
  const contadas = Object.entries(valores).filter(([, v]) => U.num(v) !== null)
  const difs = contadas.filter(([id, v]) => U.num(v) !== S.get('pecas', id)?.estoque)
  return <>
    <p className="sub">Digite só o que você contou. Campos em branco não mudam nada. No fim, o sistema lança os ajustes das diferenças.</p>
    <div className="barra-filtros"><div className="busca-lista"><Ic n="busca" /><input type="search" id="bInv" placeholder="Filtrar por código ou descrição" onChange={(e) => setBusca(e.target.value)} /></div>
      <select id="uInv" value={util} onChange={(e) => setUtil(e.target.value)}><option value="">Todas as máquinas</option>{utils.map(u => <option key={u}>{u}</option>)}</select></div>
    <div className="tabela-caixa" style={{ maxHeight: '52vh', overflow: 'auto' }}><table className="tabela"><thead><tr><th>Código</th><th className="esconde-celular">Descrição</th><th className="num">Sistema</th><th className="num" style={{ width: 120 }}>Contado</th><th className="num">Diferença</th></tr></thead>
      <tbody id="tInv">{pecas.map(p => {
        const v = valores[p.id] || '', n = U.num(v), d = n === null ? null : n - p.estoque
        const oculta = (t && !U.sem(p.codigo + ' ' + p.descricao).includes(t)) || (util && p.utilizacao !== util)
        return <tr key={p.id} data-id={p.id} hidden={!!oculta}>
          <td className="mono">{p.codigo}<div className="peq so-celular">{p.descricao}</div></td><td className="esconde-celular peq">{p.descricao}</td>
          <td className="num">{U.qtd(p.estoque)}</td>
          <td className="num"><input className="inv" data-id={p.id} inputMode="decimal" data-num="qtd" aria-label={'Contado ' + p.codigo} value={v} onChange={(e) => setValores(x => ({ ...x, [p.id]: e.target.value }))}
            style={{ width: '100%', minHeight: 36, textAlign: 'right', border: '1px solid var(--borda-forte)', borderRadius: 6, padding: '4px 8px', font: 'inherit', background: 'var(--cartao)', color: 'var(--texto)' }} /></td>
          <td className="num dif" style={{ color: d ? (d > 0 ? 'var(--verde)' : 'var(--vermelho)') : undefined }}>{d === null ? (feitos.has(p.id) ? '✓' : '') : (d > 0 ? '+' : '') + U.qtd(d)}</td></tr>
      })}</tbody></table></div>
    <p className="mt" id="resInv">{contadas.length ? <>{U.plural(contadas.length, 'peça contada', 'peças contadas')} · <b>{U.plural(difs.length, 'diferença')}</b> para ajustar</> : 'Nenhuma peça contada ainda.'}</p>
  </>
}

// ---------------------------------------------------------------- Excel
function exportar() {
  return excel(`Estoque JAF ${U.hoje()}.xlsx`, [['Estoque', U.ordenar(S.lista('pecas'), p => U.sem(p.codigo)).map(p => ({
    'Código': p.codigo, 'Descrição': p.descricao, 'Utilização': p.utilizacao || '', 'Fornecedor': S.get('fornecedores', p.fornecedor_id)?.nome || '',
    'Estoque Min.': p.est_min, 'Estoque Máx.': p.est_max, 'Qde Estoque': p.estoque, 'Unidade': p.unidade, 'Status': C.situacao(p).txt,
    'Valor (R$)': U.r2(C.valorPeca(p.id)), 'A caminho': C.pendente(p.id), 'Local': p.local || '', 'Ativa': p.ativo ? 'sim' : 'não', 'Obs.': p.obs || '' }))]])
}

export const tituloPecas = (r: Rota) => r.nome === 'peca' ? (S.get('pecas', r.id)?.codigo || 'Peça') : 'Estoque'
