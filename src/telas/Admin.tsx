/* Administração: acessos, empresa, importar planilha, cópia dos dados, histórico — e "Minha conta" */
import { useEffect, useRef, useState } from 'react'
import { App } from '../app/controle.tsx'
import { API, ErroApp, traduzir } from '../lib/api.ts'
import { C, S, ultimaCopia } from '../lib/dados.ts'
import { ler as lerPlanilha, sugerirMaquina, type Leitura } from '../lib/importar.ts'
import { Perm } from '../lib/perm.ts'
import type { Historico, PerfilAcesso } from '../lib/tipos.ts'
import * as U from '../lib/util.ts'
import { aviso, erro } from '../ui/avisos.ts'
import { excel, xlsx } from '../ui/arquivos.tsx'
import { Btn, Cab, Campo, Dl } from '../ui/base.tsx'
import { ComboFuncionario } from '../ui/Combo.tsx'
import { useLembrar, type Rota } from '../ui/ganchos.ts'
import { Ic } from '../ui/icones.tsx'
import { confirmar, lerForm, modal, useJanela } from '../ui/janelas.tsx'
import { MOTIVO } from './Movimentos.tsx'

const DESC_PERFIL: Record<string, string> = {
  dono: 'Tudo, inclusive acessos, importação e histórico de alterações.',
  escritorio: 'Tudo do dia a dia: financeiro, salários, compras, estoque e produção. Não cria acessos.',
  almoxarife: 'Estoque, compras, fornecedores, máquinas e ordens. Não vê financeiro nem salários.',
  producao: 'Retirar peça, ver estoque (sem preços), ordens de produção e chamados de máquina.',
}

export function TelaAdmin({ r }: { r: Rota }) {
  const [aba, setAba] = useLembrar('admin.aba', 'acessos')
  useEffect(() => { const q = r.q.get('aba'); if (q) setAba(q) }, [r.hash, r.q, setAba])
  const abas = ([['acessos', 'Acessos', 'acessos'], ['empresa', 'Empresa', 'config'], ['importar', 'Importar planilha', 'importar'], ['copia', 'Cópia dos dados', 'config'], ['historico', 'Histórico de alterações', 'auditoria']] as const)
    .filter(([, , p]) => Perm.pode(p))
  const atual = abas.some(([k]) => k === aba) ? aba : abas[0][0]
  return <>
    <Cab titulo="Administração" />
    <nav className="abas-tela">{abas.map(([k, t]) => <button key={k} type="button" data-aba={k} className={k === atual ? 'on' : ''} onClick={() => setAba(k)}>{t}</button>)}</nav>
    {atual === 'acessos' && <Acessos />}
    {atual === 'empresa' && <Empresa />}
    {atual === 'importar' && <Importar />}
    {atual === 'copia' && <Copia />}
    {atual === 'historico' && <HistoricoAlt />}
  </>
}

// ---------------------------------------------------------------- acessos
function Acessos() {
  const ps = U.ordenar(S.lista('perfis'), p => (p.ativo ? '0' : '1') + U.sem(p.nome))
  return <>
    <div className="card-cab"><p className="sub" style={{ margin: 0 }}>Cada pessoa entra com o próprio usuário e senha. O que cada perfil vê é controlado pelo banco de dados (não dá para burlar pelo navegador).</p>
      <Btn txt="Novo acesso" icone="mais" cls="pri" data-ac="novo" onClick={() => void formAcesso()} /></div>
    <div className="lista">{ps.map(p => <div key={p.user_id} className="linha clicavel" data-acesso={p.user_id} onClick={() => void formAcesso(p)}><span className="avatar">{p.nome.charAt(0).toUpperCase()}</span>
      <div className="meio"><b>{p.nome} {!p.ativo && <span className="tag t-cinza">desativado</span>}{p.trocar_senha && <> <span className="tag t-amarelo">senha provisória</span></>}</b>
        <small>usuário <b>{p.login}</b> · {Perm.nome(p.perfil)}{p.funcionario_id ? ' · ' + (S.get('funcionarios', p.funcionario_id)?.nome || '') : ''}</small></div>
      <div className="lado">{p.user_id === API.sessao?.uid && <span className="tag t-azul">você</span>}</div></div>)}</div>
    <section className="card mt"><h2>O que cada perfil faz</h2><div className="mt"><Dl pares={Object.entries(DESC_PERFIL).map(([k, v]) => [Perm.nome(k), v])} /></div></section>
  </>
}

async function formAcesso(p?: PerfilAcesso | null) {
  const novo = !p
  await modal({
    titulo: novo ? 'Novo acesso' : 'Acesso de ' + p!.nome,
    corpo: <CorpoAcesso p={p || null} />,
    botoes: [{ txt: novo ? 'Criar acesso' : 'Salvar', acao: async (f) => {
      const d = lerForm(f)
      if (novo) {
        if (d.senha !== d.senha2) throw new ErroApp('As duas senhas não são iguais.')
        await API.rpc('criar_acesso', { p_login: d.login, p_senha: d.senha, p_nome: d.nome, p_perfil: d.perfil, p_func: d.funcionario_id || null })
        aviso(`Acesso criado. Usuário: ${String(d.login).trim().toLowerCase()}`)
      } else {
        await API.rpc('editar_acesso', { p_user: p!.user_id, p_nome: d.nome, p_perfil: d.perfil, p_ativo: d.ativo, p_func: d.funcionario_id || null })
        aviso('Acesso salvo.')
      }
      await App.gravou(['perfis'])
      if (!novo && p!.user_id === API.sessao?.uid) setTimeout(() => location.reload(), 800) // mudou o próprio perfil: recarrega o menu
    } }],
  })
}
function CorpoAcesso({ p }: { p: PerfilAcesso | null }) {
  const j = useJanela()
  return <>
    <Campo nome="nome" rotulo="Nome" valor={p?.nome} req />
    {!p ? <Campo nome="login" rotulo="Usuário (para entrar)" req ajuda="Letras minúsculas, números, ponto ou traço. Ex.: jose.almox" attrs={{ autoCapitalize: 'none', spellCheck: false }} />
      : <p className="sub">Usuário: <b>{p.login}</b></p>}
    <div className="campo"><label>Perfil</label><div className="opcoes" style={{ flexDirection: 'column' }}>{Object.keys(DESC_PERFIL).map(k =>
      <label key={k} className="opcao"><input type="radio" name="perfil" value={k} defaultChecked={(p?.perfil || 'producao') === k} /><span><b>{Perm.nome(k)}</b><small>{DESC_PERFIL[k]}</small></span></label>)}</div></div>
    <ComboFuncionario id="aFunc" nome="funcionario_id" rotulo="É qual funcionário? (opcional)" placeholder="Liga o acesso à pessoa da equipe" inicial={S.get('funcionarios', p?.funcionario_id)} />
    {!p ? <div className="linha-campos">
      <Campo nome="senha" rotulo="Senha provisória" tipo="password" req auto="new-password" ajuda="Mínimo 8 caracteres. No primeiro acesso a pessoa cria a própria senha." />
      <Campo nome="senha2" rotulo="Repita a senha" tipo="password" req auto="new-password" /></div>
      : <Campo nome="ativo" rotulo="Acesso ativo (desmarque para bloquear a entrada)" tipo="check" valor={p.ativo} />}
    {p && <button type="button" className="btn fantasma mini" data-x="senha" onClick={() => { j.limparSujo(); j.fechar(); void trocarSenha(p.user_id, p.nome) }}><Ic n="cadeado" /><span>Trocar a senha</span></button>}
  </>
}

export async function trocarSenha(uid: string, nome: string) {
  await modal({
    titulo: 'Nova senha' + (nome ? ' — ' + nome : ''),
    corpo: <>
      {uid !== API.sessao?.uid && <p className="nota">A senha que você definir é <b>provisória</b>: no próximo acesso a pessoa cria a própria senha.</p>}
      <Campo nome="senha" rotulo="Nova senha" tipo="password" req auto="new-password" ajuda="Mínimo 8 caracteres. Evite datas e nomes." />
      <Campo nome="senha2" rotulo="Repita a nova senha" tipo="password" req auto="new-password" />
    </>,
    botoes: [{ txt: 'Trocar senha', acao: async (f) => {
      const d = lerForm(f)
      if (d.senha !== d.senha2) throw new ErroApp('As duas senhas não são iguais.')
      await API.rpc('trocar_senha', { p_user: uid, p_senha: d.senha })
      if (uid !== API.sessao?.uid) await App.gravou(['perfis'])
      aviso('Senha trocada.')
    } }],
  })
}

// ---------------------------------------------------------------- empresa e categorias
function Empresa() {
  const e = S.cfg<Record<string, string>>('empresa', {}), cats = C.categorias()
  const fEmp = useRef<HTMLFormElement>(null), fCat = useRef<HTMLFormElement>(null)
  const salvar = async (chave: 'empresa' | 'categorias') => {
    if (chave === 'empresa') await API.rpc('salvar_config', { p_chave: 'empresa', p_valor: lerForm(fEmp.current!) })
    else { const d = lerForm(fCat.current!); const l = (t: string) => t.split('\n').map(U.limpa).filter(Boolean)
      await API.rpc('salvar_config', { p_chave: 'categorias', p_valor: { pagar: l(d.pagar), receber: l(d.receber) } }) }
    await App.gravou(['config']); aviso('Salvo.')
  }
  return <>
    <form ref={fEmp} id="fEmp" className="card" noValidate onSubmit={(ev) => ev.preventDefault()}><h2>Dados da empresa</h2><p className="sub">Aparecem no cabeçalho do pedido de compra em PDF e dos relatórios.</p>
      <div className="linha-campos"><Campo nome="nome" rotulo="Nome" valor={e.nome || 'JAF Metal'} /><Campo nome="razao" rotulo="Razão social" valor={e.razao} /></div>
      <div className="linha-campos"><Campo nome="cnpj" rotulo="CNPJ" valor={e.cnpj} /><Campo nome="ie" rotulo="Inscrição estadual" valor={e.ie} /></div>
      <div className="linha-campos"><Campo nome="cep" rotulo="CEP" valor={e.cep} /><Campo nome="endereco" rotulo="Endereço" valor={e.endereco} /></div>
      <div className="linha-campos"><Campo nome="bairro" rotulo="Bairro" valor={e.bairro} /><Campo nome="cidade" rotulo="Cidade" valor={e.cidade} /><Campo nome="uf" rotulo="UF" valor={e.uf} attrs={{ maxLength: 2 }} /></div>
      <div className="linha-campos"><Campo nome="telefone" rotulo="Telefone" valor={e.telefone} /><Campo nome="email" rotulo="E-mail" valor={e.email} /></div>
      <Btn txt="Salvar dados da empresa" icone="ok" cls="pri" data-salvar="empresa" onClick={() => salvar('empresa')} /></form>
    <form ref={fCat} id="fCat" className="card mt" noValidate onSubmit={(ev) => ev.preventDefault()}><h2>Categorias do financeiro</h2><p className="sub">Uma por linha.</p>
      <div className="linha-campos"><Campo nome="pagar" rotulo="Despesas (a pagar)" tipo="area" linhas={10} valor={cats.pagar.join('\n')} /><Campo nome="receber" rotulo="Receitas (a receber)" tipo="area" linhas={10} valor={cats.receber.join('\n')} /></div>
      <Btn txt="Salvar categorias" icone="ok" cls="pri" data-salvar="categorias" onClick={() => salvar('categorias')} /></form>
  </>
}

// ---------------------------------------------------------------- importar planilha
function Importar() {
  const tem = S.lista('pecas').length
  const [estado, setEstado] = useState<{ t: 'nada' } | { t: 'lendo' } | { t: 'erro'; msg: string } | { t: 'lida'; r: Leitura } | { t: 'feita'; res: Record<string, number | string[]>; dif: string[] }>({ t: 'nada' })
  const marcadas = useRef<HTMLDivElement>(null)
  const escolher = async (arq: File | undefined) => {
    if (!arq) return
    setEstado({ t: 'lendo' })
    try { const X = await xlsx(); setEstado({ t: 'lida', r: lerPlanilha(X, X.read(await arq.arrayBuffer(), { cellDates: true }), arq.name) }) }
    catch (e) { console.error(e); setEstado({ t: 'erro', msg: traduzir(e).message }) }
  }
  const confirmarImport = async (r: Leitura) => {
    if (tem) {
      const ok = await modal({ titulo: 'Substituir o almoxarifado?', corpo: <><p>Isto apaga as {U.plural(tem, 'peça')}, movimentações e pedidos de compra atuais e coloca os da planilha.</p><Campo nome="conf" rotulo="Digite SUBSTITUIR para confirmar" req /></>,
        botoes: [{ txt: 'Substituir', cls: 'perigo', acao: (f) => { if (String(lerForm(f).conf).toUpperCase() !== 'SUBSTITUIR') throw new ErroApp('Digite SUBSTITUIR.'); return true } }] })
      if (!ok) return
    }
    const maquinas = [...(marcadas.current?.querySelectorAll<HTMLInputElement>('[name^="maq_"]') || [])].filter(c => c.checked).map(c => ({ nome: c.name.slice(4) }))
    const res = await API.rpc<Record<string, number | string[]>>('importar_planilha', { p: { fornecedores: r.fornecedores, pecas: r.pecas, maquinas, movimentos: r.movs, pedidos: r.pedidos }, p_substituir: !!tem })
    await S.carregar()
    // conferência final: estoque do banco = soma da planilha
    const dif = S.lista('pecas').filter(p => r.saldo.has(U.sem(p.codigo)) && Math.abs(p.estoque - r.saldo.get(U.sem(p.codigo))!) > 1e-9).map(p => p.codigo)
    setEstado({ t: 'feita', res, dif })
    aviso('Planilha importada.')
  }
  return <>
    <section className="card"><h2>Importar a planilha Almoxarifado</h2>
      <p>Traz para o sistema as abas <b>Fornecedores</b>, <b>Peças</b>, <b>Estoque</b> (todas as entradas e saídas) e <b>Controle de Pedidos</b> — inclusive contatos e links escondidos, linhas sem quantidade e as anotações da aba oculta de custos. As abas de relatório (Consumo Anual, Análise de Custos, Lista de Compras) não precisam: o sistema calcula sozinho.</p>
      <ol className="passos"><li><span>Escolha o arquivo <b>Almoxarifado.xlsm</b> (ou .xlsx).</span></li><li><span>O sistema confere tudo e mostra um resumo — nada é gravado ainda.</span></li><li><span>Se estiver certo, confirme a importação.</span></li></ol>
      {tem > 0 && <p className="nota amarela mt">Já existem {U.plural(tem, 'peça')} no sistema. Importar de novo <b>substitui</b> todo o almoxarifado (peças, movimentações, pedidos de compra e fornecedores sem uso). Financeiro, máquinas, equipe e produção não são apagados. Use isso enquanto a planilha ainda for usada em paralelo; depois que o sistema virar o oficial, não importe mais.</p>}
      <label className="btn pri mt" style={{ cursor: 'pointer' }}><Ic n="enviar" /><span>Escolher a planilha</span>
        <input type="file" id="arqPlan" accept=".xlsm,.xlsx,.xls" hidden onChange={(e) => { void escolher(e.target.files?.[0]); e.target.value = '' }} /></label>
      <p className="sub mt">O arquivo é lido aqui no seu aparelho e só os dados vão para o banco.</p></section>
    <div id="resImport">
      {estado.t === 'lendo' && <section className="card mt"><div className="giro" /><p className="sub mt">Lendo e conferindo a planilha…</p></section>}
      {estado.t === 'erro' && <p className="nota vermelha mt">{estado.msg}</p>}
      {estado.t === 'lida' && <Resumo r={estado.r} marcadas={marcadas} confirmar={() => confirmarImport(estado.r)} cancelar={() => setEstado({ t: 'nada' })} />}
      {estado.t === 'feita' && <section className="card mt"><h2><Ic n="ok" /> Importação concluída</h2>
        <p>{String(estado.res.fornecedores)} fornecedores, {String(estado.res.pecas)} peças, {String(estado.res.movimentos)} movimentações, {String(estado.res.pedidos)} pedidos de compra e {String(estado.res.maquinas)} máquinas.</p>
        {estado.dif.length ? <p className="nota vermelha">Atenção: {estado.dif.length} peças ficaram com estoque diferente da planilha: {estado.dif.join(', ')}</p> : <p className="nota verde">Conferido: o estoque de cada peça no sistema é igual ao da planilha.</p>}
        {Array.isArray(estado.res.sem_peca) && estado.res.sem_peca.length > 0 && <p className="nota amarela">Linhas sem peça cadastrada: {estado.res.sem_peca.length}</p>}
        <div className="grupo-btn mt"><a className="btn pri" href="#/pecas">Ver o estoque</a><a className="btn sec" href="#/compras/lista">Lista de compras</a></div></section>}
    </div>
  </>
}

function Resumo({ r, marcadas, confirmar: ok, cancelar }: { r: Leitura; marcadas: React.RefObject<HTMLDivElement | null>; confirmar: () => Promise<void>; cancelar: () => void }) {
  const casados = [...r.mapa.entries()].filter(([n, f]) => n !== f || r.cadastro.some(() => r.fornecedores.find(x => x.nome === f && x.razao)))
  const valor = U.soma(r.movs, m => (m.tipo === 'entrada' ? 1 : -1) * m.qtd * m.preco_unit)
  const datas = r.movs.map(m => m.data).filter((x): x is string => !!x).sort()
  return <section className="card mt"><h2>Conferência: {r.arquivo}</h2>
    <div className="grade g4 mt"><div className="kpi"><small>Fornecedores</small><b>{r.fornecedores.length}</b><span>{r.novos.length} criados de nomes das abas</span></div>
      <div className="kpi"><small>Peças</small><b>{r.pecas.length}</b></div><div className="kpi"><small>Movimentações</small><b>{r.movs.length}</b><span>{datas.length ? U.data(datas[0]) + ' a ' + U.data(datas.at(-1)) : ''}</span></div>
      <div className="kpi"><small>Pedidos de compra</small><b>{r.pedidos.length}</b><span>{r.pedidos.filter(p => p.status === 'aguardando').length} aguardando</span></div></div>
    {r.diverg.length ? <p className="nota vermelha mt">{U.plural(r.diverg.length, 'peça')} com estoque diferente entre a aba Peças e a soma da aba Estoque: {r.diverg.slice(0, 10).map(p => p.codigo).join(', ')}. O sistema usa a soma das movimentações.</p>
      : <p className="nota verde mt"><Ic n="ok" /> O estoque de todas as peças bate com a soma das entradas e saídas da planilha. Saldo em valor pelas linhas da planilha: <b>{U.moeda(valor)}</b>.</p>}
    {r.avisos.length > 0 && <div className="nota amarela mt"><b>Atenção</b><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{r.avisos.map(a => <li key={a}>{a}</li>)}</ul></div>}
    {r.ignoradas.length > 0 && <details className="duvida mt"><summary>{U.plural(r.ignoradas.length, 'linha ignorada', 'linhas ignoradas')}</summary><ul>{r.ignoradas.map(a => <li key={a}>{a}</li>)}</ul></details>}
    <details className="duvida mt" open={casados.length > 0}><summary>Como os nomes de fornecedor foram ligados ao cadastro</summary>
      <p className="sub">Nas abas Peças e Estoque o fornecedor aparece com nome curto; no cadastro, com nome completo. O nome curto vira o "nome" e o completo vira a "razão social".</p>
      <div className="tabela-caixa"><table className="tabela"><thead><tr><th>Nas abas</th><th>No cadastro</th></tr></thead><tbody>
        {[...r.mapa.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')).map(([n, fin]) => { const f = r.fornecedores.find(x => x.nome === fin)
          return <tr key={n}><td>{n}</td><td>{f?.razao ? f.razao : r.novos.includes(n) ? <span className="fraco">não estava no cadastro (novo)</span> : fin}</td></tr> })}</tbody></table></div></details>
    <details className="duvida mt" open><summary>Máquinas a cadastrar (da coluna "Utilização")</summary>
      <p className="sub">Marque o que é máquina de verdade. Dispositivos e códigos de produto (DP…, LA…) podem ficar só como texto na peça.</p>
      <div className="grade g-auto" ref={marcadas}>{r.utils.map(u => <Campo key={u} nome={'maq_' + u} rotulo={u} tipo="check" valor={sugerirMaquina(u)} />)}</div></details>
    <div className="grupo-btn mt"><Btn txt="Importar agora" icone="ok" cls="pri" data-imp="confirmar" onClick={() => ok()} /><button type="button" className="btn fantasma" data-imp="cancelar" onClick={cancelar}>Cancelar</button></div>
  </section>
}

// ---------------------------------------------------------------- cópia dos dados
function Copia() {
  const [ult, setUlt] = useState(ultimaCopia())
  const baixar = async () => {
    await S.carregar()
    const d = (x: string | null | undefined) => x ? U.d(x) : null
    const fn = (id: string | null) => S.get('fornecedores', id)?.nome || ''
    const abas: [string, Record<string, unknown>[]][] = [
      ['Fornecedores', S.lista('fornecedores').map(f => ({ 'FORNECEDOR': f.nome, 'RAZÃO SOCIAL': f.razao, 'TIPO': f.tipo, 'CONTATO': f.contato, 'Contato 2': f.contato2, 'TELEFONE': f.telefone, 'CELULAR': f.celular,
        'ENDEREÇO': f.endereco, 'BAIRRO': f.bairro, 'CIDADE': f.cidade, 'UF': f.uf, 'CEP': f.cep, 'CNPJ': f.cnpj, 'I.E.': f.ie, 'APROV.': f.qualificacao, 'MÉTODO': f.qualif_metodo,
        'VALIDADE': d(f.qualif_validade), 'EMAIL': f.email, 'SITE': f.site, 'OBSERVAÇÕES': f.obs, 'ATIVO': f.ativo ? 'sim' : 'não' }))],
      ['Peças', S.lista('pecas').map(p => ({ 'Código': p.codigo, 'Descrição': p.descricao, 'Utilização': p.utilizacao, 'Fornecedor': fn(p.fornecedor_id), 'Estoque Min.': p.est_min,
        'Estoque Máx.': p.est_max, 'Qde Estoque': p.estoque, 'Status': C.situacao(p).txt, 'Unidade': p.unidade, 'Local': p.local, 'Obs.': p.obs, 'Ativa': p.ativo ? 'sim' : 'não' }))],
      ['Estoque', S.lista('movimentos').map(m => { const p = S.get('pecas', m.peca_id), e = m.tipo === 'entrada'
        return { 'Data': d(m.data), 'Código': p?.codigo, 'Descrição': p?.descricao, 'Entrada': e ? m.qtd : null, 'Saída': e ? null : m.qtd, 'Saldo': e ? m.qtd : -m.qtd, 'Fornecedor': fn(m.fornecedor_id),
          'Documento': m.documento, 'R$ Unitário': m.preco_unit, 'Total Entrada (R$)': e ? U.r2(m.qtd * m.preco_unit) : 0, 'Total Saída (R$)': e ? 0 : U.r2(m.qtd * m.preco_unit),
          'Saldo (R$)': U.r2((e ? 1 : -1) * m.qtd * m.preco_unit), 'Ano': Number(m.data.slice(0, 4)), 'Mês': Number(m.data.slice(5, 7)), 'Tipo': MOTIVO[m.motivo],
          'Quem retirou': S.get('funcionarios', m.funcionario_id)?.nome || '', 'Máquina': S.get('maquinas', m.maquina_id)?.nome || m.destino || '', 'Obs.': m.obs, 'Lançado em': U.dataHora(m.criado_em), 'Lançado por': S.nomeUsuario(m.criado_por) } })],
      ['Controle de Pedidos', S.lista('pedido_itens').map(i => { const ped = S.get('pedidos_compra', i.pedido_id), p = S.get('pecas', i.peca_id)
        return { 'Nº': ped?.numero, 'Data': d(ped?.data), 'Código': p?.codigo, 'Descrição': p?.descricao, 'Qde': i.qtd, 'Chegou': i.recebido, 'Fornecedor': fn(ped?.fornecedor_id || null), 'Documento': ped?.documento,
          'Valor': i.valor, 'Prazo': d(ped?.prazo), 'Status': ped?.status === 'recebido' ? 'Entregue' : ped?.status === 'cancelado' ? 'Cancelado' : 'Aguardando', 'Frete do pedido': ped?.frete, 'Obs.': ped?.obs } })],
      ['Máquinas', S.lista('maquinas').map(m => ({ 'Nome': m.nome, 'Tipo': m.tipo, 'Fabricante': m.fabricante, 'Modelo': m.modelo, 'Nº série': m.numero_serie, 'Setor': m.setor, 'Ano': m.ano, 'Preventiva (dias)': m.preventiva_dias, 'Obs.': m.obs, 'Ativa': m.ativo ? 'sim' : 'não' }))],
      ['Manutenções', S.lista('manutencoes').map(m => ({ 'Data': d(m.data), 'Máquina': S.get('maquinas', m.maquina_id)?.nome, 'Tipo': m.tipo, 'Situação': m.status, 'Problema': m.problema, 'Solução': m.solucao,
        'Técnico de fora': fn(m.fornecedor_id), 'Da equipe': S.get('funcionarios', m.funcionario_id)?.nome, 'Custo serviço': m.custo_servico, 'Horas parada': m.horas_parada, 'Concluída em': d(m.concluida_em) }))],
      ['Ordens de produção', S.lista('ordens').map(o => ({ 'OP': o.numero, 'Cliente': o.cliente_nome, 'Pedido do cliente': o.pedido_cliente, 'Produto': o.produto, 'Código': o.codigo, 'Qtd': o.qtd, 'Produzido': o.produzido,
        'Unidade': o.unidade, 'Prazo': d(o.prazo), 'Situação': o.status, 'Máquina': S.get('maquinas', o.maquina_id)?.nome, 'Responsável': S.get('funcionarios', o.responsavel_id)?.nome, 'Entregue em': d(o.entregue_em), 'Obs.': o.obs }))],
    ]
    if (Perm.pode('financeiro')) {
      abas.push(['Contas', S.lista('lancamentos').map(l => ({ 'Tipo': l.tipo === 'pagar' ? 'A pagar' : 'A receber', 'Descrição': l.descricao, 'Categoria': l.categoria, 'Valor': l.valor, 'Vencimento': d(l.vencimento),
        'Pago em': d(l.pago_em), 'Valor pago': l.valor_pago, 'Forma': l.forma, 'Fornecedor': fn(l.fornecedor_id), 'Cliente': S.get('clientes', l.cliente_id)?.nome, 'Parcela': l.parcela, 'Documento': l.documento, 'Obs.': l.obs }))])
      abas.push(['Clientes', S.lista('clientes').map(c => ({ 'Nome': c.nome, 'Razão social': c.razao, 'CNPJ': c.cnpj, 'Contato': c.contato, 'Telefone': c.telefone, 'E-mail': c.email, 'Cidade': c.cidade, 'UF': c.uf, 'Obs.': c.obs }))])
    }
    const sal = Perm.pode('salarios')
    abas.push(['Equipe', S.lista('funcionarios').map(f => { const p = sal ? S.get('funcionarios_privado', f.id) : null
      return { 'Nome': f.nome, 'Função': f.funcao, 'Setor': f.setor, 'Telefone': f.telefone, 'Admissão': d(f.admissao), 'Ativo': f.ativo ? 'sim' : 'não',
        ...(sal ? { 'Salário': p?.salario, 'Nascimento': d(p?.nascimento), 'CPF': p?.cpf, 'RG': p?.rg, 'Pix': p?.pix, 'Endereço': p?.endereco, 'Férias': (p?.ferias || []).map(x => U.data(x.inicio) + '–' + U.data(x.fim)).join('; '), 'Obs.': p?.obs } : {}) } })])
    await excel(`JAF Metal - copia dos dados ${U.hoje()}.xlsx`, abas, true)
    try { localStorage.setItem('jaf.ultimaCopia', U.hoje()) } catch { /* modo privado */ }
    setUlt(U.hoje())
  }
  return <section className="card"><h2>Cópia de segurança</h2>
    <p>Baixa um Excel com <b>todos</b> os dados (no mesmo formato da planilha antiga nas abas do almoxarifado). Guarde no computador ou no Google Drive.</p>
    <p className={`nota ${!ult || U.dias(ult, U.hoje()) > 7 ? 'amarela' : 'verde'}`}>{ult ? `Última cópia baixada neste aparelho: ${U.data(ult)} (${U.relativo(ult)}).` : 'Nenhuma cópia baixada neste aparelho ainda.'} Recomendado: uma por semana.</p>
    <p className="sub">Por que: o plano grátis do banco não guarda cópias automáticas. Se algo for apagado por engano, é esta cópia que salva.</p>
    <Btn txt="Baixar cópia completa (Excel)" icone="baixar" cls="pri mt" data-copia="1" onClick={() => baixar()} /></section>
}

// ---------------------------------------------------------------- histórico de alterações
const TAB: Record<string, string> = { pecas: 'Peça', fornecedores: 'Fornecedor', movimentos: 'Movimentação', pedidos_compra: 'Pedido de compra', pedido_itens: 'Item de pedido', maquinas: 'Máquina',
  manutencoes: 'Manutenção', ordens: 'Ordem de produção', lancamentos: 'Conta', funcionarios: 'Funcionário', funcionarios_privado: 'Dados pessoais', clientes: 'Cliente',
  config: 'Configuração', perfis: 'Acesso', importacao: 'Importação da planilha' }
const ACAO: Record<string, string> = { insert: 'criou', update: 'alterou', delete: 'apagou', importar: 'importou' }
function HistoricoAlt() {
  const [hist, setHist] = useState<Historico[] | null>(null)
  useEffect(() => { API.ultimos<Historico>('historico', 300).then(setHist).catch((e) => { setHist([]); erro(e) }) }, [])
  if (!hist) return <p className="sub">Carregando…</p>
  const nomeReg = (h: Historico) => { const d = (h.depois || h.antes || {}) as Record<string, unknown>; return String(d.codigo || d.nome || d.descricao || d.produto || d.problema || (d.numero ? 'nº ' + d.numero : '') || d.chave || '') }
  return <><p className="sub">As últimas {hist.length} alterações. Toque para ver o que mudou.</p>
    <div className="lista">{hist.map(h => <div key={h.id} className="linha clicavel" data-hist={h.id} onClick={() => verHist(h)}><div className="meio"><b>{h.quem || 'Sistema'} {ACAO[h.acao] || h.acao} {(TAB[h.tabela] || h.tabela).toLowerCase()} {nomeReg(h).slice(0, 60)}</b>
      <small>{U.dataHora(h.em)}</small></div></div>)}</div></>
}
function verHist(h: Historico) {
  const a = h.antes || {}, d = h.depois || {}
  const campos = U.unicos([...Object.keys(a), ...Object.keys(d)]).filter(k => !['atualizado_em', 'criado_em', 'id', 'seq'].includes(k) && JSON.stringify(a[k]) !== JSON.stringify(d[k]))
  const txt = (v: unknown) => JSON.stringify(v ?? '').replace(/^"|"$/g, '')
  void modal({ titulo: `${TAB[h.tabela] || h.tabela} — ${ACAO[h.acao] || h.acao}`,
    corpo: <><p className="sub">{h.quem || 'Sistema'} · {U.dataHora(h.em)}</p>
      <div className="tabela-caixa"><table className="tabela"><thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead><tbody>
        {campos.length ? campos.map(k => <tr key={k}><td className="mono peq">{k}</td><td className="peq">{txt(a[k])}</td><td className="peq">{txt(d[k])}</td></tr>) : <tr><td colSpan={3}>Sem diferença de campos.</td></tr>}</tbody></table></div></> })
}

// ================================================================ Minha conta: senha, aparência, instalar
export function TelaConta() {
  const s = API.sessao!
  const [tema, setTema] = useState(() => { try { return localStorage.getItem('jaf.tema') || 'auto' } catch { return 'auto' } })
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const instalado = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone
  const mudarTema = (v: string) => { setTema(v); try { localStorage.setItem('jaf.tema', v) } catch { /* modo privado */ } App.aplicarTema() }
  return <>
    <Cab titulo="Minha conta" />
    <section className="card"><div style={{ display: 'flex', gap: 14, alignItems: 'center' }}><span className="avatar" style={{ width: 48, height: 48, fontSize: '1.2rem' }}>{s.nome.charAt(0).toUpperCase()}</span>
      <div><b>{s.nome}</b><div className="sub">usuário <b>{s.login}</b> · {Perm.nome(s.perfil)}</div></div></div>
      <div className="grupo-btn mt"><button type="button" className="btn sec" data-c="senha" onClick={() => void trocarSenha(s.uid, '')}><Ic n="cadeado" /><span>Trocar minha senha</span></button>
        <button type="button" className="btn fantasma" data-acao="sair" onClick={async () => { if (await confirmar('Sair do sistema neste aparelho?', { ok: 'Sair' })) await App.sair() }}><Ic n="sair" /><span>Sair</span></button></div></section>
    <section className="card mt"><h2>Aparência</h2><div className="opcoes mt">{([['auto', 'Automática', 'segue o aparelho'], ['claro', 'Clara', ''], ['escuro', 'Escura', 'boa no chão de fábrica']] as const).map(([v, t, d]) =>
      <label key={v} className="opcao"><input type="radio" name="tema" value={v} checked={tema === v} onChange={() => mudarTema(v)} /><span><b>{t}</b>{d && <small>{d}</small>}</span></label>)}</div></section>
    <section className="card mt"><h2><Ic n="instalar" /> Usar como aplicativo</h2>
      {instalado ? <p className="nota verde mt">Já está instalado neste aparelho.</p> : ios
        ? <ol className="passos mt"><li><span>No Safari, toque em <b>Compartilhar</b> (o quadrado com a seta).</span></li><li><span>Escolha <b>Adicionar à Tela de Início</b>.</span></li><li><span>Pronto: o ícone da JAF aparece junto dos outros apps.</span></li></ol>
        : <><p className="mt">No Chrome ou Edge: menu <b>⋮</b> → <b>Instalar aplicativo</b> (ou "Adicionar à tela inicial").</p>
          {App.pedidoInstalar && <button type="button" className="btn pri" data-c="instalar" onClick={() => { void App.pedidoInstalar?.prompt(); App.pedidoInstalar = null }}>Instalar agora</button>}</>}</section>
    <p className="sub mt">JAF Metal Gestão · versão {App.versao}{API.modo === 'teste' && <> · <b>modo teste</b> <button type="button" className="btn fantasma mini" data-c="zerar"
      onClick={async () => { if (await confirmar('Apagar os dados de teste e recomeçar?', { ok: 'Recomeçar', perigo: true })) { await API.zerarTeste(); location.reload() } }}>Recomeçar a demonstração</button></>}</p>
  </>
}
