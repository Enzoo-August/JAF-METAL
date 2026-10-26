/* Varredura de telas e janelas no tamanho atual da janela (modo teste).
 *   fetch('testes/auditoria.js').then(r => r.text()).then(eval); auditar();  → window.__a
 * Procura: rolagem para o lado, botão/campo fora da tela, coberto por outra coisa, alvo de toque pequeno. */
'use strict';
window.auditar = async function auditar(opt = {}) {
  const A = window.__a = { problemas: [], vistos: 0, fim: false, tam: Math.round(visualViewport?.width || innerWidth) + 'x' + Math.round(visualViewport?.height || innerHeight) };
  const dorme = (ms) => new Promise(ok => setTimeout(ok, ms));
  if (opt.sat) document.documentElement.style.setProperty('--sat', opt.sat + 'px');
  if (opt.sat) document.documentElement.style.setProperty('--sab', '34px');
  const toque = matchMedia('(pointer: coarse)').matches || opt.toque;
  document.body.classList.add('sem-transicao');
  const st = document.createElement('style'); st.textContent = '*{transition:none!important;animation:none!important}'; document.head.appendChild(st);

  function conferir(onde, raiz) {
    const W = Math.round(window.visualViewport?.width || innerWidth), H = Math.round(window.visualViewport?.height || innerHeight);
    if (document.documentElement.scrollWidth > W + 1) A.problemas.push(`${onde}: rolagem para o lado (${document.documentElement.scrollWidth} > ${W})`);
    const menuFechado = innerWidth < 900 && !document.body.classList.contains('menu-aberto');
    const els = [...raiz.querySelectorAll('button, a.btn, a.linha, a.kpi, .chip, input:not([type=hidden]):not([type=file]), select, textarea, .aba')]
      .filter(e => e.offsetParent && !e.closest('details:not([open])') && getComputedStyle(e).visibility !== 'hidden' && !(menuFechado && e.closest('.lateral')) && !e.closest('.topo-busca:not(:focus-within)') );
    // faixa livre da tela (entre a barra do topo e a barra de baixo), para conferir se algo está coberto
    const emJanela = raiz.classList?.contains('janela-fundo') ? raiz : null;
    const topo = emJanela ? emJanela.querySelector('.janela-cab').getBoundingClientRect().bottom : Math.max(document.querySelector('.topo')?.getBoundingClientRect().bottom || 0, document.querySelector('.subabas')?.getBoundingClientRect().bottom || 0);
    const abas = document.querySelector('.abas');
    const baixo = emJanela ? emJanela.querySelector('.janela-pe').getBoundingClientRect().top : (!abas || getComputedStyle(abas).display === 'none' ? H : abas.getBoundingClientRect().top);
    document.activeElement?.blur?.(); raiz.querySelectorAll('.combo-lista').forEach(c => c.hidden = true);
    for (const e of els) {
      A.vistos++;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const nome = (e.textContent || e.name || e.placeholder || e.getAttribute('aria-label') || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
      // dentro de caixas com rolagem lateral (chips, tabelas) é normal passar da borda
      const rolavel = e.closest('.chips, .tabela-caixa, .abas-tela, .lateral-menu, .combo-lista, .subabas-lista, .matriz-caixa, .org, .escolher-pessoas');
      if (!rolavel && (r.left < -1 || r.right > W + 1)) A.problemas.push(`${onde}: "${nome}" sai da tela pelo lado (${Math.round(r.left)}–${Math.round(r.right)} de ${W})`);
      if (toque && r.height < 30 && !e.matches('input[type=checkbox], input[type=radio]') && !e.closest('.combo-lista, .busca-res'))
        A.problemas.push(`${onde}: "${nome}" pequeno para o dedo (${Math.round(r.height)} px)`);
      // coberto? só o que está visível na tela agora
      const fixo = e.closest('.topo, .abas, .janela-cab, .janela-pe, .subabas');
      const naFaixa = fixo ? (r.top >= 0 && r.bottom <= H) : (r.top >= topo && r.bottom <= baixo);
      if (naFaixa && r.left >= 0 && r.right <= W && !rolavel) {
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const no = document.elementFromPoint(cx, cy);
        if (no && no !== e && !e.contains(no) && !no.contains(e) && !(no.closest('label') && no.closest('label').contains(e)) && !(e.labels && [...e.labels].some(l => l.contains(no))))
          A.problemas.push(`${onde}: "${nome}" coberto por ${no.getAttribute('class') || no.tagName}`);
      }
    }
  }
  async function janelaAberta(nome) {
    await dorme(120);
    const j = [...document.querySelectorAll('.janela-fundo')].at(-1);
    if (!j) { A.problemas.push(nome + ': janela não abriu'); return; }
    const pe = j.querySelector('.janela-pe').getBoundingClientRect(), cab = j.querySelector('.janela-cab').getBoundingClientRect();
    if (pe.bottom > innerHeight + 1) A.problemas.push(`${nome}: rodapé da janela fora da tela (${Math.round(pe.bottom)} > ${innerHeight})`);
    if (cab.top < 0) A.problemas.push(`${nome}: cabeçalho da janela fora da tela`);
    const corpo = j.querySelector('.janela-corpo');
    if (corpo.scrollHeight > corpo.clientHeight + 2 && getComputedStyle(corpo).overflowY === 'visible') A.problemas.push(`${nome}: conteúdo maior que a janela sem rolagem`);
    conferir(nome, j);
    // rola até o fim e confere de novo (botões no fim do formulário)
    corpo.scrollTop = corpo.scrollHeight; await dorme(60); conferir(nome + ' (fim)', j);
    UI.fecharTodas(); await dorme(60);
  }

  const rotas = ['#/inicio', '#/pecas', '#/movimentos', '#/compras', '#/compras/lista', '#/fornecedores', '#/producao', '#/maquinas', '#/financeiro', '#/financeiro/fluxo',
    '#/clientes', '#/equipe', '#/relatorios?r=estoque', '#/relatorios?r=consumo', '#/relatorios?r=compras', '#/relatorios?r=financeiro', '#/admin', '#/ajuda', '#/ajuda?q=f%C3%A9rias', '#/conta',
    '#/rh', '#/rh?f=experiencia', '#/rh/ponto', '#/rh/ferias', '#/rh/ferias?aba=ausencias', '#/rh/ferias?aba=fora', '#/rh/treinamentos?aba=matrizes', '#/rh/treinamentos?aba=plano',
    '#/rh/treinamentos?aba=reciclagem', '#/rh/treinamentos?aba=metas', '#/rh/seguranca', '#/rh/seguranca?f=epi', '#/rh/disciplina', '#/rh/processos', '#/rh/organograma', '#/rh/relatorios',
    '#/rh/ajustes?aba=cargos', '#/rh/ajustes?aba=feriados', '#/rh/ajustes?aba=jornada'];
  const f0 = S.lista('funcionarios').find(f => f.ativo)
  if (f0) { rotas.push(`#/rh/ponto?f=${f0.id}&m=${U.hoje().slice(0, 7)}`); for (const a of ['dados', 'cargo', 'ferias', 'ponto', 'treinos', 'seguranca', 'disciplina', 'documentos']) rotas.push(`#/funcionario/${f0.id}?aba=${a}`) }
  const ids = { peca: S.lista('pecas')[0]?.id, fornecedor: S.lista('fornecedores')[0]?.id, maquina: S.lista('maquinas')[0]?.id, pedido: S.lista('pedidos_compra').find(p => p.status === 'aguardando')?.id,
    cliente: S.lista('clientes')[0]?.id, funcionario: S.lista('funcionarios')[0]?.id };
  for (const [k, v] of Object.entries(ids)) if (v) rotas.push(`#/${k}/${v}`);
  for (const r of rotas) {
    location.hash = r; await dorme(160);
    const v = document.getElementById('view'); if (!v) continue;
    if (v.querySelector('.vazio .ic') && /Sem acesso|não encontrad/i.test(v.textContent)) continue;
    window.scrollTo(0, 0); conferir(r, document.querySelector('.casca'));
    window.scrollTo(0, document.body.scrollHeight); await dorme(60); conferir(r + ' (fim)', document.querySelector('.casca'));
    window.scrollTo(0, 0);
  }
  // janelas principais
  const P = Perm, pe = S.lista('pecas')[0];
  if (P.pode('retirar')) { Telas.movimentos.retirar(); await janelaAberta('Retirar peça'); }
  if (P.pode('entrada')) { Telas.movimentos.entrada(pe); await janelaAberta('Dar entrada'); Telas.pecas.form(pe); await janelaAberta('Editar peça'); }
  if (P.pode('compras')) { Telas.compras.form({ itens: S.lista('pecas').slice(0, 3).map(p => ({ peca: p, qtd: 5, preco: 10 })) }); await janelaAberta('Novo pedido');
    const ped = S.lista('pedidos_compra').find(p => p.status === 'aguardando'); if (ped) { Telas.compras.receber(ped); await janelaAberta('Receber pedido'); }
    Telas.fornecedores.form(S.lista('fornecedores')[0]); await janelaAberta('Fornecedor'); }
  if (P.pode('producao_editar')) { Telas.producao.form(); await janelaAberta('Nova ordem'); }
  const op = S.lista('ordens').find(o => o.status === 'producao'); if (op) { Telas.producao.abrir(op.id); await janelaAberta('Ordem'); }
  if (P.pode('manutencao')) { Telas.maquinas.formManutencao({ tipo: 'corretiva' }); await janelaAberta('Chamado'); }
  if (P.pode('financeiro')) { Telas.financeiro.form({}); await janelaAberta('Nova conta'); const l = S.lista('lancamentos').find(x => !x.pago_em); if (l) { Telas.financeiro.abrir(l.id); await janelaAberta('Conta'); } }
  if (P.pode('equipe_editar')) { Telas.equipe.form(S.lista('funcionarios')[0]); await janelaAberta('Funcionário'); }
  if (P.pode('rh_editar') && f0) {
    Telas.rh.formPessoa(); await janelaAberta('Nova pessoa')
    Telas.rh.formAusencia(f0); await janelaAberta('Atestado / falta')
    Telas.rh.formAso(f0); await janelaAberta('Exame ASO')
    Telas.rh.formEpi(f0); await janelaAberta('Entregar EPI')
    Telas.rh.formOcorrencia(f0); await janelaAberta('Advertência')
    if (P.pode('rh_sensivel')) { Telas.rh.programarFerias(f0); await janelaAberta('Programar férias') }
  }
  Telas.inicio.personalizar(); await janelaAberta('Personalizar início')
  if (P.pode('entrada')) { location.hash = '#/pecas'; await dorme(150); document.querySelector('[data-acao2="contagem"]')?.click(); await janelaAberta('Inventário'); }
  // menu lateral no celular
  if (innerWidth < 900) {
    document.body.classList.add('menu-aberto'); await dorme(80);
    const lat = document.querySelector('.lateral').getBoundingClientRect();
    if (lat.left < -1) A.problemas.push('menu lateral não abriu');
    const ult = [...document.querySelectorAll('.lateral-menu a')].at(-1); ult?.scrollIntoView(); await dorme(40);
    const u = document.querySelector('.lateral-usuario').getBoundingClientRect(); if (u.bottom > innerHeight + 1) A.problemas.push('rodapé do menu (usuário/sair) fora da tela');
    document.body.classList.remove('menu-aberto');
  }
  st.remove(); document.documentElement.style.removeProperty('--sat'); document.documentElement.style.removeProperty('--sab');
  location.hash = '#/inicio';
  A.problemas = [...new Set(A.problemas)];
  A.fim = true;
  return A;
};

// roda a varredura com os 4 perfis no tamanho atual
window.auditarPerfis = async function (opt = {}) {
  const res = {};
  for (const login of ['dono', 'escritorio', 'almox', 'operador', 'helena', 'gerente']) {
    await API.sair(); await API.entrar(login, 'teste1234'); App.gravarPref('boasVindas', true); await App.entrarNoSistema(); await new Promise(ok => setTimeout(ok, 700));
    UI.fecharTodas();
    const a = await window.auditar(opt);
    res[login] = a.problemas;
  }
  await API.sair(); await API.entrar('dono', 'teste1234'); await App.entrarNoSistema();
  UI.fecharTodas();
  return { tam: Math.round(visualViewport?.width || innerWidth) + 'x' + Math.round(visualViewport?.height || innerHeight) + ' (página ' + innerWidth + ')', res };
};
