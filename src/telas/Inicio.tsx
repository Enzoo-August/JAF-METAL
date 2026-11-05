/* Início: atalhos e blocos que cada pessoa escolhe (botão "Personalizar"); cada perfil começa com o que mais usa */
import { useState, type ReactNode } from 'react'
import { App } from '../app/controle.tsx'
import { API } from '../lib/api.ts'
import { C, S } from '../lib/dados.ts'
import { Perm, type Acao } from '../lib/perm.ts'
import * as R from '../lib/rh.ts'
import type { Perfil } from '../lib/tipos.ts'
import * as U from '../lib/util.ts'
import { aviso } from '../ui/avisos.ts'
import { Tag } from '../ui/base.tsx'
import { Ic, type NomeIcone } from '../ui/icones.tsx'
import { modal } from '../ui/janelas.tsx'
import { form as formPedido } from './Compras.tsx'
import { form as formConta } from './Financeiro.tsx'
import { formManutencao } from './Maquinas.tsx'
import { entrada, LinhaMov, retirar } from './Movimentos.tsx'
import { CartaoOrdem, form as formOrdem } from './Producao.tsx'
import { LinhaPessoa, situacaoFunc, TIPO_AUS } from './rh/comum.tsx'
import { formOcorrencia } from './rh/Disciplina.tsx'
import { formAusencia, programarFerias, proximoDiaUtil } from './rh/Ferias.tsx'
import { formPessoa } from './rh/Pessoas.tsx'
import { formAso, formEpi } from './rh/Seguranca.tsx'
import { ComTabelas } from './fabrica/comum.tsx'
import { formOF, LinhaOF } from './fabrica/OFs.tsx'
import { formLote } from './fabrica/MP.tsx'
import { lerNota } from './Nota.tsx'
import { detalhe as detalheVenda, formVenda } from './fabrica/Pedidos.tsx'
import { formProduto } from './fabrica/Produtos.tsx'
import { defReg, formReg } from './fabrica/Registros.tsx'

// ------------------------------------------------------------------ o que dá para pôr no Início
interface Atalho { id: string; rot: string; sub: string; ic: NomeIcone; perm: Acao[]; ir?: string; fazer?: () => unknown }
export const ATALHOS: Atalho[] = [
  { id: 'retirar', rot: 'Retirar peça', sub: 'do almoxarifado', ic: 'retirar', perm: ['retirar'], fazer: () => retirar() },
  { id: 'entrada', rot: 'Dar entrada', sub: 'chegou peça', ic: 'entrada', perm: ['entrada'], fazer: () => entrada() },
  { id: 'notaXML', rot: 'Ler nota fiscal', sub: 'arquivo XML', ic: 'nota', perm: ['entrada', 'mp_editar'], fazer: () => lerNota() },
  { id: 'listaCompras', rot: 'O que comprar', sub: 'peças faltando', ic: 'lista', perm: ['compras'], ir: '#/compras/lista' },
  { id: 'novoPedido', rot: 'Novo pedido', sub: 'de compra', ic: 'compras', perm: ['compras'], fazer: () => formPedido() },
  { id: 'fornecedores', rot: 'Fornecedores', sub: 'contatos e pedidos', ic: 'fornecedor', perm: ['compras'], ir: '#/fornecedores' },
  { id: 'estoque', rot: 'Estoque', sub: 'todas as peças', ic: 'estoque', perm: ['estoque_ver'], ir: '#/pecas' },
  { id: 'novaOrdem', rot: 'Nova ordem', sub: 'de produção', ic: 'producao', perm: ['producao_editar'], fazer: () => formOrdem() },
  { id: 'ordens', rot: 'Ordens', sub: 'fila e produção', ic: 'producao', perm: ['pcp'], ir: '#/producao' },
  { id: 'chamado', rot: 'Máquina com problema', sub: 'abrir OS', ic: 'chave', perm: ['manutencao'], fazer: () => formManutencao({ tipo: 'corretiva' }) },
  { id: 'os', rot: 'Ordens de serviço', sub: 'manutenção', ic: 'chave', perm: ['manut_ver'], ir: '#/os' },
  { id: 'preventiva', rot: 'Preventiva', sub: 'check-list e plano', ic: 'ok', perm: ['manut_ver'], ir: '#/preventiva' },
  { id: 'pecasCriticas', rot: 'Peças críticas', sub: 'o que comprar', ic: 'estoque', perm: ['manut_gestao'], ir: '#/reg/peca_critica' },
  { id: 'novaOF', rot: 'Nova OF', sub: 'ordem de fabricação', ic: 'producao', perm: ['of_emitir'], fazer: () => formOF() },
  { id: 'ofs', rot: 'OFs', sub: 'ordens de fabricação', ic: 'producao', perm: ['of_menu'], ir: '#/ofs' },
  { id: 'entradaMP', rot: 'Entrada de material', sub: 'matéria-prima (R.I.)', ic: 'entrada', perm: ['mp_editar'], fazer: () => formLote() },
  { id: 'pedidosClientes', rot: 'Pedidos de clientes', sub: 'prazos e entregas', ic: 'cliente', perm: ['vendas'], ir: '#/pedidos' },
  { id: 'novoPedidoCliente', rot: 'Novo pedido', sub: 'de cliente', ic: 'mais', perm: ['vendas_editar'], fazer: () => formVenda() },
  { id: 'necessidade', rot: 'Necessidade', sub: 'o que fabricar e comprar', ic: 'lista', perm: ['necessidade'], ir: '#/necessidade' },
  { id: 'produtos', rot: 'Produtos', sub: 'cadastro técnico', ic: 'estoque', perm: ['produtos_menu'], ir: '#/produtos' },
  { id: 'novoProduto', rot: 'Novo produto', sub: 'código JAF', ic: 'mais', perm: ['produtos_editar'], fazer: () => formProduto() },
  { id: 'solicitarAlteracao', rot: 'Pedir alteração', sub: 'no produto ou processo', ic: 'desfazer', perm: ['solicitar'], fazer: () => formReg(defReg('alteracao')!) },
  { id: 'sugerirMelhoria', rot: 'Sugerir melhoria', sub: 'para a fábrica', ic: 'ok', perm: ['solicitar'], fazer: () => formReg(defReg('melhoria')!) },
  { id: 'desenvolvimento', rot: 'Desenvol­vimento', sub: 'peças novas', ic: 'lapis', perm: ['tecnico_menu'], ir: '#/reg/desenvolvimento' },
  { id: 'desvio', rot: 'Desvio', sub: 'lançar desvio', ic: 'alerta', perm: ['tecnico_editar'], fazer: () => formReg(defReg('desvio')!) },
  { id: 'ata', rot: 'Ata de reunião', sub: 'nova ata', ic: 'equipe', perm: ['tecnico_editar'], fazer: () => formReg(defReg('ata')!) },
  { id: 'novaConta', rot: 'Nova conta', sub: 'a pagar ou receber', ic: 'dinheiro', perm: ['financeiro'], fazer: () => formConta({}) },
  { id: 'contas', rot: 'Contas', sub: 'a pagar e receber', ic: 'dinheiro', perm: ['financeiro'], ir: '#/financeiro' },
  { id: 'fluxo', rot: 'Fluxo de caixa', sub: 'previsão do saldo', ic: 'relatorio', perm: ['financeiro'], ir: '#/financeiro/fluxo' },
  { id: 'clientes', rot: 'Clientes', sub: 'cadastro', ic: 'cliente', perm: ['clientes'], ir: '#/clientes' },
  { id: 'relatorios', rot: 'Relatórios', sub: 'estoque e consumo', ic: 'relatorio', perm: ['relatorios'], ir: '#/relatorios' },
  { id: 'pessoas', rot: 'Pessoas', sub: 'fichas do RH', ic: 'equipe', perm: ['rh_ver'], ir: '#/rh' },
  { id: 'novaPessoa', rot: 'Nova pessoa', sub: 'admissão', ic: 'equipe', perm: ['rh_editar'], fazer: () => formPessoa() },
  { id: 'ponto', rot: 'Ponto', sub: 'horas extras e faltas', ic: 'relogio', perm: ['rh_ver'], ir: '#/rh/ponto' },
  { id: 'programarFerias', rot: 'Programar férias', sub: 'com aviso em PDF', ic: 'calendario', perm: ['rh_editar', 'rh_sensivel'], fazer: () => programarFerias() },
  { id: 'atestado', rot: 'Atestado ou falta', sub: 'lançar ausência', ic: 'mais', perm: ['rh_editar'], fazer: () => formAusencia() },
  { id: 'aso', rot: 'Exame (ASO)', sub: 'lançar exame', ic: 'admin', perm: ['rh_editar'], fazer: () => formAso() },
  { id: 'epi', rot: 'Entregar EPI', sub: 'com ficha', ic: 'admin', perm: ['rh_editar'], fazer: () => formEpi() },
  { id: 'advertencia', rot: 'Advertência', sub: 'ou suspensão', ic: 'alerta', perm: ['rh_editar'], fazer: () => formOcorrencia() },
  { id: 'treinamentos', rot: 'Treinamentos', sub: 'matrizes', ic: 'lista', perm: ['rh_ver'], ir: '#/rh/treinamentos' },
  { id: 'ajuda', rot: 'Ajuda', sub: 'tutoriais', ic: 'ajuda', perm: ['todos'], ir: '#/ajuda' },
]
interface Bloco { id: string; rot: string; sub: string; perm: Acao[]; El: () => ReactNode }
export const BLOCOS: Bloco[] = [
  { id: 'atencao', rot: 'Precisa de atenção', sub: 'avisos do dia', perm: ['todos'], El: () => <Atencao /> },
  { id: 'numeros', rot: 'Números do mês', sub: 'estoque, consumo, contas', perm: ['precos'], El: () => <Numeros /> },
  { id: 'rhNumeros', rot: 'Números do RH', sub: 'pessoas, férias, exames', perm: ['rh_ver'], El: () => <NumerosRH /> },
  { id: 'foraHoje', rot: 'Quem está fora', sub: 'férias, atestados, afastados', perm: ['rh_ver'], El: () => <ForaHoje /> },
  { id: 'aniversariantes', rot: 'Aniversariantes do mês', sub: 'da equipe', perm: ['rh_sensivel'], El: () => <Aniversariantes /> },
  { id: 'chegando', rot: 'Pedidos para chegar', sub: 'compras em aberto', perm: ['compras'], El: () => <Chegando /> },
  { id: 'ultimas', rot: 'Últimas movimentações', sub: 'entradas e retiradas', perm: ['historico_mov'], El: () => <Ultimas /> },
  { id: 'minhasOrdens', rot: 'Ordens em andamento', sub: 'as suas primeiro', perm: ['pcp'], El: () => <MinhasOrdens /> },
  { id: 'minhasRetiradas', rot: 'Minhas retiradas de hoje', sub: 'o que você tirou', perm: ['retirar'], El: () => <MinhasRetiradas /> },
  { id: 'ofsAbertas', rot: 'OFs em aberto', sub: 'atrasadas primeiro', perm: ['of_menu'], El: () => <ComTabelas tabs={['ofs', 'produtos']}>{() => <OFsAbertas />}</ComTabelas> },
  { id: 'pedidosAtraso', rot: 'Pedidos de clientes', sub: 'atrasados e de hoje', perm: ['vendas'], El: () => <ComTabelas tabs={['vendas', 'produtos']}>{() => <PedidosAtraso />}</ComTabelas> },
  { id: 'osAbertas', rot: 'OS em aberto', sub: 'manutenção', perm: ['manut_ver'], El: () => <OSAbertas /> },
  { id: 'tecnicoPendentes', rot: 'Engenharia', sub: 'prazos vencidos', perm: ['tecnico_menu'], El: () => <ComTabelas tabs={['registros']}>{() => <TecnicoPendentes />}</ComTabelas> },
]
const PADRAO: Record<Perfil, { atalhos: string[]; blocos: string[] }> = {
  dono: { atalhos: ['retirar', 'entrada', 'novaOF', 'pedidosClientes', 'listaCompras', 'fornecedores', 'novaConta'], blocos: ['atencao', 'numeros', 'pedidosAtraso', 'ofsAbertas', 'foraHoje', 'chegando'] },
  escritorio: { atalhos: ['retirar', 'entrada', 'pedidosClientes', 'listaCompras', 'novaConta', 'fornecedores'], blocos: ['atencao', 'numeros', 'pedidosAtraso', 'chegando', 'ultimas'] },
  almoxarife: { atalhos: ['retirar', 'entrada', 'entradaMP', 'listaCompras', 'novoPedido', 'chamado'], blocos: ['atencao', 'numeros', 'chegando', 'ultimas'] },
  pcp: { atalhos: ['novaOF', 'ofs', 'entradaMP', 'pedidosClientes', 'necessidade', 'produtos'], blocos: ['atencao', 'pedidosAtraso', 'ofsAbertas'] },
  producao: { atalhos: ['ofs', 'retirar', 'chamado', 'estoque', 'solicitarAlteracao'], blocos: ['atencao', 'ofsAbertas', 'minhasRetiradas'] },
  gerente: { atalhos: ['ofs', 'pedidosClientes', 'chamado', 'pessoas', 'ponto'], blocos: ['atencao', 'ofsAbertas', 'pedidosAtraso', 'foraHoje'] },
  tecnico: { atalhos: ['produtos', 'novoProduto', 'solicitarAlteracao', 'desenvolvimento', 'desvio', 'ata'], blocos: ['atencao', 'tecnicoPendentes'] },
  manutencao: { atalhos: ['chamado', 'preventiva', 'os', 'retirar', 'pecasCriticas'], blocos: ['atencao', 'osAbertas'] },
  rh: { atalhos: ['novaPessoa', 'ponto', 'programarFerias', 'atestado', 'aso', 'advertencia'], blocos: ['atencao', 'rhNumeros', 'foraHoje', 'aniversariantes'] },
}
const podeTudo = (p: Acao[]) => p.every(a => Perm.pode(a))
function escolhas(): { atalhos: string[]; blocos: string[] } {
  const pad = PADRAO[API.sessao!.perfil] || PADRAO.producao
  const p = S.prefs().inicio
  return { atalhos: p?.atalhos ?? pad.atalhos, blocos: p?.blocos ?? pad.blocos }
}

export function TelaInicio() {
  const s = API.sessao!
  const agora = U.agoraSP(), h = agora.getHours()
  const saud = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
  const e = escolhas()
  const ats = e.atalhos.map(id => ATALHOS.find(a => a.id === id)).filter((a): a is Atalho => !!a && podeTudo(a.perm))
  const bls = e.blocos.map(id => BLOCOS.find(b => b.id === id)).filter((b): b is Bloco => !!b && podeTudo(b.perm))
  return <>
    <header className="cab hero"><div><h1>{saud}, {(s.nome || '').split(' ')[0]}</h1><p className="sub">{U.cap(agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))}</p></div>
      <div className="acoes"><button type="button" className="btn fantasma" data-acao="personalizar" onClick={() => void personalizar()}><Ic n="lapis" /><span>Personalizar</span></button></div></header>
    {ats.length > 0 && <div className="atalhos">{ats.map((a, i) => a.ir
      ? <a key={a.id} className={`atalho${i === 0 && a.id === 'retirar' ? ' destaque' : ''}`} href={a.ir} data-atalho={a.id}><Ic n={a.ic} /><span>{a.rot}<small>{a.sub}</small></span></a>
      : <button key={a.id} type="button" className={`atalho${i === 0 && a.id === 'retirar' ? ' destaque' : ''}`} data-atalho={a.id} data-acao={a.id === 'retirar' || a.id === 'entrada' ? a.id : undefined} onClick={() => void a.fazer?.()}><Ic n={a.ic} /><span>{a.rot}<small>{a.sub}</small></span></button>)}</div>}
    <div className="blocos-inicio">{bls.map(b => <div key={b.id} data-bloco={b.id}>{b.El()}</div>)}</div>
    {!ats.length && !bls.length && <p className="sub">Seu início está vazio. Toque em <b>Personalizar</b> para escolher o que aparece aqui.</p>}
  </>
}

// ------------------------------------------------------------------ personalizar
function ListaEscolha({ nome, itens, marcados }: { nome: string; itens: { id: string; rot: string; sub: string; ic?: NomeIcone }[]; marcados: string[] }) {
  const [ordem, setOrdem] = useState(() => [...marcados.filter(id => itens.some(i => i.id === id)), ...itens.map(i => i.id).filter(id => !marcados.includes(id))])
  const [on, setOn] = useState(() => new Set(marcados))
  const mover = (id: string, d: number) => setOrdem(o => { const i = o.indexOf(id), j = i + d; if (j < 0 || j >= o.length) return o; const c = o.slice(); [c[i], c[j]] = [c[j], c[i]]; return c })
  return <div className="lista-perso">
    <input type="hidden" name={nome} value={JSON.stringify(ordem.filter(id => on.has(id)))} />
    {ordem.map((id, n) => { const it = itens.find(i => i.id === id)!; const m = on.has(id)
      return <div key={id} className={`item-perso${m ? ' on' : ''}`} data-perso={id}>
        <label><input type="checkbox" checked={m} onChange={(e) => setOn(s => { const x = new Set(s); if (e.target.checked) x.add(id); else x.delete(id); return x })} />{it.ic && <Ic n={it.ic} />}<span>{it.rot}<small>{it.sub}</small></span></label>
        <button type="button" className="icone-btn mini" aria-label={'Subir ' + it.rot} disabled={!n} onClick={() => mover(id, -1)}><Ic n="voltar" cls="cima" /></button>
        <button type="button" className="icone-btn mini" aria-label={'Descer ' + it.rot} disabled={n === ordem.length - 1} onClick={() => mover(id, 1)}><Ic n="seta" cls="cima" /></button></div> })}
  </div>
}
async function salvarPrefsInicio(v: { atalhos: string[]; blocos: string[] } | undefined) {
  const prefs = { ...S.prefs(), inicio: v }
  if (!v) delete prefs.inicio
  await API.rpc('salvar_preferencias', { p: prefs })
  API.sessao!.preferencias = prefs
  App.redesenhar()
}
export async function personalizar(): Promise<void> {
  const e = escolhas()
  const ats = ATALHOS.filter(a => podeTudo(a.perm)), bls = BLOCOS.filter(b => podeTudo(b.perm))
  await modal({
    titulo: 'Personalizar o início', largura: 'larga',
    corpo: <><p className="sub">Marque o que quer ver e use as setas para mudar a ordem. Vale só para você, em qualquer aparelho.</p>
      <div className="grade g2 mt"><section><h3>Atalhos (botões grandes)</h3><div className="mt"><ListaEscolha nome="atalhos" itens={ats} marcados={e.atalhos} /></div></section>
        <section><h3>Quadros</h3><div className="mt"><ListaEscolha nome="blocos" itens={bls} marcados={e.blocos} /></div></section></div></>,
    botoes: [{ txt: 'Voltar ao padrão', cls: 'fantasma', validar: false, acao: async () => { await salvarPrefsInicio(undefined); aviso('Início voltou ao padrão.') } },
      { txt: 'Salvar', acao: async (frm) => {
        const ler = (n: string) => JSON.parse((frm.elements.namedItem(n) as HTMLInputElement).value) as string[]
        await salvarPrefsInicio({ atalhos: ler('atalhos'), blocos: ler('blocos') }); aviso('Início salvo.')
      } }],
  })
}

// ------------------------------------------------------------------ quadros
function Atencao() {
  const al = C.alertas()
  return <section className="card"><div className="card-cab"><h2>Precisa de atenção</h2></div>
    {al.length ? <div className="alertas">{al.map(a => <a key={a.txt} className={`alerta n-${a.nivel}${a.pisca ? ' pisca' : ''}`} href={a.rota}><Ic n="alerta" /><span>{a.txt}</span><Ic n="seta" /></a>)}</div>
      : <p className="sub"><Ic n="ok" /> Tudo em dia por aqui.</p>}</section>
}

function Numeros() {
  const hoje = U.hoje(), ini = hoje.slice(0, 8) + '01'
  const consumoMes = U.soma(C.consumos(m => m.data >= ini && m.data <= hoje), 'valor')
  const ant = U.somaMeses(ini, -1), fimAnt = U.somaDias(ini, -1)
  const consumoAnt = U.soma(C.consumos(m => m.data >= ant && m.data <= fimAnt), 'valor')
  const fin = Perm.pode('financeiro')
  const ab = S.lista('lancamentos').filter(l => !l.pago_em && l.vencimento <= U.somaDias(hoje, 7))
  const pg = U.soma(ab.filter(l => l.tipo === 'pagar'), 'valor'), rc = U.soma(ab.filter(l => l.tipo === 'receber'), 'valor')
  const peds = S.lista('pedidos_compra').filter(p => p.status === 'aguardando')
  const ops = S.lista('ordens').filter(o => o.status === 'fila' || o.status === 'producao')
  return <div className="grade g4 mt">
    <a className="kpi" href="#/relatorios?r=estoque"><small>Valor em estoque</small><b>{U.moeda0(C.valorEstoque())}</b><span>{U.plural(S.lista('pecas').filter(p => p.ativo && p.estoque > 0).length, 'item', 'itens')} com saldo</span></a>
    <a className="kpi" href="#/relatorios?r=consumo"><small>Consumo no mês</small><b>{U.moeda0(consumoMes)}</b><span>mês passado: {U.moeda0(consumoAnt)}</span></a>
    {fin ? <>
      <a className={`kpi ${pg > 0 ? '' : 'bom'}`} href="#/financeiro?t=pagar"><small>A pagar em 7 dias</small><b>{U.moeda0(pg)}</b><span>inclui as vencidas</span></a>
      <a className="kpi" href="#/financeiro?t=receber"><small>A receber em 7 dias</small><b>{U.moeda0(rc)}</b><span>inclui as atrasadas</span></a>
    </> : <>
      <a className="kpi" href="#/compras"><small>Pedidos em aberto</small><b>{peds.length}</b><span>{U.moeda0(U.soma(peds, p => C.totalPedido(p)))}</span></a>
      <a className="kpi" href="#/producao"><small>Ordens em andamento</small><b>{ops.length}</b><span>na fila ou produzindo</span></a>
    </>}
  </div>
}

function NumerosRH() {
  const at = S.lista('funcionarios').filter(f => f.ativo)
  const exp = at.filter(f => R.experiencia(f.admissao)).length
  const fora = at.filter(f => ['ferias', 'afastado', 'ausente'].includes(situacaoFunc(f).cod)).length
  const fv = Perm.pode('rh_sensivel') ? at.filter(f => { const s = C.ferias(f)?.situacao; return s === 'vencido' || s === 'vence30' || s === 'vence60' }).length : null
  const asov = at.filter(f => { const a = R.ultimoAso(S.lista('rh_asos'), f.id); return a && R.semaforoData(R.vencimentoAso(a)) !== 'verde' }).length
  return <div className="grade g4 mt">
    <a className="kpi" href="#/rh"><small>Pessoas trabalhando</small><b>{at.length}</b><span>{exp ? U.plural(exp, 'em experiência', 'em experiência') : 'ninguém em experiência'}</span></a>
    <a className="kpi" href="#/rh/ferias?aba=fora"><small>Fora hoje</small><b>{fora}</b><span>férias, atestado, afastado</span></a>
    {fv !== null && <a className={`kpi${fv ? ' alerta' : ' bom'}`} href="#/rh/ferias"><small>Férias vencendo</small><b>{fv}</b><span>em até 60 dias ou vencidas</span></a>}
    <a className={`kpi${asov ? ' alerta' : ''}`} href="#/rh/seguranca"><small>Exames (ASO)</small><b>{asov}</b><span>vencidos ou vencendo</span></a>
  </div>
}

function ForaHoje() {
  const hoje = U.hoje()
  const l = U.ordenar(S.lista('rh_ausencias').filter(a => a.inicio <= hoje && (a.fim === null || a.fim >= hoje)), a => a.fim || '9999')
  return <section className="card mt"><div className="card-cab"><h2>Fora hoje</h2><a href="#/rh/ferias?aba=fora">Ver próximos dias</a></div>
    {l.length ? <div className="lista">{l.slice(0, 8).map(a => { const f = S.get('funcionarios', a.funcionario_id); return f ? <LinhaPessoa key={a.id} f={f} sub={TIPO_AUS[a.tipo]}
      direita={a.fim ? <small>volta {U.relativo(proximoDiaUtil(a.fim))}</small> : <Tag s={{ cor: 'amarelo', txt: 'Sem data' }} />} /> : null })}</div>
      : <p className="sub"><Ic n="ok" /> Todo mundo trabalhando hoje.</p>}</section>
}

function Aniversariantes() {
  const m = U.hoje().slice(5, 7), d = U.hoje().slice(8, 10)
  const l = U.ordenar(S.lista('funcionarios').filter(f => f.ativo && S.get('funcionarios_privado', f.id)?.nascimento?.slice(5, 7) === m), f => S.get('funcionarios_privado', f.id)!.nascimento!.slice(8, 10))
  return <section className="card mt"><div className="card-cab"><h2>Aniversariantes de {U.nomeMes(Number(m))}</h2></div>
    {l.length ? <div className="lista">{l.map(f => { const dia = S.get('funcionarios_privado', f.id)!.nascimento!.slice(8, 10)
      return <LinhaPessoa key={f.id} f={f} direita={dia === d ? <Tag s={{ cor: 'verde', txt: 'Hoje!' }} /> : <small>dia {dia}</small>} /> })}</div>
      : <p className="sub">Ninguém faz aniversário este mês.</p>}</section>
}

function Chegando() {
  const peds = S.lista('pedidos_compra').filter(p => p.status === 'aguardando').sort((a, b) => (a.prazo || '9') < (b.prazo || '9') ? -1 : 1).slice(0, 6)
  return <section className="card mt"><div className="card-cab"><h2>Para chegar</h2><a href="#/compras">Ver todos</a></div>
    {peds.length ? <div className="lista">{peds.map(p => <a key={p.id} className="linha" href={'#/pedido/' + p.id}><div className="meio"><b>Nº {p.numero} · {S.get('fornecedores', p.fornecedor_id)?.nome || ''}</b>
      <small>{C.itensDoPedido(p.id).map(i => S.get('pecas', i.peca_id)?.codigo).filter(Boolean).join(', ')}</small></div>
      <div className="lado"><Tag s={C.situacaoPedido(p)} /><small>{p.prazo ? U.relativo(p.prazo) : 'sem prazo'}</small></div></a>)}</div>
      : <p className="sub">Nenhum pedido aguardando.</p>}</section>
}

function Ultimas() {
  const movs = S.lista('movimentos').slice(-8).reverse()
  return <section className="card mt"><div className="card-cab"><h2>Últimas movimentações</h2><a href="#/movimentos">Ver todas</a></div>
    {movs.length ? <div className="lista">{movs.map(m => <LinhaMov key={m.id} m={m} curta />)}</div> : <p className="sub">Nada lançado ainda.</p>}</section>
}

function MinhasOrdens() {
  const meu = API.sessao?.funcionario_id
  let ords = S.lista('ordens').filter(o => o.status === 'fila' || o.status === 'producao')
  const minhas = meu ? ords.filter(o => o.responsavel_id === meu) : []
  if (minhas.length) ords = minhas
  ords = ords.sort((a, b) => (b.prioridade - a.prioridade) || ((a.prazo || '9') < (b.prazo || '9') ? -1 : 1)).slice(0, 8)
  return <section className="card mt"><div className="card-cab"><h2>{minhas.length ? 'Minhas ordens' : 'Ordens em andamento'}</h2><a href="#/producao">Ver todas</a></div>
    {ords.length ? ords.map(o => <CartaoOrdem key={o.id} o={o} />) : <p className="sub">Nenhuma ordem na fila.</p>}</section>
}

function MinhasRetiradas() {
  const hoje = U.hoje()
  const movs = S.lista('movimentos').filter(m => m.data === hoje && m.criado_por === API.sessao?.uid).reverse()
  return <section className="card mt"><div className="card-cab"><h2>Minhas retiradas de hoje</h2></div>
    {movs.length ? <div className="lista">{movs.map(m => <LinhaMov key={m.id} m={m} curta />)}</div> : <p className="sub">Você ainda não retirou nada hoje.</p>}</section>
}

// ------------------------------------------------------------------ quadros da fábrica
function OFsAbertas() {
  const l = U.ordenar(S.lista('ofs').filter(o => o.status === 'aberta'), o => (C.situacaoOF(o).atrasada ? '0' : '1') + (o.prazo || '9999') + String(o.numero).padStart(8, '0'))
  const atr = l.filter(o => C.situacaoOF(o).atrasada).length
  return <section className="card"><div className="card-cab"><h2>OFs em aberto</h2><a href="#/ofs" className="sub">{U.plural(l.length, 'OF')}{atr ? ` · ${atr} atrasada${atr > 1 ? 's' : ''}` : ''}</a></div>
    {l.length ? <div className="lista">{l.slice(0, 6).map(o => <LinhaOF key={o.id} o={o} />)}</div> : <p className="sub">Nenhuma OF em aberto.</p>}</section>
}
function PedidosAtraso() {
  const l = U.ordenar(S.lista('vendas').filter(v => ['atraso', 'atencao'].includes(C.situacaoVenda(v).cod)), v => v.prazo || '')
  return <section className="card"><div className="card-cab"><h2>Pedidos de clientes</h2><a href="#/pedidos" className="sub">ver todos</a></div>
    {l.length ? <div className="lista">{l.slice(0, 6).map(v => <div key={v.id} className="linha clicavel" onClick={() => void detalheVenda(v.id)}><div className="meio"><b>{v.cliente_nome} · {v.codigo || v.descricao}</b>
      <small>saldo {U.qtd(C.saldoVenda(v))} · prazo {U.dataCurta(v.prazo)}</small></div><div className="lado"><Tag s={C.situacaoVenda(v)} /></div></div>)}
      {l.length > 6 && <a className="linha" href="#/pedidos"><div className="meio"><small>+ {l.length - 6} itens</small></div></a>}</div>
      : <p className="sub">Nenhum pedido atrasado ou para hoje.</p>}</section>
}
function OSAbertas() {
  const l = U.ordenar(S.lista('manutencoes').filter(m => m.status !== 'concluida'), m => (m.tipo === 'corretiva' ? '0' : '1') + m.data)
  return <section className="card"><div className="card-cab"><h2>OS em aberto</h2><a href="#/os" className="sub">{U.plural(l.length, 'OS', 'OS')}</a></div>
    {l.length ? <div className="lista">{l.slice(0, 6).map(m => { const q = S.get('maquinas', m.maquina_id)
      return <div key={m.id} className="linha clicavel" onClick={() => void formManutencao(m)}><div className="meio"><b>{m.numero ? 'OS ' + m.numero + ' · ' : ''}{C.nomeMaquina(q)}</b><small>{m.problema.slice(0, 80)} · {U.dataCurta(m.data)}</small></div></div> })}</div>
      : <p className="sub">Nenhuma OS em aberto.</p>}</section>
}
function TecnicoPendentes() {
  const l = U.ordenar(S.lista('registros').filter(r => r.prazo && r.prazo < U.hoje() && !r.concluido_em && !/conclu|aprovad|ok|cancel|retornou|entregue|pago/i.test(r.status || '')
    && ['desenvolvimento', 'projeto', 'melhoria', 'alteracao', 'imds'].includes(r.tipo)), r => r.prazo || '')
  return <section className="card"><div className="card-cab"><h2>Engenharia: prazos vencidos</h2><a href="#/tecnico" className="sub">painel</a></div>
    {l.length ? <div className="lista">{l.slice(0, 8).map(r => <a key={r.id} className="linha" href={`#/reg/${r.tipo}?id=${r.id}`}><div className="meio"><b>{defReg(r.tipo)?.nome}{r.numero ? ' nº ' + r.numero : ''}</b>
      <small>{[r.codigo, (r.titulo || '').slice(0, 60), r.responsavel].filter(Boolean).join(' · ')}</small></div><div className="lado"><small>prazo {U.dataCurta(r.prazo)}</small></div></a>)}</div>
      : <p className="sub">Nada atrasado.</p>}</section>
}
