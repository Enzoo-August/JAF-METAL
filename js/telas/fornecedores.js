/* Fornecedores e prestadores de serviço */
'use strict';

Telas.fornecedores = (() => {
  const esc = U.esc;
  const estado = { busca: '', f: 'ativos' };

  // entradas de compra do fornecedor (para total comprado)
  const compras = (fid) => S.lista('movimentos').filter(m => m.fornecedor_id === fid && m.tipo === 'entrada' && (m.motivo === 'compra' || m.motivo === 'importado'));

  // pontualidade: só pedidos recebidos pelo sistema (data real de chegada)
  function pontualidade(fid) {
    const r = [];
    for (const p of S.lista('pedidos_compra').filter(x => x.fornecedor_id === fid && x.prazo)) {
      const itens = C.itensDoPedido(p.id).map(i => i.id);
      const chegadas = S.lista('movimentos').filter(m => itens.includes(m.pedido_item_id) && m.tipo === 'entrada' && m.motivo === 'compra');
      if (!chegadas.length) { if (p.status === 'aguardando' && p.prazo < U.hoje()) r.push({ p, atraso: U.dias(p.prazo, U.hoje()), aberto: true }); continue; }
      const primeira = chegadas.reduce((a, m) => m.data < a ? m.data : a, chegadas[0].data);
      r.push({ p, atraso: Math.max(0, U.dias(p.prazo, primeira)) });
    }
    if (!r.length) return null;
    const noPrazo = r.filter(x => x.atraso === 0 && !x.aberto).length;
    return { n: r.length, noPrazo, pct: noPrazo / r.length, atrasoMedio: U.soma(r.filter(x => x.atraso > 0), 'atraso') / Math.max(1, r.filter(x => x.atraso > 0).length) };
  }

  function filtrar() {
    let l = S.lista('fornecedores');
    if (estado.f === 'ativos') l = l.filter(f => f.ativo);
    else if (estado.f === 'pecas') l = l.filter(f => f.ativo && f.tipo !== 'Serviço');
    else if (estado.f === 'servico') l = l.filter(f => f.ativo && f.tipo !== 'Peças');
    else if (estado.f === 'qualif') l = l.filter(f => f.ativo && f.qualif_validade && f.qualif_validade < U.hoje());
    else if (estado.f === 'inativos') l = l.filter(f => !f.ativo);
    return estado.busca.trim() ? U.buscar(l, estado.busca, f => [f.nome, f.razao || '', f.contato || '', f.cidade || '', f.cnpj || '', f.obs || ''])
      : U.ordenar(l, f => U.sem(f.nome));
  }

  function linha(f) {
    const n = S.lista('pecas').filter(p => p.fornecedor_id === f.id && p.ativo).length;
    const ano = U.hoje().slice(0, 4);
    const tot = U.soma(compras(f.id).filter(m => m.data.startsWith(ano)), m => m.qtd * m.preco_unit);
    return `<a class="linha" href="#/fornecedor/${f.id}"><div class="meio"><b>${esc(f.nome)}${!f.ativo ? ' <span class="tag t-cinza">inativo</span>' : ''}</b>
      <small>${esc([f.tipo !== 'Peças' ? f.tipo : '', f.contato, U.tel(f.celular || f.telefone), f.cidade].filter(Boolean).join(' · ') || '—')}</small></div>
      <div class="lado"><b>${tot ? U.moeda0(tot) : '—'}</b><small>${n ? U.plural(n, 'peça') : ''} ${tot ? 'em ' + ano : ''}</small></div></a>`;
  }

  function renderLista(r) {
    if (r.q.get('f')) estado.f = r.q.get('f');
    const venc = S.lista('fornecedores').filter(f => f.ativo && f.qualif_validade && f.qualif_validade < U.hoje()).length;
    return `${UI.cab('Fornecedores', 'Quem vende peças e quem presta serviço (eletricista, mecânico, ferramentaria…)', UI.btn('Novo fornecedor', 'data-fo="novo"', 'pri', 'mais'))}
      <div class="barra-filtros"><div class="busca-lista">${UI.ic('busca')}<input type="search" id="bForn" placeholder="Nome, contato, cidade, CNPJ…" value="${esc(estado.busca)}"></div></div>
      ${UI.chips([{ v: 'ativos', t: 'Ativos' }, { v: 'pecas', t: 'Peças' }, { v: 'servico', t: 'Serviços' }, { v: 'qualif', t: 'Qualificação vencida', n: venc || null }, { v: 'inativos', t: 'Inativos' }], estado.f)}
      <p class="sub mt" id="resForn"></p>
      <div class="lista"><div data-pagina></div><button type="button" class="mais-btn" data-mais hidden><span></span></button></div>`;
  }
  function desenhar(el) {
    const l = filtrar();
    el.querySelector('#resForn').textContent = U.plural(l.length, 'fornecedor', 'fornecedores');
    if (!l.length) { el.querySelector('[data-pagina]').innerHTML = UI.vazio('fornecedor', 'Nenhum fornecedor aqui'); el.querySelector('[data-mais]').hidden = true; return; }
    UI.paginar(el, l, linha, 60);
  }
  function depoisLista(el) {
    desenhar(el);
    el.querySelector('#bForn').addEventListener('input', U.debounce((e) => { estado.busca = e.target.value; desenhar(el); }, 120));
    el.addEventListener('click', (e) => {
      const c = e.target.closest('[data-f]'); if (c) { estado.f = c.dataset.f; el.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c)); desenhar(el); }
      if (e.target.closest('[data-fo="novo"]')) form();
    });
    el.addEventListener('input', () => delete el.dataset.sujo);
  }

  // ---------------------------------------------------------------- ficha
  function contatos(f) {
    const b = [];
    for (const t of [f.celular, f.telefone].filter(Boolean)) {
      const dig = String(t).replace(/^\(0xx/i, '(').replace(/[^\d]/g, '');
      b.push(`<a class="btn sec mini" href="tel:${dig}">${UI.ic('telefone')}<span>${esc(U.tel(t))}</span></a>`);
      if (U.ehCelular(t)) b.push(`<a class="btn sec mini" target="_blank" rel="noopener" href="https://wa.me/${U.telZap(t)}">${UI.ic('whatsapp')}<span>WhatsApp</span></a>`);
    }
    if (f.email) b.push(`<a class="btn sec mini" href="mailto:${esc(f.email)}">${UI.ic('email')}<span>${esc(f.email)}</span></a>`);
    if (U.site(f.site)) b.push(`<a class="btn sec mini" target="_blank" rel="noopener" href="${esc(U.site(f.site))}">${UI.ic('link')}<span>Site</span></a>`);
    return b.length ? `<div class="grupo-btn">${b.join('')}</div>` : '';
  }

  function renderFicha(id) {
    const f = S.get('fornecedores', id);
    if (!f) return UI.vazio('fornecedor', 'Fornecedor não encontrado', '', '<a class="btn pri" href="#/fornecedores">Voltar</a>');
    const pecas = U.ordenar(S.lista('pecas').filter(p => p.fornecedor_id === f.id), p => U.sem(p.codigo));
    const cs = compras(f.id);
    const porAno = U.agrupar(cs, m => m.data.slice(0, 4));
    const anos = [...porAno.keys()].sort().reverse().slice(0, 6);
    const maxAno = Math.max(1, ...anos.map(a => U.soma(porAno.get(a), m => m.qtd * m.preco_unit)));
    const peds = S.lista('pedidos_compra').filter(p => p.fornecedor_id === f.id).sort((a, b) => b.numero - a.numero);
    const pont = pontualidade(f.id);
    const manut = S.lista('manutencoes').filter(m => m.fornecedor_id === f.id);
    const qualVenc = f.qualif_validade && f.qualif_validade < U.hoje();
    return `${UI.voltar('#/fornecedores', 'Fornecedores')}
      <header class="cab"><div><h1>${esc(f.nome)} ${!f.ativo ? '<span class="tag t-cinza">inativo</span>' : ''}</h1><p class="sub">${esc([f.razao, f.tipo].filter(Boolean).join(' · '))}</p></div>
        <div class="acoes">${UI.btn('Novo pedido', 'data-fo="pedido"', 'pri', 'compras')}${UI.btn('Editar', 'data-fo="editar"', 'sec', 'lapis')}</div></header>
      <section class="card">${contatos(f)}
        <div class="mt">${UI.dl([['Contato', esc([f.contato, f.contato2].filter(Boolean).join(' / '))], ['CNPJ', esc(f.cnpj || '')], ['Inscrição estadual', esc(f.ie || '')],
          ['Endereço', esc([f.endereco, f.bairro, [f.cidade, f.uf].filter(Boolean).join('/'), f.cep].filter(Boolean).join(' — '))],
          ['Qualificação', f.qualificacao ? `${UI.tag({ txt: f.qualificacao, cor: f.qualificacao === 'Aprovado' ? (qualVenc ? 'vermelho' : 'verde') : f.qualificacao === 'Reprovado' ? 'vermelho' : 'amarelo' })}${f.qualif_validade ? ` até ${U.data(f.qualif_validade)}${qualVenc ? ' (vencida)' : ''}` : ''}${f.qualif_metodo ? ' · ' + esc(f.qualif_metodo) : ''}` : ''],
          ['Observações', esc(f.obs || '')]])}</div></section>
      <div class="grade g2 mt">
        <section class="card"><div class="card-cab"><h2>Compras por ano</h2></div>
          ${anos.length ? `<div class="barras">${anos.map(a => { const v = U.soma(porAno.get(a), m => m.qtd * m.preco_unit); return `<div class="barra-h"><span>${a}</span><div class="trilho"><i style="width:${v / maxAno * 100}%"></i></div><b>${U.moeda0(v)}</b></div>`; }).join('')}</div>` : '<p class="sub">Nenhuma compra registrada.</p>'}</section>
        <section class="card"><div class="card-cab"><h2>Entrega no prazo</h2></div>
          ${pont ? `<div class="estoque-grande" style="color:var(--${pont.pct >= .8 ? 'verde' : pont.pct >= .5 ? 'amarelo' : 'vermelho'})">${U.pct(pont.pct)}</div>
            <p class="sub mt">${pont.noPrazo} de ${U.plural(pont.n, 'pedido')} chegaram no prazo combinado.${pont.atrasoMedio ? ` Quando atrasa, atrasa ${U.plural(Math.round(pont.atrasoMedio), 'dia')} em média.` : ''}</p>`
            : '<p class="sub">Começa a medir quando os pedidos forem recebidos pelo sistema (com prazo combinado).</p>'}</section>
      </div>
      ${pecas.length ? `<section class="card mt"><div class="card-cab"><h2>Peças deste fornecedor</h2><span class="sub">${U.plural(pecas.length, 'peça')}</span></div>
        <div class="lista">${pecas.map(p => Telas.pecas.linha(p)).join('')}</div></section>` : ''}
      ${peds.length ? `<section class="card mt"><div class="card-cab"><h2>Pedidos de compra</h2></div><div class="lista">${peds.slice(0, 15).map(p => Telas.compras.linhaPedido(p)).join('')}</div>
        ${peds.length > 15 ? `<p class="sub mt">Mostrando os 15 mais recentes de ${peds.length}.</p>` : ''}</section>` : ''}
      ${manut.length ? `<section class="card mt"><div class="card-cab"><h2>Serviços de manutenção</h2></div><div class="lista">${manut.map(m => Telas.maquinas.linhaManut(m, true)).join('')}</div></section>` : ''}`;
  }

  function depoisFicha(el, r) {
    const f = S.get('fornecedores', r.id); if (!f) return;
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-fo]')?.dataset.fo;
      if (a === 'editar') form(f);
      else if (a === 'pedido') Telas.compras.form({ fornecedor_id: f.id });
      const m = e.target.closest('[data-manut]'); if (m) Telas.maquinas.formManutencao(S.get('manutencoes', m.dataset.manut));
    });
  }

  // ---------------------------------------------------------------- cadastro
  async function form(f, nomeInicial) {
    const novo = !f;
    f = f || { tipo: 'Peças', ativo: true, nome: nomeInicial || '' };
    const id = await UI.modal({
      titulo: novo ? 'Novo fornecedor' : 'Editar fornecedor', largura: 'larga',
      corpo: `
        <div class="linha-campos">
          ${UI.campo({ nome: 'nome', rotulo: 'Nome (como vocês chamam)', valor: f.nome, req: true, ajuda: 'O nome curto do dia a dia. A razão social vai no campo próprio.' })}
          ${UI.campo({ nome: 'tipo', rotulo: 'Fornece', tipo: 'select', valor: f.tipo, opcoes: ['Peças', 'Serviço', 'Peças e serviço'].map(v => ({ v, t: v })) })}
        </div>
        <div class="linha-campos">
          ${UI.campo({ nome: 'cnpj', rotulo: 'CNPJ', valor: f.cnpj, ajuda: 'Digite e saia do campo: o sistema busca razão social e endereço.' })}
          ${UI.campo({ nome: 'razao', rotulo: 'Razão social', valor: f.razao })}
        </div>
        <div class="linha-campos">
          ${UI.campo({ nome: 'contato', rotulo: 'Contato', valor: f.contato })}
          ${UI.campo({ nome: 'contato2', rotulo: 'Outro contato', valor: f.contato2 })}
        </div>
        <div class="linha-campos">
          ${UI.campo({ nome: 'celular', rotulo: 'Celular / WhatsApp', valor: U.tel(f.celular), tipo: 'tel' })}
          ${UI.campo({ nome: 'telefone', rotulo: 'Telefone', valor: U.tel(f.telefone), tipo: 'tel' })}
          ${UI.campo({ nome: 'email', rotulo: 'E-mail', valor: f.email, tipo: 'email' })}
        </div>
        ${UI.campo({ nome: 'site', rotulo: 'Site', valor: f.site })}
        <div class="linha-campos">
          ${UI.campo({ nome: 'cep', rotulo: 'CEP', valor: f.cep, ajuda: 'Preenche o endereço sozinho.' })}
          ${UI.campo({ nome: 'endereco', rotulo: 'Endereço', valor: f.endereco })}
          ${UI.campo({ nome: 'bairro', rotulo: 'Bairro', valor: f.bairro })}
        </div>
        <div class="linha-campos">
          ${UI.campo({ nome: 'cidade', rotulo: 'Cidade', valor: f.cidade })}
          ${UI.campo({ nome: 'uf', rotulo: 'UF', valor: f.uf, attrs: 'maxlength="2"' })}
          ${UI.campo({ nome: 'ie', rotulo: 'Inscrição estadual', valor: f.ie })}
        </div>
        <h3 class="mt">Qualificação do fornecedor</h3>
        <div class="linha-campos">
          ${UI.campo({ nome: 'qualificacao', rotulo: 'Situação', tipo: 'select', valor: f.qualificacao || '', opcoes: [{ v: '', t: '—' }, ...['Aprovado', 'Em avaliação', 'Reprovado'].map(v => ({ v, t: v }))] })}
          ${UI.campo({ nome: 'qualif_metodo', rotulo: 'Método', valor: f.qualif_metodo, placeholder: 'Ex.: Qualificação interna' })}
          ${UI.campo({ nome: 'qualif_validade', rotulo: 'Válida até', tipo: 'date', valor: f.qualif_validade })}
        </div>
        ${UI.campo({ nome: 'obs', rotulo: 'Observações', tipo: 'area', valor: f.obs, linhas: 2 })}
        ${novo ? '' : UI.campo({ nome: 'ativo', rotulo: 'Fornecedor ativo (desmarque se não compra mais dele — o histórico continua)', tipo: 'check', valor: f.ativo })}`,
      aoAbrir: (el) => autoPreencher(el),
      botoes: [{ txt: novo ? 'Cadastrar' : 'Salvar', acao: async (frm) => {
        const d = UI.lerForm(frm);
        if (novo) d.ativo = true;
        const r = await API.rpc('salvar_fornecedor', { p: { ...d, id: f.id } });
        await App.gravou(['fornecedores']);
        UI.aviso(novo ? 'Fornecedor cadastrado.' : 'Fornecedor salvo.');
        return r;
      } }],
    });
    return id;
  }

  // CNPJ → razão social / endereço (BrasilAPI); CEP → endereço (ViaCEP). Só preenche o que está vazio.
  function autoPreencher(el) {
    const v = (n) => el.querySelector(`[name=${n}]`);
    const por = (n, val) => { const i = v(n); if (i && !i.value.trim() && val) { i.value = val; i.dispatchEvent(new Event('input', { bubbles: true })); } };
    v('cnpj')?.addEventListener('change', async (e) => {
      const d = e.target.value.replace(/\D/g, '');
      if (d.length !== 14) return;
      e.target.value = d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
      try {
        const r = await fetch('https://brasilapi.com.br/api/cnpj/v1/' + d); if (!r.ok) return;
        const j = await r.json();
        por('razao', j.razao_social); por('cep', j.cep && String(j.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2'));
        por('endereco', [j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).join(' ') + (j.numero ? ', ' + j.numero : '') + (j.complemento ? ' ' + j.complemento : ''));
        por('bairro', j.bairro); por('cidade', j.municipio && U.cap(j.municipio.toLowerCase()).replace(/\b(\w)/g, c => c.toUpperCase())); por('uf', j.uf);
        UI.aviso('Dados do CNPJ preenchidos. Confira.');
      } catch (err) { /* sem internet: segue manual */ }
    });
    v('cep')?.addEventListener('change', async (e) => {
      const d = e.target.value.replace(/\D/g, '');
      if (d.length !== 8) return;
      e.target.value = d.replace(/^(\d{5})(\d{3})$/, '$1-$2');
      try {
        const r = await fetch(`https://viacep.com.br/ws/${d}/json/`); if (!r.ok) return;
        const j = await r.json(); if (j.erro) return;
        por('endereco', j.logradouro); por('bairro', j.bairro); por('cidade', j.localidade); por('uf', j.uf);
      } catch (err) {}
    });
  }

  // cadastro rápido de dentro de outro formulário
  async function novoRapido(nome) {
    const id = await form(null, nome);
    return id ? S.get('fornecedores', id) : null;
  }

  return {
    titulo: (r) => r.nome === 'fornecedor' ? (S.get('fornecedores', r.id)?.nome || 'Fornecedor') : 'Fornecedores',
    perm: 'compras',
    render(r) { return r.nome === 'fornecedor' ? renderFicha(r.id) : renderLista(r); },
    depois(el, r) { if (r.nome === 'fornecedor') depoisFicha(el, r); else depoisLista(el); },
    form, novoRapido, autoPreencher, pontualidade,
  };
})();
