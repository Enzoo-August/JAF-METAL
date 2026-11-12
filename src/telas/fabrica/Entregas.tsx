/* Relatório de entregas: o que tem para entregar (ou foi entregue) por data, semana, peça ou cliente,
 * com o mesmo jeito da planilha do PCP (uma aba por dia de entrega no Excel) e PDF para imprimir.
 * Embaixo: as notas fiscais emitidas que baixaram entregas (com desfazer). */
import { C, S } from '../../lib/dados.ts'
import { Perm } from '../../lib/perm.ts'
import type { Venda } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { entregar, pdfTabela, xlsx, TIPO_XLSX } from '../../ui/arquivos.tsx'
import { BuscaLista, Btn, Cab, Chips, Tag, Vazio } from '../../ui/base.tsx'
import { useLembrar, type Rota } from '../../ui/ganchos.ts'
import { ComTabelas } from './comum.tsx'
import { baixarPelaNota, desfazerNota } from './Documentos.tsx'
import { detalhe } from './Pedidos.tsx'

const TABS = ['produtos', 'vendas', 'vendas_entregas', 'notas_saida', 'produto_saldos', 'ofs', 'produto_estrutura'] as const

export function TelaEntregas({ r }: { r: Rota }) {
  return <ComTabelas tabs={[...TABS]}>{() => <Relatorio r={r} />}</ComTabelas>
}

// segunda-feira da semana de uma data
const segunda = (iso: string): string => { const d = U.d(iso)!; const dw = (d.getDay() + 6) % 7; return U.somaDias(iso, -dw) }
const ddmm = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7)

function periodo(p: string, de: string, ate: string): [string, string] | null {
  const h = U.hoje(), s = segunda(h)
  if (p === 'semana') return [s, U.somaDias(s, 6)]
  if (p === 'prox') return [U.somaDias(s, 7), U.somaDias(s, 13)]
  if (p === 'mes') return [h.slice(0, 8) + '01', U.somaDias(U.somaMeses(h.slice(0, 8) + '01', 1), -1)]
  if (p === '30') return [h, U.somaDias(h, 30)]
  if (p === 'atraso') return ['2000-01-01', U.somaDias(h, -1)]
  if (p === 'livre') return de || ate ? [de || '2000-01-01', ate || '2100-12-31'] : null
  return null
}

function Relatorio({ r }: { r: Rota }) {
  const [per, setPer] = useLembrar('ent.per', r.q.get('p') || 'semana')
  const [de, setDe] = useLembrar('ent.de', '')
  const [ate, setAte] = useLembrar('ent.ate', '')
  const [cli, setCli] = useLembrar('ent.cli', '')
  const [sit, setSit] = useLembrar('ent.sit', 'aberto')
  const [grupo, setGrupo] = useLembrar('ent.grupo', 'dia')
  const [busca, setBusca] = useLembrar('ent.busca', '')
  const faixa = periodo(per, de, ate)
  const todas = S.lista('vendas').filter(v => !v.cancelado && v.prazo)
  let l = todas.filter(v => !faixa || (v.prazo! >= faixa[0] && v.prazo! <= faixa[1]))
  if (cli) l = l.filter(v => (v.cliente_id || v.cliente_nome) === cli)
  if (sit === 'aberto' || per === 'atraso') l = l.filter(v => C.saldoVenda(v) > 0)
  else if (sit === 'entregue') l = l.filter(v => C.saldoVenda(v) <= 0)
  if (busca.trim()) l = U.buscar(l, busca, v => [v.codigo || '', v.codigo_cliente || '', v.descricao || '', v.pedido || ''])
  l = U.ordenar(l, v => v.prazo! + (v.cliente_nome || '') + (v.codigo || ''))
  const clientes = U.ordenar([...new Map(todas.map(v => [v.cliente_id || v.cliente_nome || '', v.cliente_nome || '—'])).entries()], x => U.sem(x[1]))
  const chave = (v: Venda): [string, string] => {
    if (grupo === 'semana') { const s = segunda(v.prazo!); return [s, `Semana de ${U.dataCurta(s)} a ${U.dataCurta(U.somaDias(s, 6))}`] }
    if (grupo === 'produto') return [v.codigo || v.codigo_cliente || v.descricao || '?', `${v.codigo || v.codigo_cliente || ''} — ${v.descricao || ''}`]
    if (grupo === 'cliente') return [U.sem(v.cliente_nome || ''), v.cliente_nome || '—']
    return [v.prazo!, `${U.data(v.prazo)} (${U.d(v.prazo!)!.toLocaleDateString('pt-BR', { weekday: 'long' })})`]
  }
  const grupos = new Map<string, { titulo: string; itens: Venda[] }>()
  for (const v of l) { const [k, t] = chave(v); const g = grupos.get(k) || { titulo: t, itens: [] }; g.itens.push(v); grupos.set(k, g) }
  const gs = U.ordenar([...grupos.entries()], x => x[0]).map(([k, g]) => ({ k, ...g }))
  const qtdT = U.soma(l, v => Number(v.qtd)), saldoT = U.soma(l, v => Math.max(0, C.saldoVenda(v))), entT = U.soma(l, v => Number(v.entregue) || 0)
  const atrasados = l.filter(v => C.situacaoVenda(v).cod === 'atraso').length
  const umCliente = !!cli || new Set(l.map(v => v.cliente_nome)).size <= 1
  const titulo = 'Relatório de entregas'
  const sub = [faixa ? (per === 'atraso' ? 'Em atraso' : `${U.data(faixa[0])} a ${U.data(faixa[1])}`) : 'Todas as datas', cli ? clientes.find(c => c[0] === cli)?.[1] : 'todos os clientes',
    sit === 'aberto' ? 'em aberto' : sit === 'entregue' ? 'entregues' : 'abertos e entregues', busca.trim() ? `“${busca.trim()}”` : ''].filter(Boolean).join(' · ')
  const linha = (v: Venda) => [v.pedido || '', v.codigo || '', v.codigo_cliente || '', v.descricao || '', U.qtd(v.qtd), U.qtd(v.entregue || 0), U.qtd(Math.max(0, C.saldoVenda(v))), U.dataCurta(v.prazo), C.situacaoVenda(v).txt, ...(umCliente ? [] : [v.cliente_nome || ''])]
  const pdf = async () => {
    const cols = [{ t: 'Pedido', w: 24 }, { t: 'Cód. JAF', w: 26, mono: true }, { t: 'Cód. cliente', w: 26, mono: true }, { t: 'Descrição' }, { t: 'Qtde', w: 16, alinhar: 'right' as const },
      { t: 'Entregue', w: 18, alinhar: 'right' as const }, { t: 'Saldo', w: 16, alinhar: 'right' as const }, { t: 'Entrega', w: 18 }, { t: 'Situação', w: 22 }, ...(umCliente ? [] : [{ t: 'Cliente', w: 30 }])]
    const tot = (it: Venda[]) => ['Total', '', '', U.plural(it.length, 'item', 'itens'), U.qtd(U.soma(it, v => Number(v.qtd))), U.qtd(U.soma(it, v => Number(v.entregue) || 0)), U.qtd(U.soma(it, v => Math.max(0, C.saldoVenda(v)))), '', '', ...(umCliente ? [] : [''])]
    await entregar(await pdfTabela(titulo, sub, cols, [], { deitado: true, grupos: gs.map(g => ({ titulo: g.titulo, linhas: g.itens.map(linha), totais: tot(g.itens) })) }), `Entregas ${U.hoje()}.pdf`)
  }
  // Excel como a planilha do PCP: uma aba por grupo (dia, semana, peça ou cliente) + o resumo
  const planilha = async () => {
    const X = await xlsx(), wb = X.utils.book_new(), usados = new Set<string>()
    const cab = ['Pedido', 'Cód. JAF', 'Cód. cliente', 'Descrição', 'Qtde', 'Entregue', 'Saldo', 'Data entrega', 'Situação', 'Cliente']
    const lin = (v: Venda) => [v.pedido || '', v.codigo || '', v.codigo_cliente || '', v.descricao || '', Number(v.qtd), Number(v.entregue) || 0, Math.max(0, C.saldoVenda(v)), U.data(v.prazo), C.situacaoVenda(v).txt, v.cliente_nome || '']
    const nomeAba = (t: string) => { let n = t.replace(/[\\/?*[\]:]/g, '-').slice(0, 28) || 'Aba'; let i = 2; while (usados.has(n)) n = n.slice(0, 25) + ' ' + i++; usados.add(n); return n }
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([[titulo], [sub], [], ['Grupo', 'Itens', 'Qtde', 'Entregue', 'Saldo'],
      ...gs.map(g => [g.titulo, g.itens.length, U.soma(g.itens, v => Number(v.qtd)), U.soma(g.itens, v => Number(v.entregue) || 0), U.soma(g.itens, v => Math.max(0, C.saldoVenda(v)))]),
      ['Total', l.length, qtdT, entT, saldoT]]), nomeAba('Resumo'))
    for (const g of gs) X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([cab, ...g.itens.map(lin)]), nomeAba(grupo === 'dia' ? ddmm(g.k).replace('/', '-') : grupo === 'semana' ? 'Sem ' + ddmm(g.k).replace('/', '-') : g.titulo))
    await entregar(new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: TIPO_XLSX }), `Entregas ${U.hoje()}.xlsx`)
  }
  const notas = U.ordenar(S.lista('notas_saida'), n => n.criado_em, true).slice(0, 30)
  const podeNota = Perm.pode('vendas_editar')
  return <>
    <Cab titulo={titulo} sub="Por data, semana, peça ou cliente — com PDF e Excel (uma aba por dia de entrega)">
      <Btn txt="PDF" icone="imprimir" cls="sec" data-ent="pdf" disabled={!l.length} onClick={pdf} />
      <Btn txt="Excel" icone="planilha" cls="sec" data-ent="excel" disabled={!l.length} onClick={planilha} />
    </Cab>
    <Chips nome="per" atual={per} aoEscolher={setPer} opcoes={[{ v: 'semana', t: 'Esta semana' }, { v: 'prox', t: 'Próxima semana' }, { v: 'mes', t: 'Este mês' }, { v: '30', t: 'Próximos 30 dias' },
      { v: 'atraso', t: 'Em atraso', n: todas.filter(v => C.situacaoVenda(v).cod === 'atraso').length || null }, { v: 'livre', t: 'Escolher datas' }, { v: 'todas', t: 'Todas' }]} />
    {per === 'livre' && <div className="barra-filtros"><label className="sub" htmlFor="entDe">De</label><input id="entDe" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
      <label className="sub" htmlFor="entAte">até</label><input id="entAte" type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></div>}
    <div className="barra-filtros mt"><BuscaLista id="bEnt" valor={busca} placeholder="Peça, código do cliente ou pedido" aoMudar={setBusca} />
      <select value={cli} onChange={(e) => setCli(e.target.value)} aria-label="Cliente" data-ent-cli="1"><option value="">Todos os clientes</option>{clientes.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
      <select value={sit} onChange={(e) => setSit(e.target.value)} aria-label="Situação" data-ent-sit="1"><option value="aberto">Em aberto</option><option value="entregue">Entregues</option><option value="todos">Abertos e entregues</option></select>
      <select value={grupo} onChange={(e) => setGrupo(e.target.value)} aria-label="Agrupar por" data-ent-grupo="1"><option value="dia">Por dia de entrega</option><option value="semana">Por semana</option><option value="produto">Por peça</option><option value="cliente">Por cliente</option></select></div>
    <div className="grade g4 mt">
      <div className="kpi"><small>Itens</small><b>{l.length}</b><span>{U.plural(gs.length, grupo === 'dia' ? 'dia' : grupo === 'semana' ? 'semana' : grupo === 'produto' ? 'peça' : 'cliente')}</span></div>
      <div className="kpi"><small>Quantidade</small><b>{U.qtd(qtdT)}</b><span>peças pedidas</span></div>
      <div className="kpi"><small>Falta entregar</small><b>{U.qtd(saldoT)}</b><span>{U.qtd(entT)} já entregues</span></div>
      <div className="kpi"><small>Em atraso</small><b style={{ color: atrasados ? 'var(--vermelho)' : undefined }}>{atrasados}</b><span>itens</span></div>
    </div>
    <div id="lEnt">{gs.map(g => <section key={g.k} className="card mt" data-ent-grupo-k={g.k}>
      <div className="card-cab"><h2>{g.titulo}</h2><span className="sub">{U.plural(g.itens.length, 'item', 'itens')} · {U.qtd(U.soma(g.itens, v => Math.max(0, C.saldoVenda(v))))} a entregar</span></div>
      <div className="rolagem-x"><table className="tabela-fab"><thead><tr><th>Pedido</th><th>Cód. JAF</th><th className="so-largo">Cód. cliente</th><th className="so-largo">Descrição</th><th className="n">Qtde</th><th className="n">Saldo</th>
        {grupo !== 'dia' && <th>Entrega</th>}{!umCliente && grupo !== 'cliente' && <th className="so-largo">Cliente</th>}<th>Situação</th></tr></thead>
        <tbody>{g.itens.map(v => <tr key={v.id} className="clicavel" onClick={() => void detalhe(v.id)} data-ent-venda={v.id}><td>{v.pedido || '—'}</td><td className="mono">{v.codigo || v.codigo_cliente || '—'}</td>
          <td className="so-largo mono">{v.codigo_cliente || ''}</td><td className="so-largo">{v.descricao}</td><td className="n">{U.qtd(v.qtd)}</td><td className="n"><b>{U.qtd(Math.max(0, C.saldoVenda(v)))}</b></td>
          {grupo !== 'dia' && <td>{U.dataCurta(v.prazo)}</td>}{!umCliente && grupo !== 'cliente' && <td className="so-largo">{v.cliente_nome}</td>}<td><Tag s={C.situacaoVenda(v)} /></td></tr>)}</tbody></table></div></section>)}
      {!l.length && <div className="mt"><Vazio icone="calendario" titulo="Nenhuma entrega neste filtro" texto="Troque o período ou a situação." /></div>}</div>
    <section className="card mt" id="entNotas"><div className="card-cab"><h2>Notas fiscais que baixaram entregas</h2>
      {podeNota && <Btn txt="Baixar pela NF (XML)" icone="nota" cls="sec mini" data-ent="nota" onClick={() => void baixarPelaNota()} />}</div>
      {notas.length ? <div className="lista">{notas.map(n => <div key={n.id} className="linha" data-ns={n.id}><div className="meio"><b>NF {n.numero} · {n.cliente_nome}</b>
        <small>{U.data(n.emissao)} · {U.qtd(n.baixado)} pç em {U.plural(n.entregas, 'entrega')} · por {n.criado_nome || '—'} {U.relativo(n.criado_em)}</small>
        {n.desfeito_em && <small>Desfeita por {n.desfeito_por || '—'} em {U.dataHora(n.desfeito_em)}</small>}</div>
        <div className="lado">{n.desfeito_em ? <Tag s={{ txt: 'Desfeita', cor: 'cinza' }} /> : podeNota ? <button type="button" className="btn fantasma mini" data-ns-desfazer={n.id} onClick={() => void desfazerNota(n.id)}>Desfazer</button> : <Tag s={{ txt: 'Baixada', cor: 'verde' }} />}</div></div>)}</div>
        : <p className="sub">Nenhuma nota baixada ainda. Em Pedidos de clientes, use “Pedido PDF / NF-e” → Nota fiscal emitida (XML).</p>}</section>
  </>
}
