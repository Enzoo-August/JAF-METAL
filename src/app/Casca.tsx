/* Casca do sistema: menu lateral, topo (busca e avisos), barra de baixo no celular e a tela da rota atual */
import { Component, Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { API } from '../lib/api.ts'
import { C, S } from '../lib/dados.ts'
import { Perm, type Acao } from '../lib/perm.ts'
import * as U from '../lib/util.ts'
import { aviso, erro, ocupado } from '../ui/avisos.ts'
import { Vazio } from '../ui/base.tsx'
import { useDados, useRota } from '../ui/ganchos.ts'
import { Ic, type NomeIcone } from '../ui/icones.tsx'
import { confirmar, modal, useJanela } from '../ui/janelas.tsx'
import { ROTAS, Telas } from '../telas/index.ts'
import { App } from './controle.tsx'

// menu: [rota, rótulo, ícone, permissão, grupo]
const MENU: [string, string, NomeIcone, Acao, string][] = [
  ['inicio', 'Início', 'inicio', 'todos', ''],
  ['pecas', 'Estoque', 'estoque', 'todos', 'Almoxarifado'],
  ['movimentos', 'Movimentações', 'historico', 'historico_mov', 'Almoxarifado'],
  ['compras', 'Pedidos de compra', 'compras', 'compras', 'Almoxarifado'],
  ['compras/lista', 'Lista de compras', 'lista', 'compras', 'Almoxarifado'],
  ['fornecedores', 'Fornecedores', 'fornecedor', 'compras', 'Almoxarifado'],
  ['producao', 'Ordens de produção', 'producao', 'todos', 'Fábrica'],
  ['maquinas', 'Máquinas e manutenção', 'maquina', 'todos', 'Fábrica'],
  ['financeiro', 'Contas a pagar e receber', 'dinheiro', 'financeiro', 'Gestão'],
  ['financeiro/fluxo', 'Fluxo de caixa', 'relatorio', 'financeiro', 'Gestão'],
  ['clientes', 'Clientes', 'cliente', 'clientes', 'Gestão'],
  ['equipe', 'Equipe', 'equipe', 'todos', 'Gestão'],
  ['relatorios', 'Relatórios', 'relatorio', 'relatorios', 'Gestão'],
  ['admin', 'Administração', 'admin', 'config', 'Sistema'],
  ['ajuda', 'Ajuda', 'ajuda', 'todos', 'Sistema'],
]
const DETALHE: Record<string, string> = { peca: 'pecas', pedido: 'compras', fornecedor: 'fornecedores', maquina: 'maquinas', cliente: 'clientes', funcionario: 'equipe' }

const classeCorpo = (cls: string, on: boolean) => document.body.classList.toggle(cls, on)

export function Casca() {
  useDados()
  const r = useRota()
  const s = API.sessao!
  const [semRede, setSemRede] = useState(!navigator.onLine)

  // ---------------------------------------------------------------- busca de novidades, rede
  useEffect(() => {
    const t = setInterval(() => void App.tick(), 45000)
    const vis = () => { if (document.visibilityState === 'visible') void App.tick(true) }
    const rede = () => setSemRede(!navigator.onLine)
    document.addEventListener('visibilitychange', vis)
    document.addEventListener('jaf:rede', rede)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); document.removeEventListener('jaf:rede', rede); classeCorpo('menu-aberto', false); classeCorpo('busca-aberta', false) }
  }, [])

  // ---------------------------------------------------------------- rota → tela
  const def = ROTAS[r.nome]
  const permitida = !def?.perm || Perm.pode(def.perm)
  const ativo = (r.nome === 'compras' && r.sub === 'lista') ? 'compras/lista' : (r.nome === 'financeiro' && r.sub === 'fluxo') ? 'financeiro/fluxo' : DETALHE[r.nome] || r.nome || 'inicio'
  useLayoutEffect(() => { window.scrollTo(0, 0) }, [r.nome, r.id])
  useEffect(() => {
    const t = def && permitida ? (typeof def.titulo === 'function' ? def.titulo(r) : def.titulo) : ''
    document.title = (t ? t + ' · ' : '') + 'JAF Metal'
  })

  // ---------------------------------------------------------------- menu
  const grupos: { nome: string; itens: (typeof MENU)[number][] }[] = []
  for (const m of MENU) {
    if (!Perm.pode(m[3])) continue
    if (m[0] === 'equipe' && !Perm.pode('equipe_editar') && s.perfil === 'producao') continue
    let g = grupos.find(x => x.nome === m[4])
    if (!g) grupos.push(g = { nome: m[4], itens: [] })
    g.itens.push(m)
  }
  const abas: [string, string, NomeIcone][] = ({
    producao: [['inicio', 'Início', 'inicio'], ['pecas', 'Estoque', 'estoque'], ['retirar', 'Retirar', 'retirar'], ['producao', 'Ordens', 'producao'], ['menu', 'Menu', 'menu']],
    almoxarife: [['inicio', 'Início', 'inicio'], ['pecas', 'Estoque', 'estoque'], ['retirar', 'Retirar', 'retirar'], ['compras', 'Compras', 'compras'], ['menu', 'Menu', 'menu']],
  } as Record<string, [string, string, NomeIcone][]>)[s.perfil] || [['inicio', 'Início', 'inicio'], ['pecas', 'Estoque', 'estoque'], ['retirar', 'Retirar', 'retirar'], ['financeiro', 'Contas', 'dinheiro'], ['menu', 'Menu', 'menu']]

  const hoje = U.hoje()
  const cont: Record<string, number> = {
    'compras/lista': Perm.pode('compras') ? C.listaCompras().filter(x => !x.jaPedido).length : 0,
    compras: S.lista('pedidos_compra').filter(p => p.status === 'aguardando' && p.prazo && p.prazo < hoje).length,
    financeiro: Perm.pode('financeiro') ? S.lista('lancamentos').filter(l => !l.pago_em && l.vencimento <= hoje).length : 0,
    producao: S.lista('ordens').filter(o => (o.status === 'fila' || o.status === 'producao') && o.prazo && o.prazo < hoje).length,
    maquinas: S.lista('manutencoes').filter(m => m.status !== 'concluida' && m.tipo === 'corretiva').length,
  }
  const al = C.alertas()
  const urgentes = al.some(a => a.nivel === 'alto')

  const fecharMenu = () => classeCorpo('menu-aberto', false)
  const retirar = () => { fecharMenu(); void Telas.movimentos.retirar() }
  const sair = async () => { fecharMenu(); if (await confirmar('Sair do sistema neste aparelho?', { ok: 'Sair' })) await App.sair() }

  return (
    <div className="casca">
      <aside className="lateral" id="lateral">
        <div className="lateral-marca"><a href="#/inicio" onClick={fecharMenu}><img src="./assets/logo.png" alt="JAF Metal" /></a>{API.modo === 'teste' && <span className="selo-teste">teste</span>}</div>
        <div className="lateral-acoes">
          <button type="button" className="btn pri" data-acao="retirar" onClick={retirar}><Ic n="retirar" /><span>Retirar peça</span></button>
          {Perm.pode('entrada') && <button type="button" className="btn sec-escuro" data-acao="entrada" onClick={() => { fecharMenu(); void Telas.movimentos.entrada() }}><Ic n="entrada" /><span>Dar entrada</span></button>}
        </div>
        <nav className="lateral-menu">{grupos.map(g => <Fragment key={g.nome}>
          {g.nome && <p className="grupo">{g.nome}</p>}
          {g.itens.map(([rota, rot, ic]) => <a key={rota} href={'#/' + rota} data-rota={rota} className={rota === ativo ? 'on' : ''} onClick={fecharMenu}>
            <Ic n={ic} /><span>{rot}</span><b className="cont" data-cont={rota} hidden={!cont[rota]}>{cont[rota] || ''}</b></a>)}
        </Fragment>)}</nav>
        <div className="lateral-usuario">
          <a href="#/conta" className="usuario" onClick={fecharMenu}><span className="avatar">{(s.nome || '?').trim().charAt(0).toUpperCase()}</span>
            <span><b>{s.nome}</b><small>{Perm.nome(s.perfil)}</small></span></a>
          <button type="button" className="icone-btn" data-acao="sair" title="Sair" aria-label="Sair" onClick={() => void sair()}><Ic n="sair" /></button>
        </div>
      </aside>
      <div className="lateral-fundo" data-acao="fecharMenu" onClick={fecharMenu} />
      <div className="principal">
        <header className="topo">
          <button type="button" className="icone-btn so-celular" data-acao="menu" aria-label="Menu" onClick={() => document.body.classList.toggle('menu-aberto')}><Ic n="menu" /></button>
          <a href="#/inicio" className="topo-marca so-celular"><img src="./assets/logo.png" alt="JAF Metal" /></a>
          <BuscaGeral />
          <div className="topo-acoes">
            <button type="button" className="icone-btn so-celular" data-acao="buscar" aria-label="Buscar" onClick={() => { classeCorpo('busca-aberta', true); document.getElementById('buscaGeral')?.focus() }}><Ic n="busca" /></button>
            <button type="button" className="icone-btn" data-acao="atualizar" title="Buscar novidades" aria-label="Atualizar"
              onClick={(e) => void ocupado(e.currentTarget, async () => { try { await S.carregar(); aviso('Tudo atualizado.') } catch (err) { erro(err) } })}><Ic n="atualizar" /></button>
            <button type="button" className="icone-btn sino" data-acao="alertas" aria-label="Avisos" onClick={() => void painelAlertas()}><Ic n="sino" />
              <b className={`bolinha${urgentes ? ' urgente' : ''}`} hidden={!al.length}>{al.length > 9 ? '9+' : String(al.length)}</b></button>
          </div>
        </header>
        <div id="semRede" className="faixa-rede" hidden={!semRede}><Ic n="alerta" /> Sem internet. Você pode consultar, mas nada é salvo até a conexão voltar.</div>
        <main id="conteudo">
          <div id="view" className="view">
            {!def ? <Vazio icone="alerta" titulo="Página não encontrada"><a className="btn pri" href="#/inicio">Ir para o início</a></Vazio>
              : !permitida ? <Vazio icone="cadeado" titulo="Sem acesso" texto="Seu perfil não abre esta tela."><a className="btn pri" href="#/inicio">Ir para o início</a></Vazio>
              : <Protecao key={r.nome + '|' + (r.id || '')}><def.Tela r={r} /></Protecao>}
          </div>
        </main>
      </div>
      <nav className="abas">{abas.map(([rt, t, ic]) => rt === 'retirar'
        ? <button key={rt} type="button" className="aba aba-central" data-acao="retirar" onClick={retirar}><Ic n={ic} /><span>{t}</span></button>
        : rt === 'menu' ? <button key={rt} type="button" className="aba" data-acao="menu" onClick={() => document.body.classList.toggle('menu-aberto')}><Ic n={ic} /><span>{t}</span></button>
        : <a key={rt} className={`aba ${rt === ativo ? 'on' : ''}`} href={'#/' + rt} data-rota={rt} onClick={fecharMenu}><Ic n={ic} /><span>{t}</span></a>)}</nav>
    </div>)
}

// ---------------------------------------------------------------- erro numa tela não derruba o sistema
class Protecao extends Component<{ children: ReactNode }, { erro: Error | null }> {
  override state = { erro: null as Error | null }
  static getDerivedStateFromError(erro: Error) { return { erro } }
  override componentDidCatch(e: Error) { console.error(e) }
  override render() {
    if (this.state.erro) return <Vazio icone="alerta" titulo="Algo deu errado nesta tela" texto={this.state.erro.message}><a className="btn pri" href="#/inicio">Ir para o início</a></Vazio>
    return this.props.children
  }
}

// ---------------------------------------------------------------- busca rápida de peça no topo
function BuscaGeral() {
  const [t, setT] = useState('')
  const [aberta, setAberta] = useState(false)
  const [sel, setSel] = useState(0)
  const inp = useRef<HTMLInputElement>(null)
  const itens = t.trim() ? U.buscar(S.lista('pecas'), t, p => [p.codigo, p.descricao, p.utilizacao || ''], 8) : []
  const fim = () => { setT(''); setAberta(false); inp.current?.blur(); classeCorpo('busca-aberta', false) }
  return (
    <div className="topo-busca"><span><Ic n="busca" /></span>
      <input ref={inp} id="buscaGeral" type="search" placeholder="Buscar peça pelo código ou nome…" autoComplete="off" aria-label="Buscar peça" value={t}
        onChange={(e) => { setT(e.target.value); setSel(0); setAberta(true) }}
        onFocus={() => setAberta(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && itens[sel]) { location.hash = '#/peca/' + itens[sel].id; fim() }
          else if (e.key === 'ArrowDown') { setSel(Math.min(sel + 1, itens.length - 1)); e.preventDefault() }
          else if (e.key === 'ArrowUp') { setSel(Math.max(sel - 1, 0)); e.preventDefault() }
          else if (e.key === 'Escape') fim()
        }}
        onBlur={() => setTimeout(() => { setAberta(false); classeCorpo('busca-aberta', false) }, 150)} />
      <div className="busca-res" hidden={!aberta || !t.trim()} onPointerDown={(e) => e.preventDefault()}>
        {itens.length ? itens.map((p, n) => <a key={p.id} href={'#/peca/' + p.id} className={n === sel ? 'sel' : ''} onClick={() => setTimeout(fim, 0)}>
          <b>{p.codigo}</b><span>{p.descricao}</span><em>{U.qtd(p.estoque)}</em></a>)
          : <p>Nenhuma peça com “{t.trim()}”.</p>}
      </div>
    </div>)
}

// ---------------------------------------------------------------- avisos do sininho
function painelAlertas() {
  return modal({ titulo: 'Avisos', corpo: <PainelAlertas /> })
}
function PainelAlertas() {
  const j = useJanela()
  const al = C.alertas()
  if (!al.length) return <Vazio icone="ok" titulo="Nada pendente" texto="Quando algo precisar de atenção (peça para comprar, pedido atrasado, conta vencendo…), aparece aqui." />
  return <div className="alertas">{al.map(a => <a key={a.txt} className={`alerta n-${a.nivel}`} href={a.rota} onClick={() => j.fechar()}><Ic n="alerta" /><span>{a.txt}</span><Ic n="seta" /></a>)}</div>
}
