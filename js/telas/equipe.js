/* Equipe: funcionários */
'use strict';

Telas.equipe = (() => {
  const esc = U.esc;
  const estado = { busca: '', f: 'ativos' };

  const tempoCasa = (adm) => { if (!adm) return ''; const m = Math.floor(U.dias(adm, U.hoje()) / 30.4375); const a = Math.floor(m / 12), r = m % 12;
    return a ? `${U.plural(a, 'ano')}${r ? ' e ' + U.plural(r, 'mês', 'meses') : ''}` : U.plural(r, 'mês', 'meses'); };

  function linha(f) {
    const priv = S.get('funcionarios_privado', f.id);
    const fe = Perm.pode('salarios') ? C.ferias(f, priv) : null;
    const aviso = fe?.limite ? (fe.vencida ? 'Férias vencidas' : fe.diasParaVencer <= 60 ? 'Férias vencem ' + U.relativo(fe.limite) : '') : '';
    const acesso = S.lista('perfis').find(p => p.funcionario_id === f.id);
    return `<a class="linha" href="#/funcionario/${f.id}"><span class="avatar">${esc(f.nome.charAt(0).toUpperCase())}</span>
      <div class="meio"><b>${esc(f.nome)}${!f.ativo ? ' <span class="tag t-cinza">desligado</span>' : ''}</b>
      <small>${esc([f.funcao, f.setor, f.admissao ? tempoCasa(f.admissao) + ' de casa' : ''].filter(Boolean).join(' · ') || '—')}${acesso ? ' · tem acesso ao sistema' : ''}</small></div>
      <div class="lado">${aviso ? UI.tag({ txt: aviso, cor: fe.vencida ? 'vermelho' : 'amarelo' }) : ''}${Perm.pode('salarios') && priv?.salario ? `<small>${U.moeda0(priv.salario)}</small>` : ''}</div></a>`;
  }

  function filtrar() {
    let l = S.lista('funcionarios');
    if (estado.f === 'ativos') l = l.filter(f => f.ativo);
    else if (estado.f === 'desligados') l = l.filter(f => !f.ativo);
    else if (estado.f === 'ferias') l = l.filter(f => { const fe = C.ferias(f, S.get('funcionarios_privado', f.id)); return fe?.limite && fe.diasParaVencer <= 60; });
    else if (estado.f === 'aniver') { const m = U.hoje().slice(5, 7); l = l.filter(f => f.ativo && S.get('funcionarios_privado', f.id)?.nascimento?.slice(5, 7) === m); }
    return estado.busca.trim() ? U.buscar(l, estado.busca, f => [f.nome, f.funcao || '', f.setor || '']) : U.ordenar(l, f => U.sem(f.nome));
  }

  function renderLista(r) {
    if (r.q.get('f')) estado.f = r.q.get('f');
    const at = S.lista('funcionarios').filter(f => f.ativo);
    const sal = Perm.pode('salarios');
    const folha = sal ? U.soma(at, f => Number(S.get('funcionarios_privado', f.id)?.salario) || 0) : 0;
    const setores = U.agrupar(at, f => f.setor || 'Sem setor');
    const chips = [{ v: 'ativos', t: 'Ativos', n: at.length }];
    if (sal) chips.push({ v: 'ferias', t: 'Férias vencendo' }, { v: 'aniver', t: 'Aniversariantes do mês' });
    chips.push({ v: 'desligados', t: 'Desligados' });
    return `${UI.cab('Equipe', `${U.plural(at.length, 'pessoa')} · ${[...setores.entries()].map(([s, l]) => `${esc(s)} ${l.length}`).join(' · ')}`,
        Perm.pode('equipe_editar') ? UI.btn('Novo funcionário', 'data-eq="novo"', 'pri', 'mais') : '')}
      ${sal ? `<div class="grade g3"><div class="kpi"><small>Folha mensal (salários)</small><b>${U.moeda0(folha)}</b><span>sem encargos</span></div>
        <div class="kpi"><small>Média por pessoa</small><b>${U.moeda0(at.length ? folha / at.length : 0)}</b></div>
        <div class="kpi"><small>Tempo médio de casa</small><b style="font-size:1.15rem">${at.filter(f => f.admissao).length ? tempoCasa(U.somaDias(U.hoje(), -Math.round(U.soma(at.filter(f => f.admissao), f => U.dias(f.admissao, U.hoje())) / at.filter(f => f.admissao).length))) : '—'}</b></div></div>` : ''}
      <div class="barra-filtros mt"><div class="busca-lista">${UI.ic('busca')}<input type="search" id="bEq" placeholder="Nome, função, setor" value="${esc(estado.busca)}"></div></div>
      ${UI.chips(chips, estado.f)}
      <div class="lista mt" id="lEq"></div>`;
  }
  function desenhar(el) { const l = filtrar(); el.querySelector('#lEq').innerHTML = l.length ? l.map(linha).join('') : UI.vazio('equipe', 'Ninguém aqui'); }
  function depoisLista(el) {
    desenhar(el);
    el.querySelector('#bEq').addEventListener('input', U.debounce((e) => { estado.busca = e.target.value; desenhar(el); }, 120));
    el.addEventListener('click', (e) => {
      const c = e.target.closest('[data-f]'); if (c) { estado.f = c.dataset.f; el.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c)); desenhar(el); }
      if (e.target.closest('[data-eq="novo"]')) form();
    });
    el.addEventListener('input', () => delete el.dataset.sujo);
  }

  // ---------------------------------------------------------------- ficha
  function renderFicha(id) {
    const f = S.get('funcionarios', id);
    if (!f) return UI.vazio('equipe', 'Funcionário não encontrado', '', '<a class="btn pri" href="#/equipe">Voltar</a>');
    const sal = Perm.pode('salarios'), priv = S.get('funcionarios_privado', f.id) || {};
    const fe = sal ? C.ferias(f, priv) : null;
    const de12 = U.somaMeses(U.hoje(), -12);
    const ret = C.consumos(m => m.funcionario_id === f.id && m.data >= de12);
    const porPeca = U.agrupar(ret, x => x.mov.peca_id);
    const top = [...porPeca.entries()].map(([pid, l]) => ({ p: S.get('pecas', pid), q: U.soma(l, 'qtd'), v: U.soma(l, 'valor') })).filter(x => x.q > 0).sort((a, b) => b.v - a.v).slice(0, 8);
    const ords = S.lista('ordens').filter(o => o.responsavel_id === f.id && ['fila', 'producao'].includes(o.status));
    const acesso = S.lista('perfis').find(p => p.funcionario_id === f.id);
    const idade = priv.nascimento ? Math.floor(U.dias(priv.nascimento, U.hoje()) / 365.25) : null;
    return `${UI.voltar('#/equipe', 'Equipe')}
      <header class="cab"><div><h1>${esc(f.nome)} ${!f.ativo ? '<span class="tag t-cinza">desligado</span>' : ''}</h1><p class="sub">${esc([f.funcao, f.setor].filter(Boolean).join(' · '))}</p></div>
        <div class="acoes">${Perm.pode('equipe_editar') ? UI.btn('Editar', 'data-eq="editar"', 'sec', 'lapis') : ''}${sal && f.ativo ? UI.btn('Registrar férias', 'data-eq="ferias"', 'sec', 'calendario') : ''}</div></header>
      <section class="card">${UI.dl([['Telefone', f.telefone ? `<a href="tel:${esc(f.telefone.replace(/\D/g, ''))}">${esc(f.telefone)}</a>` : ''], ['Admissão', f.admissao ? `${U.data(f.admissao)} (${tempoCasa(f.admissao)})` : ''],
        sal ? ['Salário', priv.salario ? U.moeda(priv.salario) : ''] : null, sal ? ['Nascimento', priv.nascimento ? `${U.data(priv.nascimento)} (${idade} anos)` : ''] : null,
        sal ? ['CPF', esc(priv.cpf || '')] : null, sal ? ['RG', esc(priv.rg || '')] : null, sal ? ['Endereço', esc(priv.endereco || '')] : null, sal ? ['Pix', esc(priv.pix || '')] : null,
        ['Acesso ao sistema', acesso ? `${esc(acesso.login)} (${Perm.nome(acesso.perfil)})` : ''], sal ? ['Observações', esc(priv.obs || '')] : null])}</section>
      ${fe ? `<section class="card mt"><div class="card-cab"><h2>Férias</h2></div>
        ${fe.pendentes > 0 ? `<p class="nota ${fe.vencida ? 'vermelha' : fe.diasParaVencer <= 60 ? 'amarela' : ''}">${U.plural(fe.pendentes, 'período')} de férias para tirar. ${fe.vencida ? `<b>Venceu em ${U.data(fe.limite)}</b> (a lei manda pagar em dobro).` : `Precisa sair até <b>${U.data(fe.limite)}</b> (${U.relativo(fe.limite)}).`}</p>`
          : `<p class="sub">Em dia. Ganha direito a novas férias em ${U.data(fe.direitoEm)}.</p>`}
        ${(priv.ferias || []).length ? `<div class="lista mt">${priv.ferias.map((x, n) => `<div class="linha" style="min-height:44px"><div class="meio"><b>${U.data(x.inicio)} a ${U.data(x.fim)}</b><small>${U.plural(U.dias(x.inicio, x.fim) + 1, 'dia')}${x.obs ? ' · ' + esc(x.obs) : ''}</small></div>
          <button type="button" class="icone-btn" data-tirarferias="${n}" aria-label="Apagar registro">${UI.ic('lixo')}</button></div>`).join('')}</div>` : ''}
        <p class="sub mt">Conta simplificada da CLT: cada 12 meses de casa dá um período; cada férias registrada usa o período mais antigo.</p></section>` : ''}
      ${ords.length ? `<section class="card mt"><div class="card-cab"><h2>Ordens com ${esc(f.nome.split(' ')[0])}</h2></div>${ords.map(o => Telas.producao.cartao(o)).join('')}</section>` : ''}
      ${top.length ? `<section class="card mt"><div class="card-cab"><h2>Peças que mais retirou (12 meses)</h2></div><div class="lista">${top.map(x => `<a class="linha" href="#/peca/${x.p?.id}"><div class="meio"><b><span class="codigo">${esc(x.p?.codigo || '')}</span> · ${esc(x.p?.descricao || '')}</b></div>
        <div class="lado"><b>${U.qtd(x.q)}</b>${Perm.pode('precos') ? `<small>${U.moeda(x.v)}</small>` : ''}</div></a>`).join('')}</div></section>` : ''}`;
  }
  function depoisFicha(el, r) {
    const f = S.get('funcionarios', r.id); if (!f) return;
    el.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-eq]')?.dataset.eq;
      if (a === 'editar') form(f);
      if (a === 'ferias') registrarFerias(f);
      const t = e.target.closest('[data-tirarferias]');
      if (t && await UI.confirmar('Apagar este registro de férias?', { ok: 'Apagar', perigo: true })) {
        const priv = { ...(S.get('funcionarios_privado', f.id) || {}) };
        priv.ferias = (priv.ferias || []).filter((_, n) => n !== Number(t.dataset.tirarferias));
        try { await API.rpc('salvar_funcionario', { p: { ...f, privado: priv } }); await App.gravou(['funcionarios', 'funcionarios_privado']); UI.aviso('Registro apagado.'); } catch (err) { UI.erro(err); }
      }
    });
  }

  async function registrarFerias(f) {
    await UI.modal({
      titulo: 'Registrar férias — ' + f.nome,
      corpo: `<div class="linha-campos">${UI.campo({ nome: 'inicio', rotulo: 'Início', tipo: 'date', req: true })}${UI.campo({ nome: 'fim', rotulo: 'Fim', tipo: 'date', req: true })}</div>
        ${UI.campo({ nome: 'obs', rotulo: 'Observação', placeholder: 'Ex.: 1º período, vendeu 10 dias…' })}`,
      botoes: [{ txt: 'Registrar', acao: async (frm) => {
        const d = UI.lerForm(frm);
        if (d.fim < d.inicio) throw new API.ErroApp('O fim é antes do início.');
        const priv = { ...(S.get('funcionarios_privado', f.id) || {}) };
        priv.ferias = [...(priv.ferias || []), { inicio: d.inicio, fim: d.fim, obs: d.obs || undefined }].sort((a, b) => a.inicio < b.inicio ? -1 : 1);
        await API.rpc('salvar_funcionario', { p: { ...f, privado: priv } });
        await App.gravou(['funcionarios', 'funcionarios_privado']); UI.aviso('Férias registradas.');
      } }],
    });
  }

  async function form(f) {
    const novo = !f;
    f = f || { ativo: true };
    const sal = Perm.pode('salarios'), priv = S.get('funcionarios_privado', f.id) || {};
    const setores = [...new Set(S.lista('funcionarios').map(x => x.setor).filter(Boolean))];
    const funcoes = [...new Set(S.lista('funcionarios').map(x => x.funcao).filter(Boolean))];
    return UI.modal({
      titulo: novo ? 'Novo funcionário' : 'Editar funcionário',
      corpo: `${UI.campo({ nome: 'nome', rotulo: 'Nome completo', valor: f.nome, req: true })}
        <div class="linha-campos">${UI.campo({ nome: 'funcao', rotulo: 'Função', valor: f.funcao, attrs: 'list="lFuncao"' })}${UI.campo({ nome: 'setor', rotulo: 'Setor', valor: f.setor, attrs: 'list="lSetorEq"' })}</div>
        <datalist id="lFuncao">${funcoes.map(x => `<option value="${esc(x)}">`).join('')}</datalist><datalist id="lSetorEq">${setores.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
        <div class="linha-campos">${UI.campo({ nome: 'telefone', rotulo: 'Telefone', tipo: 'tel', valor: f.telefone })}${UI.campo({ nome: 'admissao', rotulo: 'Admissão', tipo: 'date', valor: f.admissao })}</div>
        ${sal ? `<h3 class="mt">Dados pessoais <span class="sub">(só Dono e Escritório veem)</span></h3>
        <div class="linha-campos">${UI.campo({ nome: 'salario', rotulo: 'Salário', tipo: 'dinheiro', valor: U.campoNum(priv.salario) })}${UI.campo({ nome: 'nascimento', rotulo: 'Nascimento', tipo: 'date', valor: priv.nascimento })}</div>
        <div class="linha-campos">${UI.campo({ nome: 'cpf', rotulo: 'CPF', valor: priv.cpf })}${UI.campo({ nome: 'rg', rotulo: 'RG', valor: priv.rg })}${UI.campo({ nome: 'pix', rotulo: 'Chave Pix', valor: priv.pix })}</div>
        ${UI.campo({ nome: 'endereco', rotulo: 'Endereço', valor: priv.endereco })}
        ${UI.campo({ nome: 'pobs', rotulo: 'Observações', tipo: 'area', valor: priv.obs, linhas: 2 })}` : ''}
        ${novo ? '' : UI.campo({ nome: 'ativo', rotulo: 'Trabalha na empresa (desmarque se foi desligado — o histórico fica)', tipo: 'check', valor: f.ativo })}`,
      botoes: [{ txt: novo ? 'Cadastrar' : 'Salvar', acao: async (frm) => {
        const d = UI.lerForm(frm); if (novo) d.ativo = true;
        const p = { id: f.id, nome: d.nome, funcao: d.funcao, setor: d.setor, telefone: d.telefone, admissao: d.admissao || null, ativo: d.ativo };
        if (sal) p.privado = { salario: d.salario, nascimento: d.nascimento || null, cpf: d.cpf, rg: d.rg, pix: d.pix, endereco: d.endereco, obs: d.pobs, ferias: priv.ferias || [] };
        const id = await API.rpc('salvar_funcionario', { p });
        await App.gravou(['funcionarios', 'funcionarios_privado']); UI.aviso(novo ? 'Funcionário cadastrado.' : 'Salvo.'); return id;
      } }],
    });
  }

  return {
    titulo: (r) => r.nome === 'funcionario' ? (S.get('funcionarios', r.id)?.nome || 'Funcionário') : 'Equipe',
    render(r) { return r.nome === 'funcionario' ? renderFicha(r.id) : renderLista(r); },
    depois(el, r) { if (r.nome === 'funcionario') depoisFicha(el, r); else depoisLista(el); },
    form,
  };
})();
