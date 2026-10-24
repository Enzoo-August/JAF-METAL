/* Avisos rápidos (embaixo da tela) e o "escudo" contra toque duplo.
 * Ficam fora do React de propósito: aparecem por cima de tudo e somem sozinhos, sem depender do desenho das telas. */
import { traduzir } from '../lib/api.ts'
import { icSvg } from './icones.tsx'

// com uma janela aberta, os avisos ficam logo ACIMA dos botões dela (nunca por cima)
export function posicionarAvisos(): void {
  const box = document.getElementById('avisos')
  if (!box) return
  const pe = [...document.querySelectorAll('.janela-fundo:not(.saindo):not(.confirmar) .janela-pe')].at(-1)
  box.style.bottom = pe ? Math.max(8, innerHeight - pe.getBoundingClientRect().top + 8) + 'px' : ''
}
window.addEventListener('resize', posicionarAvisos)

export interface OptAviso { acao?: { txt: string; fn: () => unknown }; tempo?: number }

export function aviso(msg: string, tipo: 'ok' | 'erro' = 'ok', opt: OptAviso = {}): void {
  const box = document.getElementById('avisos')
  if (!box) return
  posicionarAvisos()
  const el = document.createElement('div')
  el.className = 'aviso a-' + tipo
  el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status')
  el.insertAdjacentHTML('beforeend', icSvg(tipo === 'erro' ? 'alerta' : 'ok'))
  const span = document.createElement('span'); span.textContent = msg; el.appendChild(span)
  const sai = () => { el.classList.add('saindo'); setTimeout(() => el.remove(), 250) }
  if (opt.acao) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'aviso-acao'; b.textContent = opt.acao.txt
    const fn = opt.acao.fn
    b.onclick = async () => { b.disabled = true; sai(); await fn() }
    el.appendChild(b)
  }
  const x = document.createElement('button'); x.type = 'button'; x.className = 'aviso-x'; x.setAttribute('aria-label', 'Fechar')
  x.insertAdjacentHTML('beforeend', icSvg('x')); x.onclick = sai
  el.appendChild(x)
  box.appendChild(el)
  setTimeout(sai, opt.tempo || (opt.acao ? 9000 : (tipo === 'erro' ? 7000 : 3500)))
}

export function erro(e: unknown): void {
  const err = traduzir(e)
  console.warn(e)
  if (err.sessao) { document.dispatchEvent(new Event('jaf:sessaocaiu')); return }
  aviso(err.message, 'erro')
}

// depois de fechar uma janela, segura os toques por um instante: um toque duplo no botão da janela
// não pode "atravessar" e apertar o que estava embaixo (ex.: o Retirar da barra de baixo)
export function escudo(ms = 450): void {
  const e = document.createElement('div')
  e.className = 'escudo-toque'
  e.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation() }, true)
  document.body.appendChild(e)
  setTimeout(() => e.remove(), ms)
}

// botão ocupado (anti toque duplo) para ações fora das janelas
export async function ocupado<T>(btn: HTMLElement | null | undefined, fn: () => Promise<T>): Promise<T | undefined> {
  if (!btn) return fn()
  const b = btn as HTMLButtonElement
  if (b.dataset.ocupado) return undefined
  b.dataset.ocupado = '1'; b.disabled = true; b.classList.add('carregando')
  try { return await fn() } finally { delete b.dataset.ocupado; b.disabled = false; b.classList.remove('carregando') }
}
