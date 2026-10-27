/* Linhas das tabelas do banco (iguais ao supabase/schema.sql). Datas: 'AAAA-MM-DD'; horários: ISO. */

export type Perfil = 'dono' | 'escritorio' | 'almoxarife' | 'pcp' | 'producao' | 'rh' | 'gerente'

export interface PerfilAcesso {
  user_id: string; nome: string; login: string; perfil: Perfil; funcionario_id: string | null
  ativo: boolean; trocar_senha: boolean; criado_em: string; preferencias?: Preferencias
}
export interface Preferencias { inicio?: { atalhos?: string[]; blocos?: string[] } }
export interface Config { chave: string; valor: Record<string, unknown>; atualizado_em: string }
export interface Fornecedor {
  id: string; nome: string; razao: string | null; tipo: 'Peças' | 'Serviço' | 'Peças e serviço'
  contato: string | null; contato2: string | null; telefone: string | null; celular: string | null; email: string | null; site: string | null
  endereco: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null; cnpj: string | null; ie: string | null
  qualificacao: 'Aprovado' | 'Em avaliação' | 'Reprovado' | null; qualif_metodo: string | null; qualif_validade: string | null
  obs: string | null; ativo: boolean; criado_em: string; atualizado_em: string
}
export type Registro = 'Matriz' | 'Filial' | 'Upgrade' | 'Sem registro'
export type SituacaoFunc = 'ativo' | 'afastado' | 'desligado'
export interface Funcionario {
  id: string; nome: string; funcao: string | null; setor: string | null; telefone: string | null; admissao: string | null
  ativo: boolean; criado_em: string; atualizado_em: string
  matricula: string | null; matricula_esocial: string | null; registro: Registro | null; cargo_id: string | null; superior_id: string | null
  horario: string | null; descanso: string | null; situacao: SituacaoFunc; demissao: string | null; motivo_demissao: string | null; ferias_base: string | null
}
export interface Ferias { inicio: string; fim: string; obs?: string }
export interface FuncionarioPrivado {
  funcionario_id: string; salario: number | null; salario_he: number | null; cpf: string | null; rg: string | null; nascimento: string | null
  endereco: string | null; pix: string | null; ferias: Ferias[]; obs: string | null; atualizado_em: string
  pis: string | null; titulo_eleitor: string | null; reservista: string | null; cnh: string | null; sexo: string | null; estado_civil: string | null
  nacionalidade: string | null; naturalidade: string | null; uf_nascimento: string | null; mae: string | null; pai: string | null; instrucao: string | null
  email: string | null; celular: string | null; numero: string | null; complemento: string | null; bairro: string | null; cep: string | null; cidade: string | null
  banco: string | null; emergencia_nome: string | null; emergencia_fone: string | null; telefone_corp: string | null; uniforme: string | null
  calcado: string | null; chave_celular: string | null; chave_vestiario: string | null; indicacao: string | null; obs_desligamento: string | null
  ctps: string | null; raca_cor: string | null; pais_origem: string | null; telefone_fixo: string | null; rg_orgao: string | null; rg_uf: string | null
  rg_emissao: string | null; cnh_categoria: string | null; cnh_validade: string | null; categoria_militar: string | null
}
export interface RhSetor { id: string; nome: string; gestor_id: string | null; ativo: boolean; atualizado_em: string }
export interface RhCargo { id: string; nome: string; cbo: string | null; setor: string | null; superior_id: string | null; descricao: string | null; ativo: boolean; atualizado_em: string }
export type MotivoHist = 'Admissão' | 'Promoção' | 'Dissídio' | 'Espontâneo' | 'Mérito' | 'Correção' | 'Mudança de setor'
export interface RhHistorico { id: string; funcionario_id: string; vigencia: string; cargo: string | null; salario: number | null; motivo: MotivoHist; setor: string | null; obs: string | null; criado_por: string | null; criado_em: string }
export type TipoAusencia = 'ferias' | 'atestado' | 'afastamento' | 'licenca' | 'suspensao' | 'folga' | 'falta' | 'declaracao'
export interface RhAusencia {
  id: string; funcionario_id: string; tipo: TipoAusencia; inicio: string; fim: string | null; aquisitivo_inicio: string | null
  motivo: string | null; cid: string | null; abona: boolean; obs: string | null; ocorrencia_id: string | null; atualizado_em: string
}
export type Justificativa = 'atestado' | 'declaracao' | 'licenca' | 'folga' | 'falta' | 'abonado' | 'compensado'
export interface RhPonto { id: string; funcionario_id: string; data: string; e1: string | null; s1: string | null; e2: string | null; s2: string | null; justificativa: Justificativa | null; obs: string | null; atualizado_em: string }
export interface RhPontoMes { id: string; funcionario_id: string; competencia: string; fechado_por: string | null; fechado_em: string }
export interface RhFeriado { id: string; data: string; nome: string }
export type TipoMatriz = 'treinamento' | 'procedimento' | 'versatilidade'
export interface RhMatriz { id: string; nome: string; tipo: TipoMatriz; setor: string | null; gestor: string | null; legenda: { nivel: number; txt: string }[]; objetivo: string | null; aprovado_por: string | null; aprovado_em: string | null; ordem: number; ativo: boolean; atualizado_em: string }
export interface RhMatrizItem { id: string; matriz_id: string; nome: string; ordem: number; carga_horaria: number | null; validade_meses: number | null; obrigatorio: boolean; ativo: boolean; atualizado_em: string }
export interface RhNivel { id: string; item_id: string; funcionario_id: string; nivel: number; data: string | null; obs: string | null; atualizado_em: string }
export interface RhPlano { id: string; matriz_id: string | null; treinamento: string; data: string | null; instituicao: string | null; modalidade: string | null; status: 'planejado' | 'realizado' | 'cancelado'; obs: string | null; atualizado_em: string }
export interface RhMeta { id: string; funcionario_id: string; objetivo: string; acao: string | null; prazo: string | null; status: 'andamento' | 'concluido' | 'cancelado'; obs: string | null; atualizado_em: string }
export interface RhEpi { id: string; funcionario_id: string; epi: string; ca: string | null; entrega: string; validade_ca: string | null; vida_util_meses: number | null; quantidade: number; motivo: string | null; obs: string | null; atualizado_em: string }
export interface RhAso { id: string; funcionario_id: string; tipo: string; data_exame: string; periodicidade_meses: number | null; resultado: string | null; medico: string | null; crm: string | null; obs: string | null; atualizado_em: string }
export interface RhOcorrencia {
  id: string; numero: number; funcionario_id: string; tipo: 'verbal' | 'escrita' | 'suspensao'; data_ocorrencia: string; data_aplicacao: string | null
  status: 'rascunho' | 'pendente' | 'assinado' | 'recusado' | 'cancelado'; categoria: string | null; assunto: string | null; descricao: string | null
  dias: number | null; inicio: string | null; retorno: string | null; recusou: boolean; testemunha1: string | null; testemunha1_cpf: string | null
  testemunha2: string | null; testemunha2_cpf: string | null; aplicador: string | null; aplicador_cargo: string | null; obs: string | null
  criado_por: string | null; criado_em: string; atualizado_em: string
}
export interface RhProcesso { id: string; funcionario_id: string | null; autor: string; numero: string | null; data_autuacao: string | null; advogado: string | null; cnpj_advogado: string | null; situacao: 'andamento' | 'acordo' | 'ganho' | 'perdido' | 'arquivado'; valor: number | null; obs: string | null; atualizado_em: string }
export interface RhAnexo { id: string; tabela: string; registro_id: string; nome: string; tipo: string; tamanho: number; criado_por: string | null; criado_em: string }
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
  rh_setores: RhSetor; rh_cargos: RhCargo; rh_historico: RhHistorico; rh_ausencias: RhAusencia; rh_ponto: RhPonto; rh_ponto_meses: RhPontoMes
  rh_feriados: RhFeriado; rh_matrizes: RhMatriz; rh_matriz_itens: RhMatrizItem; rh_matriz_niveis: RhNivel; rh_plano_treinos: RhPlano
  rh_metas: RhMeta; rh_epis: RhEpi; rh_asos: RhAso; rh_ocorrencias: RhOcorrencia; rh_anexos: RhAnexo; rh_processos: RhProcesso
}
export type NomeTabela = keyof Tabelas

// situação calculada (etiqueta colorida)
export type Cor = 'verde' | 'vermelho' | 'amarelo' | 'azul' | 'cinza'
export interface Situacao { cod: string; txt: string; cor: Cor }
