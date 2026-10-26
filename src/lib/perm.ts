/* Permissões por perfil — as MESMAS regras das funções do banco (o banco é quem manda; isto só esconde botões). */
import { API } from './api.ts'
import type { Perfil } from './tipos.ts'

const FABRICA: Perfil[] = ['dono', 'escritorio', 'almoxarife', 'producao', 'gerente']
const R = {
  fabrica: FABRICA,                                          // estoque, ordens, máquinas
  retirar: FABRICA,
  entrada: ['dono', 'escritorio', 'almoxarife'],
  pecas_editar: ['dono', 'escritorio', 'almoxarife'],
  compras: ['dono', 'escritorio', 'almoxarife'],
  precos: ['dono', 'escritorio', 'almoxarife'],
  historico_mov: FABRICA,
  maquinas_editar: ['dono', 'escritorio', 'almoxarife'],
  manutencao: FABRICA,
  producao_editar: ['dono', 'escritorio', 'almoxarife'],
  producao_status: FABRICA,
  entregar: ['dono', 'escritorio'],
  financeiro: ['dono', 'escritorio'],
  clientes: ['dono', 'escritorio'],
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
  todos: ['dono', 'escritorio', 'almoxarife', 'producao', 'rh', 'gerente'],
} satisfies Record<string, Perfil[]>

export type Acao = keyof typeof R

export const NOMES_PERFIL: Record<Perfil, string> = { dono: 'Dono', escritorio: 'Escritório', almoxarife: 'Almoxarifado', producao: 'Produção', rh: 'RH', gerente: 'Gerente de fábrica' }

export const Perm = {
  pode: (acao: Acao): boolean => !!API.sessao && (R[acao] as readonly Perfil[]).includes(API.sessao.perfil),
  nome: (p: string): string => NOMES_PERFIL[p as Perfil] || p,
  NOMES: NOMES_PERFIL,
}
