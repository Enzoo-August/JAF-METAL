/* Compras: pedidos de compra, recebimento e lista de compras */
'use strict';

Telas.compras = (() => {
  const esc = U.esc;
  const estado = { f: 'aberto', busca: '', minimo: false };

  // ---------------------------------------------------------------- lista de pedidos
  function filtrar(f) {
    let l = S.lista('pedidos_compra');
    const sit = (p) => C.situacaoPedido(p).cod;
    if (f === 'aberto') l = l.filter(p => p.status === 'aguardando');
    else if (f === 'atrasado') l = l.filter(p => sit(p) === 'atrasado');
    else if (f === 'hoje') l = l.filter(p => sit(p) === 'hoje');
    else if (f === 'recebido') l = l.filter(p => p.status === 'recebido');
    else if (f === 'cancelado') l = l.filter(p => p.status === 'cancelado');
    else if (f === 'semconta') l = l.filter(p => p.status === 'recebido' && p.obs !== 'Importado da planilha' && !S.lista('lancamentos').some(x => x.pedido_id === p.id) && C.totalPedido(p) > 0);
    if (estado.busca.trim()) {
      const t = U.sem(estado.busca.trim()).split(' ');
      l = l.filter(p => { const txt = U.sem([p.numero, S.get('fornecedores', p.fornecedor_id)?.nome, p.documento, p.obs,
        ...C.itensDoPedido(p.id).map(i => { const pc = S.get('pecas', i.peca_id); return pc ? pc.codigo + ' ' + pc.descricao : ''; })].join(' '));
        return t.every(x => txt.includes(x)); });
    }
    return l.slice().sort((a, b) => f === 'aberto' || f === 'atrasado' || f === 'hoje' ? ((a.prazo || '9') < (b.prazo || '9') ? -1 : 1) : (b.numero - a.numero));
  }

  function linhaPedido(p) {
    const f = S.get('fornecedores', p.fornecedor_id), itens = C.itensDoPedido(p.id);
    const nomes = itens.map(i => S.get('pecas', i.peca_id)?.codigo).filter(Boolean);
    return `<a class="linha" href="#/pedido/${p.id}">
      <div class="meio"><b>Nº ${p.numero} · ${esc(f?.nome || '—')}</b>
        <small>${esc(nomes.slice(0, 4).join(', '))}${nomes.length > 4 ? ` +${nomes.length - 4}` : ''} · pedido em ${U.dataCurta(p.data)}${p.prazo ? ' · entrega ' + U.dataCurta(p.prazo) : ''}</small></div>
      <div class="lado"><b>${U.moeda(C.totalPedido(p))}</b>${UI.tag(C.situacaoPedido(p))}</div></a>`;
  }

  function renderLista(r) {
    if (r.q.get('f')) estado.f = r.q.get('f');
    const n = (f) => filtrar(f).length;
    const lc = C.listaCompras().filter(x => !x.jaPedido).length;
    const chips = [{ v: 'aberto', t: 'Em aberto', n: n('aberto') }, { v: 'atrasado', t: 'Atrasados', n: n('atrasado') }, { v: 'hoje', t: 'Chegam hoje', n: n('hoje') },
      { v: 'recebido', t: 'Recebidos' }, { v: 'cancelado', t: 'Cancelados' }, { v: 'todos', t: 'Todos' }];
    if (Perm.pode('financeiro')) chips.push({ v: 'semconta', t: 'Sem conta lançada', n: n('semconta') || null });
    return `${UI.cab('Pedidos de compra', 'O que foi pedido aos fornecedores e o que já chegou',
        UI.btn('Novo pedido', 'data-c="novo"', 'pri', 'mais') + `<a class="btn sec" href="#/compras/lista">${UI.ic('lista')}<span>Lista de compras${lc ? ` (${lc})` : ''}</span></a>`)}
      <div class="barra-filtros"><div class="busca-lista">${UI.ic('busca')}<input type="search" id="bPed" placeholder="Número, fornecedor, peça ou documento" value="${esc(estado.busca)}"></div></div>
      ${UI.chips(chips, estado.f)}
      <p class="sub mt" id="resPed"></p>
      <div class="lista"><div data-pagina></div><button type="button" class="mais-btn" data-mais hidden><span></span></button></div>`;
  }
  function desenharLista(el) {
    const l = filtrar(estado.f);
    el.querySelector('#resPed').textContent = `${U.plural(l.length, 'pedido')} · ${U.moeda(U.soma(l, p => C.totalPedido(p)))}`;
    if (!l.length) { el.querySelector('[data-pagina]').innerHTML = UI.vazio('compras', estado.f === 'aberto' ? 'Nenhum pedido aguardando' : 'Nenhum pedido aqui', 'Use a Lista de compras para ver o que está faltando.'); el.querySelector('[data-mais]').hidden = true; return; }
    UI.paginar(el, l, linhaPedido, 50);
  }
  function depoisLista(el) {
    desenharLista(el);
    el.querySelector('#bPed').addEventListener('input', U.debounce((e) => { estado.busca = e.target.value; desenharLista(el); }, 150));
    el.addEventListener('click', (e) => {
      const c = e.target.closest('[data-f]'); if (c) { estado.f = c.dataset.f; el.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c)); desenharLista(el); return; }
      if (e.target.closest('[data-c="novo"]')) form({});
    });
    el.addEventListener('input', () => delete el.dataset.sujo);
  }

  // ---------------------------------------------------------------- ficha do pedido
  function renderPedido(id) {
    const p = S.get('pedidos_compra', id);
    if (!p) return UI.vazio('compras', 'Pedido não encontrado', '', '<a class="btn pri" href="#/compras">Voltar aos pedidos</a>');
    const f = S.get('fornecedores', p.fornecedor_id) || {}, itens = C.itensDoPedido(p.id), sit = C.situacaoPedido(p);
    const aberto = p.status === 'aguardando';
    const pendente = itens.some(i => i.recebido < i.qtd);
    const recebeu = itens.some(i => i.recebido > 0);
    const movs = S.lista('movimentos').filter(m => itens.some(i => i.id === m.pedido_item_id)).sort((a, b) => b.seq - a.seq);
    const contas = Perm.pode('financeiro') ? S.lista('lancamentos').filter(l => l.pedido_id === p.id) : [];
    const acoes = [
      aberto ? UI.btn('Receber', 'data-p="receber"', 'pri', 'entrada') : '',
      UI.btn('PDF', 'data-p="pdf"', 'sec', 'imprimir'),
      UI.btn('Enviar', 'data-p="enviar"', 'sec', 'whatsapp'),
      aberto ? UI.btn('Editar', 'data-p="editar"', 'sec', 'lapis') : '',
      UI.btn('Duplicar', 'data-p="duplicar"', 'fantasma', 'copiar'),
      aberto ? UI.btn(recebeu ? 'Encerrar' : 'Cancelar', 'data-p="cancelar"', 'fantasma', 'x') : '',
      !aberto && pendente ? UI.btn('Reabrir', 'data-p="reabrir"', 'fantasma', 'desfazer') : '',
    ].join('');
    const atraso = aberto && p.prazo && p.prazo < U.hoje() ? U.dias(p.prazo, U.hoje()) : 0;
    return `${UI.voltar('#/compras', 'Pedidos de compra')}
      <header class="cab"><div><h1>Pedido nº ${p.numero} ${UI.tag(sit)}</h1>
        <p class="sub"><a href="#/fornecedor/${f.id}">${esc(f.nome || '')}</a> · pedido em ${U.data(p.data)}${p.prazo ? ` · entrega combinada ${U.data(p.prazo)}` : ''}${p.recebido_em ? ` · recebido em ${U.data(p.recebido_em)}` : ''}</p></div>
        <div class="acoes">${acoes}</div></header>
      ${atraso ? `<p class="nota vermelha">Atrasado há ${U.plural(atraso, 'dia')}. ${f.celular || f.telefone ? `Ligue ou mande mensagem para ${esc(f.contato || f.nome)}: ${esc(U.tel(f.celular || f.telefone))}.` : ''}</p>` : ''}
      <section class="card mt"><div class="tabela-caixa"><table class="tabela cartoes">
        <thead><tr><th>Código</th><th>Descrição</th><th class="num">Pedido</th><th class="num">Chegou</th><th class="num">Falta</th><th class="num">Preço</th><th class="num">Total</th></tr></thead>
        <tbody>${itens.map(i => { const pc = S.get('pecas', i.peca_id) || {}; const falta = Math.max(0, i.qtd - i.recebido);
          return `<tr><td data-r="Código" class="titulo mono"><a href="#/peca/${pc.id}">${esc(pc.codigo || '')}</a></td><td data-r="Descrição">${esc(pc.descricao || '')}</td>
          <td data-r="Pedido" class="num">${U.qtd(i.qtd)}</td><td data-r="Chegou" class="num">${U.qtd(i.recebido)}</td>
          <td data-r="Falta" class="num" style="${falta && p.status !== 'cancelado' ? 'color:var(--vermelho);font-weight:700' : ''}">${U.qtd(falta)}</td>
          <td data-r="Preço" class="num">${U.moeda(i.valor / i.qtd)}</td><td data-r="Total" class="num">${U.moeda(i.valor)}</td></tr>`; }).join('')}</tbody>
        <tfoot>${p.frete ? `<tr><td colspan="6" class="dir">Frete</td><td class="num">${U.moeda(p.frete)}</td></tr>` : ''}<tr><td colspan="6" class="dir">Total do pedido</td><td class="num">${U.moeda(C.totalPedido(p))}</td></tr></tfoot>
      </table></div>
      ${UI.dl([['Documento / referência', esc(p.documento || '')], ['Observações', esc(p.obs || '').replace(/\n/g, '<br>')], ['Lançado por', esc(S.nomeUsuario(p.criado_por) || '')]])}</section>
      ${movs.length ? `<section class="card mt"><div class="card-cab"><h2>Recebimentos</h2></div><div class="lista">${movs.map(m => Telas.movimentos.linha(m, false)).join('')}</div></section>` : ''}
      ${Perm.pode('financeiro') ? `<section class="card mt"><div class="card-cab"><h2>Contas a pagar deste pedido</h2>${UI.btn('Lançar conta', 'data-p="conta"', 'sec mini', 'mais')}</div>
        ${contas.length ? `<div class="lista">${contas.map(l => Telas.financeiro.linha(l)).join('')}</div>` : `<p class="sub">${p.status === 'recebido' ? 'Nenhuma conta lançada para este pedido.' : 'A conta pode ser lançada ao receber.'}</p>`}</section>` : ''}`;
  }

  function depoisPedido(el, r) {
    const p = S.get('pedidos_compra', r.id); if (!p) return;
    U.lib('jspdf').catch(() => {}); // já deixa o gerador de PDF pronto (no iPhone o compartilhar precisa ser rápido)
    el.addEventListener('click', async (e) => {
      const m = e.target.closest('[data-mov]'); if (m) return Telas.movimentos.detalhe(m.dataset.mov);
      const l = e.target.closest('[data-conta]'); if (l) return Telas.financeiro.abrir(l.dataset.conta);
      const b = e.target.closest('[data-p]'); if (!b) return;
      const a = b.dataset.p;
      if (a === 'receber') receber(p);
      else if (a === 'editar') form({ pedido: p });
      else if (a === 'duplicar') form({ fornecedor_id: p.fornecedor_id, itens: C.itensDoPedido(p.id).map(i => ({ peca: S.get('pecas', i.peca_id), qtd: i.qtd, preco: i.valor / i.qtd })) });
      else if (a === 'pdf') UI.ocupado(b, async () => PDF.entregar(await PDF.pedido(p), `Pedido de compra ${p.numero} - ${S.get('fornecedores', p.fornecedor_id)?.nome || ''}.pdf`));
      else if (a === 'enviar') enviar(p);
      else if (a === 'cancelar') cancelar(p);
      else if (a === 'reabrir') UI.ocupado(b, async () => { try { await API.rpc('reabrir_pedido', { p_id: p.id }); await App.gravou(['pedidos_compra']); UI.aviso('Pedido reaberto.'); } catch (err) { UI.erro(err); } });
      else if (a === 'conta') Telas.financeiro.form({ tipo: 'pagar', descricao: 'Compra - pedido nº ' + p.numero, categoria: 'Compras / almoxarifado', valor: C.totalPedido(p), fornecedor_id: p.fornecedor_id, pedido_id: p.id, documento: p.documento });
    });
  }

  async function cancelar(p) {
    const recebeu = C.itensDoPedido(p.id).some(i => i.recebido > 0);
    await UI.modal({
      titulo: recebeu ? `Encerrar o pedido nº ${p.numero}` : `Cancelar o pedido nº ${p.numero}`,
      corpo: `<p>${recebeu ? 'Parte do pedido já chegou. Encerrar fecha o pedido com o que chegou; o resto deixa de ser esperado.' : 'O pedido fica marcado como cancelado (não é apagado).'}</p>
        ${UI.campo({ nome: 'motivo', rotulo: 'Motivo (opcional)', placeholder: 'Ex.: fornecedor sem estoque' })}`,
      botoes: [{ txt: recebeu ? 'Encerrar pedido' : 'Cancelar pedido', cls: 'perigo', acao: async (f) => {
        await API.rpc('cancelar_pedido', { p_id: p.id, p_motivo: UI.lerForm(f).motivo || null });
        await App.gravou(['pedidos_compra']);
        UI.aviso(recebeu ? 'Pedido encerrado.' : 'Pedido cancelado.');
      } }],
      fecharTxt: 'Voltar',
    });
  }

  // texto para WhatsApp / e-mail
  function textoPedido(p) {
    const f = S.get('fornecedores', p.fornecedor_id) || {}, emp = S.cfg('empresa', {});
    const itens = C.itensDoPedido(p.id);
    return `Olá${f.contato ? ', ' + f.contato.split(' ')[0] : ''}! Segue o pedido de compra nº ${p.numero} da ${emp.nome || 'JAF Metal'}:\n\n` +
      itens.map(i => { const pc = S.get('pecas', i.peca_id) || {}; return `• ${U.qtd(i.qtd)} ${pc.unidade || 'un'} — ${pc.codigo} (${pc.descricao})${i.valor ? ' — ' + U.moeda(i.valor / i.qtd) + ' cada' : ''}`; }).join('\n') +
      `\n\nTotal: ${U.moeda(C.totalPedido(p))}${p.prazo ? `\nEntrega combinada: ${U.data(p.prazo)}` : ''}${p.documento ? `\nReferência: ${p.documento}` : ''}\n\nPor favor, confirme o recebimento e informe o nº ${p.numero} na nota fiscal. Obrigado!`;
  }
  async function enviar(p) {
    const f = S.get('fornecedores', p.fornecedor_id) || {};
    const txt = textoPedido(p);
    const zap = U.telZap(U.ehCelular(f.celular) ? f.celular : (U.ehCelular(f.telefone) ? f.telefone : f.celular || ''));
    await UI.modal({
      titulo: 'Enviar pedido ao fornecedor',
      corpo: `<p class="sub">O PDF é o jeito mais completo. Se preferir, mande o texto abaixo.</p>
        <div class="grupo-btn">
          <button type="button" class="btn pri" data-e="pdf">${UI.ic('imprimir')}<span>PDF do pedido</span></button>
          ${zap ? `<a class="btn sec" target="_blank" rel="noopener" href="https://wa.me/${zap}?text=${encodeURIComponent(txt)}">${UI.ic('whatsapp')}<span>WhatsApp</span></a>` : ''}
          ${f.email ? `<a class="btn sec" href="mailto:${esc(f.email)}?subject=${encodeURIComponent('Pedido de compra nº ' + p.numero)}&body=${encodeURIComponent(txt)}">${UI.ic('email')}<span>E-mail</span></a>` : ''}
          <button type="button" class="btn sec" data-e="copiar">${UI.ic('copiar')}<span>Copiar texto</span></button>
        </div>
        ${!zap && !f.email ? '<p class="nota amarela mt">Cadastre o celular ou o e-mail do fornecedor para enviar direto.</p>' : ''}
        <pre class="texto-pre mt">${esc(txt)}</pre>`,
      aoAbrir: (el) => el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-e]'); if (!b) return;
        if (b.dataset.e === 'copiar') UI.aviso((await U.copiar(txt)) ? 'Texto copiado.' : 'Não deu para copiar.');
        else UI.ocupado(b, async () => PDF.entregar(await PDF.pedido(p), `Pedido de compra ${p.numero} - ${f.nome || ''}.pdf`));
      }),
    });
  }

  // ---------------------------------------------------------------- formulário (novo / editar)
  // opt: {pedido} para editar; {fornecedor_id, itens:[{peca, qtd, preco}]} para novo já preenchido
  async function form(opt = {}) {
    const ed = opt.pedido;
    const itensIni = ed ? C.itensDoPedido(ed.id).map(i => ({ id: i.id, peca: S.get('pecas', i.peca_id), qtd: i.qtd, preco: i.valor / i.qtd, recebido: i.recebido }))
      : (opt.itens || []);
    const r = await UI.modal({
      titulo: ed ? `Editar pedido nº ${ed.numero}` : 'Novo pedido de compra', largura: 'larga',
      corpo: `
        <div class="linha-campos">
          <div class="campo" style="grid-column: span 2"><label for="pForn">Fornecedor <i class="req">*</i></label><input id="pForn" name="fornecedor_id" required placeholder="Digite para buscar"></div>
          ${UI.campo({ nome: 'data', rotulo: 'Data do pedido', tipo: 'date', valor: ed?.data || U.hoje() })}
        </div>
        <div class="linha-campos">
          ${UI.campo({ nome: 'documento', rotulo: 'Proposta / referência', valor: ed?.documento, placeholder: 'Ex.: Proposta 51850, WhatsApp, pedido online…' })}
          <div class="campo"><label for="pPrazo">Entrega combinada</label><input id="pPrazo" name="prazo" type="date" value="${esc(ed?.prazo || '')}">
            <div class="grupo-btn" style="margin-top:6px">${[3, 7, 15, 30].map(d => `<button type="button" class="btn fantasma mini" data-prazo="${d}">+${d} dias</button>`).join('')}</div></div>
        </div>
        <h3 class="mt">Peças</h3>
        <div class="itens-ped" id="pItens"></div>
        <div class="grupo-btn"><button type="button" class="btn sec mini" data-add>${UI.ic('mais')}<span>Adicionar peça</span></button>
          <button type="button" class="btn fantasma mini" data-sug hidden>${UI.ic('lista')}<span>Pôr o que está faltando deste fornecedor</span></button></div>
        <div class="linha-campos mt">
          ${UI.campo({ nome: 'frete', rotulo: 'Frete', tipo: 'dinheiro', valor: U.campoNum(ed?.frete) })}
          ${UI.campo({ nome: 'obs', rotulo: 'Observações', valor: ed?.obs && ed.obs !== 'Importado da planilha' ? ed.obs : '' })}
        </div>
        <div class="total-linha"><span>Total do pedido</span><b id="pTotal">R$ 0,00</b></div>`,
      aoAbrir: (el) => {
        const box = el.querySelector('#pItens');
        const fornIn = el.querySelector('#pForn');
        UI.comboFornecedor(fornIn, { valorInicial: S.get('fornecedores', ed?.fornecedor_id || opt.fornecedor_id), aoEscolher: () => mostrarSug() });
        const total = () => {
          let t = U.num(el.querySelector('[name=frete]').value) || 0;
          box.querySelectorAll('.item-ped').forEach(row => { const q = U.num(row.querySelector('[name=iqtd]').value) || 0, v = U.num(row.querySelector('[name=ipreco]').value) || 0;
            row.querySelector('.itot').textContent = q && v ? '= ' + U.moeda(q * v) : ''; t += q * v; });
          el.querySelector('#pTotal').textContent = U.moeda(t);
        };
        const addLinha = (it = {}) => {
          const row = document.createElement('div');
          row.className = 'item-ped';
          row.dataset.item = it.id || '';
          row.innerHTML = `<div class="campo"><label>Peça</label><input name="ipeca" placeholder="Código ou nome" ${it.recebido > 0 ? 'readonly' : ''}></div>
            <div class="campo"><label>Qtd</label><input name="iqtd" inputmode="decimal" data-num="qtd" value="${it.qtd ? U.campoNum(it.qtd, 3) : ''}"></div>
            <div class="campo"><label>Preço unit.</label><div class="prefixo"><span>R$</span><input name="ipreco" inputmode="decimal" data-num="dinheiro" value="${it.preco ? U.campoNum(it.preco, 4).replace(/(,\d\d)0+$/, '$1') : ''}"></div></div>
            <button type="button" class="icone-btn" data-del aria-label="Tirar a peça" ${it.recebido > 0 ? 'disabled title="Já chegou: não dá para tirar"' : ''}>${UI.ic('lixo')}</button>
            <div class="info"><span class="iinfo"></span> <b class="itot"></b></div>`;
          box.appendChild(row);
          const inp = row.querySelector('[name=ipeca]');
          const info = () => { const p = S.get('pecas', inp.dataset.comboId); const s = p ? C.sugestao(p) : null;
            row.querySelector('.iinfo').textContent = p ? `Estoque ${U.qtd(p.estoque)} · mín ${U.qtd(p.est_min)} · máx ${U.qtd(p.est_max)}${s.pendente ? ' · ' + U.qtd(s.pendente) + ' já a caminho' : ''}${it.recebido > 0 ? ' · já chegaram ' + U.qtd(it.recebido) : ''}` : ''; };
          UI.comboPeca(inp, { valorInicial: it.peca, aoEscolher: (p) => {
            const fid = fornIn.dataset.comboId;
            const u = C.ultimaEntrada(p.id, fid) || C.ultimaEntrada(p.id);
            const pr = row.querySelector('[name=ipreco]'); if (!pr.value && u) pr.value = U.campoNum(u.preco_unit, 4).replace(/(,\d\d)0+$/, '$1');
            const q = row.querySelector('[name=iqtd]'); if (!q.value) { const s = C.sugestao(p).sugerido; if (s) q.value = U.campoNum(s, 3); }
            info(); total(); setTimeout(() => q.focus(), 30);
          } });
          info();
          return row;
        };
        const mostrarSug = () => {
          const fid = fornIn.dataset.comboId;
          const n = fid ? C.listaCompras().filter(x => !x.jaPedido && x.peca.fornecedor_id === fid).length : 0;
          const b = el.querySelector('[data-sug]'); b.hidden = !n; b.querySelector('span').textContent = `Pôr o que está faltando deste fornecedor (${n})`;
        };
        if (itensIni.length) itensIni.forEach(addLinha); else addLinha();
        total(); mostrarSug();
        el.addEventListener('input', total);
        el.addEventListener('click', (e) => {
          if (e.target.closest('[data-add]')) { const r = addLinha(); r.querySelector('[name=ipeca]').focus(); }
          const d = e.target.closest('[data-del]'); if (d && !d.disabled) { d.closest('.item-ped').remove(); if (!box.children.length) addLinha(); total(); }
          const pz = e.target.closest('[data-prazo]'); if (pz) { el.querySelector('#pPrazo').value = U.somaDias(el.querySelector('[name=data]').value || U.hoje(), Number(pz.dataset.prazo)); }
          if (e.target.closest('[data-sug]')) {
            const fid = fornIn.dataset.comboId;
            const ja = new Set([...box.querySelectorAll('[name=ipeca]')].map(i => i.dataset.comboId).filter(Boolean));
            [...box.querySelectorAll('.item-ped')].forEach(rw => { if (!rw.querySelector('[name=ipeca]').dataset.comboId) rw.remove(); });
            for (const x of C.listaCompras().filter(x => !x.jaPedido && x.peca.fornecedor_id === fid && !ja.has(x.peca.id))) {
              const u = C.ultimaEntrada(x.peca.id, fid) || C.ultimaEntrada(x.peca.id);
              addLinha({ peca: x.peca, qtd: x.sugerido, preco: u?.preco_unit });
            }
            total();
          }
        });
      },
      botoes: [{ txt: ed ? 'Salvar pedido' : 'Criar pedido', acao: async (f) => {
        const d = UI.lerForm(f);
        const itens = [...f.querySelectorAll('.item-ped')].map(rw => ({ id: rw.dataset.item || null, peca_id: rw.querySelector('[name=ipeca]').dataset.comboId,
          qtd: U.num(rw.querySelector('[name=iqtd]').value), preco: U.num(rw.querySelector('[name=ipreco]').value), txt: rw.querySelector('[name=ipeca]').value }));
        const bad = itens.find(i => (i.txt && !i.peca_id));
        if (bad) throw new API.ErroApp(`A peça “${bad.txt}” não foi encontrada. Escolha da lista ou cadastre a peça antes.`);
        const validos = itens.filter(i => i.peca_id);
        if (!validos.length) throw new API.ErroApp('Coloque pelo menos uma peça.');
        const semQtd = validos.find(i => !(i.qtd > 0)); if (semQtd) throw new API.ErroApp(`Informe a quantidade de ${S.get('pecas', semQtd.peca_id).codigo}.`);
        const rep = validos.find((i, n) => validos.findIndex(x => x.peca_id === i.peca_id) !== n);
        if (rep) throw new API.ErroApp(`A peça ${S.get('pecas', rep.peca_id).codigo} está duas vezes. Junte numa linha só.`);
        if (!f.dataset.envio) f.dataset.envio = ed?.id || U.uuid();
        const res = await API.rpc('salvar_pedido', { p: { id: f.dataset.envio, data: d.data, fornecedor_id: d.fornecedor_id, documento: d.documento || null, prazo: d.prazo || null,
          frete: d.frete || 0, obs: d.obs || (ed?.obs === 'Importado da planilha' ? ed.obs : null),
          itens: validos.map(i => ({ id: i.id, peca_id: i.peca_id, qtd: i.qtd, valor: U.r2((i.qtd || 0) * (i.preco || 0)) })) } });
        await App.gravou(['pedidos_compra', 'pedido_itens'], { inteira: ['pedido_itens'] });
        UI.aviso(ed ? 'Pedido salvo.' : `Pedido nº ${res.numero} criado.`);
        return res;
      } }],
    });
    if (r && !ed) { location.hash = '#/pedido/' + r.id; setTimeout(() => enviar(S.get('pedidos_compra', r.id)), 400); }
    return r;
  }

  // ---------------------------------------------------------------- receber
  async function receber(p) {
    if (!p) return;
    const itens = C.itensDoPedido(p.id).filter(i => i.recebido < i.qtd);
    const fin = Perm.pode('financeiro');
    const jaTemConta = S.lista('lancamentos').some(l => l.pedido_id === p.id);
    const primeiraVez = !C.itensDoPedido(p.id).some(i => i.recebido > 0);
    await UI.modal({
      titulo: `Receber pedido nº ${p.numero}`, largura: 'larga',
      corpo: `<p class="sub">${esc(S.get('fornecedores', p.fornecedor_id)?.nome || '')}. Confira cada peça. Se chegou só uma parte, mude a quantidade — o resto continua aguardando.</p>
        <div class="tabela-caixa"><table class="tabela"><thead><tr><th>Peça</th><th class="num">Falta</th><th class="num" style="width:130px">Chegou agora</th></tr></thead>
        <tbody>${itens.map(i => { const pc = S.get('pecas', i.peca_id) || {}; const falta = i.qtd - i.recebido;
          return `<tr><td><b class="mono">${esc(pc.codigo)}</b><div class="peq">${esc(pc.descricao)} · ${U.moeda(i.valor / i.qtd)} cada</div></td><td class="num">${U.qtd(falta)}</td>
            <td class="num"><input class="rec" data-item="${i.id}" data-falta="${falta}" data-preco="${i.valor / i.qtd}" inputmode="decimal" value="${U.campoNum(falta, 3)}" aria-label="Chegou de ${esc(pc.codigo)}"
              style="width:100%;min-height:40px;text-align:right;border:1px solid var(--borda-forte);border-radius:6px;padding:4px 8px;font:inherit;font-size:16px;background:var(--cartao);color:var(--texto)"></td></tr>`; }).join('')}</tbody></table></div>
        <div class="linha-campos mt">
          ${UI.campo({ nome: 'documento', rotulo: 'Nota fiscal', valor: '', placeholder: p.documento ? 'Em branco = ' + p.documento : 'Ex.: NF 000.044.892' })}
          ${UI.campo({ nome: 'data', rotulo: 'Data que chegou', tipo: 'date', valor: U.hoje(), attrs: `max="${U.hoje()}"` })}
        </div>
        <div id="rParcial"></div>
        ${fin ? `<div class="card mt" style="background:var(--cartao-2)">
          ${UI.campo({ nome: 'lancar', rotulo: 'Lançar a conta a pagar agora', tipo: 'check', valor: !jaTemConta })}
          <div id="rConta" class="linha-campos l3">
            ${UI.campo({ nome: 'cvalor', rotulo: 'Valor', tipo: 'dinheiro' })}
            ${UI.campo({ nome: 'cvenc', rotulo: '1º vencimento', tipo: 'date', valor: U.somaDias(U.hoje(), 30) })}
            ${UI.campo({ nome: 'cparc', rotulo: 'Parcelas', tipo: 'select', opcoes: [1, 2, 3, 4, 5, 6].map(n => ({ v: n, t: n === 1 ? 'À vista / 1×' : n + '× (a cada 30 dias)' })) })}
          </div>${jaTemConta ? '<p class="sub">Este pedido já tem conta lançada.</p>' : ''}</div>`
        : '<p class="sub mt">A conta a pagar é lançada pelo escritório.</p>'}
        <p class="mt">Valor recebendo agora: <b id="rTotal"></b></p>`,
      aoAbrir: (el) => {
        const conta = el.querySelector('#rConta'), lanc = el.querySelector('[name=lancar]');
        const atualizar = () => {
          let t = 0, parcial = false;
          el.querySelectorAll('.rec').forEach(i => { const n = U.num(i.value) || 0; t += n * Number(i.dataset.preco); if (n < Number(i.dataset.falta)) parcial = true; });
          t = U.r2(t + (primeiraVez ? Number(p.frete) || 0 : 0));
          el.querySelector('#rTotal').textContent = U.moeda(t);
          const cv = el.querySelector('[name=cvalor]'); if (cv && !cv.dataset.mexeu) cv.value = U.campoNum(t);
          el.querySelector('#rParcial').innerHTML = parcial ? UI.campo({ nome: 'encerrar', rotulo: 'Não vai chegar o resto: encerrar o pedido assim mesmo', tipo: 'check' }) : '';
        };
        el.querySelector('[name=cvalor]')?.addEventListener('input', (e) => e.target.dataset.mexeu = '1');
        if (lanc) { const t = () => conta.hidden = !lanc.checked; lanc.addEventListener('change', t); t(); }
        el.addEventListener('input', (e) => { if (e.target.classList.contains('rec')) atualizar(); });
        atualizar();
      },
      botoes: [{ txt: 'Confirmar recebimento', icone: 'ok', acao: async (f) => {
        const d = UI.lerForm(f);
        const its = [...f.querySelectorAll('.rec')].map(i => ({ item_id: i.dataset.item, qtd: U.num(i.value) || 0, falta: Number(i.dataset.falta) }));
        const mais = its.find(i => i.qtd > i.falta);
        if (mais && !(await UI.confirmar('Chegou mais do que faltava em alguma peça. Confirmar assim mesmo?', { ok: 'Sim, chegou a mais' }))) return false;
        if (its.some(i => i.qtd < 0)) throw new API.ErroApp('Quantidade negativa não vale.');
        if (!its.some(i => i.qtd > 0) && !d.encerrar) throw new API.ErroApp('Informe quanto chegou de pelo menos uma peça.');
        if (!f.dataset.envio) f.dataset.envio = U.uuid();
        const conta = fin && d.lancar && d.cvalor > 0 ? { valor: d.cvalor, vencimento: d.cvenc, parcelas: d.cparc, intervalo: '30' } : null;
        const r = await API.rpc('receber_pedido', { p: { pedido_id: p.id, chave: f.dataset.envio, data: d.data, documento: d.documento || null,
          itens: its.filter(i => i.qtd > 0).map(({ item_id, qtd }) => ({ item_id, qtd })), encerrar: !!d.encerrar, conta } });
        await App.gravou(['pecas', 'movimentos', 'pedidos_compra', 'pedido_itens', 'lancamentos'], { inteira: ['pedido_itens'] });
        UI.aviso(r.status === 'recebido' ? `Pedido nº ${p.numero} recebido e estoque atualizado.` : `Recebimento lançado. O resto continua aguardando.`);
      } }],
    });
  }

  // ---------------------------------------------------------------- lista de compras
  function renderListaCompras() {
    const lc = C.listaCompras();
    const pedir = lc.filter(x => !x.jaPedido), ja = lc.filter(x => x.jaPedido);
    const minimo = estado.minimo ? S.lista('pecas').filter(p => p.ativo && C.situacao(p).cod === 'minimo').map(p => ({ peca: p, ...C.sugestao(p) })).filter(x => x.sugerido > 0) : [];
    const grupos = U.agrupar([...pedir, ...minimo], x => x.peca.fornecedor_id || '');
    const ordem = [...grupos.keys()].sort((a, b) => (S.get('fornecedores', a)?.nome || 'zzz').localeCompare(S.get('fornecedores', b)?.nome || 'zzz', 'pt-BR'));
    const totalGeral = U.soma([...pedir, ...minimo], x => x.sugerido * (C.ultimaEntrada(x.peca.id)?.preco_unit || 0));
    return `${UI.voltar('#/compras', 'Pedidos de compra')}
      ${UI.cab('Lista de compras', `Peças abaixo do mínimo. A sugestão completa até o máximo, já descontando o que está a caminho. Estimativa: <b>${U.moeda0(totalGeral)}</b>.`,
        UI.btn('PDF', 'data-l="pdf"', 'sec', 'imprimir') + UI.btn('Excel', 'data-l="excel"', 'sec', 'baixar'))}
      ${UI.campo({ nome: 'verMinimo', rotulo: 'Mostrar também as que estão exatamente no mínimo', tipo: 'check', valor: estado.minimo })}
      ${!ordem.length ? UI.vazio('ok', 'Nada para comprar', 'Nenhuma peça está abaixo do mínimo agora.') : ordem.map(fid => {
        const f = S.get('fornecedores', fid); const itens = grupos.get(fid);
        const tot = U.soma(itens, x => x.sugerido * ((C.ultimaEntrada(x.peca.id, fid) || C.ultimaEntrada(x.peca.id))?.preco_unit || 0));
        return `<section class="card mt" data-grupo="${fid}"><div class="card-cab"><h2>${f ? `<a href="#/fornecedor/${f.id}">${esc(f.nome)}</a>` : 'Sem fornecedor definido'} <span class="sub">· ${U.plural(itens.length, 'peça')} · ≈ ${U.moeda0(tot)}</span></h2>
          ${UI.btn('Gerar pedido', `data-gerar="${fid}"`, 'pri mini', 'compras')}</div>
          <div class="tabela-caixa"><table class="tabela cartoes"><thead><tr><th style="width:34px"></th><th>Peça</th><th class="num">Estoque</th><th class="num">Mín / Máx</th><th class="num">A caminho</th><th class="num">Comprar</th><th class="num">Último preço</th></tr></thead>
          <tbody>${itens.map(x => { const u = C.ultimaEntrada(x.peca.id, fid) || C.ultimaEntrada(x.peca.id);
            return `<tr><td data-r="Incluir"><input type="checkbox" class="sel" data-peca="${x.peca.id}" checked aria-label="Incluir ${esc(x.peca.codigo)}" style="width:20px;height:20px;accent-color:var(--marca)"></td>
              <td data-r="Peça" class="titulo"><a class="mono" href="#/peca/${x.peca.id}">${esc(x.peca.codigo)}</a><div class="peq">${esc(x.peca.descricao)}${x.peca.utilizacao ? ' · ' + esc(x.peca.utilizacao) : ''}</div></td>
              <td data-r="Estoque" class="num" style="color:var(--vermelho);font-weight:700">${U.qtd(x.peca.estoque)}</td><td data-r="Mín / Máx" class="num">${U.qtd(x.peca.est_min)} / ${U.qtd(x.peca.est_max)}</td>
              <td data-r="A caminho" class="num">${x.pendente ? U.qtd(x.pendente) : '—'}</td>
              <td data-r="Comprar" class="num"><input class="qtdc" data-peca="${x.peca.id}" inputmode="decimal" value="${U.campoNum(x.sugerido, 3)}" aria-label="Quantidade de ${esc(x.peca.codigo)}" style="width:80px;min-height:36px;text-align:right;border:1px solid var(--borda-forte);border-radius:6px;padding:2px 8px;font:inherit;font-size:16px;background:var(--cartao);color:var(--texto)"></td>
              <td data-r="Último preço" class="num">${u ? U.moeda(u.preco_unit) : '—'}</td></tr>`; }).join('')}</tbody></table></div></section>`; }).join('')}
      ${ja.length ? `<section class="card mt"><div class="card-cab"><h2>Já pedidas, aguardando chegar</h2></div><div class="lista">${ja.map(x => `<a class="linha" href="#/peca/${x.peca.id}">
        <div class="meio"><b><span class="codigo">${esc(x.peca.codigo)}</span> · ${esc(x.peca.descricao)}</b><small>estoque ${U.qtd(x.peca.estoque)} · mínimo ${U.qtd(x.peca.est_min)}</small></div>
        <div class="lado"><b>${U.qtd(x.pendente)}</b><small>a caminho</small></div></a>`).join('')}</div></section>` : ''}`;
  }

  function depoisListaCompras(el) {
    el.querySelector('[name=verMinimo]').addEventListener('change', (e) => { estado.minimo = e.target.checked; App.render(); });
    el.addEventListener('click', async (e) => {
      const g = e.target.closest('[data-gerar]');
      if (g) {
        const sec = g.closest('[data-grupo]');
        const itens = [...sec.querySelectorAll('.sel:checked')].map(c => { const p = S.get('pecas', c.dataset.peca);
          const q = U.num(sec.querySelector(`.qtdc[data-peca="${p.id}"]`).value);
          const u = C.ultimaEntrada(p.id, g.dataset.gerar || undefined) || C.ultimaEntrada(p.id);
          return { peca: p, qtd: q, preco: u?.preco_unit }; }).filter(i => i.qtd > 0);
        if (!itens.length) { UI.aviso('Marque pelo menos uma peça com quantidade.', 'erro'); return; }
        delete el.dataset.sujo;
        form({ fornecedor_id: g.dataset.gerar || null, itens });
      }
      const l = e.target.closest('[data-l]');
      if (l?.dataset.l === 'pdf') UI.ocupado(l, () => exportarLista('pdf'));
      if (l?.dataset.l === 'excel') UI.ocupado(l, () => exportarLista('excel'));
    });
  }

  async function exportarLista(tipo) {
    const lc = C.listaCompras().filter(x => !x.jaPedido);
    const grupos = U.agrupar(lc, x => x.peca.fornecedor_id || '');
    if (tipo === 'excel') {
      await U.lib('xlsx');
      const linhas = lc.map(x => { const u = C.ultimaEntrada(x.peca.id); return { 'Fornecedor': S.get('fornecedores', x.peca.fornecedor_id)?.nome || '', 'Código': x.peca.codigo, 'Descrição': x.peca.descricao,
        'Estoque': x.peca.estoque, 'Mínimo': x.peca.est_min, 'Máximo': x.peca.est_max, 'A caminho': x.pendente, 'Comprar': x.sugerido, 'Último preço': u?.preco_unit || null, 'Estimativa (R$)': U.r2(x.sugerido * (u?.preco_unit || 0)) }; });
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'Lista de Compras');
      return PDF.entregar(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Lista de compras JAF ${U.hoje()}.xlsx`);
    }
    const col = [{ t: 'Código', w: 40, mono: true }, { t: 'Descrição' }, { t: 'Estoque', w: 16, alinhar: 'right' }, { t: 'Mín/Máx', w: 20, alinhar: 'right' }, { t: 'A caminho', w: 18, alinhar: 'right' }, { t: 'Comprar', w: 18, alinhar: 'right' }, { t: 'Último preço', w: 24, alinhar: 'right' }];
    const blob = await PDF.tabela('Lista de compras', `Peças abaixo do mínimo em ${U.data(U.hoje())}`, col, [], {
      grupos: [...grupos.entries()].map(([fid, itens]) => ({ titulo: S.get('fornecedores', fid)?.nome || 'Sem fornecedor definido',
        linhas: itens.map(x => [x.peca.codigo, x.peca.descricao, U.qtd(x.peca.estoque), `${U.qtd(x.peca.est_min)}/${U.qtd(x.peca.est_max)}`, x.pendente ? U.qtd(x.pendente) : '—', U.qtd(x.sugerido), U.moeda(C.ultimaEntrada(x.peca.id)?.preco_unit)]) })) });
    return PDF.entregar(blob, `Lista de compras JAF ${U.hoje()}.pdf`);
  }

  return {
    titulo: (r) => r.nome === 'pedido' ? 'Pedido nº ' + (S.get('pedidos_compra', r.id)?.numero || '') : r.sub === 'lista' ? 'Lista de compras' : 'Pedidos de compra',
    perm: 'compras',
    render(r) { if (r.nome === 'pedido') return renderPedido(r.id); if (r.sub === 'lista') return renderListaCompras(); return renderLista(r); },
    depois(el, r) { if (r.nome === 'pedido') depoisPedido(el, r); else if (r.sub === 'lista') depoisListaCompras(el); else depoisLista(el); },
    form, receber, linhaPedido,
  };
})();
