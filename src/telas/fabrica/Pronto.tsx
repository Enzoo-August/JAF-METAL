/* Estoque de peça pronta (componentes e conjuntos fabricados aqui).
 * Sozinho: a OF apontada soma, o conjunto produzido consome os componentes da estrutura, a entrega ao cliente tira.
 * O PCP faz a contagem (inventário) e define o estoque mínimo de cada código — a Necessidade e o alerta de OF usam isso. */
import { useEffect, useState } from 'react'
import { App } from '../../app/controle.tsx'
import { API } from '../../lib/api.ts'
import { C, S } from '../../lib/dados.ts'
import { Perm } from '../../lib/perm.ts'
import type { Produto, ProdutoMov, Situacao } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { excel } from '../../ui/arquivos.tsx'
import { aviso } from '../../ui/avisos.ts'
import { BuscaLista, Btn, Cab, Campo, Chips, Cols, Paginado, Tag, Vazio } from '../../ui/base.tsx'
import { useLembrar, type Rota } from '../../ui/ganchos.ts'
import { lerForm, modal } from '../../ui/janelas.tsx'
import { ComboProduto, ComTabelas } from './comum.tsx'

const TABS = ['produtos', 'produto_estrutura', 'produto_saldos', 'ofs', 'vendas'] as const
const TIPO_MOV: Record<ProdutoMov['tipo'], string> = { of: 'Produzido (OF)', consumo: 'Usado em conjunto', entrega: 'Entrega ao cliente', contagem: 'Contagem' }

export function situacaoPronto(p: Produto): Situacao {
  const s = S.get('produto_saldos', p.id), saldo = Number(s?.saldo) || 0, min = Number(s?.minimo) || 0
  if (saldo < 0) return { cod: 'negativo', txt: 'Conferir (negativo)', cor: 'vermelho' }
  if (min > 0 && saldo + C.emOFAberta(p.id) < min) return { cod: 'minimo', txt: 'Abaixo do mínimo', cor: 'vermelho' }
  if (!s?.contado_em) return { cod: 'semcontagem', txt: 'Sem contagem', cor: 'cinza' }
  if (min > 0 && saldo < min) return { cod: 'emof', txt: 'Mínimo coberto por OF', cor: 'amarelo' }
  return { cod: 'ok', txt: 'Ok', cor: 'verde' }
}

export function TelaPronto({ r }: { r: Rota }) {
  return <ComTabelas tabs={[...TABS]}>{() => <Lista r={r} />}</ComTabelas>
}

function Lista({ r }: { r: Rota }) {
  const [f, setF] = useLembrar('pronto.f', r.q.get('f') || 'saldo')
  const [busca, setBusca] = useLembrar('pronto.busca', '')
  const pecas = S.lista('produtos').filter(p => p.classe === 'peca' && p.situacao !== 'inativo')
  const sit = new Map(pecas.map(p => [p.id, situacaoPronto(p)]))
  const saldo = (p: Produto) => C.estoquePeca(p.id)
  const comSaldo = pecas.filter(p => saldo(p) !== 0 || S.get('produto_saldos', p.id))
  const cont = { minimo: 0, negativo: 0, semcontagem: 0 }
  for (const p of comSaldo) { const c = sit.get(p.id)!.cod as keyof typeof cont; if (c in cont) cont[c]++ }
  let l = f === 'todos' ? pecas : f === 'saldo' ? comSaldo : comSaldo.filter(p => sit.get(p.id)!.cod === f)
  l = busca.trim() ? U.buscar(l, busca, p => [p.codigo, p.descricao, p.codigo_cliente || '']) : U.ordenar(l, p => U.sem(p.codigo))
  const pode = Perm.pode('of_emitir')
  return <>
    <Cab titulo="Estoque de peça pronta" sub="A OF apontada soma, o conjunto produzido usa os componentes, a entrega ao cliente tira">
      {pode && <Btn txt="Contar uma peça" icone="contar" cls="pri" data-pronto="contar" onClick={() => void contar(null)} />}
      <Btn txt="Excel" icone="planilha" cls="fantasma" onClick={() => excel('Estoque de peca pronta.xlsx', [['Estoque', l.map(p => { const s = S.get('produto_saldos', p.id)
        return { Código: p.codigo, Descrição: p.descricao, 'Cód. cliente': p.codigo_cliente || '', Saldo: saldo(p), Mínimo: Number(s?.minimo) || 0, 'Em OF aberta': C.emOFAberta(p.id),
          'Última contagem': s?.contado_em ? U.dataHora(s.contado_em) : '', Situação: sit.get(p.id)!.txt } })]])} />
    </Cab>
    <div className="grade g4">
      <div className="kpi"><small>Códigos com estoque</small><b>{comSaldo.filter(p => saldo(p) > 0).length}</b><span>{U.qtd(U.soma(comSaldo, p => Math.max(0, saldo(p))))} peças</span></div>
      <div className="kpi"><small>Abaixo do mínimo</small><b style={{ color: cont.minimo ? 'var(--vermelho)' : undefined }}>{cont.minimo}</b><span>{cont.minimo ? <a href="#/necessidade?f=of">abrir OF</a> : 'nenhum'}</span></div>
      <div className="kpi"><small>Negativos</small><b style={{ color: cont.negativo ? 'var(--vermelho)' : undefined }}>{cont.negativo}</b><span>faltou apontar ou contar</span></div>
      <div className="kpi"><small>Sem contagem</small><b>{cont.semcontagem}</b><span>conte para o saldo valer</span></div>
    </div>
    {!S.lista('produto_saldos').some(s => s.contado_em) && <p className="nota amarela mt">Comece pela contagem: conte as peças prontas na prateleira e lance em “Contar uma peça”. A partir daí o sistema acompanha sozinho cada OF e cada entrega.</p>}
    <div className="barra-filtros mt"><BuscaLista id="bPronto" valor={busca} placeholder="Código, descrição ou código do cliente" aoMudar={setBusca} /></div>
    <Chips atual={f} aoEscolher={setF} opcoes={[{ v: 'saldo', t: 'Com movimento', n: comSaldo.length }, { v: 'minimo', t: 'Abaixo do mínimo', n: cont.minimo || null },
      { v: 'negativo', t: 'Negativos', n: cont.negativo || null }, { v: 'semcontagem', t: 'Sem contagem', n: cont.semcontagem || null }, { v: 'todos', t: 'Todos os códigos' }]} />
    <div className="mt lista" id="lPronto"><Paginado itens={l} render={p => { const s = S.get('produto_saldos', p.id), em = C.emOFAberta(p.id)
      return <div key={p.id} className="linha clicavel cols" data-pronto-peca={p.codigo} onClick={() => void detalhePronto(p.id)}>
        <div className="meio"><b className="mono">{p.codigo}</b><small>{p.descricao}{p.codigo_cliente ? ' · ' + p.codigo_cliente : ''}</small></div>
        <Cols itens={[['Mínimo', s?.minimo ? U.qtd(s.minimo) : '—'], ['Em OF', em ? U.qtd(em) : '—'], ['Contagem', s?.contado_em ? U.dataCurta(s.contado_em) : '—']]} />
        <div className="lado"><b style={{ color: saldo(p) < 0 ? 'var(--vermelho)' : undefined }}>{U.qtd(saldo(p))}</b><small>pronto</small><Tag s={sit.get(p.id)!} /></div></div> }}
      vazio={<Vazio icone="estoque" titulo={f === 'saldo' ? 'Nenhuma peça pronta lançada ainda' : 'Nada aqui'} texto={f === 'saldo' ? 'Faça a primeira contagem ou aponte uma OF.' : undefined} />} /></div>
  </>
}

export async function detalhePronto(id: string): Promise<void> {
  await S.garantir([...TABS])
  const p = S.get('produtos', id); if (!p) return
  const s = S.get('produto_saldos', id)
  const pode = Perm.pode('of_emitir')
  await modal({
    titulo: `${p.codigo} · peça pronta`, largura: 'larga',
    corpo: <>
      <p className="sub">{p.descricao}</p>
      <div className="grade g3"><div className="kpi"><small>Saldo</small><b style={{ color: C.estoquePeca(id) < 0 ? 'var(--vermelho)' : undefined }}>{U.qtd(C.estoquePeca(id))}</b><span><Tag s={situacaoPronto(p)} /></span></div>
        <div className="kpi"><small>Estoque mínimo</small><b>{s?.minimo ? U.qtd(s.minimo) : '—'}</b><span>{U.qtd(C.emOFAberta(id))} em OF aberta</span></div>
        <div className="kpi"><small>Última contagem</small><b>{s?.contado_em ? U.dataCurta(s.contado_em) : '—'}</b><span>{s?.contado_por || 'nunca contado'}</span></div></div>
      <h3 className="mt">Movimentos</h3><Movimentos id={id} />
    </>,
    botoes: pode ? [{ txt: 'Contar / mínimo', icone: 'contar', validar: false, acao: async () => { void contar(id); return true } }] : [],
  })
}

function Movimentos({ id }: { id: string }) {
  const [l, setL] = useState<ProdutoMov[] | null>(null)
  useEffect(() => { API.lerOnde('produto_movs', 'produto_id', id).then(x => setL(U.ordenar(x, m => m.criado_em, true).slice(0, 40))).catch(() => setL([])) }, [id])
  if (!l) return <p className="sub">Carregando…</p>
  if (!l.length) return <p className="sub">Nenhum movimento ainda.</p>
  return <div className="lista" id="lMovPronto">{l.map(m => <div key={m.id} className="linha"><div className="meio"><b>{TIPO_MOV[m.tipo]}</b><small>{U.data(m.data)}{m.obs ? ' · ' + m.obs : ''}{m.criado_nome ? ' · ' + m.criado_nome : ''}</small></div>
    <div className="lado"><b style={{ color: m.qtd < 0 ? 'var(--vermelho)' : m.qtd > 0 ? 'var(--verde)' : undefined }}>{m.qtd > 0 ? '+' : ''}{U.qtd(m.qtd)}</b>{m.saldo !== null && <small>saldo {U.qtd(m.saldo)}</small>}</div></div>)}</div>
}

export async function contar(id: string | null): Promise<void> {
  await S.garantir([...TABS])
  const p = id ? S.get('produtos', id) : null, s = id ? S.get('produto_saldos', id) : null
  await modal({
    titulo: p ? `Contar ${p.codigo}` : 'Contar uma peça pronta',
    corpo: <>
      {!p && <ComboProduto id="prontoProd" nome="produto_id" rotulo="Peça ou conjunto" req classe="peca" placeholder="Código ou descrição" foco />}
      {p && <p className="sub">{p.descricao} · saldo no sistema: <b>{U.qtd(C.estoquePeca(p.id))}</b></p>}
      <div className="linha-campos l2"><Campo nome="saldo" rotulo="Quantidade contada" tipo="qtd" foco={!!p} ajuda="Em branco = só muda o mínimo" />
        <Campo nome="minimo" rotulo="Estoque mínimo" tipo="qtd" valor={s ? U.campoNum(s.minimo, 3) : ''} ajuda="Abaixo disso o sistema avisa para abrir OF" /></div>
      <Campo nome="obs" rotulo="Observação" placeholder="Ex.: inventário de novembro" />
    </>,
    botoes: [{ txt: 'Gravar', acao: async (f) => {
      const d = lerForm(f), pid = p?.id || d.produto_id
      if (!pid) throw new Error('Escolha a peça')
      if (d.saldo === null && d.minimo === null) throw new Error('Informe a quantidade contada ou o mínimo')
      const novo = await API.rpc<number>('contar_produto', { p: { produto_id: pid, saldo: d.saldo, minimo: d.minimo, obs: d.obs } })
      await App.gravou(['produto_saldos'])
      aviso(d.saldo !== null ? `Contagem gravada: saldo ${U.qtd(novo)}.` : 'Estoque mínimo gravado.')
      return true
    } }],
  })
}
