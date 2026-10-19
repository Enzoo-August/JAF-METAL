/* JAF Metal — dados em memória (S) e cálculos (C) */
'use strict';

const S = (() => {
  // tabela -> campo usado para buscar só o que mudou (null = sempre inteira)
  const INCR = {
    config: 'atualizado_em', pecas: 'atualizado_em', maquinas: 'atualizado_em', manutencoes: 'atualizado_em',
    funcionarios: 'atualizado_em', ordens: 'atualizado_em', movimentos: 'seq', fornecedores: 'atualizado_em',
    pedidos_compra: 'atualizado_em', pedido_itens: null, clientes: 'atualizado_em', lancamentos: 'atualizado_em',
    funcionarios_privado: 'atualizado_em', perfis: null,
  };
  const CHAVE = { config: 'chave', funcionarios_privado: 'funcionario_id', perfis: 'user_id' };

  const S = { d: {}, i: {}, nomes: new Map(), carregadoEm: 0, ultimaBusca: 0 };
  const ouvintes = new Set();
  S.ouvir = (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); };
  const avisar = (tabelas) => { for (const f of ouvintes) { try { f(tabelas); } catch (e) { console.error(e); } } };

  S.tabelasDoPerfil = () => {
    const p = API.sessao?.perfil;
    const t = ['config', 'pecas', 'maquinas', 'manutencoes', 'funcionarios', 'ordens', 'movimentos'];
    if (['dono', 'escritorio', 'almoxarife'].includes(p)) t.push('fornecedores', 'pedidos_compra', 'pedido_itens');
    if (['dono', 'escritorio'].includes(p)) t.push('clientes', 'lancamentos', 'funcionarios_privado');
    if (p === 'dono') t.push('perfis');
    return t;
  };

  function indexar(t) {
    const k = CHAVE[t] || 'id';
    const m = new Map();
    for (const x of S.d[t]) m.set(x[k], x);
    S.i[t] = m;
  }

  // carrega tudo do zero
  S.carregar = async () => {
    const tabs = S.tabelasDoPerfil();
    for (const t of Object.keys(INCR)) { S.d[t] = []; S.i[t] = new Map(); }
    const res = await Promise.all(tabs.map(t => API.ler(t)));
    tabs.forEach((t, n) => { S.d[t] = res[n]; indexar(t); });
    await carregarNomes();
    S.carregadoEm = Date.now(); S.ultimaBusca = Date.now();
    avisar(tabs);
  };

  async function carregarNomes() {
    try {
      const n = await API.chamarTabela('nomes_usuarios');
      S.nomes = new Map(n.map(x => [x.user_id, x.nome]));
    } catch (e) { /* não é essencial */ }
  }

  // busca só o que mudou nas tabelas pedidas (ou em todas)
  S.atualizar = async (tabelas, opt = {}) => {
    const permitidas = new Set(S.tabelasDoPerfil());
    let tabs = (tabelas || [...permitidas]).filter(t => permitidas.has(t));
    const mudou = [];
    await Promise.all(tabs.map(async (t) => {
      const campo = INCR[t];
      if (!campo || opt.inteira?.includes(t)) {
        const novo = await API.ler(t);
        if (JSON.stringify(novo) !== JSON.stringify(S.d[t])) { S.d[t] = novo; indexar(t); mudou.push(t); }
        return;
      }
      let desde = null;
      for (const x of S.d[t]) { const v = x[campo]; if (v !== null && v !== undefined && (desde === null || v > desde)) desde = v; }
      const novos = await API.ler(t, desde === null ? {} : { campo, desde: campo === 'seq' ? desde : new Date(new Date(desde).getTime() - 2000).toISOString() });
      if (!novos.length) return;
      const k = CHAVE[t] || 'id';
      let alterou = false;
      for (const n of novos) {
        const velho = S.i[t].get(n[k]);
        if (velho) { if (JSON.stringify(velho) !== JSON.stringify(n)) { Object.assign(velho, n); alterou = true; } }
        else { S.d[t].push(n); S.i[t].set(n[k], n); alterou = true; }
      }
      if (alterou) mudou.push(t);
    }));
    // itens de pedido acompanham os pedidos
    if (mudou.includes('pedidos_compra') && permitidas.has('pedido_itens') && !tabs.includes('pedido_itens')) {
      const novo = await API.ler('pedido_itens');
      S.d.pedido_itens = novo; indexar('pedido_itens'); mudou.push('pedido_itens');
    }
    if (mudou.includes('perfis') || mudou.includes('funcionarios')) await carregarNomes();
    S.ultimaBusca = Date.now();
    if (mudou.length) avisar(mudou);
    return mudou;
  };

  S.lista = (t) => S.d[t] || [];
  S.get = (t, id) => (id && S.i[t]) ? S.i[t].get(id) || null : null;
  S.cfg = (chave, padrao = {}) => S.get('config', chave)?.valor ?? padrao;
  S.nomeUsuario = (uid) => S.nomes.get(uid) || '';

  return S;
})();

/* ----------------------------------------------------------------- cálculos */
const C = (() => {
  const C = {};
  const hoje = () => U.hoje();

  // ---------------- situação da peça (mesma regra da planilha, mais "no mínimo")
  C.situacao = (p) => {
    const e = Number(p.estoque) || 0, mi = Number(p.est_min) || 0, ma = Number(p.est_max) || 0;
    if (!p.ativo) return { cod: 'inativa', txt: 'Desativada', cor: 'cinza' };
    if (e < mi) return { cod: 'comprar', txt: 'Comprar', cor: 'vermelho' };
    if (ma > 0 && e > ma) return { cod: 'alto', txt: 'Estoque alto', cor: 'azul' };
    if (mi > 0 && e === mi) return { cod: 'minimo', txt: 'No mínimo', cor: 'amarelo' };
    if (e === 0) return { cod: 'zerado', txt: 'Sem estoque', cor: 'cinza' };
    return { cod: 'ok', txt: 'Ok', cor: 'verde' };
  };

  // ---------------- pedidos de compra
  C.itensDoPedido = (pedId) => S.lista('pedido_itens').filter(i => i.pedido_id === pedId).sort((a, b) => a.ordem - b.ordem);
  C.totalPedido = (ped) => U.r2(U.soma(C.itensDoPedido(ped.id), 'valor') + (Number(ped.frete) || 0));
  C.situacaoPedido = (ped) => {
    if (ped.status === 'cancelado') return { cod: 'cancelado', txt: 'Cancelado', cor: 'cinza' };
    if (ped.status === 'recebido') return { cod: 'recebido', txt: 'Recebido', cor: 'verde' };
    const itens = C.itensDoPedido(ped.id);
    const parcial = itens.some(i => i.recebido > 0);
    if (ped.prazo && ped.prazo < hoje()) return { cod: 'atrasado', txt: parcial ? 'Atrasado (parcial)' : 'Atrasado', cor: 'vermelho' };
    if (ped.prazo && ped.prazo === hoje()) return { cod: 'hoje', txt: 'Chega hoje', cor: 'amarelo' };
    return { cod: 'aguardando', txt: parcial ? 'Chegou parte' : 'Aguardando', cor: 'azul' };
  };
  // quanto da peça ainda vai chegar de pedidos em aberto
  C.pendente = (pecaId) => {
    let n = 0;
    for (const i of S.lista('pedido_itens')) {
      if (i.peca_id !== pecaId) continue;
      const ped = S.get('pedidos_compra', i.pedido_id);
      if (ped && ped.status === 'aguardando') n += Math.max(0, i.qtd - i.recebido);
    }
    return n;
  };
  C.pedidosAbertosDaPeca = (pecaId) => {
    const r = [];
    for (const i of S.lista('pedido_itens')) {
      if (i.peca_id !== pecaId || i.recebido >= i.qtd) continue;
      const ped = S.get('pedidos_compra', i.pedido_id);
      if (ped && ped.status === 'aguardando') r.push({ ped, item: i });
    }
    return r;
  };

  // sugestão de compra: completar até o máximo, descontando o que já foi pedido
  C.sugestao = (p) => {
    const e = Math.max(0, Number(p.estoque) || 0), mi = Number(p.est_min) || 0, ma = Number(p.est_max) || 0;
    const alvo = ma > 0 ? ma : (mi > 0 ? mi * 2 : 0);
    const pend = C.pendente(p.id);
    return { alvo, pendente: pend, sugerido: Math.max(0, Math.ceil(alvo - e - pend)) };
  };
  C.listaCompras = () => {
    const r = [];
    for (const p of S.lista('pecas')) {
      if (!p.ativo) continue;
      if (C.situacao(p).cod !== 'comprar') continue;
      const s = C.sugestao(p);
      r.push({ peca: p, ...s, jaPedido: s.sugerido === 0 && s.pendente > 0 });
    }
    return r;
  };

  // ---------------- último preço pago / fornecedor
  C.ultimaEntrada = (pecaId, fornecedorId) => {
    let u = null;
    for (const m of S.lista('movimentos')) {
      if (m.peca_id !== pecaId || m.tipo !== 'entrada' || !(m.preco_unit > 0) || m.motivo === 'estorno') continue;
      if (fornecedorId && m.fornecedor_id !== fornecedorId) continue;
      if (!u || m.data > u.data || (m.data === u.data && m.seq > u.seq)) u = m;
    }
    return u;
  };

  // ---------------- lotes PEPS (igual à função do banco)
  C.lotes = (pecaId) => {
    const p = S.get('pecas', pecaId);
    let e = Math.max(0, Number(p?.estoque) || 0);
    const ent = S.lista('movimentos').filter(m => m.peca_id === pecaId && m.tipo === 'entrada')
      .sort((a, b) => a.data < b.data ? 1 : a.data > b.data ? -1 : b.seq - a.seq);
    const r = [];
    for (const m of ent) {
      if (e <= 0) break;
      const resta = Math.min(m.qtd, e);
      r.push({ mov: m, resta, valor: resta * m.preco_unit });
      e -= resta;
    }
    return r.reverse();
  };
  C.valorPeca = (pecaId) => U.soma(C.lotes(pecaId), 'valor');
  C.valorEstoque = () => U.soma(S.lista('pecas'), p => (Number(p.estoque) > 0 ? C.valorPeca(p.id) : 0));

  // ---------------- consumo (retiradas, descontando as desfeitas)
  C.ehConsumo = (m) => m.tipo === 'saida' && (m.motivo === 'retirada' || m.motivo === 'importado');
  C.consumos = (filtro) => {
    // devolve lista de {mov, qtd, valor} com o sinal certo (estorno de retirada entra negativo)
    const r = [];
    for (const m of S.lista('movimentos')) {
      if (filtro && !filtro(m)) continue;
      if (C.ehConsumo(m)) r.push({ mov: m, qtd: m.qtd, valor: m.qtd * m.preco_unit });
      else if (m.motivo === 'estorno' && m.tipo === 'entrada') {
        const o = S.get('movimentos', m.estorno_de);
        if (o && C.ehConsumo(o)) r.push({ mov: o, qtd: -m.qtd, valor: -m.qtd * m.preco_unit, estorno: m });
      }
    }
    return r;
  };
  C.consumoPeca = (pecaId, meses = 12) => {
    const de = U.somaMeses(hoje(), -meses);
    return U.soma(C.consumos(m => m.peca_id === pecaId && m.data > de), 'qtd');
  };
  // quantos meses o estoque dura no ritmo dos últimos 12 meses
  C.duracao = (p) => {
    const c = C.consumoPeca(p.id, 12);
    if (c <= 0) return null;
    return (Math.max(0, p.estoque)) / (c / 12);
  };

  // ---------------- máquinas / manutenção
  C.ultimaPreventiva = (maqId) => {
    let u = null;
    for (const m of S.lista('manutencoes')) if (m.maquina_id === maqId && m.tipo === 'preventiva' && m.status === 'concluida') {
      const d = m.concluida_em || m.data; if (!u || d > u) u = d;
    }
    return u;
  };
  C.proximaPreventiva = (maq) => {
    if (!maq.preventiva_dias) return null;
    const u = C.ultimaPreventiva(maq.id);
    return u ? U.somaDias(u, maq.preventiva_dias) : null;
  };
  C.manutAbertas = (maqId) => S.lista('manutencoes').filter(m => m.status !== 'concluida' && (!maqId || m.maquina_id === maqId));
  C.situacaoMaquina = (maq) => {
    if (!maq.ativo) return { cod: 'inativa', txt: 'Desativada', cor: 'cinza' };
    const ab = C.manutAbertas(maq.id);
    if (ab.some(m => m.tipo === 'corretiva')) return { cod: 'parada', txt: 'Com problema', cor: 'vermelho' };
    if (ab.length) return { cod: 'manut', txt: 'Em manutenção', cor: 'amarelo' };
    const prox = C.proximaPreventiva(maq);
    if (maq.preventiva_dias && !C.ultimaPreventiva(maq.id)) return { cod: 'semprev', txt: 'Preventiva sem registro', cor: 'amarelo' };
    if (prox && prox < hoje()) return { cod: 'prevvencida', txt: 'Preventiva vencida', cor: 'vermelho' };
    if (prox && U.dias(hoje(), prox) <= 7) return { cod: 'prevlogo', txt: 'Preventiva em ' + U.relativo(prox), cor: 'amarelo' };
    return { cod: 'ok', txt: 'Funcionando', cor: 'verde' };
  };

  // ---------------- produção
  C.situacaoOrdem = (o) => {
    const mapa = { fila: ['Na fila', 'cinza'], producao: ['Produzindo', 'azul'], pronta: ['Pronta', 'verde'], entregue: ['Entregue', 'verde'], cancelada: ['Cancelada', 'cinza'] };
    const [txt, cor] = mapa[o.status] || [o.status, 'cinza'];
    const atrasada = o.prazo && o.prazo < hoje() && ['fila', 'producao'].includes(o.status);
    return { cod: o.status, txt, cor: atrasada ? 'vermelho' : cor, atrasada };
  };

  // ---------------- financeiro
  C.situacaoConta = (l) => {
    if (l.pago_em) return { cod: 'pago', txt: l.tipo === 'pagar' ? 'Paga' : 'Recebida', cor: 'verde' };
    if (l.vencimento < hoje()) return { cod: 'vencida', txt: 'Vencida', cor: 'vermelho' };
    if (l.vencimento === hoje()) return { cod: 'hoje', txt: 'Vence hoje', cor: 'amarelo' };
    return { cod: 'aberta', txt: 'Em aberto', cor: 'azul' };
  };
  C.categorias = () => {
    const c = S.cfg('categorias', null);
    return {
      pagar: c?.pagar || ['Compras / almoxarifado', 'Matéria-prima', 'Folha de pagamento', 'Impostos', 'Energia', 'Água', 'Aluguel',
        'Manutenção de máquinas', 'Serviços de terceiros', 'Frete', 'Combustível', 'Telefone / internet', 'Outras despesas'],
      receber: c?.receber || ['Venda de peças / serviços', 'Upgrade', 'Outras receitas'],
    };
  };

  // ---------------- equipe: férias (CLT simplificada)
  // a cada 12 meses de casa nasce um período; cada férias registrada usa um período (o mais antigo)
  C.ferias = (func, priv) => {
    if (!func.admissao || !func.ativo) return null;
    const meses = Math.floor(U.dias(func.admissao, hoje()) / 30.4375);
    const completos = Math.floor(meses / 12);
    const tiradas = (priv?.ferias || []).length;
    const pendentes = completos - tiradas;
    if (pendentes <= 0) {
      const prox = U.somaMeses(func.admissao, 12 * (completos + 1));
      return { pendentes: 0, direitoEm: prox, limite: null };
    }
    // o período mais antigo não tirado vence 12 meses depois de completado
    const limite = U.somaMeses(func.admissao, 12 * (tiradas + 2));
    return { pendentes, direitoEm: null, limite, vencida: limite < hoje(), diasParaVencer: U.dias(hoje(), limite) };
  };

  // ---------------- alertas (Início e sininho)
  C.alertas = () => {
    const P = Perm, a = [];
    const add = (nivel, txt, rota, n) => a.push({ nivel, txt, rota, n });
    if (P.pode('compras')) {
      const lc = C.listaCompras().filter(x => !x.jaPedido);
      if (lc.length) add('alto', `${U.plural(lc.length, 'peça')} abaixo do mínimo para comprar`, '#/compras/lista', lc.length);
      const peds = S.lista('pedidos_compra').filter(p => p.status === 'aguardando');
      const atr = peds.filter(p => p.prazo && p.prazo < hoje());
      if (atr.length) add('alto', `${U.plural(atr.length, 'pedido')} de compra ${atr.length === 1 ? 'atrasado' : 'atrasados'}`, '#/compras?f=atrasado', atr.length);
      const hj = peds.filter(p => p.prazo === hoje());
      if (hj.length) add('medio', `${U.plural(hj.length, 'pedido')} para chegar hoje`, '#/compras?f=hoje', hj.length);
    }
    if (P.pode('financeiro')) {
      const ab = S.lista('lancamentos').filter(l => !l.pago_em);
      const venc = ab.filter(l => l.vencimento < hoje());
      const vp = venc.filter(l => l.tipo === 'pagar'), vr = venc.filter(l => l.tipo === 'receber');
      if (vp.length) add('alto', `${U.plural(vp.length, 'conta')} a pagar vencida${vp.length > 1 ? 's' : ''} (${U.moeda(U.soma(vp, 'valor'))})`, '#/financeiro?f=vencida&t=pagar', vp.length);
      if (vr.length) add('alto', `${U.plural(vr.length, 'conta')} a receber atrasada${vr.length > 1 ? 's' : ''} (${U.moeda(U.soma(vr, 'valor'))})`, '#/financeiro?f=vencida&t=receber', vr.length);
      const hj = ab.filter(l => l.vencimento === hoje());
      if (hj.length) add('medio', `${U.plural(hj.length, 'conta')} vence${hj.length > 1 ? 'm' : ''} hoje (${U.moeda(U.soma(hj, 'valor'))})`, '#/financeiro?f=hoje', hj.length);
      const semConta = S.lista('pedidos_compra').filter(p => p.status === 'recebido' && p.recebido_em >= U.somaDias(hoje(), -60) && p.obs !== 'Importado da planilha'
        && !S.lista('lancamentos').some(l => l.pedido_id === p.id) && C.totalPedido(p) > 0);
      if (semConta.length) add('baixo', `${U.plural(semConta.length, 'pedido')} recebido${semConta.length > 1 ? 's' : ''} sem conta a pagar lançada`, '#/compras?f=semconta', semConta.length);
    }
    const ords = S.lista('ordens').filter(o => ['fila', 'producao'].includes(o.status));
    const oatr = ords.filter(o => o.prazo && o.prazo < hoje());
    if (oatr.length) add('alto', `${U.plural(oatr.length, 'ordem', 'ordens')} de produção ${oatr.length === 1 ? 'atrasada' : 'atrasadas'}`, '#/producao', oatr.length);
    const mab = S.lista('manutencoes').filter(m => m.status !== 'concluida' && m.tipo === 'corretiva');
    if (mab.length) add('alto', `${U.plural(mab.length, 'máquina')} com problema aberto`, '#/maquinas?f=problema', mab.length);
    const prev = S.lista('maquinas').filter(m => m.ativo && ['prevvencida'].includes(C.situacaoMaquina(m).cod));
    if (prev.length) add('medio', `${U.plural(prev.length, 'máquina')} com preventiva vencida`, '#/maquinas?f=preventiva', prev.length);
    if (P.pode('compras')) {
      const venc = S.lista('fornecedores').filter(f => f.ativo && f.qualif_validade && f.qualif_validade < hoje());
      if (venc.length) add('baixo', `${U.plural(venc.length, 'fornecedor', 'fornecedores')} com qualificação vencida`, '#/fornecedores?f=qualif', venc.length);
    }
    if (P.pode('salarios')) {
      let n = 0;
      for (const f of S.lista('funcionarios')) { const fe = C.ferias(f, S.get('funcionarios_privado', f.id)); if (fe && fe.limite && fe.diasParaVencer <= 60) n++; }
      if (n) add('medio', `${U.plural(n, 'funcionário')} com férias para vencer (até 60 dias)`, '#/equipe?f=ferias', n);
    }
    if (P.pode('importar') && API.modo === 'nuvem') {
      let ult = null; try { ult = localStorage.getItem('jaf.ultimaCopia'); } catch (e) {}
      const dias = ult ? U.dias(ult, hoje()) : null;
      if (dias === null || dias > 7) add('baixo', dias === null ? 'Baixe a primeira cópia de segurança dos dados' : `Faz ${dias} dias que não baixa a cópia de segurança`, '#/admin?aba=copia', 1);
    }
    const ordem = { alto: 0, medio: 1, baixo: 2 };
    return a.sort((x, y) => ordem[x.nivel] - ordem[y.nivel]);
  };

  return C;
})();
