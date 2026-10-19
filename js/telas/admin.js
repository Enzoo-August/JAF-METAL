/* Administração: acessos, empresa, importar planilha, cópia dos dados, histórico */
'use strict';

Telas.admin = (() => {
  const esc = U.esc;
  let aba = 'acessos';
  const DESC_PERFIL = {
    dono: 'Tudo, inclusive acessos, importação e histórico de alterações.',
    escritorio: 'Tudo do dia a dia: financeiro, salários, compras, estoque e produção. Não cria acessos.',
    almoxarife: 'Estoque, compras, fornecedores, máquinas e ordens. Não vê financeiro nem salários.',
    producao: 'Retirar peça, ver estoque (sem preços), ordens de produção e chamados de máquina.',
  };

  function render(r) {
    if (r?.q?.get('aba')) aba = r.q.get('aba');
    const abas = [['acessos', 'Acessos', 'acessos'], ['empresa', 'Empresa', 'config'], ['importar', 'Importar planilha', 'importar'], ['copia', 'Cópia dos dados', 'config'], ['historico', 'Histórico de alterações', 'auditoria']]
      .filter(([, , p]) => Perm.pode(p));
    if (!abas.some(([k]) => k === aba)) aba = abas[0][0];
    const corpo = { acessos: rAcessos, empresa: rEmpresa, importar: rImportar, copia: rCopia, historico: rHistorico }[aba]();
    return `${UI.cab('Administração')}<nav class="abas-tela">${abas.map(([k, t]) => `<button type="button" data-aba="${k}" class="${k === aba ? 'on' : ''}">${t}</button>`).join('')}</nav>${corpo}`;
  }

  // ---------------------------------------------------------------- acessos
  function rAcessos() {
    const ps = U.ordenar(S.lista('perfis'), p => (p.ativo ? '0' : '1') + U.sem(p.nome));
    return `<div class="card-cab"><p class="sub" style="margin:0">Cada pessoa entra com o próprio usuário e senha. O que cada perfil vê é controlado pelo banco de dados (não dá para burlar pelo navegador).</p>
        ${UI.btn('Novo acesso', 'data-ac="novo"', 'pri', 'mais')}</div>
      <div class="lista">${ps.map(p => `<div class="linha clicavel" data-acesso="${p.user_id}"><span class="avatar">${esc(p.nome.charAt(0).toUpperCase())}</span>
        <div class="meio"><b>${esc(p.nome)} ${!p.ativo ? '<span class="tag t-cinza">desativado</span>' : ''}${p.trocar_senha ? ' <span class="tag t-amarelo">senha provisória</span>' : ''}</b><small>usuário <b>${esc(p.login)}</b> · ${Perm.nome(p.perfil)}${p.funcionario_id ? ' · ' + esc(S.get('funcionarios', p.funcionario_id)?.nome || '') : ''}</small></div>
        <div class="lado">${p.user_id === API.sessao.uid ? '<span class="tag t-azul">você</span>' : ''}</div></div>`).join('')}</div>
      <section class="card mt"><h2>O que cada perfil faz</h2><div class="mt">${UI.dl(Object.entries(DESC_PERFIL).map(([k, v]) => [Perm.nome(k), esc(v)]))}</div></section>`;
  }

  async function formAcesso(p) {
    const novo = !p;
    await UI.modal({
      titulo: novo ? 'Novo acesso' : 'Acesso de ' + p.nome,
      corpo: `${UI.campo({ nome: 'nome', rotulo: 'Nome', valor: p?.nome, req: true })}
        ${novo ? UI.campo({ nome: 'login', rotulo: 'Usuário (para entrar)', req: true, ajuda: 'Letras minúsculas, números, ponto ou traço. Ex.: jose.almox', attrs: 'autocapitalize="none" spellcheck="false"' }) : `<p class="sub">Usuário: <b>${esc(p.login)}</b></p>`}
        <div class="campo"><label>Perfil</label><div class="opcoes" style="flex-direction:column">${Object.keys(DESC_PERFIL).map(k => `<label class="opcao"><input type="radio" name="perfil" value="${k}" ${(p?.perfil || 'producao') === k ? 'checked' : ''}><span><b>${Perm.nome(k)}</b><small>${esc(DESC_PERFIL[k])}</small></span></label>`).join('')}</div></div>
        <div class="campo"><label for="aFunc">É qual funcionário? (opcional)</label><input id="aFunc" name="funcionario_id" placeholder="Liga o acesso à pessoa da equipe"></div>
        ${novo ? `<div class="linha-campos">${UI.campo({ nome: 'senha', rotulo: 'Senha provisória', tipo: 'password', req: true, ajuda: 'Mínimo 8 caracteres. No primeiro acesso a pessoa cria a própria senha.', auto: 'new-password' })}${UI.campo({ nome: 'senha2', rotulo: 'Repita a senha', tipo: 'password', req: true, auto: 'new-password' })}</div>`
          : UI.campo({ nome: 'ativo', rotulo: 'Acesso ativo (desmarque para bloquear a entrada)', tipo: 'check', valor: p.ativo })}
        ${!novo ? `<button type="button" class="btn fantasma mini" data-x="senha">${UI.ic('cadeado')}<span>Trocar a senha</span></button>` : ''}`,
      aoAbrir: (el, j) => {
        UI.comboFuncionario(el.querySelector('#aFunc'), { valorInicial: S.get('funcionarios', p?.funcionario_id) });
        el.querySelector('[data-x="senha"]')?.addEventListener('click', () => { delete j.form.dataset.sujo; j.fechar(); trocarSenha(p.user_id, p.nome); });
      },
      botoes: [{ txt: novo ? 'Criar acesso' : 'Salvar', acao: async (f) => {
        const d = UI.lerForm(f);
        if (novo) {
          if (d.senha !== d.senha2) throw new API.ErroApp('As duas senhas não são iguais.');
          await API.rpc('criar_acesso', { p_login: d.login, p_senha: d.senha, p_nome: d.nome, p_perfil: d.perfil, p_func: d.funcionario_id || null });
          UI.aviso(`Acesso criado. Usuário: ${d.login.trim().toLowerCase()}`);
        } else {
          await API.rpc('editar_acesso', { p_user: p.user_id, p_nome: d.nome, p_perfil: d.perfil, p_ativo: d.ativo, p_func: d.funcionario_id || null });
          UI.aviso('Acesso salvo.');
        }
        await App.gravou(['perfis']);
        if (!novo && p.user_id === API.sessao.uid) setTimeout(() => location.reload(), 800); // mudou o próprio perfil: recarrega o menu
      } }],
    });
  }

  async function trocarSenha(uid, nome) {
    await UI.modal({
      titulo: 'Nova senha' + (nome ? ' — ' + nome : ''),
      corpo: `${uid !== API.sessao.uid ? '<p class="nota">A senha que você definir é <b>provisória</b>: no próximo acesso a pessoa cria a própria senha.</p>' : ''}
        ${UI.campo({ nome: 'senha', rotulo: 'Nova senha', tipo: 'password', req: true, ajuda: 'Mínimo 8 caracteres. Evite datas e nomes.', auto: 'new-password' })}
        ${UI.campo({ nome: 'senha2', rotulo: 'Repita a nova senha', tipo: 'password', req: true, auto: 'new-password' })}`,
      botoes: [{ txt: 'Trocar senha', acao: async (f) => {
        const d = UI.lerForm(f);
        if (d.senha !== d.senha2) throw new API.ErroApp('As duas senhas não são iguais.');
        await API.rpc('trocar_senha', { p_user: uid, p_senha: d.senha });
        if (uid !== API.sessao.uid) await App.gravou(['perfis']);
        UI.aviso('Senha trocada.');
      } }],
    });
  }

  // ---------------------------------------------------------------- empresa e categorias
  function rEmpresa() {
    const e = S.cfg('empresa', {}), cats = C.categorias();
    return `<form id="fEmp" class="card" novalidate><h2>Dados da empresa</h2><p class="sub">Aparecem no cabeçalho do pedido de compra em PDF e dos relatórios.</p>
        <div class="linha-campos">${UI.campo({ nome: 'nome', rotulo: 'Nome', valor: e.nome || 'JAF Metal' })}${UI.campo({ nome: 'razao', rotulo: 'Razão social', valor: e.razao })}</div>
        <div class="linha-campos">${UI.campo({ nome: 'cnpj', rotulo: 'CNPJ', valor: e.cnpj })}${UI.campo({ nome: 'ie', rotulo: 'Inscrição estadual', valor: e.ie })}</div>
        <div class="linha-campos">${UI.campo({ nome: 'cep', rotulo: 'CEP', valor: e.cep })}${UI.campo({ nome: 'endereco', rotulo: 'Endereço', valor: e.endereco })}</div>
        <div class="linha-campos">${UI.campo({ nome: 'bairro', rotulo: 'Bairro', valor: e.bairro })}${UI.campo({ nome: 'cidade', rotulo: 'Cidade', valor: e.cidade })}${UI.campo({ nome: 'uf', rotulo: 'UF', valor: e.uf, attrs: 'maxlength="2"' })}</div>
        <div class="linha-campos">${UI.campo({ nome: 'telefone', rotulo: 'Telefone', valor: e.telefone })}${UI.campo({ nome: 'email', rotulo: 'E-mail', valor: e.email })}</div>
        <button type="button" class="btn pri" data-salvar="empresa">${UI.ic('ok')}<span>Salvar dados da empresa</span></button></form>
      <form id="fCat" class="card mt" novalidate><h2>Categorias do financeiro</h2><p class="sub">Uma por linha.</p>
        <div class="linha-campos">${UI.campo({ nome: 'pagar', rotulo: 'Despesas (a pagar)', tipo: 'area', linhas: 10, valor: cats.pagar.join('\n') })}${UI.campo({ nome: 'receber', rotulo: 'Receitas (a receber)', tipo: 'area', linhas: 10, valor: cats.receber.join('\n') })}</div>
        <button type="button" class="btn pri" data-salvar="categorias">${UI.ic('ok')}<span>Salvar categorias</span></button></form>`;
  }

  // ---------------------------------------------------------------- importar planilha
  function rImportar() {
    const tem = S.lista('pecas').length;
    return `<section class="card"><h2>Importar a planilha Almoxarifado</h2>
        <p>Traz para o sistema as abas <b>Fornecedores</b>, <b>Peças</b>, <b>Estoque</b> (todas as entradas e saídas) e <b>Controle de Pedidos</b>. As abas de relatório (Consumo Anual, Análise de Custos, Lista de Compras) não precisam: o sistema calcula sozinho.</p>
        <ol class="passos"><li><span>Escolha o arquivo <b>Almoxarifado.xlsm</b> (ou .xlsx).</span></li><li><span>O sistema confere tudo e mostra um resumo — nada é gravado ainda.</span></li><li><span>Se estiver certo, confirme a importação.</span></li></ol>
        ${tem ? `<p class="nota amarela mt">Já existem ${U.plural(tem, 'peça')} no sistema. Importar de novo <b>substitui</b> todo o almoxarifado (peças, movimentações, pedidos de compra e fornecedores sem uso). Financeiro, máquinas, equipe e produção não são apagados. Use isso enquanto a planilha ainda for usada em paralelo; depois que o sistema virar o oficial, não importe mais.</p>` : ''}
        <label class="btn pri mt" style="cursor:pointer">${UI.ic('enviar')}<span>Escolher a planilha</span><input type="file" id="arqPlan" accept=".xlsm,.xlsx,.xls" hidden></label>
        <p class="sub mt">O arquivo é lido aqui no seu aparelho e só os dados vão para o banco.</p></section>
      <div id="resImport"></div>`;
  }

  async function lerPlanilha(arq) {
    await U.lib('xlsx');
    const wb = XLSX.read(await arq.arrayBuffer(), { cellDates: true });
    return Importar.ler(wb, arq.name);
  }
  const PARECE_MAQUINA = Importar.PARECE_MAQUINA;
  const casarFornecedor = Importar.casarFornecedor;

  function resumoImport(r) {
    const casados = [...r.mapa.entries()].filter(([n, f]) => n !== f || r.cadastro.some(c => r.fornecedores.find(x => x.nome === f && x.razao)));
    const valor = U.soma(r.movs, m => (m.tipo === 'entrada' ? 1 : -1) * m.qtd * m.preco_unit);
    const aguard = r.pedidos.filter(p => p.status === 'aguardando');
    return `<section class="card mt"><h2>Conferência: ${esc(r.arquivo)}</h2>
      <div class="grade g4 mt"><div class="kpi"><small>Fornecedores</small><b>${r.fornecedores.length}</b><span>${r.novos.length} criados de nomes das abas</span></div>
        <div class="kpi"><small>Peças</small><b>${r.pecas.length}</b></div><div class="kpi"><small>Movimentações</small><b>${r.movs.length}</b><span>${r.movs[0]?.data ? U.data(r.movs.reduce((a, m) => m.data < a ? m.data : a, r.movs[0].data)) + ' a ' + U.data(r.movs.reduce((a, m) => m.data > a ? m.data : a, r.movs[0].data)) : ''}</span></div>
        <div class="kpi"><small>Pedidos de compra</small><b>${r.pedidos.length}</b><span>${aguard.length} aguardando</span></div></div>
      ${r.diverg.length ? `<p class="nota vermelha mt">${U.plural(r.diverg.length, 'peça')} com estoque diferente entre a aba Peças e a soma da aba Estoque: ${r.diverg.slice(0, 10).map(p => esc(p.codigo)).join(', ')}. O sistema usa a soma das movimentações.</p>`
        : `<p class="nota verde mt">${UI.ic('ok')} O estoque de todas as peças bate com a soma das entradas e saídas da planilha. Saldo em valor pelas linhas da planilha: <b>${U.moeda(valor)}</b>.</p>`}
      ${r.avisos.length ? `<div class="nota amarela mt"><b>Atenção</b><ul style="margin:6px 0 0;padding-left:18px">${r.avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
      ${r.ignoradas.length ? `<details class="duvida mt"><summary>${U.plural(r.ignoradas.length, 'linha ignorada', 'linhas ignoradas')}</summary><ul>${r.ignoradas.map(a => `<li>${esc(a)}</li>`).join('')}</ul></details>` : ''}
      <details class="duvida mt" ${casados.length ? 'open' : ''}><summary>Como os nomes de fornecedor foram ligados ao cadastro</summary>
        <p class="sub">Nas abas Peças e Estoque o fornecedor aparece com nome curto; no cadastro, com nome completo. O nome curto vira o "nome" e o completo vira a "razão social".</p>
        <div class="tabela-caixa"><table class="tabela"><thead><tr><th>Nas abas</th><th>No cadastro</th></tr></thead><tbody>
        ${[...r.mapa.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')).map(([n, fin]) => { const f = r.fornecedores.find(x => x.nome === fin); return `<tr><td>${esc(n)}</td><td>${f?.razao ? esc(f.razao) : r.novos.includes(n) ? '<span class="fraco">não estava no cadastro (novo)</span>' : esc(fin)}</td></tr>`; }).join('')}</tbody></table></div></details>
      <details class="duvida mt" open><summary>Máquinas a cadastrar (da coluna "Utilização")</summary>
        <p class="sub">Marque o que é máquina de verdade. Dispositivos e códigos de produto (DP…, LA…) podem ficar só como texto na peça.</p>
        <div class="grade g-auto">${r.utils.map(u => UI.campo({ nome: 'maq_' + u, rotulo: u, tipo: 'check', valor: Importar.sugerirMaquina(u) })).join('')}</div></details>
      <div class="grupo-btn mt"><button type="button" class="btn pri" data-imp="confirmar">${UI.ic('ok')}<span>Importar agora</span></button><button type="button" class="btn fantasma" data-imp="cancelar">Cancelar</button></div></section>`;
  }

  async function confirmarImport(el, r) {
    const tem = S.lista('pecas').length;
    if (tem) {
      const ok = await UI.modal({ titulo: 'Substituir o almoxarifado?', corpo: `<p>Isto apaga as ${U.plural(tem, 'peça')}, movimentações e pedidos de compra atuais e coloca os da planilha.</p>${UI.campo({ nome: 'conf', rotulo: 'Digite SUBSTITUIR para confirmar', req: true })}`,
        botoes: [{ txt: 'Substituir', cls: 'perigo', acao: (f) => { if (UI.lerForm(f).conf.toUpperCase() !== 'SUBSTITUIR') throw new API.ErroApp('Digite SUBSTITUIR.'); return true; } }] });
      if (!ok) return;
    }
    const maquinas = [...el.querySelectorAll('[name^="maq_"]')].filter(c => c.checked).map(c => ({ nome: c.name.slice(4) }));
    const btn = el.querySelector('[data-imp="confirmar"]');
    await UI.ocupado(btn, async () => {
      try {
        const res = await API.rpc('importar_planilha', { p: { fornecedores: r.fornecedores, pecas: r.pecas, maquinas, movimentos: r.movs, pedidos: r.pedidos }, p_substituir: !!tem });
        await S.carregar();
        // conferência final: estoque do banco = soma da planilha
        const dif = S.lista('pecas').filter(p => r.saldo.has(U.sem(p.codigo)) && Math.abs(p.estoque - r.saldo.get(U.sem(p.codigo))) > 1e-9);
        el.querySelector('#resImport').innerHTML = `<section class="card mt"><h2>${UI.ic('ok')} Importação concluída</h2>
          <p>${res.fornecedores} fornecedores, ${res.pecas} peças, ${res.movimentos} movimentações, ${res.pedidos} pedidos de compra e ${res.maquinas} máquinas.</p>
          ${dif.length ? `<p class="nota vermelha">Atenção: ${dif.length} peças ficaram com estoque diferente da planilha: ${dif.map(p => esc(p.codigo)).join(', ')}</p>` : `<p class="nota verde">Conferido: o estoque de cada peça no sistema é igual ao da planilha.</p>`}
          ${res.sem_peca?.length ? `<p class="nota amarela">Linhas sem peça cadastrada: ${res.sem_peca.length}</p>` : ''}
          <div class="grupo-btn mt"><a class="btn pri" href="#/pecas">Ver o estoque</a><a class="btn sec" href="#/compras/lista">Lista de compras</a></div></section>`;
        UI.aviso('Planilha importada.');
      } catch (e) { UI.erro(e); }
    });
  }

  // ---------------------------------------------------------------- cópia dos dados
  function rCopia() {
    let ult = null; try { ult = localStorage.getItem('jaf.ultimaCopia'); } catch (e) {}
    return `<section class="card"><h2>Cópia de segurança</h2>
      <p>Baixa um Excel com <b>todos</b> os dados (no mesmo formato da planilha antiga nas abas do almoxarifado). Guarde no computador ou no Google Drive.</p>
      <p class="nota ${!ult || U.dias(ult, U.hoje()) > 7 ? 'amarela' : 'verde'}">${ult ? `Última cópia baixada neste aparelho: ${U.data(ult)} (${U.relativo(ult)}).` : 'Nenhuma cópia baixada neste aparelho ainda.'} Recomendado: uma por semana.</p>
      <p class="sub">Por que: o plano grátis do banco não guarda cópias automáticas. Se algo for apagado por engano, é esta cópia que salva.</p>
      <button type="button" class="btn pri mt" data-copia>${UI.ic('baixar')}<span>Baixar cópia completa (Excel)</span></button></section>`;
  }

  async function baixarCopia(btn) {
    await UI.ocupado(btn, async () => {
      try {
        await S.carregar();
        await U.lib('xlsx');
        const wb = XLSX.utils.book_new();
        const add = (nome, linhas) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas.length ? linhas : [{ '': 'vazio' }], { cellDates: true }), nome);
        const fn = (id) => S.get('fornecedores', id)?.nome || '';
        add('Fornecedores', S.lista('fornecedores').map(f => ({ 'FORNECEDOR': f.nome, 'RAZÃO SOCIAL': f.razao, 'TIPO': f.tipo, 'CONTATO': f.contato, 'Contato 2': f.contato2, 'TELEFONE': f.telefone, 'CELULAR': f.celular,
          'ENDEREÇO': f.endereco, 'BAIRRO': f.bairro, 'CIDADE': f.cidade, 'UF': f.uf, 'CEP': f.cep, 'CNPJ': f.cnpj, 'I.E.': f.ie, 'APROV.': f.qualificacao, 'MÉTODO': f.qualif_metodo,
          'VALIDADE': f.qualif_validade ? U.d(f.qualif_validade) : null, 'EMAIL': f.email, 'SITE': f.site, 'OBSERVAÇÕES': f.obs, 'ATIVO': f.ativo ? 'sim' : 'não' })));
        add('Peças', S.lista('pecas').map(p => ({ 'Código': p.codigo, 'Descrição': p.descricao, 'Utilização': p.utilizacao, 'Fornecedor': fn(p.fornecedor_id), 'Estoque Min.': p.est_min,
          'Estoque Máx.': p.est_max, 'Qde Estoque': p.estoque, 'Status': C.situacao(p).txt, 'Unidade': p.unidade, 'Local': p.local, 'Obs.': p.obs, 'Ativa': p.ativo ? 'sim' : 'não' })));
        add('Estoque', S.lista('movimentos').map(m => { const p = S.get('pecas', m.peca_id) || {}, e = m.tipo === 'entrada';
          return { 'Data': U.d(m.data), 'Código': p.codigo, 'Descrição': p.descricao, 'Entrada': e ? m.qtd : null, 'Saída': e ? null : m.qtd, 'Saldo': e ? m.qtd : -m.qtd, 'Fornecedor': fn(m.fornecedor_id),
            'Documento': m.documento, 'R$ Unitário': m.preco_unit, 'Total Entrada (R$)': e ? U.r2(m.qtd * m.preco_unit) : 0, 'Total Saída (R$)': e ? 0 : U.r2(m.qtd * m.preco_unit),
            'Saldo (R$)': U.r2((e ? 1 : -1) * m.qtd * m.preco_unit), 'Ano': Number(m.data.slice(0, 4)), 'Mês': Number(m.data.slice(5, 7)), 'Tipo': Telas.movimentos.MOTIVO[m.motivo],
            'Quem retirou': S.get('funcionarios', m.funcionario_id)?.nome || '', 'Máquina': S.get('maquinas', m.maquina_id)?.nome || m.destino || '', 'Obs.': m.obs, 'Lançado em': U.dataHora(m.criado_em), 'Lançado por': S.nomeUsuario(m.criado_por) }; }));
        add('Controle de Pedidos', S.lista('pedido_itens').map(i => { const ped = S.get('pedidos_compra', i.pedido_id) || {}, p = S.get('pecas', i.peca_id) || {};
          return { 'Nº': ped.numero, 'Data': U.d(ped.data), 'Código': p.codigo, 'Descrição': p.descricao, 'Qde': i.qtd, 'Chegou': i.recebido, 'Fornecedor': fn(ped.fornecedor_id), 'Documento': ped.documento,
            'Valor': i.valor, 'Prazo': ped.prazo ? U.d(ped.prazo) : null, 'Status': ped.status === 'recebido' ? 'Entregue' : ped.status === 'cancelado' ? 'Cancelado' : 'Aguardando', 'Frete do pedido': ped.frete }; }));
        add('Máquinas', S.lista('maquinas').map(m => ({ 'Nome': m.nome, 'Tipo': m.tipo, 'Fabricante': m.fabricante, 'Modelo': m.modelo, 'Nº série': m.numero_serie, 'Setor': m.setor, 'Ano': m.ano, 'Preventiva (dias)': m.preventiva_dias, 'Ativa': m.ativo ? 'sim' : 'não' })));
        add('Manutenções', S.lista('manutencoes').map(m => ({ 'Data': U.d(m.data), 'Máquina': S.get('maquinas', m.maquina_id)?.nome, 'Tipo': m.tipo, 'Situação': m.status, 'Problema': m.problema, 'Solução': m.solucao,
          'Técnico de fora': fn(m.fornecedor_id), 'Da equipe': S.get('funcionarios', m.funcionario_id)?.nome, 'Custo serviço': m.custo_servico, 'Horas parada': m.horas_parada, 'Concluída em': m.concluida_em ? U.d(m.concluida_em) : null })));
        add('Ordens de produção', S.lista('ordens').map(o => ({ 'OP': o.numero, 'Cliente': o.cliente_nome, 'Pedido do cliente': o.pedido_cliente, 'Produto': o.produto, 'Código': o.codigo, 'Qtd': o.qtd, 'Produzido': o.produzido,
          'Unidade': o.unidade, 'Prazo': o.prazo ? U.d(o.prazo) : null, 'Situação': o.status, 'Máquina': S.get('maquinas', o.maquina_id)?.nome, 'Responsável': S.get('funcionarios', o.responsavel_id)?.nome, 'Entregue em': o.entregue_em ? U.d(o.entregue_em) : null, 'Obs.': o.obs })));
        if (Perm.pode('financeiro')) {
          add('Contas', S.lista('lancamentos').map(l => ({ 'Tipo': l.tipo === 'pagar' ? 'A pagar' : 'A receber', 'Descrição': l.descricao, 'Categoria': l.categoria, 'Valor': l.valor, 'Vencimento': U.d(l.vencimento),
            'Pago em': l.pago_em ? U.d(l.pago_em) : null, 'Valor pago': l.valor_pago, 'Forma': l.forma, 'Fornecedor': fn(l.fornecedor_id), 'Cliente': S.get('clientes', l.cliente_id)?.nome, 'Parcela': l.parcela, 'Documento': l.documento, 'Obs.': l.obs })));
          add('Clientes', S.lista('clientes').map(c => ({ 'Nome': c.nome, 'Razão social': c.razao, 'CNPJ': c.cnpj, 'Contato': c.contato, 'Telefone': c.telefone, 'E-mail': c.email, 'Cidade': c.cidade, 'UF': c.uf, 'Obs.': c.obs })));
        }
        add('Equipe', S.lista('funcionarios').map(f => { const p = Perm.pode('salarios') ? (S.get('funcionarios_privado', f.id) || {}) : {};
          return { 'Nome': f.nome, 'Função': f.funcao, 'Setor': f.setor, 'Telefone': f.telefone, 'Admissão': f.admissao ? U.d(f.admissao) : null, 'Ativo': f.ativo ? 'sim' : 'não',
            ...(Perm.pode('salarios') ? { 'Salário': p.salario, 'Nascimento': p.nascimento ? U.d(p.nascimento) : null, 'CPF': p.cpf, 'RG': p.rg, 'Pix': p.pix, 'Endereço': p.endereco, 'Férias': (p.ferias || []).map(x => U.data(x.inicio) + '–' + U.data(x.fim)).join('; ') } : {}) }; }));
        const blob = new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellDates: true })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        await PDF.entregar(blob, `JAF Metal - copia dos dados ${U.hoje()}.xlsx`);
        try { localStorage.setItem('jaf.ultimaCopia', U.hoje()); } catch (e) {}
        App.render();
      } catch (e) { UI.erro(e); }
    });
  }

  // ---------------------------------------------------------------- histórico de alterações
  const TAB = { pecas: 'Peça', fornecedores: 'Fornecedor', movimentos: 'Movimentação', pedidos_compra: 'Pedido de compra', pedido_itens: 'Item de pedido', maquinas: 'Máquina',
    manutencoes: 'Manutenção', ordens: 'Ordem de produção', lancamentos: 'Conta', funcionarios: 'Funcionário', funcionarios_privado: 'Dados pessoais', clientes: 'Cliente',
    config: 'Configuração', perfis: 'Acesso', importacao: 'Importação da planilha' };
  const ACAO = { insert: 'criou', update: 'alterou', delete: 'apagou', importar: 'importou' };
  let hist = null;
  function rHistorico() {
    if (!hist) { setTimeout(carregarHist, 0); return '<p class="sub">Carregando…</p>'; }
    const nomeReg = (h) => { const d = h.depois || h.antes || {}; return d.codigo || d.nome || d.descricao || d.produto || d.problema || (d.numero ? 'nº ' + d.numero : '') || d.chave || ''; };
    return `<p class="sub">As últimas ${hist.length} alterações. Toque para ver o que mudou.</p>
      <div class="lista">${hist.map((h, n) => `<div class="linha clicavel" data-hist="${n}"><div class="meio"><b>${esc(h.quem || 'Sistema')} ${ACAO[h.acao] || h.acao} ${esc((TAB[h.tabela] || h.tabela).toLowerCase())} ${esc(String(nomeReg(h)).slice(0, 60))}</b>
        <small>${U.dataHora(h.em)}</small></div></div>`).join('')}</div>`;
  }
  async function carregarHist() {
    try {
      hist = await API.ultimos('historico', 300);
    } catch (e) { hist = []; UI.erro(e); }
    App.render();
  }
  function verHist(h) {
    const a = h.antes || {}, d = h.depois || {};
    const campos = [...new Set([...Object.keys(a), ...Object.keys(d)])].filter(k => !['atualizado_em', 'criado_em', 'id', 'seq'].includes(k) && JSON.stringify(a[k]) !== JSON.stringify(d[k]));
    UI.modal({ titulo: `${TAB[h.tabela] || h.tabela} — ${ACAO[h.acao] || h.acao}`,
      corpo: `<p class="sub">${esc(h.quem || 'Sistema')} · ${U.dataHora(h.em)}</p>
        <div class="tabela-caixa"><table class="tabela"><thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead><tbody>
        ${campos.map(k => `<tr><td class="mono peq">${esc(k)}</td><td class="peq">${esc(JSON.stringify(a[k] ?? '') .replace(/^"|"$/g, ''))}</td><td class="peq">${esc(JSON.stringify(d[k] ?? '').replace(/^"|"$/g, ''))}</td></tr>`).join('') || '<tr><td colspan="3">Sem diferença de campos.</td></tr>'}</tbody></table></div>` });
  }

  // ---------------------------------------------------------------- eventos
  function depois(el) {
    let leitura = null;
    el.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-aba]'); if (a) { aba = a.dataset.aba; if (aba === 'historico') hist = null; App.render(); return; }
      if (e.target.closest('[data-ac="novo"]')) return formAcesso();
      const ac = e.target.closest('[data-acesso]'); if (ac) return formAcesso(S.get('perfis', ac.dataset.acesso));
      const sv = e.target.closest('[data-salvar]');
      if (sv) return UI.ocupado(sv, async () => {
        try {
          if (sv.dataset.salvar === 'empresa') await API.rpc('salvar_config', { p_chave: 'empresa', p_valor: UI.lerForm(el.querySelector('#fEmp')) });
          else { const d = UI.lerForm(el.querySelector('#fCat')); const l = (t) => t.split('\n').map(U.limpa).filter(Boolean);
            await API.rpc('salvar_config', { p_chave: 'categorias', p_valor: { pagar: l(d.pagar), receber: l(d.receber) } }); }
          delete el.dataset.sujo; await App.gravou(['config']); UI.aviso('Salvo.');
        } catch (err) { UI.erro(err); }
      });
      if (e.target.closest('[data-copia]')) return baixarCopia(e.target.closest('[data-copia]'));
      const h = e.target.closest('[data-hist]'); if (h) return verHist(hist[Number(h.dataset.hist)]);
      const imp = e.target.closest('[data-imp]');
      if (imp?.dataset.imp === 'cancelar') { leitura = null; el.querySelector('#resImport').innerHTML = ''; delete el.dataset.sujo; }
      if (imp?.dataset.imp === 'confirmar' && leitura) await confirmarImport(el, leitura);
    });
    el.querySelector('#arqPlan')?.addEventListener('change', async (e) => {
      const arq = e.target.files[0]; if (!arq) return;
      const out = el.querySelector('#resImport');
      out.innerHTML = '<section class="card mt"><div class="giro"></div><p class="sub mt">Lendo e conferindo a planilha…</p></section>';
      try { leitura = await lerPlanilha(arq); out.innerHTML = resumoImport(leitura); }
      catch (err) { leitura = null; out.innerHTML = `<p class="nota vermelha mt">${esc(API.traduzir(err).message)}</p>`; console.error(err); }
      e.target.value = '';
    });
  }

  return { titulo: 'Administração', perm: 'config', render, depois, trocarSenha, lerPlanilha, casarFornecedor };
})();

/* Minha conta: senha, aparência, instalar */
Telas.conta = {
  titulo: 'Minha conta',
  render() {
    const s = API.sessao;
    let tema = 'auto'; try { tema = localStorage.getItem('jaf.tema') || 'auto'; } catch (e) {}
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const instalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    return `${UI.cab('Minha conta')}
      <section class="card"><div style="display:flex;gap:14px;align-items:center"><span class="avatar" style="width:48px;height:48px;font-size:1.2rem">${U.esc(s.nome.charAt(0).toUpperCase())}</span>
        <div><b>${U.esc(s.nome)}</b><div class="sub">usuário <b>${U.esc(s.login)}</b> · ${Perm.nome(s.perfil)}</div></div></div>
        <div class="grupo-btn mt"><button type="button" class="btn sec" data-c="senha">${UI.ic('cadeado')}<span>Trocar minha senha</span></button><button type="button" class="btn fantasma" data-acao="sair">${UI.ic('sair')}<span>Sair</span></button></div></section>
      <section class="card mt"><h2>Aparência</h2><div class="opcoes mt">${[['auto', 'Automática', 'segue o aparelho'], ['claro', 'Clara', ''], ['escuro', 'Escura', 'boa no chão de fábrica']].map(([v, t, d]) =>
        `<label class="opcao"><input type="radio" name="tema" value="${v}" ${tema === v ? 'checked' : ''}><span><b>${t}</b>${d ? `<small>${d}</small>` : ''}</span></label>`).join('')}</div></section>
      <section class="card mt"><h2>${UI.ic('instalar')} Usar como aplicativo</h2>
        ${instalado ? '<p class="nota verde mt">Já está instalado neste aparelho.</p>' : ios
          ? `<ol class="passos mt"><li><span>No Safari, toque em <b>Compartilhar</b> (o quadrado com a seta).</span></li><li><span>Escolha <b>Adicionar à Tela de Início</b>.</span></li><li><span>Pronto: o ícone da JAF aparece junto dos outros apps.</span></li></ol>`
          : `<p class="mt">No Chrome ou Edge: menu <b>⋮</b> → <b>Instalar aplicativo</b> (ou "Adicionar à tela inicial").</p>${App.pedidoInstalar ? '<button type="button" class="btn pri" data-c="instalar">Instalar agora</button>' : ''}`}</section>
      <p class="sub mt">JAF Metal Gestão · versão ${App.versao}${API.modo === 'teste' ? ' · <b>modo teste</b> <button type="button" class="btn fantasma mini" data-c="zerar">Recomeçar a demonstração</button>' : ''}</p>`;
  },
  depois(el) {
    el.addEventListener('change', (e) => { if (e.target.name === 'tema') { try { localStorage.setItem('jaf.tema', e.target.value); } catch (x) {} App.aplicarTema(); delete el.dataset.sujo; } });
    el.addEventListener('click', async (e) => {
      const c = e.target.closest('[data-c]')?.dataset.c;
      if (c === 'senha') Telas.admin.trocarSenha(API.sessao.uid, '');
      if (c === 'instalar' && App.pedidoInstalar) { App.pedidoInstalar.prompt(); App.pedidoInstalar = null; }
      if (c === 'zerar' && await UI.confirmar('Apagar os dados de teste e recomeçar?', { ok: 'Recomeçar', perigo: true })) { await API.zerarTeste(); location.reload(); }
    });
  },
};
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); App.pedidoInstalar = e; });
