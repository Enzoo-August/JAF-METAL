/* Ganchos do React: dados, rota (endereço #/...) e filtros que ficam lembrados ao trocar de tela */
import { useCallback, useState, useSyncExternalStore } from 'react'
import { S } from '../lib/dados.ts'

// redesenha quando os dados do banco mudam
export const useDados = (): number => useSyncExternalStore(S.ouvir, () => S.versao)

// ------------------------------------------------------------------ rota
export interface Rota { nome: string; id: string | null; sub: string | null; partes: string[]; q: URLSearchParams; hash: string }
export function lerRota(): Rota {
  const h = location.hash.replace(/^#\/?/, '')
  const [caminho, qs] = h.split('?')
  const partes = caminho.split('/').filter(Boolean)
  return { nome: partes[0] || '', id: partes[1] || null, sub: partes[1] || null, partes, q: new URLSearchParams(qs || ''), hash: location.hash }
}
const ouvirHash = (f: () => void) => { window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f) }
export function useRota(): Rota {
  const hash = useSyncExternalStore(ouvirHash, () => location.hash)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemoHash(hash)
}
let ultima: { hash: string; r: Rota } | null = null
function useMemoHash(hash: string): Rota {
  if (!ultima || ultima.hash !== hash) ultima = { hash, r: lerRota() }
  return ultima.r
}
export const ir = (h: string): void => { location.hash = h }

// ------------------------------------------------------------------ estado lembrado entre telas (filtros, busca, aba)
const lembrados = new Map<string, unknown>()
export function useLembrar<T>(chave: string, inicial: T): [T, (v: T | ((x: T) => T)) => void] {
  const [v, setV] = useState<T>(() => (lembrados.has(chave) ? lembrados.get(chave) as T : inicial))
  const set = useCallback((n: T | ((x: T) => T)) => {
    setV((velho) => { const novo = typeof n === 'function' ? (n as (x: T) => T)(velho) : n; lembrados.set(chave, novo); return novo })
  }, [chave])
  return [v, set]
}
export const esquecerLembrados = (): void => lembrados.clear()
