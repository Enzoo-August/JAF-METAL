/* Leitura do arquivo XML da nota fiscal eletrônica (NF-e, modelo 55).
 * Roda no aparelho da pessoa: o arquivo não sai dele, só os dados que ela confirmar vão para o banco. */

export interface ItemNota {
  n: number                 // nº do item na nota
  codigo: string            // código do produto no fornecedor (cProd)
  ean: string
  descricao: string
  ncm: string
  cfop: string
  unidade: string
  qtd: number
  valorUnit: number         // preço unitário da nota (vUnCom)
  valor: number             // valor dos produtos do item (vProd)
  custoUnit: number         // custo de verdade por unidade: produto + IPI + frete + seguro + outras − desconto
  pedido: string            // pedido de compra informado pelo fornecedor (xPed)
}

export interface Duplicata { numero: string; vencimento: string; valor: number }

export interface Nota {
  chave: string
  numero: string
  serie: string
  emissao: string           // AAAA-MM-DD
  natureza: string
  emitente: { nome: string; razao: string; cnpj: string; ie: string; endereco: string; bairro: string; cidade: string; uf: string; cep: string; telefone: string }
  destCnpj: string
  destNome: string          // destinatário (na nota de saída da JAF é o cliente)
  saida: boolean            // tpNF = 1 (nota de saída)
  valorProdutos: number
  frete: number
  ipi: number
  desconto: number
  valor: number             // total da nota (vNF)
  itens: ItemNota[]
  duplicatas: Duplicata[]
  infoAdicional: string
  autorizada: boolean       // tem o protocolo de autorização da Sefaz
}

export class ErroNota extends Error {}

const dig = (s: string | null | undefined): string => (s || '').replace(/\D/g, '')
const n = (s: string | null | undefined): number => { const v = Number((s || '').trim()); return Number.isFinite(v) ? v : 0 }
const r4 = (v: number): number => Math.round(v * 10000) / 10000

// primeiro elemento com esse nome dentro de "em" (ignora o namespace da Sefaz)
function el(em: Element | Document | null | undefined, nome: string): Element | null {
  if (!em) return null
  return em.getElementsByTagNameNS('*', nome)[0] || em.getElementsByTagName(nome)[0] || null
}
const tx = (em: Element | Document | null | undefined, nome: string): string => (el(em, nome)?.textContent || '').trim()
const todos = (em: Element | Document, nome: string): Element[] => {
  const l = em.getElementsByTagNameNS('*', nome)
  return [...(l.length ? l : em.getElementsByTagName(nome))]
}

// CNPJ 00.000.000/0000-00 (ou CPF 000.000.000-00)
export const formatarDoc = (d: string): string => {
  const x = dig(d)
  if (x.length === 14) return x.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (x.length === 11) return x.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return d
}
const formatarCep = (c: string): string => { const x = dig(c); return x.length === 8 ? x.slice(0, 5) + '-' + x.slice(5) : c }
const formatarFone = (f: string): string => {
  const x = dig(f)
  if (x.length === 10) return `(${x.slice(0, 2)}) ${x.slice(2, 6)}-${x.slice(6)}`
  if (x.length === 11) return `(${x.slice(0, 2)}) ${x.slice(2, 7)}-${x.slice(7)}`
  return f
}
// Nomes em maiúsculas (como vêm da Sefaz) ficam mais fáceis de ler assim: "ACOS BRASIL LTDA" → "Acos Brasil Ltda"
const PEQUENAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])
const SIGLAS = new Set(['ltda', 'me', 'epp', 'sa', 's/a', 'eireli', 'cia'])
export const nomeBonito = (s: string): string => {
  const t = s.trim().replace(/\s+/g, ' ')
  if (t !== t.toUpperCase()) return t
  return t.toLowerCase().split(' ').map((w, i) => {
    if (i > 0 && PEQUENAS.has(w)) return w
    if (SIGLAS.has(w)) return w === 'ltda' ? 'Ltda' : w === 'eireli' ? 'Eireli' : w === 'cia' ? 'Cia' : w.toUpperCase()
    return w.charAt(0).toUpperCase() + w.slice(1)
  }).join(' ')
}

// confere o dígito verificador da chave de 44 números (módulo 11)
export function chaveValida(chave: string): boolean {
  const c = dig(chave)
  if (c.length !== 44) return false
  let soma = 0, peso = 2
  for (let i = 42; i >= 0; i--) { soma += Number(c[i]) * peso; peso = peso === 9 ? 2 : peso + 1 }
  const resto = soma % 11
  const dv = resto < 2 ? 0 : 11 - resto
  return dv === Number(c[43])
}

export function lerNotaXml(texto: string): Nota {
  const doc = new DOMParser().parseFromString(texto.replace(/^﻿/, ''), 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new ErroNota('O arquivo não é um XML válido. Use o arquivo .xml que veio no e-mail do fornecedor (não o PDF).')
  const inf = el(doc, 'infNFe')
  if (!inf) {
    if (el(doc, 'infCte')) throw new ErroNota('Este arquivo é de um conhecimento de transporte (CT-e), não de uma nota de mercadoria.')
    if (el(doc, 'infEvento')) throw new ErroNota('Este arquivo é de um evento da nota (cancelamento, carta de correção…), não da nota em si.')
    throw new ErroNota('Este arquivo não é uma nota fiscal eletrônica (NF-e).')
  }
  const ide = el(inf, 'ide'), emit = el(inf, 'emit'), end = el(emit, 'enderEmit'), tot = el(inf, 'ICMSTot')
  const modelo = tx(ide, 'mod')
  if (modelo && modelo !== '55') throw new ErroNota(modelo === '65' ? 'Este arquivo é de um cupom fiscal (NFC-e), não de uma nota de compra.' : 'Este arquivo não é uma NF-e de mercadoria.')
  const chave = dig(tx(doc, 'chNFe')) || dig(inf.getAttribute('Id'))
  if (!chaveValida(chave)) throw new ErroNota('A chave da nota não confere. O arquivo pode estar incompleto ou alterado.')

  const itens: ItemNota[] = []
  for (const det of todos(inf, 'det')) {
    const prod = el(det, 'prod')
    const qtd = n(tx(prod, 'qCom')), valor = n(tx(prod, 'vProd'))
    const ipi = n(tx(el(det, 'IPITrib'), 'vIPI'))
    const extra = n(tx(prod, 'vFrete')) + n(tx(prod, 'vSeg')) + n(tx(prod, 'vOutro')) - n(tx(prod, 'vDesc'))
    itens.push({
      n: Number(det.getAttribute('nItem')) || itens.length + 1,
      codigo: tx(prod, 'cProd'), ean: /^\d{8,14}$/.test(tx(prod, 'cEAN')) ? tx(prod, 'cEAN') : '',
      descricao: tx(prod, 'xProd'), ncm: tx(prod, 'NCM'), cfop: tx(prod, 'CFOP'),
      unidade: tx(prod, 'uCom'), qtd, valorUnit: n(tx(prod, 'vUnCom')), valor,
      custoUnit: qtd > 0 ? r4((valor + ipi + extra) / qtd) : 0,
      pedido: tx(prod, 'xPed'),
    })
  }
  if (!itens.length) throw new ErroNota('A nota não tem itens.')

  const dh = tx(ide, 'dhEmi') || tx(ide, 'dEmi')
  const rua = [tx(end, 'xLgr'), tx(end, 'nro')].filter(Boolean).join(', ') + (tx(end, 'xCpl') ? ' - ' + tx(end, 'xCpl') : '')
  const razao = nomeBonito(tx(emit, 'xNome'))
  return {
    chave,
    numero: String(Number(tx(ide, 'nNF')) || tx(ide, 'nNF')),
    serie: tx(ide, 'serie'),
    emissao: dh.slice(0, 10),
    natureza: tx(ide, 'natOp'),
    emitente: {
      nome: nomeBonito(tx(emit, 'xFant')) || razao, razao, cnpj: formatarDoc(tx(emit, 'CNPJ') || tx(emit, 'CPF')), ie: tx(emit, 'IE'),
      endereco: nomeBonito(rua), bairro: nomeBonito(tx(end, 'xBairro')), cidade: nomeBonito(tx(end, 'xMun')), uf: tx(end, 'UF').toUpperCase(),
      cep: formatarCep(tx(end, 'CEP')), telefone: formatarFone(tx(end, 'fone')),
    },
    destCnpj: dig(tx(el(inf, 'dest'), 'CNPJ')),
    destNome: nomeBonito(tx(el(inf, 'dest'), 'xNome')),
    saida: tx(ide, 'tpNF') === '1',
    valorProdutos: n(tx(tot, 'vProd')), frete: n(tx(tot, 'vFrete')), ipi: n(tx(tot, 'vIPI')), desconto: n(tx(tot, 'vDesc')),
    valor: n(tx(tot, 'vNF')),
    itens,
    duplicatas: todos(inf, 'dup').map((d, i) => ({ numero: tx(d, 'nDup') || String(i + 1).padStart(3, '0'), vencimento: tx(d, 'dVenc'), valor: n(tx(d, 'vDup')) }))
      .filter(d => d.valor > 0 && /^\d{4}-\d{2}-\d{2}$/.test(d.vencimento)),
    infoAdicional: tx(el(inf, 'infAdic'), 'infCpl'),
    autorizada: !!el(doc, 'protNFe') && ['100', '150'].includes(tx(el(doc, 'infProt'), 'cStat')),
  }
}
