/* Casca do sistema: menu de ÁREAS (lateral), topo (busca e avisos), abas da área, barra de baixo no celular e a tela da rota atual */
import { Component, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { API } from '../lib/api.ts'
import { C, S } from '../lib/dados.ts'
import { Perm } from '../lib/perm.ts'
import * as U from '../lib/util.ts'
import { aviso, erro, ocupado } from '../ui/avisos.ts'
import { Vazio } from '../ui/base.tsx'
import { useDados, useRota } from '../ui/ganchos.ts'
import { Ic } from '../ui/icones.tsx'
import { confirmar, modal, useJanela } from '../ui/janelas.tsx'
import { ROTAS, Telas } from '../telas/index.ts'
import { abasDeBaixo, areaDaRota, areasVisiveis, chaveDaRota, ondeEstou, subsDe } from './areas.ts'
import { App } from './controle.tsx'

const classeCorpo = (cls: string, on: boolean) => document.body.classList.toggle(cls, on)

// números vermelhos ao lado das abas (o que está atrasado/vencido)
function contadores(): Record<string, number> {
  const hoje = U.hoje()
  const c: Record<string, number> = {}
  if (Perm.pode('compras')) {
    c['compras/lista'] = C.listaCompras().filter(x => !x.jaPedido).length
    c.compras = S.lista('pedidos_compra').filter(p => p.status === 'aguardando' && p.prazo && p.prazo < hoje).length
  }
  if (Perm.pode('financeiro')) c.financeiro = S.lista('lancamentos').filter(l => !l.pago_em && l.vencimento <= hoje).length
  if (Perm.pode('pcp')) c.producao = S.lista('ordens').filter(o => (o.status === 'fila' || o.status === 'producao') && o.prazo && o.prazo < hoje).length
  if (Perm.pode('almox')) {
    c.maquinas = S.lista('manutencoes').filter(m => m.status !== 'concluida' && m.tipo === 'corretiva').length
  }
  if (Perm.pode('rh_ver')) for (const a of C.alertasRH()) {
    if (a.nivel !== 'alto') continue
    const k = a.rota.replace(/^#\//, '').split('?')[0]
    c[k] = (c[k] || 0) + a.n
  }
  return c
}

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
  const chave = chaveDaRota(r)
  const { area } = ondeEstou(r)
  const subs = area ? subsDe(area) : []
  useLayoutEffect(() => { window.scrollTo(0, 0) }, [r.nome, r.id])
  useEffect(() => {
    const t = def && permitida ? (typeof def.titulo === 'function' ? def.titulo(r) : def.titulo) : ''
    document.title = (t ? t + ' · ' : '') + 'JAF Metal'
  })

  const cont = contadores()
  const areas = areasVisiveis()
  const al = C.alertas()
  const urgentes = al.some(a => a.nivel === 'alto')
  const podeRetirar = Perm.pode('retirar')
  const baixo = abasDeBaixo(s.perfil)

  const fecharMenu = () => classeCorpo('menu-aberto', false)
  const retirar = () => { fecharMenu(); void Telas.movimentos.retirar() }
  const novaOrdem = () => { fecharMenu(); void Telas.producao.form() }
  const sair = async () => { fecharMenu(); if (await confirmar('Sair do sistema neste aparelho?', { ok: 'Sair' })) await App.sair() }

  return (
    <div className="casca">
      <aside className="lateral" id="lateral">
        <div className="lateral-marca"><a href="#/inicio" onClick={fecharMenu}><img src="./assets/logo.png" alt="JAF Metal" /></a>{API.modo === 'teste' && <span className="selo-teste">teste</span>}</div>
        {podeRetirar && <div className="lateral-acoes">
          <button type="button" className="btn pri" data-acao="retirar" onClick={retirar}><Ic n="retirar" /><span>Retirar peça</span></button>
          {Perm.pode('entrada') && <button type="button" className="btn sec-escuro" data-acao="entrada" onClick={() => { fecharMenu(); void Telas.movimentos.entrada() }}><Ic n="entrada" /><span>Dar entrada</span></button>}
        </div>}
        {!podeRetirar && Perm.pode('producao_editar') && <div className="lateral-acoes">
          <button type="button" className="btn pri" data-acao="novaOrdem" onClick={novaOrdem}><Ic n="mais" /><span>Nova ordem</span></button>
        </div>}
        <nav className="lateral-menu" aria-label="Áreas do sistema">{areas.map(a => {
          const ss = subsDe(a), n = ss.reduce((t, x) => t + (cont[x.rota] || 0), 0)
          return <a key={a.id} href={'#/' + ss[0].rota} data-rota={ss[0].rota} data-area={a.id} className={a.id === area?.id ? 'on' : ''} onClick={fecharMenu}>
            <Ic n={a.ic} /><span>{a.rot}</span><b className="cont" data-cont={a.id} hidden={!n}>{n || ''}</b></a>
        })}</nav>
        <div className="lateral-usuario">
          <a href="#/conta" className="usuario" onClick={fecharMenu}><span className="avatar">{(s.nome || '?').trim().charAt(0).toUpperCase()}</span>
            <span><b>{s.nome}</b><small>{Perm.nome(s.perfil)}</small></span></a>
          <button type="button" className="icone-btn" data-acao="sair" title="Sair" aria-label="Sair" onClick={() => void sair()}><Ic n="sair" /></button>
        </div>
      </aside>
      <div className="lateral-fundo" data-acao="fecharMenu" onClick={fecharMenu} />
      <div className="principal" data-area={area?.id || 'inicio'}>
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
        {subs.length > 1 && <nav className="subabas" aria-label={'Abas de ' + area!.rot}>
          <div className="subabas-lista">{subs.map(x => <a key={x.rota} href={'#/' + x.rota} data-sub={x.rota} className={x.rota === chave ? 'on' : ''} aria-current={x.rota === chave ? 'page' : undefined}>
            {x.rot}{cont[x.rota] ? <b className="cont">{cont[x.rota]}</b> : null}</a>)}</div>
          <a className="subabas-ajuda" href={'#/ajuda?q=' + encodeURIComponent(area!.rot)} title={'Ajuda sobre ' + area!.rot} aria-label={'Ajuda sobre ' + area!.rot}><Ic n="ajuda" /></a>
        </nav>}
        <div id="semRede" className="faixa-rede" hidden={!semRede}><Ic n="alerta" /> Sem internet. Você pode consultar, mas nada é salvo até a conexão voltar.</div>
        <main id="conteudo">
          <div id="view" className="view">
            {!def ? <Vazio icone="alerta" titulo="Página não encontrada"><a className="btn pri" href="#/inicio">Ir para o início</a></Vazio>
              : !permitida ? <Vazio icone="cadeado" titulo="Sem acesso" texto="Seu perfil não abre esta tela."><a className="btn pri" href="#/inicio">Ir para o início</a></Vazio>
              : <Protecao key={r.nome + '|' + (r.id || '')}><def.Tela r={r} /></Protecao>}
          </div>
        </main>
      </div>
      <nav className="abas" aria-label="Atalhos">{baixo.filter(([rt]) => (rt !== 'retirar' || podeRetirar) && (rt !== 'novaOrdem' || Perm.pode('producao_editar'))).map(([rt, t, ic]) => rt === 'retirar' || rt === 'novaOrdem'
        ? <button key={rt} type="button" className="aba aba-central" data-acao={rt} onClick={rt === 'retirar' ? retirar : novaOrdem}><Ic n={ic} /><span>{t}</span></button>
        : rt === 'menu' ? <button key={rt} type="button" className="aba" data-acao="menu" onClick={() => document.body.classList.toggle('menu-aberto')}><Ic n={ic} /><span>{t}</span></button>
        : <a key={rt} className={`aba ${rt === chave || (!baixo.some(x => x[0] === chave) && areaDaRota(rt) === area?.id) ? 'on' : ''}`} href={'#/' + rt} data-rota={rt} onClick={fecharMenu}><Ic n={ic} /><span>{t}</span></a>)}</nav>
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

// ---------------------------------------------------------------- busca do topo: telas, pessoas e peças
interface Achado { k: string; href: string; tipo: 'tela' | 'pessoa' | 'peca'; t: string; d: string; e?: string }
function achar(t: string): Achado[] {
  if (!t.trim()) return []
  const telas = areasVisiveis().flatMap(a => subsDe(a).map(x => ({ a, x })))
  const r: Achado[] = U.buscar(telas, t, ({ a, x }) => [x.rot, a.rot, a.desc, x.chaves || ''], 3)
    .map(({ a, x }) => ({ k: 't' + x.rota, href: '#/' + x.rota, tipo: 'tela', t: x.rot === a.rot ? a.rot : `${a.rot} › ${x.rot}`, d: 'Abrir a tela' }))
  if (Perm.pode('rh_ver') || Perm.pode('almox') || Perm.pode('pcp')) {
    const pessoas = U.buscar(S.lista('funcionarios'), t, f => [f.nome, f.funcao || '', f.setor || '', f.matricula || ''], 4)
    r.push(...pessoas.map(f => ({ k: 'f' + f.id, href: '#/funcionario/' + f.id, tipo: 'pessoa' as const, t: f.nome, d: [f.funcao, f.setor].filter(Boolean).join(' · ') || 'Pessoa', e: f.ativo ? '' : 'desligado' })))
  }
  if (Perm.pode('estoque_ver')) {
    const pecas = U.buscar(S.lista('pecas'), t, p => [p.codigo, p.descricao, p.utilizacao || ''], 6)
    r.push(...pecas.map(p => ({ k: 'p' + p.id, href: '#/peca/' + p.id, tipo: 'peca' as const, t: p.codigo, d: p.descricao, e: U.qtd(p.estoque) })))
  }
  return r
}
function BuscaGeral() {
  const [t, setT] = useState('')
  const [aberta, setAberta] = useState(false)
  const [sel, setSel] = useState(0)
  const inp = useRef<HTMLInputElement>(null)
  const itens = achar(t)
  const fim = () => { setT(''); setAberta(false); inp.current?.blur(); classeCorpo('busca-aberta', false) }
  const dica = [Perm.pode('estoque_ver') && 'peça', (Perm.pode('rh_ver') || Perm.pode('almox') || Perm.pode('pcp')) && 'pessoa', 'tela'].filter(Boolean).join(', ')
  return (
    <div className="topo-busca"><span><Ic n="busca" /></span>
      <input ref={inp} id="buscaGeral" type="search" placeholder={`Buscar ${dica}…`} autoComplete="off" aria-label="Buscar" value={t}
        onChange={(e) => { setT(e.target.value); setSel(0); setAberta(true) }}
        onFocus={() => setAberta(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && itens[sel]) { location.hash = itens[sel].href; fim() }
          else if (e.key === 'ArrowDown') { setSel(Math.min(sel + 1, itens.length - 1)); e.preventDefault() }
          else if (e.key === 'ArrowUp') { setSel(Math.max(sel - 1, 0)); e.preventDefault() }
          else if (e.key === 'Escape') fim()
        }}
        onBlur={() => setTimeout(() => { setAberta(false); classeCorpo('busca-aberta', false) }, 150)} />
      <div className="busca-res" hidden={!aberta || !t.trim()} onPointerDown={(e) => e.preventDefault()}>
        {itens.length ? itens.map((x, n) => <a key={x.k} href={x.href} data-tipo={x.tipo} className={n === sel ? 'sel' : ''} onClick={() => setTimeout(fim, 0)}>
          <Ic n={x.tipo === 'tela' ? 'seta' : x.tipo === 'pessoa' ? 'equipe' : 'estoque'} /><b>{x.t}</b><span>{x.d}</span><em>{x.e || ''}</em></a>)
          : <p>Nada encontrado com “{t.trim()}”.</p>}
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
  if (!al.length) return <Vazio icone="ok" titulo="Nada pendente" texto="Quando algo precisar de atenção (peça para comprar, férias vencendo, exame vencido…), aparece aqui." />
  return <div className="alertas">{al.map(a => <a key={a.txt} className={`alerta n-${a.nivel}${a.pisca ? ' pisca' : ''}`} href={a.rota} onClick={() => j.fechar()}><Ic n="alerta" /><span>{a.txt}</span><Ic n="seta" /></a>)}</div>
}
