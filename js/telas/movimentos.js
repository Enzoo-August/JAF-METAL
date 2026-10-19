/* Movimentações: retirar, dar entrada, histórico e desfazer */
'use strict';

Telas.movimentos = (() => {
  const esc = U.esc;
  const MOTIVO = { compra: 'Compra', retirada: 'Retirada', ajuste: 'Ajuste de contagem', devolucao: 'Devolução', importado: 'Planilha', estorno: 'Desfeito' };
  const estado = { periodo: '30', tipo: 'todos', busca: '', func: '', maq: '' };

  const desfeitos = () => new Set(S.lista('movimentos').filter(m => m.estorno_de).map(m => m.estorno_de));

  function linha(m, curta, setDesf) {
    const p = S.get('pecas', m.peca_id) || {};
    const ent = m.tipo === 'entrada';
    const desf = (setDesf || desfeitos()).has(m.id);
    const quem = S.get('funcionarios', m.funcionario_id)?.nome || '';
    const maq = S.get('maquinas', m.maquina_id)?.nome || m.destino || '';
    const forn = Perm.pode('compras') ? S.get('fornecedores', m.fornecedor_id)?.nome : '';
    const info = [curta ? U.relativo(m.data) : U.data(m.data), MOTIVO[m.motivo] || m.motivo, quem, maq, ent && m.motivo !== 'estorno' ? forn : '', m.documento && m.motivo !== 'retirada' ? m.documento : ''].filter(Boolean);
    return `<div class="linha clicavel ${desf ? 'riscada' : ''}" data-mov="${m.id}">
      <span class="sinal ${ent ? 'ent' : 'sai'}">${UI.ic(ent ? 'entrada' : 'retirar')}</span>
      <div class="meio"><b><span class="codigo">${esc(p.codigo || '?')}</span> · ${esc(p.descricao || '')}</b><small>${esc(info.join(' · '))}${desf ? ' · desfeito' : ''}</small></div>
      <div class="lado"><b style="color:var(--${ent ? 'verde' : 'vermelho'})">${ent ? '+' : '−'}${U.qtd(m.qtd)}</b>${Perm.pode('precos') ? `<small>${U.moeda(m.qtd * m.preco_unit)}</small>` : ''}</div></div>`;
  }

  // ---------------------------------------------------------------- retirar
  async function retirar(peca) {
    const s = API.sessao, precos = Perm.pode('precos');
    const podeData = Perm.pode('entrada');
    let resultado = null;
    await UI.modal({
      titulo: 'Retirar peça',
      corpo: `
        <div class="campo"><label for="rPeca">Peça <i class="req">*</i></label><input id="rPeca" name="peca_id" required placeholder="Digite o código ou o nome"></div>
        <div id="rInfo"></div>
        <div class="linha-campos l2">
          <div class="campo"><label for="rQtd">Quantidade <i class="req">*</i></label><div class="passo-qtd"><button type="button" data-p="-1" aria-label="Menos">−</button>
            <input id="rQtd" name="qtd" data-num="qtd" inputmode="decimal" value="1" required ${peca ? 'autofocus' : ''}><button type="button" data-p="1" aria-label="Mais">+</button></div></div>
          ${podeData ? UI.campo({ nome: 'data', rotulo: 'Data', tipo: 'date', valor: U.hoje(), attrs: `max="${U.hoje()}"` }) : ''}
        </div>
        <div class="linha-campos l2">
          <div class="campo"><label for="rFunc">Quem está retirando</label><input id="rFunc" name="funcionario_id" placeholder="Nome"></div>
          <div class="campo"><label for="rMaq">Para qual máquina</label><input id="rMaq" name="maquina_id" placeholder="Máquina"></div>
        </div>
        <div id="rManut"></div>
        ${UI.campo({ nome: 'obs', rotulo: 'Observação (opcional)', placeholder: 'Ex.: troca por desgaste, quebrou…' })}`,
      aoAbrir: (el, j) => {
        const info = el.querySelector('#rInfo'), qtd = el.querySelector('#rQtd'), manut = el.querySelector('#rManut');
        const maqCombo = UI.comboMaquina(el.querySelector('#rMaq'), { novo: null, aoEscolher: () => mostrarManut() });
        UI.comboFuncionario(el.querySelector('#rFunc'), { valorInicial: S.get('funcionarios', s.funcionario_id) });
        const mostrar = () => {
          const p = S.get('pecas', el.querySelector('#rPeca').dataset.comboId);
          if (!p) { info.innerHTML = ''; return; }
          const n = U.num(qtd.value) || 0;
          const fica = p.estoque - n;
          let custo = '';
          if (precos && n > 0) {
            let falta = n, v = 0; for (const l of C.lotes(p.id)) { const t = Math.min(falta, l.resta); v += t * l.mov.preco_unit; falta -= t; if (falta <= 0) break; }
            custo = ` · custo ${U.moeda(v)}`;
          }
          info.innerHTML = `<p class="nota ${fica < 0 ? 'vermelha' : fica < p.est_min ? 'amarela' : ''}">No estoque: <b>${U.qtd(p.estoque)} ${esc(p.unidade)}</b>${p.local ? ' · prateleira ' + esc(p.local) : ''}${custo}<br>
            ${fica < 0 ? `Não tem tudo isso no sistema. Se tem na prateleira, peça ao almoxarifado para contar o estoque.` : `Depois da retirada fica <b>${U.qtd(fica)}</b>${fica < p.est_min ? ' — abaixo do mínimo (' + U.qtd(p.est_min) + ')' : ''}.`}</p>`;
        };
        const mostrarManut = () => {
          const mq = el.querySelector('#rMaq').dataset.comboId;
          const ab = mq ? C.manutAbertas(mq) : [];
          manut.innerHTML = ab.length ? UI.campo({ nome: 'manutencao_id', rotulo: 'É para esta manutenção?', tipo: 'select',
            opcoes: [{ v: '', t: 'Não, uso normal' }, ...ab.map(m => ({ v: m.id, t: `${U.data(m.data)} — ${m.problema.slice(0, 60)}` }))] }) : '';
        };
        UI.comboPeca(el.querySelector('#rPeca'), {
          valorInicial: peca,
          aoEscolher: (p) => {
            // sugere a máquina pela utilização da peça
            if (!el.querySelector('#rMaq').dataset.comboId && p.utilizacao) {
              const m = S.lista('maquinas').find(x => x.ativo && U.sem(x.nome) === U.sem(p.utilizacao));
              if (m) maqCombo.definir(m);
            }
            mostrar(); setTimeout(() => qtd.select(), 30);
          },
          aoLimpar: mostrar,
        });
        if (peca) { const m = S.lista('maquinas').find(x => x.ativo && U.sem(x.nome) === U.sem(peca.utilizacao || '')); if (m) maqCombo.definir(m); }
        el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { const n = Math.max(1, (U.num(qtd.value) || 0) + Number(b.dataset.p)); qtd.value = U.qtd(n).replace(/\./g, ''); mostrar(); el.querySelector('form').dataset.sujo = '1'; });
        qtd.addEventListener('input', mostrar);
        mostrar();
        // no computador já deixa pronto para digitar; no celular/tablet não abre o teclado sozinho
        if (!peca && matchMedia('(pointer: fine)').matches) setTimeout(() => el.querySelector('#rPeca').focus(), 50);
        j.mostrar = mostrar;
      },
      botoes: [
        { txt: 'Retirar e lançar outra', cls: 'sec', acao: async (f, j) => { await enviarRetirada(f); limpar(f, j); return false; } },
        { txt: 'Retirar', icone: 'retirar', acao: async (f) => { resultado = await enviarRetirada(f); } },
      ],
    });

    function limpar(f, j) {
      const i = f.querySelector('#rPeca'); i.value = ''; i.dataset.comboId = '';
      f.querySelector('#rQtd').value = '1'; const o = f.querySelector('[name=obs]'); if (o) o.value = '';
      f.querySelector('#rManut').innerHTML = '';
      delete f.dataset.sujo; j.mostrar(); i.focus();
    }
    return resultado;
  }

  async function enviarRetirada(f) {
    const d = UI.lerForm(f);
    const p = S.get('pecas', d.peca_id);
    if (!p) throw new API.ErroApp('Escolha a peça.');
    if (!(d.qtd > 0)) throw new API.ErroApp('Informe a quantidade.');
    const maq = S.get('maquinas', d.maquina_id);
    // id gerado aqui: se a internet cair e tocar de novo, o banco não lança duas vezes
    if (!f.dataset.envio) f.dataset.envio = U.uuid();
    const r = await API.rpc('movimentar', { p: { id: f.dataset.envio, tipo: 'saida', motivo: 'retirada', peca_id: p.id, qtd: d.qtd, data: d.data || null,
      funcionario_id: d.funcionario_id || null, maquina_id: d.maquina_id || null, destino: maq?.nome || null, manutencao_id: d.manutencao_id || null, obs: d.obs || null } });
    delete f.dataset.envio;
    await App.gravou(['pecas', 'movimentos']);
    const novo = S.get('pecas', p.id);
    const ids = r.ids || [];
    UI.aviso(`Retirado ${U.qtd(d.qtd)} × ${p.codigo}. Ficou ${U.qtd(novo.estoque)}${novo.estoque < novo.est_min ? ' (abaixo do mínimo)' : ''}.`, 'ok', {
      acao: { txt: 'Desfazer', fn: () => desfazerVarios(ids) } });
    return r;
  }

  async function desfazerVarios(ids) {
    try {
      for (const id of ids) await API.rpc('estornar', { p_id: id, p_obs: 'Desfeito logo depois de lançar' });
      await App.gravou(['pecas', 'movimentos', 'pedido_itens', 'pedidos_compra']);
      UI.aviso('Desfeito. O estoque voltou.');
    } catch (e) { UI.erro(e); }
  }

  // ---------------------------------------------------------------- entrada
  async function entrada(peca) {
    let resultado = null;
    await UI.modal({
      titulo: 'Dar entrada no estoque',
      corpo: `
        <div class="campo"><label for="ePeca">Peça <i class="req">*</i></label><input id="ePeca" name="peca_id" required placeholder="Digite o código ou o nome"></div>
        <div id="eAberto"></div>
        <div class="opcoes" role="radiogroup" aria-label="Tipo de entrada">
          <label class="opcao"><input type="radio" name="motivo" value="compra" checked><span><b>Compra</b><small>chegou do fornecedor</small></span></label>
          <label class="opcao"><input type="radio" name="motivo" value="devolucao"><span><b>Devolução</b><small>voltou da produção</small></span></label>
          <label class="opcao"><input type="radio" name="motivo" value="ajuste"><span><b>Ajuste</b><small>achei a mais</small></span></label>
        </div>
        <div class="linha-campos l2">
          ${UI.campo({ nome: 'qtd', rotulo: 'Quantidade', tipo: 'qtd', req: true, attrs: peca ? 'autofocus' : '' })}
          ${UI.campo({ nome: 'preco_unit', rotulo: 'Preço unitário', tipo: 'dinheiro', ajuda: 'Vem o último preço pago; confira na nota.' })}
        </div>
        <div class="so-compra">
          <div class="campo"><label for="eForn">Fornecedor</label><input id="eForn" name="fornecedor_id" placeholder="Digite para buscar"></div>
          <div class="linha-campos l2">
            ${UI.campo({ nome: 'documento', rotulo: 'Nota fiscal / documento', placeholder: 'Ex.: NF 000.044.892' })}
            ${UI.campo({ nome: 'data', rotulo: 'Data da entrada', tipo: 'date', valor: U.hoje(), attrs: `max="${U.hoje()}"` })}
          </div>
        </div>
        ${UI.campo({ nome: 'obs', rotulo: 'Observação (opcional)' })}
        <p class="sub" id="eTotal"></p>`,
      aoAbrir: (el, j) => {
        const fornC = UI.comboFornecedor(el.querySelector('#eForn'));
        const preco = el.querySelector('[name=preco_unit]'), qtd = el.querySelector('[name=qtd]');
        const total = () => { const q = U.num(qtd.value), v = U.num(preco.value); el.querySelector('#eTotal').innerHTML = q && v ? `Total: <b>${U.moeda(q * v)}</b>` : ''; };
        const escolheu = (p) => {
          const u = C.ultimaEntrada(p.id);
          if (u && !preco.value) preco.value = U.campoNum(u.preco_unit, 4).replace(/(,\d\d)0+$/, '$1');
          if (!el.querySelector('#eForn').dataset.comboId) { const f = S.get('fornecedores', u?.fornecedor_id || p.fornecedor_id); if (f) fornC.definir(f); }
          const ab = C.pedidosAbertosDaPeca(p.id);
          el.querySelector('#eAberto').innerHTML = ab.length ? `<div class="nota amarela"><b>Esta peça tem pedido de compra aguardando.</b> Se chegou desse pedido, receba por ele (assim o pedido é baixado):
            <div class="grupo-btn mt">${ab.map(({ ped, item }) => `<button type="button" class="btn sec mini" data-receber="${ped.id}">Receber pedido nº ${ped.numero} (faltam ${U.qtd(item.qtd - item.recebido)})</button>`).join('')}</div></div>` : '';
          total(); setTimeout(() => qtd.focus(), 30);
        };
        UI.comboPeca(el.querySelector('#ePeca'), { valorInicial: peca, aoEscolher: escolheu, aoLimpar: () => el.querySelector('#eAberto').innerHTML = '' });
        if (peca) escolheu(peca);
        el.addEventListener('change', (e) => { if (e.target.name === 'motivo') el.querySelector('.so-compra').hidden = e.target.value !== 'compra'; });
        el.addEventListener('input', total);
        el.addEventListener('click', (e) => { const b = e.target.closest('[data-receber]'); if (b) { delete el.querySelector('form').dataset.sujo; j.fechar(null); Telas.compras.receber(S.get('pedidos_compra', b.dataset.receber)); } });
      },
      botoes: [{ txt: 'Dar entrada', icone: 'entrada', acao: async (f) => {
        const d = UI.lerForm(f);
        const p = S.get('pecas', d.peca_id);
        if (!p) throw new API.ErroApp('Escolha a peça.');
        if (!(d.qtd > 0)) throw new API.ErroApp('Informe a quantidade.');
        if (d.motivo === 'compra' && !(d.preco_unit > 0) && !(await UI.confirmar('Entrada de compra sem preço?', { detalhe: 'O valor do estoque e o custo das retiradas vão ficar zerados para estas peças.', ok: 'Sim, sem preço' }))) return false;
        if (!f.dataset.envio) f.dataset.envio = U.uuid();
        const r = await API.rpc('movimentar', { p: { id: f.dataset.envio, tipo: 'entrada', motivo: d.motivo, peca_id: p.id, qtd: d.qtd,
          preco_unit: d.preco_unit, fornecedor_id: d.motivo === 'compra' ? d.fornecedor_id : null, documento: d.motivo === 'compra' ? d.documento || null : null,
          data: d.motivo === 'compra' ? d.data || null : null, obs: d.obs || null } });
        delete f.dataset.envio;
        await App.gravou(['pecas', 'movimentos']);
        UI.aviso(`Entrada de ${U.qtd(d.qtd)} × ${p.codigo}. Agora tem ${U.qtd(S.get('pecas', p.id).estoque)}.`, 'ok', { acao: { txt: 'Desfazer', fn: () => desfazerVarios(r.ids) } });
        resultado = r;
      } }],
    });
    return resultado;
  }

  // ---------------------------------------------------------------- detalhe / desfazer
  async function detalhe(id) {
    const m = S.get('movimentos', id); if (!m) return;
    const p = S.get('pecas', m.peca_id) || {};
    const desfeitoPor = S.lista('movimentos').find(x => x.estorno_de === m.id);
    const original = m.estorno_de ? S.get('movimentos', m.estorno_de) : null;
    const precos = Perm.pode('precos');
    const ped = m.pedido_item_id ? S.get('pedidos_compra', S.get('pedido_itens', m.pedido_item_id)?.pedido_id) : null;
    const podeDesfazer = !desfeitoPor && m.motivo !== 'estorno' &&
      (Perm.pode('entrada') || (m.criado_por === API.sessao.uid && m.motivo === 'retirada' && Date.now() - new Date(m.criado_em).getTime() < 2 * 3600e3));
    await UI.modal({
      titulo: (m.tipo === 'entrada' ? 'Entrada' : 'Saída') + ' — ' + (p.codigo || ''),
      corpo: `<p class="sub">${esc(p.descricao || '')}</p>
        ${UI.dl([
          ['Data', U.data(m.data)], ['Tipo', esc(MOTIVO[m.motivo] || m.motivo)], ['Quantidade', `${m.tipo === 'entrada' ? '+' : '−'}${U.qtd(m.qtd)} ${esc(p.unidade || '')}`],
          precos ? ['Preço unitário', U.moeda(m.preco_unit)] : null, precos ? ['Total', U.moeda(m.qtd * m.preco_unit)] : null,
          ['Documento / lote', esc(m.documento || '')], Perm.pode('compras') ? ['Fornecedor', esc(S.get('fornecedores', m.fornecedor_id)?.nome || '')] : null,
          ['Quem retirou', esc(S.get('funcionarios', m.funcionario_id)?.nome || '')], ['Máquina', esc(S.get('maquinas', m.maquina_id)?.nome || m.destino || '')],
          ['Manutenção', m.manutencao_id ? esc((S.get('manutencoes', m.manutencao_id)?.problema || '').slice(0, 80)) : ''],
          ['Pedido de compra', ped ? `<a href="#/pedido/${ped.id}">nº ${ped.numero}</a>` : ''],
          ['Observação', esc(m.obs || '')], ['Lançado por', esc(S.nomeUsuario(m.criado_por) || (m.motivo === 'importado' ? 'Importação da planilha' : ''))],
          ['Lançado em', U.dataHora(m.criado_em)],
        ])}
        ${desfeitoPor ? `<p class="nota amarela mt">Desfeito em ${U.dataHora(desfeitoPor.criado_em)} por ${esc(S.nomeUsuario(desfeitoPor.criado_por) || '—')}.</p>` : ''}
        ${original ? `<p class="nota mt">Este lançamento desfez uma ${original.tipo === 'entrada' ? 'entrada' : 'saída'} de ${U.data(original.data)}.</p>` : ''}
        ${!podeDesfazer && !desfeitoPor && m.motivo !== 'estorno' && !Perm.pode('entrada') ? '<p class="sub mt">Para corrigir, peça ao almoxarifado (você pode desfazer suas retiradas até 2 horas depois).</p>' : ''}`,
      botoes: podeDesfazer ? [{ txt: 'Desfazer este lançamento', cls: 'perigo', icone: 'desfazer', acao: async () => {
        if (!(await UI.confirmar('Desfazer este lançamento?', { detalhe: 'Fica registrado no histórico como "desfeito". O estoque volta ao que era.', ok: 'Desfazer', perigo: true }))) return false;
        await API.rpc('estornar', { p_id: m.id, p_obs: null });
        await App.gravou(['pecas', 'movimentos', 'pedido_itens', 'pedidos_compra']);
        UI.aviso('Lançamento desfeito.');
      } }] : [],
    });
  }

  // ---------------------------------------------------------------- histórico
  function filtrar() {
    const hoje = U.hoje();
    const de = { hoje: hoje, '7': U.somaDias(hoje, -6), '30': U.somaDias(hoje, -29), ano: hoje.slice(0, 4) + '-01-01', tudo: '0000' }[estado.periodo] || '0000';
    let l = S.lista('movimentos').filter(m => m.data >= de);
    const desf = desfeitos();
    if (estado.tipo === 'entradas') l = l.filter(m => m.tipo === 'entrada' && m.motivo !== 'estorno' && m.motivo !== 'ajuste');
    else if (estado.tipo === 'saidas') l = l.filter(m => m.tipo === 'saida' && (m.motivo === 'retirada' || m.motivo === 'importado'));
    else if (estado.tipo === 'ajustes') l = l.filter(m => m.motivo === 'ajuste');
    else if (estado.tipo === 'desfeitos') l = l.filter(m => m.motivo === 'estorno' || desf.has(m.id));
    if (estado.func) l = l.filter(m => m.funcionario_id === estado.func);
    if (estado.maq) l = l.filter(m => m.maquina_id === estado.maq);
    if (estado.busca.trim()) {
      const t = U.sem(estado.busca.trim()).split(' ');
      l = l.filter(m => { const p = S.get('pecas', m.peca_id) || {};
        const txt = U.sem([p.codigo, p.descricao, m.documento, m.obs, S.get('fornecedores', m.fornecedor_id)?.nome, S.get('funcionarios', m.funcionario_id)?.nome, S.get('maquinas', m.maquina_id)?.nome, m.destino].join(' '));
        return t.every(x => txt.includes(x)); });
    }
    return l.slice().sort((a, b) => a.data < b.data ? 1 : a.data > b.data ? -1 : b.seq - a.seq);
  }

  function renderHist() {
    const funcs = U.ordenar(S.lista('funcionarios'), f => U.sem(f.nome));
    const maqs = U.ordenar(S.lista('maquinas'), m => U.sem(m.nome));
    const acoes = [UI.btn('Retirar', 'data-acao="retirar"', 'pri', 'retirar'), Perm.pode('entrada') ? UI.btn('Dar entrada', 'data-acao="entrada"', 'sec', 'entrada') : '',
      Perm.pode('precos') ? UI.btn('Excel', 'data-h="excel"', 'sec', 'baixar') : ''].join('');
    return `${UI.cab('Movimentações', API.sessao.perfil === 'producao' ? 'Suas retiradas' : 'Tudo o que entrou e saiu do almoxarifado', acoes)}
      <div class="barra-filtros">
        <div class="busca-lista">${UI.ic('busca')}<input type="search" id="bHist" placeholder="Peça, nota, fornecedor, pessoa…" value="${esc(estado.busca)}"></div>
        ${API.sessao.perfil !== 'producao' ? `<select id="hFunc" aria-label="Pessoa"><option value="">Todas as pessoas</option>${funcs.map(f => `<option value="${f.id}" ${f.id === estado.func ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}</select>` : ''}
        <select id="hMaq" aria-label="Máquina"><option value="">Todas as máquinas</option>${maqs.map(m => `<option value="${m.id}" ${m.id === estado.maq ? 'selected' : ''}>${esc(m.nome)}</option>`).join('')}</select>
      </div>
      ${UI.chips([{ v: 'hoje', t: 'Hoje' }, { v: '7', t: '7 dias' }, { v: '30', t: '30 dias' }, { v: 'ano', t: 'Este ano' }, { v: 'tudo', t: 'Tudo' }], estado.periodo, 'per')}
      <div class="mt">${UI.chips([{ v: 'todos', t: 'Todos' }, { v: 'saidas', t: 'Retiradas' }, { v: 'entradas', t: 'Entradas' }, { v: 'ajustes', t: 'Ajustes' }, { v: 'desfeitos', t: 'Desfeitos' }], estado.tipo, 'tp')}</div>
      <p class="sub mt" id="resHist"></p>
      <div class="lista"><div data-pagina></div><button type="button" class="mais-btn" data-mais hidden><span></span></button></div>`;
  }

  function desenharHist(el) {
    const l = filtrar(), desf = desfeitos(), precos = Perm.pode('precos');
    const vivos = l.filter(m => !desf.has(m.id) && m.motivo !== 'estorno');
    const ent = vivos.filter(m => m.tipo === 'entrada'), sai = vivos.filter(m => m.tipo === 'saida');
    el.querySelector('#resHist').innerHTML = `${U.plural(l.length, 'lançamento')} · entradas <b>${U.qtd(U.soma(ent, 'qtd'))}</b>${precos ? ` (${U.moeda0(U.soma(ent, m => m.qtd * m.preco_unit))})` : ''} · saídas <b>${U.qtd(U.soma(sai, 'qtd'))}</b>${precos ? ` (${U.moeda0(U.soma(sai, m => m.qtd * m.preco_unit))})` : ''}`;
    if (!l.length) { el.querySelector('[data-pagina]').innerHTML = UI.vazio('historico', 'Nada neste período', 'Escolha outro período ou tire os filtros.'); el.querySelector('[data-mais]').hidden = true; return; }
    UI.paginar(el, l, (m) => linha(m, false, desf), 60);
  }

  function depoisHist(el) {
    desenharHist(el);
    const ref = () => desenharHist(el);
    el.querySelector('#bHist').addEventListener('input', U.debounce((e) => { estado.busca = e.target.value; ref(); }, 150));
    el.querySelector('#hFunc')?.addEventListener('change', (e) => { estado.func = e.target.value; ref(); });
    el.querySelector('#hMaq').addEventListener('change', (e) => { estado.maq = e.target.value; ref(); });
    el.addEventListener('click', (e) => {
      const per = e.target.closest('[data-per]'); if (per) { estado.periodo = per.dataset.per; per.parentElement.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === per)); ref(); return; }
      const tp = e.target.closest('[data-tp]'); if (tp) { estado.tipo = tp.dataset.tp; tp.parentElement.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === tp)); ref(); return; }
      const m = e.target.closest('[data-mov]'); if (m) { detalhe(m.dataset.mov); return; }
      if (e.target.closest('[data-h="excel"]')) exportar(filtrar());
    });
    el.addEventListener('input', () => delete el.dataset.sujo);
    el.addEventListener('change', () => delete el.dataset.sujo);
  }

  // mesmo formato da aba "Estoque" da planilha antiga
  async function exportar(lista) {
    await U.lib('xlsx');
    const linhas = lista.slice().reverse().map(m => { const p = S.get('pecas', m.peca_id) || {}; const ent = m.tipo === 'entrada';
      return { 'Data': U.d(m.data), 'Código': p.codigo, 'Descrição': p.descricao, 'Entrada': ent ? m.qtd : null, 'Saída': ent ? null : m.qtd,
        'Saldo': ent ? m.qtd : -m.qtd, 'Fornecedor': S.get('fornecedores', m.fornecedor_id)?.nome || '', 'Documento': m.documento || '',
        'R$ Unitário': m.preco_unit, 'Total Entrada (R$)': ent ? U.r2(m.qtd * m.preco_unit) : 0, 'Total Saída (R$)': ent ? 0 : U.r2(m.qtd * m.preco_unit),
        'Saldo (R$)': U.r2((ent ? 1 : -1) * m.qtd * m.preco_unit), 'Ano': Number(m.data.slice(0, 4)), 'Mês': Number(m.data.slice(5, 7)),
        'Tipo': MOTIVO[m.motivo] || m.motivo, 'Quem retirou': S.get('funcionarios', m.funcionario_id)?.nome || '', 'Máquina': S.get('maquinas', m.maquina_id)?.nome || m.destino || '', 'Obs.': m.obs || '' }; });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas, { cellDates: true }), 'Estoque');
    const blob = new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellDates: true })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await PDF.entregar(blob, `Movimentações JAF ${U.hoje()}.xlsx`);
  }

  return {
    titulo: 'Movimentações', perm: 'historico_mov',
    render: renderHist, depois: depoisHist,
    retirar, entrada, detalhe, linha, MOTIVO,
  };
})();
