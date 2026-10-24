/* JAF Metal — leitura da planilha Almoxarifado.xlsm (usada na Administração e nos testes).
 * Não grava nada: devolve o que vai ser importado e as conferências. Roda também no Node (testes). */
import type * as XLSXTipos from 'xlsx'
import * as U from './util.ts'

type X = typeof XLSXTipos
type WorkBook = XLSXTipos.WorkBook
type Linha = Record<string, unknown>

export interface FornecedorLido {
  nome: string; razao?: string | null; tipo?: string; contato?: string | null; contato2?: string | null; telefone?: string | null; celular?: string | null
  endereco?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null; cep?: string | null; cnpj?: string | null; ie?: string | null
  qualificacao?: string | null; qualif_metodo?: string | null; qualif_validade?: string | null; email?: string | null; site?: string | null; obs?: string | null; ativo?: boolean
}
export interface PecaLida { codigo: string; descricao: string | null; utilizacao: string | null; fornecedor: string | null; est_min: number; est_max: number; qtd_planilha?: number | null; obs?: string }
export interface MovLido { data: string | null; codigo: string | null; tipo: 'entrada' | 'saida'; qtd: number; preco_unit: number; fornecedor: string | null; documento: string | null }
export interface PedidoLido { data: string | null; fornecedor: string | null; documento: string | null; prazo: string | null; status: 'recebido' | 'aguardando'; itens: { codigo: string; descricao: string | null; qtd: number; valor: number; ordem: number }[] }
export interface Leitura {
  fornecedores: FornecedorLido[]; pecas: PecaLida[]; movs: MovLido[]; pedidos: PedidoLido[]; avisos: string[]; ignoradas: string[]
  diverg: PecaLida[]; saldo: Map<string, number>; mapa: Map<string, string>; cadastro: FornecedorLido[]; novos: string[]; utils: string[]; arquivo: string
}

export const norm = (s: unknown): string => U.sem(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const PARADAS = new Set(['ltda', 'me', 'epp', 'eireli', 'sa', 's', 'a', 'de', 'da', 'do', 'e', 'com', 'comercio', 'comercial', 'ind', 'industria', 'industrias', 'cia'])
const tokens = (s: unknown): string[] => norm(s).split(' ').filter(t => t && !PARADAS.has(t))

// liga o nome curto usado nas abas (ex.: "AB Tools") ao cadastro completo ("Abtools Ferramentas de Corte Ltda.")
export function casarFornecedor<F extends FornecedorLido>(curto: string, cadastro: F[]): F | null {
  const nC = norm(curto).replace(/ /g, ''), tC = tokens(curto)
  if (!nC) return null
  const exato = cadastro.find(f => norm(f.nome).replace(/ /g, '') === nC); if (exato) return exato
  const contem = (a: string[], b: string[]) => a.every(t => b.some(u => u === t || (t.length >= 4 && u.startsWith(t)) || (u.length >= 4 && t.startsWith(u))))
  let cand = cadastro.filter(f => { const tS = tokens(f.nome); return tC.length && tS.length && (contem(tC, tS) || contem(tS, tC) || tS.includes(nC) || tC.includes(norm(f.nome).replace(/ /g, ''))) })
  if (cand.length === 1) return cand[0]
  if (cand.length > 1) return null // ambíguo: melhor criar novo do que ligar errado
  // o nome usado nas abas aparece no e-mail de um cadastro (ex.: "João Silva" x joaosilva@…)
  if (nC.length >= 6) {
    cand = cadastro.filter(f => norm(f.email || '').replace(/ /g, '').includes(nC))
    if (cand.length === 1) return cand[0]
  }
  // última tentativa só para siglas (ex.: "XYZ Afiação" x "XYZ Ferramentas"); nome de pessoa (ex.: "João …") não liga sozinho
  const sigla = String(curto).trim().split(/\s+/)[0]
  if (!/^[A-Z0-9]{2,5}$/.test(sigla)) return null
  cand = cadastro.filter(f => tokens(f.nome)[0] === tC[0])
  return cand.length === 1 ? cand[0] : null
}
export const PARECE_MAQUINA = /torno|fresa|serra|prensa|curvadora|rosqueadeira|escareadora|lixadeira|furadeira|estufa|cabine|compressor|^ta\b|^thr\b|^fs \d|^sr \d|retifica/i
// sugestão inicial (a pessoa confere): parece máquina, não é posição de peça "(árvore…)" nem plural genérico
export const sugerirMaquina = (u: string): boolean => PARECE_MAQUINA.test(u) && !/[()]/.test(u) && !/doras$/i.test(u) && !/^ta$/i.test(u)
// "THR 01      Escareadora de tubos" (várias na mesma célula) e "TA 25 e TA 15"
export const separarUtil = (v: unknown): string[] => String(v ?? '').split(/\s{2,}|\s\/\s|\s+e\s+(?=[A-Z]{2,4}\s?\d)/).map(x => U.limpa(x)).filter(Boolean)

// ---------------------------------------------------------------- nada da aba Fornecedores pode se perder
// (1) site escrito em OBSERVAÇÕES vai para o campo Site; "mailto:" vira e-mail
// (2) links escondidos atrás do texto das células (muitas vezes de OUTRO fornecedor) e
// (3) linhas sem nome (só um e-mail/site) vão para o fornecedor dono do endereço (pelo domínio);
//     sem dono certo, ficam anotados na própria linha para conferir; sem linha, num cadastro de contatos avulsos.
const GENERICOS = new Set(['gmail', 'hotmail', 'outlook', 'yahoo', 'terra', 'uol', 'bol', 'ig', 'superig', 'live', 'msn', 'globo', 'icloud', 'r7', 'zipmail'])
const ehUrl = (s: unknown) => /^(https?:\/\/|www\.)\S+$/i.test(String(s || '').trim())
const semMailto = (s: unknown) => String(s || '').trim().replace(/^mailto:/i, '')
const chave = (s: unknown) => semMailto(s).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')
const dominio = (s: unknown) => { const v = chave(s); const d = v.includes('@') ? v.split('@')[1] : v.split('/')[0]; return (d || '').split('.')[0] }
type Txt = (v: unknown) => string | null

function recuperarFornecedores(XLSX: X, wb: WorkBook, cadastro: FornecedorLido[], txt: Txt) {
  const nomeAba = wb.SheetNames.find(n => norm(n) === 'fornecedores')
  const ws = nomeAba ? wb.Sheets[nomeAba] : undefined
  const r = { links: 0, aoDono: 0, naLinha: 0, avulsos: [] as string[] }
  for (const f of cadastro) {
    if (f.email && /^mailto:/i.test(f.email)) f.email = semMailto(f.email)
    if (f.obs && ehUrl(f.obs)) { f.site = f.obs; f.obs = null }
    else if (f.obs && /^mailto:/i.test(f.obs)) { if (!f.email) { f.email = semMailto(f.obs); f.obs = null } else f.obs = 'Outro e-mail: ' + semMailto(f.obs) }
  }
  if (!ws || !ws['!ref']) return r
  const faixa = XLSX.utils.decode_range(ws['!ref'])
  const cel = (r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })] as XLSXTipos.CellObject | undefined
  const porNome = new Map(cadastro.map(f => [U.sem(f.nome), f]))
  const dono = (valor: string) => {
    const d = dominio(valor)
    if (!d || d.length < 4 || GENERICOS.has(d)) return null
    const c = cadastro.filter(f => norm([f.nome, f.razao, f.email, f.site].filter(Boolean).join(' ')).replace(/ /g, '').includes(d))
    return c.length === 1 ? c[0] : null
  }
  const anotar = (f: FornecedorLido, valor: string, nota: string) => {
    const v = semMailto(valor), email = v.includes('@') && !/\s/.test(v)
    if (email && !f.email) { f.email = v.toLowerCase(); return }
    if (!email && ehUrl(v) && !f.site) { f.site = v; return }
    const ja = [f.email, f.site, f.obs].filter(Boolean).map(chave).join(' | ')
    if (ja.includes(chave(v))) return
    f.obs = [f.obs, `${nota}: ${v}`].filter(Boolean).join('\n')
  }
  for (let lin = faixa.s.r + 1; lin <= faixa.e.r; lin++) {
    const nome = txt(cel(lin, 0)?.v)
    for (let c = 0; c <= faixa.e.c; c++) {
      const x = cel(lin, c)
      if (!x) continue
      const valores: string[] = []
      // célula de linha sem nome de fornecedor (só e-mail ou site)
      if (!nome && x.v !== undefined && x.v !== null && String(x.v).trim()) valores.push(String(x.v))
      // link escondido diferente do texto que aparece
      const alvo = x.l?.Target
      if (alvo && !alvo.startsWith('#') && chave(alvo) !== chave(x.v)) { valores.push(alvo); r.links++ }
      for (const v of valores) {
        const f = dono(v)
        if (f) { anotar(f, v, 'Também na planilha'); r.aoDono++; continue }
        const daLinha = nome ? porNome.get(U.sem(nome)) : undefined
        if (daLinha) { anotar(daLinha, v, 'Link escondido nesta linha da planilha (conferir de quem é)'); r.naLinha++; continue }
        r.avulsos.push(semMailto(v))
      }
    }
  }
  return r
}

// anotações feitas à mão na aba escondida "Análise Anual de Custos" (máquina/produto de cada código)
function anotacoesAnalise(XLSX: X, wb: WorkBook, txt: Txt): Map<string, Set<string>> {
  const nomeAba = wb.SheetNames.find(n => norm(n).startsWith('analise anual'))
  const ws = nomeAba ? wb.Sheets[nomeAba] : undefined
  const notas = new Map<string, Set<string>>()
  if (!ws || !ws['!ref']) return notas
  const faixa = XLSX.utils.decode_range(ws['!ref'])
  const cel = (r: number, c: number) => (ws[XLSX.utils.encode_cell({ r, c })] as XLSXTipos.CellObject | undefined)?.v
  let colNota = -1, linCab = -1
  for (let lin = faixa.s.r; lin <= Math.min(faixa.e.r, 10) && colNota < 0; lin++)
    for (let c = 0; c <= faixa.e.c; c++) if (/m[aá]quina/i.test(String(cel(lin, c) || ''))) { colNota = c; linCab = lin; break }
  if (colNota < 0) return notas
  for (let lin = linCab + 1; lin <= faixa.e.r; lin++) {
    const cod = txt(cel(lin, 0)), nota = txt(cel(lin, colNota))
    if (!cod || !nota) continue
    const k = U.sem(cod)
    if (!notas.has(k)) notas.set(k, new Set())
    notas.get(k)!.add(nota)
  }
  return notas
}

// wb: planilha já aberta com XLSX.read(..., { cellDates: true })
export function ler(XLSX: X, wb: WorkBook, arquivo: string): Leitura {
  const aba = (nome: string): Linha[] | null => { const k = wb.SheetNames.find(n => norm(n) === norm(nome)); return k ? XLSX.utils.sheet_to_json<Linha>(wb.Sheets[k], { defval: null, raw: true }) : null }
  const col = (linha: Linha, ...nomes: string[]): unknown => { for (const n of nomes) { const k = Object.keys(linha).find(x => norm(x) === norm(n)); if (k !== undefined && linha[k] !== null && linha[k] !== '') return linha[k] } return null }
  const txt: Txt = (v) => v === null || v === undefined ? null : (v instanceof Date ? U.iso(v) : U.limpa(String(v))) || null
  const num = (v: unknown): number | null => v === null || v === undefined || v === '' ? null : (typeof v === 'number' ? v : U.num(v))
  const data = (v: unknown): string | null => {
    if (v instanceof Date) return U.iso(new Date(v.getTime() + 12 * 3600e3))
    if (typeof v === 'number') return U.iso(new Date(Math.round((v - 25569) * 86400e3) + 12 * 3600e3))
    const t = txt(v); if (!t) return null
    const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    return /^\d{4}-\d\d-\d\d/.test(t) ? t.slice(0, 10) : null
  }

  const rForn = aba('Fornecedores'), rPecas = aba('Peças'), rEst = aba('Estoque'), rPed = aba('Controle de Pedidos')
  const faltam = [!rForn && 'Fornecedores', !rPecas && 'Peças', !rEst && 'Estoque', !rPed && 'Controle de Pedidos'].filter(Boolean) as string[]
  if (faltam.length > 2) throw new Error('Esta não parece ser a planilha Almoxarifado (não achei as abas ' + faltam.join(', ') + ').')
  const avisos: string[] = []
  if (faltam.length) avisos.push('Abas não encontradas (serão ignoradas): ' + faltam.join(', '))

  // fornecedores do cadastro
  const cadastro: FornecedorLido[] = (rForn || []).map(l => ({
    nome: txt(col(l, 'FORNECEDOR')) || '', contato: txt(col(l, 'CONTATO')), contato2: txt(col(l, 'Contato 2')), telefone: txt(col(l, 'TELEFONE')),
    // "O mesmo" na coluna CELULAR = o celular é o mesmo número do telefone
    celular: /^o mesmo$/i.test(txt(col(l, 'CELULAR')) || '') ? txt(col(l, 'TELEFONE')) : txt(col(l, 'CELULAR')), endereco: txt(col(l, 'ENDEREÇO', 'ENDERECO')), bairro: txt(col(l, 'BAIRRO')),
    cidade: txt(col(l, 'CIDADE')), uf: txt(col(l, 'UF')), cep: txt(col(l, 'CEP')), cnpj: txt(col(l, 'CNPJ')), ie: txt(col(l, 'I.E.', 'IE')),
    qualificacao: /^(ok|sim|aprovado)$/i.test(txt(col(l, 'APROV.', 'APROV')) || '') ? 'Aprovado' : null, qualif_metodo: txt(col(l, 'MÉTODO', 'METODO')),
    qualif_validade: data(col(l, 'VALIDADE')), email: txt(col(l, 'EMAIL', 'E-MAIL')), obs: txt(col(l, 'OBSERVAÇÕES', 'OBSERVACOES')),
  })).filter(f => f.nome)
  for (const f of cadastro) { f.razao = f.nome; if (/eletricista|mec[aâ]nico|pedreiro|t[eé]cnico|desentupidora|conserto|assist[eê]ncia/i.test(f.nome)) f.tipo = 'Serviço' }
  const extras = recuperarFornecedores(XLSX, wb, cadastro, txt)

  // nomes usados nas outras abas
  const pecas: PecaLida[] = (rPecas || []).map(l => ({ codigo: txt(col(l, 'Código', 'Codigo')) || '', descricao: txt(col(l, 'Descrição', 'Descricao')),
    utilizacao: separarUtil(col(l, 'Utilização', 'Utilizacao')).join(' / ') || null, fornecedor: txt(col(l, 'Fornecedor')),
    est_min: num(col(l, 'Estoque Min.', 'Estoque Min')) || 0, est_max: num(col(l, 'Estoque Máx.', 'Estoque Max.', 'Estoque Max')) || 0,
    qtd_planilha: num(col(l, 'Qde Estoque')) })).filter(p => p.codigo)
  const movs: MovLido[] = [], ignoradas: string[] = []
  const semQtd: (Omit<MovLido, 'tipo' | 'qtd'> & { linha: number })[] = []
  ;(rEst || []).forEach((l, n) => {
    const d = data(col(l, 'Data')), cod = txt(col(l, 'Código', 'Codigo')), ent = num(col(l, 'Entrada')), sai = num(col(l, 'Saída', 'Saida'))
    if (!d && !cod) return
    const base = { data: d, codigo: cod, preco_unit: num(col(l, 'R$ Unitário', 'R$ Unitario')) || 0, fornecedor: txt(col(l, 'Fornecedor')), documento: txt(col(l, 'Documento')) }
    if (!d || !cod || (!((ent ?? 0) > 0) && !((sai ?? 0) > 0))) {
      ignoradas.push(`Estoque, linha ${n + 2}: ${cod || 'sem código'} — ${!d ? 'sem data' : 'sem quantidade'} (guardada como observação da peça)`)
      if (cod) semQtd.push({ ...base, linha: n + 2 })
      return
    }
    if ((ent ?? 0) > 0) movs.push({ ...base, tipo: 'entrada', qtd: ent! })
    if ((sai ?? 0) > 0) movs.push({ ...base, tipo: 'saida', qtd: sai! })
  })
  const grupos = new Map<string, PedidoLido>()
  ;(rPed || []).forEach((l) => {
    const cod = txt(col(l, 'Código', 'Codigo')); if (!cod) return
    const d = data(col(l, 'Data')), forn = txt(col(l, 'Fornecedor')), doc = txt(col(l, 'Documento')), st = /entreg/i.test(txt(col(l, 'Status')) || '') ? 'recebido' as const : 'aguardando' as const
    const prazo = data(col(l, 'Prazo'))
    const k = [d, forn, doc, st, prazo].join('|') // prazo diferente = entrega diferente: nada se perde
    if (!grupos.has(k)) grupos.set(k, { data: d || prazo, fornecedor: forn, documento: doc, prazo, status: st, itens: [] })
    const g = grupos.get(k)!; if (prazo && (!g.prazo || prazo > g.prazo)) g.prazo = prazo
    const desc = txt(col(l, 'Descrição', 'Descricao'))
    g.itens.push({ codigo: cod, descricao: desc && !/^#N\/?A/i.test(desc) ? desc : null, qtd: num(col(l, 'Qde', 'Quantidade')) || 1, valor: num(col(l, 'Valor')) || 0, ordem: g.itens.length + 1 })
  })
  const pedidos = [...grupos.values()].sort((a, b) => (a.data || '') < (b.data || '') ? -1 : (a.data || '') > (b.data || '') ? 1 : 0)

  // casamento de nomes de fornecedor
  const usados = new Map<string, number>()
  const conta = (n: string | null) => { if (n) usados.set(n, (usados.get(n) || 0) + 1) }
  pecas.forEach(p => conta(p.fornecedor)); movs.forEach(m => conta(m.fornecedor)); pedidos.forEach(p => conta(p.fornecedor))
  const mapa = new Map<string, string>() // nome usado -> nome final
  const porCadastro = new Map<FornecedorLido, string[]>()
  for (const [n] of [...usados.entries()].sort((a, b) => b[1] - a[1])) {
    const f = casarFornecedor(n, cadastro)
    if (f) { if (!porCadastro.has(f)) porCadastro.set(f, []); porCadastro.get(f)!.push(n) }
    else mapa.set(n, n)
  }
  const fornecedores: FornecedorLido[] = []
  for (const f of cadastro) {
    const nomes = porCadastro.get(f)
    // o mais curto entre o nome mais usado nas abas e o do cadastro vira o "nome"; o mais longo, a razão social
    // (se o mais usado for quase do mesmo tamanho do mais curto, fica o mais usado: "Gera Válvulas", não "Gera Válvula")
    // nome usado sem nenhuma palavra em comum com o cadastro (ex.: o nome da pessoa de contato) não vira o nome da empresa
    const parece = (u: string) => { const a = tokens(u), b = tokens(f.nome), j = norm(u).replace(/ /g, '')
      return a.some(t => b.some(x => x === t || (t.length >= 4 && x.startsWith(t)) || (x.length >= 4 && t.startsWith(x)))) || b.includes(j) }
    const usaveis = (nomes || []).filter(parece)
    const todos = [...usaveis, f.nome]
    const curto = todos.slice().sort((a, b) => a.length - b.length)[0]
    const final = usaveis.length && usaveis[0].length <= curto.length + 2 ? usaveis[0] : curto
    const razao = todos.slice().sort((a, b) => b.length - a.length)[0]
    if (nomes) nomes.forEach(n => mapa.set(n, final))
    fornecedores.push({ ...f, nome: final, razao: razao !== final ? razao : null })
  }
  const novos = [...new Set([...mapa.entries()].filter(([n, fin]) => n === fin && !fornecedores.some(f => U.sem(f.nome) === U.sem(n))).map(([n]) => n))]
  novos.forEach(n => fornecedores.push({ nome: n, obs: 'Criado na importação (aparecia nas abas, mas não no cadastro de fornecedores)' }))
  // e-mails/sites que estavam soltos na aba Fornecedores, sem dono identificável: guardados, nada se perde
  if (extras.avulsos.length) fornecedores.push({ nome: 'Contatos avulsos da planilha', ativo: false,
    obs: 'Estavam na aba Fornecedores sem nome de fornecedor (ou escondidos em links) e não deu para saber de quem são:\n' + [...new Set(extras.avulsos)].join('\n') })
  if (extras.links || extras.aoDono || extras.naLinha) avisos.push(`Aba Fornecedores: ${extras.links} links escondidos e linhas sem nome recuperados — ${extras.aoDono} foram para o fornecedor dono do endereço, ${extras.naLinha} ficaram anotados na própria linha para conferir${extras.avulsos.length ? `, ${extras.avulsos.length} em "Contatos avulsos da planilha"` : ''}.`)

  // peças: anotações da aba escondida e linhas do Estoque sem quantidade viram observação (nada se perde)
  const notas = anotacoesAnalise(XLSX, wb, txt)
  let nNotas = 0
  for (const p of pecas) {
    const obs: string[] = []
    const n = notas.get(U.sem(p.codigo))
    if (n) { const dif = [...n].filter(x => !U.sem(p.utilizacao || '').includes(U.sem(x))); if (dif.length) { obs.push('Anotado na planilha (Análise Anual de Custos): ' + dif.join(', ')); nNotas++ } }
    for (const s of semQtd.filter(x => U.sem(x.codigo) === U.sem(p.codigo)))
      obs.push(`Linha ${s.linha} do Estoque sem quantidade: ${U.data(s.data)}${s.fornecedor ? ' · ' + s.fornecedor : ''}${s.documento ? ' · ' + s.documento : ''}${s.preco_unit ? ' · R$ ' + U.dec(s.preco_unit) + ' cada' : ''}`)
    if (obs.length) p.obs = obs.join('\n')
  }
  if (nNotas) avisos.push(`${nNotas} peças com anotação de máquina/produto diferente na aba escondida "Análise Anual de Custos" (guardadas na observação da peça).`)
  // nomes repetidos depois do casamento (dois cadastros viraram o mesmo nome curto)
  const vistos = new Set<string>()
  for (const f of fornecedores) { let k = U.sem(f.nome), n = 2; while (vistos.has(k)) { f.nome = `${f.razao || f.nome} (${n++})`; k = U.sem(f.nome) } vistos.add(k) }
  const nomeFinal = (n: string | null) => n ? (mapa.get(n) || n) : null
  pecas.forEach(p => p.fornecedor = nomeFinal(p.fornecedor)); movs.forEach(m => m.fornecedor = nomeFinal(m.fornecedor)); pedidos.forEach(p => p.fornecedor = nomeFinal(p.fornecedor) || 'Sem fornecedor')

  // conferências
  const codigos = new Map(pecas.map(p => [U.sem(p.codigo), p]))
  const dup = pecas.filter((p, i) => pecas.findIndex(x => U.sem(x.codigo) === U.sem(p.codigo)) !== i)
  if (dup.length) avisos.push('Códigos repetidos na aba Peças (fica só o primeiro): ' + dup.map(p => p.codigo).join(', '))
  const semPecaMov = [...new Set(movs.filter(m => !codigos.has(U.sem(m.codigo))).map(m => m.codigo))]
  if (semPecaMov.length) avisos.push('Movimentações com código que não está na aba Peças (não entram): ' + semPecaMov.join(', '))
  const semPecaPed = [...new Set(pedidos.flatMap(p => p.itens).filter(i => !codigos.has(U.sem(i.codigo))).map(i => i.codigo))]
  if (semPecaPed.length) avisos.push(`Códigos que só aparecem no Controle de Pedidos (viram peças desativadas, para não perder o histórico): ${semPecaPed.join(', ')}`)
  const saldo = new Map<string, number>()
  for (const m of movs) { const k = U.sem(m.codigo); saldo.set(k, (saldo.get(k) || 0) + (m.tipo === 'entrada' ? m.qtd : -m.qtd)) }
  const diverg = pecas.filter(p => p.qtd_planilha !== null && p.qtd_planilha !== undefined && Math.abs((saldo.get(U.sem(p.codigo)) || 0) - p.qtd_planilha) > 1e-9)
  const negativos = [...saldo.entries()].filter(([, v]) => v < 0)
  if (negativos.length) avisos.push('Peças com saldo negativo pela soma das linhas: ' + negativos.map(([k]) => codigos.get(k)?.codigo || k).join(', '))
  const utilsMapa = new Map<string, string>()
  for (const u of pecas.flatMap(p => (p.utilizacao || '').split(' / ')).filter(Boolean)) if (!utilsMapa.has(U.sem(u))) utilsMapa.set(U.sem(u), u)
  const utils = [...utilsMapa.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  pecas.forEach(p => delete p.qtd_planilha)
  return { fornecedores, pecas, movs, pedidos, avisos, ignoradas, diverg, saldo, mapa, cadastro, novos, utils, arquivo }
}
