/* Rotas (endereço #/...) → telas, e as ações de cada tela (usadas pelos botões e pelos testes automáticos) */
import type { ReactNode } from 'react'
import type { Acao } from '../lib/perm.ts'
import { registrarCadastroRapido } from '../ui/Combo.tsx'
import type { Rota } from '../ui/ganchos.ts'
import { TelaAdmin, TelaConta, trocarSenha } from './Admin.tsx'
import { boasVindas, TelaAjuda } from './Ajuda.tsx'
import * as Clientes from './Clientes.tsx'
import * as Compras from './Compras.tsx'
import * as Financeiro from './Financeiro.tsx'
import * as Fornecedores from './Fornecedores.tsx'
import { personalizar, TelaInicio } from './Inicio.tsx'
import * as Maquinas from './Maquinas.tsx'
import * as Movimentos from './Movimentos.tsx'
import * as Pecas from './Pecas.tsx'
import * as Producao from './Producao.tsx'
import { TelaRelatorios } from './Relatorios.tsx'
import { formPessoa } from './rh/Pessoas.tsx'
import { TelaRH, tituloRH } from './rh/index.tsx'
import { avisoFerias, formAusencia, programarFerias } from './rh/Ferias.tsx'
import { formAso, formEpi, fichaEpi } from './rh/Seguranca.tsx'
import { documento, formOcorrencia } from './rh/Disciplina.tsx'

export interface DefTela { Tela: (p: { r: Rota }) => ReactNode; perm?: Acao; titulo: string | ((r: Rota) => string) }

const pecas: DefTela = { Tela: Pecas.TelaPecas, perm: 'fabrica', titulo: Pecas.tituloPecas }
const compras: DefTela = { Tela: Compras.TelaCompras, perm: 'compras', titulo: Compras.tituloCompras }
const fornecedores: DefTela = { Tela: Fornecedores.TelaFornecedores, perm: 'compras', titulo: Fornecedores.tituloFornecedores }
const maquinas: DefTela = { Tela: Maquinas.TelaMaquinas, perm: 'fabrica', titulo: Maquinas.tituloMaquinas }
const clientes: DefTela = { Tela: Clientes.TelaClientes, perm: 'clientes', titulo: Clientes.tituloClientes }
const rh: DefTela = { Tela: TelaRH, perm: 'rh_ver', titulo: tituloRH }
// "Equipe" (quem não é do RH: almoxarifado e produção veem nome, função e o que a pessoa retirou)
const equipe: DefTela = { Tela: TelaRH, perm: 'fabrica', titulo: tituloRH }
const funcionario: DefTela = { Tela: TelaRH, titulo: tituloRH }

export const ROTAS: Record<string, DefTela> = {
  '': { Tela: TelaInicio, titulo: 'Início' }, inicio: { Tela: TelaInicio, titulo: 'Início' },
  pecas, peca: pecas,
  movimentos: { Tela: Movimentos.TelaMovimentos, perm: 'historico_mov', titulo: 'Movimentações' },
  compras, pedido: compras,
  fornecedores, fornecedor: fornecedores,
  maquinas, maquina: maquinas,
  producao: { Tela: Producao.TelaProducao, perm: 'fabrica', titulo: 'Ordens de produção' },
  financeiro: { Tela: Financeiro.TelaFinanceiro, perm: 'financeiro', titulo: Financeiro.tituloFinanceiro },
  clientes, cliente: clientes,
  rh, equipe, funcionario,
  relatorios: { Tela: TelaRelatorios, perm: 'relatorios', titulo: 'Relatórios' },
  admin: { Tela: TelaAdmin, perm: 'config', titulo: 'Administração' },
  ajuda: { Tela: TelaAjuda, titulo: 'Ajuda' },
  conta: { Tela: TelaConta, titulo: 'Minha conta' },
}

export const Telas = {
  movimentos: { retirar: Movimentos.retirar, entrada: Movimentos.entrada, detalhe: Movimentos.detalhe, MOTIVO: Movimentos.MOTIVO },
  pecas: { form: Pecas.form, contarUma: Pecas.contarUma },
  compras: { form: Compras.form, receber: Compras.receber, enviar: Compras.enviar },
  fornecedores: { form: Fornecedores.form, novoRapido: Fornecedores.novoRapido, pontualidade: Fornecedores.pontualidade },
  maquinas: { form: Maquinas.form, novaRapida: Maquinas.novaRapida, formManutencao: Maquinas.formManutencao },
  producao: { abrir: Producao.abrir, form: Producao.form },
  financeiro: { form: Financeiro.form, abrir: Financeiro.abrir, saldoHoje: Financeiro.saldoHoje },
  clientes: { form: Clientes.form, novoRapido: Clientes.novoRapido },
  equipe: { form: formPessoa },
  rh: { formPessoa, programarFerias, avisoFerias, formAusencia, formAso, formEpi, fichaEpi, formOcorrencia, documento },
  admin: { trocarSenha },
  inicio: { personalizar },
  ajuda: { boasVindas },
}

// "Cadastrar …" direto da lista de sugestões de um campo
registrarCadastroRapido({ fornecedor: Fornecedores.novoRapido, maquina: Maquinas.novaRapida, cliente: Clientes.novoRapido })
