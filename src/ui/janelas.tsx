/* Janelas (modais) e perguntas de confirmação.
 * Proteções que vieram da versão anterior e continuam valendo:
 *  - toque duplo no botão não grava duas vezes (trava síncrona por botão + janela "fechada")
 *  - fechar com algo digitado pergunta antes; atualização dos dados não apaga o que foi digitado
 *  - depois de fechar, um "escudo" segura toques por um instante (o 2º toque não atravessa a janela)
 *  - erro aparece DENTRO da janela, que continua aberta */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { traduzir } from '../lib/api.ts'
import { num } from '../lib/util.ts'
import { escudo, posicionarAvisos } from './avisos.ts'
import { Ic, type NomeIcone } from './icones.tsx'
import { useDados } from './ganchos.ts'

export interface Janela {
  form: HTMLFormElement | null
  fechada: boolean
  erro(msg: string): void
  fechar(valor?: unknown): void
  limparSujo(): void
}
export interface BotaoJanela {
  txt: string
  cls?: string
  icone?: NomeIcone
  validar?: boolean
  // devolve false para manter a janela aberta; qualquer outro valor fecha e vira o resultado
  acao: (form: HTMLFormElement, j: Janela) => unknown
}
export interface OptJanela {
  titulo: string
  corpo?: ReactNode
  botoes?: BotaoJanela[]
  largura?: 'larga' | ''
  fecharTxt?: string
  peExtra?: ReactNode
}
interface OptConfirmar { detalhe?: string; ok?: string; nao?: string; perigo?: boolean }

type Item =
  | { id: number; tipo: 'janela'; opt: OptJanela; j: JanelaInterna; saindo: boolean }
  | { id: number; tipo: 'confirmar'; texto: string; opt: OptConfirmar; fim: (v: boolean) => void }

interface JanelaInterna extends Janela { _erro: (m: string) => void; _resolver: (v: unknown) => void; _tecla?: (e: KeyboardEvent) => void }

// ------------------------------------------------------------------ pilha de janelas (fora do React, para abrir de qualquer lugar)
let pilha: Item[] = []
let seq = 0
const ouvintes = new Set<() => void>()
const mudou = () => { pilha = pilha.slice(); for (const f of ouvintes) f() }
const ouvir = (f: () => void) => { ouvintes.add(f); return () => { ouvintes.delete(f) } }

export const janelaAberta = (): boolean => pilha.some(x => x.tipo === 'janela' && !x.saindo)

export function modal<T = unknown>(opt: OptJanela): Promise<T | null> {
  return new Promise((resolver) => {
    const id = ++seq
    const j: JanelaInterna = {
      form: null, fechada: false,
      _erro: () => {},
      _resolver: resolver as (v: unknown) => void,
      erro(msg) { this._erro(msg || '') },
      limparSujo() { if (this.form) delete this.form.dataset.sujo },
      fechar(valor) {
        if (this.fechada) return
        this.fechada = true
        escudo()
        const it = pilha.find(x => x.id === id)
        if (it && it.tipo === 'janela') it.saindo = true
        mudou()
        if (this._tecla) document.removeEventListener('keydown', this._tecla)
        setTimeout(() => { pilha = pilha.filter(x => x.id !== id); mudou(); posicionarAvisos() }, 180)
        this._resolver(valor === undefined ? null : valor)
      },
    }
    pilha.push({ id, tipo: 'janela', opt, j, saindo: false })
    mudou()
  })
}

export function confirmar(texto: string, opt: OptConfirmar = {}): Promise<boolean> {
  return new Promise((ok) => {
    // já tem uma pergunta na tela (toque duplo): a segunda vale como "não"
    if (pilha.some(x => x.tipo === 'confirmar')) { ok(false); return }
    const id = ++seq
    pilha.push({ id, tipo: 'confirmar', texto, opt, fim: (v) => { pilha = pilha.filter(x => x.id !== id); mudou(); ok(v) } })
    mudou()
  })
}

// fecha tudo na hora (troca de usuário e testes automáticos)
export function fecharTodas(): void {
  for (const x of pilha) {
    if (x.tipo === 'janela') { x.j.fechada = true; if (x.j._tecla) document.removeEventListener('keydown', x.j._tecla); x.j._resolver(null) }
    else x.fim(false)
  }
  pilha = []
  mudou()
}

// ------------------------------------------------------------------ leitura do formulário
// campos com data-num viram número; combos (data-combo-id) viram o id escolhido; checkbox vira true/false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DadosForm = Record<string, any>
export function lerForm(form: HTMLElement): DadosForm {
  const o: DadosForm = {}
  for (const el of form.querySelectorAll<HTMLInputElement>('input[name], select[name], textarea[name]')) {
    if (el.type === 'checkbox') o[el.name] = el.checked
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value }
    else if (el.dataset.num) o[el.name] = num(el.value)
    else if (el.dataset.comboId !== undefined) o[el.name] = el.dataset.comboId || null
    else o[el.name] = el.value.trim()
  }
  return o
}

// ------------------------------------------------------------------ contexto: a janela em que o conteúdo está
const Ctx = createContext<Janela | null>(null)
export const useJanela = (): Janela => {
  const j = useContext(Ctx)
  if (!j) throw new Error('useJanela fora de uma janela')
  return j
}

// ------------------------------------------------------------------ desenho
export function Janelas() {
  const lista = useSyncExternalStore(ouvir, () => pilha)
  useDados() // os dados mudaram: o conteúdo das janelas abertas acompanha (o que foi digitado fica)
  useEffect(() => {
    document.body.classList.toggle('com-janela', lista.some(x => x.tipo === 'janela'))
    posicionarAvisos()
  }, [lista])
  return <>{lista.map(x => x.tipo === 'janela' ? <JanelaView key={x.id} item={x} /> : <Confirmar key={x.id} item={x} />)}</>
}

function JanelaView({ item }: { item: Extract<Item, { tipo: 'janela' }> }) {
  const { opt, j } = item
  const fundo = useRef<HTMLDivElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const caixaErro = useRef<HTMLDivElement>(null)
  const [erro, setErro] = useState('')
  const [aberta, setAberta] = useState(false)
  const travas = useRef(new Set<number>())
  const [ocupados, setOcupados] = useState<number[]>([])
  const idTitulo = 'j' + item.id

  j._erro = setErro

  const tentarFechar = async () => {
    if (form.current?.dataset.sujo && !(await confirmar('Sair sem salvar? O que você digitou será perdido.', { ok: 'Sair sem salvar', perigo: true }))) return
    j.fechar(null)
  }

  useLayoutEffect(() => {
    const f = form.current!
    j.form = f
    const sujar = (e: Event) => { if ((e.target as Element).matches('input,textarea,select')) f.dataset.sujo = '1' }
    f.addEventListener('input', sujar)
    f.addEventListener('change', sujar)
    const tecla = (e: KeyboardEvent) => {
      const topo = [...pilha].reverse().find(x => x.tipo === 'janela' && !x.saindo)
      if (e.key === 'Escape' && topo && topo.id === item.id) { e.preventDefault(); void tentarFechar() }
    }
    j._tecla = tecla
    document.addEventListener('keydown', tecla)
    const raf = requestAnimationFrame(() => {
      setAberta(true)
      setTimeout(posicionarAvisos, 200) // depois da animação de abrir
      const primeiro = f.querySelector<HTMLElement>('[data-autofocus]') ||
        (matchMedia('(pointer: fine)').matches ? f.querySelector<HTMLElement>('input:not([type=checkbox]):not([type=radio]):not([readonly]),select,textarea') : null)
      primeiro?.focus({ preventScroll: true })
    })
    return () => { cancelAnimationFrame(raf); f.removeEventListener('input', sujar); f.removeEventListener('change', sujar); document.removeEventListener('keydown', tecla) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { if (erro) caixaErro.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [erro])

  const clicar = async (b: BotaoJanela, n: number) => {
    if (travas.current.has(n)) return // toque duplo: a trava é síncrona, vale antes de redesenhar
    travas.current.add(n); setOcupados(o => [...o, n])
    try {
      if (j.fechada) return // janela já concluída (sumindo): toque a mais não faz nada
      setErro('')
      const f = form.current!
      if (b.validar !== false) {
        const inval = [...f.querySelectorAll<HTMLInputElement>('[required]')].find(c => c.dataset.comboId !== undefined ? !c.dataset.comboId : !String(c.value || '').trim())
        if (inval) {
          setErro('Preencha: ' + (inval.closest('.campo')?.querySelector('label')?.textContent?.replace(/\*/g, '').trim() || 'campo obrigatório'))
          const alvo = (inval.dataset.busca ? inval.parentElement?.querySelector('input') : inval) as HTMLElement | null
          alvo?.focus(); return
        }
      }
      try {
        const r = await b.acao(f, j)
        if (r !== false) j.fechar(r === undefined ? true : r)
      } catch (e) {
        const err = traduzir(e)
        if (err.sessao) {
          document.dispatchEvent(new Event('jaf:sessaocaiu'))
          setErro('Sua sessão expirou. Entre de novo e toque outra vez neste botão — o que você digitou continua aqui.'); return
        }
        setErro(err.message)
      }
    } finally { travas.current.delete(n); setOcupados(o => o.filter(x => x !== n)) }
  }

  const botoes = opt.botoes || []
  return createPortal(
    <div ref={fundo} className={`janela-fundo${aberta ? ' aberta' : ''}${item.saindo ? ' saindo' : ''}`}
      onMouseDown={(e) => { if (e.target === fundo.current) fundo.current!.dataset.fora = '1' }}
      onClick={(e) => { if (e.target === fundo.current && fundo.current!.dataset.fora) { delete fundo.current!.dataset.fora; if (!form.current?.dataset.sujo) j.fechar(null) } }}>
      <div className={`janela ${opt.largura || ''}`} role="dialog" aria-modal="true" aria-labelledby={idTitulo}>
        <header className="janela-cab"><h2 id={idTitulo}>{opt.titulo}</h2>
          <button type="button" className="icone-btn fechar" aria-label="Fechar" onClick={() => void tentarFechar()}><Ic n="x" /></button></header>
        <form ref={form} className="janela-corpo" noValidate onSubmit={(e) => {
          e.preventDefault()
          ;(fundo.current?.querySelector<HTMLButtonElement>('.janela-pe .btn.pri[data-b]') || fundo.current?.querySelector<HTMLButtonElement>('[data-b="0"]'))?.click()
        }}>
          <Ctx.Provider value={j}>{opt.corpo}</Ctx.Provider>
          <div ref={caixaErro} className="janela-erro" role="alert" hidden={!erro}>{erro}</div>
        </form>
        <footer className="janela-pe">
          <button type="button" className="btn fantasma cancelar" onClick={() => void tentarFechar()}>{opt.fecharTxt || (botoes.length ? 'Cancelar' : 'Fechar')}</button>
          {botoes.map((b, n) => (
            <button key={n} type="button" className={`btn ${b.cls || 'pri'}${ocupados.includes(n) ? ' carregando' : ''}`} data-b={n}
              disabled={ocupados.includes(n)} onClick={() => void clicar(b, n)}>
              {b.icone && <Ic n={b.icone} />}<span>{b.txt}</span></button>
          ))}
          {opt.peExtra}
        </footer>
      </div>
    </div>, document.body)
}

function Confirmar({ item }: { item: Extract<Item, { tipo: 'confirmar' }> }) {
  const sim = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    sim.current?.focus()
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); item.fim(false) } }
    document.addEventListener('keydown', tecla, true)
    return () => document.removeEventListener('keydown', tecla, true)
  }, [item])
  const { opt } = item
  return createPortal(
    <div className="janela-fundo aberta confirmar">
      <div className="janela pequena" role="alertdialog" aria-modal="true">
        <div className="janela-corpo"><p className="confirmar-txt">{item.texto}</p>{opt.detalhe && <p className="sub">{opt.detalhe}</p>}</div>
        <footer className="janela-pe"><button type="button" className="btn fantasma n" onClick={() => item.fim(false)}>{opt.nao || 'Voltar'}</button>
          <button ref={sim} type="button" className={`btn ${opt.perigo ? 'perigo' : 'pri'} s`} onClick={() => item.fim(true)}>{opt.ok || 'Confirmar'}</button></footer>
      </div>
    </div>, document.body)
}
