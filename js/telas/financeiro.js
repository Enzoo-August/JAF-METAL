/* Financeiro: contas a pagar e a receber, fluxo de caixa */
'use strict';

Telas.financeiro = (() => {
  const esc = U.esc;
  const estado = { t: 'pagar', f: 'abertas', busca: '', cat: '' };
  const FORMAS = ['Pix', 'Boleto', 'Transferência', 'Dinheiro', 'Cartão', 'Cheque', 'Débito automático'];

  function linha(l) {
    const sit = C.situacaoConta(l);
    const quem = S.get('fornecedores', l.fornecedor_id)?.nome || S.get('clientes', l.cliente_id)?.nome || S.get('funcionarios', l.funcionario_id)?.nome || '';
    return `<div class="linha clicavel" data-conta="${l.id}">
      <span class="sinal ${l.tipo === 'receber' ? 'ent' : 'sai'}">${UI.ic(l.tipo === 'receber' ? 'entrada' : 'retirar')}</span>
      <div class="meio"><b>${esc(l.descricao)}${l.parcela ? ` <span class="fraco">(${esc(l.parcela)})</span>` : ''}</b>
        <small>${l.pago_em ? (l.tipo === 'pagar' ? 'Paga em ' : 'Recebida em ') + U.data(l.pago_em) : 'Vence ' + U.relativo(l.vencimento) + (U.relativo(l.vencimento) !== U.data(l.vencimento) ? ' · ' + U.dataCurta(l.vencimento) : '')}${quem ? ' · ' + esc(quem) : ''}${l.categoria ? ' · ' + esc(l.categoria) : ''}</small></div>
      <div class="lado"><b style="color:var(--${l.tipo === 'receber' ? 'verde' : 'texto'})">${U.moeda(l.pago_em ? l.valor_pago : l.valor)}</b>${UI.tag(sit)}</div></div>`;
  }

  function filtrar() {
    const hoje = U.hoje();
    let l = S.lista('lancamentos').filter(x => x.tipo === estado.t);
    const f = estado.f;
    if (f === 'abertas') l = l.filter(x => !x.pago_em);
    else if (f === 'vencida') l = l.filter(x => !x.pago_em && x.vencimento < hoje);
    else if (f === 'hoje') l = l.filter(x => !x.pago_em && x.vencimento === hoje);
    else if (f === 'semana') l = l.filter(x => !x.pago_em && x.vencimento <= U.somaDias(hoje, 7));
    else if (f === 'mes') l = l.filter(x => !x.pago_em && x.vencimento.slice(0, 7) === hoje.slice(0, 7));
    else if (f === 'pagas') l = l.filter(x => x.pago_em);
    if (estado.cat) l = l.filter(x => x.categoria === estado.cat);
    if (estado.busca.trim()) { const t = U.sem(estado.busca.trim()).split(' ');
      l = l.filter(x => { const s = U.sem([x.descricao, x.categoria, x.documento, x.obs, S.get('fornecedores', x.fornecedor_id)?.nome, S.get('clientes', x.cliente_id)?.nome, U.dec(x.valor)].join(' ')); return t.every(p => s.includes(p)); }); }
    return f === 'pagas' ? l.sort((a, b) => a.pago_em < b.pago_em ? 1 : -1) : l.sort((a, b) => a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0);
  }

  function renderContas(r) {
    if (r.q.get('t')) estado.t = r.q.get('t');
    if (r.q.get('f')) estado.f = r.q.get('f');
    const hoje = U.hoje(), todas = S.lista('lancamentos');
    const ab = (t) => todas.filter(x => x.tipo === t && !x.pago_em);
    const venc = (t) => ab(t).filter(x => x.vencimento < hoje);
    const cats = [...new Set(todas.filter(x => x.tipo === estado.t).map(x => x.categoria).filter(Boolean))].sort();
    const acoes = UI.btn('Nova conta', 'data-fi="nova"', 'pri', 'mais') + (Perm.pode('salarios') ? UI.btn('Lançar folha', 'data-fi="folha"', 'sec', 'equipe') : '') + `<a class="btn sec" href="#/financeiro/fluxo">${UI.ic('relatorio')}<span>Fluxo de caixa</span></a>`;
    const n = (f) => { const s = estado.f; estado.f = f; const k = filtrar().length; estado.f = s; return k; };
    return `${UI.cab('Contas a pagar e a receber', '', acoes)}
      <div class="grade g4">
        <button type="button" class="kpi ${venc('pagar').length ? 'alerta' : ''}" data-ir="pagar|vencida" style="text-align:left;font:inherit;cursor:pointer"><small>A pagar vencidas</small><b>${U.moeda0(U.soma(venc('pagar'), 'valor'))}</b><span>${U.plural(venc('pagar').length, 'conta')}</span></button>
        <button type="button" class="kpi" data-ir="pagar|abertas" style="text-align:left;font:inherit;cursor:pointer"><small>A pagar em aberto</small><b>${U.moeda0(U.soma(ab('pagar'), 'valor'))}</b><span>${U.plural(ab('pagar').length, 'conta')}</span></button>
        <button type="button" class="kpi ${venc('receber').length ? 'alerta' : ''}" data-ir="receber|vencida" style="text-align:left;font:inherit;cursor:pointer"><small>A receber atrasadas</small><b>${U.moeda0(U.soma(venc('receber'), 'valor'))}</b><span>${U.plural(venc('receber').length, 'conta')}</span></button>
        <button type="button" class="kpi" data-ir="receber|abertas" style="text-align:left;font:inherit;cursor:pointer"><small>A receber em aberto</small><b>${U.moeda0(U.soma(ab('receber'), 'valor'))}</b><span>${U.plural(ab('receber').length, 'conta')}</span></button>
      </div>
      <nav class="abas-tela mt2"><button type="button" class="${estado.t === 'pagar' ? 'on' : ''}" data-t="pagar">A pagar</button><button type="button" class="${estado.t === 'receber' ? 'on' : ''}" data-t="receber">A receber</button></nav>
      <div class="barra-filtros"><div class="busca-lista">${UI.ic('busca')}<input type="search" id="bFin" placeholder="Descrição, fornecedor, cliente, valor…" value="${esc(estado.busca)}"></div>
        <select id="fCat" aria-label="Categoria"><option value="">Todas as categorias</option>${cats.map(c => `<option ${c === estado.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      ${UI.chips([{ v: 'abertas', t: 'Em aberto', n: n('abertas') }, { v: 'vencida', t: estado.t === 'pagar' ? 'Vencidas' : 'Atrasadas', n: n('vencida') || null }, { v: 'hoje', t: 'Hoje', n: n('hoje') || null },
        { v: 'semana', t: 'Próximos 7 dias' }, { v: 'mes', t: 'Este mês' }, { v: 'pagas', t: estado.t === 'pagar' ? 'Pagas' : 'Recebidas' }, { v: 'todas', t: 'Todas' }], estado.f)}
      <p class="sub mt" id="resFin"></p>
      <div class="lista"><div data-pagina></div><button type="button" class="mais-btn" data-mais hidden><span></span></button></div>`;
  }
  function desenhar(el) {
    const l = filtrar();
    el.querySelector('#resFin').innerHTML = `${U.plural(l.length, 'conta')} · <b>${U.moeda(U.soma(l, x => x.pago_em ? x.valor_pago : x.valor))}</b>`;
    if (!l.length) { el.querySelector('[data-pagina]').innerHTML = UI.vazio('dinheiro', 'Nenhuma conta aqui'); el.querySelector('[data-mais]').hidden = true; return; }
    UI.paginar(el, l, linha, 60);
  }
  function depoisContas(el) {
    desenhar(el);
    el.querySelector('#bFin').addEventListener('input', U.debounce((e) => { estado.busca = e.target.value; desenhar(el); }, 150));
    el.querySelector('#fCat').addEventListener('change', (e) => { estado.cat = e.target.value; desenhar(el); });
    el.addEventListener('click', (e) => {
      const c = e.target.closest('[data-f]'); if (c) { estado.f = c.dataset.f; el.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c)); desenhar(el); return; }
      const t = e.target.closest('[data-t]'); if (t) { estado.t = t.dataset.t; estado.cat = ''; App.render(); return; }
      const ir = e.target.closest('[data-ir]'); if (ir) { [estado.t, estado.f] = ir.dataset.ir.split('|'); estado.cat = ''; App.render(); return; }
      const fi = e.target.closest('[data-fi]')?.dataset.fi;
      if (fi === 'nova') form({ tipo: estado.t });
      if (fi === 'folha') folha();
      const l = e.target.closest('[data-conta]'); if (l) abrir(l.dataset.conta);
    });
    el.addEventListener('input', () => delete el.dataset.sujo);
    el.addEventListener('change', () => delete el.dataset.sujo);
  }

  // ---------------------------------------------------------------- detalhe / baixa
  async function abrir(id) {
    const l = S.get('lancamentos', id); if (!l) return;
    const sit = C.situacaoConta(l);
    const grupo = l.grupo ? S.lista('lancamentos').filter(x => x.grupo === l.grupo).sort((a, b) => a.vencimento < b.vencimento ? -1 : 1) : [];
    const ped = S.get('pedidos_compra', l.pedido_id), op = S.get('ordens', l.ordem_id);
    const pagar = l.tipo === 'pagar';
    const botoes = [];
    if (!l.pago_em) botoes.push({ txt: pagar ? 'Marcar como paga' : 'Marcar como recebida', cls: 'verde', icone: 'ok', acao: async (f) => {
      const d = UI.lerForm(f);
      if (!(d.bvalor >= 0)) throw new API.ErroApp('Informe o valor.');
      await API.rpc('baixar_lancamento', { p_id: l.id, p_data: d.bdata, p_valor: d.bvalor, p_forma: d.bforma || null });
      await App.gravou(['lancamentos']); UI.aviso(pagar ? 'Conta paga.' : 'Recebimento registrado.');
    } });
    else botoes.push({ txt: pagar ? 'Desfazer pagamento' : 'Desfazer recebimento', cls: 'sec', icone: 'desfazer', validar: false, acao: async () => {
      if (!(await UI.confirmar('Voltar esta conta para "em aberto"?', { ok: 'Desfazer' }))) return false;
      await API.rpc('baixar_lancamento', { p_id: l.id, p_data: null, p_valor: null, p_forma: null });
      await App.gravou(['lancamentos']); UI.aviso('Conta voltou para em aberto.');
    } });
    await UI.modal({
      titulo: l.descricao,
      corpo: `<p>${UI.tag(sit)} <span class="sub">${pagar ? 'Conta a pagar' : 'Conta a receber'}${l.parcela ? ' · parcela ' + esc(l.parcela) : ''}</span></p>
        ${UI.dl([['Valor', `<b>${U.moeda(l.valor)}</b>`], ['Vencimento', U.data(l.vencimento)], ['Pago em', l.pago_em ? `${U.data(l.pago_em)} · ${U.moeda(l.valor_pago)}` : ''],
          ['Forma', esc(l.forma || '')], ['Categoria', esc(l.categoria || '')], ['Fornecedor', esc(S.get('fornecedores', l.fornecedor_id)?.nome || '')],
          ['Cliente', esc(S.get('clientes', l.cliente_id)?.nome || '')], ['Funcionário', esc(S.get('funcionarios', l.funcionario_id)?.nome || '')],
          ['Pedido de compra', ped ? `<a href="#/pedido/${ped.id}">nº ${ped.numero}</a>` : ''], ['Ordem de produção', op ? `OP ${op.numero}` : ''],
          ['Documento', esc(l.documento || '')], ['Observações', esc(l.obs || '')], ['Lançada por', esc(S.nomeUsuario(l.criado_por))]])}
        ${grupo.length > 1 ? `<p class="mt"><b>Parcelas</b></p><div class="lista">${grupo.map(g => `<div class="linha ${g.id === l.id ? 'on' : ''}" style="min-height:44px"><div class="meio"><b>${esc(g.parcela || '')} · ${U.data(g.vencimento)}</b></div><div class="lado">${U.moeda(g.valor)} ${UI.tag(C.situacaoConta(g))}</div></div>`).join('')}</div>` : ''}
        ${!l.pago_em ? `<div class="card mt" style="background:var(--cartao-2)"><div class="linha-campos l3">
          ${UI.campo({ nome: 'bdata', rotulo: pagar ? 'Pago em' : 'Recebido em', tipo: 'date', valor: U.hoje() })}
          ${UI.campo({ nome: 'bvalor', rotulo: 'Valor', tipo: 'dinheiro', valor: U.campoNum(l.valor), ajuda: 'Mude se teve juros ou desconto' })}
          ${UI.campo({ nome: 'bforma', rotulo: 'Forma', tipo: 'select', valor: l.forma || '', opcoes: [{ v: '', t: '—' }, ...FORMAS.map(v => ({ v, t: v }))] })}</div></div>` : ''}
        <div class="grupo-btn mt"><button type="button" class="btn fantasma mini" data-x="editar">${UI.ic('lapis')}<span>Editar</span></button>
          <button type="button" class="btn perigo-txt mini" data-x="excluir">${UI.ic('lixo')}<span>Excluir</span></button></div>`,
      aoAbrir: (el, j) => el.addEventListener('click', async (e) => {
        const x = e.target.closest('[data-x]')?.dataset.x; if (!x) return;
        if (x === 'editar') { delete j.form.dataset.sujo; j.fechar(); form(l); }
        if (x === 'excluir') {
          const abertasGrupo = grupo.filter(g => !g.pago_em).length;
          const todas = grupo.length > 1 && abertasGrupo > 1 && await UI.confirmar(`Esta conta tem ${grupo.length} parcelas. Excluir também as outras ${abertasGrupo - 1} que não foram pagas?`, { ok: 'Excluir todas em aberto', nao: 'Só esta' });
          if (!todas && !(await UI.confirmar('Excluir esta conta?', { detalhe: 'Fica registrado no histórico de alterações.', ok: 'Excluir', perigo: true }))) return;
          try { const n = await API.rpc('excluir_lancamento', { p_id: l.id, p_grupo: !!todas }); await App.gravou(['lancamentos'], { inteira: ['lancamentos'] }); delete j.form.dataset.sujo; j.fechar(); UI.aviso(`${U.plural(n, 'conta excluída', 'contas excluídas')}.`); }
          catch (err) { j.erro(API.traduzir(err).message); }
        }
      }),
      botoes,
    });
  }

  // ---------------------------------------------------------------- nova / editar
  async function form(l = {}) {
    const novo = !l.id;
    const cats = C.categorias();
    let tipo = l.tipo || 'pagar';
    const r = await UI.modal({
      titulo: novo ? 'Nova conta' : 'Editar conta',
      corpo: `<div class="opcoes" role="radiogroup">
          <label class="opcao"><input type="radio" name="tipo" value="pagar" ${tipo === 'pagar' ? 'checked' : ''}><span><b>A pagar</b><small>despesa</small></span></label>
          <label class="opcao"><input type="radio" name="tipo" value="receber" ${tipo === 'receber' ? 'checked' : ''}><span><b>A receber</b><small>receita</small></span></label></div>
        ${UI.campo({ nome: 'descricao', rotulo: 'Descrição', valor: l.descricao, req: true, placeholder: 'Ex.: Energia elétrica, Upgrade — PC 016/26' })}
        <div class="linha-campos">${UI.campo({ nome: 'valor', rotulo: novo ? 'Valor total' : 'Valor', tipo: 'dinheiro', valor: U.campoNum(l.valor), req: true })}
          ${UI.campo({ nome: 'vencimento', rotulo: novo ? '1º vencimento' : 'Vencimento', tipo: 'date', valor: l.vencimento || U.hoje(), req: true })}</div>
        ${novo ? `<div class="linha-campos">${UI.campo({ nome: 'parcelas', rotulo: 'Repetir / parcelar', tipo: 'select', opcoes: [1, 2, 3, 4, 5, 6, 10, 12].map(n => ({ v: n, t: n === 1 ? 'Só uma vez' : n + ' vezes' })) })}
          ${UI.campo({ nome: 'intervalo', rotulo: 'De quanto em quanto', tipo: 'select', opcoes: [{ v: 'mensal', t: 'Todo mês (mesmo dia)' }, { v: '30', t: 'A cada 30 dias' }, { v: '28', t: 'A cada 28 dias' }, { v: '15', t: 'A cada 15 dias' }, { v: '7', t: 'Toda semana' }] })}</div>
          <p class="sub" id="lParc"></p>` : ''}
        <div class="linha-campos">${UI.campo({ nome: 'categoria', rotulo: 'Categoria', valor: l.categoria, attrs: 'list="lCat"' })}
          ${UI.campo({ nome: 'forma', rotulo: 'Forma', tipo: 'select', valor: l.forma || '', opcoes: [{ v: '', t: '—' }, ...FORMAS.map(v => ({ v, t: v }))] })}</div>
        <datalist id="lCat"></datalist>
        <div class="campo so-pagar"><label for="lForn">Fornecedor</label><input id="lForn" name="fornecedor_id" placeholder="Opcional"></div>
        <div class="campo so-receber"><label for="lCli">Cliente</label><input id="lCli" name="cliente_id" placeholder="Opcional"></div>
        ${UI.campo({ nome: 'documento', rotulo: 'Documento (NF, boleto…)', valor: l.documento })}
        ${UI.campo({ nome: 'obs', rotulo: 'Observações', tipo: 'area', valor: l.obs, linhas: 2 })}
        ${novo ? UI.campo({ nome: 'jaPago', rotulo: 'Já foi paga / recebida hoje', tipo: 'check' }) : ''}`,
      aoAbrir: (el) => {
        UI.comboFornecedor(el.querySelector('#lForn'), { valorInicial: S.get('fornecedores', l.fornecedor_id) });
        UI.comboCliente(el.querySelector('#lCli'), { valorInicial: S.get('clientes', l.cliente_id) });
        const troca = () => {
          tipo = el.querySelector('[name=tipo]:checked').value;
          el.querySelector('.so-pagar').hidden = tipo !== 'pagar'; el.querySelector('.so-receber').hidden = tipo !== 'receber';
          el.querySelector('#lCat').innerHTML = cats[tipo].map(c => `<option value="${esc(c)}">`).join('');
        };
        const parc = () => { const p = el.querySelector('#lParc'); if (!p) return; const n = Number(el.querySelector('[name=parcelas]').value), v = U.num(el.querySelector('[name=valor]').value);
          p.textContent = n > 1 && v ? `${n} contas de ${U.moeda(Math.floor(v / n * 100) / 100)} (o total ${U.moeda(v)} é dividido; para repetir o mesmo valor todo mês, digite o valor × ${n}).` : ''; };
        el.addEventListener('change', (e) => { if (e.target.name === 'tipo') troca(); parc(); });
        el.addEventListener('input', parc);
        troca(); parc();
      },
      botoes: [{ txt: novo ? 'Lançar' : 'Salvar', acao: async (f) => {
        const d = UI.lerForm(f);
        if (d.tipo === 'pagar') d.cliente_id = null; else d.fornecedor_id = null;
        if (!f.dataset.envio) f.dataset.envio = l.id || U.uuid();
        const payload = { ...d, id: f.dataset.envio, pedido_id: l.pedido_id || null, ordem_id: l.ordem_id || null, funcionario_id: l.funcionario_id || null };
        if (!novo) { payload.pago_em = l.pago_em; payload.valor_pago = l.valor_pago; }
        if (novo && d.jaPago) { payload.pago_em = U.hoje(); }
        const id = await API.rpc('salvar_lancamento', { p: payload });
        await App.gravou(['lancamentos']);
        UI.aviso(novo ? 'Conta lançada.' : 'Conta salva.');
        return id;
      } }],
    });
    return r;
  }

  // folha do mês: uma conta com a soma dos salários dos ativos
  async function folha() {
    const ativos = S.lista('funcionarios').filter(f => f.ativo);
    const sal = ativos.map(f => ({ f, s: Number(S.get('funcionarios_privado', f.id)?.salario) || 0 }));
    const total = U.soma(sal, 's'), sem = sal.filter(x => !x.s);
    const hoje = U.hoje(), mes = U.nomeMes(Number(hoje.slice(5, 7))) + '/' + hoje.slice(0, 4);
    const jaTem = S.lista('lancamentos').some(l => l.categoria === 'Folha de pagamento' && l.descricao.includes(mes));
    await form({ tipo: 'pagar', descricao: `Folha de pagamento ${mes}`, categoria: 'Folha de pagamento', valor: total, vencimento: U.somaMeses(hoje.slice(0, 8) + '05', 1),
      obs: `${ativos.length} funcionários ativos.${sem.length ? ' Sem salário cadastrado: ' + sem.map(x => x.f.nome).join(', ') + '.' : ''}${jaTem ? ' ATENÇÃO: já existe uma folha deste mês lançada.' : ''}` });
  }

  // ---------------------------------------------------------------- fluxo de caixa
  function saldoHoje() {
    const si = S.cfg('saldo_inicial', null);
    if (!si || si.valor === undefined) return null;
    const de = si.data || '0000';
    // no dia em que o saldo foi informado, só conta o que foi baixado DEPOIS de informar
    const pagos = S.lista('lancamentos').filter(l => l.pago_em && (l.pago_em > de || (l.pago_em === de && (!si.em || l.atualizado_em > si.em))));
    return Number(si.valor) + U.soma(pagos.filter(l => l.tipo === 'receber'), 'valor_pago') - U.soma(pagos.filter(l => l.tipo === 'pagar'), 'valor_pago');
  }

  function renderFluxo() {
    const hoje = U.hoje(), saldo = saldoHoje();
    const ini = U.somaMeses(hoje.slice(0, 8) + '01', -3);
    const meses = [];
    for (let i = 0; i < 10; i++) { const a = U.somaMeses(ini, i); meses.push({ ini: a, fim: U.somaDias(U.somaMeses(a, 1), -1) }); }
    const L = S.lista('lancamentos');
    for (const m of meses) {
      const dentro = (d) => d >= m.ini && d <= m.fim;
      m.recebido = U.soma(L.filter(l => l.tipo === 'receber' && l.pago_em && dentro(l.pago_em)), 'valor_pago');
      m.pago = U.soma(L.filter(l => l.tipo === 'pagar' && l.pago_em && dentro(l.pago_em)), 'valor_pago');
      m.aReceber = U.soma(L.filter(l => l.tipo === 'receber' && !l.pago_em && dentro(l.vencimento < hoje ? hoje : l.vencimento)), 'valor');
      m.aPagar = U.soma(L.filter(l => l.tipo === 'pagar' && !l.pago_em && dentro(l.vencimento < hoje ? hoje : l.vencimento)), 'valor');
    }
    // saldo projetado: a partir de hoje
    let acum = saldo ?? 0;
    for (const m of meses) {
      if (m.fim < hoje.slice(0, 8) + '01') { m.proj = null; continue; }
      acum += m.aReceber - m.aPagar; m.proj = acum;
    }
    const proxDias = (n) => { const ate = U.somaDias(hoje, n); return (saldo ?? 0) + U.soma(L.filter(l => l.tipo === 'receber' && !l.pago_em && l.vencimento <= ate), 'valor') - U.soma(L.filter(l => l.tipo === 'pagar' && !l.pago_em && l.vencimento <= ate), 'valor'); };
    return `${UI.voltar('#/financeiro', 'Contas')}
      ${UI.cab('Fluxo de caixa', 'O que entrou, o que saiu e o que vem pela frente', UI.btn('Informar saldo do caixa', 'data-fl="saldo"', 'sec', 'dinheiro'))}
      ${saldo === null ? `<p class="nota amarela">Informe quanto tem hoje no caixa/banco (botão acima) para o sistema calcular o saldo e a projeção. Sem isso, a projeção começa do zero.</p>` : ''}
      <div class="grade g4 mt">
        <div class="kpi ${saldo !== null && saldo < 0 ? 'alerta' : ''}"><small>Saldo hoje (estimado)</small><b>${saldo === null ? '—' : U.moeda0(saldo)}</b><span>${saldo === null ? 'informe o saldo' : 'desde ' + U.data(S.cfg('saldo_inicial').data)}</span></div>
        ${[7, 30, 90].map(n => { const v = proxDias(n); return `<div class="kpi ${v < 0 ? 'alerta' : ''}"><small>Em ${n} dias</small><b>${U.moeda0(v)}</b><span>se tudo for pago e recebido em dia</span></div>`; }).join('')}
      </div>
      <section class="card mt"><div class="tabela-caixa"><table class="tabela cartoes"><thead><tr><th>Mês</th><th class="num">Recebido</th><th class="num">Pago</th><th class="num">A receber</th><th class="num">A pagar</th><th class="num">Resultado</th><th class="num">Saldo projetado</th></tr></thead>
        <tbody>${meses.map(m => { const res = m.recebido + m.aReceber - m.pago - m.aPagar; const atual = hoje >= m.ini && hoje <= m.fim;
          return `<tr style="${atual ? 'background:var(--marca-suave)' : ''}"><td data-r="Mês" class="titulo">${U.cap(U.nomeMes(Number(m.ini.slice(5, 7))))} ${m.ini.slice(0, 4)}${atual ? ' (atual)' : ''}</td>
          <td data-r="Recebido" class="num">${U.moeda0(m.recebido)}</td><td data-r="Pago" class="num">${U.moeda0(m.pago)}</td>
          <td data-r="A receber" class="num">${m.aReceber ? U.moeda0(m.aReceber) : '—'}</td><td data-r="A pagar" class="num">${m.aPagar ? U.moeda0(m.aPagar) : '—'}</td>
          <td data-r="Resultado" class="num" style="color:var(--${res < 0 ? 'vermelho' : 'verde'});font-weight:700">${U.moeda0(res)}</td>
          <td data-r="Saldo projetado" class="num">${m.proj === null ? '—' : `<b style="color:var(--${m.proj < 0 ? 'vermelho' : 'texto'})">${U.moeda0(m.proj)}</b>`}</td></tr>`; }).join('')}</tbody></table></div>
        <p class="sub mt">Contas vencidas e não pagas entram no mês atual. "Resultado" = recebido + a receber − pago − a pagar.</p></section>
      ${Perm.pode('relatorios') ? `<p class="mt"><a href="#/relatorios?r=financeiro">Ver despesas e receitas por categoria →</a></p>` : ''}`;
  }

  function depoisFluxo(el) {
    el.addEventListener('click', async (e) => {
      if (!e.target.closest('[data-fl="saldo"]')) return;
      const atual = saldoHoje();
      await UI.modal({
        titulo: 'Saldo do caixa hoje',
        corpo: `<p class="sub">Some o que tem em caixa e nas contas do banco hoje. A partir daí o sistema soma o que for recebido e tira o que for pago.</p>
          ${UI.campo({ nome: 'valor', rotulo: 'Saldo de hoje', tipo: 'dinheiro', valor: atual === null ? '' : U.campoNum(atual), req: true })}`,
        botoes: [{ txt: 'Salvar', acao: async (f) => {
          const d = UI.lerForm(f); if (d.valor === null) throw new API.ErroApp('Informe o saldo.');
          await API.rpc('salvar_config', { p_chave: 'saldo_inicial', p_valor: { valor: d.valor, data: U.hoje(), em: new Date().toISOString() } });
          await App.gravou(['config']); UI.aviso('Saldo salvo.');
        } }],
      });
    });
  }

  return {
    titulo: (r) => r.sub === 'fluxo' ? 'Fluxo de caixa' : 'Contas', perm: 'financeiro',
    render(r) { return r.sub === 'fluxo' ? renderFluxo() : renderContas(r); },
    depois(el, r) { if (r.sub === 'fluxo') depoisFluxo(el); else depoisContas(el); },
    linha, abrir, form, saldoHoje,
  };
})();
