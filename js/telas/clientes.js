/* Clientes (para quem a JAF produz) */
'use strict';

Telas.clientes = (() => {
  const esc = U.esc;
  let busca = '';

  function linha(c) {
    const ab = S.lista('ordens').filter(o => o.cliente_id === c.id && ['fila', 'producao', 'pronta'].includes(o.status)).length;
    const rec = U.soma(S.lista('lancamentos').filter(l => l.cliente_id === c.id && l.tipo === 'receber' && !l.pago_em), 'valor');
    return `<a class="linha" href="#/cliente/${c.id}"><div class="meio"><b>${esc(c.nome)}${!c.ativo ? ' <span class="tag t-cinza">inativo</span>' : ''}</b>
      <small>${esc([c.contato, U.tel(c.telefone), c.cidade].filter(Boolean).join(' · ') || '—')}</small></div>
      <div class="lado"><b>${rec ? U.moeda0(rec) : '—'}</b><small>${ab ? U.plural(ab, 'ordem', 'ordens') + ' abertas' : rec ? 'a receber' : ''}</small></div></a>`;
  }

  function renderLista() {
    return `${UI.cab('Clientes', 'Para quem a JAF produz', UI.btn('Novo cliente', 'data-cl="novo"', 'pri', 'mais'))}
      <div class="barra-filtros"><div class="busca-lista">${UI.ic('busca')}<input type="search" id="bCli" placeholder="Nome, CNPJ, cidade" value="${esc(busca)}"></div></div>
      <div class="lista" id="lCli"></div>`;
  }
  function desenhar(el) {
    const l = busca.trim() ? U.buscar(S.lista('clientes'), busca, c => [c.nome, c.razao || '', c.cnpj || '', c.cidade || ''])
      : U.ordenar(S.lista('clientes'), c => (c.ativo ? '0' : '1') + U.sem(c.nome));
    el.querySelector('#lCli').innerHTML = l.length ? l.map(linha).join('') : UI.vazio('cliente', 'Nenhum cliente', 'Cadastre os clientes para ligar ordens de produção e contas a receber.');
  }
  function depoisLista(el) {
    desenhar(el);
    el.querySelector('#bCli').addEventListener('input', U.debounce((e) => { busca = e.target.value; desenhar(el); }, 120));
    el.addEventListener('click', (e) => { if (e.target.closest('[data-cl="novo"]')) form(); });
    el.addEventListener('input', () => delete el.dataset.sujo);
  }

  function renderFicha(id) {
    const c = S.get('clientes', id);
    if (!c) return UI.vazio('cliente', 'Cliente não encontrado', '', '<a class="btn pri" href="#/clientes">Voltar</a>');
    const ords = S.lista('ordens').filter(o => o.cliente_id === c.id).sort((a, b) => b.numero - a.numero);
    const contas = S.lista('lancamentos').filter(l => l.cliente_id === c.id).sort((a, b) => a.vencimento < b.vencimento ? 1 : -1);
    const ano = U.hoje().slice(0, 4);
    const recAno = U.soma(contas.filter(l => l.pago_em && l.pago_em.startsWith(ano)), 'valor_pago');
    const aberto = U.soma(contas.filter(l => !l.pago_em), 'valor');
    return `${UI.voltar('#/clientes', 'Clientes')}
      <header class="cab"><div><h1>${esc(c.nome)}</h1><p class="sub">${esc([c.razao, c.cnpj].filter(Boolean).join(' · '))}</p></div>
        <div class="acoes">${UI.btn('Nova ordem', 'data-cl="ordem"', 'pri', 'producao')}${UI.btn('Conta a receber', 'data-cl="conta"', 'sec', 'dinheiro')}${UI.btn('Editar', 'data-cl="editar"', 'fantasma', 'lapis')}</div></header>
      <div class="grade g3"><div class="kpi"><small>Recebido em ${ano}</small><b>${U.moeda0(recAno)}</b></div><div class="kpi"><small>A receber</small><b>${U.moeda0(aberto)}</b></div>
        <div class="kpi"><small>Ordens</small><b>${ords.length}</b><span>${ords.filter(o => ['fila', 'producao', 'pronta'].includes(o.status)).length} em andamento</span></div></div>
      <section class="card mt">${UI.dl([['Contato', esc(c.contato || '')], ['Telefone', esc(U.tel(c.telefone || ''))], ['E-mail', c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''],
        ['Cidade', esc([c.cidade, c.uf].filter(Boolean).join('/'))], ['Observações', esc(c.obs || '')]]) || '<p class="sub">Sem dados de contato.</p>'}</section>
      ${ords.length ? `<section class="card mt"><div class="card-cab"><h2>Ordens de produção</h2></div>${ords.slice(0, 20).map(o => Telas.producao.cartao(o)).join('')}</section>` : ''}
      ${contas.length ? `<section class="card mt"><div class="card-cab"><h2>Contas</h2></div><div class="lista">${contas.slice(0, 30).map(l => Telas.financeiro.linha(l)).join('')}</div></section>` : ''}`;
  }
  function depoisFicha(el, r) {
    const c = S.get('clientes', r.id); if (!c) return;
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-cl]')?.dataset.cl;
      if (a === 'editar') form(c);
      if (a === 'ordem') Telas.producao.form({ cliente_id: c.id, cliente_nome: c.nome, unidade: 'pç', prioridade: 0 });
      if (a === 'conta') Telas.financeiro.form({ tipo: 'receber', cliente_id: c.id });
      const o = e.target.closest('[data-ordem]'); if (o) Telas.producao.abrir(o.dataset.ordem);
      const l = e.target.closest('[data-conta]'); if (l) Telas.financeiro.abrir(l.dataset.conta);
    });
  }

  async function form(c, nomeInicial) {
    const novo = !c;
    c = c || { ativo: true, nome: nomeInicial || '' };
    return UI.modal({
      titulo: novo ? 'Novo cliente' : 'Editar cliente',
      corpo: `${UI.campo({ nome: 'nome', rotulo: 'Nome', valor: c.nome, req: true })}
        <div class="linha-campos">${UI.campo({ nome: 'cnpj', rotulo: 'CNPJ', valor: c.cnpj })}${UI.campo({ nome: 'razao', rotulo: 'Razão social', valor: c.razao })}</div>
        <div class="linha-campos">${UI.campo({ nome: 'contato', rotulo: 'Contato', valor: c.contato })}${UI.campo({ nome: 'telefone', rotulo: 'Telefone', tipo: 'tel', valor: c.telefone })}</div>
        <div class="linha-campos">${UI.campo({ nome: 'email', rotulo: 'E-mail', tipo: 'email', valor: c.email })}${UI.campo({ nome: 'cidade', rotulo: 'Cidade', valor: c.cidade })}${UI.campo({ nome: 'uf', rotulo: 'UF', valor: c.uf, attrs: 'maxlength="2"' })}</div>
        ${UI.campo({ nome: 'obs', rotulo: 'Observações', tipo: 'area', valor: c.obs, linhas: 2 })}
        ${novo ? '' : UI.campo({ nome: 'ativo', rotulo: 'Cliente ativo', tipo: 'check', valor: c.ativo })}`,
      aoAbrir: (el) => Telas.fornecedores.autoPreencher(el),
      botoes: [{ txt: novo ? 'Cadastrar' : 'Salvar', acao: async (f) => {
        const d = UI.lerForm(f); if (novo) d.ativo = true;
        const id = await API.rpc('salvar_cliente', { p: { ...d, id: c.id } });
        await App.gravou(['clientes', 'ordens']); UI.aviso(novo ? 'Cliente cadastrado.' : 'Cliente salvo.'); return id;
      } }],
    });
  }
  async function novoRapido(nome) { const id = await form(null, nome); return id ? S.get('clientes', id) : null; }

  return {
    titulo: (r) => r.nome === 'cliente' ? (S.get('clientes', r.id)?.nome || 'Cliente') : 'Clientes', perm: 'clientes',
    render(r) { return r.nome === 'cliente' ? renderFicha(r.id) : renderLista(); },
    depois(el, r) { if (r.nome === 'cliente') depoisFicha(el, r); else depoisLista(el); },
    form, novoRapido,
  };
})();
