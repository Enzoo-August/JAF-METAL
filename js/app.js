/* JAF Metal — aplicativo: login, menu, rotas, atualização */
'use strict';

const Telas = {};

// ------------------------------------------------------------------ permissões (iguais às do banco)
const Perm = (() => {
  const R = {
    retirar: ['dono', 'escritorio', 'almoxarife', 'producao'],
    entrada: ['dono', 'escritorio', 'almoxarife'],
    pecas_editar: ['dono', 'escritorio', 'almoxarife'],
    compras: ['dono', 'escritorio', 'almoxarife'],
    precos: ['dono', 'escritorio', 'almoxarife'],
    historico_mov: ['dono', 'escritorio', 'almoxarife', 'producao'],
    maquinas_editar: ['dono', 'escritorio', 'almoxarife'],
    manutencao: ['dono', 'escritorio', 'almoxarife', 'producao'],
    producao_editar: ['dono', 'escritorio', 'almoxarife'],
    producao_status: ['dono', 'escritorio', 'almoxarife', 'producao'],
    entregar: ['dono', 'escritorio'],
    financeiro: ['dono', 'escritorio'],
    clientes: ['dono', 'escritorio'],
    equipe_editar: ['dono', 'escritorio'],
    salarios: ['dono', 'escritorio'],
    relatorios: ['dono', 'escritorio', 'almoxarife'],
    config: ['dono', 'escritorio'],
    acessos: ['dono'],
    importar: ['dono'],
    auditoria: ['dono'],
    todos: ['dono', 'escritorio', 'almoxarife', 'producao'],
  };
  const NOMES = { dono: 'Dono', escritorio: 'Escritório', almoxarife: 'Almoxarifado', producao: 'Produção' };
  return {
    pode: (acao) => !!API.sessao && (R[acao] || []).includes(API.sessao.perfil),
    nome: (p) => NOMES[p] || p,
    NOMES,
  };
})();

const App = (() => {
  const App = { versao: '1.0.0' };
  let pendenteRedesenho = false;
  let rotaAtual = null;
  let timer = null;
  let ligado = false;
  // troca o #app por um elemento novo: os ouvintes de cliques do layout anterior morrem junto
  const novaRaiz = () => { const velho = document.getElementById('app'); const novo = velho.cloneNode(false); velho.replaceWith(novo); return novo; };

  // menu: [rota, rótulo, ícone, permissão, grupo]
  const MENU = [
    ['inicio', 'Início', 'inicio', 'todos', ''],
    ['pecas', 'Estoque', 'estoque', 'todos', 'Almoxarifado'],
    ['movimentos', 'Movimentações', 'historico', 'historico_mov', 'Almoxarifado'],
    ['compras', 'Pedidos de compra', 'compras', 'compras', 'Almoxarifado'],
    ['compras/lista', 'Lista de compras', 'lista', 'compras', 'Almoxarifado'],
    ['fornecedores', 'Fornecedores', 'fornecedor', 'compras', 'Almoxarifado'],
    ['producao', 'Ordens de produção', 'producao', 'todos', 'Fábrica'],
    ['maquinas', 'Máquinas e manutenção', 'maquina', 'todos', 'Fábrica'],
    ['financeiro', 'Contas a pagar e receber', 'dinheiro', 'financeiro', 'Gestão'],
    ['financeiro/fluxo', 'Fluxo de caixa', 'relatorio', 'financeiro', 'Gestão'],
    ['clientes', 'Clientes', 'cliente', 'clientes', 'Gestão'],
    ['equipe', 'Equipe', 'equipe', 'todos', 'Gestão'],
    ['relatorios', 'Relatórios', 'relatorio', 'relatorios', 'Gestão'],
    ['admin', 'Administração', 'admin', 'config', 'Sistema'],
    ['ajuda', 'Ajuda', 'ajuda', 'todos', 'Sistema'],
  ];

  // ------------------------------------------------------------------ tema
  App.aplicarTema = () => {
    let t = 'auto'; try { t = localStorage.getItem('jaf.tema') || 'auto'; } catch (e) {}
    const escuro = t === 'escuro' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.tema = escuro ? 'escuro' : 'claro';
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', escuro ? '#0f1621' : '#1c2a3d');
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', App.aplicarTema);

  // ------------------------------------------------------------------ início
  App.iniciar = async () => {
    App.aplicarTema();
    const raiz = document.getElementById('app');
    raiz.innerHTML = `<div class="carregando-tela"><img src="assets/logo.png" alt="JAF Metal"><div class="giro"></div><p>${API.modo === 'teste' ? 'Preparando o modo teste…' : 'Carregando…'}</p></div>`;
    try {
      await API.iniciar();
      if (API.modo === 'teste' && API.precisaDemo) {
        await U.carregarScript('js/demo.js?v=' + (document.querySelector('script[src*="js/app.js"]')?.src.split('v=')[1] || App.versao));
        await Demo.criar();
      }
    } catch (e) {
      console.error(e);
      raiz.innerHTML = `<div class="carregando-tela"><img src="assets/logo.png" alt="JAF Metal"><p class="erro-txt">${U.esc(API.traduzir(e).message)}</p>
        <button class="btn pri" onclick="location.reload()">Tentar de novo</button></div>`;
      return;
    }
    if (API.sessao) await App.entrarNoSistema();
    else await App.telaLogin();
  };

  // ------------------------------------------------------------------ login
  App.telaLogin = async (msg = '') => {
    const raiz = document.getElementById('app');
    let primeiro = false;
    try { primeiro = !(await API.rpc('ha_dono')); } catch (e) { /* sem rede: mostra o login normal */ }
    const teste = API.modo === 'teste';
    raiz.innerHTML = `
      <main class="login">
        <div class="login-caixa">
          <div class="login-marca"><img src="assets/logo.png" alt="JAF Metal"><span>Gestão</span></div>
          ${primeiro ? `
            <h1>Primeiro acesso</h1>
            <p class="sub">Crie o login do <b>Dono</b>. Ele cadastra depois os acessos da equipe.</p>
            <form id="fLogin" novalidate>
              ${UI.campo({ nome: 'nome', rotulo: 'Seu nome', req: true, auto: 'name' })}
              ${UI.campo({ nome: 'login', rotulo: 'Usuário (para entrar)', req: true, ajuda: 'Só letras minúsculas, números, ponto ou traço. Ex.: joao.silva', auto: 'username' })}
              ${UI.campo({ nome: 'senha', rotulo: 'Senha', tipo: 'password', req: true, ajuda: 'Mínimo 8 caracteres. Não use a mesma senha de outros sites.', auto: 'new-password' })}
              ${UI.campo({ nome: 'senha2', rotulo: 'Repita a senha', tipo: 'password', req: true, auto: 'new-password' })}
              <p class="login-erro" role="alert" hidden></p>
              <button class="btn pri grande" type="submit"><span>Criar acesso do Dono</span></button>
            </form>` : `
            <h1>Entrar</h1>
            ${msg ? `<p class="login-msg">${U.esc(msg)}</p>` : ''}
            <form id="fLogin" novalidate>
              ${UI.campo({ nome: 'login', rotulo: 'Usuário', req: true, auto: 'username', attrs: 'autocapitalize="none" spellcheck="false"' })}
              <div class="campo"><label for="cSenha">Senha</label><div class="senha-caixa">
                <input id="cSenha" name="senha" type="password" required autocomplete="current-password">
                <button type="button" class="icone-btn ver-senha" aria-label="Mostrar senha">${UI.ic('olho')}</button></div></div>
              <p class="login-erro" role="alert" hidden></p>
              <button class="btn pri grande" type="submit"><span>Entrar</span></button>
            </form>
            ${teste ? `<div class="login-teste"><b>Modo teste</b> — dados inventados, nada vai para o banco de verdade.
              <div class="login-perfis">${['dono', 'escritorio', 'almoxarife', 'producao'].map(p => `<button type="button" class="btn sec" data-demo="${p}">${Perm.nome(p)}</button>`).join('')}</div>
              <small>Senha de todos: <code>teste1234</code></small></div>` : ''}`}
          <p class="login-rodape">${teste ? 'Modo teste' : 'Acesso protegido'} · v${App.versao}</p>
        </div>
      </main>`;
    const f = raiz.querySelector('#fLogin');
    const erro = raiz.querySelector('.login-erro');
    raiz.querySelector('.ver-senha')?.addEventListener('click', (e) => {
      const i = raiz.querySelector('#cSenha'); i.type = i.type === 'password' ? 'text' : 'password';
    });
    raiz.querySelectorAll('[data-demo]').forEach(b => b.onclick = () => {
      f.login.value = { dono: 'dono', escritorio: 'escritorio', almoxarife: 'almox', producao: 'operador' }[b.dataset.demo];
      f.senha.value = 'teste1234';
      f.requestSubmit();
    });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = f.querySelector('[type=submit]');
      erro.hidden = true;
      await UI.ocupado(btn, async () => {
        try {
          const d = UI.lerForm(f);
          if (primeiro) {
            if (d.senha !== d.senha2) throw new API.ErroApp('As duas senhas não são iguais.');
            await API.rpc('primeiro_dono', { p_login: d.login, p_senha: d.senha, p_nome: d.nome });
            await API.entrar(d.login, d.senha);
          } else {
            await API.entrar(d.login, d.senha);
          }
          await App.entrarNoSistema();
        } catch (err) {
          erro.textContent = API.traduzir(err).message; erro.hidden = false;
        }
      });
    });
  };

  // sessão caiu no meio do uso: pede a senha numa janela, sem perder a tela
  let pedindoLogin = false;
  App.sessaoCaiu = async () => {
    if (pedindoLogin) return;
    pedindoLogin = true;
    const login = API.sessao?.login || '';
    await UI.modal({
      titulo: 'Entre de novo',
      corpo: `<p class="sub">Sua sessão expirou (é normal depois de muito tempo parado). O que estava na tela continua aqui.</p>
        ${UI.campo({ nome: 'login', rotulo: 'Usuário', valor: login, req: true })}
        ${UI.campo({ nome: 'senha', rotulo: 'Senha', tipo: 'password', req: true, attrs: 'autofocus' })}`,
      botoes: [{ txt: 'Entrar', acao: async (form) => { const d = UI.lerForm(form); await API.entrar(d.login, d.senha); UI.aviso('Pronto, pode continuar.'); } }],
      fecharTxt: 'Sair do sistema',
    }).then((ok) => { if (!ok) App.sair(); });
    pedindoLogin = false;
  };
  document.addEventListener('jaf:sessaocaiu', () => App.sessaoCaiu());

  App.sair = async () => {
    clearInterval(timer);
    await API.sair();
    location.hash = '';
    App.telaLogin();
  };

  // ------------------------------------------------------------------ depois do login
  // senha provisória (criada pelo Dono): só entra depois de criar a própria senha
  App.telaTrocarSenha = () => {
    const raiz = novaRaiz();
    raiz.innerHTML = `
      <main class="login"><div class="login-caixa">
        <div class="login-marca"><img src="assets/logo.png" alt="JAF Metal"><span>Gestão</span></div>
        <h1>Crie a sua senha</h1>
        <p class="sub">Olá, <b>${U.esc(API.sessao.nome.split(' ')[0])}</b>! Você entrou com uma senha provisória. Escolha agora a sua senha — só você vai saber.</p>
        <form id="fSenha" novalidate>
          ${UI.campo({ nome: 'senha', rotulo: 'Nova senha', tipo: 'password', req: true, ajuda: 'Mínimo 8 caracteres. Evite datas, nomes e sequências como 12345678.', auto: 'new-password' })}
          ${UI.campo({ nome: 'senha2', rotulo: 'Repita a nova senha', tipo: 'password', req: true, auto: 'new-password' })}
          <p class="login-erro" role="alert" hidden></p>
          <button class="btn pri grande" type="submit"><span>Salvar e entrar</span></button>
        </form>
        <p class="login-rodape"><a href="#" id="sairTroca">Sair</a></p>
      </div></main>`;
    const f = raiz.querySelector('#fSenha'), erro = raiz.querySelector('.login-erro');
    raiz.querySelector('#sairTroca').onclick = (e) => { e.preventDefault(); App.sair(); };
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      erro.hidden = true;
      await UI.ocupado(f.querySelector('[type=submit]'), async () => {
        try {
          const d = UI.lerForm(f);
          if (d.senha.length < 8) throw new API.ErroApp('A senha precisa ter 8 caracteres ou mais.');
          if (d.senha !== d.senha2) throw new API.ErroApp('As duas senhas não são iguais.');
          if (/^(\d)\1+$|^(0123456789|123456789|12345678|87654321|senha123|password)/i.test(d.senha)) throw new API.ErroApp('Essa senha é fácil de adivinhar. Escolha outra.');
          await API.rpc('trocar_senha', { p_user: API.sessao.uid, p_senha: d.senha });
          API.sessao.trocar_senha = false;
          UI.aviso('Senha criada. Bem-vindo!');
          await App.entrarNoSistema();
        } catch (err) { erro.textContent = API.traduzir(err).message; erro.hidden = false; }
      });
    });
  };

  App.entrarNoSistema = async () => {
    if (API.sessao?.trocar_senha) return App.telaTrocarSenha();
    const raiz = document.getElementById('app');
    raiz.innerHTML = `<div class="carregando-tela"><img src="assets/logo.png" alt="JAF Metal"><div class="giro"></div><p>Carregando os dados…</p></div>`;
    try { await S.carregar(); }
    catch (e) {
      const err = API.traduzir(e);
      if (err.sessao) { await API.sair(); return App.telaLogin('Sua sessão expirou. Entre de novo.'); }
      raiz.innerHTML = `<div class="carregando-tela"><img src="assets/logo.png" alt="JAF Metal"><p class="erro-txt">${U.esc(err.message)}</p>
        <button class="btn pri" onclick="location.reload()">Tentar de novo</button> <button class="btn fantasma" id="sairErro">Sair</button></div>`;
      raiz.querySelector('#sairErro').onclick = App.sair;
      return;
    }
    montarLayout();
    window.onhashchange = () => App.render();
    App.render();
    clearInterval(timer);
    timer = setInterval(App.tick, 45000);
    // ouvintes globais: uma vez só por página (sair e entrar de novo não pode duplicar)
    if (!ligado) {
      ligado = true;
      S.ouvir(() => { if (API.sessao) App.redesenhar(); });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') App.tick(true); });
      document.addEventListener('jaf:rede', mostrarRede);
    }
    mostrarRede();
    if (!lerPref('boasVindas')) setTimeout(() => Telas.ajuda?.boasVindas(), 600);
  };

  function lerPref(k) { try { return JSON.parse(localStorage.getItem('jaf.pref.' + API.sessao.uid + '.' + k) || 'null'); } catch (e) { return null; } }
  function gravarPref(k, v) { try { localStorage.setItem('jaf.pref.' + API.sessao.uid + '.' + k, JSON.stringify(v)); } catch (e) {} }
  App.lerPref = lerPref; App.gravarPref = gravarPref;

  // busca no servidor o que mudou (de tempos em tempos e ao voltar para o app)
  let buscando = false;
  App.tick = async (voltou) => {
    if (!API.sessao || buscando || document.visibilityState !== 'visible' || !navigator.onLine) return;
    buscando = true;
    try {
      if (voltou && Date.now() - S.ultimaBusca > 20 * 60000) {
        if (!(await API.conferirSessao())) { App.sessaoCaiu(); return; }
      }
      if (Date.now() - S.carregadoEm > 15 * 60000 && !App.ocupado()) await S.carregar();
      else await S.atualizar();
    } catch (e) {
      const err = API.traduzir(e);
      if (err.sessao) App.sessaoCaiu();
    } finally { buscando = false; }
  };

  // depois de gravar: busca o que mudou nas tabelas afetadas
  App.gravou = async (tabelas, opt) => {
    try { await S.atualizar(tabelas, opt); } catch (e) { UI.erro(e); }
  };

  function mostrarRede() {
    const b = document.getElementById('semRede');
    if (b) b.hidden = navigator.onLine;
  }

  // ------------------------------------------------------------------ layout
  function montarLayout() {
    const s = API.sessao;
    const raiz = novaRaiz(); // elemento novo a cada login
    const grupos = [];
    for (const [rota, rot, ic, perm, grupo] of MENU) {
      if (!Perm.pode(perm)) continue;
      if (rota === 'equipe' && !Perm.pode('equipe_editar') && s.perfil === 'producao') continue;
      let g = grupos.find(x => x.nome === grupo);
      if (!g) grupos.push(g = { nome: grupo, itens: [] });
      g.itens.push(`<a href="#/${rota}" data-rota="${rota}">${UI.ic(ic)}<span>${rot}</span><b class="cont" data-cont="${rota}" hidden></b></a>`);
    }
    const abas = {
      producao: [['inicio', 'Início', 'inicio'], ['pecas', 'Estoque', 'estoque'], ['retirar', 'Retirar', 'retirar'], ['producao', 'Ordens', 'producao'], ['menu', 'Menu', 'menu']],
      almoxarife: [['inicio', 'Início', 'inicio'], ['pecas', 'Estoque', 'estoque'], ['retirar', 'Retirar', 'retirar'], ['compras', 'Compras', 'compras'], ['menu', 'Menu', 'menu']],
    }[s.perfil] || [['inicio', 'Início', 'inicio'], ['pecas', 'Estoque', 'estoque'], ['retirar', 'Retirar', 'retirar'], ['financeiro', 'Contas', 'dinheiro'], ['menu', 'Menu', 'menu']];

    raiz.innerHTML = `
      <div class="casca">
        <aside class="lateral" id="lateral">
          <div class="lateral-marca"><a href="#/inicio"><img src="assets/logo.png" alt="JAF Metal"></a>${API.modo === 'teste' ? '<span class="selo-teste">teste</span>' : ''}</div>
          <div class="lateral-acoes">
            <button type="button" class="btn pri" data-acao="retirar">${UI.ic('retirar')}<span>Retirar peça</span></button>
            ${Perm.pode('entrada') ? `<button type="button" class="btn sec-escuro" data-acao="entrada">${UI.ic('entrada')}<span>Dar entrada</span></button>` : ''}
          </div>
          <nav class="lateral-menu">${grupos.map(g => `${g.nome ? `<p class="grupo">${g.nome}</p>` : ''}${g.itens.join('')}`).join('')}</nav>
          <div class="lateral-usuario">
            <a href="#/conta" class="usuario"><span class="avatar">${U.esc((s.nome || '?').trim().charAt(0).toUpperCase())}</span>
              <span><b>${U.esc(s.nome)}</b><small>${Perm.nome(s.perfil)}</small></span></a>
            <button type="button" class="icone-btn" data-acao="sair" title="Sair" aria-label="Sair">${UI.ic('sair')}</button>
          </div>
        </aside>
        <div class="lateral-fundo" data-acao="fecharMenu"></div>
        <div class="principal">
          <header class="topo">
            <button type="button" class="icone-btn so-celular" data-acao="menu" aria-label="Menu">${UI.ic('menu')}</button>
            <a href="#/inicio" class="topo-marca so-celular"><img src="assets/logo.png" alt="JAF Metal"></a>
            <div class="topo-busca"><span>${UI.ic('busca')}</span><input id="buscaGeral" type="search" placeholder="Buscar peça pelo código ou nome…" autocomplete="off" aria-label="Buscar peça"><div class="busca-res" hidden></div></div>
            <div class="topo-acoes">
              <button type="button" class="icone-btn so-celular" data-acao="buscar" aria-label="Buscar">${UI.ic('busca')}</button>
              <button type="button" class="icone-btn" data-acao="atualizar" title="Buscar novidades" aria-label="Atualizar">${UI.ic('atualizar')}</button>
              <button type="button" class="icone-btn sino" data-acao="alertas" aria-label="Avisos">${UI.ic('sino')}<b class="bolinha" hidden></b></button>
            </div>
          </header>
          <div id="semRede" class="faixa-rede" hidden>${UI.ic('alerta')} Sem internet. Você pode consultar, mas nada é salvo até a conexão voltar.</div>
          <main id="conteudo"></main>
        </div>
        <nav class="abas">${abas.map(([r, t, ic]) => r === 'retirar'
          ? `<button type="button" class="aba aba-central" data-acao="retirar">${UI.ic(ic)}<span>${t}</span></button>`
          : r === 'menu' ? `<button type="button" class="aba" data-acao="menu">${UI.ic(ic)}<span>${t}</span></button>`
          : `<a class="aba" href="#/${r}" data-rota="${r}">${UI.ic(ic)}<span>${t}</span></a>`).join('')}</nav>
      </div>`;

    raiz.addEventListener('click', (e) => {
      const b = e.target.closest('[data-acao]');
      if (!b) { if (e.target.closest('.lateral-menu a, .lateral-usuario a')) document.body.classList.remove('menu-aberto'); return; }
      const a = b.dataset.acao;
      if (a === 'retirar') Telas.movimentos.retirar();
      else if (a === 'entrada') Telas.movimentos.entrada();
      else if (a === 'sair') UI.confirmar('Sair do sistema neste aparelho?', { ok: 'Sair' }).then(ok => ok && App.sair());
      else if (a === 'menu') document.body.classList.toggle('menu-aberto');
      else if (a === 'fecharMenu') document.body.classList.remove('menu-aberto');
      else if (a === 'atualizar') UI.ocupado(b, async () => { try { await S.carregar(); UI.aviso('Tudo atualizado.'); } catch (err) { UI.erro(err); } });
      else if (a === 'alertas') painelAlertas();
      else if (a === 'buscar') { document.body.classList.add('busca-aberta'); document.getElementById('buscaGeral').focus(); }
      if (a !== 'menu') document.body.classList.remove('menu-aberto');
    });
    ligarBuscaGeral();
  }

  // busca rápida de peça no topo
  function ligarBuscaGeral() {
    const inp = document.getElementById('buscaGeral');
    const res = inp.parentElement.querySelector('.busca-res');
    let itens = [], sel = 0;
    const desenhar = () => {
      const t = inp.value.trim();
      if (!t) { res.hidden = true; return; }
      itens = U.buscar(S.lista('pecas'), t, p => [p.codigo, p.descricao, p.utilizacao || ''], 8);
      sel = 0;
      res.innerHTML = itens.length ? itens.map((p, n) => `<a href="#/peca/${p.id}" class="${n === 0 ? 'sel' : ''}"><b>${U.esc(p.codigo)}</b><span>${U.esc(p.descricao)}</span><em>${U.qtd(p.estoque)}</em></a>`).join('')
        : `<p>Nenhuma peça com “${U.esc(t)}”.</p>`;
      res.hidden = false;
    };
    inp.addEventListener('input', desenhar);
    inp.addEventListener('focus', desenhar);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && itens[sel]) { location.hash = '#/peca/' + itens[sel].id; fim(); }
      else if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, itens.length - 1); marcar(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); marcar(); e.preventDefault(); }
      else if (e.key === 'Escape') fim();
    });
    const marcar = () => res.querySelectorAll('a').forEach((a, n) => a.classList.toggle('sel', n === sel));
    const fim = () => { inp.value = ''; res.hidden = true; inp.blur(); document.body.classList.remove('busca-aberta'); };
    res.addEventListener('pointerdown', (e) => e.preventDefault());
    res.addEventListener('click', (e) => { if (e.target.closest('a')) setTimeout(fim, 0); });
    inp.addEventListener('blur', () => setTimeout(() => { res.hidden = true; document.body.classList.remove('busca-aberta'); }, 150));
  }

  function painelAlertas() {
    const al = C.alertas();
    UI.modal({
      titulo: 'Avisos',
      corpo: al.length ? `<div class="alertas">${al.map(a => `<a class="alerta n-${a.nivel}" href="${a.rota}">${UI.ic('alerta')}<span>${U.esc(a.txt)}</span>${UI.ic('seta')}</a>`).join('')}</div>`
        : UI.vazio('ok', 'Nada pendente', 'Quando algo precisar de atenção (peça para comprar, pedido atrasado, conta vencendo…), aparece aqui.'),
      aoAbrir: (el, j) => el.addEventListener('click', (e) => { if (e.target.closest('a.alerta')) j.fechar(); }),
    });
  }

  function atualizarContadores() {
    const al = C.alertas();
    const urgentes = al.filter(a => a.nivel === 'alto').length;
    const b = document.querySelector('.sino .bolinha');
    if (b) { b.hidden = !al.length; b.textContent = al.length > 9 ? '9+' : String(al.length); b.classList.toggle('urgente', urgentes > 0); }
    const n = {
      'compras/lista': C.listaCompras().filter(x => !x.jaPedido).length,
      compras: S.lista('pedidos_compra').filter(p => p.status === 'aguardando' && p.prazo && p.prazo < U.hoje()).length,
      financeiro: Perm.pode('financeiro') ? S.lista('lancamentos').filter(l => !l.pago_em && l.vencimento <= U.hoje()).length : 0,
      producao: S.lista('ordens').filter(o => ['fila', 'producao'].includes(o.status) && o.prazo && o.prazo < U.hoje()).length,
      maquinas: S.lista('manutencoes').filter(m => m.status !== 'concluida' && m.tipo === 'corretiva').length,
    };
    document.querySelectorAll('[data-cont]').forEach(el => { const v = n[el.dataset.cont]; el.hidden = !v; el.textContent = v || ''; });
  }

  // ------------------------------------------------------------------ rotas
  const ROTAS = {
    '': 'inicio', inicio: 'inicio', pecas: 'pecas', peca: 'pecas', movimentos: 'movimentos', compras: 'compras', pedido: 'compras',
    fornecedores: 'fornecedores', fornecedor: 'fornecedores', maquinas: 'maquinas', maquina: 'maquinas', producao: 'producao',
    financeiro: 'financeiro', clientes: 'clientes', cliente: 'clientes', equipe: 'equipe', funcionario: 'equipe',
    relatorios: 'relatorios', admin: 'admin', ajuda: 'ajuda', conta: 'conta',
  };

  function lerRota() {
    const h = location.hash.replace(/^#\/?/, '');
    const [caminho, qs] = h.split('?');
    const partes = caminho.split('/').filter(Boolean);
    return { nome: partes[0] || '', id: partes[1] || null, sub: partes[1] || null, partes, q: new URLSearchParams(qs || ''), hash: location.hash };
  }

  // há algo sendo digitado / uma janela aberta? então não redesenha agora
  App.ocupado = () => {
    if (UI.janelaAberta() || document.querySelector('.janela-fundo')) return true;
    const v = document.getElementById('view');
    if (v?.dataset.sujo) return true;
    const ativo = document.activeElement;
    if (ativo && v?.contains(ativo) && ativo.matches('input,textarea,select')) return true;
    return false;
  };

  App.render = (forcar) => {
    const cont = document.getElementById('conteudo');
    if (!cont) return;
    const r = lerRota();
    const chave = ROTAS[r.nome];
    const tela = chave && Telas[chave];
    const mesmaRota = rotaAtual && rotaAtual.hash === r.hash;
    const y = mesmaRota ? window.scrollY : 0;
    rotaAtual = r;
    // recria o elemento da tela a cada desenho: ouvintes antigos morrem junto (evita gravar em dobro)
    const view = document.createElement('div');
    view.id = 'view';
    view.className = 'view';
    if (!tela) view.innerHTML = UI.vazio('alerta', 'Página não encontrada', '', `<a class="btn pri" href="#/inicio">Ir para o início</a>`);
    else if (tela.perm && !Perm.pode(tela.perm)) view.innerHTML = UI.vazio('cadeado', 'Sem acesso', 'Seu perfil não abre esta tela.', `<a class="btn pri" href="#/inicio">Ir para o início</a>`);
    else {
      try { view.innerHTML = tela.render(r) || ''; }
      catch (e) { console.error(e); view.innerHTML = UI.vazio('alerta', 'Algo deu errado nesta tela', U.esc(e.message), `<a class="btn pri" href="#/inicio">Ir para o início</a>`); }
    }
    cont.replaceChildren(view);
    UI.vigiar(view);
    if (tela?.depois && !(tela.perm && !Perm.pode(tela.perm))) { try { tela.depois(view, r); } catch (e) { console.error(e); } }
    const DETALHE = { peca: 'pecas', pedido: 'compras', fornecedor: 'fornecedores', maquina: 'maquinas', cliente: 'clientes', funcionario: 'equipe' };
    const ativo = (r.nome === 'compras' && r.sub === 'lista') ? 'compras/lista'
      : (r.nome === 'financeiro' && r.sub === 'fluxo') ? 'financeiro/fluxo'
      : DETALHE[r.nome] || r.nome || 'inicio';
    document.querySelectorAll('[data-rota]').forEach(a => a.classList.toggle('on', a.dataset.rota === ativo));
    document.title = (tela?.titulo ? (typeof tela.titulo === 'function' ? tela.titulo(r) : tela.titulo) + ' · ' : '') + 'JAF Metal';
    window.scrollTo(0, y);
    pendenteRedesenho = false;
    atualizarContadores();
  };

  // dados mudaram: redesenha se for seguro, senão espera
  App.redesenhar = () => {
    atualizarContadores();
    if (App.ocupado()) { pendenteRedesenho = true; return; }
    App.render();
  };
  App.depoisDeJanela = () => { if (pendenteRedesenho) setTimeout(() => { if (!App.ocupado()) App.render(); }, 200); };
  document.addEventListener('focusout', () => setTimeout(() => { if (pendenteRedesenho && !App.ocupado()) App.render(); }, 300));

  return App;
})();

// erros não tratados: avisa sem travar
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); if (API.sessao) UI.erro(e.reason); });
