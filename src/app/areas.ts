/* Organização do sistema: poucas ÁREAS no menu (na ordem do que mais se usa) e, dentro de cada uma, as abas de cima.
 * O menu e a barra de baixo do celular mostram só o que o perfil pode abrir. */
import { Perm, type Acao } from '../lib/perm.ts'
import type { Perfil } from '../lib/tipos.ts'
import type { Rota } from '../ui/ganchos.ts'
import type { NomeIcone } from '../ui/icones.tsx'

export interface SubAba { rota: string; rot: string; perm: Acao; nao?: Acao; chaves?: string }
export interface Area { id: string; rot: string; ic: NomeIcone; desc: string; subs: SubAba[] }

export const AREAS: Area[] = [
  { id: 'inicio', rot: 'Início', ic: 'inicio', desc: 'Resumo do dia e atalhos', subs: [{ rota: 'inicio', rot: 'Início', perm: 'todos' }] },
  { id: 'almoxarifado', rot: 'Almoxarifado', ic: 'estoque', desc: 'Peças, retiradas, entradas, máquinas e manutenção', subs: [
    { rota: 'pecas', rot: 'Peças', perm: 'estoque_ver', chaves: 'estoque saldo prateleira inventário contar código' },
    { rota: 'movimentos', rot: 'Movimentações', perm: 'historico_mov', chaves: 'retiradas entradas histórico quem tirou' },
    { rota: 'maquinas', rot: 'Máquinas e manutenção', perm: 'almox', chaves: 'chamado quebrou preventiva corretiva' },
  ] },
  { id: 'compras', rot: 'Compras', ic: 'compras', desc: 'O que falta, pedidos e fornecedores', subs: [
    { rota: 'compras/lista', rot: 'O que comprar', perm: 'compras', chaves: 'lista de compras faltando mínimo' },
    { rota: 'compras', rot: 'Pedidos', perm: 'compras', chaves: 'pedido de compra receber chegou' },
    { rota: 'fornecedores', rot: 'Fornecedores', perm: 'compras', chaves: 'fornecedor contato telefone' },
  ] },
  { id: 'pcp', rot: 'PCP', ic: 'producao', desc: 'Planejamento e controle da produção: ordens de produção', subs: [
    { rota: 'producao', rot: 'Ordens de produção', perm: 'pcp', chaves: 'op fila produzindo pronta entrega planejamento controle' },
    { rota: 'equipe', rot: 'Equipe', perm: 'pcp', nao: 'rh_ver', chaves: 'funcionários pessoas' },
  ] },
  { id: 'rh', rot: 'RH', ic: 'equipe', desc: 'Pessoas, ponto, férias, treinamentos e segurança', subs: [
    { rota: 'rh', rot: 'Pessoas', perm: 'rh_ver', chaves: 'funcionários cadastro ficha admissão experiência desligamento' },
    { rota: 'rh/ponto', rot: 'Ponto', perm: 'rh_ver', chaves: 'horas extras cartão de ponto hora extra faltas atrasos fechamento contabilidade' },
    { rota: 'rh/ferias', rot: 'Férias', perm: 'rh_ver', chaves: 'ausências férias vencidas atestado afastamento licença inss' },
    { rota: 'rh/treinamentos', rot: 'Treinamentos', perm: 'rh_ver', chaves: 'matriz competências versatilidade procedimentos sgq reciclagem certificado' },
    { rota: 'rh/seguranca', rot: 'EPI e exames', perm: 'rh_ver', chaves: 'epi aso exame médico segurança do trabalho nr' },
    { rota: 'rh/disciplina', rot: 'Advertências', perm: 'rh_ver', chaves: 'advertência suspensão disciplina ocorrência' },
    { rota: 'rh/processos', rot: 'Processos', perm: 'rh_sensivel', chaves: 'processo trabalhista advogado ação justiça' },
    { rota: 'rh/organograma', rot: 'Organograma', perm: 'rh_ver', chaves: 'cargos hierarquia chefe' },
    { rota: 'rh/relatorios', rot: 'Relatórios', perm: 'rh_ver', chaves: 'turnover absenteísmo custo folha' },
    { rota: 'rh/indicadores', rot: 'Indicadores', perm: 'rh_sensivel', chaves: 'indicadores rotatividade turnover receita custo por funcionário dashboard painel experiência escolaridade faixa etária' },
    { rota: 'rh/ajustes', rot: 'Ajustes', perm: 'rh_editar', chaves: 'cargos setores feriados jornada tolerância' },
  ] },
  { id: 'financeiro', rot: 'Financeiro', ic: 'dinheiro', desc: 'Contas, caixa e clientes', subs: [
    { rota: 'financeiro', rot: 'Contas a pagar e receber', perm: 'financeiro', chaves: 'boleto vencimento pagar receber' },
    { rota: 'financeiro/fluxo', rot: 'Fluxo de caixa', perm: 'financeiro', chaves: 'saldo caixa previsão' },
    { rota: 'clientes', rot: 'Clientes', perm: 'clientes', chaves: 'cliente cnpj' },
  ] },
  { id: 'relatorios', rot: 'Relatórios', ic: 'relatorio', desc: 'Números do estoque, compras e consumo', subs: [{ rota: 'relatorios', rot: 'Relatórios', perm: 'relatorios' }] },
  { id: 'admin', rot: 'Administração', ic: 'admin', desc: 'Acessos, empresa e cópia dos dados', subs: [{ rota: 'admin', rot: 'Administração', perm: 'config', chaves: 'acessos usuários senha backup cópia' }] },
  { id: 'ajuda', rot: 'Ajuda', ic: 'ajuda', desc: 'Tutoriais e dúvidas', subs: [{ rota: 'ajuda', rot: 'Ajuda', perm: 'todos', chaves: 'tutorial manual dúvida como faço' }] },
]

export const subPode = (s: SubAba): boolean => Perm.pode(s.perm) && !(s.nao && Perm.pode(s.nao))
export const subsDe = (a: Area): SubAba[] => a.subs.filter(subPode)
export const areasVisiveis = (): Area[] => AREAS.filter(a => subsDe(a).length > 0)

// telas de detalhe → aba da lista
const DETALHE: Record<string, string> = { peca: 'pecas', pedido: 'compras', fornecedor: 'fornecedores', maquina: 'maquinas', cliente: 'clientes' }
// endereço atual → a aba (rota) que fica marcada
export function chaveDaRota(r: Rota): string {
  if (!r.nome) return 'inicio'
  if (r.nome === 'funcionario') return Perm.pode('rh_ver') ? 'rh' : 'equipe'
  if (r.nome === 'equipe') return Perm.pode('rh_ver') ? 'rh' : 'equipe'
  if ((r.nome === 'compras' && r.sub === 'lista') || (r.nome === 'financeiro' && r.sub === 'fluxo')) return r.nome + '/' + r.sub
  if (r.nome === 'rh' && r.sub) return 'rh/' + r.sub
  return DETALHE[r.nome] || r.nome
}
export function ondeEstou(r: Rota): { area: Area | null; sub: SubAba | null } {
  const k = chaveDaRota(r)
  for (const a of AREAS) for (const s of a.subs) if (s.rota === k) return { area: a, sub: s }
  return { area: null, sub: null }
}

export const areaDaRota = (rota: string): string | undefined => AREAS.find(a => a.subs.some(s => s.rota === rota))?.id

// barra de baixo do celular (o botão do meio é o que a pessoa mais faz)
export type AbaBaixo = [rota: string, rot: string, ic: NomeIcone]
const BAIXO: Partial<Record<Perfil, AbaBaixo[]>> = {
  dono: [['inicio', 'Início', 'inicio'], ['pecas', 'Almox.', 'estoque'], ['retirar', 'Retirar', 'retirar'], ['rh', 'RH', 'equipe'], ['menu', 'Menu', 'menu']],
  escritorio: [['inicio', 'Início', 'inicio'], ['pecas', 'Almox.', 'estoque'], ['retirar', 'Retirar', 'retirar'], ['financeiro', 'Contas', 'dinheiro'], ['menu', 'Menu', 'menu']],
  almoxarife: [['inicio', 'Início', 'inicio'], ['pecas', 'Peças', 'estoque'], ['retirar', 'Retirar', 'retirar'], ['compras/lista', 'Comprar', 'compras'], ['menu', 'Menu', 'menu']],
  producao: [['inicio', 'Início', 'inicio'], ['pecas', 'Estoque', 'estoque'], ['retirar', 'Retirar', 'retirar'], ['producao', 'Ordens', 'producao'], ['menu', 'Menu', 'menu']],
  pcp: [['inicio', 'Início', 'inicio'], ['producao', 'Ordens', 'producao'], ['novaOrdem', 'Nova ordem', 'mais'], ['pecas', 'Estoque', 'estoque'], ['menu', 'Menu', 'menu']],
  gerente: [['inicio', 'Início', 'inicio'], ['pecas', 'Almox.', 'estoque'], ['retirar', 'Retirar', 'retirar'], ['rh', 'Equipe', 'equipe'], ['menu', 'Menu', 'menu']],
  rh: [['inicio', 'Início', 'inicio'], ['rh', 'Pessoas', 'equipe'], ['rh/ponto', 'Ponto', 'relogio'], ['rh/ferias', 'Férias', 'calendario'], ['menu', 'Menu', 'menu']],
}
export const abasDeBaixo = (p: Perfil): AbaBaixo[] => BAIXO[p] || BAIXO.producao!
