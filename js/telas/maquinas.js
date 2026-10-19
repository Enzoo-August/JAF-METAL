/* Máquinas e manutenção */
'use strict';

Telas.maquinas = (() => {
  const esc = U.esc;
  const estado = { f: 'todas', busca: '' };
  const TIPO = { preventiva: 'Preventiva', corretiva: 'Corretiva (problema)', melhoria: 'Melhoria' };
  const ST = { aberta: ['Aberta', 'vermelho'], andamento: ['Em andamento', 'amarelo'], concluida: ['Concluída', 'verde'] };

  // custo de peças retiradas para a máquina (pela máquina escolhida na retirada)
  const custoPecas = (maq, de) => U.soma(C.consumos(m => m.maquina_id === maq.id && m.data >= de), 'valor');

  function cartao(m) {
    const sit = C.situacaoMaquina(m);
    const prox = C.proximaPreventiva(m);
    const ab = C.manutAbertas(m.id);
    return `<a class="card linha-card" href="#/maquina/${m.id}" style="display:block;color:inherit;text-decoration:none">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><b>${esc(m.nome)}</b><div class="sub">${esc([m.tipo, m.setor].filter(Boolean).join(' · ') || '—')}</div></div>${UI.tag(sit)}</div>
      <p class="sub mt" style="margin-bottom:0">${ab.length ? `${UI.ic('alerta')} ${esc(ab[0].problema.slice(0, 70))}` : prox ? `Próxima preventiva: <b>${U.relativo(prox)}</b>` : m.preventiva_dias ? 'Registre a última preventiva' : 'Sem preventiva programada'}</p></a>`;
  }

  function filtrar() {
    let l = S.lista('maquinas');
    if (estado.f === 'inativas') l = l.filter(m => !m.ativo); else l = l.filter(m => m.ativo);
    if (estado.f === 'problema') l = l.filter(m => ['parada', 'manut'].includes(C.situacaoMaquina(m).cod));
    if (estado.f === 'preventiva') l = l.filter(m => ['prevvencida', 'prevlogo', 'semprev'].includes(C.situacaoMaquina(m).cod));
    return estado.busca.trim() ? U.buscar(l, estado.busca, m => [m.nome, m.tipo || '', m.setor || '', m.fabricante || ''])
      : U.ordenar(l, m => { const c = C.situacaoMaquina(m).cod; return (c === 'parada' ? '0' : c === 'manut' ? '1' : c === 'prevvencida' ? '2' : '5') + U.sem(m.nome); });
  }

  function renderLista(r) {
    if (r.q.get('f')) estado.f = r.q.get('f');
    const at = S.lista('maquinas').filter(m => m.ativo);
    const prob = at.filter(m => ['parada', 'manut'].includes(C.situacaoMaquina(m).cod)).length;
    const prev = at.filter(m => ['prevvencida', 'prevlogo', 'semprev'].includes(C.situacaoMaquina(m).cod)).length;
    const abertas = U.ordenar(C.manutAbertas(), m => m.data, true);
    return `${UI.cab('Máquinas e manutenção', 'Situação de cada máquina, preventivas e chamados',
        UI.btn('Máquina com problema', 'data-m="chamado"', 'pri', 'chave') + (Perm.pode('maquinas_editar') ? UI.btn('Nova máquina', 'data-m="nova"', 'sec', 'mais') : ''))}
      ${abertas.length ? `<section class="card"><div class="card-cab"><h2>Chamados abertos</h2></div><div class="lista">${abertas.map(m => linhaManut(m)).join('')}</div></section>` : ''}
      <div class="barra-filtros mt"><div class="busca-lista">${UI.ic('busca')}<input type="search" id="bMaq" placeholder="Buscar máquina" value="${esc(estado.busca)}"></div></div>
      ${UI.chips([{ v: 'todas', t: 'Todas' }, { v: 'problema', t: 'Com problema', n: prob || null }, { v: 'preventiva', t: 'Preventiva', n: prev || null }, { v: 'inativas', t: 'Desativadas' }], estado.f)}
      <div class="grade g-auto mt" id="gMaq"></div>`;
  }
  function desenhar(el) {
    const l = filtrar();
    el.querySelector('#gMaq').innerHTML = l.length ? l.map(cartao).join('') : UI.vazio('maquina', 'Nenhuma máquina aqui', Perm.pode('maquinas_editar') ? 'Cadastre as máquinas da fábrica para controlar manutenção e o gasto de peças de cada uma.' : '');
  }
  function depoisLista(el) {
    desenhar(el);
    el.querySelector('#bMaq').addEventListener('input', U.debounce((e) => { estado.busca = e.target.value; desenhar(el); }, 120));
    el.addEventListener('click', (e) => {
      const c = e.target.closest('[data-f]'); if (c) { estado.f = c.dataset.f; el.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c)); desenhar(el); return; }
      const a = e.target.closest('[data-m]')?.dataset.m;
      if (a === 'nova') form();
      if (a === 'chamado') formManutencao({ tipo: 'corretiva' });
      const mt = e.target.closest('[data-manut]'); if (mt) formManutencao(S.get('manutencoes', mt.dataset.manut));
    });
    el.addEventListener('input', () => delete el.dataset.sujo);
  }

  function linhaManut(m, comMaquina = true) {
    const mq = S.get('maquinas', m.maquina_id);
    const [st, cor] = ST[m.status] || [m.status, 'cinza'];
    const pecas = U.soma(C.consumos(x => x.manutencao_id === m.id), 'valor');
    const custo = (Number(m.custo_servico) || 0) + pecas;
    const quem = S.get('fornecedores', m.fornecedor_id)?.nome || S.get('funcionarios', m.funcionario_id)?.nome || '';
    return `<div class="linha clicavel" data-manut="${m.id}"><div class="meio"><b>${comMaquina && mq ? esc(mq.nome) + ' · ' : ''}${esc(m.problema)}</b>
      <small>${U.data(m.data)} · ${TIPO[m.tipo]}${quem ? ' · ' + esc(quem) : ''}${m.horas_parada ? ' · ' + U.qtd(m.horas_parada) + ' h parada' : ''}</small></div>
      <div class="lado">${UI.tag({ txt: st, cor })}${Perm.pode('precos') && custo ? `<small>${U.moeda(custo)}</small>` : ''}</div></div>`;
  }

  // ---------------------------------------------------------------- ficha
  function renderFicha(id) {
    const m = S.get('maquinas', id);
    if (!m) return UI.vazio('maquina', 'Máquina não encontrada', '', '<a class="btn pri" href="#/maquinas">Voltar</a>');
    const sit = C.situacaoMaquina(m), prox = C.proximaPreventiva(m), ult = C.ultimaPreventiva(m.id);
    const manut = U.ordenar(S.lista('manutencoes').filter(x => x.maquina_id === m.id), x => x.data + x.criado_em, true);
    const de12 = U.somaMeses(U.hoje(), -12);
    const precos = Perm.pode('precos');
    const cp = precos ? custoPecas(m, de12) : 0;
    const cs = U.soma(manut.filter(x => x.data >= de12), 'custo_servico');
    const horas = U.soma(manut.filter(x => x.data >= de12), 'horas_parada');
    const pecas = U.ordenar(S.lista('pecas').filter(p => p.ativo && p.utilizacao && U.sem(p.utilizacao).includes(U.sem(m.nome))), p => U.sem(p.codigo));
    return `${UI.voltar('#/maquinas', 'Máquinas')}
      <header class="cab"><div><h1>${esc(m.nome)} ${UI.tag(sit)}</h1><p class="sub">${esc([m.tipo, m.fabricante, m.modelo, m.setor].filter(Boolean).join(' · '))}</p></div>
        <div class="acoes">${UI.btn('Abrir chamado', 'data-m="chamado"', 'pri', 'chave')}${UI.btn('Registrar preventiva', 'data-m="prev"', 'sec', 'ok')}${Perm.pode('maquinas_editar') ? UI.btn('Editar', 'data-m="editar"', 'fantasma', 'lapis') : ''}</div></header>
      <div class="grade g4">
        <div class="kpi"><small>Preventiva</small><b style="font-size:1.15rem">${prox ? U.relativo(prox) : m.preventiva_dias ? 'sem registro' : '—'}</b><span>${m.preventiva_dias ? `a cada ${m.preventiva_dias} dias${ult ? ' · última ' + U.dataCurta(ult) : ''}` : 'sem prazo definido'}</span></div>
        <div class="kpi"><small>Paradas (12 meses)</small><b>${U.qtd(horas)} h</b><span>${U.plural(manut.filter(x => x.data >= de12 && x.tipo === 'corretiva').length, 'problema')}</span></div>
        ${precos ? `<div class="kpi"><small>Peças (12 meses)</small><b>${U.moeda0(cp)}</b><span>retiradas para esta máquina</span></div>
        <div class="kpi"><small>Serviços (12 meses)</small><b>${U.moeda0(cs)}</b><span>técnicos e terceiros</span></div>` : ''}
      </div>
      ${UI.dl([['Número de série', esc(m.numero_serie || '')], ['Ano', m.ano || ''], ['Observações', esc(m.obs || '')]]) ? `<section class="card mt">${UI.dl([['Número de série', esc(m.numero_serie || '')], ['Ano', m.ano || ''], ['Observações', esc(m.obs || '')]])}</section>` : ''}
      <section class="card mt"><div class="card-cab"><h2>Histórico de manutenção</h2><span class="sub">${U.plural(manut.length, 'registro')}</span></div>
        ${manut.length ? `<div class="lista">${manut.map(x => linhaManut(x, false)).join('')}</div>` : '<p class="sub">Nada registrado ainda.</p>'}</section>
      ${pecas.length ? `<section class="card mt"><div class="card-cab"><h2>Peças de reposição desta máquina</h2><span class="sub">pelo campo "onde é usada"</span></div><div class="lista">${pecas.map(p => Telas.pecas.linha(p)).join('')}</div></section>` : ''}`;
  }
  function depoisFicha(el, r) {
    const m = S.get('maquinas', r.id); if (!m) return;
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-m]')?.dataset.m;
      if (a === 'editar') form(m);
      if (a === 'chamado') formManutencao({ tipo: 'corretiva', maquina_id: m.id });
      if (a === 'prev') formManutencao({ tipo: 'preventiva', maquina_id: m.id, status: 'concluida', problema: 'Manutenção preventiva' });
      const mt = e.target.closest('[data-manut]'); if (mt) formManutencao(S.get('manutencoes', mt.dataset.manut));
    });
  }

  // ---------------------------------------------------------------- cadastros
  async function form(m, nomeInicial) {
    const novo = !m;
    m = m || { ativo: true, nome: nomeInicial || '' };
    const setores = [...new Set(S.lista('maquinas').map(x => x.setor).filter(Boolean))];
    const id = await UI.modal({
      titulo: novo ? 'Nova máquina' : 'Editar máquina',
      corpo: `${UI.campo({ nome: 'nome', rotulo: 'Nome / identificação', valor: m.nome, req: true, ajuda: 'Ex.: Torno CNC 02, TA 25' })}
        <div class="linha-campos">${UI.campo({ nome: 'tipo', rotulo: 'Tipo', valor: m.tipo, placeholder: 'Torno, fresadora, prensa…' })}
          ${UI.campo({ nome: 'setor', rotulo: 'Setor', valor: m.setor, attrs: 'list="lSetor"' })}</div><datalist id="lSetor">${setores.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
        <div class="linha-campos">${UI.campo({ nome: 'fabricante', rotulo: 'Fabricante', valor: m.fabricante })}${UI.campo({ nome: 'modelo', rotulo: 'Modelo', valor: m.modelo })}</div>
        <div class="linha-campos">${UI.campo({ nome: 'numero_serie', rotulo: 'Nº de série', valor: m.numero_serie })}${UI.campo({ nome: 'ano', rotulo: 'Ano', tipo: 'num', valor: m.ano })}
          ${UI.campo({ nome: 'preventiva_dias', rotulo: 'Preventiva a cada (dias)', tipo: 'num', valor: m.preventiva_dias, ajuda: 'Em branco = sem preventiva programada' })}</div>
        ${UI.campo({ nome: 'obs', rotulo: 'Observações', tipo: 'area', valor: m.obs, linhas: 2 })}
        ${novo ? '' : UI.campo({ nome: 'ativo', rotulo: 'Máquina ativa', tipo: 'check', valor: m.ativo })}`,
      botoes: [{ txt: novo ? 'Cadastrar' : 'Salvar', acao: async (f) => {
        const d = UI.lerForm(f); if (novo) d.ativo = true;
        const r = await API.rpc('salvar_maquina', { p: { ...d, id: m.id } });
        await App.gravou(['maquinas']); UI.aviso(novo ? 'Máquina cadastrada.' : 'Máquina salva.'); return r;
      } }],
    });
    return id;
  }
  async function novaRapida(nome) { const id = await form(null, nome); return id ? S.get('maquinas', id) : null; }

  async function formManutencao(m = {}) {
    const novo = !m.id;
    const podeCusto = Perm.pode('precos');
    const usadas = m.id ? C.consumos(x => x.manutencao_id === m.id) : [];
    const id = await UI.modal({
      titulo: novo ? (m.tipo === 'preventiva' ? 'Registrar preventiva' : 'Máquina com problema') : 'Manutenção',
      corpo: `<div class="campo"><label for="mMaq">Máquina <i class="req">*</i></label><input id="mMaq" name="maquina_id" required placeholder="Digite para buscar"></div>
        <div class="linha-campos">${UI.campo({ nome: 'tipo', rotulo: 'Tipo', tipo: 'select', valor: m.tipo || 'corretiva', opcoes: Object.entries(TIPO).map(([v, t]) => ({ v, t })) })}
          ${UI.campo({ nome: 'data', rotulo: 'Data', tipo: 'date', valor: m.data || U.hoje() })}
          ${UI.campo({ nome: 'status', rotulo: 'Situação', tipo: 'select', valor: m.status || 'aberta', opcoes: Object.entries(ST).map(([v, [t]]) => ({ v, t })) })}</div>
        ${UI.campo({ nome: 'problema', rotulo: m.tipo === 'preventiva' ? 'O que foi feito' : 'O que está acontecendo', tipo: 'area', valor: m.problema, req: true, linhas: 2, placeholder: 'Ex.: barulho no cabeçote, vazamento de óleo…' })}
        ${UI.campo({ nome: 'solucao', rotulo: 'Solução / serviço feito', tipo: 'area', valor: m.solucao, linhas: 2 })}
        <div class="linha-campos">
          <div class="campo"><label for="mFunc">Quem cuidou (da equipe)</label><input id="mFunc" name="funcionario_id" placeholder="Nome"></div>
          ${Perm.pode('compras') ? `<div class="campo"><label for="mForn">Técnico / empresa de fora</label><input id="mForn" name="fornecedor_id" placeholder="Eletricista, mecânico…"></div>` : ''}
        </div>
        <div class="linha-campos">${podeCusto ? UI.campo({ nome: 'custo_servico', rotulo: 'Custo do serviço', tipo: 'dinheiro', valor: U.campoNum(m.custo_servico) }) : ''}
          ${UI.campo({ nome: 'horas_parada', rotulo: 'Horas com a máquina parada', tipo: 'num', valor: U.campoNum(m.horas_parada, 1) })}</div>
        ${usadas.length ? `<p class="sub">Peças usadas: ${usadas.map(u => esc(S.get('pecas', u.mov.peca_id)?.codigo + ' × ' + U.qtd(u.qtd))).join(', ')}${podeCusto ? ' — ' + U.moeda(U.soma(usadas, 'valor')) : ''}</p>` : ''}
        ${!novo ? `<p class="sub">Para ligar uma peça a esta manutenção, use <b>Retirar peça</b> e escolha esta máquina.</p>` : ''}`,
      aoAbrir: (el) => {
        UI.comboMaquina(el.querySelector('#mMaq'), { valorInicial: S.get('maquinas', m.maquina_id) });
        UI.comboFuncionario(el.querySelector('#mFunc'), { valorInicial: S.get('funcionarios', m.funcionario_id || (novo ? API.sessao.funcionario_id : null)) });
        const fi = el.querySelector('#mForn'); if (fi) UI.comboFornecedor(fi, { valorInicial: S.get('fornecedores', m.fornecedor_id) });
      },
      botoes: [
        ...(novo ? [] : (m.status !== 'concluida' ? [{ txt: 'Retirar peça para esta manutenção', cls: 'sec', validar: false, acao: async () => { Telas.movimentos.retirar(); return true; } }] : [])),
        { txt: novo ? (m.tipo === 'preventiva' ? 'Registrar' : 'Abrir chamado') : 'Salvar', acao: async (f) => {
          const d = UI.lerForm(f);
          if (!Perm.pode('compras')) d.fornecedor_id = m.fornecedor_id || null;
          if (!podeCusto) d.custo_servico = m.custo_servico || 0;
          if (!f.dataset.envio) f.dataset.envio = m.id || U.uuid();
          const r = await API.rpc('salvar_manutencao', { p: { ...d, id: f.dataset.envio } });
          await App.gravou(['manutencoes']);
          UI.aviso(novo ? (d.status === 'concluida' ? 'Registrado.' : 'Chamado aberto.') : 'Salvo.');
          return r;
        } },
      ],
    });
    return id;
  }

  return {
    titulo: (r) => r.nome === 'maquina' ? (S.get('maquinas', r.id)?.nome || 'Máquina') : 'Máquinas',
    render(r) { return r.nome === 'maquina' ? renderFicha(r.id) : renderLista(r); },
    depois(el, r) { if (r.nome === 'maquina') depoisFicha(el, r); else depoisLista(el); },
    form, novaRapida, formManutencao, linhaManut,
  };
})();
