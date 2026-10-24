/* Permissões por perfil — as MESMAS regras das funções do banco (o banco é quem manda; isto só esconde botões). */
import { API } from './api.ts'
import type { Perfil } from './tipos.ts'

const R = {
  retirar: ['dono', 'escritorio', 'almoxarife', 'producao'],
  entrada: ['dono', 'escritorio', 'almoxarife'],
  pecas_editar: ['dono', 'escritorio', 'almoxarife'],
  compras: ['dono', 'escritorio', 'almoxarife'],
  precos: ['dono', 'escritorio', 'almoxarife'],
  historico_mov: ['dono', 'escritorio', 'almoxarife', 'producao'],
  maquinas_editar: ['dono', 'escritorio', 'almoxarife'],
  manutencao: ['dono', 'escritorio', 'almoxarife', 'producao'],
  producao_editar: ['dono', 'escritorio', 'almoxarife'],
  producao_status: ['dono', 'escritorio', 'almoxarife', 'producao'],
  entregar: ['dono', 'escritorio'],
  financeiro: ['dono', 'escritorio'],
  clientes: ['dono', 'escritorio'],
  equipe_editar: ['dono', 'escritorio'],
  salarios: ['dono', 'escritorio'],
  relatorios: ['dono', 'escritorio', 'almoxarife'],
  config: ['dono', 'escritorio'],
  acessos: ['dono'],
  importar: ['dono'],
  auditoria: ['dono'],
  todos: ['dono', 'escritorio', 'almoxarife', 'producao'],
} satisfies Record<string, Perfil[]>

export type Acao = keyof typeof R

export const NOMES_PERFIL: Record<Perfil, string> = { dono: 'Dono', escritorio: 'Escritório', almoxarife: 'Almoxarifado', producao: 'Produção' }

export const Perm = {
  pode: (acao: Acao): boolean => !!API.sessao && (R[acao] as readonly Perfil[]).includes(API.sessao.perfil),
  nome: (p: string): string => NOMES_PERFIL[p as Perfil] || p,
  NOMES: NOMES_PERFIL,
}
