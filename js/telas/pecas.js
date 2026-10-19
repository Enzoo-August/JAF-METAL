/* Estoque: lista de peças, ficha da peça, cadastro e contagem */
'use strict';

Telas.pecas = (() => {
  const esc = U.esc;
  const estado = { busca: '', f: 'todas', util: '', forn: '' };

  function filtrar() {
    let l = S.lista('pecas');
    if (estado.f === 'inativas') l = l.filter(p => !p.ativo);
    else {
      l = l.filter(p => p.ativo);
      if (estado.f !== 'todas') l = l.filter(p => C.situacao(p).cod === estado.f);
    }
    if (estado.util) l = l.filter(p => U.sem(p.utilizacao || '').includes(U.sem(estado.util)));
    if (estado.forn) l = l.filter(p => p.fornecedor_id === estado.forn);
    if (estado.busca.trim()) l = U.buscar(l, estado.busca, p => [p.codigo, p.descricao, p.utilizacao || '', p.local || '']);
    else l = U.ordenar(l, p => U.sem(p.codigo));
    return l;
  }

  function medidor(p) {
    const ma = Number(p.est_max) || 0, mi = Number(p.est_min) || 0, e = Math.max(0, Number(p.estoque) || 0);
    const topo = Math.max(ma, mi * 2, e, 1);
    const sit = C.situacao(p);
    return `<div class="medidor ${sit.cor}" title="mín ${U.qtd(mi)} · máx ${U.qtd(ma)}"><i style="width:${Math.min(100, e / topo * 100)}%"></i>${mi > 0 ? `<u style="left:${mi / topo * 100}%"></u>` : ''}</div>`;
  }

  function linha(p) {
    const sit = C.situacao(p);
    const pend = Perm.pode('compras') ? C.pendente(p.id) : 0;
    return `<a class="linha" href="#/peca/${p.id}">
      <div class="meio"><b><span class="codigo">${esc(p.codigo)}</span> · ${esc(p.descricao)}</b>
        <small>${esc(p.utilizacao || '—')}${p.local ? ' · ' + esc(p.local) : ''}${pend ? ` · <span class="fraco">${U.qtd(pend)} a caminho</span>` : ''}</small></div>
      <div class="lado"><b>${U.qtd(p.estoque)} <small>${esc(p.unidade)}</small></b>${medidor(p)}</div>
      <div class="lado esconde-celular" style="width:104px">${UI.tag(sit)}</div></a>`;
  }

  // ---------------------------------------------------------------- lista
  function renderLista(r) {
    if (r.q.get('f')) estado.f = r.q.get('f');
    const todas = S.lista('pecas').filter(p => p.ativo);
    const cont = (c) => todas.filter(p => C.situacao(p).cod === c).length;
    const utils = [...new Set(todas.map(p => p.utilizacao).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const forns = Perm.pode('compras') ? U.ordenar(S.lista('fornecedores').filter(f => todas.some(p => p.fornecedor_id === f.id)), f => U.sem(f.nome)) : [];
    const acoes = [
      Perm.pode('pecas_editar') ? UI.btn('Nova peça', 'data-acao2="nova"', 'pri', 'mais') : '',
      Perm.pode('entrada') ? UI.btn('Contar estoque', 'data-acao2="contagem"', 'sec', 'contar') : '',
      Perm.pode('precos') ? UI.btn('Excel', 'data-acao2="excel"', 'sec', 'baixar') : '',
    ].join('');
    const sub = `${U.plural(todas.length, 'peça')} ativas${Perm.pode('precos') ? ' · ' + U.moeda0(C.valorEstoque()) + ' em estoque' : ''}`;
    return `${UI.cab('Estoque', sub, acoes)}
      <div class="barra-filtros">
        <div class="busca-lista">${UI.ic('busca')}<input type="search" id="buscaPecas" placeholder="Código, descrição, máquina ou prateleira" value="${esc(estado.busca)}" autocomplete="off"></div>
        <select id="fUtil" aria-label="Máquina / utilização"><option value="">Todas as máquinas</option>${utils.map(u => `<option ${u === estado.util ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>
        ${forns.length ? `<select id="fForn" aria-label="Fornecedor"><option value="">Todos os fornecedores</option>${forns.map(f => `<option value="${f.id}" ${f.id === estado.forn ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}</select>` : ''}
      </div>
      ${UI.chips([{ v: 'todas', t: 'Todas' }, { v: 'comprar', t: 'Comprar', n: cont('comprar') }, { v: 'minimo', t: 'No mínimo', n: cont('minimo') },
        { v: 'alto', t: 'Estoque alto', n: cont('alto') }, { v: 'zerado', t: 'Sem estoque', n: cont('zerado') },
        { v: 'inativas', t: 'Desativadas', n: S.lista('pecas').length - todas.length }], estado.f)}
      <p class="sub mt" id="contPecas"></p>
      <div class="lista"><div data-pagina></div><button type="button" class="mais-btn" data-mais hidden><span></span></button></div>`;
  }

  function desenharLista(el) {
    const l = filtrar();
    el.querySelector('#contPecas').textContent = U.plural(l.length, 'peça') + (estado.busca || estado.util || estado.forn || estado.f !== 'todas' ? ' no filtro' : '');
    if (!l.length) { el.querySelector('[data-pagina]').innerHTML = UI.vazio('estoque', 'Nenhuma peça aqui', 'Mude o filtro ou a busca.'); el.querySelector('[data-mais]').hidden = true; return; }
    UI.paginar(el, l, linha, 80);
  }

  function depoisLista(el) {
    desenharLista(el);
    const b = el.querySelector('#buscaPecas');
    b.addEventListener('input', U.debounce(() => { estado.busca = b.value; desenharLista(el); }, 120));
    el.querySelector('#fUtil').onchange = (e) => { estado.util = e.target.value; desenharLista(el); };
    const ff = el.querySelector('#fForn'); if (ff) ff.onchange = (e) => { estado.forn = e.target.value; desenharLista(el); };
    el.querySelector('.chips').addEventListener('click', (e) => {
      const c = e.target.closest('[data-f]'); if (!c) return;
      estado.f = c.dataset.f; el.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c)); desenharLista(el);
    });
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-acao2]')?.dataset.acao2;
      if (a === 'nova') form();
      else if (a === 'contagem') contagem();
      else if (a === 'excel') exportar();
    });
    // filtros não contam como "formulário mexido"
    delete el.dataset.sujo;
    el.addEventListener('input', () => delete el.dataset.sujo);
    el.addEventListener('change', () => delete el.dataset.sujo);
  }

  // ---------------------------------------------------------------- ficha
  function renderFicha(id) {
    const p = S.get('pecas', id);
    if (!p) return UI.vazio('estoque', 'Peça não encontrada', '', '<a class="btn pri" href="#/pecas">Voltar ao estoque</a>');
    const sit = C.situacao(p), precos = Perm.pode('precos');
    const f = S.get('fornecedores', p.fornecedor_id);
    const lotes = precos ? C.lotes(p.id) : [];
    const abertos = Perm.pode('compras') ? C.pedidosAbertosDaPeca(p.id) : [];
    const cons12 = C.consumoPeca(p.id, 12);
    const dur = C.duracao(p);
    const ult = precos ? C.ultimaEntrada(p.id) : null;
    const sug = C.sugestao(p);
    const acoes = [
      UI.btn('Retirar', 'data-f="retirar"', 'pri', 'retirar'),
      Perm.pode('entrada') ? UI.btn('Entrada', 'data-f="entrada"', 'sec', 'entrada') : '',
      Perm.pode('entrada') ? UI.btn('Contar', 'data-f="contar"', 'sec', 'contar') : '',
      Perm.pode('compras') ? UI.btn('Pedir', 'data-f="pedir"', 'sec', 'compras') : '',
      Perm.pode('pecas_editar') ? UI.btn('Editar', 'data-f="editar"', 'fantasma', 'lapis') : '',
    ].join('');

    // consumo por mês (12 meses)
    const meses = [];
    for (let i = 11; i >= 0; i--) { const ini = U.somaMeses(U.hoje().slice(0, 8) + '01', -i); meses.push({ ini, fim: U.somaDias(U.somaMeses(ini, 1), -1), q: 0 }); }
    for (const c of C.consumos(m => m.peca_id === p.id && m.data >= meses[0].ini)) { const m = meses.find(x => c.mov.data >= x.ini && c.mov.data <= x.fim); if (m) m.q += c.qtd; }
    const maxQ = Math.max(1, ...meses.map(m => m.q));

    const movs = S.lista('movimentos').filter(m => m.peca_id === p.id).slice().reverse();
    return `${UI.voltar('#/pecas', 'Estoque')}
      <header class="cab"><div><p class="codigo mono" style="margin:0 0 4px;color:var(--texto-2)">${esc(p.codigo)}</p><h1>${esc(p.descricao)}</h1>
        <p class="sub">${esc(p.utilizacao || 'Sem utilização definida')}${f ? ' · ' + esc(f.nome) : ''}</p></div><div class="acoes">${acoes}</div></header>
      <div class="grade g3">
        <section class="card"><small class="fraco">NO ESTOQUE</small><div class="estoque-grande">${U.qtd(p.estoque)}<small>${esc(p.unidade)}</small></div>
          <div style="margin-top:10px">${UI.tag(sit)} ${medidor(p)}</div>
          <p class="sub mt">Mínimo <b>${U.qtd(p.est_min)}</b> · Máximo <b>${U.qtd(p.est_max)}</b>${p.local ? ` · Local <b>${esc(p.local)}</b>` : ''}</p>
          ${sit.cod === 'comprar' && Perm.pode('compras') ? `<p class="nota ${sug.pendente ? '' : 'vermelha'}">${sug.pendente ? `Já tem ${U.qtd(sug.pendente)} a caminho.` : 'Abaixo do mínimo.'} ${sug.sugerido ? `Sugestão: comprar <b>${U.qtd(sug.sugerido)}</b> para chegar ao máximo.` : ''}</p>` : ''}
        </section>
        <section class="card"><small class="fraco">CONSUMO (12 MESES)</small><div class="estoque-grande">${U.qtd(cons12)}<small>${esc(p.unidade)}</small></div>
          <p class="sub mt">Média de <b>${U.qtd(Math.round(cons12 / 12 * 10) / 10)}</b> por mês${dur !== null ? ` · o estoque atual dura <b>${dur < 1 ? 'menos de 1 mês' : dur > 24 ? 'mais de 2 anos' : '≈ ' + U.qtd(Math.round(dur * 10) / 10) + ' meses'}</b>` : ''}</p>
          <div class="mini-barras" aria-label="Consumo por mês">${meses.map(m => `<i title="${U.mes(m.ini)}: ${U.qtd(m.q)}" style="height:${Math.max(2, m.q / maxQ * 100)}%"></i>`).join('')}</div>
          <div class="mini-rot"><span>${U.mes(meses[0].ini)}</span><span>${U.mes(meses[11].ini)}</span></div>
        </section>
        ${precos ? `<section class="card"><small class="fraco">VALOR</small><div class="estoque-grande">${U.moeda(C.valorPeca(p.id))}</div>
          <p class="sub mt">${ult ? `Último preço: <b>${U.moeda(ult.preco_unit)}</b> em ${U.data(ult.data)}${S.get('fornecedores', ult.fornecedor_id) ? ' (' + esc(S.get('fornecedores', ult.fornecedor_id).nome) + ')' : ''}` : 'Sem entrada com preço.'}</p>
          ${this.variacao(p.id)}</section>` : ''}
      </div>
      ${lotes.length ? `<section class="card mt"><div class="card-cab"><h2>Na prateleira, por nota</h2><span class="sub">a próxima retirada sai do lote mais antigo</span></div>
        <div class="tabela-caixa"><table class="tabela cartoes"><thead><tr><th>Entrada</th><th>Documento</th><th class="num">Restam</th><th class="num">Preço</th><th class="num">Valor</th></tr></thead>
        <tbody>${lotes.map(l => `<tr><td data-r="Entrada" class="titulo">${U.data(l.mov.data)}</td><td data-r="Documento">${esc(l.mov.documento || '—')}</td><td data-r="Restam" class="num">${U.qtd(l.resta)}</td><td data-r="Preço" class="num">${U.moeda(l.mov.preco_unit)}</td><td data-r="Valor" class="num">${U.moeda(l.valor)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
      ${abertos.length ? `<section class="card mt"><div class="card-cab"><h2>Pedidos a caminho</h2></div><div class="lista">${abertos.map(({ ped, item }) => `
        <a class="linha" href="#/pedido/${ped.id}"><div class="meio"><b>Pedido nº ${ped.numero} · ${esc(S.get('fornecedores', ped.fornecedor_id)?.nome || '')}</b><small>${U.qtd(item.qtd - item.recebido)} de ${U.qtd(item.qtd)} faltando chegar</small></div>
        <div class="lado">${UI.tag(C.situacaoPedido(ped))}<small>${ped.prazo ? U.relativo(ped.prazo) : ''}</small></div></a>`).join('')}</div></section>` : ''}
      ${p.obs ? `<section class="card mt"><h2>Observações</h2><p class="mt">${esc(p.obs)}</p></section>` : ''}
      <section class="card mt"><div class="card-cab"><h2>Movimentações</h2><span class="sub">${U.plural(movs.length, 'lançamento')}</span></div>
        ${movs.length ? `<div class="lista"><div data-pagina></div><button type="button" class="mais-btn" data-mais hidden><span></span></button></div>` : '<p class="sub">Nenhuma movimentação.</p>'}</section>`;
  }

  // como o preço mudou (primeira compra x última)
  function variacao(pecaId) {
    const ents = S.lista('movimentos').filter(m => m.peca_id === pecaId && m.tipo === 'entrada' && m.preco_unit > 0 && m.motivo !== 'estorno' && m.motivo !== 'ajuste');
    if (ents.length < 2) return '';
    const a = ents[0], b = ents[ents.length - 1];
    const v = b.preco_unit / a.preco_unit - 1;
    if (Math.abs(v) < 0.01) return `<p class="sub">Preço estável desde ${U.data(a.data)}.</p>`;
    return `<p class="sub">Desde ${U.data(a.data)} o preço ${v > 0 ? 'subiu' : 'caiu'} <b style="color:var(--${v > 0 ? 'vermelho' : 'verde'})">${U.pct(Math.abs(v))}</b> (${U.moeda(a.preco_unit)} → ${U.moeda(b.preco_unit)}).</p>`;
  }

  function depoisFicha(el, r) {
    const p = S.get('pecas', r.id); if (!p) return;
    const movs = S.lista('movimentos').filter(m => m.peca_id === p.id).slice().reverse();
    if (movs.length) UI.paginar(el, movs, (m) => Telas.movimentos.linha(m, false), 30);
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-f]')?.dataset.f;
      if (a === 'retirar') Telas.movimentos.retirar(p);
      else if (a === 'entrada') Telas.movimentos.entrada(p);
      else if (a === 'contar') contarUma(p);
      else if (a === 'pedir') Telas.compras.form({ itens: [{ peca: p, qtd: C.sugestao(p).sugerido || null }], fornecedor_id: p.fornecedor_id });
      else if (a === 'editar') form(p);
      const m = e.target.closest('[data-mov]'); if (m) Telas.movimentos.detalhe(m.dataset.mov);
    });
  }

  // ---------------------------------------------------------------- cadastro
  async function form(p) {
    const novo = !p;
    p = p || { unidade: 'un', est_min: 0, est_max: 0, ativo: true };
    const utils = [...new Set([...S.lista('pecas').map(x => x.utilizacao), ...S.lista('maquinas').map(m => m.nome)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const id = await UI.modal({
      titulo: novo ? 'Nova peça' : 'Editar peça',
      corpo: `
        <div class="linha-campos l2">
          ${UI.campo({ nome: 'codigo', rotulo: 'Código', valor: p.codigo, req: true, ajuda: 'O código do fabricante ou o seu.' })}
          ${UI.campo({ nome: 'unidade', rotulo: 'Unidade', valor: p.unidade, tipo: 'select', opcoes: ['un', 'pç', 'par', 'jogo', 'kit', 'm', 'kg', 'l', 'cx', 'rolo'].map(v => ({ v, t: v })) })}
        </div>
        ${UI.campo({ nome: 'descricao', rotulo: 'Descrição', valor: p.descricao, req: true })}
        ${UI.campo({ nome: 'utilizacao', rotulo: 'Onde é usada (máquina / dispositivo)', valor: p.utilizacao, attrs: 'list="listaUtil"' })}
        <datalist id="listaUtil">${utils.map(u => `<option value="${esc(u)}">`).join('')}</datalist>
        ${Perm.pode('compras') ? `<div class="campo"><label>Fornecedor de costume</label><input name="fornecedor_id" id="cForn" placeholder="Digite para buscar"></div>` : ''}
        <div class="linha-campos l3">
          ${UI.campo({ nome: 'est_min', rotulo: 'Estoque mínimo', tipo: 'qtd', valor: U.campoNum(p.est_min, 3), ajuda: 'Abaixo disso: comprar' })}
          ${UI.campo({ nome: 'est_max', rotulo: 'Estoque máximo', tipo: 'qtd', valor: U.campoNum(p.est_max, 3), ajuda: 'Compra completa até aqui' })}
          ${UI.campo({ nome: 'local', rotulo: 'Prateleira / local', valor: p.local, placeholder: 'Ex.: A3' })}
        </div>
        ${UI.campo({ nome: 'obs', rotulo: 'Observações', tipo: 'area', valor: p.obs, linhas: 2 })}
        ${novo ? '' : UI.campo({ nome: 'ativo', rotulo: 'Peça ativa (desmarque para esconder sem apagar o histórico)', tipo: 'check', valor: p.ativo })}`,
      aoAbrir: (el) => { const i = el.querySelector('#cForn'); if (i) UI.comboFornecedor(i, { valorInicial: S.get('fornecedores', p.fornecedor_id) }); },
      botoes: [{ txt: novo ? 'Cadastrar' : 'Salvar', acao: async (f) => {
        const d = UI.lerForm(f);
        if (!Perm.pode('compras')) d.fornecedor_id = p.fornecedor_id || null;
        if (novo) d.ativo = true;
        const r = await API.rpc('salvar_peca', { p: { ...d, id: p.id } });
        await App.gravou(['pecas']);
        UI.aviso(novo ? 'Peça cadastrada.' : 'Peça salva.');
        return r;
      } }],
    });
    if (id && novo) location.hash = '#/peca/' + id;
    return id;
  }

  // ---------------------------------------------------------------- contagem
  async function contarUma(p) {
    await UI.modal({
      titulo: 'Contar estoque — ' + p.codigo,
      corpo: `<p class="sub">${esc(p.descricao)}</p>
        <p>No sistema: <b>${U.qtd(p.estoque)} ${esc(p.unidade)}</b>. Conte o que tem na prateleira e digite abaixo.</p>
        ${UI.campo({ nome: 'contado', rotulo: 'Quantidade contada', tipo: 'qtd', req: true, attrs: 'autofocus' })}
        <p class="sub" id="difC"></p>
        ${UI.campo({ nome: 'obs', rotulo: 'Motivo (opcional)', placeholder: 'Ex.: contagem mensal, peça quebrada…' })}`,
      aoAbrir: (el) => {
        const i = el.querySelector('[name=contado]'), out = el.querySelector('#difC');
        i.addEventListener('input', () => { const n = U.num(i.value); if (n === null) { out.textContent = ''; return; }
          const d = n - p.estoque; out.innerHTML = d === 0 ? 'Bate com o sistema. Nada muda.' : `O sistema vai lançar um ajuste de <b>${d > 0 ? '+' : ''}${U.qtd(d)}</b>.`; });
      },
      botoes: [{ txt: 'Salvar contagem', acao: async (f) => {
        const d = UI.lerForm(f);
        if (d.contado === null || d.contado < 0) throw new API.ErroApp('Digite a quantidade contada (zero ou mais).');
        const r = await API.rpc('contar_estoque', { p_peca: p.id, p_contado: d.contado, p_obs: d.obs || null });
        await App.gravou(['pecas', 'movimentos']);
        UI.aviso(Number(r.diferenca) === 0 ? 'Contagem confere com o sistema.' : `Ajuste de ${Number(r.diferenca) > 0 ? '+' : ''}${U.qtd(r.diferenca)} lançado.`);
      } }],
    });
  }

  // contagem de várias peças de uma vez (inventário)
  async function contagem() {
    const utils = [...new Set(S.lista('pecas').filter(p => p.ativo).map(p => p.utilizacao).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    await UI.modal({
      titulo: 'Contar estoque (inventário)', largura: 'larga',
      corpo: `<p class="sub">Digite só o que você contou. Campos em branco não mudam nada. No fim, o sistema lança os ajustes das diferenças.</p>
        <div class="barra-filtros"><div class="busca-lista">${UI.ic('busca')}<input type="search" id="bInv" placeholder="Filtrar por código ou descrição"></div>
        <select id="uInv"><option value="">Todas as máquinas</option>${utils.map(u => `<option>${esc(u)}</option>`).join('')}</select></div>
        <div class="tabela-caixa" style="max-height:52vh;overflow:auto"><table class="tabela"><thead><tr><th>Código</th><th class="esconde-celular">Descrição</th><th class="num">Sistema</th><th class="num" style="width:120px">Contado</th><th class="num">Diferença</th></tr></thead>
        <tbody id="tInv">${U.ordenar(S.lista('pecas').filter(p => p.ativo), p => U.sem(p.codigo)).map(p => `<tr data-id="${p.id}" data-busca="${esc(U.sem(p.codigo + ' ' + p.descricao))}" data-util="${esc(p.utilizacao || '')}">
          <td class="mono">${esc(p.codigo)}<div class="peq so-celular" style="display:block!important">${esc(p.descricao)}</div></td><td class="esconde-celular peq">${esc(p.descricao)}</td>
          <td class="num">${U.qtd(p.estoque)}</td><td class="num"><input class="inv" inputmode="decimal" data-num="qtd" aria-label="Contado ${esc(p.codigo)}" style="width:100%;min-height:36px;text-align:right;border:1px solid var(--borda-forte);border-radius:6px;padding:4px 8px;font:inherit;background:var(--cartao);color:var(--texto)"></td>
          <td class="num dif"></td></tr>`).join('')}</tbody></table></div>
        <p class="mt" id="resInv">Nenhuma peça contada ainda.</p>`,
      aoAbrir: (el) => {
        const filtrarInv = () => { const t = U.sem(el.querySelector('#bInv').value.trim()), u = el.querySelector('#uInv').value;
          el.querySelectorAll('#tInv tr').forEach(tr => { tr.hidden = (t && !tr.dataset.busca.includes(t)) || (u && tr.dataset.util !== u); }); };
        el.querySelector('#bInv').addEventListener('input', filtrarInv);
        el.querySelector('#uInv').addEventListener('change', filtrarInv);
        el.querySelector('#tInv').addEventListener('input', (e) => {
          const tr = e.target.closest('tr'); const p = S.get('pecas', tr.dataset.id); const n = U.num(e.target.value);
          const td = tr.querySelector('.dif'); const d = n === null ? null : n - p.estoque;
          td.textContent = d === null ? '' : (d > 0 ? '+' : '') + U.qtd(d); td.style.color = d ? (d > 0 ? 'var(--verde)' : 'var(--vermelho)') : '';
          const cont = [...el.querySelectorAll('.inv')].filter(i => U.num(i.value) !== null);
          const difs = cont.filter(i => U.num(i.value) !== S.get('pecas', i.closest('tr').dataset.id).estoque);
          el.querySelector('#resInv').innerHTML = `${U.plural(cont.length, 'peça contada', 'peças contadas')} · <b>${U.plural(difs.length, 'diferença')}</b> para ajustar`;
        });
      },
      botoes: [{ txt: 'Lançar ajustes', validar: false, acao: async (f, j) => {
        const itens = [...f.querySelectorAll('.inv')].map(i => ({ id: i.closest('tr').dataset.id, n: U.num(i.value) })).filter(x => x.n !== null);
        if (itens.some(x => x.n < 0)) throw new API.ErroApp('Há quantidade negativa. Corrija antes de lançar.');
        const difs = itens.filter(x => x.n !== S.get('pecas', x.id).estoque);
        if (!difs.length) { UI.aviso(itens.length ? 'Tudo confere. Nenhum ajuste necessário.' : 'Nenhuma peça foi contada.'); return; }
        if (!(await UI.confirmar(`Lançar ${U.plural(difs.length, 'ajuste')} de estoque?`, { ok: 'Lançar ajustes' }))) return false;
        let ok = 0; const erros = [];
        for (const x of difs) {
          try { await API.rpc('contar_estoque', { p_peca: x.id, p_contado: x.n, p_obs: 'Inventário' }); ok++;
            const tr = f.querySelector(`tr[data-id="${x.id}"]`); tr.querySelector('.inv').value = ''; tr.querySelector('.dif').textContent = '✓'; }
          catch (e) { erros.push(S.get('pecas', x.id).codigo + ': ' + API.traduzir(e).message); }
          j.erro(`Lançando… ${ok} de ${difs.length}`);
        }
        await App.gravou(['pecas', 'movimentos']);
        if (erros.length) { j.erro(`${ok} ajustes lançados. Não deu certo em ${erros.length}: ${erros.join(' | ')}`); delete f.dataset.sujo; return false; }
        UI.aviso(`${U.plural(ok, 'ajuste')} lançado${ok > 1 ? 's' : ''}.`);
      } }],
    });
  }

  // ---------------------------------------------------------------- Excel
  async function exportar() {
    await U.lib('xlsx');
    const linhas = U.ordenar(S.lista('pecas'), p => U.sem(p.codigo)).map(p => ({
      'Código': p.codigo, 'Descrição': p.descricao, 'Utilização': p.utilizacao || '', 'Fornecedor': S.get('fornecedores', p.fornecedor_id)?.nome || '',
      'Estoque Min.': p.est_min, 'Estoque Máx.': p.est_max, 'Qde Estoque': p.estoque, 'Unidade': p.unidade, 'Status': C.situacao(p).txt,
      'Valor (R$)': U.r2(C.valorPeca(p.id)), 'A caminho': C.pendente(p.id), 'Local': p.local || '', 'Ativa': p.ativo ? 'sim' : 'não' }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'Estoque');
    const blob = new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await PDF.entregar(blob, `Estoque JAF ${U.hoje()}.xlsx`);
  }

  return {
    titulo: (r) => r.nome === 'peca' ? (S.get('pecas', r.id)?.codigo || 'Peça') : 'Estoque',
    render(r) { return r.nome === 'peca' ? renderFicha.call({ variacao }, r.id) : renderLista(r); },
    depois(el, r) { if (r.nome === 'peca') depoisFicha(el, r); else depoisLista(el); },
    form, contarUma, linha,
  };
})();
