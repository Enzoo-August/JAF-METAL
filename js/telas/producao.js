/* Produção: ordens de produção */
'use strict';

Telas.producao = (() => {
  const esc = U.esc;
  const estado = { busca: '', maq: '', ver: 'quadro' };

  function cartao(o) {
    const sit = C.situacaoOrdem(o), maq = S.get('maquinas', o.maquina_id), resp = S.get('funcionarios', o.responsavel_id);
    const pct = o.qtd ? Math.min(100, o.produzido / o.qtd * 100) : 0;
    return `<div class="op ${sit.atrasada ? 'atrasada' : ''} ${o.prioridade ? 'urgente' : ''}" data-ordem="${o.id}" role="button" tabindex="0">
      <div style="display:flex;justify-content:space-between;gap:8px"><b>OP ${o.numero} · ${esc(o.produto)}</b>${o.prioridade ? '<span class="tag t-amarelo">Urgente</span>' : ''}</div>
      <small>${esc([o.cliente_nome, o.pedido_cliente, o.codigo].filter(Boolean).join(' · '))}</small>
      <small>${U.qtd(o.produzido)} de ${U.qtd(o.qtd)} ${esc(o.unidade)}${maq ? ' · ' + esc(maq.nome) : ''}${resp ? ' · ' + esc(resp.nome.split(' ')[0]) : ''}</small>
      <small style="color:var(--${sit.atrasada ? 'vermelho' : 'texto-2'});font-weight:${sit.atrasada ? 700 : 400}">${o.prazo ? (sit.atrasada ? 'Atrasada · era para ' + U.data(o.prazo) : 'Prazo ' + U.relativo(o.prazo)) : 'Sem prazo'}</small>
      <div class="progresso"><i style="width:${pct}%"></i></div></div>`;
  }

  const ordenar = (l) => l.slice().sort((a, b) => (b.prioridade - a.prioridade) || ((a.prazo || '9999') < (b.prazo || '9999') ? -1 : (a.prazo || '9999') > (b.prazo || '9999') ? 1 : a.numero - b.numero));

  function filtrar() {
    let l = S.lista('ordens');
    if (estado.maq) l = l.filter(o => o.maquina_id === estado.maq);
    if (estado.busca.trim()) l = U.buscar(l, estado.busca, o => [String(o.numero), o.produto, o.codigo || '', o.cliente_nome || '', o.pedido_cliente || '']);
    return l;
  }

  function render() {
    const maqs = U.ordenar(S.lista('maquinas').filter(m => m.ativo), m => U.sem(m.nome));
    return `${UI.cab('Ordens de produção', 'O que a fábrica tem para fazer, por prazo', Perm.pode('producao_editar') ? UI.btn('Nova ordem', 'data-o="nova"', 'pri', 'mais') : '')}
      <div class="barra-filtros"><div class="busca-lista">${UI.ic('busca')}<input type="search" id="bOP" placeholder="Nº, produto, cliente, pedido…" value="${esc(estado.busca)}"></div>
        <select id="oMaq" aria-label="Máquina"><option value="">Todas as máquinas</option>${maqs.map(m => `<option value="${m.id}" ${m.id === estado.maq ? 'selected' : ''}>${esc(m.nome)}</option>`).join('')}</select></div>
      ${UI.chips([{ v: 'quadro', t: 'Em andamento' }, { v: 'entregues', t: 'Entregues' }, { v: 'canceladas', t: 'Canceladas' }], estado.ver, 'ver')}
      <div id="opArea" class="mt"></div>`;
  }

  function desenhar(el) {
    const l = filtrar(), area = el.querySelector('#opArea');
    if (estado.ver === 'quadro') {
      const col = (st, tit) => { const it = ordenar(l.filter(o => o.status === st));
        return `<div class="coluna"><h3><span>${tit}</span><span class="sub">${it.length}</span></h3>${it.map(cartao).join('') || '<p class="sub" style="padding:4px">Nada aqui.</p>'}</div>`; };
      area.innerHTML = `<div class="kanban">${col('fila', 'Na fila')}${col('producao', 'Produzindo')}${col('pronta', 'Pronta para entregar')}</div>`;
    } else {
      const st = estado.ver === 'entregues' ? 'entregue' : 'cancelada';
      const it = l.filter(o => o.status === st).sort((a, b) => (b.entregue_em || b.atualizado_em) < (a.entregue_em || a.atualizado_em) ? -1 : 1);
      area.innerHTML = it.length ? `<div class="lista">${it.map(o => `<div class="linha clicavel" data-ordem="${o.id}"><div class="meio"><b>OP ${o.numero} · ${esc(o.produto)}</b>
        <small>${esc([o.cliente_nome, o.pedido_cliente].filter(Boolean).join(' · '))}${o.entregue_em ? ' · entregue ' + U.data(o.entregue_em) : ''}${o.prazo && o.entregue_em ? (o.entregue_em > o.prazo ? ` · ${U.plural(U.dias(o.prazo, o.entregue_em), 'dia')} depois do prazo` : ' · no prazo') : ''}</small></div>
        <div class="lado"><b>${U.qtd(o.produzido)} ${esc(o.unidade)}</b></div></div>`).join('')}</div>` : UI.vazio('producao', 'Nada aqui');
    }
  }

  function depois(el) {
    desenhar(el);
    el.querySelector('#bOP').addEventListener('input', U.debounce((e) => { estado.busca = e.target.value; desenhar(el); }, 120));
    el.querySelector('#oMaq').addEventListener('change', (e) => { estado.maq = e.target.value; desenhar(el); });
    el.addEventListener('click', (e) => {
      const v = e.target.closest('[data-ver]'); if (v) { estado.ver = v.dataset.ver; v.parentElement.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === v)); desenhar(el); return; }
      if (e.target.closest('[data-o="nova"]')) return form();
      const o = e.target.closest('[data-ordem]'); if (o) abrir(o.dataset.ordem);
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-ordem]')) abrir(e.target.dataset.ordem); });
    el.addEventListener('input', () => delete el.dataset.sujo);
    el.addEventListener('change', () => delete el.dataset.sujo);
  }

  // ---------------------------------------------------------------- detalhe e ações
  async function abrir(id) {
    const o = S.get('ordens', id); if (!o) return;
    const sit = C.situacaoOrdem(o);
    const maq = S.get('maquinas', o.maquina_id), resp = S.get('funcionarios', o.responsavel_id);
    const encerrada = ['entregue', 'cancelada'].includes(o.status);
    const botoes = [];
    const mudar = (status, txt, cls = 'pri', extra = {}) => ({ txt, cls, acao: async (f) => {
      const d = UI.lerForm(f);
      let prod = d.produzido ?? null;
      if (status === 'pronta') {
        // não mexeu no número: pronta = quantidade toda. Mexeu e ficou menor: confirma.
        if (prod === null || prod === o.produzido) prod = null;
        else if (prod < o.qtd && !(await UI.confirmar(`Ficou pronta com ${U.qtd(prod)} de ${U.qtd(o.qtd)} ${o.unidade}?`, { ok: `Sim, ${U.qtd(prod)}`, nao: 'Corrigir' }))) return false;
      }
      await API.rpc('ordem_status', { p: { id: o.id, status, produzido: prod, obs: d.nota || null, ...extra } });
      await App.gravou(['ordens']);
      UI.aviso(`OP ${o.numero}: ${C.situacaoOrdem(S.get('ordens', o.id)).txt.toLowerCase()}.`);
    } });
    if (!encerrada) {
      if (o.status === 'fila') botoes.push(mudar('producao', 'Começar a produzir'));
      if (o.status === 'producao') botoes.push(mudar('producao', 'Salvar quantidade', 'sec'), mudar('pronta', 'Marcar como pronta', 'verde'));
      if (o.status === 'pronta') { botoes.push(mudar('producao', 'Voltar para produção', 'sec')); if (Perm.pode('entregar')) botoes.push({ txt: 'Entregue', cls: 'verde', acao: () => entregar(o) }); }
    }
    await UI.modal({
      titulo: `OP ${o.numero} — ${o.produto}`,
      corpo: `<p>${UI.tag(sit)} ${o.prioridade ? '<span class="tag t-amarelo">Urgente</span>' : ''}</p>
        ${UI.dl([['Cliente', esc(o.cliente_nome || '')], ['Pedido do cliente', esc(o.pedido_cliente || '')], ['Código', esc(o.codigo || '')],
          ['Quantidade', `${U.qtd(o.qtd)} ${esc(o.unidade)}`], ['Prazo', o.prazo ? U.data(o.prazo) + (sit.atrasada ? ' (atrasada)' : '') : ''], ['Máquina', esc(maq?.nome || '')],
          ['Responsável', esc(resp?.nome || '')], ['Começou', o.iniciada_em ? U.dataHora(o.iniciada_em) : ''], ['Ficou pronta', o.pronta_em ? U.dataHora(o.pronta_em) : ''],
          ['Entregue', o.entregue_em ? U.data(o.entregue_em) : ''], ['Criada por', esc(S.nomeUsuario(o.criado_por))]])}
        ${o.obs ? `<p class="mt"><b>Observações</b><br>${esc(o.obs).replace(/\n/g, '<br>')}</p>` : ''}
        ${!encerrada && o.status !== 'fila' ? `<div class="mt">${UI.campo({ nome: 'produzido', rotulo: `Quantas já foram feitas (de ${U.qtd(o.qtd)})`, tipo: 'qtd', valor: U.campoNum(o.produzido, 3) })}</div>` : ''}
        ${!encerrada ? UI.campo({ nome: 'nota', rotulo: 'Anotação (opcional)', placeholder: 'Fica registrada na ordem' }) : ''}
        ${!encerrada && Perm.pode('producao_editar') ? `<div class="grupo-btn mt"><button type="button" class="btn fantasma mini" data-x="editar">${UI.ic('lapis')}<span>Editar ordem</span></button>
          ${Perm.pode('entregar') ? `<button type="button" class="btn perigo-txt mini" data-x="cancelar">${UI.ic('x')}<span>Cancelar ordem</span></button>` : ''}</div>` : ''}
        ${encerrada && Perm.pode('entregar') ? `<div class="grupo-btn mt"><button type="button" class="btn fantasma mini" data-x="reabrir">${UI.ic('desfazer')}<span>Reabrir (voltar para pronta)</span></button></div>` : ''}`,
      aoAbrir: (el, j) => el.addEventListener('click', async (e) => {
        const x = e.target.closest('[data-x]')?.dataset.x; if (!x) return;
        if (x === 'editar') { delete j.form.dataset.sujo; j.fechar(); form(o); }
        if (x === 'cancelar' && await UI.confirmar(`Cancelar a OP ${o.numero}?`, { ok: 'Cancelar ordem', perigo: true })) {
          try { await API.rpc('ordem_status', { p: { id: o.id, status: 'cancelada', obs: 'Cancelada' } }); await App.gravou(['ordens']); delete j.form.dataset.sujo; j.fechar(); UI.aviso('Ordem cancelada.'); } catch (err) { j.erro(API.traduzir(err).message); }
        }
        if (x === 'reabrir') {
          try { await API.rpc('ordem_status', { p: { id: o.id, status: 'pronta', obs: 'Reaberta' } }); await App.gravou(['ordens']); j.fechar(); UI.aviso('Ordem reaberta.'); } catch (err) { j.erro(API.traduzir(err).message); }
        }
      }),
      botoes,
    });
  }

  async function entregar(o) {
    const fin = Perm.pode('financeiro');
    const jaTem = S.lista('lancamentos').some(l => l.ordem_id === o.id);
    const r = await UI.modal({
      titulo: `Entregar OP ${o.numero}`,
      corpo: `${UI.campo({ nome: 'data', rotulo: 'Data da entrega', tipo: 'date', valor: U.hoje() })}
        ${fin && !jaTem ? `${UI.campo({ nome: 'lancar', rotulo: 'Lançar a conta a receber agora', tipo: 'check', valor: true })}
        <div id="eConta" class="linha-campos l3">${UI.campo({ nome: 'valor', rotulo: 'Valor', tipo: 'dinheiro' })}${UI.campo({ nome: 'venc', rotulo: 'Vencimento', tipo: 'date', valor: U.somaDias(U.hoje(), 28) })}
          ${UI.campo({ nome: 'parc', rotulo: 'Parcelas', tipo: 'select', opcoes: [1, 2, 3, 4].map(n => ({ v: n, t: n === 1 ? '1×' : n + '× (30 dias)' })) })}</div>` : ''}`,
      aoAbrir: (el) => { const l = el.querySelector('[name=lancar]'); if (l) { const t = () => el.querySelector('#eConta').hidden = !l.checked; l.onchange = t; t(); } },
      botoes: [{ txt: 'Confirmar entrega', cls: 'verde', acao: async (f) => {
        const d = UI.lerForm(f);
        if (d.lancar && !(d.valor > 0)) throw new API.ErroApp('Informe o valor a receber ou desmarque "lançar a conta".');
        await API.rpc('ordem_status', { p: { id: o.id, status: 'entregue', entregue_em: d.data } });
        if (d.lancar && d.valor > 0) await API.rpc('salvar_lancamento', { p: { tipo: 'receber', descricao: `${o.cliente_nome || 'Cliente'} — OP ${o.numero}${o.pedido_cliente ? ' (' + o.pedido_cliente + ')' : ''}`,
          categoria: /upgrade/i.test(o.cliente_nome || '') ? 'Upgrade' : 'Venda de peças / serviços', valor: d.valor, vencimento: d.venc, parcelas: d.parc, intervalo: '30', cliente_id: o.cliente_id, ordem_id: o.id } });
        await App.gravou(['ordens', 'lancamentos']);
        UI.aviso(`OP ${o.numero} entregue.`);
      } }],
    });
    return r ? true : false;
  }

  async function form(o) {
    const novo = !o;
    o = o || { unidade: 'pç', prioridade: 0 };
    const r = await UI.modal({
      titulo: novo ? 'Nova ordem de produção' : `Editar OP ${o.numero}`,
      corpo: `${Perm.pode('clientes') ? `<div class="campo"><label for="oCli">Cliente</label><input id="oCli" name="cliente_id" placeholder="Digite para buscar"></div>`
          : UI.campo({ nome: 'cliente_nome', rotulo: 'Cliente', valor: o.cliente_nome })}
        <div class="linha-campos">${UI.campo({ nome: 'pedido_cliente', rotulo: 'Pedido do cliente', valor: o.pedido_cliente, placeholder: 'Ex.: PC 016/26' })}
          ${UI.campo({ nome: 'codigo', rotulo: 'Código do produto', valor: o.codigo })}</div>
        ${UI.campo({ nome: 'produto', rotulo: 'Produto', valor: o.produto, req: true })}
        <div class="linha-campos l3">${UI.campo({ nome: 'qtd', rotulo: 'Quantidade', tipo: 'qtd', valor: U.campoNum(o.qtd, 3), req: true })}
          ${UI.campo({ nome: 'unidade', rotulo: 'Unidade', tipo: 'select', valor: o.unidade, opcoes: ['pç', 'un', 'kg', 'm', 'jogo', 'cx'].map(v => ({ v, t: v })) })}
          ${UI.campo({ nome: 'prazo', rotulo: 'Prazo', tipo: 'date', valor: o.prazo })}</div>
        <div class="linha-campos"><div class="campo"><label for="oMaqF">Máquina</label><input id="oMaqF" name="maquina_id" placeholder="Onde vai ser feita"></div>
          <div class="campo"><label for="oResp">Responsável</label><input id="oResp" name="responsavel_id" placeholder="Quem vai fazer"></div></div>
        ${UI.campo({ nome: 'prioridade', rotulo: 'Urgente (vai para o topo da fila)', tipo: 'check', valor: o.prioridade === 1 })}
        ${UI.campo({ nome: 'obs', rotulo: 'Observações', tipo: 'area', valor: o.obs, linhas: 2 })}`,
      aoAbrir: (el) => {
        const c = el.querySelector('#oCli'); if (c) UI.comboCliente(c, { valorInicial: S.get('clientes', o.cliente_id) });
        UI.comboMaquina(el.querySelector('#oMaqF'), { valorInicial: S.get('maquinas', o.maquina_id) });
        UI.comboFuncionario(el.querySelector('#oResp'), { valorInicial: S.get('funcionarios', o.responsavel_id) });
      },
      botoes: [{ txt: novo ? 'Criar ordem' : 'Salvar', acao: async (f) => {
        const d = UI.lerForm(f);
        d.prioridade = d.prioridade ? 1 : 0;
        if (!f.dataset.envio) f.dataset.envio = o.id || U.uuid();
        const res = await API.rpc('salvar_ordem', { p: { ...d, id: f.dataset.envio, cliente_nome: d.cliente_nome || o.cliente_nome || null } });
        await App.gravou(['ordens']);
        UI.aviso(novo ? `OP ${res.numero} criada.` : 'Ordem salva.');
        return res;
      } }],
    });
    if (r && novo && !location.hash.startsWith('#/producao')) location.hash = '#/producao';
    return r;
  }

  return { titulo: 'Ordens de produção', render, depois, cartao, abrir, form };
})();
