/* Roteiro de teste pela TELA (modo teste). Rodar no console da página aberta com ?modo=teste:
 *   fetch('testes/roteiro-ui.js').then(r => r.text()).then(eval); roteiro();   → resultado em window.__r
 * Usa a interface como uma pessoa: abre janelas, digita, escolhe na lista e toca nos botões. */
'use strict';
window.roteiro = async function roteiro(filtro) {
  const R = window.__r = { ok: 0, falhas: [], log: [], fim: false };
  const conf = (c, nome, extra) => { if (c) R.ok++; else R.falhas.push(nome + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); };
  const dorme = (ms) => new Promise(ok => setTimeout(ok, ms));
  const espera = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = fn(); if (v) return v; } catch (e) {} await dorme(40); } return null; };
  const janela = () => [...document.querySelectorAll('.janela-fundo:not(.confirmar)')].at(-1);
  const ir = async (h) => { location.hash = h; await dorme(120); };
  // como uma pessoa digitando: o valor entra pelo "setter" nativo (o React percebe a mudança) e dispara input/change
  const digitar = (el, v) => { el.focus(); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const botao = (txt, raiz = document) => { const l = [...raiz.querySelectorAll('button, a.btn')].filter(b => !b.disabled && b.offsetParent); const t = (b) => b.textContent.trim().replace(/\s+/g, ' ');
    return l.find(b => t(b) === txt) || l.find(b => t(b).startsWith(txt)); };
  const clicar = async (txt, raiz) => { const b = typeof txt === 'string' ? botao(txt, raiz) : txt; if (!b) throw new Error('botão não achado: ' + txt); b.click(); await dorme(60); return b; };
  const okJanela = async (txt) => { const j = janela(); await clicar(txt, j.querySelector('.janela-pe')); await espera(() => !document.body.contains(j) || j.querySelector('.janela-erro:not([hidden])'), 6000); await dorme(80); return j; };
  const erroJanela = (j) => j && document.body.contains(j) && !j.querySelector('.janela-erro').hidden ? j.querySelector('.janela-erro').textContent : null;
  const confirmar = async (sim = true) => { const c = await espera(() => document.querySelector('.janela-fundo.confirmar')); c.querySelector(sim ? '.s' : '.n').click(); await dorme(80); };
  async function combo(input, termo) {
    input.focus(); input.dispatchEvent(new Event('focus'));
    digitar(input, termo);
    const it = await espera(() => input.parentElement.querySelector('.combo-item:not(.combo-novo)'));
    if (!it) throw new Error('combo sem resultado: ' + termo);
    it.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); it.click(); await dorme(60);
  }
  const est = (cod) => S.lista('pecas').find(p => p.codigo === cod)?.estoque;
  const aviso = () => [...document.querySelectorAll('#avisos .aviso')].at(-1);
  async function como(login) {
    await API.sair(); await API.entrar(login, 'teste1234'); App.gravarPref('boasVindas', true); await App.entrarNoSistema(); await dorme(700);
    UI.fecharTodas();
  }
  const passo = async (nome, fn) => {
    if (filtro && !nome.includes(filtro)) return;
    R.log.push('▶ ' + nome);
    try { await fn(); } catch (e) { R.falhas.push(nome + ': ERRO ' + e.message); console.error(e); }
    UI.fecharTodas();
    await dorme(100);
  };

  // ================================================================ DONO
  await como('dono');
  const P1 = 'CNMG 120412-EX';

  await passo('retirar e desfazer', async () => {
    const antes = est(P1), nMov = S.lista('movimentos').length;
    await clicar(document.querySelector('.lateral [data-acao="retirar"]'));
    const j = await espera(janela);
    await combo(j.querySelector('#rPeca'), 'cnmg120412');
    conf(j.querySelector('#rInfo').textContent.includes('No estoque'), 'mostra o estoque da peça ao escolher');
    conf(j.querySelector('#rMaq').value === '', 'utilização "Torno CNC" não é nome exato de máquina: não preenche sozinho');
    digitar(j.querySelector('#rQtd'), '2');
    await combo(j.querySelector('#rMaq'), 'Torno CNC 01');
    await okJanela('Retirar');
    conf(!document.body.contains(j), 'janela fecha depois de retirar', erroJanela(j));
    conf(est(P1) === antes - 2, 'estoque baixou 2', [antes, est(P1)]);
    const m = S.lista('movimentos').slice(nMov);
    conf(m.length >= 1 && m.every(x => x.tipo === 'saida' && x.maquina_id), 'saída gravada com máquina', m.length);
    conf(m[0]?.funcionario_id === null || !!m[0]?.funcionario_id, 'quem retirou opcional');
    const av = aviso(); conf(av && av.textContent.includes('Retirado 2'), 'aviso de retirada', av?.textContent);
    await clicar(av.querySelector('.aviso-acao'));
    await espera(() => est(P1) === antes, 4000);
    conf(est(P1) === antes, 'desfazer pelo aviso devolve o estoque', [antes, est(P1)]);
  });

  await passo('retirar mais do que tem', async () => {
    const p = S.lista('pecas').find(x => x.codigo === '30208');
    const n = S.lista('movimentos').length;
    Telas.movimentos.retirar(p);
    const j = await espera(janela); await dorme(150);
    conf(document.activeElement === j.querySelector('#rQtd'), 'peça já escolhida: foco vai para a quantidade');
    digitar(j.querySelector('#rQtd'), String(p.estoque + 5));
    conf(j.querySelector('#rInfo .nota.vermelha'), 'avisa antes de enviar que não tem tudo isso');
    await okJanela('Retirar');
    conf(document.body.contains(j) && /Só tem/.test(erroJanela(j) || ''), 'erro aparece DENTRO da janela, que continua aberta', erroJanela(j));
    conf(S.lista('movimentos').length === n, 'nada foi gravado');
  });

  await passo('toque duplo no retirar', async () => {
    const antes = est(P1);
    Telas.movimentos.retirar(S.lista('pecas').find(x => x.codigo === P1));
    const j = await espera(janela);
    digitar(j.querySelector('#rQtd'), '1');
    const b = botao('Retirar', j.querySelector('.janela-pe'));
    const lista = [...j.querySelectorAll('.janela-pe .btn')].filter(x => x.textContent.trim() === 'Retirar');
    lista[0].click(); lista[0].click(); lista[0].click();
    await espera(() => !document.body.contains(j), 5000);
    await dorme(300);
    conf(est(P1) === antes - 1, 'três toques seguidos tiram só 1', [antes, est(P1)]);
    void b;
  });

  await passo('retirar e lançar outra', async () => {
    const antes = est(P1);
    Telas.movimentos.retirar();
    const j = await espera(janela);
    await combo(j.querySelector('#rPeca'), P1); digitar(j.querySelector('#rQtd'), '1');
    await clicar('Retirar e lançar outra', j.querySelector('.janela-pe'));
    await espera(() => est(P1) === antes - 1, 4000);
    conf(document.body.contains(j) && j.querySelector('#rPeca').value === '', 'janela continua aberta e limpa para a próxima');
    await combo(j.querySelector('#rPeca'), P1); digitar(j.querySelector('#rQtd'), '1');
    await okJanela('Retirar');
    conf(est(P1) === antes - 2, 'duas retiradas seguidas', [antes, est(P1)]);
  });

  await passo('aviso não cobre botão da janela', async () => {
    UI.aviso('Aviso de teste com um texto comprido para ocupar bastante espaço na tela', 'ok', { acao: { txt: 'Desfazer', fn: () => {} }, tempo: 8000 });
    Telas.movimentos.retirar(); await dorme(500);
    const j = janela();
    const cobertos = [...j.querySelectorAll('.janela-pe .btn')].filter(b => { const r = b.getBoundingClientRect();
      const no = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !(no === b || b.contains(no)); });
    conf(cobertos.length === 0, 'com aviso na tela, os botões da janela continuam livres', cobertos.map(b => b.textContent.trim()));
    document.querySelectorAll('#avisos .aviso').forEach(a => a.remove());
  });

  await passo('entrada de compra', async () => {
    const p = S.lista('pecas').find(x => x.codigo === 'A34-EX'), antes = p.estoque;
    Telas.movimentos.entrada(p);
    const j = await espera(janela);
    conf(U.num(j.querySelector('[name=preco_unit]').value) > 0, 'traz o último preço pago', j.querySelector('[name=preco_unit]').value);
    digitar(j.querySelector('[name=qtd]'), '3'); digitar(j.querySelector('[name=preco_unit]'), '35,50'); digitar(j.querySelector('[name=documento]'), 'NF 777');
    await okJanela('Dar entrada');
    conf(!document.body.contains(j), 'entrada gravada', erroJanela(j));
    conf(est('A34-EX') === antes + 3, 'estoque subiu 3');
    const l = C.lotes(p.id).at(-1); conf(l?.mov.documento === 'NF 777' && l.mov.preco_unit === 35.5, 'lote novo com nota e preço', l?.mov);
  });

  await passo('contagem', async () => {
    const p = S.lista('pecas').find(x => x.codigo === 'LED-10W');
    await ir('#/peca/' + p.id);
    await clicar('Contar', document.getElementById('view'));
    const j = await espera(janela);
    digitar(j.querySelector('[name=contado]'), String(p.estoque + 2));
    conf(j.querySelector('#difC').textContent.includes('+2'), 'mostra a diferença antes de salvar');
    await okJanela('Salvar contagem');
    conf(est('LED-10W') === p.estoque, 'estoque igual ao contado', [est('LED-10W')]);
  });

  let pedId;
  await passo('pedido pela lista de compras', async () => {
    await ir('#/compras/lista');
    const v = document.getElementById('view');
    const g = v.querySelector('[data-gerar]'); conf(!!g, 'lista de compras tem grupo com botão gerar pedido');
    const qtds = [...g.closest('[data-grupo]').querySelectorAll('.qtdc')].map(i => U.num(i.value));
    conf(qtds.every(q => q > 0), 'sugestões com quantidade', qtds);
    g.click(); await dorme(100);
    const j = await espera(janela);
    const linhas = j.querySelectorAll('.item-ped'); conf(linhas.length === qtds.length, 'pedido vem com as peças da lista', [linhas.length, qtds.length]);
    conf([...j.querySelectorAll('[name=ipreco]')].every(i => U.num(i.value) > 0), 'preços sugeridos pelo último preço');
    await clicar(j.querySelector('[data-prazo="7"]'));
    conf(j.querySelector('#pPrazo').value === U.somaDias(U.hoje(), 7), 'botão +7 dias no prazo');
    const n = S.lista('pedidos_compra').length;
    await okJanela('Criar pedido');
    conf(S.lista('pedidos_compra').length === n + 1, 'pedido criado', erroJanela(j));
    const ped = S.lista('pedidos_compra').at(-1); pedId = ped.id;
    await espera(() => location.hash.includes(ped.id));
    const env = await espera(() => janela()?.querySelector('h2')?.textContent.includes('Enviar'), 3000);
    conf(!!env, 'abre "Enviar ao fornecedor" depois de criar');
    conf(janela()?.querySelector('.texto-pre')?.textContent.includes('nº ' + ped.numero), 'texto do pedido com o número');
    await clicar('Fechar', janela());
    const lc = C.listaCompras().filter(x => !x.jaPedido && x.peca.fornecedor_id === ped.fornecedor_id);
    conf(lc.length === 0, 'depois de pedir, as peças saem da lista de compras (viram "já pedidas")', lc.map(x => x.peca.codigo));
  });

  await passo('receber parcial e completo', async () => {
    const ped = S.get('pedidos_compra', pedId); const itens = C.itensDoPedido(pedId);
    const e0 = itens.map(i => S.get('pecas', i.peca_id).estoque);
    await ir('#/pedido/' + pedId);
    await clicar('Receber', document.getElementById('view'));
    let j = await espera(janela);
    const recs = j.querySelectorAll('.rec');
    digitar(recs[0], U.campoNum(Math.floor(itens[0].qtd / 2), 3));
    conf(j.querySelector('[name=encerrar]'), 'recebimento parcial oferece "encerrar assim mesmo"');
    conf(j.querySelector('[name=lancar]')?.checked, 'dono vê "lançar conta a pagar" marcado');
    digitar(j.querySelector('[name=documento]'), 'NF 12345');
    const nL = S.lista('lancamentos').length;
    await okJanela('Confirmar recebimento');
    conf(!document.body.contains(j), 'recebimento parcial gravado', erroJanela(j));
    conf(S.get('pedidos_compra', pedId).status === 'aguardando', 'pedido continua aguardando o resto');
    conf(S.get('pecas', itens[0].peca_id).estoque === e0[0] + Math.floor(itens[0].qtd / 2), 'entrou só a metade do 1º item');
    conf(S.lista('lancamentos').length === nL + 1, 'conta a pagar lançada no recebimento');
    await dorme(150);
    await clicar('Receber', document.getElementById('view'));
    j = await espera(janela);
    conf(!j.querySelector('[name=lancar]').checked, 'segunda vez: "lançar conta" vem desmarcado (já tem conta)');
    await okJanela('Confirmar recebimento');
    conf(S.get('pedidos_compra', pedId).status === 'recebido', 'pedido recebido por completo', erroJanela(j));
    conf(itens.every((i, n) => S.get('pecas', i.peca_id).estoque === e0[n] + i.qtd), 'estoque de todas as peças subiu o pedido inteiro');
    void ped;
  });

  await passo('ordem de produção', async () => {
    await ir('#/producao');
    await clicar('Nova ordem', document.getElementById('view'));
    let j = await espera(janela);
    await combo(j.querySelector('#oCli'), 'Upgrade');
    digitar(j.querySelector('[name=produto]'), 'Barra teste 300 mm'); digitar(j.querySelector('[name=qtd]'), '50');
    digitar(j.querySelector('[name=prazo]'), U.somaDias(U.hoje(), 3));
    await okJanela('Criar ordem');
    const o = S.lista('ordens').find(x => x.produto === 'Barra teste 300 mm');
    conf(o && o.cliente_nome === 'Upgrade Barras de Apoio' && o.status === 'fila', 'ordem criada na fila', o);
    Telas.producao.abrir(o.id); j = await espera(janela);
    await okJanela('Começar a produzir');
    conf(S.get('ordens', o.id).status === 'producao', 'produzindo');
    Telas.producao.abrir(o.id); j = await espera(janela);
    digitar(j.querySelector('[name=produzido]'), '20');
    await okJanela('Salvar quantidade');
    conf(S.get('ordens', o.id).produzido === 20, 'apontou 20');
    Telas.producao.abrir(o.id); j = await espera(janela);
    digitar(j.querySelector('[name=produzido]'), '45');
    await clicar('Marcar como pronta', j.querySelector('.janela-pe'));
    conf(!!(await espera(() => document.querySelector('.janela-fundo.confirmar'))), 'pronta com menos do que a quantidade pergunta antes');
    await confirmar(false);
    conf(S.get('ordens', o.id).status === 'producao', 'escolheu corrigir: continua produzindo');
    digitar(j.querySelector('[name=produzido]'), '20');
    await okJanela('Marcar como pronta');
    conf(S.get('ordens', o.id).status === 'pronta' && S.get('ordens', o.id).produzido === 50, 'pronta completa a quantidade');
    Telas.producao.abrir(o.id); j = await espera(janela);
    await clicar('Entregue', j.querySelector('.janela-pe'));
    const j2 = await espera(() => janela() !== j && janela());
    digitar(j2.querySelector('[name=valor]'), '1.500,00');
    await okJanela('Confirmar entrega');
    await espera(() => S.get('ordens', o.id).status === 'entregue');
    conf(S.get('ordens', o.id).status === 'entregue', 'entregue');
    const l = S.lista('lancamentos').find(x => x.ordem_id === o.id);
    conf(l && l.valor === 1500 && l.tipo === 'receber', 'conta a receber de R$ 1.500 lançada na entrega', l);
  });

  await passo('contas', async () => {
    await ir('#/financeiro');
    await clicar('Nova conta', document.getElementById('view'));
    const j = await espera(janela);
    digitar(j.querySelector('[name=descricao]'), 'Teste parcelado'); digitar(j.querySelector('[name=valor]'), '1000');
    j.querySelector('[name=parcelas]').value = '3'; j.querySelector('[name=parcelas]').dispatchEvent(new Event('change', { bubbles: true }));
    conf(j.querySelector('#lParc').textContent.includes('3 contas'), 'explica as parcelas');
    await okJanela('Lançar');
    const ls = S.lista('lancamentos').filter(x => x.descricao === 'Teste parcelado');
    conf(ls.length === 3 && U.r2(U.soma(ls, 'valor')) === 1000, '3 parcelas somando 1.000', ls.map(x => x.valor));
    Telas.financeiro.abrir(ls[0].id); let k = await espera(janela);
    digitar(k.querySelector('[name=bvalor]'), '340'); await okJanela('Marcar como paga');
    conf(S.get('lancamentos', ls[0].id).pago_em === U.hoje() && S.get('lancamentos', ls[0].id).valor_pago === 340, 'baixa com valor diferente');
    Telas.financeiro.abrir(ls[1].id); k = await espera(janela);
    await clicar(k.querySelector('[data-x="excluir"]'));
    await confirmar(true); // excluir também as outras em aberto
    await espera(() => S.lista('lancamentos').filter(x => x.descricao === 'Teste parcelado').length === 1);
    conf(S.lista('lancamentos').filter(x => x.descricao === 'Teste parcelado').length === 1, 'excluiu as 2 em aberto e manteve a paga');
  });

  await passo('manutenção', async () => {
    const maq = S.lista('maquinas').find(m => m.nome === 'Prensa Hidráulica');
    await ir('#/maquina/' + maq.id);
    await clicar('Abrir chamado', document.getElementById('view'));
    let j = await espera(janela);
    digitar(j.querySelector('[name=problema]'), 'Vazamento de óleo no pistão');
    await okJanela('Abrir chamado');
    conf(C.situacaoMaquina(S.get('maquinas', maq.id)).cod === 'parada', 'máquina fica "com problema"');
    const m = S.lista('manutencoes').find(x => x.problema === 'Vazamento de óleo no pistão');
    Telas.maquinas.formManutencao(m); j = await espera(janela);
    j.querySelector('[name=status]').value = 'concluida'; digitar(j.querySelector('[name=solucao]'), 'Troca do retentor'); digitar(j.querySelector('[name=custo_servico]'), '180');
    await okJanela('Salvar');
    conf(S.get('manutencoes', m.id).status === 'concluida' && S.get('manutencoes', m.id).custo_servico === 180, 'chamado concluído com custo');
  });

  await passo('cadastros', async () => {
    await ir('#/fornecedores'); await clicar('Novo fornecedor', document.getElementById('view'));
    let j = await espera(janela);
    digitar(j.querySelector('[name=nome]'), 'Teste Ltda'); digitar(j.querySelector('[name=celular]'), '(11) 98888-7777');
    await okJanela('Cadastrar');
    const f = S.lista('fornecedores').find(x => x.nome === 'Teste Ltda'); conf(!!f, 'fornecedor cadastrado', erroJanela(j));
    await ir('#/fornecedores'); await clicar('Novo fornecedor', document.getElementById('view'));
    j = await espera(janela); digitar(j.querySelector('[name=nome]'), 'teste ltda');
    await okJanela('Cadastrar'); conf(/Já existe/.test(erroJanela(j) || ''), 'nome repetido avisado na janela', erroJanela(j));
    await ir('#/pecas'); await clicar('Nova peça', document.getElementById('view'));
    j = await espera(janela);
    digitar(j.querySelector('[name=codigo]'), 'TESTE-001'); digitar(j.querySelector('[name=descricao]'), 'Peça de teste');
    digitar(j.querySelector('[name=est_min]'), '5'); digitar(j.querySelector('[name=est_max]'), '2');
    await okJanela('Cadastrar'); conf(/menor que o mínimo/.test(erroJanela(j) || ''), 'máximo menor que mínimo recusado', erroJanela(j));
    digitar(j.querySelector('[name=est_max]'), '10');
    await combo(j.querySelector('#cForn'), 'Teste Ltda');
    await okJanela('Cadastrar');
    const p = S.lista('pecas').find(x => x.codigo === 'TESTE-001');
    conf(p && p.fornecedor_id === f.id && p.est_min === 5, 'peça cadastrada com fornecedor', p);
    conf(C.situacao(p).cod === 'comprar', 'peça nova com mínimo 5 e estoque 0 = comprar');
  });

  await passo('janela protege o que foi digitado', async () => {
    Telas.movimentos.retirar(); const j = await espera(janela);
    digitar(j.querySelector('[name=obs]'), 'texto importante');
    App.redesenhar(); await S.atualizar(); await dorme(200);
    conf(document.body.contains(j) && j.querySelector('[name=obs]').value === 'texto importante', 'atualização dos dados não apaga a janela aberta');
    j.querySelector('.fechar').click(); await dorme(80);
    conf(!!document.querySelector('.janela-fundo.confirmar'), 'fechar com dado digitado pergunta antes');
    await confirmar(false);
    conf(document.body.contains(j), 'escolheu voltar: a janela continua');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await dorme(80);
    await confirmar(true); await dorme(250);
    conf(!document.body.contains(j), 'confirmou: fecha');
  });

  await passo('equipe e acessos', async () => {
    await ir('#/equipe'); await clicar('Novo funcionário', document.getElementById('view'));
    let j = await espera(janela);
    digitar(j.querySelector('[name=nome]'), 'Zeca Teste'); digitar(j.querySelector('[name=admissao]'), U.somaMeses(U.hoje(), -25)); digitar(j.querySelector('[name=salario]'), '2.500,00');
    await okJanela('Cadastrar');
    const f = S.lista('funcionarios').find(x => x.nome === 'Zeca Teste');
    conf(f && S.get('funcionarios_privado', f.id)?.salario === 2500, 'funcionário com salário', erroJanela(j));
    const fe = C.ferias(f, S.get('funcionarios_privado', f.id)); conf(fe.pendentes === 2 && fe.vencida === true, '25 meses de casa sem férias: 2 períodos e a 1ª já venceu (prazo: 24 meses de casa)', fe);
    await ir('#/admin');
    await clicar('Novo acesso', document.getElementById('view'));
    j = await espera(janela);
    digitar(j.querySelector('[name=nome]'), 'Zeca'); digitar(j.querySelector('[name=login]'), 'zeca'); j.querySelector('[name=perfil][value=producao]').checked = true;
    await combo(j.querySelector('#aFunc'), 'Zeca');
    digitar(j.querySelector('[name=senha]'), 'teste1234'); digitar(j.querySelector('[name=senha2]'), 'teste1234');
    await okJanela('Criar acesso');
    conf(S.lista('perfis').some(p => p.login === 'zeca' && p.funcionario_id === f.id), 'acesso criado ligado ao funcionário', erroJanela(j));
  });

  await passo('relatórios', async () => {
    for (const r of ['estoque', 'consumo', 'compras', 'maquinas', 'fornecedores', 'financeiro']) {
      await ir('#/relatorios?r=' + r); await dorme(80);
      const v = document.getElementById('view');
      conf(!v.querySelector('.vazio .ic') || r === 'financeiro', 'relatório ' + r + ' abre', v.querySelector('.vazio b')?.textContent);
    }
    const v = (await ir('#/relatorios?r=estoque'), document.getElementById('view'));
    const val = Number(v.querySelector('.kpi b').textContent.replace(/[^\d,]/g, '').replace(',', '.'));
    conf(Math.abs(val - Math.round(C.valorEstoque())) <= 1, 'valor do estoque igual ao cálculo', [val, C.valorEstoque()]);
  });

  // ================================================================ PRODUÇÃO
  await passo('perfil produção', async () => {
    await como('operador');
    const menu = [...document.querySelectorAll('.lateral-menu a')].map(a => a.textContent.trim());
    conf(!menu.some(t => /Pedidos de compra|Fornecedores|Contas|Fluxo|Clientes|Relatórios|Administração/.test(t)), 'menu da produção sem compras/financeiro/admin', menu);
    await ir('#/pecas'); conf(!document.getElementById('view').textContent.includes('R$'), 'estoque sem preços');
    const p = S.lista('pecas').find(x => x.codigo === P1);
    await ir('#/peca/' + p.id); conf(!document.getElementById('view').textContent.includes('R$'), 'ficha da peça sem preços');
    conf(!botao('Entrada', document.getElementById('view')) && !botao('Editar', document.getElementById('view')), 'sem botões de entrada/editar');
    await ir('#/compras'); conf(document.getElementById('view').textContent.includes('Sem acesso'), 'compras bloqueado');
    await ir('#/financeiro'); conf(document.getElementById('view').textContent.includes('Sem acesso'), 'financeiro bloqueado');
    conf(S.lista('lancamentos').length === 0 && S.lista('fornecedores').length === 0 && S.lista('clientes').length === 0, 'banco não manda financeiro, fornecedores nem clientes para a produção');
    conf(S.lista('movimentos').every(m => m.criado_por === API.sessao.uid), 'só as próprias movimentações');
    const antes = est(P1);
    Telas.movimentos.retirar(p); const j = await espera(janela);
    conf(!j.querySelector('[name=data]'), 'produção não muda a data da retirada');
    conf(!j.querySelector('#rInfo').textContent.includes('R$'), 'janela de retirada sem custo');
    conf(j.querySelector('#rFunc').value === 'Beto Silva', 'quem retira já vem preenchido com o funcionário do acesso', j.querySelector('#rFunc').value);
    await okJanela('Retirar');
    conf(est(P1) === antes - 1, 'produção retira');
    const m = S.lista('movimentos').at(-1);
    Telas.movimentos.detalhe(m.id); const k = await espera(janela);
    conf(!k.textContent.includes('R$'), 'detalhe sem preço');
    await clicar('Desfazer este lançamento', k.querySelector('.janela-pe')); await confirmar(true);
    await espera(() => est(P1) === antes);
    conf(est(P1) === antes, 'produção desfaz a própria retirada');
    const o = S.lista('ordens').find(x => x.status === 'producao');
    Telas.producao.abrir(o.id); const k2 = await espera(janela);
    conf(!botao('Entregue', k2), 'produção não vê "Entregue"');
  });

  // ================================================================ ALMOXARIFE
  await passo('perfil almoxarife', async () => {
    await como('almox');
    await ir('#/financeiro'); conf(document.getElementById('view').textContent.includes('Sem acesso'), 'almoxarife sem financeiro');
    await ir('#/equipe'); conf(!document.getElementById('view').textContent.includes('Folha'), 'almoxarife não vê folha/salários');
    const ped = S.lista('pedidos_compra').find(p => p.status === 'aguardando');
    await ir('#/pedido/' + ped.id); await clicar('Receber', document.getElementById('view'));
    const j = await espera(janela);
    conf(!j.querySelector('[name=lancar]') && j.textContent.includes('escritório'), 'ao receber, almoxarife não lança conta (avisa que é o escritório)');
  });

  // ================================================================ ESCRITÓRIO
  await passo('perfil escritório', async () => {
    await como('escritorio');
    await ir('#/admin'); const t = document.getElementById('view').textContent;
    conf(!t.includes('Novo acesso') && !t.includes('Importar planilha') && t.includes('Empresa'), 'escritório: sem acessos/importação, com empresa', t.slice(0, 120));
    await ir('#/financeiro'); conf(!document.getElementById('view').textContent.includes('Sem acesso'), 'escritório vê financeiro');
  });

  await passo('senha provisória', async () => {
    // "zeca" foi criado pelo Dono no passo de acessos: a senha dele é provisória
    await API.sair(); await API.entrar('zeca', 'teste1234'); App.gravarPref('boasVindas', true); await App.entrarNoSistema(); await dorme(300);
    const f = document.querySelector('#fSenha');
    conf(!!f && !document.querySelector('.casca'), 'senha provisória: pede a nova senha antes de entrar');
    digitar(f.querySelector('[name=senha]'), '12345678'); digitar(f.querySelector('[name=senha2]'), '12345678');
    f.requestSubmit(); await dorme(400);
    conf(/fácil de adivinhar/.test(f.querySelector('.login-erro').textContent), 'recusa senha fácil');
    digitar(f.querySelector('[name=senha]'), 'zeca-forte-77'); digitar(f.querySelector('[name=senha2]'), 'zeca-forte-77');
    f.requestSubmit();
    await espera(() => document.querySelector('.casca'), 6000);
    conf(!!document.querySelector('.casca'), 'depois de criar a senha, entra no sistema');
    await API.sair();
    let entrou = true; try { await API.entrar('zeca', 'teste1234'); } catch (e) { entrou = false; }
    conf(!entrou, 'a senha provisória deixa de valer');
    await API.entrar('zeca', 'zeca-forte-77');
    conf(API.sessao.trocar_senha === false, 'a nova senha vale e não pede de novo');
  });
  await como('dono');
  await passo('sair e entrar não duplica botões', async () => {
    // depois de vários logins nesta mesma página, um toque continua abrindo UMA janela
    (document.querySelector('.aba-central') || document.querySelector('.lateral [data-acao="retirar"]')).click();
    await dorme(300);
    conf(document.querySelectorAll('.janela-fundo').length === 1, '1 toque = 1 janela, mesmo depois de trocar de usuário', document.querySelectorAll('.janela-fundo').length);
  });
  await passo('toque duplo atravessando a janela', async () => {
    const p = S.lista('pecas').slice().sort((a, b) => b.estoque - a.estoque)[0];
    for (const intervalo of [0, 120, 300]) {
      const antes = est(p.codigo);
      Telas.movimentos.retirar(p); await dorme(400);
      const b = [...document.querySelectorAll('.janela-pe .btn.pri')].at(-1); const r = b.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const toque = () => document.elementFromPoint(x, y).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      toque(); await dorme(intervalo); toque(); await dorme(1200);
      conf(est(p.codigo) === antes - 1, `dois toques com ${intervalo} ms de intervalo tiram 1 só`, [antes, est(p.codigo)]);
      conf(document.querySelectorAll('.janela-fundo').length === 0, `o 2º toque (${intervalo} ms) não abre outra janela`);
      UI.fecharTodas(); await dorme(500);
    }
  });
  R.fim = true;
  console.log(`${R.ok} OK, ${R.falhas.length} falha(s)`, R.falhas);
  return R;
};
