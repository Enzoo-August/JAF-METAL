/* Leitura do PDF da nota fiscal (DANFE) pelo texto — para quando o fornecedor manda só o PDF.
 * O que é certo vem da CHAVE DE ACESSO (44 números, com dígito conferido): CNPJ de quem emitiu, número e série.
 * Os itens saem das linhas da tabela "Dados dos produtos": código/descrição … NCM (8 números) CST CFOP unidade quantidade …
 * PDF escaneado (foto) não tem texto. Tudo o que vem do PDF aparece para a pessoa conferir antes de gravar. */
import { chaveValida, ErroNota, formatarDoc, nomeBonito, type ItemNota, type Nota } from './nfe.ts'
import { numero } from './pedidopdf.ts'

const dig = (s: string | null | undefined): string => (s || '').replace(/\D/g, '')
const DATA = /\b(\d{2})\/(\d{2})\/(\d{4})\b/
const CNPJ = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g
// … NCM  CST (000, 0/00, 0 00, 0102)  CFOP  UN  QTD  V.UNIT  V.TOTAL
const ITEM = /^(.*?)\s(\d{8})\s+(?:\d\s?\/?\s?)?\d{2,4}\s+([1-7]\d{3})\s+([A-Za-zÇç]{1,6}\.?)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/

const iso = (m: RegExpMatchArray | null): string => {
  if (!m) return ''
  const d = Number(m[1]), mes = Number(m[2]), a = Number(m[3])
  return d >= 1 && d <= 31 && mes >= 1 && mes <= 12 && a >= 2000 && a <= 2100 ? `${a}-${m[2]}-${m[1]}` : ''
}

// a chave aparece em grupos de 4 ("3526 1100 …") ou colada; o dígito verificador confirma
export function chaveDoTexto(linhas: string[]): string {
  for (const l of linhas) {
    for (const m of l.matchAll(/(?:\d{4}[\s.]?){10}\d{4}/g)) { const c = dig(m[0]); if (chaveValida(c)) return c }
    const d = dig(l); if (d.length === 44 && chaveValida(d)) return d
  }
  return ''
}

export function lerDanfeTexto(linhas: string[]): Nota {
  const L = linhas.map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const tudo = L.join('\n')
  if (!/DANFE|DOCUMENTO AUXILIAR DA NOTA FISCAL|NOTA FISCAL ELETR[ÔO]NICA|CHAVE DE ACESSO/i.test(tudo))
    throw new ErroNota('Este PDF não parece uma nota fiscal (DANFE). Use o PDF da nota ou, melhor ainda, o arquivo XML.')
  const chave = chaveDoTexto(L)
  if (!chave) throw new ErroNota('Não achei a chave de acesso (44 números) neste PDF. Use o arquivo XML da nota ou lance à mão.')
  if (chave.slice(20, 22) !== '55') throw new ErroNota('Este PDF não é de uma NF-e de mercadoria (modelo 55).')
  const cnpjEmit = chave.slice(6, 20)

  // data de emissão: perto do rótulo "Data da emissão"; senão a primeira data do documento
  let emissao = ''
  const iE = L.findIndex(l => /DATA\s+(DA|DE)\s+EMISS[ÃA]O/i.test(l))
  if (iE >= 0) for (const l of L.slice(iE, iE + 4)) { emissao = iso(l.match(DATA)); if (emissao) break }
  if (!emissao) for (const l of L) { emissao = iso(l.match(DATA)); if (emissao) break }
  if (!emissao) { const aamm = chave.slice(2, 6); emissao = `20${aamm.slice(0, 2)}-${aamm.slice(2, 4)}-01` }

  // quem emitiu: canhoto "RECEBEMOS DE <RAZÃO SOCIAL> OS PRODUTOS…"
  const rec = tudo.replace(/\n/g, ' ').match(/RECEBEMOS DE (.{3,90}?) OS PRODUTOS/i)
  const razao = rec ? nomeBonito(rec[1]) : ''
  // destinatário: linha depois de "NOME / RAZÃO SOCIAL"; CNPJ = o primeiro que não é o de quem emitiu
  const cnpjs = [...tudo.matchAll(CNPJ)].map(m => dig(m[0]))
  const destCnpj = cnpjs.find(c => c !== cnpjEmit) || ''
  let destNome = ''
  const iD = L.findIndex(l => /NOME\s*\/\s*RAZ[ÃA]O\s+SOCIAL/i.test(l))
  if (iD >= 0 && L[iD + 1]) destNome = nomeBonito(L[iD + 1].replace(CNPJ, ' ').replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, ' ').replace(DATA, ' ').replace(/\s+/g, ' ').trim())
  const iN = L.findIndex(l => /NATUREZA\s+DA\s+OPERA[ÇC][ÃA]O/i.test(l))
  const natureza = iN >= 0 ? (L[iN].replace(/.*NATUREZA\s+DA\s+OPERA[ÇC][ÃA]O\s*/i, '').trim() || (L[iN + 1] || '')).slice(0, 80) : ''
  const iA = L.findIndex(l => /INFORMA[ÇC][ÕO]ES\s+COMPLEMENTARES|DADOS\s+ADICIONAIS/i.test(l))
  const info = iA >= 0 ? L.slice(iA, iA + 12).join(' ') : ''

  const itens: ItemNota[] = []
  for (const l of L) {
    const m = l.match(ITEM); if (!m) continue
    const ini = m[1].trim(), qtd = numero(m[5], false) ?? 0, vu = numero(m[6], false) ?? 0, vt = numero(m[7], false) ?? 0
    if (!ini || qtd <= 0) continue
    // código no começo da linha; o código da JAF tem espaço no meio ("GB 01.0088"): não pode ser partido
    const mj = ini.match(/^([A-Za-z]{2,3}\s*[.-]?\s*\d{2}\s*[.\s-]?\s*\d{4}[A-Za-z]?)(?:\s+(.*))?$/)
    const [cod, desc] = mj ? [mj[1], mj[2] || ''] : [ini.split(' ')[0], ini.split(' ').slice(1).join(' ')]
    itens.push({ n: itens.length + 1, codigo: cod, ean: '', descricao: desc || ini, ncm: m[2], cfop: m[3], unidade: m[4].toUpperCase().replace(/\.$/, ''),
      qtd, valorUnit: vu, valor: vt, custoUnit: vu, pedido: '' })
  }
  if (!itens.length) throw new ErroNota('Achei a nota, mas não consegui ler os itens deste PDF. Use o arquivo XML da nota ou lance à mão.')

  return {
    chave, numero: String(Number(chave.slice(25, 34))), serie: String(Number(chave.slice(22, 25))), emissao, natureza,
    emitente: { nome: razao, razao, cnpj: formatarDoc(cnpjEmit), ie: '', endereco: '', bairro: '', cidade: '', uf: '', cep: '', telefone: '' },
    destCnpj, destNome, saida: true,
    valorProdutos: 0, frete: 0, ipi: 0, desconto: 0, valor: 0,
    itens, duplicatas: [], infoAdicional: info, autorizada: true, refs: [], origem: 'pdf',
  }
}
