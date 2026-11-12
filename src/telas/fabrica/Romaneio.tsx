/* Romaneio para faturamento: sai sozinho do que tem para entregar (atrasados + entregas até a data escolhida),
 * uma linha por peça e pedido, no mesmo modelo do formulário do PCP (Código JAF, Cód. cliente, Pedido, RI, OF,
 * Quantidade, Embalagem), com o peso total da carga, responsável e data. Sai em PDF e em Excel.
 * O que a pessoa digita (RI, OF, quantidade, embalagem, peso) fica guardado neste aparelho até limpar. */
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

// base = saldo da linha quando a quantidade foi digitada: se o saldo mudar (entregou, programação nova), volta a sugerir o saldo
interface Edicao { qtd?: string; base?: number; ri?: string; of?: string; emb?: string; fora?: boolean }
interface Rascunho { linhas: Record<string, Edicao>; peso: string; resp: string; data: string; obs: string }
export interface LinhaRom {
  k: string; codigo: string; codigo_cliente: string; descricao: string; pedido: string; saldo: number; atraso: number; prazo: string
  itens: Venda[]; ofSug: OF | null
}

const rascunhoVazio = (): Rascunho => ({ linhas: {}, peso: '', resp: API.sessao?.nome || '', data: U.hoje(), obs: '' })
const chaveLocal = (cli: string) => 'jaf.romaneio.' + (cli || '-')

// junta o que tem para entregar por peça + pedido (quantidade = saldo dos atrasados + das entregas até a data)
export function linhasRomaneio(abertos: Venda[], hoje: string): LinhaRom[] {
  const m = new Map<string, LinhaRom>()
  for (const v of abertos) {
    const cod = v.codigo || v.codigo_cliente || v.descricao || '?', k = cod + '|' + (v.pedido || '')
    const l = m.get(k) || { k, codigo: v.codigo || '', codigo_cliente: v.codigo_cliente || '', descricao: v.descricao || '', pedido: v.pedido || '', saldo: 0, atraso: 0, prazo: v.prazo!, itens: [], ofSug: null }
    const s = Math.max(0, C.saldoVenda(v))
    l.saldo = U.r4(l.saldo + s); if (v.prazo! < hoje) l.atraso = U.r4(l.atraso + s)
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

export function Romaneio({ todas }: { todas: Venda[] }) {
  const hoje = U.hoje()
  const [ate, setAte] = useLembrar('rom.ate', fimDaSemana(hoje))
  const abertosAte = todas.filter(v => C.saldoVenda(v) > 0 && v.prazo! <= (ate || fimDaSemana(hoje)))
  const clientes = U.ordenar([...U.agrupar(abertosAte, v => v.cliente_id || v.cliente_nome || '').entries()].map(([k, l]) => ({ k, nome: l[0].cliente_nome || '—', n: l.length })), c => -c.n)
  const [cliEsc, setCli] = useLembrar('rom.cli', '')
  const cli = clientes.some(c => c.k === cliEsc) ? cliEsc : clientes[0]?.k || ''
  const nomeCli = clientes.find(c => c.k === cli)?.nome || ''
  return <div id="romaneio">
    <div className="barra-filtros rom-filtros mt">
      <select value={cli} onChange={(e) => setCli(e.target.value)} aria-label="Cliente" data-rom-cli="1" disabled={!clientes.length}>
        {clientes.map(c => <option key={c.k} value={c.k}>{c.nome} ({c.n})</option>)}</select>
      <span className="rom-ate"><label className="sub" htmlFor="romAte">Entregas até</label>
        <input id="romAte" type="date" value={ate} onChange={(e) => setAte(e.target.value || fimDaSemana(hoje))} /></span>
      <span className="rom-atalhos"><button type="button" className="btn fantasma mini" data-rom-semana="1" onClick={() => setAte(fimDaSemana(hoje))}>Esta semana</button>
      <button type="button" className="btn fantasma mini" data-rom-prox="1" onClick={() => setAte(U.somaDias(fimDaSemana(hoje), 7))}>Até a próxima</button></span>
    </div>
    <p className="sub">Os itens em atraso entram somados com as entregas até a data. Confira a quantidade, preencha o que faltar e gere o romaneio.</p>
    <RomaneioCliente key={cli} cli={cli} nomeCli={nomeCli} ate={ate} abertos={abertosAte.filter(v => (v.cliente_id || v.cliente_nome || '') === cli)} />
  </div>
}

// o romaneio de um cliente (o que foi digitado fica guardado por cliente)
function RomaneioCliente({ cli, nomeCli, ate, abertos }: { cli: string; nomeCli: string; ate: string; abertos: Venda[] }) {
  const hoje = U.hoje()
  const [rasc, setRasc] = useLembrar<Rascunho>('rom.rasc.' + cli, U.lerLocal(chaveLocal(cli), rascunhoVazio()))
  useEffect(() => { U.gravarLocal(chaveLocal(cli), rasc) }, [cli, rasc])
  const linhas = linhasRomaneio(abertos, hoje)
  const ed = (k: string): Edicao => rasc.linhas[k] || {}
  const mudar = (k: string, c: Partial<Edicao>) => setRasc(r => ({ ...r, linhas: { ...r.linhas, [k]: { ...r.linhas[k], ...c } } }))
  const qtdTxt = (l: LinhaRom): string | undefined => { const e = ed(l.k); return e.qtd !== undefined && e.base === l.saldo ? e.qtd : undefined }
  const qtdDe = (l: LinhaRom): number => { const t = qtdTxt(l); return t === undefined || t === '' ? l.saldo : Math.max(0, Number(t.replace(',', '.')) || 0) }
  const ofDe = (l: LinhaRom) => ed(l.k).of ?? (l.ofSug ? String(l.ofSug.numero) : '')
  const riDe = (l: LinhaRom) => ed(l.k).ri ?? (l.ofSug?.ri ? String(l.ofSug.ri) : '')
  const vao = linhas.filter(l => !ed(l.k).fora && qtdDe(l) > 0)
  const pecas = U.soma(vao, qtdDe), atrasoT = U.soma(vao, l => Math.min(l.atraso, qtdDe(l)))
  const peso = Number(rasc.peso.replace(',', '.')) || 0
  const sub = `${nomeCli} · entregas até ${U.data(ate)}, com os atrasados`
  const nomeArq = `Romaneio ${nomeCli.split(' ')[0] || ''} ${rasc.data || hoje}`.trim()
  const cab = ['Código JAF', 'Cód. Cliente', 'Pedido', 'RI', 'OF', 'Quantidade', 'Embalagem']
  const corpo = () => vao.map(l => [l.codigo, l.codigo_cliente, l.pedido, riDe(l), ofDe(l), U.qtd(qtdDe(l)), ed(l.k).emb || ''])

  const pdf = async () => {
    await entregar(await pdfDocumento('Romaneio para Faturamento', sub, (c) => {
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
      ...vao.map(l => [l.codigo, l.codigo_cliente, l.pedido, riDe(l), ofDe(l), qtdDe(l), ed(l.k).emb || '']),
      ['Total', '', '', '', '', pecas, ''], [], ['Peso total da carga (kg)', '', '', '', '', peso || ''], ['Observação', rasc.obs], [], ['Responsável', rasc.resp, '', '', 'Data', U.data(rasc.data || hoje)]]
    const ws = X.utils.aoa_to_sheet(aoa)
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }, { s: { r: 1, c: 5 }, e: { r: 1, c: 6 } }]
    ws['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 14 }]
    X.utils.book_append_sheet(wb, ws, (nomeCli.split(' ')[0] || 'Romaneio').replace(/[\\/?*[\]:]/g, '-').slice(0, 28))
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Código JAF', 'Cód. Cliente', 'Descrição', 'Pedido', 'Data de entrega', 'Saldo', 'Situação'],
      ...vao.flatMap(l => l.itens.map(v => [v.codigo || '', v.codigo_cliente || '', v.descricao || '', v.pedido || '', U.data(v.prazo), Math.max(0, C.saldoVenda(v)), C.situacaoVenda(v).txt]))]), 'Detalhe')
    await entregar(new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: TIPO_XLSX }), nomeArq + '.xlsx')
  }
  const limpar = () => setRasc(rascunhoVazio())

  return <>
    {!linhas.length ? <div className="mt"><Vazio icone="calendario" titulo="Nada para entregar até esta data" texto="Escolha uma data mais para frente ou outro cliente." /></div> : <>
      <div className="grade g4 mt">
        <div className="kpi"><small>Itens no romaneio</small><b data-rom-itens="1">{vao.length}</b><span>de {linhas.length} em aberto</span></div>
        <div className="kpi"><small>Peças</small><b data-rom-pecas="1">{U.qtd(pecas)}</b><span>quantidade total</span></div>
        <div className="kpi"><small>Atrasados somados</small><b style={{ color: atrasoT ? 'var(--vermelho)' : undefined }} data-rom-atraso="1">{U.qtd(atrasoT)}</b><span>peças de antes de hoje</span></div>
        <div className="kpi"><small>Peso da carga</small><b>{peso ? U.qtd(peso) + ' kg' : '—'}</b><span>{peso ? 'preenchido' : 'preencha embaixo'}</span></div>
      </div>
      <section className="card mt"><div className="card-cab"><h2>Romaneio para Faturamento · {nomeCli}</h2><span className="sub">{U.plural(vao.length, 'item', 'itens')} · {U.qtd(pecas)} pç</span></div>
        <div className="rolagem-x"><table className="tabela-fab tabela-rom"><thead><tr><th aria-label="Entra no romaneio" /><th>Código JAF</th><th className="so-largo">Cód. cliente</th><th>Pedido</th>
          <th className="so-largo">RI</th><th className="so-largo">OF</th><th className="n">Quantidade</th><th className="so-largo">Embalagem</th></tr></thead>
          <tbody>{linhas.map(l => { const e = ed(l.k), q = qtdDe(l), fora = !!e.fora || q <= 0
            return <Fragment key={l.k}><tr className={fora ? 'rom-fora' : ''} data-rom-linha={l.k}>
              <td><input type="checkbox" checked={!e.fora} onChange={(ev) => mudar(l.k, { fora: !ev.target.checked })} aria-label={'Incluir ' + (l.codigo || l.codigo_cliente)} data-rom-ck={l.k} /></td>
              <td><span className="mono">{l.codigo || '—'}</span><small className="col-sub">{l.descricao}</small>
                {l.atraso > 0 && <span className="rom-atraso"><Tag s={{ txt: `${U.qtd(l.atraso)} em atraso`, cor: 'vermelho' }} /></span>}
</td>
              <td className="so-largo mono">{l.codigo_cliente}</td><td className="rom-ped">{l.pedido || '—'}</td>
              <td className="so-largo"><input className="rom-in" aria-label="RI" value={riDe(l)} onChange={(ev) => mudar(l.k, { ri: ev.target.value })} data-rom-ri={l.k} /></td>
              <td className="so-largo"><input className="rom-in" aria-label="OF" value={ofDe(l)} onChange={(ev) => mudar(l.k, { of: ev.target.value })} data-rom-of={l.k} title={l.ofSug ? 'Sugerida pelo sistema: OF ligada ao pedido ou a última OF encerrada da peça' : ''} /></td>
              <td className="n"><input className="rom-in rom-qtd" inputMode="decimal" aria-label="Quantidade" value={qtdTxt(l) ?? String(l.saldo)} onChange={(ev) => mudar(l.k, { qtd: ev.target.value, base: l.saldo })} data-rom-qtd={l.k} />
                {q > l.saldo && <small className="col-sub" style={{ color: 'var(--laranja, #c60)' }}>acima do saldo ({U.qtd(l.saldo)})</small>}</td>
              <td className="so-largo"><input className="rom-in" aria-label="Embalagem" value={e.emb || ''} onChange={(ev) => mudar(l.k, { emb: ev.target.value })} data-rom-emb={l.k} /></td>
            </tr>
            {/* no celular: RI, OF e embalagem numa linha embaixo, com nome em cada campo */}
            <tr className={'rom-extra' + (fora ? ' rom-fora' : '')}><td /><td colSpan={3}><div className="rom-extra-campos">
              <label><small>RI</small><input value={riDe(l)} onChange={(ev) => mudar(l.k, { ri: ev.target.value })} /></label>
              <label><small>OF</small><input value={ofDe(l)} onChange={(ev) => mudar(l.k, { of: ev.target.value })} /></label>
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
