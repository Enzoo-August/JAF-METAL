/* Registros das planilhas de controle (uma tela só, com os campos de cada aba):
 *  Depto. Técnico: Desenvolvimento, Projetos, Melhorias, Sol. Alt., Desvios, Qualidade Matriz (desenhos), Cópia Controlada, Cad. IMDS, Atas, Setup e Prod.
 *  PCP: Sol. Serv. Ext., Req. Componentes
 *  Manutenção: Serviços, Fluxo de Caixa, Máquinas Críticas, pendências, Ferramentaria
 * Cada aba vira um tipo; os nomes das colunas da planilha continuam os mesmos para facilitar. */
import { useEffect } from 'react'
import { App } from '../../app/controle.tsx'
import { API } from '../../lib/api.ts'
import { S } from '../../lib/dados.ts'
import { Perm, type Acao } from '../../lib/perm.ts'
import type { RegistroFab, TipoRegistro } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { entregar, excel, pdfDocumento, pdfTabela } from '../../ui/arquivos.tsx'
import { aviso } from '../../ui/avisos.ts'
import { BuscaLista, Btn, Cab, Campo, Chips, Paginado, Vazio } from '../../ui/base.tsx'
import { ComboMaquina } from '../../ui/Combo.tsx'
import { useLembrar, type Rota } from '../../ui/ganchos.ts'
import { confirmar, lerForm, modal } from '../../ui/janelas.tsx'
import { ComTabelas, usados } from './comum.tsx'

type TipoCampo = 'text' | 'area' | 'date' | 'num' | 'dinheiro' | 'time'
// k: coluna do registro (numero, data, codigo, titulo, status, prazo, concluido_em, responsavel, valor, maquina_id) ou "d.xxx" (dentro de dados)
interface CampoReg { k: string; rot: string; t?: TipoCampo; lista?: boolean; sug?: boolean; req?: boolean; largo?: boolean }
interface DefReg {
  tipo: TipoRegistro; nome: string; sing: string; aba: string; area: 'tecnico' | 'pcp' | 'manut'
  status: string[]; fechados: string[]; campos: CampoReg[]; maquina?: boolean; dinheiro?: boolean; form?: string
  /** quem só PEDE (ex.: a Produção pedindo alteração) vê só estes campos; o resto (análise, aprovação, prazo…) é da Engenharia */
  pede?: string[]
}

const C_ = (k: string, rot: string, x: Partial<CampoReg> = {}): CampoReg => ({ k, rot, ...x })
const SETOR_PERFIL: Record<string, string> = { producao: 'Produção', pcp: 'PCP', almoxarife: 'Almoxarifado', manutencao: 'Manutenção', gerente: 'Gerência', comercial: 'Comercial', escritorio: 'Escritório', tecnico: 'Engenharia', rh: 'RH', dono: 'Diretoria' }
export const DEFS: DefReg[] = [
  { tipo: 'desenvolvimento', nome: 'Desenvolvimento', sing: 'desenvolvimento', aba: 'Desenvolvimento', area: 'tecnico', form: 'Desenvolvimento (check list e Form.021)', status: ['Em andamento', 'Aguardando cliente', 'Aprovado', 'Concluído', 'Cancelado'], fechados: ['Concluído', 'Aprovado', 'Cancelado', 'Ok'],
    campos: [C_('numero', 'Nº', { t: 'num' }), C_('codigo', 'Código JAF', { lista: true }), C_('titulo', 'Descrição', { lista: true, req: true }), C_('d.cliente', 'Cliente', { lista: true, sug: true }), C_('d.codigo_cliente', 'Código cliente'),
      C_('status', 'Posição', { sug: true }), C_('prazo', 'Prazo', { t: 'date' }), C_('concluido_em', 'Conclusão', { t: 'date' }), C_('responsavel', 'Responsável', { sug: true })] },
  { tipo: 'projeto', nome: 'Projetos', sing: 'projeto', aba: 'Projetos', area: 'tecnico', status: ['Em andamento', 'Concluído', 'Cancelado'], fechados: ['Concluído', 'Cancelado'],
    campos: [C_('numero', 'Sequência', { t: 'num' }), C_('data', 'Data início', { t: 'date' }), C_('codigo', 'Código', { lista: true }), C_('d.peca', 'Peça'), C_('d.operacao', 'Op.'),
      C_('titulo', 'Descrição', { t: 'area', lista: true, req: true, largo: true }), C_('d.aplicacao', 'Aplicação'), C_('responsavel', 'Responsável', { sug: true }), C_('prazo', 'Prazo final', { t: 'date' }),
      C_('d.aprovacao', 'Aprovação', { t: 'date' }), C_('d.resultado', 'Análise dos resultados', { t: 'area', largo: true }), C_('d.responsavel2', 'Responsável (análise)'), C_('concluido_em', 'Data conclusão', { t: 'date' }), C_('status', 'Status')] },
  { tipo: 'melhoria', nome: 'Melhorias', sing: 'melhoria', aba: 'Melhorias', area: 'tecnico', form: 'Form. Melhorias', status: ['Em andamento', 'Concluído', 'Cancelado'], fechados: ['Concluído', 'Cancelado'],
    pede: ['numero', 'data', 'titulo', 'd.situacao_atual', 'd.equipe'],
    campos: [C_('numero', 'Sequência', { t: 'num' }), C_('data', 'Data início', { t: 'date' }), C_('titulo', 'Objetivo da melhoria', { t: 'area', lista: true, req: true, largo: true }), C_('d.equipe', 'Equipe'),
      C_('d.situacao_atual', 'Descrição da situação atual', { t: 'area', largo: true }), C_('d.acoes_planejadas', 'Ações planejadas', { t: 'area', largo: true }),
      C_('d.acoes_implementadas', 'Ações implementadas', { t: 'area', largo: true }), C_('d.analise', 'Análise dos resultados', { t: 'area', largo: true }),
      C_('responsavel', 'Responsável', { sug: true }), C_('prazo', 'Prazo final', { t: 'date' }), C_('concluido_em', 'Data conclusão', { t: 'date' }), C_('status', 'Status')] },
  { tipo: 'alteracao', nome: 'Solicitações de alteração', sing: 'solicitação de alteração', aba: 'Sol. Alt.', area: 'tecnico', form: 'F. Sol. Alt.', status: ['Em andamento', 'Aprovada', 'Reprovada', 'Concluído'], fechados: ['Concluído', 'Reprovada'],
    pede: ['numero', 'data', 'd.solicitante', 'd.setor', 'codigo', 'titulo', 'd.justificativa'],
    campos: [C_('numero', 'Nº', { t: 'num' }), C_('data', 'Data', { t: 'date' }), C_('d.solicitante', 'Solicitante', { lista: true, sug: true }), C_('d.setor', 'Setor', { sug: true }),
      C_('codigo', 'Código (se for de uma peça)'), C_('titulo', 'Descrição da solicitação', { t: 'area', lista: true, req: true, largo: true }), C_('d.justificativa', 'Justificativa', { t: 'area', largo: true }),
      C_('d.analise', 'Análise do setor responsável', { t: 'area', largo: true }), C_('d.situacao', 'Situação (aprovada / reprovada)', { sug: true }), C_('d.aprovador', 'Aprovado por'),
      C_('responsavel', 'Responsável', { sug: true }), C_('prazo', 'Prazo', { t: 'date' }), C_('concluido_em', 'Conclusão', { t: 'date' }), C_('status', 'Status')] },
  { tipo: 'desvio', nome: 'Desvios', sing: 'desvio', aba: 'Desvios', area: 'tecnico', form: 'Form. Desvios', status: ['Aguardando', 'Aprovado', 'Reprovado'], fechados: ['Aprovado', 'Reprovado'],
    campos: [C_('numero', 'Sequência', { t: 'num' }), C_('data', 'Data', { t: 'date' }), C_('codigo', 'Ítem', { lista: true }), C_('d.qtd', 'Qde'), C_('titulo', 'Motivo', { t: 'area', lista: true, req: true, largo: true }),
      C_('d.solicitante', 'Solicitante', { sug: true }), C_('d.instrucoes', 'Instruções', { t: 'area', largo: true }), C_('d.documentacoes', 'Documentações', { t: 'area', largo: true }),
      C_('d.observacoes', 'Observações', { t: 'area', largo: true }), C_('responsavel', 'Aprovado por', { sug: true }), C_('concluido_em', 'Data aprovação', { t: 'date' }), C_('status', 'Status')] },
  { tipo: 'desenho', nome: 'Desenhos (lista mestra)', sing: 'desenho', aba: 'Qualidade Matriz', area: 'tecnico', status: ['Em uso', 'Obsoleto'], fechados: ['Obsoleto'],
    campos: [C_('codigo', 'Código', { lista: true, req: true }), C_('d.rev', 'Rev.', { lista: true }), C_('d.data_rev', 'Data da revisão', { t: 'date' }), C_('data', 'Data distribuição', { t: 'date' }),
      C_('responsavel', 'Responsável', { sug: true }), C_('d.tolerancia', 'Tolerância não especificada (norma)'), C_('d.obs', 'Observações', { t: 'area', largo: true }), C_('status', 'Situação')] },
  { tipo: 'copia', nome: 'Cópias controladas', sing: 'cópia controlada', aba: 'Contr. Distrib. Cópia Controlada', area: 'tecnico', form: 'Form. Distrib. Cópia Controlada', status: ['Distribuída', 'Recolhida'], fechados: ['Recolhida'],
    campos: [C_('numero', 'Nº', { t: 'num' }), C_('codigo', 'Nº desenho / norma', { lista: true, req: true }), C_('d.op', 'OP.'), C_('d.rev', 'Rev.', { lista: true }), C_('d.data_rev', 'Data revisão', { t: 'date' }),
      C_('d.local', 'Local de uso', { lista: true, sug: true }), C_('data', 'Data distribuição', { t: 'date' }), C_('status', 'Situação')] },
  { tipo: 'imds', nome: 'IMDS', sing: 'cadastro IMDS', aba: 'Cad. IMDS', area: 'tecnico', status: ['Em andamento', 'Concluído'], fechados: ['Concluído'],
    campos: [C_('codigo', 'Código JAF', { lista: true }), C_('d.codigo_cliente', 'Código cliente', { lista: true }), C_('d.cadastro_imds', 'Cadastro IMDS', { lista: true }), C_('prazo', 'Prazo', { t: 'date' }),
      C_('concluido_em', 'Concluído', { t: 'date' }), C_('status', 'Status')] },
  { tipo: 'ata', nome: 'Atas de reunião', sing: 'ata', aba: 'Atas de Reunião', area: 'tecnico', form: 'Form. Ata', status: ['Concluído', 'Pendências em aberto'], fechados: ['Concluído'],
    campos: [C_('numero', 'Sequência', { t: 'num' }), C_('data', 'Data', { t: 'date' }), C_('d.hora', 'Hora', { t: 'time' }), C_('d.local', 'Local', { sug: true }), C_('responsavel', 'Coordenador', { sug: true }),
      C_('d.participantes', 'Participantes', { t: 'area', largo: true }), C_('titulo', 'Pauta da reunião', { t: 'area', lista: true, req: true, largo: true }),
      C_('d.assuntos', 'Assuntos, responsável e data', { t: 'area', largo: true }), C_('status', 'Status')] },
  { tipo: 'setup', nome: 'Setup e produção', sing: 'setup', aba: 'Setup e Prod.', area: 'tecnico', status: ['Ativo', 'Inativo'], fechados: ['Inativo'],
    campos: [C_('codigo', 'Código', { lista: true, req: true }), C_('d.operacao', 'Operação', { lista: true }), C_('d.setup_horas', 'Set-up (horas)', { t: 'num', lista: true }), C_('d.pecas_hora', 'Peças por hora', { t: 'num', lista: true }),
      C_('d.liberar_qualidade', 'Liberar em conj. c/ qualidade?'), C_('d.plano_montagem', 'Elaborar plano de montagem?'), C_('d.planta', 'Planta', { sug: true }), C_('d.obs', 'Observações', { t: 'area', largo: true }), C_('status', 'Situação')] },
  // ---- PCP
  { tipo: 'servico_externo', nome: 'Serviço externo', sing: 'serviço externo', aba: 'Sol. Serv. Ext.', area: 'pcp', form: 'Sol. S. Ext.', status: ['Fora (no fornecedor)', 'Retornou'], fechados: ['Retornou'],
    campos: [C_('numero', 'Seq.', { t: 'num' }), C_('data', 'Data', { t: 'date' }), C_('codigo', 'Produto', { lista: true }), C_('d.descricao', 'Descrição'), C_('titulo', 'Descrição do serviço', { lista: true, req: true, sug: true }),
      C_('d.qtd', 'Qde', { t: 'num', lista: true }), C_('d.peso', 'Peso'), C_('d.of', 'OF'), C_('d.fornecedor', 'Fornecedor', { lista: true, sug: true }), C_('d.saida', 'Data saída', { t: 'date' }),
      C_('concluido_em', 'Data retorno', { t: 'date' }), C_('d.qtd_retorno', 'Qde retornada', { t: 'num' }), C_('responsavel', 'Emitido por', { sug: true }), C_('status', 'Status')] },
  { tipo: 'requisicao', nome: 'Requisições de componentes', sing: 'requisição', aba: 'Req. Componentes', area: 'pcp', form: 'Req. Comp.', status: ['Em aberto', 'Entregue'], fechados: ['Entregue'],
    campos: [C_('numero', 'Nº Req.', { t: 'num' }), C_('data', 'Data', { t: 'date' }), C_('codigo', 'Cód. componente', { lista: true, req: true }), C_('d.qtd', 'Qde req.', { t: 'num', lista: true }), C_('d.of', 'OF', { lista: true }),
      C_('responsavel', 'Solicitado por', { sug: true }), C_('d.entregue', 'Qde entregue', { t: 'num' }), C_('d.entregue_por', 'Entregue por', { sug: true }), C_('concluido_em', 'Data entrega', { t: 'date' }), C_('status', 'Status')] },
  // ---- Manutenção
  { tipo: 'servico_manut', nome: 'Serviços de manutenção', sing: 'serviço', aba: 'Serviços', area: 'manut', maquina: true, dinheiro: true, status: ['Pago', 'Aguardando', 'Atenção'], fechados: ['Pago'],
    campos: [C_('data', 'Data', { t: 'date' }), C_('maquina_id', 'Equipamento'), C_('d.equipamento', 'Equipamento (texto)', { lista: true }), C_('titulo', 'Descrição', { lista: true, req: true, largo: true }),
      C_('d.inicio', 'Início', { t: 'time' }), C_('d.termino', 'Término', { t: 'time' }), C_('d.horas', 'Total horas', { t: 'num' }), C_('d.prestador', 'Fornecedor / prestador', { lista: true, sug: true }),
      C_('d.valor_hora', 'R$ hora', { t: 'dinheiro' }), C_('valor', 'Total', { t: 'dinheiro', lista: true }), C_('d.vencimento', 'Vencimento', { t: 'date' }), C_('d.os', 'Relatório / OS'), C_('d.obs', 'Observações', { t: 'area', largo: true }), C_('status', 'Status')] },
  { tipo: 'gasto_manut', nome: 'Gastos da manutenção', sing: 'gasto', aba: 'Fluxo de Caixa', area: 'manut', dinheiro: true, status: ['Pago', 'Aguardando', 'Atenção'], fechados: ['Pago'],
    campos: [C_('data', 'Data', { t: 'date' }), C_('d.documento', 'Documento'), C_('titulo', 'Descrição', { lista: true, req: true, largo: true }), C_('d.qtd', 'Qde', { t: 'num' }), C_('d.fornecedor', 'Fornecedor', { lista: true, sug: true }),
      C_('valor', 'Valor', { t: 'dinheiro', lista: true }), C_('d.vencimento', 'Vencimento', { t: 'date' }), C_('d.plano', 'Plano de contas', { sug: true }), C_('d.grupo', 'Peça / Máq. / Disp.', { sug: true }),
      C_('d.codigo', 'Código'), C_('d.obs', 'Observações', { t: 'area', largo: true }), C_('status', 'Status')] },
  { tipo: 'peca_critica', nome: 'Peças críticas', sing: 'peça crítica', aba: 'Máquinas Críticas', area: 'manut', maquina: true, status: ['Ok', 'Comprar'], fechados: [],
    campos: [C_('maquina_id', 'Máquina'), C_('d.maquinas', 'Relação de máquinas', { lista: true }), C_('titulo', 'Peça', { lista: true, req: true }), C_('d.fornecedor', 'Fornecedor', { sug: true }), C_('valor', 'Preço', { t: 'dinheiro' }),
      C_('d.vida_dias', 'Vida útil (dias)', { t: 'num' }), C_('data', 'Data da troca', { t: 'date' }), C_('prazo', 'Próxima revisão', { t: 'date' }), C_('d.qtd', 'Qde em estoque', { t: 'num', lista: true }),
      C_('d.min', 'Estoque mín.', { t: 'num' }), C_('d.max', 'Estoque máx.', { t: 'num' }), C_('d.obs', 'Observações', { t: 'area', largo: true }), C_('status', 'Status')] },
  { tipo: 'pendencia', nome: 'Pendências', sing: 'pendência', aba: 'Pendências da preventiva', area: 'manut', maquina: true, status: ['Aberta', 'Concluído'], fechados: ['Concluído', 'Ok'],
    campos: [C_('maquina_id', 'Máquina'), C_('titulo', 'O que precisa ser feito', { t: 'area', lista: true, req: true, largo: true }), C_('prazo', 'Prazo', { t: 'date' }), C_('responsavel', 'Responsável', { sug: true }),
      C_('d.os', 'OS'), C_('concluido_em', 'Concluído em', { t: 'date' }), C_('status', 'Status')] },
  { tipo: 'ferramentaria', nome: 'Ferramentaria', sing: 'serviço de ferramentaria', aba: 'Ferramentaria', area: 'manut', dinheiro: true, status: ['Aguardando', 'Concluído'], fechados: ['Concluído'],
    campos: [C_('data', 'Data', { t: 'date' }), C_('titulo', 'Descrição', { lista: true, req: true, largo: true }), C_('d.fornecedor', 'Fornecedor', { lista: true, sug: true }), C_('prazo', 'Prazo', { t: 'date' }),
      C_('valor', 'Preço', { t: 'dinheiro', lista: true }), C_('d.obs', 'Observações', { t: 'area', largo: true }), C_('status', 'Status')] },
]
export const NOMES_REG = Object.fromEntries(DEFS.map(d => [d.tipo, d.nome])) as Record<TipoRegistro, string>
export const defReg = (t: string | null | undefined): DefReg | undefined => DEFS.find(d => d.tipo === t)

const VER: Record<DefReg['area'], Acao> = { tecnico: 'tecnico_ver', pcp: 'pcp_reg_ver', manut: 'manut_gestao' }
const EDITAR: Record<DefReg['area'], Acao> = { tecnico: 'tecnico_editar', pcp: 'pcp_reg_editar', manut: 'manut_editar' }
export const podeVerReg = (d: DefReg) => Perm.pode(VER[d.area])
export const podeEditarReg = (d: DefReg) => Perm.pode(EDITAR[d.area])
// qualquer pessoa (menos o RH) pode pedir uma alteração ou sugerir uma melhoria
const podeCriar = (d: DefReg) => podeEditarReg(d) || ((d.tipo === 'alteracao' || d.tipo === 'melhoria') && Perm.pode('produtos_ver'))

// ---------------------------------------------------------------- valores
const ler = (r: Partial<RegistroFab>, k: string): unknown => k.startsWith('d.') ? (r.dados || {})[k.slice(2)] : (r as Record<string, unknown>)[k]
const fechado = (d: DefReg, r: RegistroFab) => d.fechados.includes(r.status || '') || (!!r.concluido_em && !['peca_critica', 'setup', 'desenho', 'copia'].includes(d.tipo))
const atrasado = (d: DefReg, r: RegistroFab) => !fechado(d, r) && !!r.prazo && r.prazo < U.hoje()
function mostrar(c: CampoReg, v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (c.k === 'maquina_id') { const m = S.get('maquinas', String(v)); return m ? (m.codigo ? m.codigo + ' · ' : '') + m.nome : '' }
  if (c.t === 'date') return U.data(String(v))
  if (c.t === 'dinheiro') return U.moeda(Number(v))
  if (c.t === 'num') return U.qtd(Number(v))
  return String(v)
}
const corStatus = (d: DefReg, r: RegistroFab): 'verde' | 'vermelho' | 'amarelo' | 'azul' | 'cinza' =>
  atrasado(d, r) ? 'vermelho' : fechado(d, r) ? 'verde' : /comprar|aten|aguard|reprov/i.test(r.status || '') ? 'amarelo' : 'azul'

// ---------------------------------------------------------------- tela
export function TelaRegistros({ r }: { r: Rota }) {
  const d = defReg(r.sub)
  if (!d) return <Vazio icone="lista" titulo="Controle não encontrado"><a className="btn pri" href="#/inicio">Início</a></Vazio>
  if (!podeVerReg(d)) return <Vazio icone="cadeado" titulo="Sem acesso" texto="Seu perfil não vê este controle." />
  return <ComTabelas tabs={['registros', 'produtos']}>{() => <Lista d={d} r={r} />}</ComTabelas>
}
export const tituloRegistros = (r: Rota) => defReg(r.sub)?.nome || 'Controles'

function Linha({ d, x }: { d: DefReg; x: RegistroFab }) {
  const cs = d.campos.filter(c => c.lista)
  const [prim, ...resto] = cs.map(c => mostrar(c, ler(x, c.k))).filter(Boolean)
  const num = x.numero ? `${x.numero} · ` : ''
  const quando = x.prazo && !fechado(d, x) ? 'prazo ' + U.dataCurta(x.prazo) : x.data ? U.dataCurta(x.data) : ''
  return <div className="linha clicavel" data-reg={x.id} onClick={() => void abrir(d, x)}><div className="meio"><b>{num}{prim || x.titulo || x.codigo || '—'}</b>
    <small>{[...resto.filter(v => !d.dinheiro || !v.startsWith('R$')), x.responsavel, quando].filter(Boolean).join(' · ')}</small></div>
    <div className="lado">{d.dinheiro && x.valor ? <b>{U.moeda(x.valor)}</b> : null}{x.status ? <span className={`tag t-${corStatus(d, x)}`}>{atrasado(d, x) ? 'Atrasado' : x.status}</span> : null}</div></div>
}

function Lista({ d, r }: { d: DefReg; r: Rota }) {
  const [f, setF] = useLembrar('reg.f.' + d.tipo, d.fechados.length ? 'aberto' : 'todos')
  const [busca, setBusca] = useLembrar('reg.b.' + d.tipo, '')
  const [ano, setAno] = useLembrar('reg.a.' + d.tipo, '')
  const todos = S.lista('registros').filter(x => x.tipo === d.tipo)
  // link direto para um registro (#/reg/tipo?id=…)
  useEffect(() => { const id = r.q.get('id'); const x = id && S.get('registros', id); if (x) void abrir(d, x) }, [r.hash]) // eslint-disable-line react-hooks/exhaustive-deps
  const anos = U.unicos(todos.map(x => (x.data || '').slice(0, 4)).filter(Boolean)).sort().reverse()
  let l = ano ? todos.filter(x => (x.data || '').startsWith(ano)) : todos
  const nAb = todos.filter(x => !fechado(d, x)).length, nAt = todos.filter(x => atrasado(d, x)).length
  if (f === 'aberto') l = l.filter(x => !fechado(d, x))
  else if (f === 'atrasado') l = l.filter(x => atrasado(d, x))
  else if (f === 'fechado') l = l.filter(x => fechado(d, x))
  else if (f !== 'todos') l = l.filter(x => x.status === f)
  l = busca.trim() ? U.buscar(l, busca, x => [String(x.numero || ''), x.codigo || '', x.titulo || '', x.responsavel || '', x.status || '', ...Object.values(x.dados || {}).map(v => String(v))])
    : U.ordenar(l, x => (x.data || x.prazo || '') + String(x.numero || 0).padStart(6, '0'), true)
  const somaValor = d.dinheiro ? U.soma(l, 'valor') : 0
  const chips = d.tipo === 'peca_critica'
    ? [{ v: 'todos', t: 'Todas' }, { v: 'Comprar', t: 'Comprar', n: todos.filter(x => x.status === 'Comprar').length || null }, { v: 'atrasado', t: 'Revisão vencida', n: nAt || null }]
    : [...(d.fechados.length ? [{ v: 'aberto', t: 'Em aberto', n: nAb }, { v: 'atrasado', t: 'Atrasados', n: nAt || null }, { v: 'fechado', t: d.fechados[0] === 'Pago' ? 'Pagos' : 'Concluídos' }] : []), { v: 'todos', t: 'Todos' }]
  return <>
    <Cab titulo={d.nome} sub={`Planilha: aba “${d.aba}”${d.form ? ` · impresso “${d.form}”` : ''}`}>
      {podeCriar(d) && <Btn txt={d.tipo === 'alteracao' ? 'Solicitar alteração' : d.tipo === 'melhoria' ? 'Sugerir melhoria' : 'Novo'} icone="mais" cls="pri" data-reg-acao="novo" onClick={() => void formReg(d)} />}
      <Btn txt="PDF" icone="imprimir" cls="fantasma" onClick={() => pdfLista(d, l)} />
      <Btn txt="Excel" icone="planilha" cls="fantasma" onClick={() => excel(d.nome + '.xlsx', [[d.aba.slice(0, 30), l.map(x => linhaExcel(d, x))]])} />
    </Cab>
    <div className="barra-filtros"><BuscaLista id="bReg" valor={busca} placeholder="Buscar em qualquer campo" aoMudar={setBusca} />
      {anos.length > 1 && <select value={ano} onChange={(e) => setAno(e.target.value)} aria-label="Ano"><option value="">Todos os anos</option>{anos.map(a => <option key={a}>{a}</option>)}</select>}</div>
    <Chips atual={f} aoEscolher={setF} opcoes={chips} />
    {d.dinheiro && l.length > 0 && <p className="sub mt">{U.plural(l.length, 'lançamento')} · total <b>{U.moeda(somaValor)}</b></p>}
    <div className="mt" id="lReg"><Paginado itens={l} render={x => <Linha key={x.id} d={d} x={x} />} vazio={<Vazio icone="lista" titulo="Nada aqui" texto={podeCriar(d) ? 'Toque em Novo para lançar.' : ''} />} /></div>
  </>
}

const linhaExcel = (d: DefReg, x: RegistroFab) => Object.fromEntries(d.campos.map(c => { const v = ler(x, c.k)
  return [c.rot, c.k === 'maquina_id' ? mostrar(c, v) : c.t === 'date' && v ? U.data(String(v)) : v ?? ''] }))

async function pdfLista(d: DefReg, l: RegistroFab[]) {
  const cs = d.campos.filter(c => c.lista || c.k === 'numero' || c.k === 'status' || c.k === 'prazo' || c.k === 'data').slice(0, 8)
  const blob = await pdfTabela(d.nome, `${U.plural(l.length, 'registro')} · ${U.data(U.hoje())}`, cs.map(c => ({ t: c.rot, alinhar: c.t === 'dinheiro' || c.t === 'num' ? 'right' as const : undefined })),
    l.map(x => cs.map(c => mostrar(c, ler(x, c.k)))), { deitado: cs.length > 5 })
  await entregar(blob, d.nome + '.pdf')
}

const CHECK_DESENV: [string, string][] = [
  ['Solicitação de Desenvolvimento (Form.032)', 'Vendas'], ['Recursos para Fabricação (Disp. e Ferram.)', 'Dpto. Téc.'], ['Comprar Matéria Prima', 'Compras'],
  ['Cadastrar Produto (Cad. Téc. e PCP)', 'Dpto. Téc.'], ['Cadastrar Preço na Planilha de Vendas', 'Vendas'], ['Elaborar Documentos técnicos', 'Dpto. Téc.'],
  ['Fabricar as Amostras', 'PCP / Prod.'], ['Elaborar PPAP', 'Qualidade']]

// ficha impressa de um registro (os formulários da planilha: F. Sol. Alt., Form. Desvios, Form. Ata, Sol. S. Ext.…)
async function pdfFicha(d: DefReg, x: RegistroFab) {
  const blob = await pdfDocumento(`${d.form || d.nome}${x.numero ? ' nº ' + x.numero : ''}`, d.nome, (c) => {
    const curtos = d.campos.filter(k => !k.largo).map(k => [k.rot, mostrar(k, ler(x, k.k))])
    c.tabela({ ...c.estilo, startY: c.y + 2, theme: 'grid', body: curtos, columnStyles: { 0: { cellWidth: 55, fontStyle: 'bold', fillColor: [240, 243, 247] } } })
    let y = c.doc.lastAutoTable.finalY + 6
    for (const k of d.campos.filter(k => k.largo)) {
      y = c.texto(k.rot, y, { tam: 9.5, negrito: true })
      y = c.texto(mostrar(k, ler(x, k.k)) || '—', y, { tam: 10 }) + 3
    }
    if (d.tipo === 'desenvolvimento') {
      // aba "Check List" da planilha do Depto. Técnico: as etapas de todo desenvolvimento, com quem faz
      y = c.texto('Check list do desenvolvimento', y + 2, { tam: 11, negrito: true })
      c.tabela({ ...c.estilo, startY: y, theme: 'grid', head: [['Etapa', 'Responsável', 'Prazo', 'Status', 'Data realizada']],
        body: CHECK_DESENV.map(([e, r]) => [e, r, '', '', '']), styles: { ...c.estilo.styles, minCellHeight: 8 }, columnStyles: { 0: { cellWidth: 72 } } })
      // aba "Aprov. Desenv." = Form.021, em folha própria para ir à produção
      c.doc.addPage()
      let y2 = c.texto('APROVAÇÃO DE PROCESSO PARA DESENVOLVIMENTO', 20, { tam: 13, negrito: true, alinhar: 'center' })
      y2 = c.texto('Form.021/0', y2, { tam: 8.5, cor: 110, alinhar: 'center' })
      const prod = x.codigo ? S.lista('produtos').find(p => p.codigo === x.codigo) : null
      c.tabela({ ...c.estilo, startY: y2 + 3, theme: 'grid', body: [['Cód. produto', x.codigo || '', 'Descrição', x.titulo || ''], ['Cliente', String(ler(x, 'd.cliente') || ''), 'Operação', prod?.operacao || '']],
        columnStyles: { 0: { cellWidth: 28, fontStyle: 'bold', fillColor: [240, 243, 247] }, 2: { cellWidth: 24, fontStyle: 'bold', fillColor: [240, 243, 247] } } })
      c.tabela({ ...c.estilo, startY: c.doc.lastAutoTable.finalY + 5, theme: 'grid', head: [['Especificado', 'Encontrado', 'Laudo']],
        body: Array.from({ length: 12 }, () => ['', '', '']), styles: { ...c.estilo.styles, minCellHeight: 9 } })
      const ya = Math.min(c.doc.lastAutoTable.finalY + 26, c.H - 22), w = (c.W - 28 - 16) / 3
      c.assinatura('Produção', 'Data: ____/____/______', 14, ya, w)
      c.assinatura('Depto. Técnico', 'Data: ____/____/______', 14 + w + 8, ya, w)
      c.assinatura('Qualidade', 'Data: ____/____/______', 14 + 2 * (w + 8), ya, w)
    }
    if (['alteracao', 'desvio', 'melhoria', 'ata', 'servico_externo'].includes(d.tipo)) {
      const yy = Math.max(y + 22, 255)
      c.assinatura('Solicitante', String(ler(x, 'd.solicitante') || x.responsavel || ''), 14, yy, 80)
      c.assinatura('Aprovação', String(ler(x, 'd.aprovador') || ''), c.W - 94, yy, 80)
    }
  })
  await entregar(blob, `${d.nome}${x.numero ? ' ' + x.numero : ''}.pdf`)
}

// ---------------------------------------------------------------- abrir / editar
async function abrir(d: DefReg, x: RegistroFab) {
  if (podeEditarReg(d)) return formReg(d, x)
  return modal({
    titulo: `${d.sing[0].toUpperCase() + d.sing.slice(1)}${x.numero ? ' nº ' + x.numero : ''}`, largura: 'larga',
    corpo: <dl className="dl">{d.campos.map(c => { const v = mostrar(c, ler(x, c.k)); return v ? <div key={c.k}><dt>{c.rot}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{v}</dd></div> : null })}</dl>,
    botoes: [{ txt: 'Imprimir', cls: 'sec', validar: false, acao: async () => { await pdfFicha(d, x); return false } }],
  })
}

export async function formReg(d: DefReg, x: Partial<RegistroFab> = {}): Promise<unknown> {
  // abre de qualquer lugar (Início, barra de baixo): garante as tabelas antes de montar a janela
  await S.garantir(['registros', 'produtos'])
  const novo = !x.id
  const todos = S.lista('registros').filter(r => r.tipo === d.tipo)
  const sugest = (c: CampoReg) => c.k === 'status' ? usados([...d.status, ...todos.map(r => r.status)]) : usados(todos.map(r => ler(r, c.k) as string))
  const podeEd = podeEditarReg(d)
  // quem só pede (não é da Engenharia) vê só os campos do pedido, com o nome e o setor já preenchidos
  const soPedido = novo && !podeEd && !!d.pede
  const inicial: Record<string, string> = soPedido ? { 'd.solicitante': API.sessao?.nome || '', 'd.setor': SETOR_PERFIL[API.sessao?.perfil || ''] || '' } : {}
  const campo = (c: CampoReg) => {
    const v = ler(x, c.k) ?? inicial[c.k]
    const nome = c.k.startsWith('d.') ? 'd__' + c.k.slice(2) : c.k
    if (c.k === 'maquina_id') return <ComboMaquina key={c.k} id={'reg_' + d.tipo + '_maq'} nome="maquina_id" rotulo={c.rot} placeholder="Código ou nome" inicial={S.get('maquinas', v as string)} />
    if (c.k === 'numero' && novo && ['desenvolvimento', 'projeto', 'melhoria', 'alteracao', 'desvio', 'copia', 'ata', 'servico_externo'].includes(d.tipo))
      return <Campo key={c.k} nome={nome} rotulo={c.rot} tipo="num" valor={null} placeholder="automático" />
    const tipo = c.t === 'area' ? 'area' : c.t === 'date' ? 'date' : c.t === 'time' ? 'time' : c.t === 'num' ? 'num' : c.t === 'dinheiro' ? 'dinheiro' : 'text'
    const val = c.t === 'num' || c.t === 'dinheiro' ? U.campoNum(v as number) : c.k === 'status' && novo ? d.status[0] : c.k === 'data' && novo ? U.hoje() : (v as string)
    const lista = c.sug || c.k === 'status' ? { list: `sug_${d.tipo}_${nome}` } : {}
    return <div key={c.k} className={c.largo || c.t === 'area' ? 'campo-largo' : ''}>
      <Campo nome={nome} rotulo={c.rot} tipo={tipo} req={c.req} valor={val} linhas={3} attrs={lista} />
      {(c.sug || c.k === 'status') && <datalist id={`sug_${d.tipo}_${nome}`}>{sugest(c).map(s => <option key={s} value={s} />)}</datalist>}</div>
  }
  const visiveis = soPedido ? d.campos.filter(c => d.pede!.includes(c.k)) : d.campos
  const curtos = visiveis.filter(c => !(c.largo || c.t === 'area')), longos = visiveis.filter(c => c.largo || c.t === 'area')
  const pares: CampoReg[][] = []
  for (let i = 0; i < curtos.length; i += 3) pares.push(curtos.slice(i, i + 3))
  return modal({
    titulo: novo ? `${d.tipo === 'alteracao' ? 'Solicitar alteração' : d.tipo === 'melhoria' ? 'Sugerir melhoria' : 'Novo: ' + d.sing}` : `${d.sing[0].toUpperCase() + d.sing.slice(1)}${x.numero ? ' nº ' + x.numero : ''}`,
    largura: 'larga',
    corpo: <>{soPedido && <p className="nota">{d.tipo === 'alteracao' ? 'Conte o que precisa mudar e por quê. A Engenharia recebe, analisa e responde aqui mesmo.' : 'Conte a ideia. A Engenharia recebe e acompanha até concluir.'}</p>}
      {pares.map((p, i) => <div key={i} className="linha-campos">{p.map(campo)}</div>)}{longos.map(campo)}</>,
    botoes: [
      ...(!novo ? [{ txt: 'Imprimir', cls: 'sec', validar: false, acao: async () => { await pdfFicha(d, S.get('registros', x.id!) || (x as RegistroFab)); return false } }] : []),
      ...(!novo && podeEd ? [{ txt: 'Excluir', cls: 'fantasma', validar: false, acao: async () => {
        if (!await confirmar(`Excluir este registro de ${d.nome.toLowerCase()}?`, { ok: 'Excluir', perigo: true })) return false
        await API.rpc('excluir_registro', { p_id: x.id }); await App.gravou(['registros'], { inteira: ['registros'] }); aviso('Excluído.'); return true
      } }] : []),
      { txt: novo ? 'Lançar' : 'Salvar', acao: async (f: HTMLFormElement) => {
        const v = lerForm(f)
        const p: Record<string, unknown> = { tipo: d.tipo, id: x.id || f.dataset.envio || (f.dataset.envio = U.uuid()) }
        const dados: Record<string, unknown> = { ...(x.dados || {}) }
        for (const [k, val] of Object.entries(v)) {
          if (k.startsWith('d__')) { const kk = k.slice(3); if (val === '' || val === null) delete dados[kk]; else dados[kk] = val }
          else p[k] = val === '' ? null : val
        }
        p.dados = dados
        const r = await API.rpc<{ id: string; numero: number | null }>('salvar_registro', { p })
        await App.gravou(['registros']); aviso(novo ? `Lançado${r.numero ? ' com o nº ' + r.numero : ''}.` : 'Salvo.'); return r.id
      } },
    ],
  })
}

// ---------------------------------------------------------------- painel de uma área (contagem por controle)
export function PainelControles({ area, titulo, sub }: { area: DefReg['area']; titulo: string; sub: string }) {
  return <ComTabelas tabs={['registros']}>{() => {
    const defs = DEFS.filter(d => d.area === area && podeVerReg(d))
    const regs = S.lista('registros')
    return <>
      <Cab titulo={titulo} sub={sub} />
      <div className="grade g-auto">{defs.map(d => { const l = regs.filter(x => x.tipo === d.tipo)
        const ab = l.filter(x => !fechado(d, x)).length, at = l.filter(x => atrasado(d, x)).length
        const ano = U.hoje().slice(0, 4), noAno = l.filter(x => (x.data || '').startsWith(ano)).length
        return <a key={d.tipo} className="card linha-card" href={'#/reg/' + d.tipo} style={{ display: 'block', color: 'inherit', textDecoration: 'none' }} data-painel={d.tipo}>
          <b>{d.nome}</b><div className="sub">aba “{d.aba}”</div>
          <p className="mt" style={{ marginBottom: 0 }}>{d.fechados.length ? <><b>{ab}</b> em aberto{at ? <> · <b style={{ color: 'var(--vermelho)' }}>{at} atrasado{at > 1 ? 's' : ''}</b></> : null}</> : <><b>{l.length}</b> cadastrados</>}
            <span className="sub"> · {noAno} em {ano}</span>{d.dinheiro ? <span className="sub"> · {U.moeda0(U.soma(l.filter(x => (x.data || '').startsWith(ano)), 'valor'))}</span> : null}</p></a> })}</div>
    </>
  }}</ComTabelas>
}
