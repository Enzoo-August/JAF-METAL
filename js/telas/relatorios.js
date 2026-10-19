/* Relatórios (os da planilha + novos) */
'use strict';

Telas.relatorios = (() => {
  const esc = U.esc;
  const estado = { r: 'estoque', ano: U.hoje().slice(0, 4), mes: '' };
  const ABAS = [['estoque', 'Estoque'], ['consumo', 'Consumo'], ['compras', 'Compras e custos'], ['maquinas', 'Por máquina'], ['fornecedores', 'Fornecedores'], ['financeiro', 'Financeiro']];

  const barras = (itens, fmt = U.moeda0) => { const max = Math.max(1, ...itens.map(i => i.v));
    return `<div class="barras">${itens.map(i => `<div class="barra-h"><span title="${esc(i.t)}">${esc(i.t)}</span><div class="trilho"><i style="width:${i.v / max * 100}%"></i></div><b>${fmt(i.v)}</b></div>`).join('')}</div>`; };
  const anos = () => [...new Set(S.lista('movimentos').map(m => m.data.slice(0, 4)))].sort().reverse();
  const seletorAno = (comMes) => `<div class="barra-filtros"><select id="rAno" aria-label="Ano">${anos().map(a => `<option ${a === estado.ano ? 'selected' : ''}>${a}</option>`).join('')}</select>
    ${comMes ? `<select id="rMes" aria-label="Mês"><option value="">Ano inteiro</option>${Array.from({ length: 12 }, (_, i) => `<option value="${String(i + 1).padStart(2, '0')}" ${estado.mes === String(i + 1).padStart(2, '0') ? 'selected' : ''}>${U.cap(U.nomeMes(i + 1))}</option>`).join('')}</select>` : ''}
    <button type="button" class="btn sec" data-x="excel">${UI.ic('baixar')}<span>Excel</span></button><button type="button" class="btn sec" data-x="pdf">${UI.ic('imprimir')}<span>PDF</span></button></div>`;
  let exportavel = null; // {titulo, sub, colunas, linhas, totais}

  // ---------------------------------------------------------------- estoque
  function rEstoque() {
    const pecas = S.lista('pecas').filter(p => p.estoque > 0);
    const val = new Map(pecas.map(p => [p.id, C.valorPeca(p.id)]));
    const total = U.soma([...val.values()], x => x);
    const porForn = U.agrupar(pecas, p => S.get('fornecedores', p.fornecedor_id)?.nome || 'Sem fornecedor');
    const porUtil = U.agrupar(pecas, p => p.utilizacao || 'Sem utilização');
    const soma = (l) => U.soma(l, p => val.get(p.id));
    const de12 = U.somaMeses(U.hoje(), -12);
    const comSaida = new Set(C.consumos(m => m.data >= de12).filter(x => x.qtd > 0).map(x => x.mov.peca_id));
    const parado = pecas.filter(p => !comSaida.has(p.id)).sort((a, b) => val.get(b.id) - val.get(a.id));
    const valParado = soma(parado);
    const linhas = U.ordenar(pecas, p => -val.get(p.id)).map(p => [p.codigo, p.descricao, p.utilizacao || '', U.qtd(p.estoque), U.moeda(val.get(p.id) / p.estoque), U.moeda(val.get(p.id))]);
    exportavel = { titulo: 'Estoque atual', sub: `Valor pelo custo de cada nota (PEPS) em ${U.data(U.hoje())}`, colunas: [{ t: 'Código', w: 40, mono: true }, { t: 'Descrição' }, { t: 'Utilização', w: 32 }, { t: 'Qtd', w: 14, alinhar: 'right' }, { t: 'Custo médio', w: 24, alinhar: 'right' }, { t: 'Valor', w: 26, alinhar: 'right' }], linhas, totais: ['', '', '', '', 'Total', U.moeda(total)] };
    return `<div class="grade g3"><div class="kpi"><small>Valor em estoque</small><b>${U.moeda0(total)}</b><span>${U.plural(pecas.length, 'item', 'itens')} com saldo</span></div>
        <div class="kpi ${valParado > total * .3 ? 'alerta' : ''}"><small>Dinheiro parado</small><b>${U.moeda0(valParado)}</b><span>${U.plural(parado.length, 'item', 'itens')} sem saída há 12 meses</span></div>
        <div class="kpi"><small>Abaixo do mínimo</small><b>${C.listaCompras().length}</b><span><a href="#/compras/lista">ver lista de compras</a></span></div></div>
      ${seletorAno(false).replace(/<select id="rAno"[\s\S]*?<\/select>/, '')}
      <div class="grade g2 mt"><section class="card"><h2>Por fornecedor</h2><div class="mt">${barras([...porForn.entries()].map(([t, l]) => ({ t, v: soma(l) })).sort((a, b) => b.v - a.v).slice(0, 12))}</div></section>
        <section class="card"><h2>Por máquina / utilização</h2><div class="mt">${barras([...porUtil.entries()].map(([t, l]) => ({ t, v: soma(l) })).sort((a, b) => b.v - a.v).slice(0, 12))}</div></section></div>
      ${parado.length ? `<section class="card mt"><div class="card-cab"><h2>Dinheiro parado</h2><span class="sub">tem estoque e ninguém retirou nos últimos 12 meses</span></div>
        <div class="lista">${parado.slice(0, 20).map(p => `<a class="linha" href="#/peca/${p.id}"><div class="meio"><b><span class="codigo">${esc(p.codigo)}</span> · ${esc(p.descricao)}</b><small>${U.qtd(p.estoque)} ${esc(p.unidade)} · ${esc(p.utilizacao || '')}</small></div><div class="lado"><b>${U.moeda(val.get(p.id))}</b></div></a>`).join('')}</div>
        <p class="sub mt">Talvez valha reduzir o estoque máximo destas peças ou parar de comprar.</p></section>` : ''}`;
  }

  // ---------------------------------------------------------------- consumo (aba "Consumo Anual")
  function rConsumo() {
    const pref = estado.ano + (estado.mes ? '-' + estado.mes : '');
    const cs = C.consumos(m => m.data.startsWith(pref));
    const porPeca = U.agrupar(cs, x => x.mov.peca_id);
    const lin = [...porPeca.entries()].map(([pid, l]) => ({ p: S.get('pecas', pid) || {}, q: U.soma(l, 'qtd'), v: U.soma(l, 'valor'), pmax: Math.max(...l.map(x => x.mov.preco_unit)) })).filter(x => x.q !== 0).sort((a, b) => b.v - a.v);
    const total = U.soma(lin, 'v');
    const meses = Array.from({ length: 12 }, (_, i) => { const mm = String(i + 1).padStart(2, '0'); return { t: U.cap(U.nomeMes(i + 1)).slice(0, 3), v: U.soma(C.consumos(m => m.data.startsWith(estado.ano + '-' + mm)), 'valor') }; });
    const porUtil = U.agrupar(cs, x => S.get('maquinas', x.mov.maquina_id)?.nome || S.get('pecas', x.mov.peca_id)?.utilizacao || 'Sem máquina');
    const anoAnt = String(Number(estado.ano) - 1);
    const ateHoje = estado.ano === U.hoje().slice(0, 4) ? U.hoje().slice(5) : '12-31';
    const totAnt = U.soma(C.consumos(m => m.data.startsWith(anoAnt) && m.data.slice(5) <= ateHoje), 'valor');
    const totAte = U.soma(C.consumos(m => m.data.startsWith(estado.ano) && m.data.slice(5) <= ateHoje), 'valor');
    exportavel = { titulo: 'Consumo ' + (estado.mes ? U.nomeMes(Number(estado.mes)) + '/' : '') + estado.ano, sub: 'Retiradas do almoxarifado (desconta as desfeitas)',
      colunas: [{ t: 'Código', w: 46, mono: true }, { t: 'Descrição' }, { t: 'Quantidade', w: 22, alinhar: 'right' }, { t: 'Preço unit. (máx)', w: 30, alinhar: 'right' }, { t: 'Total', w: 28, alinhar: 'right' }],
      linhas: lin.map(x => [x.p.codigo, x.p.descricao, U.qtd(x.q), U.moeda(x.pmax), U.moeda(x.v)]), totais: ['Total geral', '', U.qtd(U.soma(lin, 'q')), '', U.moeda(total)] };
    const varia = totAnt ? totAte / totAnt - 1 : null;
    return `${seletorAno(true)}
      <div class="grade g3"><div class="kpi"><small>Consumo no período</small><b>${U.moeda0(total)}</b><span>${U.plural(lin.length, 'item', 'itens')} diferentes</span></div>
        <div class="kpi"><small>${estado.ano} até ${U.data(estado.ano + '-' + ateHoje).slice(0, 5)}</small><b>${U.moeda0(totAte)}</b>${varia !== null ? `<span style="color:var(--${varia > 0 ? 'vermelho' : 'verde'})">${varia > 0 ? '+' : '−'}${U.pct(Math.abs(varia))} contra ${anoAnt}</span>` : '<span>&nbsp;</span>'}</div>
        <div class="kpi"><small>Média por mês</small><b>${U.moeda0(totAte / Math.max(1, Number(ateHoje.slice(0, 2))))}</b></div></div>
      <div class="grade g2 mt"><section class="card"><h2>Mês a mês em ${estado.ano}</h2><div class="mt">${barras(meses)}</div></section>
        <section class="card"><h2>Por máquina</h2><div class="mt">${barras([...porUtil.entries()].map(([t, l]) => ({ t, v: U.soma(l, 'valor') })).sort((a, b) => b.v - a.v).slice(0, 12))}</div></section></div>
      <section class="card mt"><div class="tabela-caixa"><table class="tabela cartoes"><thead><tr><th>Código</th><th>Descrição</th><th class="num">Quantidade</th><th class="num">Preço unit. (máx)</th><th class="num">Total</th></tr></thead>
        <tbody>${lin.map(x => `<tr class="clicavel" data-peca="${x.p.id}"><td data-r="Código" class="titulo mono">${esc(x.p.codigo)}</td><td data-r="Descrição">${esc(x.p.descricao)}</td><td data-r="Quantidade" class="num">${U.qtd(x.q)}</td><td data-r="Preço" class="num">${U.moeda(x.pmax)}</td><td data-r="Total" class="num">${U.moeda(x.v)}</td></tr>`).join('') || '<tr><td colspan="5">Nada no período.</td></tr>'}</tbody>
        <tfoot><tr><td colspan="2">Total geral</td><td class="num">${U.qtd(U.soma(lin, 'q'))}</td><td></td><td class="num">${U.moeda(total)}</td></tr></tfoot></table></div></section>`;
  }

  // ---------------------------------------------------------------- compras (aba "Análise Anual de Custos")
  function rCompras() {
    const ents = S.lista('movimentos').filter(m => m.tipo === 'entrada' && (m.motivo === 'compra' || m.motivo === 'importado') && m.data.startsWith(estado.ano + (estado.mes ? '-' + estado.mes : '')));
    const porForn = U.agrupar(ents, m => m.fornecedor_id || '');
    const grupos = [...porForn.entries()].map(([fid, l]) => ({ f: S.get('fornecedores', fid), l, v: U.soma(l, m => m.qtd * m.preco_unit), q: U.soma(l, 'qtd') })).sort((a, b) => b.v - a.v);
    const total = U.soma(grupos, 'v');
    // maiores aumentos de preço (último preço do ano x primeira compra do ano anterior em diante)
    const aum = [];
    for (const p of S.lista('pecas')) {
      const e = S.lista('movimentos').filter(m => m.peca_id === p.id && m.tipo === 'entrada' && m.preco_unit > 0 && (m.motivo === 'compra' || m.motivo === 'importado'));
      const ant = e.filter(m => m.data.startsWith(String(Number(estado.ano) - 1))), at = e.filter(m => m.data.startsWith(estado.ano));
      if (ant.length && at.length) { const a = ant[ant.length - 1].preco_unit, b = at[at.length - 1].preco_unit; aum.push({ p, a, b, v: b / a - 1 }); }
    }
    aum.sort((x, y) => y.v - x.v);
    exportavel = { titulo: 'Análise de custos de aquisição ' + estado.ano, sub: 'Compras (entradas) por fornecedor', colunas: [{ t: 'Código', w: 48, mono: true }, { t: 'Descrição' }, { t: 'Qtd', w: 16, alinhar: 'right' }, { t: 'Preço médio', w: 26, alinhar: 'right' }, { t: 'Custo total', w: 28, alinhar: 'right' }], linhas: [],
      grupos: grupos.map(g => { const pp = U.agrupar(g.l, m => m.peca_id); return { titulo: (g.f?.nome || 'Sem fornecedor') + ' — ' + U.moeda(g.v),
        linhas: [...pp.entries()].map(([pid, l]) => { const q = U.soma(l, 'qtd'), v = U.soma(l, m => m.qtd * m.preco_unit), p = S.get('pecas', pid) || {}; return [p.codigo, p.descricao, U.qtd(q), U.moeda(v / q), U.moeda(v)]; }) }; }) };
    return `${seletorAno(true)}
      <div class="grade g3"><div class="kpi"><small>Comprado no período</small><b>${U.moeda0(total)}</b><span>${U.plural(ents.length, 'entrada')}</span></div>
        <div class="kpi"><small>Fornecedores</small><b>${grupos.length}</b></div><div class="kpi"><small>Maior fornecedor</small><b style="font-size:1.1rem">${esc(grupos[0]?.f?.nome || '—')}</b><span>${grupos[0] ? U.pct(grupos[0].v / total) + ' do total' : ''}</span></div></div>
      <div class="grade g2 mt"><section class="card"><h2>Por fornecedor</h2><div class="mt">${barras(grupos.slice(0, 12).map(g => ({ t: g.f?.nome || 'Sem fornecedor', v: g.v })))}</div></section>
        <section class="card"><h2>Preço que mais subiu</h2><p class="sub">Último preço de ${estado.ano} × último de ${Number(estado.ano) - 1}</p>
          ${aum.length ? `<div class="lista mt">${aum.slice(0, 8).map(x => `<a class="linha" href="#/peca/${x.p.id}"><div class="meio"><b><span class="codigo">${esc(x.p.codigo)}</span></b><small>${U.moeda(x.a)} → ${U.moeda(x.b)}</small></div><div class="lado"><b style="color:var(--${x.v > 0 ? 'vermelho' : 'verde'})">${x.v > 0 ? '+' : '−'}${U.pct(Math.abs(x.v))}</b></div></a>`).join('')}</div>` : '<p class="sub mt">Sem compras nos dois anos para comparar.</p>'}</section></div>
      ${grupos.map(g => { const pp = U.agrupar(g.l, m => m.peca_id); return `<section class="card mt"><div class="card-cab"><h2>${esc(g.f?.nome || 'Sem fornecedor')}</h2><b>${U.moeda(g.v)}</b></div>
        <div class="tabela-caixa"><table class="tabela cartoes"><thead><tr><th>Código</th><th class="num">Custo total</th><th class="num">Qtd</th><th class="num">Preço médio</th><th>Utilização</th></tr></thead><tbody>
        ${[...pp.entries()].map(([pid, l]) => { const q = U.soma(l, 'qtd'), v = U.soma(l, m => m.qtd * m.preco_unit), p = S.get('pecas', pid) || {};
          return `<tr class="clicavel" data-peca="${pid}"><td data-r="Código" class="titulo mono">${esc(p.codigo)}</td><td data-r="Custo" class="num">${U.moeda(v)}</td><td data-r="Qtd" class="num">${U.qtd(q)}</td><td data-r="Preço médio" class="num">${U.moeda(v / q)}</td><td data-r="Utilização" class="peq">${esc(p.utilizacao || '')}</td></tr>`; }).join('')}</tbody></table></div></section>`; }).join('')}`;
  }

  // ---------------------------------------------------------------- por máquina
  function rMaquinas() {
    const de = estado.ano + '-01-01', ate = estado.ano + '-12-31';
    const lin = S.lista('maquinas').map(m => {
      const pecas = U.soma(C.consumos(x => x.maquina_id === m.id && x.data >= de && x.data <= ate), 'valor');
      const mans = S.lista('manutencoes').filter(x => x.maquina_id === m.id && x.data >= de && x.data <= ate);
      return { m, pecas, serv: U.soma(mans, 'custo_servico'), horas: U.soma(mans, 'horas_parada'), probs: mans.filter(x => x.tipo === 'corretiva').length };
    }).filter(x => x.pecas || x.serv || x.horas || x.probs).sort((a, b) => (b.pecas + b.serv) - (a.pecas + a.serv));
    const semMaq = U.soma(C.consumos(x => !x.maquina_id && x.data >= de && x.data <= ate), 'valor');
    exportavel = { titulo: 'Custo por máquina ' + estado.ano, sub: 'Peças retiradas para a máquina + serviços de manutenção', colunas: [{ t: 'Máquina' }, { t: 'Peças', w: 28, alinhar: 'right' }, { t: 'Serviços', w: 28, alinhar: 'right' }, { t: 'Total', w: 28, alinhar: 'right' }, { t: 'Problemas', w: 20, alinhar: 'right' }, { t: 'Horas paradas', w: 26, alinhar: 'right' }],
      linhas: lin.map(x => [x.m.nome, U.moeda(x.pecas), U.moeda(x.serv), U.moeda(x.pecas + x.serv), x.probs, U.qtd(x.horas)]) };
    return `${seletorAno(false)}
      ${semMaq > 0 ? `<p class="nota">${U.moeda0(semMaq)} em retiradas sem máquina informada (inclui o histórico da planilha, que não tinha esse campo). Ao retirar peça, escolha a máquina para este relatório ficar completo.</p>` : ''}
      <section class="card mt">${lin.length ? barras(lin.slice(0, 15).map(x => ({ t: x.m.nome, v: x.pecas + x.serv }))) : '<p class="sub">Nada registrado neste ano.</p>'}</section>
      ${lin.length ? `<section class="card mt"><div class="tabela-caixa"><table class="tabela cartoes"><thead><tr><th>Máquina</th><th class="num">Peças</th><th class="num">Serviços</th><th class="num">Total</th><th class="num">Problemas</th><th class="num">Horas paradas</th></tr></thead>
        <tbody>${lin.map(x => `<tr class="clicavel" data-maq="${x.m.id}"><td data-r="Máquina" class="titulo">${esc(x.m.nome)}</td><td data-r="Peças" class="num">${U.moeda(x.pecas)}</td><td data-r="Serviços" class="num">${U.moeda(x.serv)}</td><td data-r="Total" class="num"><b>${U.moeda(x.pecas + x.serv)}</b></td><td data-r="Problemas" class="num">${x.probs}</td><td data-r="Horas paradas" class="num">${U.qtd(x.horas)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
  }

  // ---------------------------------------------------------------- fornecedores
  function rFornecedores() {
    const lin = S.lista('fornecedores').map(f => {
      const ents = S.lista('movimentos').filter(m => m.fornecedor_id === f.id && m.tipo === 'entrada' && (m.motivo === 'compra' || m.motivo === 'importado') && m.data.startsWith(estado.ano));
      return { f, v: U.soma(ents, m => m.qtd * m.preco_unit), n: new Set(ents.map(m => m.documento)).size, pont: Telas.fornecedores.pontualidade(f.id) };
    }).filter(x => x.v || x.pont).sort((a, b) => b.v - a.v);
    exportavel = { titulo: 'Fornecedores ' + estado.ano, sub: 'Total comprado e entrega no prazo', colunas: [{ t: 'Fornecedor' }, { t: 'Comprado', w: 30, alinhar: 'right' }, { t: 'Notas', w: 18, alinhar: 'right' }, { t: 'No prazo', w: 24, alinhar: 'right' }],
      linhas: lin.map(x => [x.f.nome, U.moeda(x.v), x.n, x.pont ? U.pct(x.pont.pct) + ` (${x.pont.n})` : '—']) };
    return `${seletorAno(false)}
      <section class="card"><div class="tabela-caixa"><table class="tabela cartoes"><thead><tr><th>Fornecedor</th><th class="num">Comprado em ${estado.ano}</th><th class="num">Notas</th><th class="num">Entrega no prazo</th></tr></thead>
        <tbody>${lin.map(x => `<tr class="clicavel" data-forn="${x.f.id}"><td data-r="Fornecedor" class="titulo">${esc(x.f.nome)}</td><td data-r="Comprado" class="num">${U.moeda(x.v)}</td><td data-r="Notas" class="num">${x.n}</td>
          <td data-r="No prazo" class="num">${x.pont ? `<b style="color:var(--${x.pont.pct >= .8 ? 'verde' : x.pont.pct >= .5 ? 'amarelo' : 'vermelho'})">${U.pct(x.pont.pct)}</b> <span class="fraco">(${x.pont.n})</span>` : '—'}</td></tr>`).join('') || '<tr><td colspan="4">Nada no ano.</td></tr>'}</tbody></table></div>
      <p class="sub mt">A pontualidade só conta pedidos recebidos pelo sistema com prazo combinado (o histórico da planilha não tinha a data real de chegada).</p></section>`;
  }

  // ---------------------------------------------------------------- financeiro
  function rFinanceiro() {
    if (!Perm.pode('financeiro')) return UI.vazio('cadeado', 'Só Dono e Escritório veem o financeiro');
    const L = S.lista('lancamentos').filter(l => l.pago_em && l.pago_em.startsWith(estado.ano));
    const meses = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    const cats = (tipo) => { const g = U.agrupar(L.filter(l => l.tipo === tipo), l => l.categoria || 'Sem categoria');
      return [...g.entries()].map(([c, l]) => ({ c, m: meses.map(mm => U.soma(l.filter(x => x.pago_em.slice(5, 7) === mm), 'valor_pago')), t: U.soma(l, 'valor_pago') })).sort((a, b) => b.t - a.t); };
    const rec = cats('receber'), desp = cats('pagar');
    const totM = (lst) => meses.map((_, i) => U.soma(lst, x => x.m[i]));
    const tr = totM(rec), td = totM(desp);
    const ultimo = estado.ano === U.hoje().slice(0, 4) ? Number(U.hoje().slice(5, 7)) : 12;
    const ms = meses.slice(0, ultimo);
    const cab = `<tr><th>Categoria</th>${ms.map(m => `<th class="num">${U.cap(U.nomeMes(Number(m))).slice(0, 3)}</th>`).join('')}<th class="num">Total</th></tr>`;
    const lin = (x) => `<tr><td>${esc(x.c)}</td>${ms.map((_, i) => `<td class="num">${x.m[i] ? U.moeda0(x.m[i]) : '—'}</td>`).join('')}<td class="num"><b>${U.moeda0(x.t)}</b></td></tr>`;
    exportavel = { titulo: 'Receitas e despesas ' + estado.ano, sub: 'Pelo que foi efetivamente pago e recebido', deitado: true,
      colunas: [{ t: 'Categoria' }, ...ms.map(m => ({ t: U.cap(U.nomeMes(Number(m))).slice(0, 3), alinhar: 'right' })), { t: 'Total', alinhar: 'right' }],
      linhas: [...rec.map(x => ['(+) ' + x.c, ...ms.map((_, i) => U.moeda0(x.m[i])), U.moeda0(x.t)]), ...desp.map(x => ['(−) ' + x.c, ...ms.map((_, i) => U.moeda0(x.m[i])), U.moeda0(x.t)])],
      totais: ['Resultado', ...ms.map((_, i) => U.moeda0(tr[i] - td[i])), U.moeda0(U.soma(tr, x => x) - U.soma(td, x => x))] };
    return `${seletorAno(false).replace(/<select id="rAno"[\s\S]*?<\/select>/, `<select id="rAno">${[...new Set(S.lista('lancamentos').filter(l => l.pago_em).map(l => l.pago_em.slice(0, 4)).concat(U.hoje().slice(0, 4)))].sort().reverse().map(a => `<option ${a === estado.ano ? 'selected' : ''}>${a}</option>`).join('')}</select>`)}
      <div class="grade g3"><div class="kpi"><small>Recebido em ${estado.ano}</small><b>${U.moeda0(U.soma(tr, x => x))}</b></div><div class="kpi"><small>Pago em ${estado.ano}</small><b>${U.moeda0(U.soma(td, x => x))}</b></div>
        <div class="kpi ${U.soma(tr, x => x) - U.soma(td, x => x) < 0 ? 'alerta' : 'bom'}"><small>Resultado de caixa</small><b>${U.moeda0(U.soma(tr, x => x) - U.soma(td, x => x))}</b></div></div>
      <section class="card mt"><h2>Receitas</h2><div class="tabela-caixa mt"><table class="tabela">${cab}${rec.map(lin).join('') || `<tr><td colspan="${ms.length + 2}">Nada recebido.</td></tr>`}</table></div></section>
      <section class="card mt"><h2>Despesas</h2><div class="tabela-caixa mt"><table class="tabela">${cab}${desp.map(lin).join('') || `<tr><td colspan="${ms.length + 2}">Nada pago.</td></tr>`}</table></div></section>
      <section class="card mt"><h2>Resultado mês a mês</h2><div class="tabela-caixa mt"><table class="tabela"><tr><th></th>${ms.map(m => `<th class="num">${U.cap(U.nomeMes(Number(m))).slice(0, 3)}</th>`).join('')}</tr>
        <tr><td>Resultado</td>${ms.map((_, i) => { const v = tr[i] - td[i]; return `<td class="num" style="color:var(--${v < 0 ? 'vermelho' : 'verde'});font-weight:700">${U.moeda0(v)}</td>`; }).join('')}</tr></table></div>
        <p class="sub mt">Conta pelo dia em que foi pago/recebido (regime de caixa).</p></section>`;
  }

  const FN = { estoque: rEstoque, consumo: rConsumo, compras: rCompras, maquinas: rMaquinas, fornecedores: rFornecedores, financeiro: rFinanceiro };

  function render(r) {
    if (r.q.get('r') && FN[r.q.get('r')]) estado.r = r.q.get('r');
    const abas = ABAS.filter(([k]) => k !== 'financeiro' || Perm.pode('financeiro')).filter(([k]) => k !== 'fornecedores' || Perm.pode('compras'));
    if (!abas.some(([k]) => k === estado.r)) estado.r = 'estoque';
    let corpo;
    try { corpo = FN[estado.r](); } catch (e) { console.error(e); corpo = UI.vazio('alerta', 'Não deu para montar este relatório', esc(e.message)); }
    return `${UI.cab('Relatórios', 'Os mesmos da planilha, e outros novos')}
      <nav class="abas-tela">${abas.map(([k, t]) => `<button type="button" data-aba="${k}" class="${k === estado.r ? 'on' : ''}">${t}</button>`).join('')}</nav>${corpo}`;
  }

  function depois(el) {
    el.addEventListener('change', (e) => {
      if (e.target.id === 'rAno') { estado.ano = e.target.value; App.render(); }
      if (e.target.id === 'rMes') { estado.mes = e.target.value; App.render(); }
    });
    el.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-aba]'); if (a) { estado.r = a.dataset.aba; history.replaceState(null, '', '#/relatorios?r=' + estado.r); App.render(); return; }
      const p = e.target.closest('[data-peca]'); if (p) { location.hash = '#/peca/' + p.dataset.peca; return; }
      const m = e.target.closest('[data-maq]'); if (m) { location.hash = '#/maquina/' + m.dataset.maq; return; }
      const f = e.target.closest('[data-forn]'); if (f) { location.hash = '#/fornecedor/' + f.dataset.forn; return; }
      const x = e.target.closest('[data-x]'); if (!x || !exportavel) return;
      const ex = exportavel;
      UI.ocupado(x, async () => {
        if (x.dataset.x === 'pdf') return PDF.entregar(await PDF.tabela(ex.titulo, ex.sub, ex.colunas, ex.linhas, { totais: ex.totais, grupos: ex.grupos, deitado: ex.deitado }), `${ex.titulo}.pdf`);
        await U.lib('xlsx');
        const wb = XLSX.utils.book_new();
        const rows = ex.grupos ? ex.grupos.flatMap(g => [[g.titulo], ...g.linhas, []]) : ex.linhas;
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([ex.colunas.map(c => c.t), ...rows, ...(ex.totais ? [ex.totais] : [])]), 'Relatório');
        await PDF.entregar(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${ex.titulo}.xlsx`);
      });
    });
  }

  return { titulo: 'Relatórios', perm: 'relatorios', render, depois };
})();
