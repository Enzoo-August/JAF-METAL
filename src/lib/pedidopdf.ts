/* Pedido de compra do cliente em PDF (ordem de compra): lê o texto das linhas e acha os itens.
 * Funciona com o PDF "de verdade" (gerado pelo sistema do cliente); PDF escaneado (foto) não tem texto.
 * Cada item é uma linha com: [posição] código descrição DATA quantidade [unidade] preço …
 * Os números podem vir no jeito americano (1,308.93) ou no brasileiro (1.308,93): o leitor descobre pelo documento. */

export interface ItemPdf { pos: number | null; codigo: string; descricao: string; prazo: string; qtd: number; unidade: string; preco: number | null }
export interface PedidoLido { pedido: string; data: string | null; cnpjs: string[]; itens: ItemPdf[]; americano: boolean }

const DATA = /\b(\d{2})[/.-](\d{2})[/.-](\d{2}|\d{4})\b/
const NUM = /^\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?$|^\d+(?:[.,]\d+)?$/
const UNID = /^(UN|UND|UNID|PC|PCS|PÇ|PÇS|CJ|JG|KG|M|MT|L|CX|PAR|KIT|PEÇA|PECA|PECAS|PEÇAS)$/i

// "1,308.93" / "1.308,93" / "5.00" → número
export function numero(t: string, americano: boolean): number | null {
  const s = t.trim(); if (!s || !/^[\d.,]+$/.test(s)) return null
  let x = s
  if (s.includes('.') && s.includes(',')) x = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  else if (s.includes(',')) x = americano && /,\d{3}$/.test(s) ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.')
  else if (s.includes('.')) x = !americano && /\.\d{3}$/.test(s) && !/^0\./.test(s) ? s.replace(/\./g, '') : s
  const v = Number(x)
  return Number.isFinite(v) ? v : null
}

const isoData = (m: RegExpMatchArray): string | null => {
  const d = Number(m[1]), mes = Number(m[2]); let a = Number(m[3]); if (a < 100) a += 2000
  if (d < 1 || d > 31 || mes < 1 || mes > 12 || a < 2000 || a > 2100) return null
  return `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const ehCodigo = (t: string): boolean => t.length >= 3 && t.length <= 40 && /\d/.test(t) && /^[A-Za-z0-9][A-Za-z0-9.\-_/]*$/.test(t) && !DATA.test(t)

// uma linha → item (ou nada)
function item(linha: string, americano: boolean): ItemPdf | null {
  const l = linha.replace(/\s+/g, ' ').replace(/\(\d{3}\)/g, ' ').replace(/\s+/g, ' ').trim()
  const md = l.match(DATA); if (!md || md.index === undefined) return null
  const prazo = isoData(md); if (!prazo) return null
  const antes = l.slice(0, md.index).trim().split(' ').filter(Boolean), depois = l.slice(md.index + md[0].length).trim().split(' ').filter(Boolean)
  let pos: number | null = null
  if (antes.length && /^\d{1,4}$/.test(antes[0]) && antes.length >= 3) pos = Number(antes.shift())
  const ic = antes.findIndex(ehCodigo); if (ic < 0 || ic > 1) return null
  const codigo = antes[ic]
  let resto = antes.slice(ic + 1)
  // quantidade e preço: depois da data (o mais comum) ou antes dela, no fim da descrição
  let nums = depois
  if (!nums.length || !NUM.test(nums[0])) {
    const i = resto.findIndex(t => NUM.test(t) && numero(t, americano) !== null && resto.slice(resto.indexOf(t)).every(x => NUM.test(x) || UNID.test(x)))
    if (i < 0) return null
    nums = resto.slice(i); resto = resto.slice(0, i)
  }
  const qtd = numero(nums[0], americano); if (qtd === null || qtd <= 0) return null
  let k = 1, unidade = ''
  if (nums[k] && UNID.test(nums[k])) { unidade = nums[k].toUpperCase(); k++ }
  const preco = nums[k] && NUM.test(nums[k]) ? numero(nums[k], americano) : null
  const descricao = resto.join(' ').trim()
  if (!descricao) return null
  return { pos, codigo, descricao, prazo, qtd, unidade, preco }
}

export function lerPedidoTexto(linhas: string[]): PedidoLido {
  const texto = linhas.join('\n')
  const americano = /\d,\d{3}\.\d{2}\b/.test(texto) || (!/\d\.\d{3},\d{2}\b/.test(texto) && /\b\d+\.\d{2,3}\b/.test(texto) && !/\b\d+,\d{2}\b/.test(texto))
  const ped = texto.match(/ORDEM\s+DE\s+COMPRA\s*(?:N[º°o.]*)?\s*[:\-]?\s*(\d{3,})/i) || texto.match(/PEDIDO(?:\s+DE\s+COMPRA)?\s*(?:N[º°o.]*)?\s*[:\-]\s*([A-Z0-9\-/]{3,})/i)
    || texto.match(/\b(?:PO|OC|P\.O\.)\s*(?:N[º°o.]*)?\s*[:\-]?\s*(\d{4,})/i)
  const dt = texto.match(/\bData\s*(?:de\s+emiss[aã]o)?\s*[:\-]?\s*(\d{2}[/.-]\d{2}[/.-]\d{2,4})/i)
  const cnpjs = [...new Set([...texto.matchAll(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g)].map(m => m[0].replace(/\D/g, '')).filter(c => c.length === 14))]
  const itens: ItemPdf[] = []
  for (let i = 0; i < linhas.length; i++) {
    const it = item(linhas[i], americano)
    if (it) { itens.push(it); continue }
    // linha que continua a descrição do item anterior (ex.: "(001) PADRAO"), sem "Destino:" e sem números soltos
    const ult = itens[itens.length - 1]
    if (ult && i > 0 && item(linhas[i - 1], americano)) {
      const extra = linhas[i].replace(/\(\d{3}\)/g, ' ').replace(/\s+/g, ' ').trim()
      if (extra && extra.length <= 40 && !/[:]/.test(extra) && !/^(IPI|ICMS|PIS|COFINS|TOTAL)/i.test(extra)) ult.descricao += ' — ' + extra
    }
  }
  return { pedido: ped ? ped[1] : '', data: dt ? isoData(dt[1].match(DATA)!) : null, cnpjs, itens, americano }
}
