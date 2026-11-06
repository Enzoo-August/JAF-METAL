/* Prévia de impressão: todo PDF que o sistema gera abre aqui primeiro — a folha do jeito que vai sair no papel —
 * com Imprimir, Baixar PDF e, no celular, Compartilhar (WhatsApp, e-mail, impressora).
 * As páginas são desenhadas pelo pdf.js a partir do MESMO arquivo que vai ser impresso (não é uma imitação).
 * A biblioteca só é baixada na primeira prévia; sem ela (sem internet, aparelho antigo) aparece o leitor do navegador. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as U from '../lib/util.ts'
import { aviso, erro } from './avisos.ts'
import { Ic } from './icones.tsx'
import { modal } from './janelas.tsx'

export interface OptPrevia {
  titulo?: string
  dica?: ReactNode
  // botões de envio (pedido de compra): e-mail e WhatsApp do destinatário
  email?: string | null
  whats?: string | null
  assunto?: string
  texto?: string
}

type PdfJs = typeof import('pdfjs-dist')
let carregando: Promise<PdfJs> | null = null
const pdfjs = (): Promise<PdfJs> => carregando ||= (async () => {
  const [m, w] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
  m.GlobalWorkerOptions.workerSrc = w.default
  return m
})().catch((e) => { carregando = null; throw e })
// deixa a biblioteca a caminho (chamado ao abrir telas que imprimem)
export const prepararPrevia = (): void => { void pdfjs().catch(() => null) }

const toque = (): boolean => matchMedia('(pointer: coarse)').matches
const arquivo = (blob: Blob, nome: string) => new File([blob], nome, { type: 'application/pdf' })
const podeCompartilhar = (blob: Blob, nome: string): boolean => { try { return toque() && !!navigator.canShare && navigator.canShare({ files: [arquivo(blob, nome)] }) } catch { return false } }

// imprime o próprio PDF (no computador abre a janela de impressão do navegador)
export function imprimirPdf(blob: Blob): void {
  const url = URL.createObjectURL(blob)
  if (toque()) { window.open(url, '_blank'); setTimeout(() => URL.revokeObjectURL(url), 180000); return }
  const fr = document.createElement('iframe')
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0'
  fr.onload = () => { setTimeout(() => { try { fr.contentWindow!.focus(); fr.contentWindow!.print() } catch { window.open(url, '_blank') } }, 150) }
  fr.src = url
  document.body.appendChild(fr)
  setTimeout(() => { fr.remove(); URL.revokeObjectURL(url) }, 180000)
}

// as folhas desenhadas (cada página vira uma "folha" branca sobre o fundo cinza)
function Folhas({ blob }: { blob: Blob }) {
  const caixa = useRef<HTMLDivElement>(null)
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'falhou'>('carregando')
  const [paginas, setPaginas] = useState(0)
  const [url] = useState(() => URL.createObjectURL(blob))
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  useEffect(() => {
    let vivo = true
    let tarefa: { destroy: () => Promise<void> } | null = null
    void (async () => {
      try {
        const m = await pdfjs()
        const t = m.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useWasm: false })
        tarefa = t
        const d = await t.promise
        if (!vivo) return
        setPaginas(d.numPages)
        const alvo = caixa.current!
        const larg = Math.max(280, Math.min(alvo.clientWidth - 24, 860))
        const dens = Math.min(2, window.devicePixelRatio || 1) * 1.25
        for (let i = 1; i <= d.numPages && vivo; i++) {
          const pg = await d.getPage(i)
          const base = pg.getViewport({ scale: 1 })
          const vp = pg.getViewport({ scale: (larg / base.width) * dens })
          const cv = document.createElement('canvas')
          cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height)
          cv.className = 'folha'
          cv.setAttribute('aria-label', `Página ${i} de ${d.numPages}`)
          cv.style.aspectRatio = `${base.width} / ${base.height}`
          await pg.render({ canvas: cv, viewport: vp }).promise
          if (!vivo) return
          alvo.appendChild(cv)
          if (i === 1) setEstado('ok')
        }
      } catch (e) {
        console.warn('prévia do PDF', e)
        if (vivo) setEstado('falhou')
      }
    })()
    return () => { vivo = false; void tarefa?.destroy().catch(() => null) }
  }, [blob])
  return <div className="previa-pdf" data-previa={estado}>
    {estado === 'carregando' && <div className="previa-carregando"><span className="giro" /> Preparando a prévia…</div>}
    {estado === 'falhou' && (toque()
      ? <div className="previa-carregando">Não deu para mostrar a folha aqui. Use <b>Baixar PDF</b> ou <b>Compartilhar</b> abaixo.</div>
      : <iframe className="previa-iframe" src={url} title="Prévia do PDF" />)}
    <div ref={caixa} className="folhas" hidden={estado === 'falhou'} />
    {estado === 'ok' && paginas > 1 && <p className="previa-n">{U.plural(paginas, 'página')}</p>}
  </div>
}

// abre a prévia; resolve quando a janela fecha
export async function previaPDF(blob: Blob, nome: string, opt: OptPrevia = {}): Promise<void> {
  const share = podeCompartilhar(blob, nome)
  const compartilhar = async () => {
    try { await navigator.share({ files: [arquivo(blob, nome)], title: nome }) } catch (e) { if ((e as Error).name !== 'AbortError') erro(e) }
  }
  const baixar = async () => {
    try { const ok = await U.salvarArquivo(blob, nome); if (ok && !toque()) aviso('PDF salvo: ' + nome) } catch (e) { if ((e as Error).name !== 'NotAllowedError') erro(e) }
  }
  const tel = String(opt.whats || '').replace(/\D/g, '')
  const enviarEmail = async () => {
    if (share) return compartilhar()
    await baixar()
    location.href = `mailto:${encodeURIComponent(opt.email || '')}?subject=${encodeURIComponent(opt.assunto || nome.replace(/\.pdf$/i, ''))}&body=${encodeURIComponent((opt.texto || 'Segue em anexo.') + '\n\n(anexe o arquivo ' + nome + ' que acabou de ser salvo)')}`
  }
  const enviarWhats = async () => {
    if (share) return compartilhar()
    await baixar()
    window.open(`https://wa.me/${tel.length >= 10 && tel.length <= 11 ? '55' + tel : tel}?text=${encodeURIComponent((opt.texto || '') + ' (segue o PDF ' + nome + ')')}`, '_blank', 'noopener')
  }
  await modal({
    titulo: opt.titulo || nome.replace(/\.pdf$/i, ''),
    largura: 'doc',
    fecharTxt: 'Fechar',
    corpo: <>
      <p className="previa-dica"><Ic n="imprimir" /> <span>{opt.dica || 'Prévia: é assim que a folha vai sair no papel.'}</span></p>
      <Folhas blob={blob} />
    </>,
    botoes: [
      { txt: 'Baixar PDF', icone: 'baixar', cls: 'sec', validar: false, acao: async () => { await baixar(); return false } },
      ...(opt.email ? [{ txt: 'E-mail', icone: 'email' as const, cls: 'sec', validar: false, acao: async () => { await enviarEmail(); return false } }] : []),
      ...(tel ? [{ txt: 'WhatsApp', icone: 'whatsapp' as const, cls: 'sec', validar: false, acao: async () => { await enviarWhats(); return false } }] : []),
      ...(share ? [{ txt: 'Compartilhar', icone: 'enviar' as const, cls: 'sec', validar: false, acao: async () => { await compartilhar(); return false } }] : []),
      { txt: 'Imprimir', icone: 'imprimir', cls: 'pri', validar: false, acao: () => { imprimirPdf(blob); return false } },
    ],
  })
}
