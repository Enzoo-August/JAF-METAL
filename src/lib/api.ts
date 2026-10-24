/* JAF Metal — conversa com o banco.
 * Dois modos com o MESMO banco (supabase/schema.sql):
 *  - nuvem: Supabase de verdade
 *  - teste: Postgres dentro do navegador (PGlite), com dados inventados. Só existe no "npm run dev" e no build de teste;
 *           o site publicado nem tem esse código.
 * Gravação: só por funções do banco (API.rpc). Leitura: API.ler(tabela). */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { CONFIG } from '../config.ts'
import type { NomeTabela, Perfil, PerfilAcesso, Tabelas } from './tipos.ts'
import { gravarLocal, iso, lerLocal } from './util.ts'
import type { PGlite, Transaction } from '@electric-sql/pglite'

export interface Sessao { uid: string; login: string; nome: string; perfil: Perfil; funcionario_id: string | null; trocar_senha: boolean }

export class ErroApp extends Error {
  rede = false
  sessao = false
  constructor(msg: string, extra: { rede?: boolean; sessao?: boolean } = {}) { super(msg); Object.assign(this, extra) }
}

const DOMINIO = '@jafmetal.local'
const params = new URLSearchParams(location.search)
// modo teste (dados inventados): só no computador de desenvolvimento e no build de teste — nunca no endereço publicado
const TESTE_EXISTE = import.meta.env.DEV || import.meta.env.MODE === 'teste'
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)

export const API = {
  modo: (TESTE_EXISTE && local && (params.get('modo') === 'teste' || import.meta.env.MODE === 'teste')) ? 'teste' as const : 'nuvem' as const,
  sessao: null as Sessao | null,
  online: navigator.onLine,
  precisaDemo: false,
  _pg: null as PGlite | null,
  iniciar, entrar, sair, conferirSessao, rpc, ler, ultimos, chamarTabela, zerarTeste, traduzir,
}

let sb: SupabaseClient | null = null

export function traduzir(e: unknown): ErroApp {
  if (e instanceof ErroApp) return e
  const x = e as { message?: string; code?: string } | null
  const msg = String(x?.message || e || 'Erro desconhecido')
  const code = x?.code || ''
  if (/Failed to fetch|NetworkError|Load failed|network|ERR_INTERNET|fetch failed/i.test(msg))
    return new ErroApp('Sem conexão com o servidor. Confira a internet e tente de novo.', { rede: true })
  if (/JWT expired|invalid JWT|jwt|not authenticated|401/i.test(msg) || code === 'PGRST301')
    return new ErroApp('Sua sessão expirou. Entre de novo.', { sessao: true })
  if (/Invalid login credentials/i.test(msg)) return new ErroApp('Usuário ou senha incorretos.')
  if (/Email not confirmed/i.test(msg)) return new ErroApp('Acesso ainda não liberado. Fale com o responsável.')
  if (/rate limit|too many/i.test(msg)) return new ErroApp('Muitas tentativas seguidas. Espere um minuto e tente de novo.')
  if (/canceling statement due to statement timeout/i.test(msg)) return new ErroApp('O servidor demorou demais para responder. Tente de novo.')
  if (code === '23505' || /duplicate key/i.test(msg)) return new ErroApp('Já existe um registro igual a esse.')
  if (code === '23503' || /foreign key/i.test(msg)) return new ErroApp('Esse registro está ligado a outro e não pode ser apagado.')
  if (code === '23514' || /violates check constraint/i.test(msg)) return new ErroApp('Algum valor não é aceito (confira números negativos ou campos obrigatórios).')
  if (code === '42501' || /permission denied/i.test(msg)) return new ErroApp('Seu perfil não pode fazer isso.')
  // mensagens das nossas funções já vêm em português
  return new ErroApp(msg.replace(/^ERROR:\s*/i, ''))
}

// ------------------------------------------------------------------ início
async function iniciar(): Promise<Sessao | null> {
  window.addEventListener('online', () => { API.online = true; document.dispatchEvent(new Event('jaf:rede')) })
  window.addEventListener('offline', () => { API.online = false; document.dispatchEvent(new Event('jaf:rede')) })
  if (API.modo === 'nuvem') {
    sb = createClient(CONFIG.url, CONFIG.chave, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'jaf.sessao', detectSessionInUrl: false },
    })
    sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && API.sessao) document.dispatchEvent(new Event('jaf:sessaocaiu')) })
    const { data } = await sb.auth.getSession()
    if (data?.session) await carregarPerfil(data.session.user.id).catch(() => null)
  } else if (TESTE_EXISTE) {
    const { abrirBancoTeste } = await import('./teste.ts')
    const r = await abrirBancoTeste(params.get('banco') === 'memoria')
    API._pg = r.banco
    API.precisaDemo = r.precisaDemo
    const salvo = lerLocal<{ uid?: string } | null>('jaf.teste.sessao', null)
    if (salvo?.uid) await carregarPerfil(salvo.uid).catch(() => null)
  }
  return API.sessao
}

async function carregarPerfil(uid: string): Promise<Sessao | null> {
  const linhas = await lerBruto('perfis', (q) => q.eq('user_id', uid), { sql: 'where user_id = $1', vals: [uid] }, uid) as unknown as PerfilAcesso[]
  const p = linhas[0]
  if (!p || !p.ativo) { API.sessao = null; return null }
  API.sessao = { uid, login: p.login, nome: p.nome, perfil: p.perfil, funcionario_id: p.funcionario_id, trocar_senha: !!p.trocar_senha }
  return API.sessao
}

// ------------------------------------------------------------------ login
async function entrar(login: string, senha: string): Promise<Sessao> {
  login = String(login || '').trim().toLowerCase()
  if (!login || !senha) throw new ErroApp('Informe usuário e senha.')
  const email = login.includes('@') ? login : login + DOMINIO
  let uid: string | undefined
  if (!TESTE_EXISTE || API.modo === 'nuvem') {
    const { data, error } = await sb!.auth.signInWithPassword({ email, password: senha })
    if (error) throw traduzir(error)
    uid = data.user.id
  } else {
    const r = await API._pg!.query<{ uid: string | null }>(`select auth.entrar_teste($1, $2) as uid`, [email, senha])
    uid = r.rows[0]?.uid ?? undefined
    if (!uid) throw new ErroApp('Usuário ou senha incorretos.')
    gravarLocal('jaf.teste.sessao', { uid })
  }
  const s = await carregarPerfil(uid)
  if (!s) { await sair(); throw new ErroApp('Esse acesso está desativado. Fale com o Dono.') }
  return s
}

async function sair(): Promise<void> {
  API.sessao = null
  if (API.modo === 'nuvem') { try { await sb!.auth.signOut() } catch { /* já saiu */ } }
  else gravarLocal('jaf.teste.sessao', null)
}

// confere se a sessão do servidor ainda vale (depois de muito tempo parado)
async function conferirSessao(): Promise<boolean> {
  if (API.modo !== 'nuvem') return !!API.sessao
  const { data } = await sb!.auth.getSession()
  if (!data?.session) return false
  const exp = (data.session.expires_at || 0) * 1000
  if (exp - Date.now() < 60000) { const r = await sb!.auth.refreshSession(); return !r.error }
  return true
}

// ------------------------------------------------------------------ chamadas
// nome: função do banco; args: { nome_do_parametro: valor }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rpc<T = any>(nome: string, args: Record<string, unknown> = {}): Promise<T> {
  if (API.modo === 'nuvem') {
    if (!navigator.onLine) throw new ErroApp('Sem internet. Nada foi salvo — tente de novo quando a conexão voltar.', { rede: true })
    let { data, error } = await sb!.rpc(nome, args)
    if (error && /JWT expired/i.test(error.message || '')) {
      const r = await sb!.auth.refreshSession()
      if (!r.error) ({ data, error } = await sb!.rpc(nome, args))
    }
    if (error) throw traduzir(error)
    return data as T
  }
  const nomes = Object.keys(args)
  const sql = `select public.${nome}(${nomes.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`
  const vals = nomes.map(k => { const v = args[k]; return (v !== null && typeof v === 'object') ? JSON.stringify(v) : (v === undefined ? null : v) })
  try {
    return await comoUsuario(async (tx) => (await tx.query<{ r: T }>(sql, vals)).rows[0]?.r ?? (null as T))
  } catch (e) { throw traduzir(e) }
}

// lê uma tabela inteira (ou só o que mudou). Sem limite de 1000 linhas.
async function ler<K extends NomeTabela>(tabela: K, opt: { campo?: string; desde?: string | number } = {}): Promise<Tabelas[K][]> {
  try {
    const filtro = opt.desde !== undefined && opt.campo
    return await lerBruto(tabela, (q) => filtro ? q.gt(opt.campo!, opt.desde!) : q,
      filtro ? { sql: `where ${opt.campo} > $1`, vals: [opt.desde] } : undefined) as unknown as Tabelas[K][]
  } catch (e) { throw traduzir(e) }
}

// as N linhas mais recentes (pelo id) — usado no histórico de alterações
async function ultimos<T>(tabela: string, n: number): Promise<T[]> {
  try {
    if (API.modo === 'nuvem') {
      const { data, error } = await sb!.from(tabela).select('*').order('id', { ascending: false }).limit(n)
      if (error) throw error
      return normalizar(data) as T[]
    }
    return await comoUsuario(async (tx) => normalizar((await tx.query(`select * from public.${tabela} order by id desc limit ${Number(n) | 0}`)).rows as Record<string, unknown>[])) as T[]
  } catch (e) { throw traduzir(e) }
}

// funções que devolvem tabela (ex.: nomes_usuarios)
async function chamarTabela<T>(fn: string): Promise<T[]> {
  if (API.modo === 'nuvem') {
    const { data, error } = await sb!.rpc(fn)
    if (error) throw traduzir(error)
    return (data || []) as T[]
  }
  return comoUsuario(async (tx) => (await tx.query(`select * from public.${fn}()`)).rows as T[])
}

type Consulta = ReturnType<ReturnType<SupabaseClient['from']>['select']>
const ORDEM: Partial<Record<string, string>> = { movimentos: 'seq', historico: 'id', perfis: 'criado_em', config: 'chave', funcionarios_privado: 'funcionario_id' }

async function lerBruto(tabela: string, filtrar: (q: Consulta) => Consulta, where?: { sql: string; vals: unknown[] }, uidForcado?: string): Promise<Record<string, unknown>[]> {
  const ord = ORDEM[tabela] || 'id'
  if (API.modo === 'nuvem') {
    const todos: Record<string, unknown>[] = []
    const passo = 1000
    for (let de = 0; ; de += passo) {
      const q = filtrar(sb!.from(tabela).select('*')).order(ord, { ascending: true }).range(de, de + passo - 1)
      const { data, error } = await q
      if (error) throw error
      todos.push(...(data as Record<string, unknown>[]))
      if (data.length < passo) break
    }
    return normalizar(todos)
  }
  return comoUsuario(async (tx) => normalizar((await tx.query(`select * from public.${tabela} ${where?.sql || ''} order by ${ord}`, where?.vals || [])).rows as Record<string, unknown>[]), uidForcado)
}

// números do banco chegam como texto em alguns casos: converte; datas viram 'AAAA-MM-DD'
const HORARIOS = new Set(['criado_em', 'atualizado_em', 'iniciada_em', 'pronta_em', 'em', 'last_sign_in_at']) // o resto é data (AAAA-MM-DD)
const NUMERICOS = new Set(['est_min', 'est_max', 'estoque', 'qtd', 'preco_unit', 'valor', 'recebido', 'frete', 'custo_servico', 'horas_parada',
  'produzido', 'valor_pago', 'salario', 'seq', 'numero', 'ano', 'preventiva_dias', 'prioridade', 'ordem', 'resta', 'id_hist'])
function normalizar<T extends Record<string, unknown>>(linhas: T[]): T[] {
  for (const l of linhas) {
    const o = l as Record<string, unknown>
    for (const k in o) {
      const v = o[k]
      if (v instanceof Date) o[k] = HORARIOS.has(k) ? v.toISOString() : iso(new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()))
      else if (typeof v === 'string' && NUMERICOS.has(k) && v !== '') o[k] = Number(v)
      else if (typeof v === 'bigint') o[k] = Number(v)
    }
  }
  return linhas
}

// ------------------------------------------------------------------ modo teste
function comoUsuario<T>(fn: (tx: Transaction) => Promise<T>, uidForcado?: string): Promise<T> {
  const uid = uidForcado || API.sessao?.uid || ''
  return API._pg!.transaction(async (tx: Transaction) => {
    if (uid) {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })])
      await tx.exec('set local role authenticated')
    } else {
      await tx.query(`select set_config('request.jwt.claims', '', true)`)
      await tx.exec('set local role anon')
    }
    return fn(tx)
  })
}

// apaga o banco de teste (recomeçar a demonstração)
async function zerarTeste(): Promise<void> {
  if (TESTE_EXISTE && API.modo === 'teste') {
    const { apagarBancoTeste } = await import('./teste.ts')
    gravarLocal('jaf.teste.sessao', null)
    await apagarBancoTeste(API._pg)
  }
}
