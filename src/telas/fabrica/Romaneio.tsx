/* Romaneio para faturamento: sai sozinho do que tem para entregar, uma linha por peça e pedido, no mesmo modelo do
 * formulário do PCP (Código JAF, Cód. cliente, Pedido, RI, OF, Quantidade, Embalagem), com o peso da carga,
 * responsável e data. Sai em PDF e em Excel.
 * v3.6 (pedido do Marcio): o período vai de uma data A até uma data B. A semana atual soma os atrasados; as semanas
 * seguintes trazem SÓ os pedidos daquela semana (nada acumulado). Uma faixa mostra as próximas semanas com a carga de
 * cada uma, e dá para gerar várias semanas de uma vez (Excel com uma aba por semana + a geral, como a planilha do PCP).
 * O que a pessoa digita (RI, OF, quantidade, embalagem, peso) fica guardado neste aparelho, por cliente e período. */
import { Fragment, useEffect } from 'react'
import { API } from '../../lib/api.ts'
import { C, S } from '../../lib/dados.ts'
import type { OF, Venda } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { entregar, pdfDocumento, xlsx, TIPO_XLSX } from '../../ui/arquivos.tsx'
import { Btn, Tag, Vazio } from '../../ui/base.tsx'
import { useLembrar } from '../../ui/ganchos.ts'

// segunda-feira e domingo da semana de uma data
export const segunda = (iso: string): string => { const d = U.d(iso)!; const dw = (d.getDay() + 6) % 7; return U.somaDias(iso, -dw) }
export const fimDaSemana = (iso: string): string => U.somaDias(segunda(iso), 6)
const ddmm = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7)

// período do romaneio: de A até B; atr = soma o que ficou em aberto antes de A; cheio = quantidade do pedido (não desconta o que já saiu)
export interface Periodo { de: string; ate: string; atr: boolean; cheio: boolean }

// base = saldo da linha quando a quantidade foi digitada: se o saldo mudar (entregou, programação nova), volta a sugerir o saldo
interface Edicao { qtd?: string; base?: number; ri?: string; of?: string; emb?: string; fora?: boolean }
interface Rascunho { linhas: Record<string, Edicao>; peso: string; resp: string; data: string; obs: string }
export interface LinhaRom {
  k: string; codigo: string; codigo_cliente: string; descricao: string; pedido: string; saldo: number; atraso: number; prazo: string
  itens: Venda[]; ofSug: OF | null
}

const rascunhoVazio = (): Rascunho => ({ linhas: {}, peso: '', resp: API.sessao?.nome || '', data: U.hoje(), obs: '' })
const chaveLocal = (cli: string, p: Periodo) => `jaf.romaneio.${cli || '-'}.${p.de}.${p.ate}`
// o rascunho guardado de um período (o da v3.2 era um só por cliente: vale para a semana atual)
const lerRascunho = (cli: string, p: Periodo, atual: boolean): Rascunho =>
  U.lerLocal<Rascunho | null>(chaveLocal(cli, p), null) || (atual ? U.lerLocal<Rascunho | null>('jaf.romaneio.' + (cli || '-'), null) : null) || rascunhoVazio()

// quanto de cada linha do pedido entra: o saldo (desconta o que já saiu) ou a quantidade cheia do pedido
const qtdItem = (v: Venda, p: Periodo): number => (p.cheio && v.prazo! >= p.de ? Math.max(0, Number(v.qtd) || 0) : Math.max(0, C.saldoVenda(v)))
// os pedidos que entram no período
export const vendasDoPeriodo = (todas: Venda[], p: Periodo): Venda[] => todas.filter(v => {
  if (v.prazo! >= p.de && v.prazo! <= p.ate) return qtdItem(v, p) > 0
  return p.atr && v.prazo! < p.de && C.saldoVenda(v) > 0
})

// junta o que tem para entregar por peça + pedido
export function linhasRomaneio(abertos: Venda[], hoje: string, q: (v: Venda) => number = v => Math.max(0, C.saldoVenda(v))): LinhaRom[] {
  const m = new Map<string, LinhaRom>()
  for (const v of abertos) {
    const cod = v.codigo || v.codigo_cliente || v.descricao || '?', k = cod + '|' + (v.pedido || '')
    const l = m.get(k) || { k, codigo: v.codigo || '', codigo_cliente: v.codigo_cliente || '', descricao: v.descricao || '', pedido: v.pedido || '', saldo: 0, atraso: 0, prazo: v.prazo!, itens: [], ofSug: null }
    const s = q(v)
    l.saldo = U.r4(l.saldo + s); if (v.prazo! < hoje) l.atraso = U.r4(l.atraso + Math.max(0, C.saldoVenda(v)))
    if (v.prazo! < l.prazo) l.prazo = v.prazo!
    l.itens.push(v); m.set(k, l)
  }
  // OF sugerida: a ligada ao pedido; se não tiver, a última OF encerrada da peça (o R.I. vem dela)
  const ofs = S.lista('ofs').filter(o => o.status !== 'cancelada')
  for (const l of m.values()) {
    const ids = new Set(l.itens.map(v => v.id)), prod = l.itens.find(v => v.produto_id)?.produto_id
    const daPeca = ofs.filter(o => o.produto_id === prod)
    l.ofSug = U.ordenar(daPeca.filter(o => o.venda_id && ids.has(o.venda_id)), o => o.numero, true)[0]
      || U.ordenar(daPeca.filter(o => o.status === 'encerrada'), o => (o.realizada_em || o.emitida_em) + String(o.numero).padStart(8, '0'), true)[0] || null
  }
  return U.ordenar([...m.values()], l => (l.codigo || l.codigo_cliente) + '|' + l.pedido)
}

// o que vai no romaneio, já com o que a pessoa digitou
const qtdTxt = (r: Rascunho, l: LinhaRom): string | undefined => { const e = r.linhas[l.k] || {}; return e.qtd !== undefined && e.base === l.saldo ? e.qtd : undefined }
const qtdDe = (r: Rascunho, l: LinhaRom): number => { const t = qtdTxt(r, l); return t === undefined || t === '' ? l.saldo : Math.max(0, Number(t.replace(',', '.')) || 0) }
const ofDe = (r: Rascunho, l: LinhaRom) => r.linhas[l.k]?.of ?? (l.ofSug ? String(l.ofSug.numero) : '')
const riDe = (r: Rascunho, l: LinhaRom) => r.linhas[l.k]?.ri ?? (l.ofSug?.ri ? String(l.ofSug.ri) : '')
const vaoDe = (r: Rascunho, ls: LinhaRom[]) => ls.filter(l => !r.linhas[l.k]?.fora && qtdDe(r, l) > 0)

// uma semana da faixa: nome = dia de entrega que mais aparece nela (o cliente entrega num dia fixo: 19/11, 26/11...)
interface Semana { i: number; seg: string; p: Periodo; rotulo: string; dia: string; linhas: LinhaRom[]; pecas: number; atraso: number }
function montarSemanas(doCli: Venda[], hoje: string, n: number, cheio: boolean): Semana[] {
  const seg0 = segunda(hoje), r: Semana[] = []
  for (let i = 0; i < n; i++) {
    const seg = U.somaDias(seg0, 7 * i), p: Periodo = { de: seg, ate: U.somaDias(seg, 6), atr: i === 0, cheio }
    const vs = vendasDoPeriodo(doCli, p), linhas = linhasRomaneio(vs, hoje, v => qtdItem(v, p))
    const dias = U.ordenar([...U.agrupar(vs.filter(v => v.prazo! >= p.de), v => v.prazo!).entries()], ([d, l]) => -l.length * 1e9 + Number(d.replace(/-/g, '')))
    const dia = dias[0]?.[0] || U.somaDias(seg, 3)
    r.push({ i, seg, p, dia, rotulo: ddmm(dia), linhas, pecas: U.soma(linhas, l => l.saldo), atraso: U.soma(linhas, l => l.atraso) })
  }
  return r
}
const quando = (i: number) => (i === 0 ? 'Esta semana' : i === 1 ? 'Próxima' : `Em ${i} semanas`)

export function Romaneio({ todas }: { todas: Venda[] }) {
  const hoje = U.hoje(), seg0 = segunda(hoje)
  const abertos = todas.filter(v => Number(v.qtd) > 0 && (C.saldoVenda(v) > 0 || v.prazo! >= seg0))
  const clientes = U.ordenar([...U.agrupar(abertos.filter(v => C.saldoVenda(v) > 0), v => v.cliente_id || v.cliente_nome || '').entries()].map(([k, l]) => ({ k, nome: l[0].cliente_nome || '—', n: l.length })), c => -c.n)
  const [cliEsc, setCli] = useLembrar('rom.cli', '')
  const cli = clientes.some(c => c.k === cliEsc) ? cliEsc : clientes[0]?.k || ''
  const nomeCli = clientes.find(c => c.k === cli)?.nome || ''
  const doCli = abertos.filter(v => (v.cliente_id || v.cliente_nome || '') === cli)

  const [modo, setModo] = useLembrar<'semana' | 'livre'>('rom.modo', 'semana')
  const [segEsc, setSeg] = useLembrar('rom.seg', seg0)
  const [de, setDe] = useLembrar('rom.de', seg0)
  const [ate, setAte] = useLembrar('rom.ate', fimDaSemana(hoje))
  const [atrLivre, setAtrLivre] = useLembrar('rom.atr', true)
  const [cheio, setCheio] = useLembrar('rom.cheio', false)
  const [nSem, setNSem] = useLembrar('rom.n', '3')

  const ultimo = doCli.reduce((m, v) => (v.prazo! > m ? v.prazo! : m), hoje)
  const nFaixa = Math.max(6, Math.min(12, Math.ceil((U.d(ultimo)!.getTime() - U.d(seg0)!.getTime()) / 864e5 / 7) + 1))
  const semanas = montarSemanas(doCli, hoje, nFaixa, cheio)
  const seg = segEsc < seg0 ? seg0 : segEsc
  const semSel = semanas.find(s => s.seg === seg) || semanas[0]
  const p: Periodo = modo === 'livre'
    ? { de: de || seg0, ate: ate && ate >= (de || seg0) ? ate : (de || seg0), atr: atrLivre, cheio }
    : semSel.p
  const maxPecas = Math.max(1, ...semanas.map(s => s.pecas))
  const escolher = (s: Semana) => { setModo('semana'); setSeg(s.seg) }
  const atual = modo === 'semana' && semSel.i === 0
  const titulo = modo === 'semana'
    ? `Entrega ${semSel.rotulo} · semana de ${U.data(p.de)} a ${U.data(p.ate)}${p.atr ? ', com os atrasados somados' : ' — só os pedidos desta semana'}`
    : `De ${U.data(p.de)} até ${U.data(p.ate)}${p.atr ? `, com o que ficou em aberto antes de ${ddmm(p.de)}` : ''}`

  // várias semanas de uma vez (como a planilha do PCP: a geral + uma aba por semana)
  const n = Math.min(Number(nSem) || 3, semanas.length), lote = semanas.slice(0, n)
  const doLote = () => lote.map(s => { const r = lerRascunho(cli, s.p, s.i === 0); return { s, r, vao: vaoDe(r, s.linhas) } })
  const nomeLote = `Romaneio ${nomeCli.split(' ')[0] || ''} ${n} semanas ${lote[0]?.rotulo.replace('/', '-')} a ${lote[n - 1]?.rotulo.replace('/', '-')}`.replace(/\s+/g, ' ').trim()
  const excelLote = async () => {
    const X = await xlsx(), wb = X.utils.book_new(), usados = new Set<string>()
    const nomeAba = (t: string) => { let x = t.replace(/[\\/?*[\]:]/g, '-').slice(0, 28), k = 2; while (usados.has(x)) x = t.slice(0, 26) + ' ' + k++; usados.add(x); return x }
    // a geral: tudo o que está em aberto do cliente, linha a linha (como a aba com a data de hoje)
    const ger = U.ordenar(doCli.filter(v => C.saldoVenda(v) > 0 || (cheio && v.prazo! >= seg0)), v => (v.codigo || '') + v.prazo + (v.pedido || ''))
    const wsG = X.utils.aoa_to_sheet([[`Programação ${nomeCli} — geral em ${U.data(hoje)}`], [],
      ['Pedido', 'Código JAF', 'Cód. Cliente', 'Descrição', 'Quantidade', 'Un', 'Data entrega', 'Situação'],
      ...ger.map(v => [v.pedido || '', v.codigo || '', v.codigo_cliente || '', v.descricao || '', cheio && v.prazo! >= seg0 ? Number(v.qtd) : Math.max(0, C.saldoVenda(v)), 'PC', U.data(v.prazo), C.situacaoVenda(v).txt])])
    wsG['!cols'] = [{ wch: 13 }, { wch: 13 }, { wch: 15 }, { wch: 28 }, { wch: 11 }, { wch: 5 }, { wch: 12 }, { wch: 12 }]
    X.utils.book_append_sheet(wb, wsG, nomeAba('Geral ' + ddmm(hoje).replace('/', '-')))
    for (const { s, r, vao } of doLote()) {
      const ws = X.utils.aoa_to_sheet([[`Previsão da entrega ${U.data(s.dia)}${s.p.atr ? ' (com os atrasados somados)' : ' — só os pedidos desta semana'}`],
        [`${nomeCli} · semana de ${U.data(s.p.de)} a ${U.data(s.p.ate)}`],
        ['Pedido', 'Código JAF', 'Cód. Cliente', 'Descrição', 'Quantidade', 'Un', 'Data entrega', 'RI', 'OF', 'Embalagem'],
        ...vao.map(l => [l.pedido, l.codigo, l.codigo_cliente, l.descricao, qtdDe(r, l), 'PC', U.data(l.prazo), riDe(r, l), ofDe(r, l), r.linhas[l.k]?.emb || '']),
        ['Total', U.plural(vao.length, 'item', 'itens'), '', '', U.soma(vao, l => qtdDe(r, l))]])
      ws['!cols'] = [{ wch: 13 }, { wch: 13 }, { wch: 15 }, { wch: 28 }, { wch: 11 }, { wch: 5 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 12 }]
      X.utils.book_append_sheet(wb, ws, nomeAba(s.rotulo.replace('/', '-')))
    }
    await entregar(new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: TIPO_XLSX }), nomeLote + '.xlsx')
  }
  const pdfLote = async () => {
    const l = doLote()
    await entregar(await pdfDocumento('Romaneio para Faturamento', `${nomeCli} · próximas ${n} semanas`, (c) => {
      c.tabela({ ...c.estilo, startY: c.y + 2, head: [['Entrega', 'Semana', 'Itens', 'Peças', 'Atrasados somados']],
        body: l.map(({ s, r, vao }) => [s.rotulo, `${ddmm(s.p.de)} a ${ddmm(s.p.ate)}`, String(vao.length), U.qtd(U.soma(vao, x => qtdDe(r, x))), s.p.atr ? U.qtd(U.soma(vao, x => Math.min(x.atraso, qtdDe(r, x)))) : '—']),
        columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } } })
      for (const { s, r, vao } of l) {
        c.doc.addPage()
        let y = c.texto(`Entrega ${U.data(s.dia)} — ${nomeCli}`, 18, { tam: 14, negrito: true })
        y = c.texto(`Semana de ${U.data(s.p.de)} a ${U.data(s.p.ate)}${s.p.atr ? ' · com os atrasados somados' : ' · só os pedidos desta semana'}`, y, { tam: 9, cor: 90 })
        c.tabela({ ...c.estilo, startY: y + 2, head: [['Código JAF', 'Cód. Cliente', 'Pedido', 'RI', 'OF', 'Quantidade', 'Embalagem']],
          body: vao.length ? vao.map(x => [x.codigo, x.codigo_cliente, x.pedido, riDe(r, x), ofDe(r, x), U.qtd(qtdDe(r, x)), r.linhas[x.k]?.emb || '']) : [['Nada para entregar nesta semana', '', '', '', '', '', '']],
          foot: [['Total', U.plural(vao.length, 'item', 'itens'), '', '', '', U.qtd(U.soma(vao, x => qtdDe(r, x))), '']],
          footStyles: { fillColor: [235, 239, 245], textColor: 20, fontStyle: 'bold' },
          columnStyles: { 0: { cellWidth: 28, font: 'courier' }, 1: { cellWidth: 30, font: 'courier' }, 2: { cellWidth: 28 }, 3: { cellWidth: 16 }, 4: { cellWidth: 16 }, 5: { cellWidth: 24, halign: 'right' } } })
        let yy = (c.doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
        if (yy > c.H - 50) { c.doc.addPage(); yy = 24 }
        const peso = Number(r.peso.replace(',', '.')) || 0
        yy = c.texto(`Peso total da carga: ${peso ? U.qtd(peso) + ' kg' : '________________ kg'}`, yy, { tam: 11, negrito: true })
        c.assinatura(r.resp || 'Responsável', 'Responsável', 14, yy + 20, 90)
        c.assinatura('____/____/________', 'Data', c.W - 14 - 60, yy + 20, 60)
      }
    }), nomeLote + '.pdf')
  }

  return <div id="romaneio">
    <div className="barra-filtros rom-filtros mt">
      <select value={cli} onChange={(e) => setCli(e.target.value)} aria-label="Cliente" data-rom-cli="1" disabled={!clientes.length}>
        {clientes.map(c => <option key={c.k} value={c.k}>{c.nome} ({c.n})</option>)}</select>
      <label className="rom-ck" title="Desmarcado: só o que falta entregar. Marcado: a quantidade do pedido, mesmo que uma parte já tenha saído.">
        <input type="checkbox" checked={cheio} onChange={(e) => setCheio(e.target.checked)} data-rom-cheio="1" /> Quantidade cheia do pedido (não descontar o que já saiu)</label>
    </div>
    {/* a faixa das semanas: toque numa semana para fazer o romaneio dela */}
    <div className="rom-semanas" role="tablist" aria-label="Semanas de entrega">
      {semanas.map(s => { const on = modo === 'semana' && s.seg === semSel.seg
        return <button key={s.seg} type="button" role="tab" aria-selected={on} className={'rom-sem' + (on ? ' on' : '') + (!s.linhas.length ? ' vazia' : '')}
          data-rom-sem={s.seg} {...(s.i === 0 ? { 'data-rom-semana': '1' } : {})} {...(s.i === 1 ? { 'data-rom-prox': '1' } : {})} onClick={() => escolher(s)}>
          <small>{quando(s.i)}</small>
          <b>{s.rotulo}</b>
          <span>{s.linhas.length ? <>{U.plural(s.linhas.length, 'item', 'itens')} · {U.qtd(s.pecas)} pç</> : 'nada programado'}</span>
          {s.i === 0 && s.atraso > 0 && <em>+ {U.qtd(s.atraso)} atrasadas</em>}
          <i className="rom-carga" style={{ width: Math.round(100 * s.pecas / maxPecas) + '%' }} />
        </button> })}
      <button type="button" role="tab" aria-selected={modo === 'livre'} className={'rom-sem livre' + (modo === 'livre' ? ' on' : '')} data-rom-livre="1" onClick={() => setModo('livre')}>
        <small>Outro período</small><b>De… até…</b><span>escolha as datas</span></button>
    </div>
    {modo === 'livre' && <div className="barra-filtros rom-periodo">
      <span className="rom-ate"><label className="sub" htmlFor="romDe">De</label><input id="romDe" type="date" value={p.de} onChange={(e) => setDe(e.target.value || seg0)} data-rom-de="1" /></span>
      <span className="rom-ate"><label className="sub" htmlFor="romAte">até</label><input id="romAte" type="date" value={p.ate} onChange={(e) => setAte(e.target.value || fimDaSemana(hoje))} data-rom-ate="1" /></span>
      <label className="rom-ck"><input type="checkbox" checked={atrLivre} onChange={(e) => setAtrLivre(e.target.checked)} data-rom-atr="1" /> Somar o que ficou em aberto antes de {U.data(p.de)}</label>
    </div>}
    <p className="sub rom-titulo" data-rom-titulo="1">{titulo}</p>
    <RomaneioCliente key={chaveLocal(cli, p) + (p.atr ? '+' : '') + (p.cheio ? 'c' : '')} cli={cli} nomeCli={nomeCli} p={p} atual={atual} sub={titulo}
      linhas={linhasRomaneio(vendasDoPeriodo(doCli, p), hoje, v => qtdItem(v, p))} />
    {semanas.some(s => s.linhas.length) && <section className="card mt rom-lote">
      <div className="card-cab"><h2>Várias semanas de uma vez</h2><span className="sub">como a planilha do PCP: a geral + uma aba por semana</span></div>
      <p className="sub">A 1ª semana leva os atrasados; as outras, só os pedidos de cada semana. O que você digitou em cada semana (RI, OF, quantidade, peso) vai junto.</p>
      <div className="acoes">
        <select value={String(n)} onChange={(e) => setNSem(e.target.value)} aria-label="Quantas semanas" data-rom-n="1">
          {[2, 3, 4, 6, 8].filter(x => x <= semanas.length).map(x => <option key={x} value={x}>{x} semanas ({semanas[0].rotulo} a {semanas[x - 1].rotulo})</option>)}</select>
        <Btn txt={`Excel das ${n} semanas`} icone="planilha" cls="pri" data-rom-lote="excel" onClick={excelLote} />
        <Btn txt="PDF" icone="imprimir" cls="sec" data-rom-lote="pdf" onClick={pdfLote} />
      </div>
    </section>}
  </div>
}

// o romaneio de um cliente num período (o que foi digitado fica guardado por cliente e período)
function RomaneioCliente({ cli, nomeCli, p, atual, sub, linhas }: { cli: string; nomeCli: string; p: Periodo; atual: boolean; sub: string; linhas: LinhaRom[] }) {
  const hoje = U.hoje()
  const [rasc, setRasc] = useLembrar<Rascunho>('rom.rasc.' + chaveLocal(cli, p), lerRascunho(cli, p, atual))
  useEffect(() => { U.gravarLocal(chaveLocal(cli, p), rasc) }, [cli, p.de, p.ate, rasc])  // eslint-disable-line react-hooks/exhaustive-deps
  const ed = (k: string): Edicao => rasc.linhas[k] || {}
  const mudar = (k: string, c: Partial<Edicao>) => setRasc(r => ({ ...r, linhas: { ...r.linhas, [k]: { ...r.linhas[k], ...c } } }))
  const vao = vaoDe(rasc, linhas)
  const q = (l: LinhaRom) => qtdDe(rasc, l)
  const pecas = U.soma(vao, q), atrasoT = U.soma(vao, l => Math.min(l.atraso, q(l)))
  const peso = Number(rasc.peso.replace(',', '.')) || 0
  const nomeArq = `Romaneio ${nomeCli.split(' ')[0] || ''} ${p.de === segunda(p.de) && p.ate === U.somaDias(p.de, 6) ? 'semana ' + ddmm(p.de).replace('/', '-') : (rasc.data || hoje)}`.trim()
  const cab = ['Código JAF', 'Cód. Cliente', 'Pedido', 'RI', 'OF', 'Quantidade', 'Embalagem']
  const corpo = () => vao.map(l => [l.codigo, l.codigo_cliente, l.pedido, riDe(rasc, l), ofDe(rasc, l), U.qtd(q(l)), ed(l.k).emb || ''])

  const pdf = async () => {
    await entregar(await pdfDocumento('Romaneio para Faturamento', `${nomeCli} · ${sub}`, (c) => {
      c.tabela({ ...c.estilo, startY: c.y + 2, head: [cab], body: corpo(), foot: [['Total', U.plural(vao.length, 'item', 'itens'), '', '', '', U.qtd(pecas), '']],
        footStyles: { fillColor: [235, 239, 245], textColor: 20, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 28, font: 'courier' }, 1: { cellWidth: 30, font: 'courier' }, 2: { cellWidth: 28 }, 3: { cellWidth: 16 }, 4: { cellWidth: 16 }, 5: { cellWidth: 24, halign: 'right' } } })
      let y = (c.doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
      if (y > c.H - 60) { c.doc.addPage(); y = 24 }
      y = c.texto(`Peso total da carga: ${peso ? U.qtd(peso) + ' kg' : '________________ kg'}`, y, { tam: 11, negrito: true })
      if (atrasoT) y = c.texto(`Inclui ${U.qtd(atrasoT)} peça(s) de entregas em atraso.`, y + 1, { tam: 9, cor: 90 })
      if (rasc.obs.trim()) y = c.texto('Observação: ' + rasc.obs.trim(), y + 2, { tam: 10 })
      c.assinatura(rasc.resp || 'Responsável', 'Responsável', 14, y + 22, 90)
      c.assinatura(U.data(rasc.data || hoje), 'Data', c.W - 14 - 60, y + 22, 60)
    }), nomeArq + '.pdf')
  }
  // Excel no mesmo desenho da planilha do PCP (título, cliente, cabeçalho, linhas, responsável e data) + aba com o detalhe
  const planilha = async () => {
    const X = await xlsx(), wb = X.utils.book_new()
    const aoa: (string | number)[][] = [['Romaneio para Faturamento'], ['', '', '', '', '', nomeCli], cab,
      ...vao.map(l => [l.codigo, l.codigo_cliente, l.pedido, riDe(rasc, l), ofDe(rasc, l), q(l), ed(l.k).emb || '']),
      ['Total', '', '', '', '', pecas, ''], [], ['Peso total da carga (kg)', '', '', '', '', peso || ''], ['Observação', rasc.obs], [], ['Responsável', rasc.resp, '', '', 'Data', U.data(rasc.data || hoje)], [], ['Período', sub]]
    const ws = X.utils.aoa_to_sheet(aoa)
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }, { s: { r: 1, c: 5 }, e: { r: 1, c: 6 } }]
    ws['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 14 }]
    X.utils.book_append_sheet(wb, ws, (nomeCli.split(' ')[0] || 'Romaneio').replace(/[\\/?*[\]:]/g, '-').slice(0, 28))
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Código JAF', 'Cód. Cliente', 'Descrição', 'Pedido', 'Data de entrega', 'Quantidade', 'Situação'],
      ...vao.flatMap(l => l.itens.map(v => [v.codigo || '', v.codigo_cliente || '', v.descricao || '', v.pedido || '', U.data(v.prazo), qtdItem(v, p), C.situacaoVenda(v).txt]))]), 'Detalhe')
    await entregar(new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: TIPO_XLSX }), nomeArq + '.xlsx')
  }
  const limpar = () => setRasc(rascunhoVazio())

  return <>
    {!linhas.length ? <div className="mt"><Vazio icone="calendario" titulo="Nada para entregar neste período" texto="Toque em outra semana na faixa acima, escolha outro período ou outro cliente." /></div> : <>
      <div className="grade g4 mt">
        <div className="kpi"><small>Itens no romaneio</small><b data-rom-itens="1">{vao.length}</b><span>de {linhas.length} no período</span></div>
        <div className="kpi"><small>Peças</small><b data-rom-pecas="1">{U.qtd(pecas)}</b><span>quantidade total</span></div>
        <div className="kpi"><small>Atrasados somados</small><b style={{ color: atrasoT ? 'var(--vermelho)' : undefined }} data-rom-atraso="1">{U.qtd(atrasoT)}</b><span>{p.atr ? 'peças de antes de hoje' : 'não entram neste período'}</span></div>
        <div className="kpi"><small>Peso da carga</small><b>{peso ? U.qtd(peso) + ' kg' : '—'}</b><span>{peso ? 'preenchido' : 'preencha embaixo'}</span></div>
      </div>
      <section className="card mt"><div className="card-cab"><h2>Romaneio para Faturamento · {nomeCli}</h2><span className="sub">{U.plural(vao.length, 'item', 'itens')} · {U.qtd(pecas)} pç</span></div>
        <div className="rolagem-x"><table className="tabela-fab tabela-rom"><thead><tr><th aria-label="Entra no romaneio" /><th>Código JAF</th><th className="so-largo">Cód. cliente</th><th>Pedido</th>
          <th className="so-largo">RI</th><th className="so-largo">OF</th><th className="n">Quantidade</th><th className="so-largo">Embalagem</th></tr></thead>
          <tbody>{linhas.map(l => { const e = ed(l.k), qq = q(l), fora = !!e.fora || qq <= 0
            return <Fragment key={l.k}><tr className={fora ? 'rom-fora' : ''} data-rom-linha={l.k}>
              <td><input type="checkbox" checked={!e.fora} onChange={(ev) => mudar(l.k, { fora: !ev.target.checked })} aria-label={'Incluir ' + (l.codigo || l.codigo_cliente)} data-rom-ck={l.k} /></td>
              <td><span className="mono">{l.codigo || '—'}</span><small className="col-sub">{l.descricao}{l.prazo < p.de ? '' : ' · ' + ddmm(l.prazo)}</small>
                {l.atraso > 0 && <span className="rom-atraso"><Tag s={{ txt: `${U.qtd(l.atraso)} em atraso`, cor: 'vermelho' }} /></span>}
</td>
              <td className="so-largo mono">{l.codigo_cliente}</td><td className="rom-ped">{l.pedido || '—'}</td>
              <td className="so-largo"><input className="rom-in" aria-label="RI" value={riDe(rasc, l)} onChange={(ev) => mudar(l.k, { ri: ev.target.value })} data-rom-ri={l.k} /></td>
              <td className="so-largo"><input className="rom-in" aria-label="OF" value={ofDe(rasc, l)} onChange={(ev) => mudar(l.k, { of: ev.target.value })} data-rom-of={l.k} title={l.ofSug ? 'Sugerida pelo sistema: OF ligada ao pedido ou a última OF encerrada da peça' : ''} /></td>
              <td className="n"><input className="rom-in rom-qtd" inputMode="decimal" aria-label="Quantidade" value={qtdTxt(rasc, l) ?? String(l.saldo)} onChange={(ev) => mudar(l.k, { qtd: ev.target.value, base: l.saldo })} data-rom-qtd={l.k} />
                {qq > l.saldo && <small className="col-sub" style={{ color: 'var(--laranja, #c60)' }}>acima do {p.cheio ? 'pedido' : 'saldo'} ({U.qtd(l.saldo)})</small>}</td>
              <td className="so-largo"><input className="rom-in" aria-label="Embalagem" value={e.emb || ''} onChange={(ev) => mudar(l.k, { emb: ev.target.value })} data-rom-emb={l.k} /></td>
            </tr>
            {/* no celular: RI, OF e embalagem numa linha embaixo, com nome em cada campo */}
            <tr className={'rom-extra' + (fora ? ' rom-fora' : '')}><td /><td colSpan={3}><div className="rom-extra-campos">
              <label><small>RI</small><input value={riDe(rasc, l)} onChange={(ev) => mudar(l.k, { ri: ev.target.value })} /></label>
              <label><small>OF</small><input value={ofDe(rasc, l)} onChange={(ev) => mudar(l.k, { of: ev.target.value })} /></label>
              <label><small>Embalagem</small><input value={e.emb || ''} onChange={(ev) => mudar(l.k, { emb: ev.target.value })} /></label></div></td></tr></Fragment> })}</tbody></table></div></section>
      <section className="card mt"><div className="card-cab"><h2>Carga</h2></div>
        <div className="linha-campos">
          <div className="campo"><label htmlFor="romPeso">Peso total da carga (kg)</label><input id="romPeso" inputMode="decimal" value={rasc.peso} placeholder="Ex.: 1250" onChange={(e) => setRasc(r => ({ ...r, peso: e.target.value }))} data-rom-peso="1" /></div>
          <div className="campo"><label htmlFor="romResp">Responsável</label><input id="romResp" value={rasc.resp} onChange={(e) => setRasc(r => ({ ...r, resp: e.target.value }))} data-rom-resp="1" /></div>
          <div className="campo"><label htmlFor="romData">Data</label><input id="romData" type="date" value={rasc.data} onChange={(e) => setRasc(r => ({ ...r, data: e.target.value }))} data-rom-data="1" /></div>
        </div>
        <div className="campo"><label htmlFor="romObs">Observação (opcional)</label><input id="romObs" value={rasc.obs} onChange={(e) => setRasc(r => ({ ...r, obs: e.target.value }))} data-rom-obs="1" /></div>
        <div className="acoes">
          <Btn txt="Romaneio em PDF" icone="imprimir" cls="pri" data-rom="pdf" disabled={!vao.length} onClick={pdf} />
          <Btn txt="Excel" icone="planilha" cls="sec" data-rom="excel" disabled={!vao.length} onClick={planilha} />
          <button type="button" className="btn fantasma" data-rom="limpar" onClick={limpar}>Limpar o que digitei</button>
        </div>
      </section>
    </>}
  </>
}
