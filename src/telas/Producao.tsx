/* Produção: ordens de produção */
import { App } from '../app/controle.tsx'
import { API, ErroApp, traduzir } from '../lib/api.ts'
import { C, S } from '../lib/dados.ts'
import { Perm } from '../lib/perm.ts'
import type { Ordem } from '../lib/tipos.ts'
import * as U from '../lib/util.ts'
import { aviso } from '../ui/avisos.ts'
import { BuscaLista, Btn, Cab, Campo, Chips, Dl, Tag, Texto, Vazio } from '../ui/base.tsx'
import { ComboCliente, ComboFuncionario, ComboMaquina } from '../ui/Combo.tsx'
import { useLembrar } from '../ui/ganchos.ts'
import { Ic } from '../ui/icones.tsx'
import { confirmar, lerForm, modal, useJanela, type BotaoJanela } from '../ui/janelas.tsx'
import { useState } from 'react'

export function CartaoOrdem({ o }: { o: Ordem }) {
  const sit = C.situacaoOrdem(o), maq = S.get('maquinas', o.maquina_id), resp = S.get('funcionarios', o.responsavel_id)
  const pct = o.qtd ? Math.min(100, o.produzido / o.qtd * 100) : 0
  return <div className={`op ${sit.atrasada ? 'atrasada' : ''} ${o.prioridade ? 'urgente' : ''}`} data-ordem={o.id} role="button" tabIndex={0}
    onClick={() => void abrir(o.id)} onKeyDown={(e) => { if (e.key === 'Enter') void abrir(o.id) }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>OP {o.numero} · {o.produto}</b>{o.prioridade ? <span className="tag t-amarelo">Urgente</span> : null}</div>
    <small>{[o.cliente_nome, o.pedido_cliente, o.codigo].filter(Boolean).join(' · ')}</small>
    <small>{U.qtd(o.produzido)} de {U.qtd(o.qtd)} {o.unidade}{maq ? ' · ' + maq.nome : ''}{resp ? ' · ' + resp.nome.split(' ')[0] : ''}</small>
    <small style={{ color: `var(--${sit.atrasada ? 'vermelho' : 'texto-2'})`, fontWeight: sit.atrasada ? 700 : 400 }}>{o.prazo ? (sit.atrasada ? 'Atrasada · era para ' + U.data(o.prazo) : 'Prazo ' + U.relativo(o.prazo)) : 'Sem prazo'}</small>
    <div className="progresso"><i style={{ width: `${pct}%` }} /></div></div>
}

const ordenar = (l: Ordem[]) => l.slice().sort((a, b) => (b.prioridade - a.prioridade) || ((a.prazo || '9999') < (b.prazo || '9999') ? -1 : (a.prazo || '9999') > (b.prazo || '9999') ? 1 : a.numero - b.numero))

export function TelaProducao() {
  const [busca, setBusca] = useLembrar('op.busca', '')
  const [maq, setMaq] = useLembrar('op.maq', '')
  const [ver, setVer] = useLembrar('op.ver', 'quadro')
  let l = S.lista('ordens')
  if (maq) l = l.filter(o => o.maquina_id === maq)
  if (busca.trim()) l = U.buscar(l, busca, o => [String(o.numero), o.produto, o.codigo || '', o.cliente_nome || '', o.pedido_cliente || ''])
  const coluna = (st: string, tit: string) => { const it = ordenar(l.filter(o => o.status === st))
    return <div className="coluna"><h3><span>{tit}</span><span className="sub">{it.length}</span></h3>{it.length ? it.map(o => <CartaoOrdem key={o.id} o={o} />) : <p className="sub" style={{ padding: 4 }}>Nada aqui.</p>}</div> }
  const encerradas = l.filter(o => o.status === (ver === 'entregues' ? 'entregue' : 'cancelada')).sort((a, b) => (b.entregue_em || b.atualizado_em) < (a.entregue_em || a.atualizado_em) ? -1 : 1)
  return <>
    <Cab titulo="Ordens de produção" sub="O que a fábrica tem para fazer, por prazo">{Perm.pode('producao_editar') && <Btn txt="Nova ordem" icone="mais" cls="pri" data-o="nova" onClick={() => void form()} />}</Cab>
    <div className="barra-filtros"><BuscaLista id="bOP" valor={busca} placeholder="Nº, produto, cliente, pedido…" aoMudar={setBusca} />
      <select id="oMaq" aria-label="Máquina" value={maq} onChange={(e) => setMaq(e.target.value)}><option value="">Todas as máquinas</option>
        {U.ordenar(S.lista('maquinas').filter(m => m.ativo), m => U.sem(m.nome)).map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}</select></div>
    <Chips nome="ver" atual={ver} aoEscolher={setVer} opcoes={[{ v: 'quadro', t: 'Em andamento' }, { v: 'entregues', t: 'Entregues' }, { v: 'canceladas', t: 'Canceladas' }]} />
    <div id="opArea" className="mt">{ver === 'quadro'
      ? <div className="kanban">{coluna('fila', 'Na fila')}{coluna('producao', 'Produzindo')}{coluna('pronta', 'Pronta para entregar')}</div>
      : encerradas.length ? <div className="lista">{encerradas.map(o => <div key={o.id} className="linha clicavel" data-ordem={o.id} onClick={() => void abrir(o.id)}><div className="meio"><b>OP {o.numero} · {o.produto}</b>
        <small>{[o.cliente_nome, o.pedido_cliente].filter(Boolean).join(' · ')}{o.entregue_em ? ' · entregue ' + U.data(o.entregue_em) : ''}{o.prazo && o.entregue_em ? (o.entregue_em > o.prazo ? ` · ${U.plural(U.dias(o.prazo, o.entregue_em), 'dia')} depois do prazo` : ' · no prazo') : ''}</small></div>
        <div className="lado"><b>{U.qtd(o.produzido)} {o.unidade}</b></div></div>)}</div>
      : <Vazio icone="producao" titulo="Nada aqui" />}</div>
  </>
}

// ---------------------------------------------------------------- detalhe e ações
export async function abrir(id: string): Promise<void> {
  const o = S.get('ordens', id); if (!o) return
  const encerrada = o.status === 'entregue' || o.status === 'cancelada'
  const botoes: BotaoJanela[] = []
  const mudar = (status: Ordem['status'], txt: string, cls = 'pri'): BotaoJanela => ({ txt, cls, acao: async (f) => {
    const d = lerForm(f)
    let prod: number | null = d.produzido ?? null
    if (status === 'pronta') {
      // não mexeu no número: pronta = quantidade toda. Mexeu e ficou menor: confirma.
      if (prod === null || prod === o.produzido) prod = null
      else if (prod < o.qtd && !(await confirmar(`Ficou pronta com ${U.qtd(prod)} de ${U.qtd(o.qtd)} ${o.unidade}?`, { ok: `Sim, ${U.qtd(prod)}`, nao: 'Corrigir' }))) return false
    }
    await API.rpc('ordem_status', { p: { id: o.id, status, produzido: prod, obs: d.nota || null } })
    await App.gravou(['ordens'])
    aviso(`OP ${o.numero}: ${C.situacaoOrdem(S.get('ordens', o.id)!).txt.toLowerCase()}.`)
  } })
  if (!encerrada) {
    if (o.status === 'fila') botoes.push(mudar('producao', 'Começar a produzir'))
    if (o.status === 'producao') botoes.push(mudar('producao', 'Salvar quantidade', 'sec'), mudar('pronta', 'Marcar como pronta', 'verde'))
    if (o.status === 'pronta') { botoes.push(mudar('producao', 'Voltar para produção', 'sec')); if (Perm.pode('entregar')) botoes.push({ txt: 'Entregue', cls: 'verde', acao: () => entregar(o) }) }
  }
  await modal({ titulo: `OP ${o.numero} — ${o.produto}`, corpo: <DetalheOrdem o={o} />, botoes })
}

function DetalheOrdem({ o }: { o: Ordem }) {
  const j = useJanela()
  const sit = C.situacaoOrdem(o)
  const encerrada = o.status === 'entregue' || o.status === 'cancelada'
  const acao = async (status: string, obs: string, msg: string) => {
    try { await API.rpc('ordem_status', { p: { id: o.id, status, obs } }); await App.gravou(['ordens']); j.limparSujo(); j.fechar(); aviso(msg) } catch (err) { j.erro(traduzir(err).message) }
  }
  return <>
    <p><Tag s={sit} /> {o.prioridade ? <span className="tag t-amarelo">Urgente</span> : null}</p>
    <Dl pares={[['Cliente', o.cliente_nome || ''], ['Pedido do cliente', o.pedido_cliente || ''], ['Código', o.codigo || ''],
      ['Quantidade', `${U.qtd(o.qtd)} ${o.unidade}`], ['Prazo', o.prazo ? U.data(o.prazo) + (sit.atrasada ? ' (atrasada)' : '') : ''], ['Máquina', S.get('maquinas', o.maquina_id)?.nome || ''],
      ['Responsável', S.get('funcionarios', o.responsavel_id)?.nome || ''], ['Começou', o.iniciada_em ? U.dataHora(o.iniciada_em) : ''], ['Ficou pronta', o.pronta_em ? U.dataHora(o.pronta_em) : ''],
      ['Entregue', o.entregue_em ? U.data(o.entregue_em) : ''], ['Criada por', S.nomeUsuario(o.criado_por)]]} />
    {o.obs && <p className="mt"><b>Observações</b><br /><Texto t={o.obs} /></p>}
    {!encerrada && o.status !== 'fila' && <div className="mt"><Campo nome="produzido" rotulo={`Quantas já foram feitas (de ${U.qtd(o.qtd)})`} tipo="qtd" valor={U.campoNum(o.produzido, 3)} /></div>}
    {!encerrada && <Campo nome="nota" rotulo="Anotação (opcional)" placeholder="Fica registrada na ordem" />}
    {!encerrada && Perm.pode('producao_editar') && <div className="grupo-btn mt">
      <button type="button" className="btn fantasma mini" data-x="editar" onClick={() => { j.limparSujo(); j.fechar(); void form(o) }}><Ic n="lapis" /><span>Editar ordem</span></button>
      {Perm.pode('entregar') && <button type="button" className="btn perigo-txt mini" data-x="cancelar" onClick={async () => {
        if (await confirmar(`Cancelar a OP ${o.numero}?`, { ok: 'Cancelar ordem', perigo: true })) await acao('cancelada', 'Cancelada', 'Ordem cancelada.')
      }}><Ic n="x" /><span>Cancelar ordem</span></button>}</div>}
    {encerrada && Perm.pode('entregar') && <div className="grupo-btn mt"><button type="button" className="btn fantasma mini" data-x="reabrir" onClick={() => void acao('pronta', 'Reaberta', 'Ordem reaberta.')}><Ic n="desfazer" /><span>Reabrir (voltar para pronta)</span></button></div>}
  </>
}

async function entregar(o: Ordem): Promise<boolean> {
  const fin = Perm.pode('financeiro')
  const jaTem = S.lista('lancamentos').some(l => l.ordem_id === o.id)
  const r = await modal({
    titulo: `Entregar OP ${o.numero}`,
    corpo: <FormEntrega mostrarConta={fin && !jaTem} />,
    botoes: [{ txt: 'Confirmar entrega', cls: 'verde', acao: async (f) => {
      const d = lerForm(f)
      if (d.lancar && !(d.valor > 0)) throw new ErroApp('Informe o valor a receber ou desmarque "lançar a conta".')
      await API.rpc('ordem_status', { p: { id: o.id, status: 'entregue', entregue_em: d.data } })
      if (d.lancar && d.valor > 0) await API.rpc('salvar_lancamento', { p: { tipo: 'receber', descricao: `${o.cliente_nome || 'Cliente'} — OP ${o.numero}${o.pedido_cliente ? ' (' + o.pedido_cliente + ')' : ''}`,
        categoria: /upgrade/i.test(o.cliente_nome || '') ? 'Upgrade' : 'Venda de peças / serviços', valor: d.valor, vencimento: d.venc, parcelas: d.parc, intervalo: '30', cliente_id: o.cliente_id, ordem_id: o.id } })
      await App.gravou(['ordens', 'lancamentos'])
      aviso(`OP ${o.numero} entregue.`)
    } }],
  })
  return !!r
}
function FormEntrega({ mostrarConta }: { mostrarConta: boolean }) {
  const [lancar, setLancar] = useState(true)
  return <>
    <Campo nome="data" rotulo="Data da entrega" tipo="date" valor={U.hoje()} />
    {mostrarConta && <>
      <label className="check"><input type="checkbox" name="lancar" checked={lancar} onChange={(e) => setLancar(e.target.checked)} /> <span>Lançar a conta a receber agora</span></label>
      <div id="eConta" className="linha-campos l3" hidden={!lancar}>
        <Campo nome="valor" rotulo="Valor" tipo="dinheiro" />
        <Campo nome="venc" rotulo="Vencimento" tipo="date" valor={U.somaDias(U.hoje(), 28)} />
        <Campo nome="parc" rotulo="Parcelas" tipo="select" opcoes={[1, 2, 3, 4].map(n => ({ v: n, t: n === 1 ? '1×' : n + '× (30 dias)' }))} />
      </div></>}
  </>
}

export async function form(o?: Partial<Ordem> | null): Promise<unknown> {
  const novo = !o?.id
  const b: Partial<Ordem> = o || { unidade: 'pç', prioridade: 0 }
  const r = await modal<{ id: string; numero: number }>({
    titulo: novo ? 'Nova ordem de produção' : `Editar OP ${b.numero}`,
    corpo: <>
      {Perm.pode('clientes') ? <ComboCliente id="oCli" nome="cliente_id" rotulo="Cliente" placeholder="Digite para buscar" inicial={S.get('clientes', b.cliente_id)} />
        : <Campo nome="cliente_nome" rotulo="Cliente" valor={b.cliente_nome} />}
      <div className="linha-campos"><Campo nome="pedido_cliente" rotulo="Pedido do cliente" valor={b.pedido_cliente} placeholder="Ex.: PC 016/26" />
        <Campo nome="codigo" rotulo="Código do produto" valor={b.codigo} /></div>
      <Campo nome="produto" rotulo="Produto" valor={b.produto} req />
      <div className="linha-campos l3"><Campo nome="qtd" rotulo="Quantidade" tipo="qtd" valor={U.campoNum(b.qtd, 3)} req />
        <Campo nome="unidade" rotulo="Unidade" tipo="select" valor={b.unidade} opcoes={['pç', 'un', 'kg', 'm', 'jogo', 'cx'].map(v => ({ v, t: v }))} />
        <Campo nome="prazo" rotulo="Prazo" tipo="date" valor={b.prazo} /></div>
      <div className="linha-campos"><ComboMaquina id="oMaqF" nome="maquina_id" rotulo="Máquina" placeholder="Onde vai ser feita" inicial={S.get('maquinas', b.maquina_id)} />
        <ComboFuncionario id="oResp" nome="responsavel_id" rotulo="Responsável" placeholder="Quem vai fazer" inicial={S.get('funcionarios', b.responsavel_id)} /></div>
      <Campo nome="prioridade" rotulo="Urgente (vai para o topo da fila)" tipo="check" valor={b.prioridade === 1} />
      <Campo nome="obs" rotulo="Observações" tipo="area" valor={b.obs} linhas={2} />
    </>,
    botoes: [{ txt: novo ? 'Criar ordem' : 'Salvar', acao: async (f) => {
      const d = lerForm(f)
      d.prioridade = d.prioridade ? 1 : 0
      if (!f.dataset.envio) f.dataset.envio = b.id || U.uuid()
      const res = await API.rpc<{ id: string; numero: number }>('salvar_ordem', { p: { ...d, id: f.dataset.envio, cliente_nome: d.cliente_nome || b.cliente_nome || null } })
      await App.gravou(['ordens'])
      aviso(novo ? `OP ${res.numero} criada.` : 'Ordem salva.')
      return res
    } }],
  })
  if (r && novo && !location.hash.startsWith('#/producao')) location.hash = '#/producao'
  return r
}
