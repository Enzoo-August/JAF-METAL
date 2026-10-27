/* Permissões por perfil — as MESMAS regras das funções do banco (o banco é quem manda; isto só esconde botões). */
import { API } from './api.ts'
import type { Perfil } from './tipos.ts'

const ALMOX: Perfil[] = ['dono', 'escritorio', 'almoxarife', 'producao', 'gerente']
const PCP: Perfil[] = ['dono', 'escritorio', 'pcp', 'producao', 'gerente']
const R = {
  almox: ALMOX,                                              // almoxarifado: estoque, movimentações, máquinas
  estoque_ver: [...ALMOX, 'pcp'],                            // consultar as peças (o PCP só olha)
  pcp: PCP,                                                  // PCP: ordens de produção
  retirar: ALMOX,
  entrada: ['dono', 'escritorio', 'almoxarife'],
  pecas_editar: ['dono', 'escritorio', 'almoxarife'],
  compras: ['dono', 'escritorio', 'almoxarife'],
  precos: ['dono', 'escritorio', 'almoxarife'],
  historico_mov: ALMOX,
  maquinas_editar: ['dono', 'escritorio', 'almoxarife'],
  manutencao: ALMOX,
  producao_editar: ['dono', 'escritorio', 'pcp'],
  producao_status: PCP,
  entregar: ['dono', 'escritorio', 'pcp'],
  financeiro: ['dono', 'escritorio'],
  clientes: ['dono', 'escritorio'],
  clientes_ver: ['dono', 'escritorio', 'pcp'],              // escolher o cliente na ordem
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
  todos: ['dono', 'escritorio', 'almoxarife', 'pcp', 'producao', 'rh', 'gerente'],
} satisfies Record<string, Perfil[]>

export type Acao = keyof typeof R

export const NOMES_PERFIL: Record<Perfil, string> = { dono: 'Dono', escritorio: 'Escritório', almoxarife: 'Almoxarifado', pcp: 'PCP', producao: 'Produção', rh: 'RH', gerente: 'Gerente de fábrica' }

export const Perm = {
  pode: (acao: Acao): boolean => !!API.sessao && (R[acao] as readonly Perfil[]).includes(API.sessao.perfil),
  nome: (p: string): string => NOMES_PERFIL[p as Perfil] || p,
  NOMES: NOMES_PERFIL,
}
