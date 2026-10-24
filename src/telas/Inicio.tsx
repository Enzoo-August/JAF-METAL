/* Início: o que cada perfil mais faz, em primeiro lugar */
import { API } from '../lib/api.ts'
import { C, S } from '../lib/dados.ts'
import { Perm } from '../lib/perm.ts'
import * as U from '../lib/util.ts'
import { Tag } from '../ui/base.tsx'
import { Ic } from '../ui/icones.tsx'
import { CartaoOrdem, form as formOrdem } from './Producao.tsx'
import { form as formConta } from './Financeiro.tsx'
import { formManutencao } from './Maquinas.tsx'
import { entrada, LinhaMov, retirar } from './Movimentos.tsx'

export function TelaInicio() {
  const s = API.sessao!
  const agora = U.agoraSP(), h = agora.getHours()
  const saud = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
  const al = C.alertas()
  return <>
    <header className="cab"><div><h1>{saud}, {(s.nome || '').split(' ')[0]}</h1><p className="sub">{U.cap(agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))}</p></div></header>
    <div className="atalhos">
      <button type="button" className="atalho destaque" data-acao="retirar" onClick={() => void retirar()}><Ic n="retirar" /><span>Retirar peça<small>do almoxarifado</small></span></button>
      {Perm.pode('entrada') && <button type="button" className="atalho" data-acao="entrada" onClick={() => void entrada()}><Ic n="entrada" /><span>Dar entrada<small>chegou peça</small></span></button>}
      {Perm.pode('compras') && <a className="atalho" href="#/compras/lista"><Ic n="lista" /><span>Lista de compras<small>o que está faltando</small></span></a>}
      {Perm.pode('producao_editar') && <button type="button" className="atalho" data-ir="novaOrdem" onClick={() => void formOrdem()}><Ic n="producao" /><span>Nova ordem<small>de produção</small></span></button>}
      <button type="button" className="atalho" data-ir="chamado" onClick={() => void formManutencao({ tipo: 'corretiva' })}><Ic n="chave" /><span>Máquina com problema<small>abrir chamado</small></span></button>
      {Perm.pode('financeiro') && <button type="button" className="atalho" data-ir="conta" onClick={() => void formConta({})}><Ic n="dinheiro" /><span>Nova conta<small>a pagar ou receber</small></span></button>}
    </div>
    <section className="card"><div className="card-cab"><h2>Precisa de atenção</h2></div>
      {al.length ? <div className="alertas">{al.map(a => <a key={a.txt} className={`alerta n-${a.nivel}`} href={a.rota}><Ic n="alerta" /><span>{a.txt}</span><Ic n="seta" /></a>)}</div>
        : <p className="sub"><Ic n="ok" /> Tudo em dia por aqui.</p>}</section>
    {Perm.pode('precos') && <Numeros />}
    {s.perfil === 'producao' ? <><MinhasOrdens /><MinhasRetiradas /></> : Perm.pode('compras') && <div className="grade g2 mt"><Chegando /><Ultimas /></div>}
  </>
}

function Numeros() {
  const hoje = U.hoje(), ini = hoje.slice(0, 8) + '01'
  const consumoMes = U.soma(C.consumos(m => m.data >= ini && m.data <= hoje), 'valor')
  const ant = U.somaMeses(ini, -1), fimAnt = U.somaDias(ini, -1)
  const consumoAnt = U.soma(C.consumos(m => m.data >= ant && m.data <= fimAnt), 'valor')
  const fin = Perm.pode('financeiro')
  const ab = S.lista('lancamentos').filter(l => !l.pago_em && l.vencimento <= U.somaDias(hoje, 7))
  const pg = U.soma(ab.filter(l => l.tipo === 'pagar'), 'valor'), rc = U.soma(ab.filter(l => l.tipo === 'receber'), 'valor')
  const peds = S.lista('pedidos_compra').filter(p => p.status === 'aguardando')
  const ops = S.lista('ordens').filter(o => o.status === 'fila' || o.status === 'producao')
  return <div className="grade g4 mt">
    <a className="kpi" href="#/relatorios?r=estoque"><small>Valor em estoque</small><b>{U.moeda0(C.valorEstoque())}</b><span>{U.plural(S.lista('pecas').filter(p => p.ativo && p.estoque > 0).length, 'item', 'itens')} com saldo</span></a>
    <a className="kpi" href="#/relatorios?r=consumo"><small>Consumo no mês</small><b>{U.moeda0(consumoMes)}</b><span>mês passado: {U.moeda0(consumoAnt)}</span></a>
    {fin ? <>
      <a className={`kpi ${pg > 0 ? '' : 'bom'}`} href="#/financeiro?t=pagar"><small>A pagar em 7 dias</small><b>{U.moeda0(pg)}</b><span>inclui as vencidas</span></a>
      <a className="kpi" href="#/financeiro?t=receber"><small>A receber em 7 dias</small><b>{U.moeda0(rc)}</b><span>inclui as atrasadas</span></a>
    </> : <>
      <a className="kpi" href="#/compras"><small>Pedidos em aberto</small><b>{peds.length}</b><span>{U.moeda0(U.soma(peds, p => C.totalPedido(p)))}</span></a>
      <a className="kpi" href="#/producao"><small>Ordens em andamento</small><b>{ops.length}</b><span>na fila ou produzindo</span></a>
    </>}
  </div>
}

function Chegando() {
  const peds = S.lista('pedidos_compra').filter(p => p.status === 'aguardando').sort((a, b) => (a.prazo || '9') < (b.prazo || '9') ? -1 : 1).slice(0, 6)
  return <section className="card"><div className="card-cab"><h2>Para chegar</h2><a href="#/compras">Ver todos</a></div>
    {peds.length ? <div className="lista">{peds.map(p => <a key={p.id} className="linha" href={'#/pedido/' + p.id}><div className="meio"><b>Nº {p.numero} · {S.get('fornecedores', p.fornecedor_id)?.nome || ''}</b>
      <small>{C.itensDoPedido(p.id).map(i => S.get('pecas', i.peca_id)?.codigo).filter(Boolean).join(', ')}</small></div>
      <div className="lado"><Tag s={C.situacaoPedido(p)} /><small>{p.prazo ? U.relativo(p.prazo) : 'sem prazo'}</small></div></a>)}</div>
      : <p className="sub">Nenhum pedido aguardando.</p>}</section>
}

function Ultimas() {
  const movs = S.lista('movimentos').slice(-8).reverse()
  return <section className="card"><div className="card-cab"><h2>Últimas movimentações</h2><a href="#/movimentos">Ver todas</a></div>
    {movs.length ? <div className="lista">{movs.map(m => <LinhaMov key={m.id} m={m} curta />)}</div> : <p className="sub">Nada lançado ainda.</p>}</section>
}

function MinhasOrdens() {
  const meu = API.sessao?.funcionario_id
  let ords = S.lista('ordens').filter(o => o.status === 'fila' || o.status === 'producao')
  const minhas = meu ? ords.filter(o => o.responsavel_id === meu) : []
  if (minhas.length) ords = minhas
  ords = ords.sort((a, b) => (b.prioridade - a.prioridade) || ((a.prazo || '9') < (b.prazo || '9') ? -1 : 1)).slice(0, 8)
  return <section className="card mt"><div className="card-cab"><h2>{minhas.length ? 'Minhas ordens' : 'Ordens em andamento'}</h2><a href="#/producao">Ver todas</a></div>
    {ords.length ? ords.map(o => <CartaoOrdem key={o.id} o={o} />) : <p className="sub">Nenhuma ordem na fila.</p>}</section>
}

function MinhasRetiradas() {
  const hoje = U.hoje()
  const movs = S.lista('movimentos').filter(m => m.data === hoje && m.criado_por === API.sessao?.uid).reverse()
  return <section className="card mt"><div className="card-cab"><h2>Minhas retiradas de hoje</h2></div>
    {movs.length ? <div className="lista">{movs.map(m => <LinhaMov key={m.id} m={m} curta />)}</div> : <p className="sub">Você ainda não retirou nada hoje.</p>}</section>
}
