/* Campo com sugestões (peça, fornecedor, máquina, funcionário, cliente).
 * O id escolhido fica em data-combo-id no próprio campo: é o que a leitura do formulário pega. */
import { useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { S } from '../lib/dados.ts'
import { Perm } from '../lib/perm.ts'
import type { Cliente, Fornecedor, Funcionario, Maquina, Peca } from '../lib/tipos.ts'
import { buscar, ordenar, qtd, sem } from '../lib/util.ts'
import { Ic } from './icones.tsx'

export interface ComboApi<T> { definir(x: T | null): void; valor(): string | null }

export interface PropsCombo<T extends { id: string }> {
  nome: string
  rotulo?: string
  id?: string
  req?: boolean
  placeholder?: string
  readOnly?: boolean
  foco?: boolean
  inicial?: T | null
  fonte: () => T[]
  campos: (x: T) => string[]
  rotuloDe: (x: T) => string
  linha?: (x: T) => ReactNode
  novo?: ((texto: string) => Promise<T | null>) | null
  aoEscolher?: (x: T) => void
  aoLimpar?: () => void
  ref?: Ref<ComboApi<T>>
}

export function Combo<T extends { id: string }>(p: PropsCombo<T>) {
  const gerado = useId()
  const id = p.id || 'cb' + gerado.replace(/:/g, '')
  const input = useRef<HTMLInputElement>(null)
  const [texto, setTexto] = useState(p.inicial ? p.rotuloDe(p.inicial) : '')
  const [sel, setSel] = useState<string>(p.inicial?.id || '')
  const selRef = useRef(sel)
  const [aberta, setAberta] = useState(false)
  const [itens, setItens] = useState<T[]>([])
  const [marcado, setMarcado] = useState(-1)
  const lista = useRef<HTMLDivElement>(null)

  const mudarSel = (v: string) => { selRef.current = v; setSel(v) }
  const desenhar = (termo: string, escolhido: string) => {
    const l = p.fonte()
    const t = escolhido ? '' : termo // campo já escolhido: ao tocar de novo mostra a lista toda (para trocar)
    const r = t.trim() ? buscar(l, t, p.campos, 30) : ordenar(l, x => sem(p.campos(x)[0])).slice(0, 30)
    setItens(r); setMarcado(r.length ? 0 : -1); setAberta(true)
  }
  const fechar = () => setAberta(false)
  const escolher = (x: T) => {
    mudarSel(x.id); setTexto(p.rotuloDe(x)); fechar()
    // avisa o formulário (para marcar como "mexido")
    setTimeout(() => input.current?.dispatchEvent(new Event('change', { bubbles: true })), 0)
    p.aoEscolher?.(x)
  }
  useImperativeHandle(p.ref, () => ({
    definir: (x) => { if (x) escolher(x); else { mudarSel(''); setTexto('') } },
    valor: () => selRef.current || null,
  }))

  useEffect(() => { marcadoVisivel() }, [marcado])
  const marcadoVisivel = () => lista.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' })

  const campo = (
    <>
      <input ref={input} id={id} name={p.nome} required={p.req} placeholder={p.placeholder} readOnly={p.readOnly}
        value={texto} data-combo-id={sel} autoComplete="off" spellCheck={false} autoCapitalize="none" role="combobox" aria-expanded={aberta}
        {...(p.foco ? { 'data-autofocus': '1' } : {})}
        onFocus={() => { if (!p.readOnly) { desenhar(texto, selRef.current); if (selRef.current) input.current?.select() } }}
        onChange={(e) => { setTexto(e.target.value); mudarSel(''); desenhar(e.target.value, ''); p.aoLimpar?.() }}
        onKeyDown={(e) => {
          if (!aberta && e.key === 'ArrowDown') { desenhar(texto, selRef.current); return }
          if (e.key === 'ArrowDown') { setMarcado(m => Math.min(m + 1, itens.length - 1)); e.preventDefault() }
          else if (e.key === 'ArrowUp') { setMarcado(m => Math.max(m - 1, 0)); e.preventDefault() }
          else if (e.key === 'Enter') { if (aberta && itens[marcado]) { e.preventDefault(); escolher(itens[marcado]) } }
          else if (e.key === 'Escape') { if (aberta) { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); fechar() } }
        }}
        onBlur={() => setTimeout(() => {
          fechar()
          // texto que não virou escolha: tenta casar exato
          const v = input.current?.value.trim() || ''
          if (!selRef.current && v) {
            const t = sem(v)
            const igual = p.fonte().find(x => sem(p.rotuloDe(x)) === t || sem(p.campos(x)[0]) === t)
            if (igual) escolher(igual)
          }
        }, 120)} />
      <div ref={lista} className="combo-lista" role="listbox" hidden={!aberta}
        onPointerDown={(e) => e.preventDefault()} /* não deixa o campo perder o foco antes do toque valer */>
        {itens.map((x, n) => <div key={x.id} className={`combo-item ${n === marcado ? 'sel' : ''}`} role="option" aria-selected={n === marcado} data-n={n}
          onClick={() => escolher(x)}>{p.linha ? p.linha(x) : p.rotuloDe(x)}</div>)}
        {!itens.length && <div className="combo-nada">Nada encontrado{texto ? ` para “${texto}”` : ''}</div>}
        {p.novo && texto.trim() && <div className="combo-item combo-novo" data-novo="1" onClick={async () => {
          fechar(); const x = await p.novo!(texto.trim()); if (x) escolher(x)
        }}><Ic n="mais" /> Cadastrar “{texto.trim()}”</div>}
      </div>
    </>
  )
  return <div className="campo combo"><label htmlFor={id}>{p.rotulo}{p.req && <> <i className="req">*</i></>}</label>{campo}</div>
}

// ------------------------------------------------------------------ atalhos de combos comuns
type Atalho<T extends { id: string }> = Omit<PropsCombo<T>, 'fonte' | 'campos' | 'rotuloDe'> & Partial<Pick<PropsCombo<T>, 'fonte'>>

export const ComboPeca = (p: Atalho<Peca>) => <Combo<Peca>
  fonte={() => S.lista('pecas').filter(x => x.ativo || x.id === p.inicial?.id)}
  campos={(x) => [x.codigo, x.descricao, x.utilizacao || '']}
  rotuloDe={(x) => x.codigo ? `${x.codigo} — ${x.descricao}` : ''}
  linha={(x) => <><b>{x.codigo}</b> <span>{x.descricao}</span><em className={x.estoque <= 0 ? 'zero' : ''}>{qtd(x.estoque)} {x.unidade}</em></>}
  {...p} />

let cadastroRapido: { fornecedor?: (n: string) => Promise<Fornecedor | null>; maquina?: (n: string) => Promise<Maquina | null>; cliente?: (n: string) => Promise<Cliente | null> } = {}
// as telas registram aqui o cadastro rápido (evita dependência circular entre arquivos)
export const registrarCadastroRapido = (c: typeof cadastroRapido) => { cadastroRapido = { ...cadastroRapido, ...c } }

export const ComboFornecedor = (p: Atalho<Fornecedor>) => <Combo<Fornecedor>
  fonte={() => S.lista('fornecedores').filter(x => x.ativo || x.id === p.inicial?.id)}
  campos={(x) => [x.nome, x.razao || '', x.cnpj || '']}
  rotuloDe={(x) => x.nome || ''}
  linha={(x) => <><b>{x.nome}</b>{x.razao && x.razao !== x.nome ? <> <span>{x.razao}</span></> : null}</>}
  novo={Perm.pode('compras') && cadastroRapido.fornecedor ? cadastroRapido.fornecedor : null}
  {...p} />

export const ComboMaquina = (p: Atalho<Maquina>) => <Combo<Maquina>
  fonte={() => S.lista('maquinas').filter(x => x.ativo)}
  campos={(x) => [x.nome, x.tipo || '', x.setor || '']}
  rotuloDe={(x) => x.nome || ''}
  novo={Perm.pode('maquinas_editar') && cadastroRapido.maquina ? cadastroRapido.maquina : null}
  {...p} />

export const ComboFuncionario = (p: Atalho<Funcionario>) => <Combo<Funcionario>
  fonte={() => S.lista('funcionarios').filter(x => x.ativo)}
  campos={(x) => [x.nome, x.funcao || '', x.setor || '']}
  rotuloDe={(x) => x.nome || ''}
  linha={(x) => <><b>{x.nome}</b>{x.funcao ? <> <span>{x.funcao}</span></> : null}</>}
  {...p} />

export const ComboCliente = (p: Atalho<Cliente>) => <Combo<Cliente>
  fonte={() => S.lista('clientes').filter(x => x.ativo)}
  campos={(x) => [x.nome, x.razao || '', x.cnpj || '']}
  rotuloDe={(x) => x.nome || ''}
  novo={Perm.pode('clientes') && cadastroRapido.cliente ? cadastroRapido.cliente : null}
  {...p} />
