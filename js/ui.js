/* JAF Metal — componentes de tela */
'use strict';

const UI = (() => {
  const UI = {};
  const esc = U.esc;

  // ------------------------------------------------------------------ ícones (traço 24×24)
  const IC = {
    inicio: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    estoque: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    retirar: '<path d="M12 14V3m0 0L8 7m4-4 4 4"/><path d="M4 13v7h16v-7"/>',
    entrada: '<path d="M12 3v11m0 0-4-4m4 4 4-4"/><path d="M4 13v7h16v-7"/>',
    compras: '<path d="M3 4h2l2.3 11a1 1 0 0 0 1 .8h9a1 1 0 0 0 1-.8L20 8H6"/><circle cx="9" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>',
    fornecedor: '<path d="M2 6h12v10H2zM14 9h4l3 3.5V16h-7"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    maquina: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    producao: '<path d="M3 21V11l5 3v-3l5 3v-3l5 3V4h3v17z"/><path d="M7 17h2M12 17h2"/>',
    dinheiro: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.8"/><path d="M6 12h.01M18 12h.01"/>',
    equipe: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2A6.5 6.5 0 0 1 21.5 20"/>',
    cliente: '<path d="M4 21V4h10v17M14 9h6v12M3 21h18"/><path d="M8 8h2M8 12h2M8 16h2M17 13h.01M17 17h.01"/>',
    relatorio: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    admin: '<path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    ajuda: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.5v.6M12 17.2v.01"/>',
    sino: '<path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
    mais: '<path d="M12 5v14M5 12h14"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    sair: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
    atualizar: '<path d="M20 11A8 8 0 0 0 5.3 7.2M4 3.5v4h4M4 13a8 8 0 0 0 14.7 3.8M20 20.5v-4h-4"/>',
    lapis: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>',
    lixo: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    imprimir: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><path d="M7 14h10v7H7z"/>',
    whatsapp: '<path d="M4 20.5 5.3 16.6A8.2 8.2 0 1 1 8.5 19.4z"/><path d="M9 9.5c.3 2.5 2.2 4.4 5 5l1-1.4-1.6-1-1 .7c-.8-.4-1.4-1-1.8-1.8l.7-1-1-1.6z"/>',
    telefone: '<path d="M5 3h3.5l2 5-2.4 1.4a11 11 0 0 0 5.5 5.5L15 12.5l5 2V18a2 2 0 0 1-2.2 2A16 16 0 0 1 4 6.2 2 2 0 0 1 5 3"/>',
    email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    ok: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    alerta: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.01"/>',
    baixar: '<path d="M12 3v12m-4-4 4 4 4-4"/><path d="M4 17v3h16v-3"/>',
    enviar: '<path d="M12 15V3m-4 4 4-4 4 4"/><path d="M4 17v3h16v-3"/>',
    desfazer: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    chave: '<path d="M14.7 6.3a4.2 4.2 0 0 0 5 5.3L21 13l-8.5 8.5-3-3L18 10l-1.3-1.3a4.2 4.2 0 0 1-5.3-5l2.6 2.6 1.9-.4z"/>',
    calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
    lista: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
    contar: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
    copiar: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    historico: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5"/><path d="M3.5 3.5v5h5M12 8v4.5l3 2"/>',
    filtro: '<path d="M3 5h18l-7 8.5V20l-4-2v-4.5z"/>',
    seta: '<path d="m9 6 6 6-6 6"/>',
    voltar: '<path d="m15 6-6 6 6 6"/>',
    planilha: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>',
    cadeado: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    olho: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/>',
    instalar: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M12 7v7m-3-3 3 3 3-3M10 18.5h4"/>',
  };
  UI.ic = (nome, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${IC[nome] || ''}</svg>`;

  // ------------------------------------------------------------------ pedacinhos
  UI.tag = (sit) => `<span class="tag t-${sit.cor}">${esc(sit.txt)}</span>`;
  UI.vazio = (icone, titulo, texto = '', botao = '') => `
    <div class="vazio">${UI.ic(icone)}<b>${esc(titulo)}</b>${texto ? `<p>${texto}</p>` : ''}${botao}</div>`;
  UI.chips = (opcoes, atual, nome = 'f') => `<div class="chips" role="tablist">${opcoes.map(o =>
    `<button type="button" class="chip ${o.v === atual ? 'on' : ''}" data-${nome}="${esc(o.v)}">${esc(o.t)}${o.n !== undefined && o.n !== null ? ` <span class="n">${o.n}</span>` : ''}</button>`).join('')}</div>`;
  UI.cab = (titulo, sub = '', acoes = '') => `<header class="cab"><div><h1>${esc(titulo)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${acoes ? `<div class="acoes">${acoes}</div>` : ''}</header>`;
  UI.voltar = (rota, txt = 'Voltar') => `<a class="voltar" href="${rota}">${UI.ic('voltar')} ${esc(txt)}</a>`;
  UI.btn = (txt, attrs = '', cls = 'sec', icone = '') => `<button type="button" class="btn ${cls}" ${attrs}>${icone ? UI.ic(icone) : ''}<span>${esc(txt)}</span></button>`;
  UI.dl = (pares) => `<dl class="dl">${pares.filter(p => p && p[1] !== null && p[1] !== undefined && p[1] !== '').map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;

  // ------------------------------------------------------------------ campos de formulário
  // f: {nome, rotulo, tipo, valor, req, opcoes:[{v,t}], ajuda, attrs, cls, min, step, placeholder}
  UI.campo = (f) => {
    const id = 'c_' + f.nome + '_' + Math.random().toString(36).slice(2, 7);
    const req = f.req ? ' required' : '';
    const v = f.valor === null || f.valor === undefined ? '' : f.valor;
    const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
    const at = f.attrs || '';
    let input;
    if (f.tipo === 'select') {
      input = `<select id="${id}" name="${f.nome}"${req} ${at}>${(f.opcoes || []).map(o => `<option value="${esc(o.v)}"${String(o.v) === String(v) ? ' selected' : ''}>${esc(o.t)}</option>`).join('')}</select>`;
    } else if (f.tipo === 'area') {
      input = `<textarea id="${id}" name="${f.nome}" rows="${f.linhas || 3}"${req}${ph} ${at}>${esc(v)}</textarea>`;
    } else if (f.tipo === 'check') {
      return `<label class="check ${f.cls || ''}"><input type="checkbox" name="${f.nome}" ${v ? 'checked' : ''} ${at}> <span>${esc(f.rotulo)}</span></label>`;
    } else if (f.tipo === 'num' || f.tipo === 'dinheiro' || f.tipo === 'qtd') {
      input = `<input id="${id}" name="${f.nome}" inputmode="decimal" autocomplete="off" data-num="${f.tipo}" value="${esc(v)}"${req}${ph} ${at}>`;
      if (f.tipo === 'dinheiro') input = `<div class="prefixo"><span>R$</span>${input}</div>`;
    } else {
      input = `<input id="${id}" name="${f.nome}" type="${f.tipo || 'text'}" value="${esc(v)}"${req}${ph} autocomplete="${f.auto || 'off'}" ${at}>`;
    }
    return `<div class="campo ${f.cls || ''}"><label for="${id}">${esc(f.rotulo)}${f.req ? ' <i class="req">*</i>' : ''}</label>${input}${f.ajuda ? `<small>${f.ajuda}</small>` : ''}</div>`;
  };

  UI.lerForm = (form) => {
    const o = {};
    for (const el of form.querySelectorAll('input[name], select[name], textarea[name]')) {
      if (el.type === 'checkbox') o[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
      else if (el.dataset.num) o[el.name] = U.num(el.value);
      else if (el.dataset.comboId !== undefined) o[el.name] = el.dataset.comboId || null;
      else o[el.name] = el.value.trim();
    }
    return o;
  };

  // marca o formulário como "mexido" (para não fechar/redesenhar e perder o que foi digitado)
  UI.vigiar = (raiz) => {
    raiz.addEventListener('input', (e) => { if (e.target.matches('input,textarea,select')) raiz.dataset.sujo = '1'; });
    raiz.addEventListener('change', (e) => { if (e.target.matches('input,textarea,select')) raiz.dataset.sujo = '1'; });
  };

  // ------------------------------------------------------------------ botão ocupado (anti toque duplo)
  UI.ocupado = async (btn, fn) => {
    if (btn.dataset.ocupado) return;
    btn.dataset.ocupado = '1'; btn.disabled = true; btn.classList.add('carregando');
    try { return await fn(); }
    finally { delete btn.dataset.ocupado; btn.disabled = false; btn.classList.remove('carregando'); }
  };

  // ------------------------------------------------------------------ avisos rápidos
  // com uma janela aberta, os avisos ficam logo ACIMA dos botões dela (nunca por cima)
  UI.posicionarAvisos = () => {
    const box = document.getElementById('avisos');
    if (!box) return;
    const pe = [...document.querySelectorAll('.janela-fundo:not(.saindo):not(.confirmar) .janela-pe')].at(-1);
    box.style.bottom = pe ? Math.max(8, innerHeight - pe.getBoundingClientRect().top + 8) + 'px' : '';
  };
  window.addEventListener('resize', () => UI.posicionarAvisos());

  UI.aviso = (msg, tipo = 'ok', opt = {}) => {
    const box = document.getElementById('avisos');
    UI.posicionarAvisos();
    const el = document.createElement('div');
    el.className = 'aviso a-' + tipo;
    el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
    el.innerHTML = `${UI.ic(tipo === 'erro' ? 'alerta' : 'ok')}<span>${esc(msg)}</span>${opt.acao ? `<button type="button" class="aviso-acao">${esc(opt.acao.txt)}</button>` : ''}<button type="button" class="aviso-x" aria-label="Fechar">${UI.ic('x')}</button>`;
    const sai = () => { el.classList.add('saindo'); setTimeout(() => el.remove(), 250); };
    el.querySelector('.aviso-x').onclick = sai;
    if (opt.acao) el.querySelector('.aviso-acao').onclick = async (e) => { e.target.disabled = true; sai(); await opt.acao.fn(); };
    box.appendChild(el);
    setTimeout(sai, opt.tempo || (opt.acao ? 9000 : (tipo === 'erro' ? 7000 : 3500)));
  };
  UI.erro = (e) => {
    const err = API.traduzir(e);
    console.warn(e);
    if (err.sessao) { App.sessaoCaiu(); return; }
    UI.aviso(err.message, 'erro');
  };

  // depois de fechar uma janela, segura os toques por um instante: um toque duplo no botão da janela
  // não pode "atravessar" e apertar o que estava embaixo (ex.: o Retirar da barra de baixo)
  UI.escudo = (ms = 450) => {
    const e = document.createElement('div');
    e.className = 'escudo-toque';
    e.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); }, true);
    document.body.appendChild(e);
    setTimeout(() => e.remove(), ms);
  };

  // ------------------------------------------------------------------ janelas
  // opt: {titulo, corpo, botoes:[{txt, cls, acao(form, janela) -> false mantém aberta}], aoAbrir(el, janela), largura:'larga'|'', fecharTxt}
  const pilha = [];
  UI.janelaAberta = () => pilha.length > 0;
  UI.modal = (opt) => new Promise((resolver) => {
    const fundo = document.createElement('div');
    fundo.className = 'janela-fundo';
    const id = 'j' + Math.random().toString(36).slice(2, 8);
    fundo.innerHTML = `
      <div class="janela ${opt.largura || ''}" role="dialog" aria-modal="true" aria-labelledby="${id}">
        <header class="janela-cab"><h2 id="${id}">${esc(opt.titulo || '')}</h2>
          <button type="button" class="icone-btn fechar" aria-label="Fechar">${UI.ic('x')}</button></header>
        <form class="janela-corpo" novalidate>${opt.corpo || ''}<div class="janela-erro" role="alert" hidden></div></form>
        <footer class="janela-pe">
          <button type="button" class="btn fantasma cancelar">${esc(opt.fecharTxt || (opt.botoes?.length ? 'Cancelar' : 'Fechar'))}</button>
          ${(opt.botoes || []).map((b, n) => `<button type="button" class="btn ${b.cls || 'pri'}" data-b="${n}">${b.icone ? UI.ic(b.icone) : ''}<span>${esc(b.txt)}</span></button>`).join('')}
        </footer>
      </div>`;
    document.body.appendChild(fundo);
    document.body.classList.add('com-janela');
    const form = fundo.querySelector('form');
    const caixaErro = fundo.querySelector('.janela-erro');
    UI.vigiar(form);
    let fechada = false;
    const j = {
      el: fundo, form,
      erro(msg) { caixaErro.hidden = !msg; caixaErro.textContent = msg || ''; if (msg) caixaErro.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); },
      fechar(valor) {
        if (fechada) return; fechada = true;
        UI.escudo();
        fundo.classList.add('saindo');
        setTimeout(() => { fundo.remove(); if (!document.querySelector('.janela-fundo')) document.body.classList.remove('com-janela'); UI.posicionarAvisos(); }, 180);
        pilha.splice(pilha.indexOf(j), 1);
        document.removeEventListener('keydown', tecla);
        resolver(valor);
        App.depoisDeJanela?.();
      },
    };
    pilha.push(j);
    const tentarFechar = async () => {
      if (form.dataset.sujo && !(await UI.confirmar('Sair sem salvar? O que você digitou será perdido.', { ok: 'Sair sem salvar', perigo: true }))) return;
      j.fechar(null);
    };
    const tecla = (e) => { if (e.key === 'Escape' && pilha[pilha.length - 1] === j) { e.preventDefault(); tentarFechar(); } };
    document.addEventListener('keydown', tecla);
    fundo.querySelector('.fechar').onclick = tentarFechar;
    fundo.querySelector('.cancelar').onclick = tentarFechar;
    fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) fundo.dataset.fora = '1'; });
    fundo.addEventListener('click', (e) => { if (e.target === fundo && fundo.dataset.fora) { delete fundo.dataset.fora; if (!form.dataset.sujo) j.fechar(null); } });
    (opt.botoes || []).forEach((b, n) => {
      const el = fundo.querySelector(`[data-b="${n}"]`);
      el.onclick = () => UI.ocupado(el, async () => {
        if (fechada) return; // janela já concluída (sumindo): toque a mais não faz nada
        j.erro('');
        if (b.validar !== false) {
          const inval = [...form.querySelectorAll('[required]')].find(c => c.dataset.comboId !== undefined ? !c.dataset.comboId : !String(c.value || '').trim());
          if (inval) { j.erro('Preencha: ' + (inval.closest('.campo')?.querySelector('label')?.textContent.replace('*', '').trim() || 'campo obrigatório')); inval.focus(); return; }
        }
        try {
          const r = await b.acao(form, j);
          if (r !== false) j.fechar(r === undefined ? true : r);
        } catch (e) {
          const err = API.traduzir(e);
          if (err.sessao) { App.sessaoCaiu(); j.erro('Sua sessão expirou. Entre de novo e toque outra vez neste botão — o que você digitou continua aqui.'); return; }
          j.erro(err.message);
        }
      });
    });
    // Enter no último campo = primeiro botão (exceto em área de texto)
    form.addEventListener('submit', (e) => { e.preventDefault(); (fundo.querySelector('.janela-pe .btn.pri[data-b]') || fundo.querySelector('[data-b="0"]'))?.click(); });
    if (opt.aoAbrir) opt.aoAbrir(fundo, j);
    requestAnimationFrame(() => {
      fundo.classList.add('aberta');
      setTimeout(UI.posicionarAvisos, 200);   // depois da animação de abrir
      const primeiro = form.querySelector('[autofocus]') || (matchMedia('(pointer: fine)').matches ? form.querySelector('input:not([type=checkbox]):not([readonly]),select,textarea') : null);
      if (primeiro) primeiro.focus({ preventScroll: true });
    });
  });

  UI.confirmar = (texto, opt = {}) => new Promise((ok) => {
    // já tem uma pergunta na tela (toque duplo): a segunda vale como "não"
    if (document.querySelector('.janela-fundo.confirmar')) { ok(false); return; }
    const fundo = document.createElement('div');
    fundo.className = 'janela-fundo aberta confirmar';
    fundo.innerHTML = `<div class="janela pequena" role="alertdialog" aria-modal="true">
      <div class="janela-corpo"><p class="confirmar-txt">${esc(texto)}</p>${opt.detalhe ? `<p class="sub">${opt.detalhe}</p>` : ''}</div>
      <footer class="janela-pe"><button type="button" class="btn fantasma n">${esc(opt.nao || 'Voltar')}</button>
      <button type="button" class="btn ${opt.perigo ? 'perigo' : 'pri'} s">${esc(opt.ok || 'Confirmar')}</button></footer></div>`;
    document.body.appendChild(fundo);
    const fim = (v) => { fundo.remove(); document.removeEventListener('keydown', tecla, true); ok(v); };
    const tecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); fim(false); } };
    document.addEventListener('keydown', tecla, true);
    fundo.querySelector('.n').onclick = () => fim(false);
    fundo.querySelector('.s').onclick = () => fim(true);
    fundo.querySelector('.s').focus();
  });

  // ------------------------------------------------------------------ campo com sugestões (peça, fornecedor, máquina...)
  // input: <input data-combo>; fonte(): lista; rotulo(x): texto; linha(x): html; campos(x): [principal, ...]
  UI.combo = (input, opt) => {
    input.dataset.comboId = opt.valorInicial?.id || '';
    if (opt.valorInicial) input.value = opt.rotulo(opt.valorInicial);
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('autocapitalize', 'none');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    const caixa = document.createElement('div');
    caixa.className = 'combo-lista';
    caixa.setAttribute('role', 'listbox');
    caixa.hidden = true;
    input.parentElement.classList.add('combo');
    input.parentElement.appendChild(caixa);
    let itens = [], sel = -1;
    const desenhar = () => {
      const lista = opt.fonte();
      const termo = input.value;
      // campo já escolhido: ao tocar de novo mostra a lista toda (para trocar)
      const t = input.dataset.comboId ? '' : termo;
      itens = t.trim() ? U.buscar(lista, t, opt.campos, 30) : U.ordenar(lista, x => U.sem(opt.campos(x)[0])).slice(0, 30);
      sel = itens.length ? 0 : -1;
      let html = itens.map((x, n) => `<div class="combo-item ${n === sel ? 'sel' : ''}" role="option" data-n="${n}">${opt.linha ? opt.linha(x) : esc(opt.rotulo(x))}</div>`).join('');
      if (!itens.length) html = `<div class="combo-nada">Nada encontrado${termo ? ` para “${esc(termo)}”` : ''}</div>`;
      if (opt.novo && termo.trim()) html += `<div class="combo-item combo-novo" data-novo="1">${UI.ic('mais')} Cadastrar “${esc(termo.trim())}”</div>`;
      caixa.innerHTML = html;
      caixa.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    };
    const fechar = () => { caixa.hidden = true; input.setAttribute('aria-expanded', 'false'); };
    const escolher = (x) => {
      input.dataset.comboId = x.id;
      input.value = opt.rotulo(x);
      fechar();
      input.dispatchEvent(new Event('change', { bubbles: true }));
      opt.aoEscolher?.(x);
    };
    input.addEventListener('focus', () => { if (!input.readOnly) { desenhar(); if (input.dataset.comboId) input.select(); } });
    input.addEventListener('input', () => { input.dataset.comboId = ''; desenhar(); opt.aoLimpar?.(); });
    input.addEventListener('keydown', (e) => {
      if (caixa.hidden && (e.key === 'ArrowDown')) { desenhar(); return; }
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, itens.length - 1); marcar(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); marcar(); e.preventDefault(); }
      else if (e.key === 'Enter') { if (!caixa.hidden && itens[sel]) { e.preventDefault(); escolher(itens[sel]); } }
      else if (e.key === 'Escape') { if (!caixa.hidden) { e.stopPropagation(); fechar(); } }
    });
    const marcar = () => { caixa.querySelectorAll('.combo-item').forEach((el, n) => el.classList.toggle('sel', n === sel)); caixa.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); };
    // pointerdown evita que o campo perca o foco antes do toque valer
    caixa.addEventListener('pointerdown', (e) => e.preventDefault());
    caixa.addEventListener('click', async (e) => {
      const it = e.target.closest('.combo-item');
      if (!it) return;
      if (it.dataset.novo) { fechar(); const x = await opt.novo(input.value.trim()); if (x) escolher(x); return; }
      escolher(itens[Number(it.dataset.n)]);
    });
    input.addEventListener('blur', () => setTimeout(() => {
      fechar();
      // texto que não virou escolha: tenta casar exato, senão limpa
      if (!input.dataset.comboId && input.value.trim()) {
        const t = U.sem(input.value.trim());
        const igual = opt.fonte().find(x => U.sem(opt.rotulo(x)) === t || U.sem(opt.campos(x)[0]) === t);
        if (igual) escolher(igual);
      }
    }, 120));
    return { definir: (x) => x ? escolher(x) : (input.dataset.comboId = '', input.value = ''), valor: () => input.dataset.comboId || null };
  };

  // atalhos de combos comuns
  UI.comboPeca = (input, opt = {}) => UI.combo(input, {
    tabela: 'pecas',
    fonte: () => S.lista('pecas').filter(p => p.ativo || p.id === opt.valorInicial?.id),
    campos: (p) => [p.codigo, p.descricao, p.utilizacao || ''],
    rotulo: (p) => p.codigo ? `${p.codigo} — ${p.descricao}` : '',
    linha: (p) => `<b>${esc(p.codigo)}</b> <span>${esc(p.descricao)}</span><em class="${p.estoque <= 0 ? 'zero' : ''}">${U.qtd(p.estoque)} ${esc(p.unidade)}</em>`,
    ...opt,
  });
  UI.comboFornecedor = (input, opt = {}) => UI.combo(input, {
    tabela: 'fornecedores',
    fonte: () => S.lista('fornecedores').filter(f => f.ativo || f.id === opt.valorInicial?.id),
    campos: (f) => [f.nome, f.razao || '', f.cnpj || ''],
    rotulo: (f) => f.nome || '',
    linha: (f) => `<b>${esc(f.nome)}</b>${f.razao && f.razao !== f.nome ? ` <span>${esc(f.razao)}</span>` : ''}`,
    novo: Perm.pode('compras') ? (nome) => Telas.fornecedores.novoRapido(nome) : null,
    ...opt,
  });
  UI.comboMaquina = (input, opt = {}) => UI.combo(input, {
    tabela: 'maquinas',
    fonte: () => S.lista('maquinas').filter(m => m.ativo),
    campos: (m) => [m.nome, m.tipo || '', m.setor || ''],
    rotulo: (m) => m.nome || '',
    novo: Perm.pode('maquinas_editar') ? (nome) => Telas.maquinas.novaRapida(nome) : null,
    ...opt,
  });
  UI.comboFuncionario = (input, opt = {}) => UI.combo(input, {
    tabela: 'funcionarios',
    fonte: () => S.lista('funcionarios').filter(f => f.ativo),
    campos: (f) => [f.nome, f.funcao || '', f.setor || ''],
    rotulo: (f) => f.nome || '',
    linha: (f) => `<b>${esc(f.nome)}</b>${f.funcao ? ` <span>${esc(f.funcao)}</span>` : ''}`,
    ...opt,
  });
  UI.comboCliente = (input, opt = {}) => UI.combo(input, {
    tabela: 'clientes',
    fonte: () => S.lista('clientes').filter(c => c.ativo),
    campos: (c) => [c.nome, c.razao || '', c.cnpj || ''],
    rotulo: (c) => c.nome || '',
    novo: Perm.pode('clientes') ? (nome) => Telas.clientes.novoRapido(nome) : null,
    ...opt,
  });

  // ------------------------------------------------------------------ "mostrar mais" para listas longas
  UI.paginar = (raiz, itens, desenhar, passo = 60) => {
    let n = 0;
    const alvo = raiz.querySelector('[data-pagina]');
    const botao = raiz.querySelector('[data-mais]');
    const mais = () => {
      const fatia = itens.slice(n, n + passo);
      alvo.insertAdjacentHTML('beforeend', fatia.map(desenhar).join(''));
      n += fatia.length;
      if (botao) { botao.hidden = n >= itens.length; botao.querySelector('span').textContent = `Mostrar mais (${itens.length - n})`; }
    };
    alvo.innerHTML = '';
    if (botao) botao.onclick = mais;
    mais();
  };

  return UI;
})();
