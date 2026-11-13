/* Pedaços usados pelas telas da fábrica (OFs, matéria-prima, pedidos de clientes, produtos, técnico, manutenção) */
import type { ReactNode } from 'react'
import { C, S } from '../../lib/dados.ts'
import type { NomeTabela, Produto } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { Combo, type PropsCombo } from '../../ui/Combo.tsx'
import { useTabelas } from '../../ui/ganchos.ts'

// as tabelas grandes da fábrica só são baixadas quando alguém abre a tela
export function ComTabelas({ tabs, children }: { tabs: NomeTabela[]; children: () => ReactNode }) {
  const ok = useTabelas(tabs)
  if (!ok) return <div className="carregando-parte" data-carregando="1"><span className="giro" /> Carregando…</div>
  return <>{children()}</>
}

type AtalhoProduto = Omit<PropsCombo<Produto>, 'fonte' | 'campos' | 'rotuloDe'> & { classe?: 'mp' | 'peca'; todos?: boolean }
// código JAF (peças, conjuntos e matéria-prima)
export const ComboProduto = ({ classe, todos, ...p }: AtalhoProduto) => <Combo<Produto>
  fonte={() => S.lista('produtos').filter(x => (!classe || x.classe === classe || (classe === 'mp' && C.comprado(x))) && (todos || x.situacao !== 'inativo' || x.id === p.inicial?.id))}
  campos={(x) => [x.codigo, x.descricao, x.codigo_cliente || '']}
  rotuloDe={(x) => x.codigo ? `${x.codigo} — ${x.descricao}` : ''}
  linha={(x) => <><b>{x.codigo}</b> <span>{x.descricao}</span>{x.classe === 'mp' || C.comprado(x) ? <em>{U.qtd(C.estoqueMP().get(x.id) || 0)} {x.classe === 'mp' ? 'kg' : 'pç'}</em> : x.codigo_cliente ? <em>{x.codigo_cliente}</em> : null}</>}
  {...p} />

export const nomeProduto = (id: string | null | undefined): string => { const p = S.get('produtos', id); return p ? `${p.codigo} — ${p.descricao}` : '' }

// lista de valores já usados (para sugerir no campo)
export const usados = (l: (string | null | undefined)[]): string[] => U.unicos(l.filter((x): x is string => !!x && !!x.trim())).sort((a, b) => a.localeCompare(b, 'pt-BR'))

export const Sugestoes = ({ id, itens }: { id: string; itens: string[] }) => <datalist id={id}>{itens.map(s => <option key={s} value={s} />)}</datalist>

// número de OF / R.I. sem separador de milhar
export const nr = (n: number | null | undefined): string => n === null || n === undefined ? '—' : String(n)
