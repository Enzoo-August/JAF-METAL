/* Ícones de traço 24×24 (desenho próprio, sem biblioteca externa) */

const IC = {
  inicio: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  estoque: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  retirar: '<path d="M12 14V3m0 0L8 7m4-4 4 4"/><path d="M4 13v7h16v-7"/>',
  entrada: '<path d="M12 3v11m0 0-4-4m4 4 4-4"/><path d="M4 13v7h16v-7"/>',
  compras: '<path d="M3 4h2l2.3 11a1 1 0 0 0 1 .8h9a1 1 0 0 0 1-.8L20 8H6"/><circle cx="9" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>',
  fornecedor: '<path d="M2 6h12v10H2zM14 9h4l3 3.5V16h-7"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  maquina: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  producao: '<path d="M3 21V11l5 3v-3l5 3v-3l5 3V4h3v17z"/><path d="M7 17h2M12 17h2"/>',
  dinheiro: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.8"/><path d="M6 12h.01M18 12h.01"/>',
  equipe: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2A6.5 6.5 0 0 1 21.5 20"/>',
  cliente: '<path d="M4 21V4h10v17M14 9h6v12M3 21h18"/><path d="M8 8h2M8 12h2M8 16h2M17 13h.01M17 17h.01"/>',
  relatorio: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  admin: '<path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  ajuda: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.5v.6M12 17.2v.01"/>',
  sino: '<path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sair: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
  atualizar: '<path d="M20 11A8 8 0 0 0 5.3 7.2M4 3.5v4h4M4 13a8 8 0 0 0 14.7 3.8M20 20.5v-4h-4"/>',
  lapis: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>',
  lixo: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  imprimir: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><path d="M7 14h10v7H7z"/>',
  whatsapp: '<path d="M4 20.5 5.3 16.6A8.2 8.2 0 1 1 8.5 19.4z"/><path d="M9 9.5c.3 2.5 2.2 4.4 5 5l1-1.4-1.6-1-1 .7c-.8-.4-1.4-1-1.8-1.8l.7-1-1-1.6z"/>',
  telefone: '<path d="M5 3h3.5l2 5-2.4 1.4a11 11 0 0 0 5.5 5.5L15 12.5l5 2V18a2 2 0 0 1-2.2 2A16 16 0 0 1 4 6.2 2 2 0 0 1 5 3"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  ok: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  alerta: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.01"/>',
  baixar: '<path d="M12 3v12m-4-4 4 4 4-4"/><path d="M4 17v3h16v-3"/>',
  enviar: '<path d="M12 15V3m-4 4 4-4 4 4"/><path d="M4 17v3h16v-3"/>',
  desfazer: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  chave: '<path d="M14.7 6.3a4.2 4.2 0 0 0 5 5.3L21 13l-8.5 8.5-3-3L18 10l-1.3-1.3a4.2 4.2 0 0 1-5.3-5l2.6 2.6 1.9-.4z"/>',
  calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  lista: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  contar: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
  copiar: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  historico: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5"/><path d="M3.5 3.5v5h5M12 8v4.5l3 2"/>',
  filtro: '<path d="M3 5h18l-7 8.5V20l-4-2v-4.5z"/>',
  seta: '<path d="m9 6 6 6-6 6"/>',
  voltar: '<path d="m15 6-6 6 6 6"/>',
  planilha: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>',
  cadeado: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  olho: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/>',
  instalar: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M12 7v7m-3-3 3 3 3-3M10 18.5h4"/>',
} as const

export type NomeIcone = keyof typeof IC

// os desenhos são constantes deste arquivo (nunca texto do usuário)
export function Ic({ n, cls = '' }: { n: NomeIcone; cls?: string }) {
  return <svg className={`ic ${cls}`.trim()} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9"
    strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: IC[n] }} />
}

// para os avisos (montados fora do React)
export const icSvg = (n: NomeIcone): string =>
  `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${IC[n]}</svg>`
