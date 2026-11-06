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
    await ir('#/rh'); await clicar('Nova pessoa', document.getElementById('view'));
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


  // ================================================================ RH (como Dono)
  const cpfOk = (base) => { const d = String(base).padStart(9, '0').split('').map(Number); for (const n of [9, 10]) { let s = 0; for (let i = 0; i < n; i++) s += d[i] * (n + 1 - i); d.push((s * 10) % 11 % 10) } return d.join('') };
  const pessoa = (nome) => S.lista('funcionarios').find(x => x.nome === nome);
  await passo('RH: cadastro, CPF e ficha', async () => {
    await ir('#/rh'); await clicar('Nova pessoa', document.getElementById('view'));
    let j = await espera(janela);
    digitar(j.querySelector('[name=nome]'), 'Rita Nova'); digitar(j.querySelector('[name=admissao]'), U.somaDias(U.hoje(), -10)); digitar(j.querySelector('[name=salario]'), '2.300,00');
    await clicar(j.querySelector('[data-parte-btn=documentos]'));
    digitar(j.querySelector('[name=cpf]'), '111.444.777-00');
    await okJanela('Cadastrar');
    conf(/CPF inválido/.test(erroJanela(j) || ''), 'CPF errado é recusado', erroJanela(j));
    const cpf = cpfOk(987654321);
    digitar(j.querySelector('[name=cpf]'), cpf);
    await clicar(j.querySelector('[data-parte-btn=trabalho]'));
    conf(j.querySelector('[name=nome]').value === 'Rita Nova', 'trocar de parte do cadastro não apaga o que foi digitado');
    await okJanela('Cadastrar');
    const f = pessoa('Rita Nova');
    conf(!!f && S.get('funcionarios_privado', f.id)?.salario === 2300, 'pessoa cadastrada com salário', erroJanela(j));
    conf(location.hash.includes('#/funcionario/' + f?.id), 'depois de cadastrar abre a ficha', location.hash);
    conf(S.lista('rh_historico').some(h => h.funcionario_id === f?.id && h.motivo === 'Admissão'), 'admissão abre a linha do tempo');
    conf(!!document.querySelector('#view .tag') && document.getElementById('view').textContent.includes('Experiência até'), 'ficha mostra a experiência (30 + 30)');
    Telas.rh.formPessoa(); j = await espera(janela);
    digitar(j.querySelector('[name=nome]'), 'Rita Repetida'); digitar(j.querySelector('[name=admissao]'), U.hoje());
    await clicar(j.querySelector('[data-parte-btn=documentos]')); digitar(j.querySelector('[name=cpf]'), cpf);
    await okJanela('Cadastrar');
    conf(/Já existe um funcionário com o CPF/.test(erroJanela(j) || ''), 'CPF repetido é recusado', erroJanela(j));
  });

  await passo('RH: alterar cargo e salário', async () => {
    const f = pessoa('Rita Nova');
    await ir('#/funcionario/' + f.id); await clicar('Alterar cargo ou salário', document.getElementById('view'));
    const j = await espera(janela);
    j.querySelector('[name=motivo][value="Dissídio"]').click();
    digitar(j.querySelector('[name=salario]'), '2.500');
    await okJanela('Registrar');
    conf(S.get('funcionarios_privado', f.id)?.salario === 2500, 'salário novo (2.500 = dois mil e quinhentos)', [erroJanela(j), S.get('funcionarios_privado', f.id)?.salario]);
    await ir('#/funcionario/' + f.id + '?aba=cargo');
    conf(document.querySelectorAll('.linha-tempo li').length === 2 && document.getElementById('view').textContent.includes('Dissídio'), 'linha do tempo com a admissão e o dissídio');
  });

  await passo('RH: programar férias e aviso', async () => {
    const f = pessoa('Beto Silva');
    const antes = S.lista('rh_ausencias').filter(a => a.funcionario_id === f.id && a.tipo === 'ferias').length;
    Telas.rh.programarFerias(f); const j = await espera(janela);
    conf(j.querySelector('[name=aquisitivo_inicio]').options.length >= 1, 'mostra o período aquisitivo com saldo');
    digitar(j.querySelector('[name=inicio]'), U.somaDias(U.hoje(), 35)); digitar(j.querySelector('[name=dias]'), '20');
    conf(/volta ao trabalho/.test(j.textContent), 'mostra a data de volta');
    await okJanela('Programar');
    conf(S.lista('rh_ausencias').filter(a => a.funcionario_id === f.id && a.tipo === 'ferias').length === antes + 1, 'férias gravadas', erroJanela(j));
    const ps = C.periodosFerias(f); conf(ps.some(p => p.saldo === 10), 'saldo do período baixou para 10 dias', ps.map(p => p.saldo));
    Telas.rh.programarFerias(f); const k = await espera(janela);
    digitar(k.querySelector('[name=inicio]'), U.somaDias(U.hoje(), 36)); digitar(k.querySelector('[name=dias]'), '10');
    await okJanela('Programar');
    conf(/Já existe férias/.test(erroJanela(k) || ''), 'não deixa férias em cima de férias', erroJanela(k));
  });

  await passo('RH: ponto, horas extras e fechamento', async () => {
    const f = pessoa('Gil Prado'), m = U.somaMeses(U.hoje(), -1).slice(0, 7); // mês passado: no dia 1º o mês atual pode ainda não ter dia útil
    await ir(`#/rh/ponto?f=${f.id}&m=${m}`); await espera(() => document.querySelector('#gradePonto'));
    await clicar('Preencher horário padrão', document.getElementById('view'));
    const uteis = [...document.querySelectorAll('.ponto-dia.sujo')].length;
    conf(uteis > 0, 'preencheu os dias úteis', uteis);
    const dia = [...document.querySelectorAll('.ponto-dia.sujo')].map(x => x.dataset.dia).filter(d => { const w = new Date(d + 'T12:00').getDay(); return w >= 1 && w <= 4 }).at(-1);
    digitar(document.querySelector(`[data-dia="${dia}"] [data-campo=s2]`), '19:00');
    await dorme(60);
    conf(document.querySelector(`[data-dia="${dia}"] .pd-x`).textContent.startsWith('2h'), 'mostra 2 h de extra na hora', document.querySelector(`[data-dia="${dia}"] .pd-x`).textContent);
    await clicar(document.querySelector('[data-ponto=salvar]'));
    await espera(() => S.lista('rh_ponto').filter(p => p.funcionario_id === f.id && p.data.startsWith(m)).length >= uteis, 6000);
    conf(S.lista('rh_ponto').filter(p => p.funcionario_id === f.id && p.data.startsWith(m)).length >= uteis, 'ponto gravado');
    const p = S.lista('rh_ponto').find(x => x.funcionario_id === f.id && x.data === dia);
    conf(p && String(p.s2).startsWith('19:00'), 'horário editado foi gravado', p);
    conf(![...document.querySelectorAll(`[data-dia]`)].some(x => x.querySelector('[data-campo=e1]') && x.classList.contains('ausencia') && x.querySelector('[data-campo=e1]').value), 'dia de atestado não foi preenchido');
    // dia de saída antes da entrada é recusado
    const d2 = [...document.querySelectorAll('.ponto-dia.trabalho')].find(x => x.dataset.dia !== dia && x.dataset.dia <= U.hoje())?.dataset.dia;
    digitar(document.querySelector(`[data-dia="${d2}"] [data-campo=e1]`), '12:00'); digitar(document.querySelector(`[data-dia="${d2}"] [data-campo=s1]`), '08:00');
    await clicar(document.querySelector('[data-ponto=salvar]')); await dorme(500);
    conf(/fora de ordem/.test(aviso()?.textContent || ''), 'horário fora de ordem é recusado', aviso()?.textContent);
    await ir(`#/rh/ponto?m=${m}`); await dorme(100);
    await ir(`#/rh/ponto?f=${f.id}&m=${m}`); await dorme(150);
    await clicar('Fechar o mês', document.getElementById('view')); await confirmar(true);
    await espera(() => S.lista('rh_ponto_meses').some(x => x.funcionario_id === f.id), 4000); await dorme(200);
    conf(S.lista('rh_ponto_meses').some(x => x.funcionario_id === f.id), 'mês fechado');
    conf(document.querySelector('[data-dia] [data-campo=e1]')?.disabled === true, 'mês fechado: não dá para editar');
    await ir(`#/rh/ponto?m=${m}`); await dorme(150);
    conf(document.querySelectorAll('#tPonto tbody tr').length >= 10 && !!document.querySelector('[data-ponto=exportar]'), 'fechamento de todos com exportação para a contabilidade');
  });

  await passo('RH: falta, atestado e afastamento', async () => {
    const f = pessoa('Rita Nova');
    Telas.rh.formAusencia(f); const j = await espera(janela);
    j.querySelector('[name=tipo][value=falta]').click(); await dorme(60);
    conf(j.querySelector('[name=abona]').checked === false, 'falta: já vem como "desconta"');
    conf(!j.querySelector('[name=cid]'), 'falta não pede CID');
    j.querySelector('[name=tipo][value=atestado]').click(); await dorme(60);
    conf(!!j.querySelector('[name=cid]') && j.querySelector('[name=abona]').checked, 'atestado: pede CID e abona');
    digitar(j.querySelector('#ausIni'), U.somaDias(U.hoje(), -2)); digitar(j.querySelector('#ausFim'), U.somaDias(U.hoje(), -1)); digitar(j.querySelector('[name=cid]'), 'j11');
    await okJanela('Lançar');
    const a = S.lista('rh_ausencias').find(x => x.funcionario_id === f.id && x.tipo === 'atestado');
    conf(a && a.cid === 'J11' && a.abona, 'atestado gravado (CID em maiúsculas)', [erroJanela(j), a]);
    Telas.rh.formAusencia(f); const k = await espera(janela);
    k.querySelector('[name=tipo][value=licenca]').click(); await dorme(60);
    digitar(k.querySelector('[name=motivo]'), 'Casamento (gala)'); await dorme(60);
    conf(k.querySelector('#ausFim').value === U.somaDias(k.querySelector('#ausIni').value, 2), 'licença casamento preenche 3 dias', k.querySelector('#ausFim').value);
  });

  await passo('RH: exame, EPI e advertência', async () => {
    const f = pessoa('Rita Nova');
    const na = S.lista('rh_asos').length, ne = S.lista('rh_epis').length;
    Telas.rh.formAso(f); let j = await espera(janela);
    j.querySelector('[name=tipo][value=Admissional]').click();
    await okJanela('Salvar');
    conf(S.lista('rh_asos').length === na + 1, 'ASO gravado', erroJanela(j));
    Telas.rh.formEpi(f); j = await espera(janela);
    // um digitado ("Outro") e um escolhido do cadastro de EPI
    digitar(j.querySelector('[data-item-epi="0"] [data-campo=cat]'), 'outro'); await dorme(60);
    digitar(j.querySelector('[data-item-epi="0"] [aria-label="Nome do EPI"]'), 'Luva nitrílica'); digitar(j.querySelector('[data-item-epi="0"] [aria-label=CA]'), '12345');
    digitar(j.querySelector('[data-item-epi="0"] [aria-label="Trocar a cada (meses)"]'), '3');
    await clicar(j.querySelector('[data-seg=addEpi]'));
    const sel2 = j.querySelector('[data-item-epi="1"] [data-campo=cat]'); digitar(sel2, sel2.options[1].value);
    await okJanela('Registrar entrega');
    conf(S.lista('rh_epis').length === ne + 2, 'dois EPI de uma vez', erroJanela(j));
    Telas.rh.formOcorrencia(f); j = await espera(janela);
    j.querySelector('[name=tipo][value=suspensao]').click(); await dorme(60);
    digitar(j.querySelector('[name=dias]'), '2'); digitar(j.querySelector('#ocIni'), U.somaDias(U.hoje(), 5)); digitar(j.querySelector('#ocDesc'), 'Teste de suspensão');
    digitar(j.querySelector('[name=status]'), 'recusado'); await dorme(60);
    await okJanela('Salvar');
    conf(/2 testemunhas|Testemunha 1/.test(erroJanela(j) || ''), 'recusou assinar sem testemunhas é recusado', erroJanela(j));
    digitar(j.querySelector('[name=testemunha1]'), 'Ana'); digitar(j.querySelector('[name=testemunha2]'), 'Bia');
    await okJanela('Salvar');
    const o = S.lista('rh_ocorrencias').find(x => x.funcionario_id === f.id);
    conf(o && o.tipo === 'suspensao' && o.recusou, 'suspensão gravada', erroJanela(j));
    conf(S.lista('rh_ausencias').some(a => a.ocorrencia_id === o?.id && a.tipo === 'suspensao' && !a.abona), 'suspensão trava os dias no ponto (sem pagamento)');
  });

  await passo('RH: matriz de treinamento', async () => {
    await ir('#/rh/treinamentos?aba=matrizes'); await dorme(150);
    const cel = document.querySelector('button.nivel[data-cel]');
    const [fid, item] = cel.dataset.cel.split('|');
    cel.click(); const j = await espera(janela);
    const ops = j.querySelectorAll('[name=nivel]'); ops[0].click();
    await okJanela('Salvar');
    const n = S.lista('rh_matriz_niveis').find(x => x.funcionario_id === fid && x.item_id === item);
    conf(n && n.nivel === Number(ops[0].value), 'nível gravado pelo quadradinho', [erroJanela(j), n?.nivel]);
  });

  await passo('RH: todas as telas abrem', async () => {
    const f = pessoa('Beto Silva');
    const rotas = ['#/rh', '#/rh?f=experiencia', '#/rh?f=fora', '#/rh?f=desligados', '#/rh/ponto', '#/rh/ferias', '#/rh/ferias?aba=ausencias', '#/rh/ferias?aba=fora', '#/rh/treinamentos?aba=plano',
      '#/rh/treinamentos?aba=reciclagem', '#/rh/treinamentos?aba=metas', '#/rh/seguranca', '#/rh/seguranca?f=epi', '#/rh/disciplina', '#/rh/processos', '#/rh/organograma', '#/rh/relatorios', '#/rh/ajustes?aba=cargos',
      '#/rh/ajustes?aba=setores', '#/rh/ajustes?aba=feriados', '#/rh/ajustes?aba=jornada', ...['resumo', 'dados', 'cargo', 'ferias', 'ponto', 'treinos', 'seguranca', 'disciplina', 'documentos'].map(a => `#/funcionario/${f.id}?aba=${a}`)]
    for (const r of rotas) { await ir(r); await dorme(60); const v = document.getElementById('view').textContent; conf(!/Algo deu errado|Sem acesso|não encontrad/.test(v), 'abre ' + r, v.slice(0, 80)) }
    for (const r of ['quadro', 'turnover', 'absenteismo', 'he', 'custo']) { await ir('#/rh/relatorios'); document.querySelector(`[data-rr="${r}"]`)?.click(); await dorme(80); conf(!!document.querySelector('#tRelRh tbody tr'), 'relatório do RH ' + r) }
  });

  await passo('Início personalizável', async () => {
    await ir('#/inicio'); await clicar(document.querySelector('[data-acao=personalizar]'));
    const j = await espera(janela);
    j.querySelector('[data-perso=clientes] input').click(); await dorme(40);
    j.querySelector('[data-perso=numeros] input').click(); await dorme(40);
    await okJanela('Salvar'); await dorme(200);
    conf(!!document.querySelector('[data-atalho=clientes]') && !document.querySelector('[data-bloco=numeros]'), 'pôs Clientes e tirou os números do mês', erroJanela(j));
    conf(!document.querySelector('[data-atalho=chamado]'), 'o padrão do Dono não tem "Máquina com problema"');
    await clicar(document.querySelector('[data-acao=personalizar]')); const k = await espera(janela);
    await okJanela('Voltar ao padrão'); await dorme(200);
    conf(!document.querySelector('[data-atalho=clientes]') && !!document.querySelector('[data-bloco=numeros]') && !!document.querySelector('[data-atalho=fornecedores]'), 'voltar ao padrão (com Fornecedores)', erroJanela(k));
  });

  await passo('ajuda pesquisável e busca do topo', async () => {
    await ir('#/ajuda?q=f%C3%A9rias'); await dorme(150);
    const a = document.querySelector('.artigo');
    conf(a && a.open && /férias/i.test(a.querySelector('summary').textContent), 'pesquisar "férias" mostra o artigo de férias aberto', a?.querySelector('summary').textContent);
    await ir('#/ajuda?q=rh'); await dorme(100);
    conf(document.querySelectorAll('.artigo').length >= 5, 'pesquisar "rh" acha tudo do RH', document.querySelectorAll('.artigo').length);
    const b = document.querySelector('[data-mostrar]'); b?.click(); await dorme(900);
    conf(!!document.querySelector('.tour-balao'), '"Me mostre na tela" destaca o botão');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await dorme(80);
    conf(!document.querySelector('.tour-balao'), 'Esc fecha a demonstração');
    const inp = document.getElementById('buscaGeral'); inp.focus(); digitar(inp, 'ferias'); await dorme(120);
    conf(!!document.querySelector('.busca-res a[data-tipo=tela]'), 'lupa do topo acha a tela de férias');
    digitar(inp, 'beto'); await dorme(120);
    conf(!!document.querySelector('.busca-res a[data-tipo=pessoa]'), 'lupa do topo acha pessoa');
    digitar(inp, '');
  });

  // ================================================================ SAÍDA POR INATIVIDADE
  await passo('saída por inatividade', async () => {
    await como('helena');
    localStorage.setItem('jaf.uso', JSON.stringify(Date.now() - 59 * 60000));
    document.dispatchEvent(new Event('visibilitychange')); await dorme(300);
    conf(!!document.querySelector('.casca'), 'com 59 min parado, o RH continua dentro');
    localStorage.setItem('jaf.uso', JSON.stringify(Date.now() - 61 * 60000));
    document.dispatchEvent(new Event('visibilitychange')); await espera(() => document.querySelector('#fLogin'));
    conf(!API.sessao && document.body.textContent.includes('saiu sozinho'), 'com 61 min parado, o RH sai e o login explica o motivo');
    await como('almox');
    localStorage.setItem('jaf.uso', JSON.stringify(Date.now() - 61 * 60000));
    document.dispatchEvent(new Event('visibilitychange')); await dorme(300);
    conf(!!document.querySelector('.casca'), 'no almoxarifado o limite é maior (aparelho do dia a dia)');
    localStorage.setItem('jaf.uso', JSON.stringify(Date.now()));
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
    const menuA = [...document.querySelectorAll('.lateral-menu a span')].map(a => a.textContent.trim());
    conf(menuA.includes('Peças') && menuA.includes('O que comprar') && !menuA.includes('Ordens de produção') && !menuA.includes('Fábrica'), 'almoxarife: telas do almoxarifado e compras direto no menu, sem PCP', menuA);
    await ir('#/maquinas'); conf(!document.getElementById('view').textContent.includes('Sem acesso') && !document.querySelector('.subabas') && !!document.querySelector('.lateral-menu a.on[data-rota=maquinas]'), 'máquinas marcada no menu, sem abas em cima');
    const ped = S.lista('pedidos_compra').find(p => p.status === 'aguardando');
    await ir('#/pedido/' + ped.id); await clicar('Receber', document.getElementById('view'));
    const j = await espera(janela);
    conf(!j.querySelector('[name=lancar]') && j.textContent.includes('escritório'), 'ao receber, almoxarife não lança conta (avisa que é o escritório)');
  });

  // ================================================================ PCP (ordens de produção)
  await passo('perfil PCP', async () => {
    await como('pcp');
    const menu = [...document.querySelectorAll('.lateral-menu a span')].map(a => a.textContent.trim());
    conf(menu.join('|') === 'Início|Ordens de fabricação|Matéria-prima|Pedidos de clientes|Necessidade|Serviço externo|Requisições|Equipe|Clientes|Produtos|Peças|Ajuda', 'menu do PCP: as telas dele direto, OFs primeiro, pedidos de clientes no PCP', menu);
    conf(!document.querySelector('.lateral [data-acao=retirar]') && !!document.querySelector('.lateral [data-acao=novaOF]'), 'PCP tem "Nova OF" e não "Retirar peça"');
    conf(S.lista('movimentos').length === 0 && S.lista('lancamentos').length === 0 && S.lista('clientes').length > 0, 'banco manda ordens e clientes, sem movimentações nem financeiro');
    for (const r of ['#/maquinas', '#/movimentos', '#/compras', '#/financeiro', '#/rh']) { await ir(r); conf(document.getElementById('view').textContent.includes('Sem acesso'), 'PCP sem ' + r); }
    await ir('#/pecas'); conf(!document.getElementById('view').textContent.includes('Sem acesso') && !botao('Nova peça', document.getElementById('view')), 'PCP consulta as peças sem editar');
    await ir('#/producao'); await clicar('Nova ordem', document.getElementById('view'));
    const j = await espera(janela);
    conf(!!j.querySelector('#oCli'), 'PCP escolhe o cliente da lista');
    digitar(j.querySelector('[name=produto]'), 'Peça do PCP'); digitar(j.querySelector('[name=qtd]'), '5');
    await okJanela('Criar ordem');
    const o = S.lista('ordens').find(x => x.produto === 'Peça do PCP');
    conf(o && o.status === 'fila', 'PCP cria ordem', erroJanela(j));
    Telas.producao.abrir(o.id); const k = await espera(janela);
    conf(!!botao('Começar a produzir', k), 'PCP mexe na ordem');
    UI.fecharTodas();
  });

  // ================================================================ FÁBRICA (v2.5: planilhas PCP, Controle de Pedidos, Depto. Técnico, Manutenção)
  await passo('PCP emite e aponta OF', async () => {
    await como('pcp');
    await clicar(document.querySelector('.lateral [data-acao="novaOF"]') || document.querySelector('.aba-central[data-acao="novaOF"]'));
    const j = await espera(janela);
    await espera(() => S.lista('produtos').length);
    await combo(j.querySelector('#ofProd'), 'CF 02.0001');
    digitar(j.querySelector('[name=qtd]'), '100');
    await espera(() => j.querySelector('[name=ri]'));
    conf(!!j.querySelector('#lRI option[value="1001"]'), 'sugere os R.I. com saldo do material da peça');
    digitar(j.querySelector('[name=ri]'), '1001');
    await okJanela('Emitir OF');
    const o = await espera(() => S.lista('ofs').find(x => x.qtd === 100 && x.ri === 1001 && x.status === 'aberta'));
    conf(!!o && Number(o.kg) === 1.2, 'OF emitida com o material calculado (100 × 0,012 kg)', o && { kg: o.kg, erro: erroJanela(j) });
    conf(location.hash === '#/of/' + o?.id, 'abre a ficha da OF emitida', location.hash);
    await clicar('Apontar / encerrar', document.getElementById('view'));
    const k = await espera(janela);
    digitar(k.querySelector('[name=produzido]'), '98');
    await okJanela('Encerrar OF');
    const o2 = S.get('ofs', o.id);
    conf(o2.status === 'encerrada' && Number(o2.produzido) === 98 && o2.realizado_por, 'OF encerrada com o produzido e quem fez', o2 && { st: o2.status, p: o2.produzido });
    await ir('#/mp'); await espera(() => document.querySelector('[data-ri-sem-entrada]'));
    conf(!!document.querySelector('[data-ri-sem-entrada]'), 'avisa os R.I. usados em OF sem entrada lançada');
    await ir('#/necessidade'); await espera(() => document.querySelector('#tNecP'));
    conf(!!document.querySelector('#tNecP tbody tr'), 'necessidade explode os pedidos em peças');
  });
  await passo('pedido de cliente: entrega e situação', async () => {
    await ir('#/pedidos'); await espera(() => document.querySelector('#lVen [data-venda]'));
    const v = S.lista('vendas').find(x => x.pedido === 'PC 019/26');
    conf(C.situacaoVenda(S.lista('vendas').find(x => x.pedido === 'PC 018/26')).cod === 'atraso', 'pedido vencido aparece como Atraso (regra da planilha)');
    Telas.fabrica.entregar(v); const j = await espera(janela);
    digitar(j.querySelector('[name=qtd]'), '30'); digitar(j.querySelector('[name=nf]'), '7002');
    await okJanela('Registrar');
    await espera(() => Number(S.get('vendas', v.id).entregue) === 30);
    conf(C.situacaoVenda(S.get('vendas', v.id)).cod === 'ok', 'entregue tudo: situação Ok', S.get('vendas', v.id).entregue);
  });
  await passo('produção: OFs sem preço, pede alteração', async () => {
    await como('operador');
    const menu = [...document.querySelectorAll('.lateral-menu a span')].map(a => a.textContent.trim());
    conf(menu.includes('Ordens de fabricação') && menu.includes('Ordens de serviço') && !menu.includes('Pedidos de clientes') && !menu.includes('Desvios'), 'produção: OFs e OS no menu, sem pedidos de clientes nem engenharia', menu);
    await ir('#/pedidos'); conf(document.getElementById('view').textContent.includes('Sem acesso'), 'produção não abre pedidos de clientes');
    await ir('#/inicio'); await clicar(document.querySelector('[data-atalho=solicitarAlteracao]'));
    const j = await espera(janela);
    digitar(j.querySelector('[name=titulo]'), 'Chanfrar a borda do pino'); digitar(j.querySelector('[name=d__setor]'), 'Tornos');
    await okJanela('Lançar');
    conf(!document.body.contains(j), 'produção pede alteração pelo Início', erroJanela(j));
  });
  await passo('técnico: vê a alteração e lança desvio', async () => {
    await como('tecnico');
    const menu = [...document.querySelectorAll('.lateral-menu a span')].map(a => a.textContent.trim());
    conf(menu[1] === 'Produtos' && menu.includes('Desvios') && !menu.includes('Contas a pagar e receber'), 'técnico: engenharia primeiro no menu', menu);
    await ir('#/reg/alteracao'); await espera(() => document.querySelector('#lReg [data-reg]'));
    conf(document.getElementById('view').textContent.includes('Chanfrar a borda do pino'), 'técnico vê o pedido de alteração da produção');
    await ir('#/reg/desvio'); await clicar('Novo', document.getElementById('view'));
    const j = await espera(janela);
    digitar(j.querySelector('[name=codigo]'), 'CF 02.0002'); digitar(j.querySelector('[name=titulo]'), 'Chapa com espessura no limite');
    await okJanela('Lançar');
    const r = await espera(() => S.lista('registros').find(x => x.tipo === 'desvio' && x.titulo === 'Chapa com espessura no limite'));
    conf(r && r.numero === 2, 'desvio lançado com o próximo número', r?.numero);
    await ir('#/produto/' + S.lista('produtos').find(x => x.codigo === 'UP 01.0002').id);
    conf(document.getElementById('view').textContent.includes('Estrutura (componentes)'), 'ficha do produto mostra a estrutura');
  });
  await passo('manutenção: OS e check-list', async () => {
    await como('manut');
    await clicar(document.querySelector('.aba-central[data-acao=novaOS]') || document.querySelector('.lateral [data-acao=retirar]') && (Telas.maquinas.formManutencao({ tipo: 'corretiva' }), document.body));
    const j = await espera(janela);
    await combo(j.querySelector('#mMaq'), 'TA 25');
    digitar(j.querySelector('[name=problema]'), 'Vazamento de óleo no cabeçote');
    await okJanela('Abrir chamado');
    const os = await espera(() => S.lista('manutencoes').find(m => m.problema === 'Vazamento de óleo no cabeçote'));
    conf(os && os.numero > 0 && os.solicitante, 'OS aberta com número e solicitante', os && { n: os.numero, s: os.solicitante, erro: erroJanela(j) });
    await ir('#/preventiva'); await espera(() => document.querySelector('#tPlano'));
    const m = S.lista('maquinas').find(x => x.codigo === 'TA 25');
    Telas.fabrica.preencher(m); const k = await espera(janela);
    conf(k.querySelectorAll('.check-item').length === 5, 'check-list com os itens da máquina', k.querySelectorAll('.check-item').length);
    for (const inp of k.querySelectorAll('.check-item input')) digitar(inp, 'Ok');
    await okJanela('Registrar preventiva');
    conf(C.ultimaPreventiva(m.id) === U.hoje(), 'preventiva de hoje registrada', C.ultimaPreventiva(m.id));
  });

  // ================================================================ ESCRITÓRIO
  await passo('perfil escritório', async () => {
    await como('escritorio');
    const mEsc = [...document.querySelectorAll('.lateral-menu a span')].map(a => a.textContent.trim());
    conf(mEsc.includes('RH') && mEsc.includes('Almoxarifado') && !mEsc.includes('Pessoas'), 'escritório: menu por áreas', mEsc);
    conf([...document.querySelectorAll('.lateral-menu .grupo')].map(g => g.textContent).join('|') === 'Operação|Gestão|Sistema', 'áreas agrupadas em Operação, Gestão e Sistema');
    await ir('#/rh/ponto'); conf(!!document.querySelector('.subabas') && !!document.querySelector('.lateral-menu a.on[data-area=rh]'), 'escritório: dentro do RH, abas em cima');
    await ir('#/admin'); const t = document.getElementById('view').textContent;
    conf(!t.includes('Novo acesso') && !t.includes('Importar planilha') && t.includes('Empresa'), 'escritório: sem acessos/importação, com empresa', t.slice(0, 120));
    await ir('#/financeiro'); conf(!document.getElementById('view').textContent.includes('Sem acesso'), 'escritório vê financeiro');
  });

  await passo('nota fiscal pelo XML', async () => {
    await como('escritorio');
    // nota inventada (CNPJ e chave fictícios, dígito da chave calculado)
    const base = '35' + '2611' + '11222333000181' + '55' + '001' + '000012345' + '1' + '12345678';
    let soma = 0, peso = 2; for (let i = base.length - 1; i >= 0; i--) { soma += Number(base[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
    const chave = base + ((soma % 11) < 2 ? 0 : 11 - (soma % 11));
    const peca = S.lista('pecas').find(x => x.codigo === 'A34-EX'), antes = peca.estoque;
    // (a lista de produtos só carrega quando a nota abre: comparar pelo código, não por um objeto pego antes)
    const item = (n, cod, desc, un, q, vu, extra = '') => `<det nItem="${n}"><prod><cProd>${cod}</cProd><cEAN>SEM GTIN</cEAN><xProd>${desc}</xProd><NCM>73181500</NCM><CFOP>5102</CFOP><uCom>${un}</uCom><qCom>${q}</qCom><vUnCom>${vu}</vUnCom><vProd>${(q * vu).toFixed(2)}</vProd>${extra}</prod><imposto><IPI><IPITrib><vIPI>${n === 1 ? '5.00' : '0.00'}</vIPI></IPITrib></IPI></imposto></det>`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${chave}" versao="4.00">
      <ide><natOp>VENDA</natOp><mod>55</mod><serie>1</serie><nNF>12345</nNF><dhEmi>${U.hoje()}T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>11222333000181</CNPJ><xNome>DISTRIBUIDORA TESTE DE ACOS LTDA</xNome><xFant>DISTRIBUIDORA TESTE</xFant><enderEmit><xLgr>RUA DAS FLORES</xLgr><nro>100</nro><xBairro>CENTRO</xBairro><xMun>SAO PAULO</xMun><UF>SP</UF><CEP>01001000</CEP><fone>1133334444</fone></enderEmit><IE>111222333444</IE></emit>
      ${item(1, 'ROL-9', 'ROLAMENTO TESTE', 'PC', 2, 50)}${item(2, 'BAR-1', 'BARRA TREFILADA TESTE', 'KG', 120, 8.5, '<xPed>PC-9</xPed>')}${item(3, 'SV', 'SERVICO DE CORTE', 'UN', 1, 30)}
      <total><ICMSTot><vProd>1150.00</vProd><vFrete>0</vFrete><vIPI>5.00</vIPI><vDesc>0</vDesc><vNF>1155.00</vNF></ICMSTot></total>
      <cobr><dup><nDup>001</nDup><dVenc>${U.somaDias(U.hoje(), 28)}</dVenc><vDup>577.50</vDup></dup><dup><nDup>002</nDup><dVenc>${U.somaDias(U.hoje(), 56)}</dVenc><vDup>577.50</vDup></dup></cobr>
      </infNFe></NFe><protNFe><infProt><chNFe>${chave}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
    const escolher = async () => {
      Telas.nota.lerNota(); const j = await espera(() => janela()?.querySelector('[data-nota=arquivo] input') && janela());
      const inp = j.querySelector('[data-nota=arquivo] input'), dt = new DataTransfer();
      dt.items.add(new File([xml], 'nota-teste.xml', { type: 'text/xml' })); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
      return espera(() => janela()?.querySelector('.form-nota') && janela(), 6000);
    };
    const j = await escolher();
    conf(!!j && j.textContent.includes('Distribuidora Teste de Acos Ltda') && j.querySelectorAll('.nf-item').length === 3, 'nota lida: fornecedor e 3 itens', j && j.textContent.slice(0, 160));
    const it = (n) => j.querySelector(`.nf-item[data-item="${n}"]`);
    conf(it(2).querySelector('input[value=mp]').checked, 'item em quilo já sugere matéria-prima');
    await combo(it(1).querySelector('#nfPc1'), 'A34-EX');
    conf(U.num(it(1).querySelector('[name=p_1]').value) === 52.5, 'custo da peça já com o IPI da nota', it(1).querySelector('[name=p_1]').value);
    await combo(it(2).querySelector('#nfMp2'), 'AE01.B01');
    conf(it(3).querySelector('input[value=ignorar]').checked, 'serviço da nota já vem como "Não lançar"');
    it(3).querySelector('input[value=ignorar]').click(); await dorme(60);
    conf(j.querySelector('[name=contas]').checked && j.querySelectorAll('.nf-contas .linha').length === 2, 'parcelas da nota prontas para o contas a pagar', { marcado: j.querySelector('[name=contas]')?.checked, linhas: j.querySelectorAll('.nf-contas .linha').length, ja: S.lista('lancamentos').filter(l => l.documento === 'NF 12345').map(l => l.descricao) });
    await okJanela('Lançar a nota');
    conf(!document.body.contains(j), 'nota lançada', erroJanela(j));
    conf(est('A34-EX') === antes + 2, 'peça entrou no estoque', est('A34-EX') - antes);
    const lote = await espera(() => S.lista('mp_lotes').find(l => l.nota === '12345' && S.get('produtos', l.produto_id)?.codigo === 'AE01.B01.ac'), 10000);
    conf(lote && Number(lote.qtd) === 120 && lote.pedido === 'PC-9', 'matéria-prima virou R.I. com pedido', lote ? { ri: lote.ri, q: lote.qtd, p: lote.pedido } : S.lista('mp_lotes').filter(l => l.nota === '12345').map(l => [l.ri, S.get('produtos', l.produto_id)?.codigo, l.qtd]));
    conf(S.lista('lancamentos').filter(l => l.documento === 'NF 12345' && (l.obs || '').includes('XML')).length === 2, 'duas parcelas no contas a pagar (a conta antiga de outro fornecedor com o mesmo nº não atrapalha)');
    const f = S.lista('fornecedores').find(x => (x.cnpj || '').replace(/\D/g, '') === '11222333000181');
    conf(f && f.uf === 'SP' && f.cidade === 'Sao Paulo', 'fornecedor novo cadastrado com os dados da nota', f && { n: f.nome, uf: f.uf, c: f.cidade });
    const j2 = await escolher();
    conf(!!j2 && j2.textContent.includes('já foi lançada') && !botao('Lançar a nota', j2), 'a mesma nota não entra de novo');
  });

  // ================================================================ v2.7: passo a passo da OF, necessidade do PCP, compra de matéria-prima (Comercial)
  await passo('passo a passo e quadradinhos da OF', async () => {
    await como('pcp');
    await S.garantir(['produtos', 'produto_estrutura', 'ofs']);
    const pr = S.lista('produtos').find(p => p.codigo === 'CF 02.0002');
    await ir('#/produto/' + pr.id); await espera(() => document.querySelector('#secProcesso'));
    conf(document.querySelector('#secProcesso').textContent.includes('Estampar e dobrar'), 'passo a passo montado sozinho pela operação da peça');
    await clicar(document.querySelector('[data-proc=editar]'));
    const j = await espera(() => janela()?.querySelector('.passo-ed') && janela());
    await clicar(j.querySelector('[data-add-passo]'));
    const linhas = j.querySelectorAll('.passo-ed');
    conf(document.activeElement === linhas[linhas.length - 1].querySelector('[name=op]'), 'passo novo já fica com o cursor');
    digitar(linhas[linhas.length - 1].querySelector('[name=op]'), 'Rebarbar');
    digitar(linhas[0].querySelector('[name=mq]'), S.lista('maquinas').find(m => m.ativo).id);
    await okJanela('Salvar passo a passo');
    const p2 = S.get('produtos', pr.id);
    conf(p2.processo?.length === 2 && p2.processo[1].operacao === 'Rebarbar' && !!p2.processo[0].maquina_id, 'passo a passo salvo com a máquina', p2.processo || erroJanela(j));
    await clicar(document.querySelector('.lateral [data-acao="novaOF"]') || document.querySelector('.aba-central[data-acao="novaOF"]'));
    const k = await espera(janela);
    await combo(k.querySelector('#ofProd'), 'CF 02.0002');
    digitar(k.querySelector('[name=qtd]'), '20');
    conf(!!await espera(() => k.querySelector('.previa-passos')), 'mostra o passo a passo antes de emitir a OF');
    await okJanela('Emitir OF');
    const o = await espera(() => S.lista('ofs').find(x => x.qtd === 20 && x.status === 'aberta' && S.get('produtos', x.produto_id)?.codigo === 'CF 02.0002'));
    conf(o?.passos?.length === 2 && o.passos[1].operacao === 'Rebarbar' && o.passos.every(x => !x.feito), 'OF nasce com os passos do produto', o?.passos || erroJanela(k));
    await como('operador');
    await ir('#/of/' + o.id); await espera(() => document.querySelector('[data-passo="1"]'));
    document.querySelector('[data-passo="1"]').click();
    const o2 = await espera(() => S.get('ofs', o.id).passos[0].feito && S.get('ofs', o.id), 6000);
    conf(o2 && o2.passos[0].feito_por === 'Beto (teste)' && !o2.passos[1].feito, 'produção marca o passo no aplicativo (com quem e quando)', o2?.passos);
    await espera(() => document.querySelector('#ofPassos li.feito'));
    conf(document.querySelector('#ofPassos').textContent.includes('1 de 2 feitos'), 'mostra quantos passos já foram feitos');
    conf(!document.querySelector('[data-of-acao=refazer]'), 'com passo marcado não dá para trocar o passo a passo');
  });
  await passo('PCP pede compra e o Comercial compra matéria-prima', async () => {
    await como('pcp');
    await ir('#/necessidade?aba=mp'); await espera(() => document.querySelector('#necPcp'));
    conf(!document.querySelector('#necBarra'), 'PCP não faz pedido de compra (só pede)');
    await clicar(document.querySelector('[data-n=lancar]'));
    const j = await espera(janela);
    await combo(j.querySelector('#nMat'), 'IA07');
    digitar(j.querySelector('[name=qtd]'), '25'); digitar(j.querySelector('[name=motivo]'), 'Teste do roteiro');
    await okJanela('Mandar para o Comercial');
    const nec = await espera(() => S.lista('necessidades').find(n => n.motivo === 'Teste do roteiro'));
    conf(nec && nec.status === 'aberta' && Number(nec.qtd) === 25, 'necessidade lançada pelo PCP', nec || erroJanela(j));

    await como('comercial');
    const menu = [...document.querySelectorAll('.lateral-menu a span')].map(a => a.textContent.trim());
    conf(menu.join('|') === 'Início|Pedidos de clientes|O que comprar|Pedidos de compra|Fornecedores|Estoque de material|Clientes|Ajuda', 'menu do Comercial', menu);
    for (const r of ['#/financeiro', '#/rh', '#/movimentos']) { await ir(r); conf(document.getElementById('view').textContent.includes('Sem acesso'), 'Comercial sem ' + r); }
    await ir('#/compras/lista'); conf(document.getElementById('view').textContent.includes('Sem acesso'), 'lista de peças do almoxarifado fica com o almoxarifado');
    conf(S.lista('lancamentos').length === 0 && S.lista('funcionarios_privado').length === 0, 'banco não manda financeiro nem dados pessoais para o Comercial');
    await ir('#/comprar'); await espera(() => document.querySelector(`[data-sel="n:${nec.id}"]`));
    conf(document.querySelector('.chips .on, [aria-pressed=true]')?.textContent.includes('Matéria-prima') !== false, 'Comercial abre direto na matéria-prima');
    document.querySelector(`[data-sel="n:${nec.id}"]`).click(); await dorme(80);
    const salvaAntes = window.showSaveFilePicker; window.showSaveFilePicker = undefined;
    try {
      await clicar(document.querySelector('[data-n=pedido]'));
      const f = await espera(() => janela()?.querySelector('#mpItens') && janela());
      conf(f.querySelector('[name=imat]').value.startsWith('IA07.B01.cg') && U.num(f.querySelector('[name=iqtd]').value) === 25, 'pedido já vem com o material e a quantidade pedida', f.querySelector('[name=imat]').value);
      if (!f.querySelector('[name=fornecedor_id]').dataset.comboId) await combo(f.querySelector('#mpForn'), 'Aço Exemplo');
      digitar(f.querySelector('[name=ipreco]'), '32,5');
      await clicar('Ver prévia', f.querySelector('.janela-pe'));
      const pv = await espera(() => janela() !== f && janela()?.querySelector('#mpPrevia') && janela());
      conf(!!pv && pv.textContent.includes('IA07.B01.cg') && pv.textContent.includes('812,50'), 'prévia mostra o material e o total antes de gerar', pv?.textContent.slice(0, 200));
      const nAntes = S.lista('pedidos_compra').length;
      await clicar('Voltar e corrigir', pv.querySelector('.janela-pe')); await dorme(150);
      conf(document.body.contains(f) && S.lista('pedidos_compra').length === nAntes, 'voltar da prévia não grava nada');
      await clicar('Ver prévia', f.querySelector('.janela-pe'));
      const pv2 = await espera(() => janela() !== f && janela()?.querySelector('#mpPrevia') && janela());
      await clicar('Gerar pedido e PDF', pv2.querySelector('.janela-pe'));
      const ped = await espera(() => S.lista('pedidos_compra').find(p => p.tipo === 'mp' && C.itensDoPedido(p.id).some(i => S.get('produtos', i.produto_id)?.codigo === 'IA07.B01.cg' && Number(i.qtd) === 25)), 8000);
      conf(!!ped && S.get('necessidades', nec.id)?.status === 'pedido', 'pedido de matéria-prima criado e a necessidade baixada', { ped: !!ped, nec: S.get('necessidades', nec.id)?.status });
      UI.fecharTodas();
      await ir('#/pedido/' + ped.id); await espera(() => document.querySelector('[data-p=receber]'));
      await clicar(document.querySelector('[data-p=receber]'));
      const r = await espera(janela);
      digitar(r.querySelector('.rec'), '10'); digitar(r.querySelector('[name=documento]'), 'NF 9090');
      await okJanela('Confirmar recebimento');
      const lote = await espera(() => S.lista('mp_lotes').find(l => l.nota === 'NF 9090'), 6000);
      conf(lote && Number(lote.qtd) === 10 && lote.pedido === String(ped.numero) && lote.status === 'Aguardando', 'receber cria o R.I. sozinho, com o nº do pedido', lote || erroJanela(r));
      conf(S.get('pedidos_compra', ped.id).status === 'aguardando' && C.pendenteMP(lote.produto_id) >= 15, 'chegou parte: o resto continua a caminho');
      conf(!!document.querySelector('#pLotes') && document.querySelector('#pLotes').textContent.includes('R.I. ' + lote.ri), 'ficha do pedido mostra o R.I. que entrou');
      const pPecas = S.lista('pedidos_compra').find(p => p.tipo === 'pecas' && p.status === 'aguardando');
      if (pPecas) { await ir('#/pedido/' + pPecas.id); await dorme(200); conf(!document.querySelector('[data-p=receber]') && !document.querySelector('[data-p=editar]'), 'Comercial não mexe em pedido de peças'); }
    } finally { window.showSaveFilePicker = salvaAntes; }
  });

  // ================================================================ RH (perfil próprio)
  await passo('perfil RH', async () => {
    await como('helena');
    const menu = [...document.querySelectorAll('.lateral-menu a span')].map(a => a.textContent.trim());
    conf(menu.join('|') === 'Início|Pessoas|Ponto|Férias|Treinamentos|EPI e exames|Advertências|Processos|Organograma|Relatórios|Indicadores|Ajustes|Ajuda', 'menu do RH: as abas do RH direto no menu da esquerda', menu);
    conf([...document.querySelectorAll('.lateral-menu .grupo')].map(g => g.textContent).join('|') === 'Dia a dia|Gestão|Sistema', 'menu do RH separado em Dia a dia, Gestão e Sistema');
    await ir('#/rh/ponto'); conf(!document.querySelector('.subabas') && !!document.querySelector('.lateral-menu a.on[data-rota="rh/ponto"]'), 'RH sem abas em cima; a tela aberta fica marcada no menu');
    await ir('#/inicio');
    conf(!document.querySelector('.lateral [data-acao=retirar]'), 'RH não tem "Retirar peça"');
    conf(S.lista('pecas').length === 0 && S.lista('lancamentos').length === 0 && S.lista('movimentos').length === 0, 'banco não manda estoque nem financeiro para o RH');
    await ir('#/pecas'); conf(document.getElementById('view').textContent.includes('Sem acesso'), 'estoque bloqueado para o RH');
    await ir('#/financeiro'); conf(document.getElementById('view').textContent.includes('Sem acesso'), 'financeiro bloqueado para o RH');
    conf(S.lista('funcionarios_privado').length > 0 && S.lista('rh_historico').length > 0, 'RH vê salários e documentos');
    const f = S.lista('funcionarios').find(x => x.nome === 'Beto Silva');
    await ir('#/funcionario/' + f.id + '?aba=dados'); conf(document.getElementById('view').textContent.includes('CPF'), 'RH abre os dados pessoais');
    conf(!!document.querySelector('[data-atalho=novaPessoa]') || (await ir('#/inicio'), !!document.querySelector('[data-atalho=novaPessoa]')), 'início do RH com "Nova pessoa"');
    Telas.rh.formAso(f); const j = await espera(janela); await okJanela('Salvar');
    conf(!erroJanela(j), 'RH grava exame', erroJanela(j));
  });

  // ================================================================ pedidos do RH (v2.2)
  await passo('banco de horas no ponto', async () => {
    await como('helena');
    const f = S.lista('funcionarios').find(x => x.nome === 'Lia Ramos');
    const m = U.hoje().slice(0, 7);
    await ir(`#/rh/ponto?f=${f.id}&m=${m}`); await dorme(150);
    const op = document.querySelector('[data-dia] [data-campo=justificativa]');
    conf(!!op && [...op.options].some(o => o.value === 'bh_pos') && [...op.options].some(o => o.value === 'bh_neg'), 'ocorrências BH+ e BH− na lista');
    // primeiro dia útil do mês ainda aberto: 2 h a mais vão para o banco
    const linha = [...document.querySelectorAll('[data-dia]')].find(l => !l.querySelector('[data-campo=e1]')?.disabled && ![0, 6].includes(new Date(l.dataset.dia + 'T12:00').getDay()) && !l.classList.contains('feriado'));
    if (linha) {
      for (const [k, v] of [['e1', '07:00'], ['s1', '12:00'], ['e2', '13:00'], ['s2', new Date(linha.dataset.dia + 'T12:00').getDay() === 5 ? '18:00' : '19:00']]) digitar(linha.querySelector(`[data-campo=${k}]`), v);
      digitar(linha.querySelector('[data-campo=justificativa]'), 'bh_pos'); await dorme(80);
      conf(linha.querySelector('.pd-bh')?.textContent.trim() === '+2h', 'saldo BH do dia: +2h', linha.querySelector('.pd-bh')?.textContent);
      await clicar(document.querySelector('[data-ponto=salvar]')); await espera(() => /Ponto salvo/.test(aviso()?.textContent || ''), 5000);
      await dorme(150);
      const r = document.getElementById('resumoPonto');
      conf(!!r && /Banco de horas/.test(r.textContent) && /Saldo credor/.test(r.textContent), 'resumo do período mostra o banco de horas (saldo credor)', r?.textContent.slice(0, 200));
    } else conf(false, 'achou um dia útil para lançar');
    conf(!!document.querySelector('[data-ponto=pdf]') && !!document.querySelector('[data-ponto=excel]'), 'botões Imprimir / PDF e Excel no cartão');
  });

  await passo('salário do cargo para todos', async () => {
    await como('helena');
    await ir('#/rh/ajustes?aba=cargos'); await dorme(100);
    const c = S.lista('rh_cargos').find(x => x.nome === 'Torneiro CNC');
    const pessoas = S.lista('funcionarios').filter(f => f.ativo && f.cargo_id === c.id);
    document.querySelector(`[data-cargo="${c.id}"]`).click(); const j = await espera(janela);
    conf(!!j.querySelector('[name=tipo]') && !!j.querySelector('[name=salario_cargo]'), 'cargo com tipo e salário');
    digitar(j.querySelector('[name=salario_cargo]'), '4.350,00'); await dorme(60);
    const ap = j.querySelector('[name=aplicar]');
    conf(!!ap === pessoas.length > 0, 'opção de atualizar todas as pessoas do cargo');
    if (ap) { ap.click(); await dorme(60); conf(!!j.querySelector('[name=vigencia]'), 'vigência só aparece ao marcar') }
    await okJanela('Salvar');
    conf(!erroJanela(j), 'salva o salário do cargo', erroJanela(j));
    conf(Number(S.get('rh_cargos_salarios', c.id)?.salario) === 4350, 'salário do cargo gravado');
    conf(pessoas.every(f => Number(S.get('funcionarios_privado', f.id)?.salario) === 4350), 'todas as pessoas do cargo com o novo salário', pessoas.map(f => S.get('funcionarios_privado', f.id)?.salario));
  });

  await passo('EPI com CA e entrega pelo cadastro', async () => {
    await como('helena');
    await ir('#/rh/seguranca?f=ca'); await dorme(120);
    conf(document.querySelectorAll('[data-ca]').length >= 3, 'lista de EPIs com CA');
    await clicar(document.querySelector('[data-seg=novoCa]')); let j = await espera(janela);
    digitar(j.querySelector('[name=descricao]'), 'Avental de raspa'); digitar(j.querySelector('[name=ca]'), '99901'); digitar(j.querySelector('[name=validade_ca]'), '2027-09-06');
    digitar(j.querySelector('[name=fabricante]'), 'Fabricante Teste'); digitar(j.querySelector('[name=tamanhos]'), 'Único');
    await okJanela('Salvar'); conf(!erroJanela(j), 'cadastra EPI com CA', erroJanela(j));
    const cat = S.lista('rh_epi_catalogo').find(x => x.ca === '99901');
    conf(!!cat && cat.fabricante === 'Fabricante Teste' && cat.validade_ca === '2027-09-06', 'EPI gravado com CA, validade e fabricante');
    const f = S.lista('funcionarios').find(x => x.nome === 'Beto Silva');
    // "Para quem": digita parte do nome e escolhe na lista
    Telas.rh.formEpi(); j = await espera(janela);
    const busca = j.querySelector('[name=funcionario_id]').closest('.select-busca').querySelector('input');
    busca.focus(); await dorme(60); digitar(busca, 'beto'); await dorme(120);
    const itensB = [...j.querySelectorAll('.select-busca .combo-lista:not([hidden]) .combo-item[data-v]')];
    conf(itensB.length === 1 && /Beto Silva/.test(itensB[0].textContent), 'busca de pessoa: "beto" acha só o Beto', itensB.map(x => x.textContent));
    itensB[0]?.click(); await dorme(80);
    conf(j.querySelector('[name=funcionario_id]').value === f.id && busca.value === 'Beto Silva', 'escolher na busca preenche a pessoa');
    UI.fecharTodas(); await dorme(100);
    Telas.rh.formEpi(f); j = await espera(janela);
    digitar(j.querySelector('[data-campo=cat]'), cat.id); await dorme(60);
    digitar(j.querySelector('[aria-label=Tamanho]'), 'Único');
    await okJanela('Registrar entrega'); conf(!erroJanela(j), 'entrega pelo cadastro', erroJanela(j));
    const e = S.lista('rh_epis').filter(x => x.funcionario_id === f.id && x.catalogo_id === cat.id)[0];
    conf(!!e && e.ca === '99901' && e.tamanho === 'Único' && e.fabricante === 'Fabricante Teste', 'entrega com CA, fabricante e tamanho', e);
    conf(/Assinar o termo/.test(aviso()?.textContent || ''), 'aviso oferece assinar o termo');
    UI.fecharTodas();
    Telas.rh.termoEpi(f, [e.id]); j = await espera(janela);
    conf(!!j.querySelector('[name=modo][value=facial]') && !!j.querySelector('[name=modo][value=tela]') && !!j.querySelector('[name=modo][value=papel]'), 'termo: assinatura facial, na tela ou no papel');
    conf(j.querySelector(`[name="e_${e.id}"]`)?.checked, 'termo já marca a entrega nova');
    j.querySelector('[name=modo][value=tela]').click(); await dorme(120);
    conf(!!j.querySelector('canvas.assin-tela'), 'quadro para assinar na tela');
    UI.fecharTodas();
  });

  await passo('indicadores de RH', async () => {
    await como('helena');
    await ir('#/rh/indicadores'); await dorme(250);
    const v = document.getElementById('view');
    conf(/Indicadores de RH/.test(v.textContent) && !!document.getElementById('tRot') && !!document.getElementById('tCustos'), 'tela de indicadores com rotatividade e custos');
    conf(/Turnover do ano/.test(v.textContent) && /Faixa etária/.test(v.textContent) && /Tipo de cargo/.test(v.textContent), 'indicadores de equipe');
    conf(document.querySelectorAll('#alertasInd .nota').length > 0 || /Sem comparação/.test(v.textContent), 'alertas e dicas do mês');
    await clicar(document.querySelector('[data-ind=lancar]')); const j = await espera(janela);
    digitar(j.querySelector('[name=receita_1]'), '123.456,78');
    await okJanela('Salvar'); conf(!erroJanela(j), 'lança a receita do mês', erroJanela(j));
    conf(S.lista('rh_indicadores').some(x => x.competencia.endsWith('-01-01') && Number(x.receita) === 123456.78), 'receita gravada');
    await como('gerente'); await ir('#/rh/indicadores'); conf(/Sem acesso/.test(document.getElementById('view').textContent), 'gerente não abre os indicadores (têm receita e salários)');
  });

  await passo('perfil gerente de fábrica', async () => {
    await como('gerente');
    conf(S.lista('funcionarios_privado').length === 0 && S.lista('rh_historico').length === 0 && S.lista('rh_anexos').length === 0, 'gerente não recebe salário, documentos nem anexos');
    conf(S.lista('rh_ausencias').length > 0 && S.lista('rh_ausencias').every(a => a.cid === undefined || a.cid === null), 'gerente vê quem está fora, sem CID');
    const f = S.lista('funcionarios').find(x => x.nome === 'Beto Silva');
    await ir('#/funcionario/' + f.id);
    const abas = [...document.querySelectorAll('.abas-tela a')].map(a => a.textContent);
    conf(!abas.includes('Dados pessoais') && !abas.includes('Cargo e salário') && abas.includes('Ponto'), 'ficha do gerente sem dados pessoais e salário', abas);
    conf(!botao('Editar', document.getElementById('view')), 'gerente não edita pessoa');
    await ir(`#/rh/ponto?f=${f.id}&m=${U.hoje().slice(0, 7)}`); await dorme(100);
    conf(!document.querySelector('[data-ponto=salvar]') && document.querySelector('[data-dia] [data-campo=e1]')?.disabled, 'gerente só consulta o ponto');
    conf(!document.getElementById('view').textContent.includes('R$'), 'ponto do gerente sem valores em R$');
    await ir('#/rh/ajustes'); conf(document.getElementById('view').textContent.includes('Sem acesso'), 'gerente não abre os ajustes do RH');
    await ir('#/pecas'); conf(!document.getElementById('view').textContent.includes('Sem acesso'), 'gerente vê o estoque');
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
