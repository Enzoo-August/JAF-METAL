/* Início: o que cada perfil mais faz, em primeiro lugar */
'use strict';

Telas.inicio = {
  titulo: 'Início',
  render() {
    const s = API.sessao, esc = U.esc;
    const h = U.agoraSP().getHours();
    const saud = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    const dataLonga = U.agoraSP().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    const al = C.alertas();

    const atalhos = [
      `<button type="button" class="atalho destaque" data-acao="retirar">${UI.ic('retirar')}<span>Retirar peça<small>do almoxarifado</small></span></button>`,
      Perm.pode('entrada') ? `<button type="button" class="atalho" data-acao="entrada">${UI.ic('entrada')}<span>Dar entrada<small>chegou peça</small></span></button>` : '',
      Perm.pode('compras') ? `<a class="atalho" href="#/compras/lista">${UI.ic('lista')}<span>Lista de compras<small>o que está faltando</small></span></a>` : '',
      Perm.pode('producao_editar') ? `<button type="button" class="atalho" data-ir="novaOrdem">${UI.ic('producao')}<span>Nova ordem<small>de produção</small></span></button>` : '',
      `<button type="button" class="atalho" data-ir="chamado">${UI.ic('chave')}<span>Máquina com problema<small>abrir chamado</small></span></button>`,
      Perm.pode('financeiro') ? `<button type="button" class="atalho" data-ir="conta">${UI.ic('dinheiro')}<span>Nova conta<small>a pagar ou receber</small></span></button>` : '',
    ].filter(Boolean).join('');

    let html = `
      <header class="cab"><div><h1>${saud}, ${esc((s.nome || '').split(' ')[0])}</h1><p class="sub">${U.cap(dataLonga)}</p></div></header>
      <div class="atalhos">${atalhos}</div>`;

    html += `<section class="card"><div class="card-cab"><h2>Precisa de atenção</h2></div>
      ${al.length ? `<div class="alertas">${al.map(a => `<a class="alerta n-${a.nivel}" href="${a.rota}">${UI.ic('alerta')}<span>${esc(a.txt)}</span>${UI.ic('seta')}</a>`).join('')}</div>`
        : `<p class="sub">${UI.ic('ok')} Tudo em dia por aqui.</p>`}</section>`;

    if (Perm.pode('precos')) html += this.numeros();
    if (s.perfil === 'producao') html += this.minhasOrdens() + this.minhasRetiradas();
    else if (Perm.pode('compras')) html += `<div class="grade g2 mt">${this.chegando()}${this.ultimas()}</div>`;
    return html;
  },

  numeros() {
    const hoje = U.hoje(), ini = hoje.slice(0, 8) + '01';
    const consumoMes = U.soma(C.consumos(m => m.data >= ini && m.data <= hoje), 'valor');
    const ant = U.somaMeses(ini, -1), fimAnt = U.somaDias(ini, -1);
    const consumoAnt = U.soma(C.consumos(m => m.data >= ant && m.data <= fimAnt), 'valor');
    const k = [];
    k.push(`<a class="kpi" href="#/relatorios?r=estoque"><small>Valor em estoque</small><b>${U.moeda0(C.valorEstoque())}</b><span>${U.plural(S.lista('pecas').filter(p => p.ativo && p.estoque > 0).length, 'item', 'itens')} com saldo</span></a>`);
    k.push(`<a class="kpi" href="#/relatorios?r=consumo"><small>Consumo no mês</small><b>${U.moeda0(consumoMes)}</b><span>mês passado: ${U.moeda0(consumoAnt)}</span></a>`);
    if (Perm.pode('financeiro')) {
      const ab = S.lista('lancamentos').filter(l => !l.pago_em && l.vencimento <= U.somaDias(hoje, 7));
      const pg = U.soma(ab.filter(l => l.tipo === 'pagar'), 'valor'), rc = U.soma(ab.filter(l => l.tipo === 'receber'), 'valor');
      k.push(`<a class="kpi ${pg > 0 ? '' : 'bom'}" href="#/financeiro?t=pagar"><small>A pagar em 7 dias</small><b>${U.moeda0(pg)}</b><span>inclui as vencidas</span></a>`);
      k.push(`<a class="kpi" href="#/financeiro?t=receber"><small>A receber em 7 dias</small><b>${U.moeda0(rc)}</b><span>inclui as atrasadas</span></a>`);
    } else {
      const ab = S.lista('pedidos_compra').filter(p => p.status === 'aguardando');
      k.push(`<a class="kpi" href="#/compras"><small>Pedidos em aberto</small><b>${ab.length}</b><span>${U.moeda0(U.soma(ab, p => C.totalPedido(p)))}</span></a>`);
      const op = S.lista('ordens').filter(o => ['fila', 'producao'].includes(o.status));
      k.push(`<a class="kpi" href="#/producao"><small>Ordens em andamento</small><b>${op.length}</b><span>na fila ou produzindo</span></a>`);
    }
    return `<div class="grade g4 mt">${k.join('')}</div>`;
  },

  chegando() {
    const peds = S.lista('pedidos_compra').filter(p => p.status === 'aguardando').sort((a, b) => (a.prazo || '9') < (b.prazo || '9') ? -1 : 1).slice(0, 6);
    return `<section class="card"><div class="card-cab"><h2>Para chegar</h2><a href="#/compras">Ver todos</a></div>
      ${peds.length ? `<div class="lista">${peds.map(p => { const f = S.get('fornecedores', p.fornecedor_id); const sit = C.situacaoPedido(p);
        const itens = C.itensDoPedido(p.id);
        return `<a class="linha" href="#/pedido/${p.id}"><div class="meio"><b>Nº ${p.numero} · ${U.esc(f?.nome || '')}</b>
          <small>${U.esc(itens.map(i => S.get('pecas', i.peca_id)?.codigo).filter(Boolean).join(', '))}</small></div>
          <div class="lado">${UI.tag(sit)}<small>${p.prazo ? U.relativo(p.prazo) : 'sem prazo'}</small></div></a>`; }).join('')}</div>`
        : '<p class="sub">Nenhum pedido aguardando.</p>'}</section>`;
  },

  ultimas() {
    const movs = S.lista('movimentos').slice(-8).reverse();
    return `<section class="card"><div class="card-cab"><h2>Últimas movimentações</h2><a href="#/movimentos">Ver todas</a></div>
      ${movs.length ? `<div class="lista">${movs.map(m => Telas.movimentos.linha(m, true)).join('')}</div>` : '<p class="sub">Nada lançado ainda.</p>'}</section>`;
  },

  minhasOrdens() {
    const meu = API.sessao.funcionario_id;
    let ords = S.lista('ordens').filter(o => ['fila', 'producao'].includes(o.status));
    const minhas = meu ? ords.filter(o => o.responsavel_id === meu) : [];
    if (minhas.length) ords = minhas;
    ords = ords.sort((a, b) => (b.prioridade - a.prioridade) || ((a.prazo || '9') < (b.prazo || '9') ? -1 : 1)).slice(0, 8);
    return `<section class="card mt"><div class="card-cab"><h2>${minhas.length ? 'Minhas ordens' : 'Ordens em andamento'}</h2><a href="#/producao">Ver todas</a></div>
      ${ords.length ? ords.map(o => Telas.producao.cartao(o)).join('') : '<p class="sub">Nenhuma ordem na fila.</p>'}</section>`;
  },

  minhasRetiradas() {
    const hoje = U.hoje();
    const movs = S.lista('movimentos').filter(m => m.data === hoje && m.criado_por === API.sessao.uid).reverse();
    return `<section class="card mt"><div class="card-cab"><h2>Minhas retiradas de hoje</h2></div>
      ${movs.length ? `<div class="lista">${movs.map(m => Telas.movimentos.linha(m, true)).join('')}</div>` : '<p class="sub">Você ainda não retirou nada hoje.</p>'}</section>`;
  },

  depois(el) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ir]');
      if (b) {
        const a = b.dataset.ir;
        if (a === 'novaOrdem') Telas.producao.form();
        else if (a === 'chamado') Telas.maquinas.formManutencao({ tipo: 'corretiva' });
        else if (a === 'conta') Telas.financeiro.form({});
        return;
      }
      const op = e.target.closest('[data-ordem]');
      if (op) Telas.producao.abrir(op.dataset.ordem);
    });
  },
};
