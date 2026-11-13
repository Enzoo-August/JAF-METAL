/* Produtos (cadastro técnico): peças, conjuntos e matéria-prima.
 * Junta as abas "Cad. Componentes", "Cad. Conjuntos", "Cad. Material Produtivo" e "Cad. Técnico" das planilhas
 * do Depto. Técnico, do PCP e do Controle de Pedidos. O código segue o "código inteligente" da JAF. */
import { useState } from 'react'
import { App } from '../../app/controle.tsx'
import { API } from '../../lib/api.ts'
import { C, S } from '../../lib/dados.ts'
import { Perm } from '../../lib/perm.ts'
import type { Produto } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { excel } from '../../ui/arquivos.tsx'
import { aviso } from '../../ui/avisos.ts'
import { BuscaLista, Btn, Cab, Campo, Chips, Dl, Paginado, Tag, Texto, Vazio, Voltar } from '../../ui/base.tsx'
import { ComboCliente } from '../../ui/Combo.tsx'
import { useLembrar, type Rota } from '../../ui/ganchos.ts'
import { Ic } from '../../ui/icones.tsx'
import { lerForm, modal } from '../../ui/janelas.tsx'
import { ComboProduto, ComTabelas } from './comum.tsx'
import { LinhaOF, formOF } from './OFs.tsx'
import { detalhe as detalheLote, formLote } from './MP.tsx'
import { NOMES_REG } from './Registros.tsx'
import { SecaoProcesso } from './Processo.tsx'

const TABS = ['produtos', 'produto_estrutura', 'mp_lotes', 'ofs', 'vendas', 'registros'] as const
const CHECKS: [string, string][] = [['solic_desenv', 'Solic. desenvolvimento'], ['rf_pc', 'RF e PC'], ['desenhos', 'Desenhos'], ['planos_montagem', 'Planos de montagem']]
const SIT = { ativo: { txt: 'Ativo', cor: 'verde' }, inativo: { txt: 'Inativo', cor: 'cinza' }, bloqueado: { txt: 'Bloqueado', cor: 'vermelho' } } as const

interface CodInt { liga: { c: string; d: string }[]; perfil: { c: string; d: string }[]; processo: { c: string; d: string }[]; estado: { c: string; d: string }[]; medida: { c: string; d: string }[] }
interface Codigos { siglas: { nome: string; sigla: string }[]; tipos: { prefixo: string; tipo: string; descricao: string }[] }
const cfgFab = () => S.cfg<{ codigo_inteligente?: CodInt; codigos?: Codigos }>('fabrica', {})

function LinhaProduto({ p }: { p: Produto }) {
  const cli = S.get('clientes', p.cliente_id), n = C.componentes(p.id).length
  const est = p.classe === 'mp' ? C.estoqueMP().get(p.id) || 0 : 0
  return <a className="linha" href={'#/produto/' + p.id} data-prod={p.codigo}><div className="meio"><b>{p.codigo}{p.situacao !== 'ativo' && <> <Tag s={SIT[p.situacao]} /></>}</b>
    <small>{[p.descricao, cli?.nome, p.codigo_cliente, n ? `conjunto de ${n}` : '', p.mp_codigo ? 'MP ' + p.mp_codigo : ''].filter(Boolean).join(' · ')}</small></div>
    <div className="lado">{p.classe === 'mp' ? <><b>{U.qtd(est)}</b><small>em estoque</small></> : C.emOFAberta(p.id) ? <><b>{U.qtd(C.emOFAberta(p.id))}</b><small>em OF</small></> : null}</div></a>
}

export function TelaProdutos({ r }: { r: Rota }) {
  return <ComTabelas tabs={[...TABS]}>{() => r.nome === 'produto' && r.id ? <Ficha id={r.id} /> : <Lista />}</ComTabelas>
}
export const tituloProdutos = (r: Rota) => r.nome === 'produto' ? (S.get('produtos', r.id)?.codigo || 'Produto') : 'Produtos'

function Lista() {
  const [f, setF] = useLembrar('prod.f', 'peca')
  const [busca, setBusca] = useLembrar('prod.busca', '')
  const todos = S.lista('produtos')
  let l = todos
  if (f === 'peca') l = l.filter(p => p.classe === 'peca' && p.situacao === 'ativo')
  else if (f === 'conjunto') l = l.filter(p => p.situacao === 'ativo' && C.componentes(p.id).length > 0)
  else if (f === 'mp') l = l.filter(p => p.classe === 'mp' && p.situacao === 'ativo')
  else if (f !== 'todos') l = l.filter(p => p.situacao === f)
  l = busca.trim() ? U.buscar(l, busca, p => [p.codigo, p.descricao, p.codigo_cliente || '', S.get('clientes', p.cliente_id)?.nome || '', p.desenho_cliente || ''])
    : U.ordenar(l, p => p.codigo)
  return <>
    <Cab titulo="Produtos" sub="Cadastro técnico: peças, conjuntos (estrutura) e matéria-prima">
      {Perm.pode('produtos_editar') && <Btn txt="Novo produto" icone="mais" cls="pri" data-prod-acao="novo" onClick={() => void formProduto()} />}
      <Btn txt="Excel" icone="planilha" cls="fantasma" onClick={() => exportar(l)} />
    </Cab>
    <div className="barra-filtros"><BuscaLista id="bProd" valor={busca} placeholder="Código JAF, descrição, código do cliente" aoMudar={setBusca} /></div>
    <Chips atual={f} aoEscolher={setF} opcoes={[{ v: 'peca', t: 'Peças' }, { v: 'conjunto', t: 'Conjuntos' }, { v: 'mp', t: 'Matéria-prima' },
      { v: 'bloqueado', t: 'Bloqueados', n: todos.filter(p => p.situacao === 'bloqueado').length || null }, { v: 'inativo', t: 'Inativos' }, { v: 'todos', t: 'Todos' }]} />
    <div className="mt" id="lProd"><Paginado itens={l} render={p => <LinhaProduto key={p.id} p={p} />} vazio={<Vazio icone="estoque" titulo="Nenhum produto aqui" />} /></div>
  </>
}

function exportar(l: Produto[]) {
  return excel('Produtos.xlsx', [
    ['Produtos', l.map(p => ({ Código: p.codigo, Descrição: p.descricao, Tipo: p.classe === 'mp' ? 'Matéria-prima' : C.componentes(p.id).length ? 'Conjunto' : 'Peça', 'Cód. Matéria Prima': p.mp_codigo || '',
      Qde: p.mp_qtd ?? '', 'Kg/ Pç': p.mp_unidade || '', Operação: p.operacao || '', Cliente: S.get('clientes', p.cliente_id)?.nome || '', 'Código Cliente': p.codigo_cliente || '',
      'Desenho Cliente': p.desenho_cliente || '', Rev: p.revisao || '', 'Data Rev.': p.data_revisao ? U.data(p.data_revisao) : '', 'Peças/mês': p.pecas_mes ?? '', Situação: SIT[p.situacao].txt,
      ...Object.fromEntries(CHECKS.map(([k, t]) => [t, p.checks?.[k] ? 'Ok' : ''])) }))],
    ['Estrutura', l.flatMap(p => C.componentes(p.id).map(e => ({ Conjunto: p.codigo, Componente: S.get('produtos', e.filho_id)?.codigo || '', Qde: e.qtd, Unidade: e.unidade })))],
  ])
}

function Ficha({ id }: { id: string }) {
  const p = S.get('produtos', id)
  if (!p) return <Vazio icone="estoque" titulo="Produto não encontrado"><a className="btn pri" href="#/produtos">Voltar</a></Vazio>
  const comps = C.componentes(p.id), usado = C.ondeUsado(p.id)
  const mp = p.mp_codigo ? C.produtoPorCodigo(p.mp_codigo) : null
  const ofs = U.ordenar(S.lista('ofs').filter(o => o.produto_id === p.id), o => o.numero, true)
  const vendas = S.lista('vendas').filter(v => (v.produto_id === p.id || v.codigo === p.codigo) && !v.cancelado && C.saldoVenda(v) > 0)
  // matéria-prima e componente comprado (CC) têm saldo pelos lotes (R.I.)
  const porRI = p.classe === 'mp' || C.comprado(p)
  const lotes = porRI ? U.ordenar(S.lista('mp_lotes').filter(l => l.produto_id === p.id && C.saldoLote(l) > 0), l => l.ri) : []
  const regs = U.ordenar(S.lista('registros').filter(r => r.codigo && U.sem(r.codigo) === U.sem(p.codigo)), r => r.data || '', true)
  const cli = S.get('clientes', p.cliente_id)
  return <>
    <Voltar para="#/produtos" txt="Produtos" />
    <header className="cab"><div><h1>{p.codigo} {p.situacao !== 'ativo' && <Tag s={SIT[p.situacao]} />}</h1><p className="sub">{p.descricao}</p></div>
      <div className="acoes">
        {p.classe === 'peca' && !C.comprado(p) && p.situacao === 'ativo' && Perm.pode('of_emitir') && (mp || comps.length > 0) && <Btn txt="Emitir OF" icone="producao" cls="pri" onClick={() => void formOF({ produto_id: p.id })} />}
        {porRI && Perm.pode('mp_editar') && <Btn txt="Entrada de material" icone="entrada" cls="pri" onClick={() => void formLote({ produto_id: p.id })} />}
        {Perm.pode('produtos_editar') && <Btn txt="Editar" icone="lapis" cls="fantasma" data-prod-acao="editar" onClick={() => void formProduto(p)} />}
      </div></header>
    <div className="grade g4">
      {porRI ? <div className="kpi"><small>Em estoque</small><b>{U.qtd(C.estoqueMP().get(p.id) || 0)}</b><span>{U.plural(lotes.length, 'lote')} com saldo</span></div>
        : <div className="kpi"><small>Em OF aberta</small><b>{U.qtd(C.emOFAberta(p.id))}</b><span>{U.plural(ofs.filter(o => o.status === 'aberta').length, 'OF')}</span></div>}
      <div className="kpi"><small>Pedidos em aberto</small><b>{U.qtd(U.soma(vendas, v => C.saldoVenda(v)))}</b><span>{U.plural(vendas.length, 'item', 'itens')}</span></div>
      {p.pecas_mes ? <div className="kpi"><small>Peças por mês</small><b>{U.qtd(p.pecas_mes)}</b><span>previsão</span></div> : null}
      {mp && <div className="kpi"><small>Matéria-prima</small><b style={{ fontSize: '1rem' }}><a href={'#/produto/' + mp.id}>{mp.codigo}</a></b><span>{U.qtd(p.mp_qtd)} {p.mp_unidade || 'kg'} por peça</span></div>}
    </div>
    <section className="card mt"><Dl pares={[['Cliente', cli?.nome || ''], ['Código do cliente', p.codigo_cliente || ''], ['Desenho do cliente', p.desenho_cliente || ''],
      ['Revisão', [p.revisao, p.data_revisao ? U.data(p.data_revisao) : ''].filter(Boolean).join(' de ')], ['Operação', p.operacao || ''],
      ['Matéria-prima', p.mp_codigo && !mp ? `${p.mp_codigo} (não cadastrada)` : ''], ['Entrada', p.data_entrada ? U.data(p.data_entrada) : ''],
      ['Documentação', CHECKS.some(([k]) => p.checks?.[k] !== undefined) ? CHECKS.map(([k, t]) => (p.checks?.[k] ? '✓ ' : '✗ ') + t).join(' · ') : ''],
      ['Observações', p.obs ? <Texto t={p.obs} /> : '']]} /></section>
    {p.classe === 'peca' && <SecaoProcesso p={p} />}
    {comps.length > 0 && <section className="card mt"><div className="card-cab"><h2>Estrutura (componentes)</h2><span className="sub">por 1 conjunto</span></div>
      <div className="lista">{comps.map(e => { const f = S.get('produtos', e.filho_id)
        return <a key={e.id} className="linha" href={'#/produto/' + e.filho_id}><div className="meio"><b>{f?.codigo}</b><small>{f?.descricao}</small></div><div className="lado"><b>{U.qtd(e.qtd)}</b><small>{e.unidade}</small></div></a> })}</div></section>}
    {usado.length > 0 && <section className="card mt"><div className="card-cab"><h2>Onde é usado</h2></div>
      <div className="lista">{usado.map(e => { const pai = S.get('produtos', e.pai_id)
        return <a key={e.id} className="linha" href={'#/produto/' + e.pai_id}><div className="meio"><b>{pai?.codigo}</b><small>{pai?.descricao}</small></div><div className="lado"><b>{U.qtd(e.qtd)}</b><small>{e.unidade}</small></div></a> })}</div></section>}
    {lotes.length > 0 && <section className="card mt"><div className="card-cab"><h2>Lotes com saldo</h2></div>
      <div className="lista">{lotes.map(l => <div key={l.id} className="linha clicavel" onClick={() => void detalheLote(l.id)}><div className="meio"><b>R.I. {l.ri}</b><small>{U.data(l.data)} · {l.fornecedor_nome}</small></div><div className="lado"><b>{U.qtd(C.saldoLote(l))}</b></div></div>)}</div></section>}
    {ofs.length > 0 && <section className="card mt"><div className="card-cab"><h2>Ordens de fabricação</h2><span className="sub">{U.plural(ofs.length, 'OF')}</span></div><div className="lista">{ofs.slice(0, 15).map(o => <LinhaOF key={o.id} o={o} />)}</div></section>}
    {regs.length > 0 && <section className="card mt"><div className="card-cab"><h2>Registros técnicos deste código</h2></div>
      <div className="lista">{regs.slice(0, 30).map(r => <a key={r.id} className="linha" href={`#/reg/${r.tipo}?id=${r.id}`}><div className="meio"><b>{NOMES_REG[r.tipo]}{r.numero ? ' nº ' + r.numero : ''}</b><small>{[r.titulo, r.data ? U.dataCurta(r.data) : ''].filter(Boolean).join(' · ')}</small></div>
        <div className="lado">{r.status ? <small>{r.status}</small> : null}</div></a>)}</div></section>}
  </>
}

// ---------------------------------------------------------------- cadastro
interface LinhaEstr { k: string; filho_id: string | null; qtd: string; unidade: string }

function CorpoProduto({ b }: { b: Partial<Produto> }) {
  const [classe, setClasse] = useState<string>(b.classe || 'peca')
  const [estr, setEstr] = useState<LinhaEstr[]>(() => (b.id ? C.componentes(b.id) : []).map(e => ({ k: e.id, filho_id: e.filho_id, qtd: U.campoNum(e.qtd, 4), unidade: e.unidade })))
  const mudar = (k: string, x: Partial<LinhaEstr>) => setEstr(l => l.map(e => e.k === k ? { ...e, ...x } : e))
  return <>
    <fieldset className="secao"><legend>Identificação</legend>
    <div className="linha-campos l3">
      <Campo nome="codigo" rotulo="Código JAF" req valor={b.codigo} id="prodCod" ajuda={!b.id ? <a href="#" onClick={(e) => { e.preventDefault(); void montarCodigo(classe) }}>Montar pelo código inteligente</a> : ''} />
      <Campo nome="classe" rotulo="Tipo" tipo="select" valor={classe} opcoes={[{ v: 'peca', t: 'Peça / conjunto' }, { v: 'mp', t: 'Matéria-prima' }]} attrs={{ onChange: (e: { target: HTMLSelectElement }) => setClasse(e.target.value) }} />
      <Campo nome="situacao" rotulo="Situação" tipo="select" valor={b.situacao || 'ativo'} opcoes={[{ v: 'ativo', t: 'Ativo' }, { v: 'bloqueado', t: 'Bloqueado (não fabricar)' }, { v: 'inativo', t: 'Inativo' }]} />
    </div>
    <Campo nome="descricao" rotulo="Descrição" req valor={b.descricao} id="prodDesc" />
    </fieldset>
    {classe === 'peca' && <>
      <fieldset className="secao"><legend>Cliente e desenho</legend>
      <div className="linha-campos l2">
        <ComboCliente id="prodCli" nome="cliente_id" rotulo="Cliente" placeholder="Para quem é a peça" inicial={S.get('clientes', b.cliente_id)} />
        <Campo nome="codigo_cliente" rotulo="Código do cliente" valor={b.codigo_cliente} />
      </div>
      <div className="linha-campos">
        <Campo nome="desenho_cliente" rotulo="Desenho do cliente" valor={b.desenho_cliente} />
        <Campo nome="revisao" rotulo="Revisão" valor={b.revisao} />
        <Campo nome="data_revisao" rotulo="Data da revisão" tipo="date" valor={b.data_revisao} />
      </div>
      </fieldset>
      <fieldset className="secao"><legend>Material e processo</legend>
      <div className="linha-campos l3">
        <ComboProduto id="prodMP" nome="_mp" rotulo="Matéria-prima" classe="mp" todos placeholder="Código do material" inicial={C.produtoPorCodigo(b.mp_codigo)} />
        <Campo nome="mp_qtd" rotulo="Qtd de material por peça" tipo="qtd" valor={U.campoNum(b.mp_qtd, 4)} />
        <Campo nome="mp_unidade" rotulo="Unidade" tipo="select" valor={b.mp_unidade || 'Kg'} opcoes={['Kg', 'Pç', 'm', 'mm'].map(v => ({ v, t: v }))} />
      </div>
      {b.mp_codigo && !C.produtoPorCodigo(b.mp_codigo) && <p className="sub">Material na planilha: {b.mp_codigo} (não cadastrado). Escolha acima para corrigir.</p>}
      <div className="linha-campos">
        <Campo nome="operacao" rotulo="Operação" valor={b.operacao} placeholder="Ex.: estampar, usinar, montar" />
        <Campo nome="pecas_mes" rotulo="Peças por mês" tipo="num" valor={b.pecas_mes} />
        <Campo nome="data_entrada" rotulo="Data de entrada" tipo="date" valor={b.data_entrada} />
      </div>
      </fieldset>
      <fieldset className="secao"><legend>Estrutura (se for conjunto)</legend>
        {!estr.length && <p className="secao-dica">Peça simples: deixe vazio. Conjunto: adicione cada componente e a quantidade.</p>}
        {estr.map(e => <div key={e.k} className="estrutura-linha">
          <ComboProduto nome={'_e_' + e.k} rotulo="Componente" classe="peca" placeholder="Código" inicial={S.get('produtos', e.filho_id)} aoEscolher={(x) => mudar(e.k, { filho_id: x.id })} aoLimpar={() => mudar(e.k, { filho_id: null })} />
          <div className="campo"><label>Qtd</label><input inputMode="decimal" value={e.qtd} onChange={(ev) => mudar(e.k, { qtd: ev.target.value })} /></div>
          <div className="campo so-largo"><label>Unid.</label><select value={e.unidade} onChange={(ev) => mudar(e.k, { unidade: ev.target.value })}>{['Pç', 'Kg', 'm', 'Jg'].map(u => <option key={u}>{u}</option>)}</select></div>
          <button type="button" className="icone-btn" aria-label="Tirar componente" onClick={() => setEstr(l => l.filter(x => x.k !== e.k))}><Ic n="lixo" /></button>
        </div>)}
        <button type="button" className="btn fantasma" data-estr="mais" onClick={() => setEstr(l => [...l, { k: U.uuid(), filho_id: null, qtd: '1', unidade: 'Pç' }])}><Ic n="mais" /><span>Adicionar componente</span></button>
        <input type="hidden" name="_estrutura" value={JSON.stringify(estr.filter(e => e.filho_id).map(e => ({ filho_id: e.filho_id, qtd: U.num(e.qtd), unidade: e.unidade })))} />
      </fieldset>
      <fieldset className="secao"><legend>Documentação (Cad. Técnico)</legend><div className="linha-campos">{CHECKS.map(([k, t]) => <Campo key={k} nome={'_chk_' + k} rotulo={t} tipo="check" valor={!!b.checks?.[k]} />)}</div></fieldset>
    </>}
    <Campo nome="obs" rotulo="Observações" tipo="area" linhas={2} valor={b.obs} />
  </>
}

export async function formProduto(b: Partial<Produto> = {}): Promise<string | null> {
  // abre de qualquer lugar (Início, barra de baixo): garante as tabelas antes de montar a janela
  await S.garantir(['produtos', 'produto_estrutura'])
  const novo = !b.id
  return modal<string>({
    titulo: novo ? 'Novo produto' : 'Editar ' + b.codigo, largura: 'grande',
    corpo: <CorpoProduto b={b} />,
    botoes: [{ txt: novo ? 'Cadastrar' : 'Salvar', acao: async (f) => {
      const d = lerForm(f)
      const p: Record<string, unknown> = { id: b.id || f.dataset.envio || (f.dataset.envio = U.uuid()) }
      for (const [k, v] of Object.entries(d)) if (!k.startsWith('_')) p[k] = v
      if (d.classe === 'peca') {
        p.mp_codigo = d._mp ? S.get('produtos', d._mp as string)?.codigo || null : (b.mp_codigo && !C.produtoPorCodigo(b.mp_codigo) ? b.mp_codigo : null)
        p.estrutura = JSON.parse(String(d._estrutura || '[]'))
        p.checks = Object.fromEntries(CHECKS.filter(([k]) => d['_chk_' + k]).map(([k]) => [k, true]))
      } else { p.mp_codigo = null; p.estrutura = []; p.checks = {} }
      const id = await API.rpc<string>('salvar_produto', { p })
      await App.gravou(['produtos', 'produto_estrutura'], { inteira: ['produto_estrutura'] }); aviso(novo ? 'Produto cadastrado.' : 'Produto salvo.')
      if (novo) location.hash = '#/produto/' + id
      return id
    } }],
  })
}

// ---------------------------------------------------------------- código inteligente (aba "Código Inteligente" / "Def. Cód. Int.")
async function montarCodigo(classe: string): Promise<void> {
  const cfg = cfgFab()
  const ci = cfg.codigo_inteligente, cd = cfg.codigos
  const opc = (l: { c: string; d: string }[] | undefined) => [{ v: '', t: '—' }, ...(l || []).map(x => ({ v: x.c, t: `${x.c} — ${x.d}` }))]
  const r = await modal<{ codigo: string; descricao: string }>({
    titulo: classe === 'mp' ? 'Código de matéria-prima' : 'Código de peça',
    corpo: classe === 'mp'
      ? (ci ? <><p className="sub">Liga + perfil . processo + estado . medidas (ex.: AB06.B08.bp x bd x cg)</p>
          <div className="linha-campos"><Campo nome="liga" rotulo="Liga" tipo="select" req opcoes={opc(ci.liga)} /><Campo nome="perfil" rotulo="Perfil" tipo="select" req opcoes={opc(ci.perfil)} /></div>
          <div className="linha-campos"><Campo nome="processo" rotulo="Processo" tipo="select" req opcoes={opc(ci.processo)} /><Campo nome="estado" rotulo="Estado" tipo="select" req opcoes={opc(ci.estado)} /></div>
          <div className="linha-campos"><Campo nome="m1" rotulo="Medida 1" tipo="select" opcoes={opc(ci.medida)} /><Campo nome="m2" rotulo="Medida 2" tipo="select" opcoes={opc(ci.medida)} /><Campo nome="m3" rotulo="Medida 3" tipo="select" opcoes={opc(ci.medida)} /></div></>
        : <p>As tabelas do código inteligente ainda não foram importadas.</p>)
      : <><p className="sub">Prefixo + tipo . sequência (ex.: CC 03.0012). O número sai sozinho: o próximo livre.</p>
        <div className="linha-campos"><Campo nome="prefixo" rotulo="Prefixo (cliente ou tipo)" tipo="select" req opcoes={[{ v: '', t: '—' }, ...(cd?.tipos || []).map(x => ({ v: x.prefixo, t: `${x.prefixo} — ${x.descricao}` })), ...(cd?.siglas || []).map(x => ({ v: x.sigla, t: `${x.sigla} — ${x.nome}` }))]} />
          <Campo nome="tipo" rotulo="Tipo" tipo="select" req opcoes={[{ v: '', t: '—' }, ...(cd?.tipos || []).map(x => ({ v: x.tipo, t: `${x.tipo} — ${x.descricao}` }))]} /></div></>,
    botoes: [{ txt: 'Usar este código', acao: (f) => {
      const d = lerForm(f) as Record<string, string>
      if (classe === 'mp') {
        const ds = (k: keyof CodInt, c: string) => ci?.[k].find(x => x.c === c)?.d || ''
        const med = [d.m1, d.m2, d.m3].filter(Boolean)
        return { codigo: `${d.liga}${d.perfil}.${d.processo}${d.estado}${med.length ? '.' + med.join(' x ') : ''}`,
          descricao: [ds('liga', d.liga), ds('perfil', d.perfil), ds('processo', d.processo), ds('estado', d.estado), med.map(m => ds('medida', m)).join(' x ')].filter(Boolean).join(' ') }
      }
      const base = `${d.prefixo} ${d.tipo}.`
      const max = Math.max(0, ...S.lista('produtos').filter(p => p.codigo.toUpperCase().startsWith(base.toUpperCase())).map(p => Number(p.codigo.slice(base.length)) || 0))
      return { codigo: base + String(max + 1).padStart(4, '0'), descricao: '' }
    } }],
  })
  if (!r) return
  const set = (id: string, v: string) => { const el = document.getElementById(id) as HTMLInputElement | null; if (el && v) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) } }
  set('prodCod', r.codigo); set('prodDesc', r.descricao)
}
