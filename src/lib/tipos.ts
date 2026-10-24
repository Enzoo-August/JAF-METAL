/* Linhas das tabelas do banco (iguais ao supabase/schema.sql). Datas: 'AAAA-MM-DD'; horários: ISO. */

export type Perfil = 'dono' | 'escritorio' | 'almoxarife' | 'producao'

export interface PerfilAcesso {
  user_id: string; nome: string; login: string; perfil: Perfil; funcionario_id: string | null
  ativo: boolean; trocar_senha: boolean; criado_em: string
}
export interface Config { chave: string; valor: Record<string, unknown>; atualizado_em: string }
export interface Fornecedor {
  id: string; nome: string; razao: string | null; tipo: 'Peças' | 'Serviço' | 'Peças e serviço'
  contato: string | null; contato2: string | null; telefone: string | null; celular: string | null; email: string | null; site: string | null
  endereco: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null; cnpj: string | null; ie: string | null
  qualificacao: 'Aprovado' | 'Em avaliação' | 'Reprovado' | null; qualif_metodo: string | null; qualif_validade: string | null
  obs: string | null; ativo: boolean; criado_em: string; atualizado_em: string
}
export interface Funcionario {
  id: string; nome: string; funcao: string | null; setor: string | null; telefone: string | null; admissao: string | null
  ativo: boolean; criado_em: string; atualizado_em: string
}
export interface Ferias { inicio: string; fim: string; obs?: string }
export interface FuncionarioPrivado {
  funcionario_id: string; salario: number | null; cpf: string | null; rg: string | null; nascimento: string | null
  endereco: string | null; pix: string | null; ferias: Ferias[]; obs: string | null; atualizado_em: string
}
export interface Maquina {
  id: string; nome: string; tipo: string | null; fabricante: string | null; modelo: string | null; numero_serie: string | null
  setor: string | null; ano: number | null; preventiva_dias: number | null; obs: string | null; ativo: boolean; criado_em: string; atualizado_em: string
}
export interface Peca {
  id: string; codigo: string; descricao: string; utilizacao: string | null; fornecedor_id: string | null; unidade: string
  est_min: number; est_max: number; local: string | null; obs: string | null; ativo: boolean; estoque: number; criado_em: string; atualizado_em: string
}
export interface Cliente {
  id: string; nome: string; razao: string | null; cnpj: string | null; contato: string | null; telefone: string | null
  email: string | null; cidade: string | null; uf: string | null; obs: string | null; ativo: boolean; criado_em: string; atualizado_em: string
}
export interface PedidoCompra {
  id: string; numero: number; data: string; fornecedor_id: string; documento: string | null; prazo: string | null
  status: 'aguardando' | 'recebido' | 'cancelado'; frete: number; obs: string | null; recebido_em: string | null
  criado_por: string | null; criado_em: string; atualizado_em: string
}
export interface PedidoItem { id: string; pedido_id: string; peca_id: string; qtd: number; valor: number; recebido: number; ordem: number }
export interface Manutencao {
  id: string; maquina_id: string; data: string; tipo: 'preventiva' | 'corretiva' | 'melhoria'; status: 'aberta' | 'andamento' | 'concluida'
  problema: string; solucao: string | null; fornecedor_id: string | null; funcionario_id: string | null; custo_servico: number
  horas_parada: number | null; concluida_em: string | null; criado_por: string | null; criado_em: string; atualizado_em: string
}
export type Motivo = 'compra' | 'retirada' | 'ajuste' | 'devolucao' | 'importado' | 'estorno'
export interface Movimento {
  id: string; seq: number; data: string; peca_id: string; tipo: 'entrada' | 'saida'; qtd: number; preco_unit: number
  fornecedor_id: string | null; documento: string | null; motivo: Motivo; funcionario_id: string | null; maquina_id: string | null
  destino: string | null; pedido_item_id: string | null; manutencao_id: string | null; estorno_de: string | null; chave: string | null
  obs: string | null; criado_por: string | null; criado_em: string
}
export interface Ordem {
  id: string; numero: number; cliente_id: string | null; cliente_nome: string | null; pedido_cliente: string | null; produto: string
  codigo: string | null; qtd: number; unidade: string; produzido: number; prazo: string | null; maquina_id: string | null
  responsavel_id: string | null; prioridade: number; status: 'fila' | 'producao' | 'pronta' | 'entregue' | 'cancelada'; obs: string | null
  iniciada_em: string | null; pronta_em: string | null; entregue_em: string | null; criado_por: string | null; criado_em: string; atualizado_em: string
}
export interface Lancamento {
  id: string; tipo: 'pagar' | 'receber'; descricao: string; categoria: string | null; valor: number; vencimento: string
  pago_em: string | null; valor_pago: number | null; forma: string | null; fornecedor_id: string | null; cliente_id: string | null
  funcionario_id: string | null; pedido_id: string | null; ordem_id: string | null; documento: string | null; parcela: string | null
  grupo: string | null; obs: string | null; criado_por: string | null; criado_em: string; atualizado_em: string
}
export interface Historico {
  id: number; em: string; user_id: string | null; quem: string | null; tabela: string; registro: string | null; acao: string
  antes: Record<string, unknown> | null; depois: Record<string, unknown> | null
}

// tabela → tipo da linha
export interface Tabelas {
  config: Config; pecas: Peca; maquinas: Maquina; manutencoes: Manutencao; funcionarios: Funcionario; ordens: Ordem
  movimentos: Movimento; fornecedores: Fornecedor; pedidos_compra: PedidoCompra; pedido_itens: PedidoItem; clientes: Cliente
  lancamentos: Lancamento; funcionarios_privado: FuncionarioPrivado; perfis: PerfilAcesso
}
export type NomeTabela = keyof Tabelas

// situação calculada (etiqueta colorida)
export type Cor = 'verde' | 'vermelho' | 'amarelo' | 'azul' | 'cinza'
export interface Situacao { cod: string; txt: string; cor: Cor }
