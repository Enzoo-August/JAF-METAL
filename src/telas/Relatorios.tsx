/* Relatórios (os da planilha + novos) */
import { useEffect, type ReactNode } from 'react'
import { C, S } from '../lib/dados.ts'
import { Perm } from '../lib/perm.ts'
import type { Peca } from '../lib/tipos.ts'
import * as U from '../lib/util.ts'
import { entregar, excelLinhas, pdfTabela, type ColunaPdf, type GrupoPdf } from '../ui/arquivos.tsx'
import { Btn, Cab, Vazio } from '../ui/base.tsx'
import { ir, useLembrar, type Rota } from '../ui/ganchos.ts'
import { pontualidade } from './Fornecedores.tsx'

const ABAS: [string, string][] = [['estoque', 'Estoque'], ['consumo', 'Consumo'], ['compras', 'Compras e custos'], ['maquinas', 'Por máquina'], ['fornecedores', 'Fornecedores'], ['financeiro', 'Financeiro']]

interface Exportavel { titulo: string; sub: string; colunas: ColunaPdf[]; linhas: (string | number)[][]; totais?: (string | number)[]; grupos?: GrupoPdf[]; deitado?: boolean }
interface Relatorio { corpo: ReactNode; ex: Exportavel | null; anos?: string[]; comMes?: boolean; semAno?: boolean }
interface Filtro { ano: string; mes: string }

function Barras({ itens, fmt = U.moeda0 }: { itens: { t: string; v: number }[]; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...itens.map(i => i.v))
  return <div className="barras">{itens.map(i => <div key={i.t} className="barra-h"><span title={i.t}>{i.t}</span><div className="trilho"><i style={{ width: `${i.v / max * 100}%` }} /></div><b>{fmt(i.v)}</b></div>)}</div>
}
const anosMov = () => U.unicos(S.lista('movimentos').map(m => m.data.slice(0, 4))).sort().reverse()
const LinhaPecaValor = ({ p, v, extra }: { p: Peca; v: number; extra: string }) => <a className="linha" href={'#/peca/' + p.id}><div className="meio"><b><span className="codigo">{p.codigo}</span> · {p.descricao}</b><small>{extra}</small></div><div className="lado"><b>{U.moeda(v)}</b></div></a>

// ---------------------------------------------------------------- estoque
function rEstoque(): Relatorio {
  const pecas = S.lista('pecas').filter(p => p.estoque > 0)
  const val = new Map(pecas.map(p => [p.id, C.valorPeca(p.id)]))
  const total = U.soma([...val.values()], x => x)
  const soma = (l: Peca[]) => U.soma(l, p => val.get(p.id))
  const de12 = U.somaMeses(U.hoje(), -12)
  const comSaida = new Set(C.consumos(m => m.data >= de12).filter(x => x.qtd > 0).map(x => x.mov.peca_id))
  const parado = pecas.filter(p => !comSaida.has(p.id)).sort((a, b) => val.get(b.id)! - val.get(a.id)!)
  const valParado = soma(parado)
  const grupo = (f: (p: Peca) => string) => [...U.agrupar(pecas, f).entries()].map(([t, l]) => ({ t, v: soma(l) })).sort((a, b) => b.v - a.v).slice(0, 12)
  return {
    semAno: true,
    ex: { titulo: 'Estoque atual', sub: `Valor pelo custo de cada nota (PEPS) em ${U.data(U.hoje())}`, colunas: [{ t: 'Código', w: 40, mono: true }, { t: 'Descrição' }, { t: 'Utilização', w: 32 }, { t: 'Qtd', w: 14, alinhar: 'right' }, { t: 'Custo médio', w: 24, alinhar: 'right' }, { t: 'Valor', w: 26, alinhar: 'right' }],
      linhas: U.ordenar(pecas, p => -val.get(p.id)!).map(p => [p.codigo, p.descricao, p.utilizacao || '', U.qtd(p.estoque), U.moeda(val.get(p.id)! / p.estoque), U.moeda(val.get(p.id))]), totais: ['', '', '', '', 'Total', U.moeda(total)] },
    corpo: <>
      <div className="grade g3"><div className="kpi"><small>Valor em estoque</small><b>{U.moeda0(total)}</b><span>{U.plural(pecas.length, 'item', 'itens')} com saldo</span></div>
        <div className={`kpi ${valParado > total * .3 ? 'alerta' : ''}`}><small>Dinheiro parado</small><b>{U.moeda0(valParado)}</b><span>{U.plural(parado.length, 'item', 'itens')} sem saída há 12 meses</span></div>
        <div className="kpi"><small>Abaixo do mínimo</small><b>{C.listaCompras().length}</b><span><a href="#/compras/lista">ver lista de compras</a></span></div></div>
      <div className="grade g2 mt"><section className="card"><h2>Por fornecedor</h2><div className="mt"><Barras itens={grupo(p => S.get('fornecedores', p.fornecedor_id)?.nome || 'Sem fornecedor')} /></div></section>
        <section className="card"><h2>Por máquina / utilização</h2><div className="mt"><Barras itens={grupo(p => p.utilizacao || 'Sem utilização')} /></div></section></div>
      {parado.length > 0 && <section className="card mt"><div className="card-cab"><h2>Dinheiro parado</h2><span className="sub">tem estoque e ninguém retirou nos últimos 12 meses</span></div>
        <div className="lista">{parado.slice(0, 20).map(p => <LinhaPecaValor key={p.id} p={p} v={val.get(p.id)!} extra={`${U.qtd(p.estoque)} ${p.unidade} · ${p.utilizacao || ''}`} />)}</div>
        <p className="sub mt">Talvez valha reduzir o estoque máximo destas peças ou parar de comprar.</p></section>}
    </>,
  }
}

// ---------------------------------------------------------------- consumo (aba "Consumo Anual")
function rConsumo({ ano, mes }: Filtro): Relatorio {
  const pref = ano + (mes ? '-' + mes : '')
  const cs = C.consumos(m => m.data.startsWith(pref))
  const lin = [...U.agrupar(cs, x => x.mov.peca_id).entries()].map(([pid, l]) => ({ p: S.get('pecas', pid), q: U.soma(l, 'qtd'), v: U.soma(l, 'valor'), pmax: Math.max(...l.map(x => x.mov.preco_unit)) })).filter(x => x.q !== 0).sort((a, b) => b.v - a.v)
  const total = U.soma(lin, 'v')
  const meses = Array.from({ length: 12 }, (_, i) => { const mm = String(i + 1).padStart(2, '0'); return { t: U.cap(U.nomeMes(i + 1)).slice(0, 3), v: U.soma(C.consumos(m => m.data.startsWith(ano + '-' + mm)), 'valor') } })
  const porUtil = U.agrupar(cs, x => S.get('maquinas', x.mov.maquina_id)?.nome || S.get('pecas', x.mov.peca_id)?.utilizacao || 'Sem máquina')
  const anoAnt = String(Number(ano) - 1)
  const ateHoje = ano === U.hoje().slice(0, 4) ? U.hoje().slice(5) : '12-31'
  const totAnt = U.soma(C.consumos(m => m.data.startsWith(anoAnt) && m.data.slice(5) <= ateHoje), 'valor')
  const totAte = U.soma(C.consumos(m => m.data.startsWith(ano) && m.data.slice(5) <= ateHoje), 'valor')
  const varia = totAnt ? totAte / totAnt - 1 : null
  return {
    comMes: true,
    ex: { titulo: 'Consumo ' + (mes ? U.nomeMes(Number(mes)) + '/' : '') + ano, sub: 'Retiradas do almoxarifado (desconta as desfeitas)',
      colunas: [{ t: 'Código', w: 46, mono: true }, { t: 'Descrição' }, { t: 'Quantidade', w: 22, alinhar: 'right' }, { t: 'Preço unit. (máx)', w: 30, alinhar: 'right' }, { t: 'Total', w: 28, alinhar: 'right' }],
      linhas: lin.map(x => [x.p?.codigo || '', x.p?.descricao || '', U.qtd(x.q), U.moeda(x.pmax), U.moeda(x.v)]), totais: ['Total geral', '', U.qtd(U.soma(lin, 'q')), '', U.moeda(total)] },
    corpo: <>
      <div className="grade g3"><div className="kpi"><small>Consumo no período</small><b>{U.moeda0(total)}</b><span>{U.plural(lin.length, 'item', 'itens')} diferentes</span></div>
        <div className="kpi"><small>{ano} até {U.data(ano + '-' + ateHoje).slice(0, 5)}</small><b>{U.moeda0(totAte)}</b>{varia !== null ? <span style={{ color: `var(--${varia > 0 ? 'vermelho' : 'verde'})` }}>{varia > 0 ? '+' : '−'}{U.pct(Math.abs(varia))} contra {anoAnt}</span> : <span>&nbsp;</span>}</div>
        <div className="kpi"><small>Média por mês</small><b>{U.moeda0(totAte / Math.max(1, Number(ateHoje.slice(0, 2))))}</b></div></div>
      <div className="grade g2 mt"><section className="card"><h2>Mês a mês em {ano}</h2><div className="mt"><Barras itens={meses} /></div></section>
        <section className="card"><h2>Por máquina</h2><div className="mt"><Barras itens={[...porUtil.entries()].map(([t, l]) => ({ t, v: U.soma(l, 'valor') })).sort((a, b) => b.v - a.v).slice(0, 12)} /></div></section></div>
      <section className="card mt"><div className="tabela-caixa"><table className="tabela cartoes"><thead><tr><th>Código</th><th>Descrição</th><th className="num">Quantidade</th><th className="num">Preço unit. (máx)</th><th className="num">Total</th></tr></thead>
        <tbody>{lin.length ? lin.map(x => <tr key={x.p?.id} className="clicavel" data-peca={x.p?.id} onClick={() => ir('#/peca/' + x.p?.id)}><td data-r="Código" className="titulo mono">{x.p?.codigo}</td><td data-r="Descrição">{x.p?.descricao}</td>
          <td data-r="Quantidade" className="num">{U.qtd(x.q)}</td><td data-r="Preço" className="num">{U.moeda(x.pmax)}</td><td data-r="Total" className="num">{U.moeda(x.v)}</td></tr>) : <tr><td colSpan={5}>Nada no período.</td></tr>}</tbody>
        <tfoot><tr><td colSpan={2}>Total geral</td><td className="num">{U.qtd(U.soma(lin, 'q'))}</td><td></td><td className="num">{U.moeda(total)}</td></tr></tfoot></table></div></section>
    </>,
  }
}

// ---------------------------------------------------------------- compras (aba "Análise Anual de Custos")
function rCompras({ ano, mes }: Filtro): Relatorio {
  const ehCompra = (m: { tipo: string; motivo: string }) => m.tipo === 'entrada' && (m.motivo === 'compra' || m.motivo === 'importado')
  const ents = S.lista('movimentos').filter(m => ehCompra(m) && m.data.startsWith(ano + (mes ? '-' + mes : '')))
  const grupos = [...U.agrupar(ents, m => m.fornecedor_id || '').entries()].map(([fid, l]) => ({ f: S.get('fornecedores', fid), l, v: U.soma(l, m => m.qtd * m.preco_unit) })).sort((a, b) => b.v - a.v)
  const total = U.soma(grupos, 'v')
  // maiores aumentos de preço (último preço do ano x último do ano anterior)
  const aum: { p: Peca; a: number; b: number; v: number }[] = []
  for (const p of S.lista('pecas')) {
    const e = S.lista('movimentos').filter(m => m.peca_id === p.id && ehCompra(m) && m.preco_unit > 0)
    const ant = e.filter(m => m.data.startsWith(String(Number(ano) - 1))), at = e.filter(m => m.data.startsWith(ano))
    if (ant.length && at.length) { const a = ant[ant.length - 1].preco_unit, b = at[at.length - 1].preco_unit; aum.push({ p, a, b, v: b / a - 1 }) }
  }
  aum.sort((x, y) => y.v - x.v)
  const porPeca = (l: typeof ents) => [...U.agrupar(l, m => m.peca_id).entries()].map(([pid, x]) => ({ pid, p: S.get('pecas', pid), q: U.soma(x, 'qtd'), v: U.soma(x, m => m.qtd * m.preco_unit) }))
  return {
    comMes: true,
    ex: { titulo: 'Análise de custos de aquisição ' + ano, sub: 'Compras (entradas) por fornecedor', colunas: [{ t: 'Código', w: 48, mono: true }, { t: 'Descrição' }, { t: 'Qtd', w: 16, alinhar: 'right' }, { t: 'Preço médio', w: 26, alinhar: 'right' }, { t: 'Custo total', w: 28, alinhar: 'right' }], linhas: [],
      grupos: grupos.map(g => ({ titulo: (g.f?.nome || 'Sem fornecedor') + ' — ' + U.moeda(g.v), linhas: porPeca(g.l).map(x => [x.p?.codigo || '', x.p?.descricao || '', U.qtd(x.q), U.moeda(x.v / x.q), U.moeda(x.v)]) })) },
    corpo: <>
      <div className="grade g3"><div className="kpi"><small>Comprado no período</small><b>{U.moeda0(total)}</b><span>{U.plural(ents.length, 'entrada')}</span></div>
        <div className="kpi"><small>Fornecedores</small><b>{grupos.length}</b></div><div className="kpi"><small>Maior fornecedor</small><b style={{ fontSize: '1.1rem' }}>{grupos[0]?.f?.nome || '—'}</b><span>{grupos[0] ? U.pct(grupos[0].v / total) + ' do total' : ''}</span></div></div>
      <div className="grade g2 mt"><section className="card"><h2>Por fornecedor</h2><div className="mt"><Barras itens={grupos.slice(0, 12).map(g => ({ t: g.f?.nome || 'Sem fornecedor', v: g.v }))} /></div></section>
        <section className="card"><h2>Preço que mais subiu</h2><p className="sub">Último preço de {ano} × último de {Number(ano) - 1}</p>
          {aum.length ? <div className="lista mt">{aum.slice(0, 8).map(x => <a key={x.p.id} className="linha" href={'#/peca/' + x.p.id}><div className="meio"><b><span className="codigo">{x.p.codigo}</span></b><small>{U.moeda(x.a)} → {U.moeda(x.b)}</small></div>
            <div className="lado"><b style={{ color: `var(--${x.v > 0 ? 'vermelho' : 'verde'})` }}>{x.v > 0 ? '+' : '−'}{U.pct(Math.abs(x.v))}</b></div></a>)}</div> : <p className="sub mt">Sem compras nos dois anos para comparar.</p>}</section></div>
      {grupos.map(g => <section key={g.f?.id || 'sem'} className="card mt"><div className="card-cab"><h2>{g.f?.nome || 'Sem fornecedor'}</h2><b>{U.moeda(g.v)}</b></div>
        <div className="tabela-caixa"><table className="tabela cartoes"><thead><tr><th>Código</th><th className="num">Custo total</th><th className="num">Qtd</th><th className="num">Preço médio</th><th>Utilização</th></tr></thead><tbody>
          {porPeca(g.l).map(x => <tr key={x.pid} className="clicavel" data-peca={x.pid} onClick={() => ir('#/peca/' + x.pid)}><td data-r="Código" className="titulo mono">{x.p?.codigo}</td><td data-r="Custo" className="num">{U.moeda(x.v)}</td>
            <td data-r="Qtd" className="num">{U.qtd(x.q)}</td><td data-r="Preço médio" className="num">{U.moeda(x.v / x.q)}</td><td data-r="Utilização" className="peq">{x.p?.utilizacao || ''}</td></tr>)}</tbody></table></div></section>)}
    </>,
  }
}

// ---------------------------------------------------------------- por máquina
function rMaquinas({ ano }: Filtro): Relatorio {
  const de = ano + '-01-01', ate = ano + '-12-31'
  const lin = S.lista('maquinas').map(m => {
    const mans = S.lista('manutencoes').filter(x => x.maquina_id === m.id && x.data >= de && x.data <= ate)
    return { m, pecas: U.soma(C.consumos(x => x.maquina_id === m.id && x.data >= de && x.data <= ate), 'valor'), serv: U.soma(mans, 'custo_servico'), horas: U.soma(mans, 'horas_parada'), probs: mans.filter(x => x.tipo === 'corretiva').length }
  }).filter(x => x.pecas || x.serv || x.horas || x.probs).sort((a, b) => (b.pecas + b.serv) - (a.pecas + a.serv))
  const semMaq = U.soma(C.consumos(x => !x.maquina_id && x.data >= de && x.data <= ate), 'valor')
  return {
    ex: { titulo: 'Custo por máquina ' + ano, sub: 'Peças retiradas para a máquina + serviços de manutenção', colunas: [{ t: 'Máquina' }, { t: 'Peças', w: 28, alinhar: 'right' }, { t: 'Serviços', w: 28, alinhar: 'right' }, { t: 'Total', w: 28, alinhar: 'right' }, { t: 'Problemas', w: 20, alinhar: 'right' }, { t: 'Horas paradas', w: 26, alinhar: 'right' }],
      linhas: lin.map(x => [x.m.nome, U.moeda(x.pecas), U.moeda(x.serv), U.moeda(x.pecas + x.serv), x.probs, U.qtd(x.horas)]) },
    corpo: <>
      {semMaq > 0 && <p className="nota">{U.moeda0(semMaq)} em retiradas sem máquina informada (inclui o histórico da planilha, que não tinha esse campo). Ao retirar peça, escolha a máquina para este relatório ficar completo.</p>}
      <section className="card mt">{lin.length ? <Barras itens={lin.slice(0, 15).map(x => ({ t: x.m.nome, v: x.pecas + x.serv }))} /> : <p className="sub">Nada registrado neste ano.</p>}</section>
      {lin.length > 0 && <section className="card mt"><div className="tabela-caixa"><table className="tabela cartoes"><thead><tr><th>Máquina</th><th className="num">Peças</th><th className="num">Serviços</th><th className="num">Total</th><th className="num">Problemas</th><th className="num">Horas paradas</th></tr></thead>
        <tbody>{lin.map(x => <tr key={x.m.id} className="clicavel" data-maq={x.m.id} onClick={() => ir('#/maquina/' + x.m.id)}><td data-r="Máquina" className="titulo">{x.m.nome}</td><td data-r="Peças" className="num">{U.moeda(x.pecas)}</td><td data-r="Serviços" className="num">{U.moeda(x.serv)}</td>
          <td data-r="Total" className="num"><b>{U.moeda(x.pecas + x.serv)}</b></td><td data-r="Problemas" className="num">{x.probs}</td><td data-r="Horas paradas" className="num">{U.qtd(x.horas)}</td></tr>)}</tbody></table></div></section>}
    </>,
  }
}

// ---------------------------------------------------------------- fornecedores
function rFornecedores({ ano }: Filtro): Relatorio {
  const lin = S.lista('fornecedores').map(f => {
    const ents = S.lista('movimentos').filter(m => m.fornecedor_id === f.id && m.tipo === 'entrada' && (m.motivo === 'compra' || m.motivo === 'importado') && m.data.startsWith(ano))
    return { f, v: U.soma(ents, m => m.qtd * m.preco_unit), n: new Set(ents.map(m => m.documento)).size, pont: pontualidade(f.id) }
  }).filter(x => x.v || x.pont).sort((a, b) => b.v - a.v)
  return {
    ex: { titulo: 'Fornecedores ' + ano, sub: 'Total comprado e entrega no prazo', colunas: [{ t: 'Fornecedor' }, { t: 'Comprado', w: 30, alinhar: 'right' }, { t: 'Notas', w: 18, alinhar: 'right' }, { t: 'No prazo', w: 24, alinhar: 'right' }],
      linhas: lin.map(x => [x.f.nome, U.moeda(x.v), x.n, x.pont ? U.pct(x.pont.pct) + ` (${x.pont.n})` : '—']) },
    corpo: <section className="card"><div className="tabela-caixa"><table className="tabela cartoes"><thead><tr><th>Fornecedor</th><th className="num">Comprado em {ano}</th><th className="num">Notas</th><th className="num">Entrega no prazo</th></tr></thead>
      <tbody>{lin.length ? lin.map(x => <tr key={x.f.id} className="clicavel" data-forn={x.f.id} onClick={() => ir('#/fornecedor/' + x.f.id)}><td data-r="Fornecedor" className="titulo">{x.f.nome}</td><td data-r="Comprado" className="num">{U.moeda(x.v)}</td><td data-r="Notas" className="num">{x.n}</td>
        <td data-r="No prazo" className="num">{x.pont ? <><b style={{ color: `var(--${x.pont.pct >= .8 ? 'verde' : x.pont.pct >= .5 ? 'amarelo' : 'vermelho'})` }}>{U.pct(x.pont.pct)}</b> <span className="fraco">({x.pont.n})</span></> : '—'}</td></tr>)
        : <tr><td colSpan={4}>Nada no ano.</td></tr>}</tbody></table></div>
      <p className="sub mt">A pontualidade só conta pedidos recebidos pelo sistema com prazo combinado (o histórico da planilha não tinha a data real de chegada).</p></section>,
  }
}

// ---------------------------------------------------------------- financeiro
function rFinanceiro({ ano }: Filtro): Relatorio {
  const anos = U.unicos([...S.lista('lancamentos').filter(l => l.pago_em).map(l => l.pago_em!.slice(0, 4)), U.hoje().slice(0, 4)]).sort().reverse()
  if (!Perm.pode('financeiro')) return { corpo: <Vazio icone="cadeado" titulo="Só Dono e Escritório veem o financeiro" />, ex: null, anos }
  const L = S.lista('lancamentos').filter(l => l.pago_em && l.pago_em.startsWith(ano))
  const meses = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))
  const cats = (tipo: string) => [...U.agrupar(L.filter(l => l.tipo === tipo), l => l.categoria || 'Sem categoria').entries()]
    .map(([c, l]) => ({ c, m: meses.map(mm => U.soma(l.filter(x => x.pago_em!.slice(5, 7) === mm), 'valor_pago')), t: U.soma(l, 'valor_pago') })).sort((a, b) => b.t - a.t)
  const rec = cats('receber'), desp = cats('pagar')
  const totM = (lst: typeof rec) => meses.map((_, i) => U.soma(lst, x => x.m[i]))
  const tr = totM(rec), td = totM(desp)
  const ms = meses.slice(0, ano === U.hoje().slice(0, 4) ? Number(U.hoje().slice(5, 7)) : 12)
  const nomeM = (m: string) => U.cap(U.nomeMes(Number(m))).slice(0, 3)
  const somaTr = U.soma(tr, x => x), somaTd = U.soma(td, x => x)
  const cab = <tr><th>Categoria</th>{ms.map(m => <th key={m} className="num">{nomeM(m)}</th>)}<th className="num">Total</th></tr>
  const lin = (x: (typeof rec)[number]) => <tr key={x.c}><td>{x.c}</td>{ms.map((m, i) => <td key={m} className="num">{x.m[i] ? U.moeda0(x.m[i]) : '—'}</td>)}<td className="num"><b>{U.moeda0(x.t)}</b></td></tr>
  return {
    anos,
    ex: { titulo: 'Receitas e despesas ' + ano, sub: 'Pelo que foi efetivamente pago e recebido', deitado: true,
      colunas: [{ t: 'Categoria' }, ...ms.map(m => ({ t: nomeM(m), alinhar: 'right' as const })), { t: 'Total', alinhar: 'right' }],
      linhas: [...rec.map(x => ['(+) ' + x.c, ...ms.map((_, i) => U.moeda0(x.m[i])), U.moeda0(x.t)]), ...desp.map(x => ['(−) ' + x.c, ...ms.map((_, i) => U.moeda0(x.m[i])), U.moeda0(x.t)])],
      totais: ['Resultado', ...ms.map((_, i) => U.moeda0(tr[i] - td[i])), U.moeda0(somaTr - somaTd)] },
    corpo: <>
      <div className="grade g3"><div className="kpi"><small>Recebido em {ano}</small><b>{U.moeda0(somaTr)}</b></div><div className="kpi"><small>Pago em {ano}</small><b>{U.moeda0(somaTd)}</b></div>
        <div className={`kpi ${somaTr - somaTd < 0 ? 'alerta' : 'bom'}`}><small>Resultado de caixa</small><b>{U.moeda0(somaTr - somaTd)}</b></div></div>
      <section className="card mt"><h2>Receitas</h2><div className="tabela-caixa mt"><table className="tabela"><thead>{cab}</thead><tbody>{rec.length ? rec.map(lin) : <tr><td colSpan={ms.length + 2}>Nada recebido.</td></tr>}</tbody></table></div></section>
      <section className="card mt"><h2>Despesas</h2><div className="tabela-caixa mt"><table className="tabela"><thead>{cab}</thead><tbody>{desp.length ? desp.map(lin) : <tr><td colSpan={ms.length + 2}>Nada pago.</td></tr>}</tbody></table></div></section>
      <section className="card mt"><h2>Resultado mês a mês</h2><div className="tabela-caixa mt"><table className="tabela"><thead><tr><th></th>{ms.map(m => <th key={m} className="num">{nomeM(m)}</th>)}</tr></thead>
        <tbody><tr><td>Resultado</td>{ms.map((m, i) => { const v = tr[i] - td[i]; return <td key={m} className="num" style={{ color: `var(--${v < 0 ? 'vermelho' : 'verde'})`, fontWeight: 700 }}>{U.moeda0(v)}</td> })}</tr></tbody></table></div>
        <p className="sub mt">Conta pelo dia em que foi pago/recebido (regime de caixa).</p></section>
    </>,
  }
}

const FN: Record<string, (f: Filtro) => Relatorio> = { estoque: rEstoque, consumo: rConsumo, compras: rCompras, maquinas: rMaquinas, fornecedores: rFornecedores, financeiro: rFinanceiro }

export function TelaRelatorios({ r }: { r: Rota }) {
  const [aba, setAba] = useLembrar('rel.aba', 'estoque')
  const [ano, setAno] = useLembrar('rel.ano', U.hoje().slice(0, 4))
  const [mes, setMes] = useLembrar('rel.mes', '')
  useEffect(() => { const q = r.q.get('r'); if (q && FN[q]) setAba(q) }, [r.hash, r.q, setAba])
  const abas = ABAS.filter(([k]) => k !== 'financeiro' || Perm.pode('financeiro')).filter(([k]) => k !== 'fornecedores' || Perm.pode('compras'))
  const atual = abas.some(([k]) => k === aba) ? aba : 'estoque'
  let rel: Relatorio
  try { rel = FN[atual]({ ano, mes }) }
  catch (e) { console.error(e); rel = { corpo: <Vazio icone="alerta" titulo="Não deu para montar este relatório" texto={(e as Error).message} />, ex: null } }
  const ex = rel.ex
  const anos = rel.anos || anosMov()
  const escolherAba = (k: string) => { setAba(k); history.replaceState(null, '', '#/relatorios?r=' + k) }
  return <>
    <Cab titulo="Relatórios" sub="Os mesmos da planilha, e outros novos" />
    <nav className="abas-tela">{abas.map(([k, t]) => <button key={k} type="button" data-aba={k} className={k === atual ? 'on' : ''} onClick={() => escolherAba(k)}>{t}</button>)}</nav>
    {ex && <div className="barra-filtros">
      {!rel.semAno && <select id="rAno" aria-label="Ano" value={ano} onChange={(e) => setAno(e.target.value)}>{U.unicos([...anos, ano]).sort().reverse().map(a => <option key={a}>{a}</option>)}</select>}
      {rel.comMes && <select id="rMes" aria-label="Mês" value={mes} onChange={(e) => setMes(e.target.value)}><option value="">Ano inteiro</option>
        {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(m => <option key={m} value={m}>{U.cap(U.nomeMes(Number(m)))}</option>)}</select>}
      <Btn txt="Excel" icone="baixar" data-x="excel" onClick={() => excelLinhas(`${ex.titulo}.xlsx`, 'Relatório', [ex.colunas.map(c => c.t), ...(ex.grupos ? ex.grupos.flatMap(g => [[g.titulo], ...g.linhas, []]) : ex.linhas), ...(ex.totais ? [ex.totais] : [])])} />
      <Btn txt="PDF" icone="imprimir" data-x="pdf" onClick={async () => entregar(await pdfTabela(ex.titulo, ex.sub, ex.colunas, ex.linhas, { totais: ex.totais, grupos: ex.grupos, deitado: ex.deitado }), `${ex.titulo}.pdf`)} />
    </div>}
    {rel.corpo}
  </>
}
