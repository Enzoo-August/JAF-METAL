/* Modo teste: o MESMO banco (schema.sql) rodando dentro do navegador, com dados inventados.
 * Este arquivo só entra no "npm run dev" e no build de teste — o site publicado não tem nada disto. */
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import authSimulado from '../../supabase/auth-simulado.sql?raw'
import schema from '../../supabase/schema.sql?raw'
import { gravarLocal, lerLocal } from './util.ts'

const hash = (s: string): number => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h }

export async function abrirBancoTeste(soMemoria: boolean): Promise<{ banco: PGlite; precisaDemo: boolean }> {
  const banco = await PGlite.create(soMemoria ? undefined : 'idb://jaf-teste', { extensions: { pgcrypto } })
  const marca = schema.length + ':' + hash(schema)
  const jaTem = (await banco.query<{ ok: boolean }>(`select to_regclass('public.pecas') is not null as ok`)).rows[0].ok
  if (!jaTem || lerLocal<string | null>('jaf.teste.schema', null) !== marca) {
    await banco.exec(authSimulado)
    await banco.exec(schema)
    gravarLocal('jaf.teste.schema', marca)
  }
  return { banco, precisaDemo: !jaTem }
}

export async function apagarBancoTeste(banco: PGlite | null): Promise<void> {
  gravarLocal('jaf.teste.schema', null)
  try { await banco?.close() } catch { /* já fechado */ }
  await new Promise<void>((ok) => { const r = indexedDB.deleteDatabase('/pglite/jaf-teste'); r.onsuccess = r.onerror = r.onblocked = () => ok() })
}
