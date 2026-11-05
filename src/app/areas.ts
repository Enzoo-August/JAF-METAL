/* Organização do sistema, por login:
 * - quem vê a empresa toda (Dono, Escritório): ÁREAS agrupadas no menu e, dentro de cada uma, as abas de cima;
 * - quem cuida de uma parte (RH, PCP, Almoxarifado…): as próprias telas direto no menu da esquerda, sem abas em cima.
 * Área nova: basta entrar em AREAS (com o grupo) e cada login já a recebe do jeito certo, só se tiver permissão. */
import { Perm, type Acao } from '../lib/perm.ts'
import type { Perfil } from '../lib/tipos.ts'
import type { Rota } from '../ui/ganchos.ts'
import type { NomeIcone } from '../ui/icones.tsx'

export interface SubAba { rota: string; rot: string; perm: Acao; nao?: Acao; chaves?: string; ic?: NomeIcone; grupo?: string }
export interface Area { id: string; rot: string; ic: NomeIcone; desc: string; grupo?: string; subs: SubAba[] }

export const AREAS: Area[] = [
  { id: 'inicio', rot: 'Início', ic: 'inicio', desc: 'Resumo do dia e atalhos', subs: [{ rota: 'inicio', rot: 'Início', perm: 'todos' }] },
  { id: 'pcp', rot: 'PCP', ic: 'producao', desc: 'Ordens de fabricação, matéria-prima e necessidade', grupo: 'Operação', subs: [
    { rota: 'ofs', rot: 'Ordens de fabricação', ic: 'producao', perm: 'of_menu', chaves: 'of ordem de fabricação form 034 042 conjunto componente apontar encerrar' },
    { rota: 'mp', rot: 'Matéria-prima', ic: 'entrada', perm: 'mp_ver', chaves: 'ri r.i. e.s.m. esm entrada material lote saldo kg identificação' },
    { rota: 'necessidade', rot: 'Necessidade', ic: 'lista', perm: 'necessidade', chaves: 'mrp necessidade de componentes mp falta fabricar' },
    { rota: 'reg/servico_externo', rot: 'Serviço externo', ic: 'fornecedor', perm: 'pcp_reg_ver', chaves: 'sol serv ext tratamento zincagem fora retorno' },
    { rota: 'reg/requisicao', rot: 'Requisições', ic: 'retirar', perm: 'pcp_reg_ver', chaves: 'req componentes requisição' },
    { rota: 'producao', rot: 'Ordens de produção', ic: 'producao', perm: 'pcp', nao: 'of_menu', chaves: 'op fila produzindo pronta entrega' },
    { rota: 'equipe', rot: 'Equipe', ic: 'equipe', perm: 'pcp', nao: 'rh_ver', chaves: 'funcionários pessoas' },
  ] },
  { id: 'comercial', rot: 'Comercial', ic: 'cliente', desc: 'Pedidos de clientes e entregas', grupo: 'Operação', subs: [
    { rota: 'pedidos', rot: 'Pedidos de clientes', ic: 'cliente', perm: 'vendas', chaves: 'controle de pedidos entrega atraso prazo carteira faturamento' },
    { rota: 'clientes', rot: 'Clientes', ic: 'cliente', perm: 'clientes', chaves: 'cliente cnpj sigla' },
  ] },
  { id: 'tecnico', rot: 'Engenharia', ic: 'lapis', desc: 'Depto. técnico: produtos, desenvolvimento, alterações e qualidade', grupo: 'Operação', subs: [
    { rota: 'produtos', rot: 'Produtos', ic: 'estoque', perm: 'produtos_menu', chaves: 'cadastro técnico componentes conjuntos estrutura código inteligente desenho cliente' },
    { rota: 'tecnico', rot: 'Painel', ic: 'relatorio', perm: 'tecnico_menu', chaves: 'indicadores departamento técnico' },
    { rota: 'reg/desenvolvimento', rot: 'Desenvolvimento', ic: 'lapis', perm: 'tecnico_menu', chaves: 'aprov desenv amostra' },
    { rota: 'reg/alteracao', rot: 'Alterações', ic: 'desfazer', perm: 'tecnico_menu', chaves: 'sol alt solicitação de alteração' },
    { rota: 'reg/melhoria', rot: 'Melhorias', ic: 'ok', perm: 'tecnico_menu', chaves: 'melhoria contínua' },
    { rota: 'reg/projeto', rot: 'Projetos', ic: 'lista', perm: 'tecnico_menu', chaves: 'projeto' },
    { rota: 'reg/desvio', rot: 'Desvios', ic: 'alerta', perm: 'tecnico_menu', chaves: 'desvio concessão' },
    { rota: 'reg/desenho', rot: 'Desenhos', ic: 'contar', perm: 'tecnico_menu', chaves: 'qualidade matriz lista mestra revisão' },
    { rota: 'reg/copia', rot: 'Cópias controladas', ic: 'copiar', perm: 'tecnico_menu', chaves: 'distribuição cópia controlada' },
    { rota: 'reg/imds', rot: 'IMDS', ic: 'planilha', perm: 'tecnico_menu', chaves: 'imds material data system' },
    { rota: 'reg/ata', rot: 'Atas de reunião', ic: 'equipe', perm: 'tecnico_menu', chaves: 'ata reunião pauta' },
    { rota: 'reg/setup', rot: 'Setup e produção', ic: 'relogio', perm: 'tecnico_menu', chaves: 'setup peças por hora tempo' },
  ] },
  { id: 'almoxarifado', rot: 'Almoxarifado', ic: 'estoque', desc: 'Peças, retiradas e entradas', grupo: 'Operação', subs: [
    { rota: 'pecas', rot: 'Peças', ic: 'estoque', perm: 'estoque_ver', chaves: 'estoque saldo prateleira inventário contar código' },
    { rota: 'movimentos', rot: 'Movimentações', ic: 'historico', perm: 'historico_mov', chaves: 'retiradas entradas histórico quem tirou' },
  ] },
  { id: 'manutencao', rot: 'Manutenção', ic: 'chave', desc: 'OS, preventiva, máquinas, peças críticas e gastos', grupo: 'Operação', subs: [
    { rota: 'os', rot: 'Ordens de serviço', ic: 'chave', perm: 'manut_ver', chaves: 'os chamado quebrou corretiva preditiva' },
    { rota: 'preventiva', rot: 'Preventiva', ic: 'ok', perm: 'manut_ver', chaves: 'check list plano anual preventiva predial' },
    { rota: 'maquinas', rot: 'Máquinas', ic: 'maquina', perm: 'almox', chaves: 'máquinas dispositivos ferramentas equipamentos' },
    { rota: 'reg/pendencia', rot: 'Pendências', ic: 'alerta', perm: 'manut_gestao', chaves: 'pendência ocorrência' },
    { rota: 'reg/peca_critica', rot: 'Peças críticas', ic: 'estoque', perm: 'manut_gestao', chaves: 'máquinas críticas chave vida útil' },
    { rota: 'reg/servico_manut', rot: 'Serviços', ic: 'fornecedor', perm: 'manut_gestao', chaves: 'prestador eletricista terceiro hora' },
    { rota: 'reg/gasto_manut', rot: 'Gastos', ic: 'dinheiro', perm: 'manut_gestao', chaves: 'fluxo de caixa compras manutenção' },
    { rota: 'reg/ferramentaria', rot: 'Ferramentaria', ic: 'chave', perm: 'manut_gestao', chaves: 'ferramenta matriz afiação' },
    { rota: 'manut', rot: 'Indicadores', ic: 'relatorio', perm: 'manut_gestao', chaves: 'indicadores horas paradas mttr' },
  ] },
  { id: 'compras', rot: 'Compras', ic: 'compras', desc: 'O que falta, pedidos e fornecedores', grupo: 'Operação', subs: [
    { rota: 'compras/lista', rot: 'O que comprar', ic: 'lista', perm: 'compras', chaves: 'lista de compras faltando mínimo' },
    { rota: 'compras', rot: 'Pedidos', ic: 'compras', perm: 'compras', chaves: 'pedido de compra receber chegou' },
    { rota: 'fornecedores', rot: 'Fornecedores', ic: 'fornecedor', perm: 'compras', chaves: 'fornecedor contato telefone' },
  ] },
  { id: 'rh', rot: 'RH', ic: 'equipe', desc: 'Pessoas, ponto, férias, treinamentos e segurança', grupo: 'Gestão', subs: [
    { rota: 'rh', rot: 'Pessoas', ic: 'equipe', grupo: 'Dia a dia', perm: 'rh_ver', chaves: 'funcionários cadastro ficha admissão experiência desligamento' },
    { rota: 'rh/ponto', rot: 'Ponto', ic: 'relogio', grupo: 'Dia a dia', perm: 'rh_ver', chaves: 'horas extras cartão de ponto hora extra faltas atrasos fechamento contabilidade' },
    { rota: 'rh/ferias', rot: 'Férias', ic: 'calendario', grupo: 'Dia a dia', perm: 'rh_ver', chaves: 'ausências férias vencidas atestado afastamento licença inss' },
    { rota: 'rh/treinamentos', rot: 'Treinamentos', ic: 'lista', grupo: 'Dia a dia', perm: 'rh_ver', chaves: 'matriz competências versatilidade procedimentos sgq reciclagem certificado' },
    { rota: 'rh/seguranca', rot: 'EPI e exames', ic: 'ok', grupo: 'Dia a dia', perm: 'rh_ver', chaves: 'epi aso exame médico segurança do trabalho nr' },
    { rota: 'rh/disciplina', rot: 'Advertências', ic: 'alerta', grupo: 'Dia a dia', perm: 'rh_ver', chaves: 'advertência suspensão disciplina ocorrência' },
    { rota: 'rh/processos', rot: 'Processos', ic: 'cadeado', grupo: 'Gestão', perm: 'rh_sensivel', chaves: 'processo trabalhista advogado ação justiça' },
    { rota: 'rh/organograma', rot: 'Organograma', ic: 'admin', grupo: 'Gestão', perm: 'rh_ver', chaves: 'cargos hierarquia chefe' },
    { rota: 'rh/relatorios', rot: 'Relatórios', ic: 'relatorio', grupo: 'Gestão', perm: 'rh_ver', chaves: 'turnover absenteísmo custo folha' },
    { rota: 'rh/indicadores', rot: 'Indicadores', ic: 'dinheiro', grupo: 'Gestão', perm: 'rh_sensivel', chaves: 'indicadores rotatividade turnover receita custo por funcionário dashboard painel experiência escolaridade faixa etária' },
    { rota: 'rh/ajustes', rot: 'Ajustes', ic: 'lapis', grupo: 'Gestão', perm: 'rh_editar', chaves: 'cargos setores feriados jornada tolerância' },
  ] },
  { id: 'financeiro', rot: 'Financeiro', ic: 'dinheiro', desc: 'Contas a pagar e receber e fluxo de caixa', grupo: 'Gestão', subs: [
    { rota: 'financeiro', rot: 'Contas a pagar e receber', perm: 'financeiro', chaves: 'boleto vencimento pagar receber' },
    { rota: 'financeiro/fluxo', rot: 'Fluxo de caixa', perm: 'financeiro', chaves: 'saldo caixa previsão' },
  ] },
  { id: 'relatorios', rot: 'Relatórios', ic: 'relatorio', desc: 'Números do estoque, compras e consumo', grupo: 'Gestão', subs: [{ rota: 'relatorios', rot: 'Relatórios', perm: 'relatorios' }] },
  { id: 'admin', rot: 'Administração', ic: 'admin', desc: 'Acessos, empresa e cópia dos dados', grupo: 'Sistema', subs: [{ rota: 'admin', rot: 'Administração', perm: 'config', chaves: 'acessos usuários senha backup cópia' }] },
  { id: 'ajuda', rot: 'Ajuda', ic: 'ajuda', desc: 'Tutoriais e dúvidas', grupo: 'Sistema', subs: [{ rota: 'ajuda', rot: 'Ajuda', perm: 'todos', chaves: 'tutorial manual dúvida como faço' }] },
]

export const subPode = (s: SubAba): boolean => Perm.pode(s.perm) && !(s.nao && Perm.pode(s.nao))
export const subsDe = (a: Area): SubAba[] => a.subs.filter(subPode)
export const areasVisiveis = (): Area[] => AREAS.filter(a => subsDe(a).length > 0)

// telas de detalhe → aba da lista
const DETALHE: Record<string, string> = { peca: 'pecas', pedido: 'compras', fornecedor: 'fornecedores', maquina: 'maquinas', cliente: 'clientes', of: 'ofs', produto: 'produtos' }
// endereço atual → a aba (rota) que fica marcada
export function chaveDaRota(r: Rota): string {
  if (!r.nome) return 'inicio'
  if (r.nome === 'funcionario') return Perm.pode('rh_ver') ? 'rh' : 'equipe'
  if (r.nome === 'equipe') return Perm.pode('rh_ver') ? 'rh' : 'equipe'
  if ((r.nome === 'compras' && r.sub === 'lista') || (r.nome === 'financeiro' && r.sub === 'fluxo')) return r.nome + '/' + r.sub
  if (r.nome === 'rh' && r.sub) return 'rh/' + r.sub
  if (r.nome === 'reg' && r.sub) return 'reg/' + r.sub
  return DETALHE[r.nome] || r.nome
}
export function ondeEstou(r: Rota): { area: Area | null; sub: SubAba | null } {
  const k = chaveDaRota(r)
  for (const a of AREAS) for (const s of a.subs) if (s.rota === k) return { area: a, sub: s }
  return { area: null, sub: null }
}

// ---------------------------------------------------------------- o menu de cada login
export interface ItemMenu { rota: string; rot: string; ic: NomeIcone; area: string; contam: string[] }
export interface GrupoMenu { titulo: string | null; itens: ItemMenu[] }

const POR_AREAS: Perfil[] = ['dono', 'escritorio']
// a área principal de cada login vem primeiro no menu
const PRINCIPAL: Partial<Record<Perfil, string>> = { pcp: 'pcp', rh: 'rh', tecnico: 'tecnico', manutencao: 'manutencao', producao: 'pcp' }
export const menuPlano = (p: Perfil): boolean => !POR_AREAS.includes(p)

function juntar(lista: [titulo: string | null, item: ItemMenu][]): GrupoMenu[] {
  const g: GrupoMenu[] = []
  for (const [titulo, item] of lista) {
    const u = g.at(-1)
    if (u && u.titulo === titulo) u.itens.push(item); else g.push({ titulo, itens: [item] })
  }
  return g
}

export function gruposDoMenu(p: Perfil): GrupoMenu[] {
  const areas = areasVisiveis()
  const itemArea = (a: Area): ItemMenu => { const ss = subsDe(a); return { rota: ss[0].rota, rot: a.rot, ic: a.ic, area: a.id, contam: ss.map(x => x.rota) } }
  if (!menuPlano(p)) return juntar(areas.map(a => [a.grupo || null, itemArea(a)]))
  const fixas = ['inicio', 'admin', 'ajuda']
  const principal = PRINCIPAL[p]
  const trabalho = areas.filter(a => !fixas.includes(a.id)).sort((a, b) => Number(b.id === principal) - Number(a.id === principal))
  // uma área só: os grupos internos dela (Dia a dia, Gestão). Mais de uma: o nome de cada área separa as telas
  const titulo = (a: Area, s: SubAba) => trabalho.length === 1 ? s.grupo || null : a.rot
  const meio = trabalho.flatMap(a => subsDe(a).map((s): [string | null, ItemMenu] => [titulo(a, s), { rota: s.rota, rot: s.rot, ic: s.ic || a.ic, area: a.id, contam: [s.rota] }]))
  const de = (id: string) => areas.filter(a => a.id === id).map((a): [string | null, ItemMenu] => [id === 'inicio' ? null : 'Sistema', itemArea(a)])
  return juntar([...de('inicio'), ...meio, ...de('admin'), ...de('ajuda')])
}

export const areaDaRota = (rota: string): string | undefined => AREAS.find(a => a.subs.some(s => s.rota === rota))?.id

// barra de baixo do celular (o botão do meio é o que a pessoa mais faz)
export type AbaBaixo = [rota: string, rot: string, ic: NomeIcone]
const BAIXO: Partial<Record<Perfil, AbaBaixo[]>> = {
  dono: [['inicio', 'Início', 'inicio'], ['pecas', 'Almox.', 'estoque'], ['retirar', 'Retirar', 'retirar'], ['rh', 'RH', 'equipe'], ['menu', 'Menu', 'menu']],
  escritorio: [['inicio', 'Início', 'inicio'], ['pecas', 'Almox.', 'estoque'], ['retirar', 'Retirar', 'retirar'], ['financeiro', 'Contas', 'dinheiro'], ['menu', 'Menu', 'menu']],
  almoxarife: [['inicio', 'Início', 'inicio'], ['pecas', 'Peças', 'estoque'], ['retirar', 'Retirar', 'retirar'], ['compras/lista', 'Comprar', 'compras'], ['menu', 'Menu', 'menu']],
  producao: [['inicio', 'Início', 'inicio'], ['ofs', 'OFs', 'producao'], ['retirar', 'Retirar', 'retirar'], ['os', 'OS', 'chave'], ['menu', 'Menu', 'menu']],
  pcp: [['inicio', 'Início', 'inicio'], ['ofs', 'OFs', 'producao'], ['novaOF', 'Nova OF', 'mais'], ['pedidos', 'Pedidos', 'cliente'], ['menu', 'Menu', 'menu']],
  tecnico: [['inicio', 'Início', 'inicio'], ['produtos', 'Produtos', 'estoque'], ['reg/alteracao', 'Alterações', 'desfazer'], ['reg/desenvolvimento', 'Desenv.', 'lapis'], ['menu', 'Menu', 'menu']],
  manutencao: [['inicio', 'Início', 'inicio'], ['os', 'OS', 'chave'], ['novaOS', 'Abrir OS', 'mais'], ['preventiva', 'Preventiva', 'ok'], ['menu', 'Menu', 'menu']],
  gerente: [['inicio', 'Início', 'inicio'], ['pecas', 'Almox.', 'estoque'], ['retirar', 'Retirar', 'retirar'], ['rh', 'Equipe', 'equipe'], ['menu', 'Menu', 'menu']],
  rh: [['inicio', 'Início', 'inicio'], ['rh', 'Pessoas', 'equipe'], ['rh/ponto', 'Ponto', 'relogio'], ['rh/ferias', 'Férias', 'calendario'], ['menu', 'Menu', 'menu']],
}
export const abasDeBaixo = (p: Perfil): AbaBaixo[] => BAIXO[p] || BAIXO.producao!
