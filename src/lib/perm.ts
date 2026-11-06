/* Permissões por perfil — as MESMAS regras das funções do banco (o banco é quem manda; isto só esconde botões). */
import { API } from './api.ts'
import type { Perfil } from './tipos.ts'

const ALMOX: Perfil[] = ['dono', 'escritorio', 'almoxarife', 'producao', 'gerente', 'manutencao']
const FABRICA: Perfil[] = ['dono', 'escritorio', 'pcp', 'producao', 'gerente', 'almoxarife', 'tecnico']   // vê OFs e matéria-prima
const NAO_RH: Perfil[] = ['dono', 'escritorio', 'almoxarife', 'pcp', 'producao', 'gerente', 'tecnico', 'manutencao', 'comercial']
const MANUT: Perfil[] = ['dono', 'escritorio', 'almoxarife', 'manutencao']
const PCP: Perfil[] = ['dono', 'escritorio', 'pcp', 'producao', 'gerente']
const R = {
  almox: ALMOX,                                              // almoxarifado: estoque, movimentações, máquinas
  estoque_ver: [...ALMOX, 'pcp'],                            // consultar as peças (o PCP só olha)
  pcp: PCP,                                                  // PCP: ordens de produção
  retirar: ALMOX,
  entrada: ['dono', 'escritorio', 'almoxarife'],
  pecas_editar: ['dono', 'escritorio', 'almoxarife'],
  compras: ['dono', 'escritorio', 'almoxarife'],                       // compra de peças do almoxarifado
  compras_mp: ['dono', 'escritorio', 'almoxarife', 'comercial'],       // pedido de compra de matéria-prima
  compras_ver: ['dono', 'escritorio', 'almoxarife', 'comercial'],      // lista de pedidos de compra
  fornecedores: ['dono', 'escritorio', 'almoxarife', 'comercial'],
  precos: ['dono', 'escritorio', 'almoxarife', 'manutencao'],
  historico_mov: ALMOX,
  maquinas_editar: MANUT,
  manutencao: ALMOX,
  producao_editar: ['dono', 'escritorio', 'pcp'],
  producao_status: PCP,
  entregar: ['dono', 'escritorio', 'pcp'],
  financeiro: ['dono', 'escritorio'],
  clientes: ['dono', 'escritorio', 'pcp', 'comercial'],
  clientes_ver: ['dono', 'escritorio', 'pcp', 'tecnico', 'gerente', 'comercial'],   // escolher o cliente no pedido / no produto
  // ---- fábrica (planilhas PCP, Controle de Pedidos, Depto. Técnico, Manutenção)
  of_ver: [...FABRICA, 'comercial'],                        // ordens de fabricação e matéria-prima (o Comercial só consulta)
  of_emitir: ['dono', 'escritorio', 'pcp'],
  of_apontar: ['dono', 'escritorio', 'pcp', 'producao', 'gerente'],
  mp_editar: ['dono', 'escritorio', 'pcp', 'almoxarife'],
  of_passos: ['dono', 'escritorio', 'pcp', 'producao', 'gerente'],     // marcar o passo feito na OF    // entrada de matéria-prima (R.I.) e inventário
  necessidade: ['dono', 'escritorio', 'pcp', 'gerente', 'comercial'],
  necessidade_criar: ['dono', 'escritorio', 'pcp', 'comercial'],     // pedir compra de matéria-prima
  vendas: ['dono', 'escritorio', 'pcp', 'gerente', 'comercial'],     // pedidos de clientes
  vendas_editar: ['dono', 'escritorio', 'pcp', 'comercial'],
  produtos_ver: NAO_RH,
  produtos_editar: ['dono', 'escritorio', 'tecnico', 'pcp'],
  tecnico_ver: NAO_RH,                                       // desenvolvimento, alterações, desenhos…
  tecnico_editar: ['dono', 'escritorio', 'tecnico'],
  pcp_reg_ver: ['dono', 'escritorio', 'pcp', 'gerente', 'tecnico', 'producao'],   // serviço externo e requisições
  pcp_reg_editar: ['dono', 'escritorio', 'pcp'],
  manut_ver: ['dono', 'escritorio', 'almoxarife', 'manutencao', 'gerente', 'producao'],   // ordens de serviço e preventiva
  manut_gestao: ['dono', 'escritorio', 'almoxarife', 'manutencao', 'gerente'],             // gastos, peças críticas, indicadores
  manut_editar: MANUT,
  // o que aparece no menu (para cada perfil ver só o que usa no dia a dia)
  of_menu: ['dono', 'escritorio', 'pcp', 'producao', 'gerente', 'tecnico'],
  mp_ver: ['dono', 'escritorio', 'pcp', 'almoxarife', 'gerente', 'tecnico', 'comercial'],
  menu_comercial: ['comercial'],                             // telas do Comercial no menu dele
  menu_pcp: ['pcp'],
  produtos_menu: ['dono', 'escritorio', 'tecnico', 'pcp', 'gerente'],
  tecnico_menu: ['dono', 'escritorio', 'tecnico', 'gerente'],
  solicitar: NAO_RH,                                         // pedir alteração / sugerir melhoria (qualquer um, menos o RH)
  rh_ver: ['dono', 'escritorio', 'rh', 'gerente'],           // área de RH (gerente só consulta)
  rh_editar: ['dono', 'escritorio', 'rh'],
  rh_sensivel: ['dono', 'escritorio', 'rh'],                 // salário, CPF, banco, CID, documentos (LGPD)
  equipe_editar: ['dono', 'escritorio', 'rh'],
  salarios: ['dono', 'escritorio', 'rh'],
  relatorios: ['dono', 'escritorio', 'almoxarife'],
  config: ['dono', 'escritorio'],
  acessos: ['dono'],
  importar: ['dono'],
  auditoria: ['dono'],
  todos: ['dono', 'escritorio', 'almoxarife', 'pcp', 'producao', 'rh', 'gerente', 'tecnico', 'manutencao', 'comercial'],
} satisfies Record<string, Perfil[]>

export type Acao = keyof typeof R

export const NOMES_PERFIL: Record<Perfil, string> = { dono: 'Dono', escritorio: 'Escritório', almoxarife: 'Almoxarifado', pcp: 'PCP', producao: 'Produção', rh: 'RH', gerente: 'Gerente de fábrica', tecnico: 'Técnico / Qualidade', manutencao: 'Manutenção', comercial: 'Comercial' }

export const Perm = {
  pode: (acao: Acao): boolean => !!API.sessao && (R[acao] as readonly Perfil[]).includes(API.sessao.perfil),
  nome: (p: string): string => NOMES_PERFIL[p as Perfil] || p,
  NOMES: NOMES_PERFIL,
}
