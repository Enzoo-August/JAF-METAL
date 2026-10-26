/* Pedacinhos de tela usados em todo o sistema (mesmas classes do visual de antes) */
import { useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react'
import type { Situacao } from '../lib/tipos.ts'
import { Ic, type NomeIcone } from './icones.tsx'
import { erro } from './avisos.ts'

export const Tag = ({ s }: { s: Pick<Situacao, 'txt' | 'cor'> }) => <span className={`tag t-${s.cor}`}>{s.txt}</span>

export function Vazio({ icone, titulo, texto, children }: { icone: NomeIcone; titulo: string; texto?: ReactNode; children?: ReactNode }) {
  return <div className="vazio"><Ic n={icone} /><b>{titulo}</b>{texto ? <p>{texto}</p> : null}{children}</div>
}

export interface OpcaoChip { v: string; t: string; n?: number | null }
export function Chips({ opcoes, atual, aoEscolher, nome = 'f' }: { opcoes: OpcaoChip[]; atual: string; aoEscolher: (v: string) => void; nome?: string }) {
  return <div className="chips" role="tablist">{opcoes.map(o =>
    <button key={o.v} type="button" className={`chip ${o.v === atual ? 'on' : ''}`} {...{ ['data-' + nome]: o.v }} onClick={() => aoEscolher(o.v)}>
      {o.t}{o.n !== undefined && o.n !== null ? <> <span className="n">{o.n}</span></> : null}</button>)}</div>
}

export function Cab({ titulo, sub, children }: { titulo: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return <header className="cab"><div><h1>{titulo}</h1>{sub ? <p className="sub">{sub}</p> : null}</div>{children ? <div className="acoes">{children}</div> : null}</header>
}

export const Voltar = ({ para, txt = 'Voltar' }: { para: string; txt?: string }) => <a className="voltar" href={para}><Ic n="voltar" /> {txt}</a>

// botão; se onClick devolve Promise, fica "ocupado" (anti toque duplo) até terminar e mostra o erro como aviso
export function Btn({ txt, icone, cls = 'sec', onClick, ...resto }: { txt: string; icone?: NomeIcone; cls?: string; onClick?: (el: HTMLButtonElement) => unknown }
  & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type'> & { [k: `data-${string}`]: string }) {
  const trava = useRef(false)
  const [ocup, setOcup] = useState(false)
  const el = useRef<HTMLButtonElement>(null)
  const clicar = async () => {
    if (!onClick || trava.current) return
    const r = onClick(el.current!)
    if (!(r instanceof Promise)) return
    trava.current = true; setOcup(true)
    try { await r } catch (e) { erro(e) } finally { trava.current = false; setOcup(false) }
  }
  return <button ref={el} type="button" className={`btn ${cls}${ocup ? ' carregando' : ''}`} disabled={ocup} onClick={() => void clicar()} {...(resto as object)}>
    {icone && <Ic n={icone} />}<span>{txt}</span></button>
}

export function Dl({ pares }: { pares: ([string, ReactNode] | null | false | undefined)[] }) {
  const ok = pares.filter((p): p is [string, ReactNode] => !!p && p[1] !== null && p[1] !== undefined && p[1] !== '' && p[1] !== false)
  if (!ok.length) return null
  return <dl className="dl">{ok.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
}
export const temDl = (pares: ([string, ReactNode] | null | false | undefined)[]): boolean =>
  pares.some(p => !!p && p[1] !== null && p[1] !== undefined && p[1] !== '' && p[1] !== false)

// texto com quebras de linha preservadas
export const Texto = ({ t }: { t: string | null | undefined }) => <>{String(t || '').split('\n').map((l, n, a) => <span key={n}>{l}{n < a.length - 1 && <br />}</span>)}</>

// ------------------------------------------------------------------ campos de formulário (não controlados: o React não apaga o que foi digitado)
type TipoCampo = 'text' | 'tel' | 'email' | 'date' | 'time' | 'month' | 'password' | 'search' | 'num' | 'dinheiro' | 'qtd' | 'select' | 'area' | 'check'
export interface PropsCampo {
  nome: string
  rotulo: string
  tipo?: TipoCampo
  valor?: string | number | boolean | null
  req?: boolean
  opcoes?: { v: string | number; t: string }[]
  ajuda?: ReactNode
  cls?: string
  placeholder?: string
  linhas?: number
  auto?: string
  foco?: boolean
  id?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputRef?: Ref<any>
  // atributos extras do campo (max, list, maxLength, onInput…)
  attrs?: Record<string, unknown>
}
export function Campo({ nome, rotulo, tipo = 'text', valor, req, opcoes, ajuda, cls = '', placeholder, linhas, auto, foco, id: idFixo, inputRef, attrs = {} }: PropsCampo) {
  const gerado = useId()
  const id = idFixo || 'c_' + nome + gerado.replace(/:/g, '')
  const v = valor === null || valor === undefined ? '' : valor
  const extra = { ...(foco ? { 'data-autofocus': '1' } : {}), ...attrs, ...(inputRef ? { ref: inputRef } : {}) } as Record<string, unknown>
  if (tipo === 'check') {
    return <label className={`check ${cls}`.trim()}><input type="checkbox" name={nome} defaultChecked={!!valor} {...extra} /> <span>{rotulo}</span></label>
  }
  let input: ReactNode
  if (tipo === 'select') {
    input = <select id={id} name={nome} required={req} defaultValue={String(v)} {...extra}>{(opcoes || []).map(o => <option key={String(o.v)} value={o.v}>{o.t}</option>)}</select>
  } else if (tipo === 'area') {
    input = <textarea id={id} name={nome} rows={linhas || 3} required={req} placeholder={placeholder} defaultValue={String(v)} {...extra} />
  } else if (tipo === 'num' || tipo === 'dinheiro' || tipo === 'qtd') {
    input = <input id={id} name={nome} inputMode="decimal" autoComplete="off" data-num={tipo} defaultValue={String(v)} required={req} placeholder={placeholder} {...extra} />
    if (tipo === 'dinheiro') input = <div className="prefixo"><span>R$</span>{input}</div>
  } else {
    input = <input id={id} name={nome} type={tipo} defaultValue={String(v)} required={req} placeholder={placeholder} autoComplete={auto || 'off'} {...extra} />
  }
  return <div className={`campo ${cls}`.trim()}><label htmlFor={id}>{rotulo}{req && <> <i className="req">*</i></>}</label>{input}{ajuda ? <small>{ajuda}</small> : null}</div>
}

// mostra mais itens de uma lista longa aos poucos
export function Paginado<T>({ itens, passo = 60, render, vazio }: { itens: T[]; passo?: number; render: (x: T) => ReactNode; vazio?: ReactNode }) {
  const [n, setN] = useState(passo)
  if (!itens.length) return <div className="lista"><div data-pagina>{vazio}</div></div>
  return <div className="lista"><div data-pagina>{itens.slice(0, n).map(render)}</div>
    <button type="button" className="mais-btn" data-mais hidden={n >= itens.length} onClick={() => setN(n + passo)}><span>Mostrar mais ({Math.max(0, itens.length - n)})</span></button></div>
}

// campo de busca de lista (lupa + texto)
export function BuscaLista({ id, valor, placeholder, aoMudar }: { id: string; valor: string; placeholder: string; aoMudar: (v: string) => void }) {
  return <div className="busca-lista"><Ic n="busca" /><input type="search" id={id} placeholder={placeholder} defaultValue={valor} autoComplete="off" onChange={(e) => aoMudar(e.target.value)} /></div>
}
