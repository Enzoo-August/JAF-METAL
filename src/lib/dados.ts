/* JAF Metal — dados em memória (S) e cálculos (C). */
import { API } from './api.ts'
import { Perm } from './perm.ts'
import type { FuncionarioPrivado, Funcionario, Lancamento, Maquina, Movimento, NomeTabela, Ordem, Peca, PedidoCompra, PedidoItem, Situacao, Tabelas } from './tipos.ts'
import * as U from './util.ts'

// ================================================================ S: o que veio do banco
// tabela → campo usado para buscar só o que mudou (null = sempre inteira)
const INCR: Record<NomeTabela, string | null> = {
  config: 'atualizado_em', pecas: 'atualizado_em', maquinas: 'atualizado_em', manutencoes: 'atualizado_em',
  funcionarios: 'atualizado_em', ordens: 'atualizado_em', movimentos: 'seq', fornecedores: 'atualizado_em',
  pedidos_compra: 'atualizado_em', pedido_itens: null, clientes: 'atualizado_em', lancamentos: 'atualizado_em',
  funcionarios_privado: 'atualizado_em', perfis: null,
}
const CHAVE: Partial<Record<NomeTabela, string>> = { config: 'chave', funcionarios_privado: 'funcionario_id', perfis: 'user_id' }
const TODAS = Object.keys(INCR) as NomeTabela[]

type Listas = { [K in NomeTabela]: Tabelas[K][] }
type Indices = { [K in NomeTabela]: Map<string, Tabelas[K]> }

const d = Object.fromEntries(TODAS.map(t => [t, []])) as unknown as Listas
const i = Object.fromEntries(TODAS.map(t => [t, new Map()])) as unknown as Indices
const ouvintes = new Set<() => void>()

export const S = {
  versao: 0,
  carregadoEm: 0,
  ultimaBusca: 0,
  nomes: new Map<string, string>(),
  ouvir(fn: () => void): () => void { ouvintes.add(fn); return () => { ouvintes.delete(fn) } },
  tabelasDoPerfil(): NomeTabela[] {
    const p = API.sessao?.perfil
    const t: NomeTabela[] = ['config', 'pecas', 'maquinas', 'manutencoes', 'funcionarios', 'ordens', 'movimentos']
    if (p === 'dono' || p === 'escritorio' || p === 'almoxarife') t.push('fornecedores', 'pedidos_compra', 'pedido_itens')
    if (p === 'dono' || p === 'escritorio') t.push('clientes', 'lancamentos', 'funcionarios_privado')
    if (p === 'dono') t.push('perfis')
    return t
  },
  lista<K extends NomeTabela>(t: K): Tabelas[K][] { return d[t] },
  get<K extends NomeTabela>(t: K, id: string | null | undefined): Tabelas[K] | null { return id ? i[t].get(id) ?? null : null },
  cfg<T = Record<string, unknown>>(chave: string, padrao: T): T { return (S.get('config', chave)?.valor as T | undefined) ?? padrao },
  nomeUsuario(uid: string | null | undefined): string { return (uid && S.nomes.get(uid)) || '' },

  // carrega tudo do zero
  async carregar(): Promise<void> {
    const tabs = S.tabelasDoPerfil()
    for (const t of TODAS) { (d as Record<string, unknown[]>)[t] = []; i[t].clear() }
    const res = await Promise.all(tabs.map(t => API.ler(t)))
    tabs.forEach((t, n) => { (d as Record<string, unknown[]>)[t] = res[n]; indexar(t) })
    await carregarNomes()
    S.carregadoEm = Date.now(); S.ultimaBusca = Date.now()
    avisar()
  },

  // busca só o que mudou nas tabelas pedidas (ou em todas)
  async atualizar(tabelas?: NomeTabela[], opt: { inteira?: NomeTabela[] } = {}): Promise<NomeTabela[]> {
    const permitidas = new Set(S.tabelasDoPerfil())
    const tabs = (tabelas || [...permitidas]).filter(t => permitidas.has(t))
    const mudou: NomeTabela[] = []
    await Promise.all(tabs.map(async (t) => {
      const campo = INCR[t]
      const lista = d[t] as unknown as Record<string, unknown>[]
      if (!campo || opt.inteira?.includes(t)) {
        const novo = await API.ler(t)
        if (JSON.stringify(novo) !== JSON.stringify(lista)) { (d as Record<string, unknown[]>)[t] = novo; indexar(t); mudou.push(t) }
        return
      }
      let desde: string | number | null = null
      for (const x of lista) { const v = x[campo] as string | number | null; if (v !== null && v !== undefined && (desde === null || v > desde)) desde = v }
      const novos = await API.ler(t, desde === null ? {} : { campo, desde: campo === 'seq' ? desde : new Date(new Date(desde).getTime() - 2000).toISOString() }) as unknown as Record<string, unknown>[]
      if (!novos.length) return
      const k = CHAVE[t] || 'id'
      const idx = i[t] as unknown as Map<string, Record<string, unknown>>
      let alterou = false
      for (const n of novos) {
        const velho = idx.get(n[k] as string)
        if (velho) { if (JSON.stringify(velho) !== JSON.stringify(n)) { Object.assign(velho, n); alterou = true } }
        else { lista.push(n); idx.set(n[k] as string, n); alterou = true }
      }
      if (alterou) { (d as Record<string, unknown[]>)[t] = lista.slice(); mudou.push(t) }
    }))
    // itens de pedido acompanham os pedidos
    if (mudou.includes('pedidos_compra') && permitidas.has('pedido_itens') && !tabs.includes('pedido_itens')) {
      d.pedido_itens = await API.ler('pedido_itens'); indexar('pedido_itens'); mudou.push('pedido_itens')
    }
    if (mudou.includes('perfis') || mudou.includes('funcionarios')) await carregarNomes()
    S.ultimaBusca = Date.now()
    if (mudou.length) avisar()
    return mudou
  },
}

function indexar(t: NomeTabela): void {
  const k = CHAVE[t] || 'id'
  const m = i[t] as unknown as Map<string, unknown>
  m.clear()
  for (const x of d[t] as unknown as Record<string, unknown>[]) m.set(x[k] as string, x)
}
async function carregarNomes(): Promise<void> {
  try {
    const n = await API.chamarTabela<{ user_id: string; nome: string }>('nomes_usuarios')
    S.nomes = new Map(n.map(x => [x.user_id, x.nome]))
  } catch { /* não é essencial */ }
}
function avisar(): void {
  S.versao++
  for (const f of ouvintes) { try { f() } catch (e) { console.error(e) } }
}

// ================================================================ C: cálculos
const hoje = () => U.hoje()

export interface ItemCompra { peca: Peca; alvo: number; pendente: number; sugerido: number; jaPedido: boolean }
export interface Lote { mov: Movimento; resta: number; valor: number }
export interface Consumo { mov: Movimento; qtd: number; valor: number; estorno?: Movimento }
export interface Alerta { nivel: 'alto' | 'medio' | 'baixo'; txt: string; rota: string; n: number }

export const C = {
  // ---------------- situação da peça (mesma regra da planilha, mais "no mínimo")
  situacao(p: Peca): Situacao {
    const e = Number(p.estoque) || 0, mi = Number(p.est_min) || 0, ma = Number(p.est_max) || 0
    if (!p.ativo) return { cod: 'inativa', txt: 'Desativada', cor: 'cinza' }
    if (e < mi) return { cod: 'comprar', txt: 'Comprar', cor: 'vermelho' }
    if (ma > 0 && e > ma) return { cod: 'alto', txt: 'Estoque alto', cor: 'azul' }
    if (mi > 0 && e === mi) return { cod: 'minimo', txt: 'No mínimo', cor: 'amarelo' }
    if (e === 0) return { cod: 'zerado', txt: 'Sem estoque', cor: 'cinza' }
    return { cod: 'ok', txt: 'Ok', cor: 'verde' }
  },

  // ---------------- pedidos de compra
  itensDoPedido(pedId: string): PedidoItem[] { return S.lista('pedido_itens').filter(x => x.pedido_id === pedId).sort((a, b) => a.ordem - b.ordem) },
  totalPedido(ped: PedidoCompra): number { return U.r2(U.soma(C.itensDoPedido(ped.id), 'valor') + (Number(ped.frete) || 0)) },
  situacaoPedido(ped: PedidoCompra): Situacao {
    if (ped.status === 'cancelado') return { cod: 'cancelado', txt: 'Cancelado', cor: 'cinza' }
    if (ped.status === 'recebido') return { cod: 'recebido', txt: 'Recebido', cor: 'verde' }
    const parcial = C.itensDoPedido(ped.id).some(x => x.recebido > 0)
    if (ped.prazo && ped.prazo < hoje()) return { cod: 'atrasado', txt: parcial ? 'Atrasado (parcial)' : 'Atrasado', cor: 'vermelho' }
    if (ped.prazo && ped.prazo === hoje()) return { cod: 'hoje', txt: 'Chega hoje', cor: 'amarelo' }
    return { cod: 'aguardando', txt: parcial ? 'Chegou parte' : 'Aguardando', cor: 'azul' }
  },
  // quanto da peça ainda vai chegar de pedidos em aberto
  pendente(pecaId: string): number {
    let n = 0
    for (const x of S.lista('pedido_itens')) {
      if (x.peca_id !== pecaId) continue
      const ped = S.get('pedidos_compra', x.pedido_id)
      if (ped && ped.status === 'aguardando') n += Math.max(0, x.qtd - x.recebido)
    }
    return n
  },
  pedidosAbertosDaPeca(pecaId: string): { ped: PedidoCompra; item: PedidoItem }[] {
    const r: { ped: PedidoCompra; item: PedidoItem }[] = []
    for (const x of S.lista('pedido_itens')) {
      if (x.peca_id !== pecaId || x.recebido >= x.qtd) continue
      const ped = S.get('pedidos_compra', x.pedido_id)
      if (ped && ped.status === 'aguardando') r.push({ ped, item: x })
    }
    return r
  },
  // sugestão de compra: completar até o máximo, descontando o que já foi pedido
  sugestao(p: Peca): { alvo: number; pendente: number; sugerido: number } {
    const e = Math.max(0, Number(p.estoque) || 0), mi = Number(p.est_min) || 0, ma = Number(p.est_max) || 0
    const alvo = ma > 0 ? ma : (mi > 0 ? mi * 2 : 0)
    const pend = C.pendente(p.id)
    return { alvo, pendente: pend, sugerido: Math.max(0, Math.ceil(alvo - e - pend)) }
  },
  listaCompras(): ItemCompra[] {
    const r: ItemCompra[] = []
    for (const p of S.lista('pecas')) {
      if (!p.ativo || C.situacao(p).cod !== 'comprar') continue
      const s = C.sugestao(p)
      r.push({ peca: p, ...s, jaPedido: s.sugerido === 0 && s.pendente > 0 })
    }
    return r
  },

  // ---------------- último preço pago / fornecedor
  ultimaEntrada(pecaId: string, fornecedorId?: string | null): Movimento | null {
    let u: Movimento | null = null
    for (const m of S.lista('movimentos')) {
      if (m.peca_id !== pecaId || m.tipo !== 'entrada' || !(m.preco_unit > 0) || m.motivo === 'estorno') continue
      if (fornecedorId && m.fornecedor_id !== fornecedorId) continue
      if (!u || m.data > u.data || (m.data === u.data && m.seq > u.seq)) u = m
    }
    return u
  },

  // ---------------- lotes PEPS (igual à função do banco)
  lotes(pecaId: string): Lote[] {
    const p = S.get('pecas', pecaId)
    let e = Math.max(0, Number(p?.estoque) || 0)
    const ent = S.lista('movimentos').filter(m => m.peca_id === pecaId && m.tipo === 'entrada')
      .sort((a, b) => a.data < b.data ? 1 : a.data > b.data ? -1 : b.seq - a.seq)
    const r: Lote[] = []
    for (const m of ent) {
      if (e <= 0) break
      const resta = Math.min(m.qtd, e)
      r.push({ mov: m, resta, valor: resta * m.preco_unit })
      e -= resta
    }
    return r.reverse()
  },
  valorPeca(pecaId: string): number { return U.soma(C.lotes(pecaId), 'valor') },
  valorEstoque(): number { return U.soma(S.lista('pecas'), p => (Number(p.estoque) > 0 ? C.valorPeca(p.id) : 0)) },
  // custo de uma retirada de n unidades agora (lote mais antigo primeiro)
  custoRetirada(pecaId: string, n: number): number {
    let falta = n, v = 0
    for (const l of C.lotes(pecaId)) { const t = Math.min(falta, l.resta); v += t * l.mov.preco_unit; falta -= t; if (falta <= 0) break }
    return v
  },

  // ---------------- consumo (retiradas, descontando as desfeitas)
  ehConsumo(m: Movimento): boolean { return m.tipo === 'saida' && (m.motivo === 'retirada' || m.motivo === 'importado') },
  consumos(filtro?: (m: Movimento) => boolean): Consumo[] {
    // estorno de retirada entra negativo
    const r: Consumo[] = []
    for (const m of S.lista('movimentos')) {
      if (filtro && !filtro(m)) continue
      if (C.ehConsumo(m)) r.push({ mov: m, qtd: m.qtd, valor: m.qtd * m.preco_unit })
      else if (m.motivo === 'estorno' && m.tipo === 'entrada') {
        const o = S.get('movimentos', m.estorno_de)
        if (o && C.ehConsumo(o)) r.push({ mov: o, qtd: -m.qtd, valor: -m.qtd * m.preco_unit, estorno: m })
      }
    }
    return r
  },
  consumoPeca(pecaId: string, meses = 12): number {
    const de = U.somaMeses(hoje(), -meses)
    return U.soma(C.consumos(m => m.peca_id === pecaId && m.data > de), 'qtd')
  },
  // quantos meses o estoque dura no ritmo dos últimos 12 meses
  duracao(p: Peca): number | null {
    const c = C.consumoPeca(p.id, 12)
    if (c <= 0) return null
    return Math.max(0, p.estoque) / (c / 12)
  },

  // ---------------- máquinas / manutenção
  ultimaPreventiva(maqId: string): string | null {
    let u: string | null = null
    for (const m of S.lista('manutencoes')) if (m.maquina_id === maqId && m.tipo === 'preventiva' && m.status === 'concluida') {
      const x = m.concluida_em || m.data; if (!u || x > u) u = x
    }
    return u
  },
  proximaPreventiva(maq: Maquina): string | null {
    if (!maq.preventiva_dias) return null
    const u = C.ultimaPreventiva(maq.id)
    return u ? U.somaDias(u, maq.preventiva_dias) : null
  },
  manutAbertas(maqId?: string) { return S.lista('manutencoes').filter(m => m.status !== 'concluida' && (!maqId || m.maquina_id === maqId)) },
  situacaoMaquina(maq: Maquina): Situacao {
    if (!maq.ativo) return { cod: 'inativa', txt: 'Desativada', cor: 'cinza' }
    const ab = C.manutAbertas(maq.id)
    if (ab.some(m => m.tipo === 'corretiva')) return { cod: 'parada', txt: 'Com problema', cor: 'vermelho' }
    if (ab.length) return { cod: 'manut', txt: 'Em manutenção', cor: 'amarelo' }
    const prox = C.proximaPreventiva(maq)
    if (maq.preventiva_dias && !C.ultimaPreventiva(maq.id)) return { cod: 'semprev', txt: 'Preventiva sem registro', cor: 'amarelo' }
    if (prox && prox < hoje()) return { cod: 'prevvencida', txt: 'Preventiva vencida', cor: 'vermelho' }
    if (prox && U.dias(hoje(), prox) <= 7) return { cod: 'prevlogo', txt: 'Preventiva em ' + U.relativo(prox), cor: 'amarelo' }
    return { cod: 'ok', txt: 'Funcionando', cor: 'verde' }
  },

  // ---------------- produção
  situacaoOrdem(o: Ordem): Situacao & { atrasada: boolean } {
    const mapa: Record<string, [string, Situacao['cor']]> = { fila: ['Na fila', 'cinza'], producao: ['Produzindo', 'azul'], pronta: ['Pronta', 'verde'], entregue: ['Entregue', 'verde'], cancelada: ['Cancelada', 'cinza'] }
    const [txt, cor] = mapa[o.status] || [o.status, 'cinza']
    const atrasada = !!o.prazo && o.prazo < hoje() && (o.status === 'fila' || o.status === 'producao')
    return { cod: o.status, txt, cor: atrasada ? 'vermelho' : cor, atrasada }
  },

  // ---------------- financeiro
  situacaoConta(l: Lancamento): Situacao {
    if (l.pago_em) return { cod: 'pago', txt: l.tipo === 'pagar' ? 'Paga' : 'Recebida', cor: 'verde' }
    if (l.vencimento < hoje()) return { cod: 'vencida', txt: 'Vencida', cor: 'vermelho' }
    if (l.vencimento === hoje()) return { cod: 'hoje', txt: 'Vence hoje', cor: 'amarelo' }
    return { cod: 'aberta', txt: 'Em aberto', cor: 'azul' }
  },
  categorias(): { pagar: string[]; receber: string[] } {
    const c = S.cfg<{ pagar?: string[]; receber?: string[] } | null>('categorias', null)
    return {
      pagar: c?.pagar || ['Compras / almoxarifado', 'Matéria-prima', 'Folha de pagamento', 'Impostos', 'Energia', 'Água', 'Aluguel',
        'Manutenção de máquinas', 'Serviços de terceiros', 'Frete', 'Combustível', 'Telefone / internet', 'Outras despesas'],
      receber: c?.receber || ['Venda de peças / serviços', 'Upgrade', 'Outras receitas'],
    }
  },

  // ---------------- equipe: férias (CLT simplificada)
  // a cada 12 meses de casa nasce um período; cada férias registrada usa um período (o mais antigo)
  ferias(func: Funcionario, priv: FuncionarioPrivado | null): { pendentes: number; direitoEm: string | null; limite: string | null; vencida?: boolean; diasParaVencer?: number } | null {
    if (!func.admissao || !func.ativo) return null
    const meses = Math.floor(U.dias(func.admissao, hoje()) / 30.4375)
    const completos = Math.floor(meses / 12)
    const tiradas = (priv?.ferias || []).length
    const pendentes = completos - tiradas
    if (pendentes <= 0) return { pendentes: 0, direitoEm: U.somaMeses(func.admissao, 12 * (completos + 1)), limite: null }
    // o período mais antigo não tirado vence 12 meses depois de completado
    const limite = U.somaMeses(func.admissao, 12 * (tiradas + 2))
    return { pendentes, direitoEm: null, limite, vencida: limite < hoje(), diasParaVencer: U.dias(hoje(), limite) }
  },

  // pedidos recebidos que ainda não têm conta a pagar
  semConta(p: PedidoCompra): boolean {
    return p.status === 'recebido' && p.obs !== 'Importado da planilha' && !S.lista('lancamentos').some(l => l.pedido_id === p.id) && C.totalPedido(p) > 0
  },

  // ---------------- alertas (Início e sininho)
  alertas(): Alerta[] {
    const a: Alerta[] = []
    const add = (nivel: Alerta['nivel'], txt: string, rota: string, n: number) => a.push({ nivel, txt, rota, n })
    if (Perm.pode('compras')) {
      const lc = C.listaCompras().filter(x => !x.jaPedido)
      if (lc.length) add('alto', `${U.plural(lc.length, 'peça')} abaixo do mínimo para comprar`, '#/compras/lista', lc.length)
      const peds = S.lista('pedidos_compra').filter(p => p.status === 'aguardando')
      const atr = peds.filter(p => p.prazo && p.prazo < hoje())
      if (atr.length) add('alto', `${U.plural(atr.length, 'pedido')} de compra ${atr.length === 1 ? 'atrasado' : 'atrasados'}`, '#/compras?f=atrasado', atr.length)
      const hj = peds.filter(p => p.prazo === hoje())
      if (hj.length) add('medio', `${U.plural(hj.length, 'pedido')} para chegar hoje`, '#/compras?f=hoje', hj.length)
    }
    if (Perm.pode('financeiro')) {
      const ab = S.lista('lancamentos').filter(l => !l.pago_em)
      const venc = ab.filter(l => l.vencimento < hoje())
      const vp = venc.filter(l => l.tipo === 'pagar'), vr = venc.filter(l => l.tipo === 'receber')
      if (vp.length) add('alto', `${U.plural(vp.length, 'conta')} a pagar vencida${vp.length > 1 ? 's' : ''} (${U.moeda(U.soma(vp, 'valor'))})`, '#/financeiro?f=vencida&t=pagar', vp.length)
      if (vr.length) add('alto', `${U.plural(vr.length, 'conta')} a receber atrasada${vr.length > 1 ? 's' : ''} (${U.moeda(U.soma(vr, 'valor'))})`, '#/financeiro?f=vencida&t=receber', vr.length)
      const hj = ab.filter(l => l.vencimento === hoje())
      if (hj.length) add('medio', `${U.plural(hj.length, 'conta')} vence${hj.length > 1 ? 'm' : ''} hoje (${U.moeda(U.soma(hj, 'valor'))})`, '#/financeiro?f=hoje', hj.length)
      const semConta = S.lista('pedidos_compra').filter(p => p.recebido_em && p.recebido_em >= U.somaDias(hoje(), -60) && C.semConta(p))
      if (semConta.length) add('baixo', `${U.plural(semConta.length, 'pedido')} recebido${semConta.length > 1 ? 's' : ''} sem conta a pagar lançada`, '#/compras?f=semconta', semConta.length)
    }
    const ords = S.lista('ordens').filter(o => o.status === 'fila' || o.status === 'producao')
    const oatr = ords.filter(o => o.prazo && o.prazo < hoje())
    if (oatr.length) add('alto', `${U.plural(oatr.length, 'ordem', 'ordens')} de produção ${oatr.length === 1 ? 'atrasada' : 'atrasadas'}`, '#/producao', oatr.length)
    const mab = S.lista('manutencoes').filter(m => m.status !== 'concluida' && m.tipo === 'corretiva')
    if (mab.length) add('alto', `${U.plural(mab.length, 'máquina')} com problema aberto`, '#/maquinas?f=problema', mab.length)
    const prev = S.lista('maquinas').filter(m => m.ativo && C.situacaoMaquina(m).cod === 'prevvencida')
    if (prev.length) add('medio', `${U.plural(prev.length, 'máquina')} com preventiva vencida`, '#/maquinas?f=preventiva', prev.length)
    if (Perm.pode('compras')) {
      const venc = S.lista('fornecedores').filter(f => f.ativo && f.qualif_validade && f.qualif_validade < hoje())
      if (venc.length) add('baixo', `${U.plural(venc.length, 'fornecedor', 'fornecedores')} com qualificação vencida`, '#/fornecedores?f=qualif', venc.length)
    }
    if (Perm.pode('salarios')) {
      let n = 0
      for (const f of S.lista('funcionarios')) { const fe = C.ferias(f, S.get('funcionarios_privado', f.id)); if (fe && fe.limite && (fe.diasParaVencer ?? 99) <= 60) n++ }
      if (n) add('medio', `${U.plural(n, 'funcionário')} com férias para vencer (até 60 dias)`, '#/equipe?f=ferias', n)
    }
    if (Perm.pode('importar') && API.modo === 'nuvem') {
      const ult = ultimaCopia()
      const dias = ult ? U.dias(ult, hoje()) : null
      if (dias === null || dias > 7) add('baixo', dias === null ? 'Baixe a primeira cópia de segurança dos dados' : `Faz ${dias} dias que não baixa a cópia de segurança`, '#/admin?aba=copia', 1)
    }
    const ordem = { alto: 0, medio: 1, baixo: 2 }
    return a.sort((x, y) => ordem[x.nivel] - ordem[y.nivel])
  },
}

// data da última cópia de segurança baixada neste aparelho (texto puro 'AAAA-MM-DD')
export const ultimaCopia = (): string | null => { try { return localStorage.getItem('jaf.ultimaCopia') } catch { return null } }
