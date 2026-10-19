/* JAF Metal — dados INVENTADOS para o modo teste (nunca usar dados reais aqui: este arquivo é público). */
'use strict';

const Demo = (() => {
  // gerador pseudoaleatório fixo (a demonstração sai sempre igual)
  let semente = 20261019;
  const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
  const entre = (a, b) => Math.floor(a + rnd() * (b - a + 1));
  const hoje = U.hoje();
  const dia = (n) => U.somaDias(hoje, n);

  const FORN = [
    { nome: 'Alfa Ferramentas', razao: 'Alfa Ferramentas de Corte Ltda. (exemplo)', contato: 'Ricardo', telefone: '(11) 5555-0101', celular: '(11) 95555-0101', email: 'vendas@alfa.exemplo', cidade: 'São Paulo', uf: 'SP', qualificacao: 'Aprovado', qualif_metodo: 'Qualificação interna', qualif_validade: dia(200) },
    { nome: 'Beta Rolamentos', razao: 'Beta Comércio de Rolamentos Ltda. (exemplo)', contato: 'Renata', telefone: '(11) 5555-0202', email: 'contato@beta.exemplo', cidade: 'São Paulo', uf: 'SP', qualificacao: 'Aprovado', qualif_validade: dia(-10) },
    { nome: 'Gama Importados', razao: 'Compras online (exemplo)', contato: 'Pedido pelo site', cidade: 'Exterior', obs: 'Prazo de entrega longo (20 a 40 dias)' },
    { nome: 'Delta Usinagem', razao: 'Delta Ferramentaria e Usinagem ME (exemplo)', contato: 'José', celular: '(11) 95555-0404', cidade: 'São Paulo', uf: 'SP', tipo: 'Peças e serviço' },
    { nome: 'Épsilon Elétrica', razao: 'Épsilon Materiais Elétricos (exemplo)', contato: 'Balcão', telefone: '(11) 5555-0505', cidade: 'São Paulo', uf: 'SP' },
    { nome: 'Carlos Eletricista', contato: 'Carlos', celular: '(11) 95555-0606', cidade: 'São Paulo', uf: 'SP', tipo: 'Serviço', obs: 'Eletricista de máquinas' },
  ];
  const MAQ = [
    { nome: 'Torno CNC 01', tipo: 'Torno CNC', fabricante: 'Exemplo', setor: 'Usinagem', preventiva_dias: 90 },
    { nome: 'Torno CNC 02', tipo: 'Torno CNC', fabricante: 'Exemplo', setor: 'Usinagem', preventiva_dias: 90 },
    { nome: 'TA 25', tipo: 'Torno automático', setor: 'Usinagem', preventiva_dias: 60 },
    { nome: 'Fresadora FS 01', tipo: 'Fresadora', setor: 'Usinagem', preventiva_dias: 120 },
    { nome: 'Serra Automática SR 03', tipo: 'Serra', setor: 'Corte', preventiva_dias: 60 },
    { nome: 'Prensa Hidráulica', tipo: 'Prensa', setor: 'Estampagem', preventiva_dias: 180 },
    { nome: 'Curvadora', tipo: 'Curvadora de tubos', setor: 'Conformação' },
    { nome: 'Cabine de pintura', tipo: 'Pintura', setor: 'Acabamento', preventiva_dias: 30 },
  ];
  // [código, descrição, utilização, fornecedor, mín, máx, preço, consumo/mês]
  const PECAS = [
    ['CNMG 120412-EX', 'Inserto para torneamento', 'Torno CNC', 'Alfa Ferramentas', 10, 30, 36, 12],
    ['DCMT 11T304-EX', 'Inserto para torneamento', 'Torno CNC', 'Alfa Ferramentas', 10, 30, 38.3, 10],
    ['DNMG 150604-EX', 'Inserto para torneamento', 'Torno CNC', 'Alfa Ferramentas', 10, 20, 60.5, 8],
    ['TCMT 110204-EX', 'Inserto para torneamento', 'Torno CNC', 'Alfa Ferramentas', 10, 20, 27, 5],
    ['GCMR 2002-EX', 'Inserto para cortar', 'TA 25', 'Alfa Ferramentas', 10, 30, 48, 14],
    ['MGMR 200-EX', 'Inserto para cortar', 'TA 25', 'Gama Importados', 20, 60, 17.1, 20],
    ['WGE 20R-EX', 'Inserto para cortar', 'TA 25', 'Gama Importados', 20, 40, 64.9, 10],
    ['SCMT 09T308-EX', 'Inserto para fresadora', 'Fresadora FS 01', 'Alfa Ferramentas', 10, 20, 46.4, 6],
    ['APMT 1604-EX', 'Inserto para fresar', 'Fresadora FS 01', 'Gama Importados', 10, 20, 27, 3],
    ['SPMG 0904-EX', 'Inserto para broca T-Max', 'Torno CNC', 'Gama Importados', 10, 20, 42.3, 4],
    ['TQJ 27-EX', 'Bedame para formar canal 1,00 mm', 'Torno CNC', 'Delta Usinagem', 5, 10, 314.6, 1],
    ['6204 ZZ', 'Rolamento de esferas', 'Serra Automática SR 03', 'Beta Rolamentos', 0, 5, 18, 0.4],
    ['6200 ZZ', 'Rolamento de esferas', 'TA 25', 'Beta Rolamentos', 2, 5, 15.5, 0.5],
    ['30208', 'Rolamento de rolos cônicos', 'Fresadora FS 01', 'Beta Rolamentos', 1, 2, 120, 0.1],
    ['7210 P4', 'Rolamento de contato angular (par)', 'TA 25', 'Beta Rolamentos', 1, 2, 890, 0.05],
    ['210L-EX', 'Correia sincronizadora 210L 20 mm', 'Torno CNC 02', 'Beta Rolamentos', 1, 5, 124.5, 0.3],
    ['A34-EX', 'Correia em V A34', 'TA 25', 'Beta Rolamentos', 0, 3, 32, 0.2],
    ['PUN-8.5', 'Punção Ø8,5 para dispositivo DP 0070', 'Prensa Hidráulica', 'Delta Usinagem', 2, 7, 50, 0.6],
    ['MAT-0059', 'Matriz para dispositivo DP 0059', 'Prensa Hidráulica', 'Delta Usinagem', 1, 2, 700, 0.08],
    ['SENSOR-M12', 'Sensor indutivo 4 mm M12 PNP', 'Curvadora', 'Épsilon Elétrica', 1, 3, 145, 0.1],
    ['BOB-24V', 'Bobina solenoide 24 V', 'Serra Automática SR 03', 'Épsilon Elétrica', 1, 2, 98, 0.1],
    ['FILTRO-570', 'Filtro cartucho 570 × 600 mm', 'Cabine de pintura', 'Épsilon Elétrica', 0, 2, 380, 0.15],
    ['LED-10W', 'Refletor LED 10 W', 'TA 25', 'Épsilon Elétrica', 1, 3, 45, 0.1],
    ['KIT-PISTAO', 'Kit reparo para 3 pistões', 'Curvadora', 'Beta Rolamentos', 0, 2, 260, 0.05],
    ['ALARG-8.17', 'Alargador máquina HSS Ø8,17 mm', 'Torno CNC', 'Alfa Ferramentas', 0, 2, 295.5, 0.1],
  ];

  function historico() {
    // 14 meses de movimentações por peça: entradas de lote e retiradas
    const movs = [], pedidos = [];
    for (const [cod, , , forn, mi, ma, preco, porMes] of PECAS) {
      let est = 0, d = -425, p = preco * 0.82;
      const lote = Math.max(1, Math.round(ma > 0 ? ma - mi : 5));
      let ultimaEnt = null;
      while (d < -2) {
        if (est <= mi && rnd() < 0.85) {
          const q = Math.max(1, Math.round(lote * (0.7 + rnd() * 0.5)));
          p = Math.round(p * (1 + rnd() * 0.06) * 100) / 100;
          const doc = 'NF ' + String(entre(10000, 99999)).padStart(6, '0');
          movs.push({ data: dia(d), codigo: cod, tipo: 'entrada', qtd: q, preco_unit: p, fornecedor: forn, documento: doc });
          pedidos.push({ data: dia(d - entre(3, 12)), fornecedor: forn, documento: 'Proposta ' + entre(1000, 9999), prazo: dia(d), status: 'recebido', itens: [{ codigo: cod, qtd: q, valor: Math.round(q * p * 100) / 100 }] });
          est += q; ultimaEnt = { p, doc };
        }
        const passo = porMes >= 4 ? entre(3, 9) : porMes >= 1 ? entre(10, 25) : entre(40, 120);
        d += passo;
        if (d >= -2) break;
        const tirar = Math.min(est, Math.max(1, Math.round(porMes * passo / 30 * (0.6 + rnd() * 0.8))));
        if (tirar > 0 && ultimaEnt) { movs.push({ data: dia(d), codigo: cod, tipo: 'saida', qtd: tirar, preco_unit: ultimaEnt.p, fornecedor: forn, documento: ultimaEnt.doc }); est -= tirar; }
      }
    }
    movs.sort((a, b) => a.data < b.data ? -1 : a.data > b.data ? 1 : (a.tipo === 'entrada' ? -1 : 1));
    // saída antes da entrada no mesmo código não pode deixar o estoque negativo: refaz o saldo
    const saldo = {};
    const ok = [];
    for (const m of movs) { saldo[m.codigo] = saldo[m.codigo] || 0; if (m.tipo === 'saida') { if (saldo[m.codigo] < m.qtd) continue; saldo[m.codigo] -= m.qtd; } else saldo[m.codigo] += m.qtd; ok.push(m); }
    pedidos.sort((a, b) => a.data < b.data ? -1 : 1);
    return { movs: ok, pedidos };
  }

  async function criar() {
    const senha = 'teste1234';
    await API.rpc('primeiro_dono', { p_login: 'dono', p_senha: senha, p_nome: 'Dono (teste)' });
    await API.entrar('dono', senha);
    const funcs = [
      ['Beto Silva', 'Torneiro CNC', 'Usinagem', '2019-03-11', 3600], ['Caio Souza', 'Operador de torno automático', 'Usinagem', '2021-08-02', 3100],
      ['Denise Lima', 'Auxiliar administrativo', 'Escritório', '2022-01-17', 2800], ['Edu Rocha', 'Almoxarife', 'Almoxarifado', U.somaMeses(hoje, -23), 2900],
      ['Fábio Nunes', 'Fresador', 'Usinagem', '2018-05-07', 3500], ['Gil Prado', 'Ajudante geral', 'Produção', U.somaMeses(hoje, -5), 2100],
    ];
    const ids = {};
    for (const [n, [nome, funcao, setor, adm, sal]] of funcs.entries()) {
      // férias em dia para quase todos; um com período para vencer, para mostrar o aviso
      const anos = Math.floor(U.dias(adm, hoje) / 365.25);
      const tiradas = n === 1 ? Math.max(0, anos - 2) : Math.max(0, anos - 1);
      const ferias = Array.from({ length: tiradas }, (_, k) => { const ini = U.somaMeses(adm, 12 * (k + 1) + 3); return { inicio: ini, fim: U.somaDias(ini, 29) }; });
      ids[nome] = await API.rpc('salvar_funcionario', { p: { nome, funcao, setor, admissao: adm, telefone: '(11) 95555-' + entre(1000, 9999),
        privado: { salario: sal, nascimento: `19${entre(70, 99)}-${String(entre(1, 12)).padStart(2, '0')}-${String(entre(1, 28)).padStart(2, '0')}`, ferias } } });
    }
    await API.rpc('criar_acesso', { p_login: 'escritorio', p_senha: senha, p_nome: 'Denise (teste)', p_perfil: 'escritorio', p_func: ids['Denise Lima'] });
    await API.rpc('criar_acesso', { p_login: 'almox', p_senha: senha, p_nome: 'Edu (teste)', p_perfil: 'almoxarife', p_func: ids['Edu Rocha'] });
    await API.rpc('criar_acesso', { p_login: 'operador', p_senha: senha, p_nome: 'Beto (teste)', p_perfil: 'producao', p_func: ids['Beto Silva'] });

    // na demonstração as senhas já são as definitivas (no sistema real o Dono cria provisórias)
    await API._pg.query(`update public.perfis set trocar_senha = false`);
    const { movs, pedidos } = historico();
    await API.rpc('importar_planilha', { p: {
      fornecedores: FORN, maquinas: MAQ,
      pecas: PECAS.map(([codigo, descricao, utilizacao, fornecedor, est_min, est_max]) => ({ codigo, descricao, utilizacao, fornecedor, est_min, est_max })),
      movimentos: movs, pedidos,
    }, p_substituir: true });
    await S.carregar();
    const peca = (c) => S.lista('pecas').find(p => p.codigo === c);
    const forn = (n) => S.lista('fornecedores').find(f => f.nome === n);
    const maq = (n) => S.lista('maquinas').find(m => m.nome === n);

    // pedidos em aberto (um atrasado, um que chega hoje)
    const preco = (c) => PECAS.find(p => p[0] === c)[6];
    const novoPed = async (fornNome, itens, data, prazo, doc) => API.rpc('salvar_pedido', { p: { fornecedor_id: forn(fornNome).id, data, prazo, documento: doc,
      itens: itens.map(([c, q]) => ({ peca_id: peca(c).id, qtd: q, valor: Math.round(q * preco(c) * 100) / 100 })) } });
    await novoPed('Gama Importados', [['MGMR 200-EX', 40], ['WGE 20R-EX', 20]], dia(-30), dia(-4), 'Pedido online 82141');
    await novoPed('Alfa Ferramentas', [['DNMG 150604-EX', 10], ['TCMT 110204-EX', 10]], dia(-5), hoje, 'Proposta 89192');
    await novoPed('Beta Rolamentos', [['6200 ZZ', 4]], dia(-2), dia(6), 'WhatsApp');

    // manutenções
    const prev = async (m, d) => API.rpc('salvar_manutencao', { p: { maquina_id: maq(m).id, data: dia(d), tipo: 'preventiva', status: 'concluida', concluida_em: dia(d), problema: 'Preventiva: lubrificação, folgas e limpeza', solucao: 'Feito conforme checklist', custo_servico: 0 } });
    await prev('Torno CNC 01', -40); await prev('Torno CNC 02', -95); await prev('TA 25', -20); await prev('Fresadora FS 01', -60);
    await prev('Serra Automática SR 03', -30); await prev('Prensa Hidráulica', -100); await prev('Cabine de pintura', -12);
    await API.rpc('salvar_manutencao', { p: { maquina_id: maq('TA 25').id, data: dia(-1), tipo: 'corretiva', status: 'aberta', problema: 'Barulho no cabeçote ao acelerar', funcionario_id: ids['Caio Souza'] } });
    await API.rpc('salvar_manutencao', { p: { maquina_id: maq('Curvadora').id, data: dia(-70), tipo: 'corretiva', status: 'concluida', concluida_em: dia(-69), problema: 'Sensor não detecta o tubo',
      solucao: 'Troca do sensor indutivo', fornecedor_id: forn('Carlos Eletricista').id, custo_servico: 250, horas_parada: 6 } });

    // clientes e ordens de produção
    const cUp = await API.rpc('salvar_cliente', { p: { nome: 'Upgrade Barras de Apoio', cidade: 'São Paulo', uf: 'SP', contato: 'Compras' } });
    const cOutro = await API.rpc('salvar_cliente', { p: { nome: 'Cliente Exemplo Ltda.', cidade: 'Guarulhos', uf: 'SP' } });
    const op = async (o) => API.rpc('salvar_ordem', { p: o });
    const o1 = await op({ cliente_id: cUp, pedido_cliente: 'PC 016/26', produto: 'Barra reta 400 mm inox', codigo: 'UP 01.0002', qtd: 80, prazo: dia(5), maquina_id: maq('Curvadora').id, responsavel_id: ids['Caio Souza'] });
    const o2 = await op({ cliente_id: cUp, pedido_cliente: 'PC 017/26', produto: 'Barra em L 600 × 600 mm', codigo: 'UP 01.0010', qtd: 30, prazo: dia(-2), maquina_id: maq('Curvadora').id, prioridade: 1 });
    const o3 = await op({ cliente_id: cOutro, produto: 'Pino usinado Ø12', codigo: 'PN-012', qtd: 500, prazo: dia(12), maquina_id: maq('TA 25').id, responsavel_id: ids['Caio Souza'] });
    const o4 = await op({ cliente_id: cUp, pedido_cliente: 'PC 015/26', produto: 'Barra reta 800 mm', codigo: 'UP 01.0004', qtd: 40, prazo: dia(-6), maquina_id: maq('Curvadora').id });
    await API.rpc('ordem_status', { p: { id: o1.id, status: 'producao', produzido: 35 } });
    await API.rpc('ordem_status', { p: { id: o4.id, status: 'pronta' } });
    await API.rpc('ordem_status', { p: { id: o4.id, status: 'entregue', entregue_em: dia(-1) } });
    void o2; void o3;

    // financeiro
    const conta = (o) => API.rpc('salvar_lancamento', { p: o });
    await conta({ tipo: 'pagar', descricao: 'Energia elétrica', categoria: 'Energia', valor: 4280.55, vencimento: dia(-3) });
    await conta({ tipo: 'pagar', descricao: 'Aluguel do galpão', categoria: 'Aluguel', valor: 9500, vencimento: U.somaMeses(hoje, 0).slice(0, 8) + '10', parcelas: 6, intervalo: 'mensal' });
    await conta({ tipo: 'pagar', descricao: 'Simples Nacional', categoria: 'Impostos', valor: 6120.4, vencimento: hoje });
    await conta({ tipo: 'pagar', descricao: 'Compra de inserto (Alfa)', categoria: 'Compras / almoxarifado', valor: 1840, vencimento: dia(12), parcelas: 2, intervalo: '30', fornecedor_id: forn('Alfa Ferramentas').id });
    await conta({ tipo: 'receber', descricao: 'Upgrade — PC 015/26', categoria: 'Upgrade', valor: 12800, vencimento: dia(20), cliente_id: cUp, ordem_id: o4.id });
    await conta({ tipo: 'receber', descricao: 'Upgrade — PC 012/26', categoria: 'Upgrade', valor: 8600, vencimento: dia(-5), cliente_id: cUp });
    const pago = await conta({ tipo: 'receber', descricao: 'Upgrade — PC 010/26', categoria: 'Upgrade', valor: 15400, vencimento: dia(-15), cliente_id: cUp });
    await API.rpc('baixar_lancamento', { p_id: pago, p_data: dia(-14), p_valor: 15400, p_forma: 'Boleto' });
    const pago2 = await conta({ tipo: 'pagar', descricao: 'Folha de pagamento', categoria: 'Folha de pagamento', valor: 18000, vencimento: dia(-13) });
    await API.rpc('baixar_lancamento', { p_id: pago2, p_data: dia(-13), p_valor: 18000, p_forma: 'Transferência' });
    await API.rpc('salvar_config', { p_chave: 'empresa', p_valor: { nome: 'JAF Metal (teste)', cidade: 'São Paulo', uf: 'SP' } });
    await API.rpc('salvar_config', { p_chave: 'saldo_inicial', p_valor: { valor: 25000, data: dia(-30) } });

    await API.sair();
    API.precisaDemo = false;
  }

  return { criar };
})();
