/* Arquivos que o sistema gera: PDF (texto de verdade, com jsPDF — não é "foto" da tela) e Excel.
 * As bibliotecas só são baixadas quando alguém pede um arquivo (o sistema abre mais rápido). */
import type { jsPDF as JsPDF } from 'jspdf'
import type { UserOptions } from 'jspdf-autotable'
import { API } from '../lib/api.ts'
import { C, S } from '../lib/dados.ts'
import type { PedidoCompra } from '../lib/tipos.ts'
import * as U from '../lib/util.ts'
import { erro } from './avisos.ts'
import { Ic } from './icones.tsx'
import { modal, useJanela } from './janelas.tsx'

// ------------------------------------------------------------------ Excel
export const xlsx = () => import('xlsx')
export const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// várias abas a partir de listas de objetos (cada objeto = uma linha; as chaves = cabeçalho)
export async function excel(nome: string, abas: [string, Record<string, unknown>[]][], comDatas = false): Promise<void> {
  const X = await xlsx()
  const wb = X.utils.book_new()
  for (const [aba, linhas] of abas) X.utils.book_append_sheet(wb, X.utils.json_to_sheet(linhas.length ? linhas : [{ '': 'vazio' }], { cellDates: comDatas }), aba)
  await entregar(new Blob([X.write(wb, { bookType: 'xlsx', type: 'array', cellDates: comDatas })], { type: TIPO_XLSX }), nome)
}
// uma aba a partir de linhas já montadas (cabeçalho na 1ª linha)
export async function excelLinhas(nome: string, aba: string, linhas: unknown[][]): Promise<void> {
  const X = await xlsx()
  const wb = X.utils.book_new()
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(linhas), aba)
  await entregar(new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: TIPO_XLSX }), nome)
}

// ------------------------------------------------------------------ PDF
let logo: string | null = null
async function carregarLogo(): Promise<string | null> {
  if (logo) return logo
  const b = await (await fetch('./assets/logo.png')).blob()
  logo = await new Promise<string>((ok) => { const f = new FileReader(); f.onload = () => ok(String(f.result)); f.readAsDataURL(b) })
  return logo
}
// já deixa o gerador pronto (no iPhone o "compartilhar" precisa ser rápido depois do toque)
export const prepararPdf = (): void => { void import('jspdf').catch(() => null); void import('jspdf-autotable').catch(() => null) }

export type Doc = JsPDF & { lastAutoTable: { finalY: number } }
async function novo(orientacao: 'p' | 'l' = 'p'): Promise<{ doc: Doc; tabela: (o: UserOptions) => void }> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: orientacao, unit: 'mm', format: 'a4' }) as Doc
  doc.setFont('helvetica', 'normal')
  return { doc, tabela: (o) => autoTable(doc, o) }
}

function cabecalho(doc: Doc, titulo: string, sub: string): number {
  const W = doc.internal.pageSize.getWidth()
  const emp = S.cfg<Record<string, string>>('empresa', {})
  if (logo) doc.addImage(logo, 'PNG', 14, 10, 52, 10.8)
  doc.setFontSize(8.5); doc.setTextColor(90)
  const linhas = [emp.razao || emp.nome || 'JAF Metal', [emp.cnpj ? 'CNPJ ' + emp.cnpj : '', emp.ie ? 'IE ' + emp.ie : ''].filter(Boolean).join(' · '),
    [emp.endereco, emp.cidade && emp.uf ? emp.cidade + '/' + emp.uf : emp.cidade].filter(Boolean).join(' — '),
    [emp.telefone, emp.email].filter(Boolean).join(' · ')].filter(Boolean)
  linhas.forEach((l, i) => doc.text(l, W - 14, 12 + i * 4, { align: 'right' }))
  doc.setDrawColor(63, 102, 161); doc.setLineWidth(0.6); doc.line(14, 26, W - 14, 26)
  doc.setTextColor(20); doc.setFontSize(15); doc.setFont('helvetica', 'bold')
  doc.text(titulo, 14, 35)
  doc.setFont('helvetica', 'normal')
  if (sub) { doc.setFontSize(9.5); doc.setTextColor(90); doc.text(sub, 14, 41) }
  return sub ? 46 : 41
}

function rodape(doc: Doc): void {
  const n = doc.getNumberOfPages(), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(140)
    doc.text(`Gerado em ${U.dataHora(new Date().toISOString())} por ${API.sessao?.nome || ''}`, 14, H - 8)
    doc.text(`Página ${i} de ${n}`, W - 14, H - 8, { align: 'right' })
  }
}

const estiloTabela: UserOptions = {
  styles: { font: 'helvetica', fontSize: 8.8, cellPadding: 1.8, textColor: 25, lineColor: [210, 216, 224], lineWidth: 0.15 },
  headStyles: { fillColor: [28, 42, 61], textColor: 255, fontStyle: 'bold', fontSize: 8.2 },
  alternateRowStyles: { fillColor: [246, 248, 251] },
  margin: { left: 14, right: 14, bottom: 16 },
}

// ---------------------------------------------------------------- pedido de compra
export async function pdfPedido(ped: PedidoCompra): Promise<Blob> {
  await carregarLogo().catch(() => null)
  const { doc, tabela } = await novo()
  const f = S.get('fornecedores', ped.fornecedor_id)
  const W = doc.internal.pageSize.getWidth()
  let y = cabecalho(doc, `Pedido de compra nº ${ped.numero}`, `Data: ${U.data(ped.data)}${ped.prazo ? '   ·   Entrega combinada: ' + U.data(ped.prazo) : ''}`)
  doc.setFontSize(9); doc.setTextColor(90); doc.text('FORNECEDOR', 14, y + 2)
  doc.setTextColor(20); doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.text(f?.razao || f?.nome || '', 14, y + 7)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  const info = [f?.razao && f.nome !== f.razao ? f.nome : '', f?.cnpj ? 'CNPJ ' + f.cnpj : '', f?.contato ? 'Contato: ' + f.contato : '',
    [U.tel(f?.telefone), U.tel(f?.celular)].filter(Boolean).join(' / '), f?.email || ''].filter(Boolean)
  doc.text(doc.splitTextToSize(info.join('   ·   '), W - 28), 14, y + 12)
  y += 20
  const itens = C.itensDoPedido(ped.id)
  tabela({
    ...estiloTabela, startY: y,
    head: [['#', 'Código', 'Descrição', 'Qtd', 'Preço unit.', 'Total']],
    body: itens.map((i, n) => { const p = S.get('pecas', i.peca_id)
      return [n + 1, p?.codigo || '', p?.descricao || '', `${U.qtd(i.qtd)} ${p?.unidade || ''}`, U.moeda(i.valor / i.qtd), U.moeda(i.valor)] }),
    columnStyles: { 0: { cellWidth: 8, halign: 'center' }, 1: { cellWidth: 42, font: 'courier' }, 3: { halign: 'right', cellWidth: 18 }, 4: { halign: 'right', cellWidth: 25 }, 5: { halign: 'right', cellWidth: 27 } },
  })
  y = doc.lastAutoTable.finalY + 6
  doc.setFontSize(10)
  const sub = U.soma(itens, 'valor')
  const lin: [string, string][] = [['Subtotal', U.moeda(sub)]]
  if (ped.frete) lin.push(['Frete', U.moeda(ped.frete)])
  lin.forEach(([k, v]) => { doc.text(k, W - 60, y); doc.text(v, W - 14, y, { align: 'right' }); y += 5 })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text('Total', W - 60, y + 1); doc.text(U.moeda(sub + (Number(ped.frete) || 0)), W - 14, y + 1, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  y += 10
  const obs = [ped.documento ? 'Referência: ' + ped.documento : '', ped.obs && ped.obs !== 'Importado da planilha' ? 'Observações: ' + ped.obs : ''].filter(Boolean)
  if (obs.length) { doc.text(doc.splitTextToSize(obs.join('\n'), W - 28), 14, y); y += 6 + obs.length * 5 }
  doc.text('Por favor, confirme o recebimento deste pedido e o prazo de entrega. Informe o número do pedido na nota fiscal.', 14, Math.min(y + 4, 260))
  doc.line(W - 84, 278, W - 14, 278); doc.text(API.sessao?.nome || '', W - 49, 283, { align: 'center' })
  rodape(doc)
  return doc.output('blob')
}

// ---------------------------------------------------------------- tabela genérica (relatórios, lista de compras)
export interface ColunaPdf { t: string; w?: number; alinhar?: 'right' | 'center'; mono?: boolean }
export interface GrupoPdf { titulo: string; linhas: (string | number)[][]; totais?: (string | number)[] }
export async function pdfTabela(titulo: string, sub: string, colunas: ColunaPdf[], linhas: (string | number)[][], opt: { totais?: (string | number)[]; grupos?: GrupoPdf[]; deitado?: boolean } = {}): Promise<Blob> {
  await carregarLogo().catch(() => null)
  const { doc, tabela } = await novo(opt.deitado ? 'l' : 'p')
  let y = cabecalho(doc, titulo, sub)
  const cs: Record<number, { cellWidth?: number; halign?: 'right' | 'center'; font?: string }> = {}
  colunas.forEach((c, i) => { cs[i] = {}; if (c.w) cs[i].cellWidth = c.w; if (c.alinhar) cs[i].halign = c.alinhar; if (c.mono) cs[i].font = 'courier' })
  const pe = { fillColor: [235, 239, 245] as [number, number, number], textColor: 20, fontStyle: 'bold' as const }
  if (opt.grupos) {
    for (const g of opt.grupos) {
      if (y > 250) { doc.addPage(); y = 20 }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(20); doc.text(g.titulo, 14, y + 3)
      doc.setFont('helvetica', 'normal')
      tabela({ ...estiloTabela, startY: y + 5, head: [colunas.map(c => c.t)], body: g.linhas, foot: g.totais ? [g.totais] : undefined, footStyles: pe, columnStyles: cs })
      y = doc.lastAutoTable.finalY + 8
    }
  } else {
    tabela({ ...estiloTabela, startY: y + 2, head: [colunas.map(c => c.t)], body: linhas, foot: opt.totais ? [opt.totais] : undefined, footStyles: pe, columnStyles: cs })
  }
  rodape(doc)
  return doc.output('blob')
}

// ---------------------------------------------------------------- documento livre (ficha, aviso de férias, advertência…)
export interface CtxDoc {
  doc: Doc; tabela: (o: UserOptions) => void; estilo: UserOptions; W: number; H: number; y: number
  // escreve um parágrafo quebrando a linha e devolve o y de baixo (pula de página se precisar)
  texto: (t: string, y: number, opt?: { tam?: number; negrito?: boolean; x?: number; largura?: number; cor?: number; alinhar?: 'left' | 'center' | 'right' | 'justify' }) => number
  assinatura: (nome: string, sub: string, x: number, y: number, largura?: number) => void
}
export async function pdfDocumento(titulo: string, sub: string, desenhar: (c: CtxDoc) => void, deitado = false): Promise<Blob> {
  await carregarLogo().catch(() => null)
  const { doc, tabela } = await novo(deitado ? 'l' : 'p')
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  const y = cabecalho(doc, titulo, sub)
  const texto: CtxDoc['texto'] = (t, y0, o = {}) => {
    const tam = o.tam || 10, x = o.x ?? 14, larg = o.largura ?? W - 28
    doc.setFontSize(tam); doc.setFont('helvetica', o.negrito ? 'bold' : 'normal'); doc.setTextColor(o.cor ?? 25)
    // a fonte do PDF não tem alguns símbolos: troca por parecidos
    const linhas = doc.splitTextToSize(t.replace(/−/g, '-').replace(/→/g, '>').replace(/★/g, '*').replace(/✓/g, 'ok'), larg) as string[]
    const alt = tam * 0.42
    let yy = y0
    for (const l of linhas) {
      if (yy > H - 20) { doc.addPage(); yy = 20 }
      if (o.alinhar === 'center') doc.text(l, x + larg / 2, yy, { align: 'center' })
      else if (o.alinhar === 'right') doc.text(l, x + larg, yy, { align: 'right' })
      else doc.text(l, x, yy)
      yy += alt
    }
    doc.setFont('helvetica', 'normal')
    return yy + 1.5
  }
  const assinatura: CtxDoc['assinatura'] = (nome, s2, x, y0, larg = 80) => {
    doc.setDrawColor(60); doc.setLineWidth(0.3); doc.line(x, y0, x + larg, y0)
    doc.setFontSize(9); doc.setTextColor(25); doc.text(nome, x + larg / 2, y0 + 4.5, { align: 'center' })
    if (s2) { doc.setFontSize(8); doc.setTextColor(110); doc.text(s2, x + larg / 2, y0 + 8.5, { align: 'center' }) }
  }
  desenhar({ doc, tabela, estilo: estiloTabela, W, H, y, texto, assinatura })
  rodape(doc)
  return doc.output('blob')
}

// ------------------------------------------------------------------ entregar: abre / compartilha / salva
export async function entregar(blob: Blob, nome: string): Promise<void> {
  try { await U.salvarArquivo(blob, nome) }
  catch (e) {
    if ((e as Error).name !== 'NotAllowedError') { erro(e); return }
    // o aparelho exige um toque novo para compartilhar
    let fechar: (() => void) | null = null
    void modal({
      titulo: 'Arquivo pronto',
      corpo: <><p><Ic n="ok" /> <b>{nome}</b></p><p className="sub">Toque em Compartilhar para mandar por WhatsApp, e-mail ou salvar.</p><Fechador aoMontar={(f) => { fechar = f }} /></>,
      peExtra: <button type="button" className="btn pri" onClick={() => navigator.share({ files: [new File([blob], nome, { type: blob.type })], title: nome }).then(() => fechar?.()).catch(() => {})}>
        <Ic n="enviar" /><span>Compartilhar</span></button>,
    })
  }
}
function Fechador({ aoMontar }: { aoMontar: (f: () => void) => void }) { const j = useJanela(); aoMontar(() => j.fechar(true)); return null }
