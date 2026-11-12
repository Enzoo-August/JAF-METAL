/* JAF Metal — dados INVENTADOS para o modo teste (nunca usar dados reais aqui: este arquivo é público).
 * Só entra no "npm run dev" e no build de teste. */
import { API } from './api.ts'
import { S } from './dados.ts'
import * as R from './rh.ts'
import * as U from './util.ts'

// gerador pseudoaleatório fixo (a demonstração sai sempre igual)
let semente = 20261019
const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648 }
const entre = (a: number, b: number) => Math.floor(a + rnd() * (b - a + 1))

const FORN = (dia: (n: number) => string) => [
  { nome: 'Alfa Ferramentas', razao: 'Alfa Ferramentas de Corte Ltda. (exemplo)', contato: 'Ricardo', telefone: '(11) 5555-0101', celular: '(11) 95555-0101', email: 'vendas@alfa.exemplo', cidade: 'São Paulo', uf: 'SP', qualificacao: 'Aprovado', qualif_metodo: 'Qualificação interna', qualif_validade: dia(200) },
  { nome: 'Beta Rolamentos', razao: 'Beta Comércio de Rolamentos Ltda. (exemplo)', contato: 'Renata', telefone: '(11) 5555-0202', email: 'contato@beta.exemplo', cidade: 'São Paulo', uf: 'SP', qualificacao: 'Aprovado', qualif_validade: dia(-10) },
  { nome: 'Gama Importados', razao: 'Compras online (exemplo)', contato: 'Pedido pelo site', cidade: 'Exterior', obs: 'Prazo de entrega longo (20 a 40 dias)' },
  { nome: 'Delta Usinagem', razao: 'Delta Ferramentaria e Usinagem ME (exemplo)', contato: 'José', celular: '(11) 95555-0404', cidade: 'São Paulo', uf: 'SP', tipo: 'Peças e serviço' },
  { nome: 'Épsilon Elétrica', razao: 'Épsilon Materiais Elétricos (exemplo)', contato: 'Balcão', telefone: '(11) 5555-0505', cidade: 'São Paulo', uf: 'SP' },
  { nome: 'Carlos Eletricista', contato: 'Carlos', celular: '(11) 95555-0606', cidade: 'São Paulo', uf: 'SP', tipo: 'Serviço', obs: 'Eletricista de máquinas' },
]
const MAQ = [
  { nome: 'Torno CNC 01', tipo: 'Torno CNC', fabricante: 'Exemplo', setor: 'Usinagem', preventiva_dias: 90 },
  { nome: 'Torno CNC 02', tipo: 'Torno CNC', fabricante: 'Exemplo', setor: 'Usinagem', preventiva_dias: 90 },
  { nome: 'TA 25', tipo: 'Torno automático', setor: 'Usinagem', preventiva_dias: 60 },
  { nome: 'Fresadora FS 01', tipo: 'Fresadora', setor: 'Usinagem', preventiva_dias: 120 },
  { nome: 'Serra Automática SR 03', tipo: 'Serra', setor: 'Corte', preventiva_dias: 60 },
  { nome: 'Prensa Hidráulica', tipo: 'Prensa', setor: 'Estampagem', preventiva_dias: 180 },
  { nome: 'Curvadora', tipo: 'Curvadora de tubos', setor: 'Conformação' },
  { nome: 'Cabine de pintura', tipo: 'Pintura', setor: 'Acabamento', preventiva_dias: 30 },
]
// [código, descrição, utilização, fornecedor, mín, máx, preço, consumo/mês]
type LinhaPeca = [string, string, string, string, number, number, number, number]
const PECAS: LinhaPeca[] = [
  ['CNMG 120412-EX', 'Inserto para torneamento', 'Torno CNC', 'Alfa Ferramentas', 10, 30, 36, 12],
  ['DCMT 11T304-EX', 'Inserto para torneamento', 'Torno CNC', 'Alfa Ferramentas', 10, 30, 38.3, 10],
  ['DNMG 150604-EX', 'Inserto para torneamento', 'Torno CNC', 'Alfa Ferramentas', 10, 20, 60.5, 8],
  ['TCMT 110204-EX', 'Inserto para torneamento', 'Torno CNC', 'Alfa Ferramentas', 10, 20, 27, 5],
  ['GCMR 2002-EX', 'Inserto para cortar', 'TA 25', 'Alfa Ferramentas', 10, 30, 48, 14],
  ['MGMR 200-EX', 'Inserto para cortar', 'TA 25', 'Gama Importados', 20, 60, 17.1, 20],
  ['WGE 20R-EX', 'Inserto para cortar', 'TA 25', 'Gama Importados', 20, 40, 64.9, 10],
  ['SCMT 09T308-EX', 'Inserto para fresadora', 'Fresadora FS 01', 'Alfa Ferramentas', 10, 20, 46.4, 6],
  ['APMT 1604-EX', 'Inserto para fresar', 'Fresadora FS 01', 'Gama Importados', 10, 20, 27, 3],
  ['SPMG 0904-EX', 'Inserto para broca T-Max', 'Torno CNC', 'Gama Importados', 10, 20, 42.3, 4],
  ['TQJ 27-EX', 'Bedame para formar canal 1,00 mm', 'Torno CNC', 'Delta Usinagem', 5, 10, 314.6, 1],
  ['6204 ZZ', 'Rolamento de esferas', 'Serra Automática SR 03', 'Beta Rolamentos', 0, 5, 18, 0.4],
  ['6200 ZZ', 'Rolamento de esferas', 'TA 25', 'Beta Rolamentos', 2, 5, 15.5, 0.5],
  ['30208', 'Rolamento de rolos cônicos', 'Fresadora FS 01', 'Beta Rolamentos', 1, 2, 120, 0.1],
  ['7210 P4', 'Rolamento de contato angular (par)', 'TA 25', 'Beta Rolamentos', 1, 2, 890, 0.05],
  ['210L-EX', 'Correia sincronizadora 210L 20 mm', 'Torno CNC 02', 'Beta Rolamentos', 1, 5, 124.5, 0.3],
  ['A34-EX', 'Correia em V A34', 'TA 25', 'Beta Rolamentos', 0, 3, 32, 0.2],
  ['PUN-8.5', 'Punção Ø8,5 para dispositivo DP 0070', 'Prensa Hidráulica', 'Delta Usinagem', 2, 7, 50, 0.6],
  ['MAT-0059', 'Matriz para dispositivo DP 0059', 'Prensa Hidráulica', 'Delta Usinagem', 1, 2, 700, 0.08],
  ['SENSOR-M12', 'Sensor indutivo 4 mm M12 PNP', 'Curvadora', 'Épsilon Elétrica', 1, 3, 145, 0.1],
  ['BOB-24V', 'Bobina solenoide 24 V', 'Serra Automática SR 03', 'Épsilon Elétrica', 1, 2, 98, 0.1],
  ['FILTRO-570', 'Filtro cartucho 570 × 600 mm', 'Cabine de pintura', 'Épsilon Elétrica', 0, 2, 380, 0.15],
  ['LED-10W', 'Refletor LED 10 W', 'TA 25', 'Épsilon Elétrica', 1, 3, 45, 0.1],
  ['KIT-PISTAO', 'Kit reparo para 3 pistões', 'Curvadora', 'Beta Rolamentos', 0, 2, 260, 0.05],
  ['ALARG-8.17', 'Alargador máquina HSS Ø8,17 mm', 'Torno CNC', 'Alfa Ferramentas', 0, 2, 295.5, 0.1],
]

// CPF inventado com dígitos verificadores certos (o banco confere)
function cpfTeste(base: number): string {
  const d = String(base).padStart(9, '0').slice(0, 9).split('').map(Number)
  for (const n of [9, 10]) { let s = 0; for (let i = 0; i < n; i++) s += d[i] * (n + 1 - i); d.push((s * 10) % 11 % 10) }
  const x = d.join('')
  return `${x.slice(0, 3)}.${x.slice(3, 6)}.${x.slice(6, 9)}-${x.slice(9)}`
}

interface Mov { data: string; codigo: string; tipo: 'entrada' | 'saida'; qtd: number; preco_unit: number; fornecedor: string; documento: string }

function historico(dia: (n: number) => string) {
  // 14 meses de movimentações por peça: entradas de lote e retiradas
  const movs: Mov[] = [], pedidos: unknown[] = []
  for (const [cod, , , forn, mi, ma, preco, porMes] of PECAS) {
    let est = 0, d = -425, p = preco * 0.82
    const lote = Math.max(1, Math.round(ma > 0 ? ma - mi : 5))
    let ultimaEnt: { p: number; doc: string } | null = null
    while (d < -2) {
      if (est <= mi && rnd() < 0.85) {
        const q = Math.max(1, Math.round(lote * (0.7 + rnd() * 0.5)))
        p = Math.round(p * (1 + rnd() * 0.06) * 100) / 100
        const doc = 'NF ' + String(entre(10000, 99999)).padStart(6, '0')
        movs.push({ data: dia(d), codigo: cod, tipo: 'entrada', qtd: q, preco_unit: p, fornecedor: forn, documento: doc })
        pedidos.push({ data: dia(d - entre(3, 12)), fornecedor: forn, documento: 'Proposta ' + entre(1000, 9999), prazo: dia(d), status: 'recebido', itens: [{ codigo: cod, qtd: q, valor: Math.round(q * p * 100) / 100 }] })
        est += q; ultimaEnt = { p, doc }
      }
      const passo = porMes >= 4 ? entre(3, 9) : porMes >= 1 ? entre(10, 25) : entre(40, 120)
      d += passo
      if (d >= -2) break
      const tirar = Math.min(est, Math.max(1, Math.round(porMes * passo / 30 * (0.6 + rnd() * 0.8))))
      if (tirar > 0 && ultimaEnt) { movs.push({ data: dia(d), codigo: cod, tipo: 'saida', qtd: tirar, preco_unit: ultimaEnt.p, fornecedor: forn, documento: ultimaEnt.doc }); est -= tirar }
    }
  }
  movs.sort((a, b) => a.data < b.data ? -1 : a.data > b.data ? 1 : (a.tipo === 'entrada' ? -1 : 1))
  // saída antes da entrada no mesmo código não pode deixar o estoque negativo: refaz o saldo
  const saldo: Record<string, number> = {}
  const ok: Mov[] = []
  for (const m of movs) { saldo[m.codigo] = saldo[m.codigo] || 0; if (m.tipo === 'saida') { if (saldo[m.codigo] < m.qtd) continue; saldo[m.codigo] -= m.qtd } else saldo[m.codigo] += m.qtd; ok.push(m) }
  ;(pedidos as { data: string }[]).sort((a, b) => a.data < b.data ? -1 : 1)
  return { movs: ok, pedidos }
}

export async function criarDemo(): Promise<void> {
  semente = 20261019
  const hoje = U.hoje()
  const dia = (n: number) => U.somaDias(hoje, n)
  const senha = 'teste1234'
  await API.rpc('primeiro_dono', { p_login: 'dono', p_senha: senha, p_nome: 'Dono (teste)' })
  await API.entrar('dono', senha)
  // RH: setores e cargos (organograma) antes das pessoas
  for (const nome of ['Usinagem', 'Produção', 'Almoxarifado', 'Escritório', 'Qualidade', 'RH']) await API.rpc('rh_salvar_setor', { p: { nome } })
  const cargo: Record<string, string> = {}
  const novoCargo = async (nome: string, setor: string, sup: string | null, cbo: string) => { cargo[nome] = await API.rpc<string>('rh_salvar_cargo', { p: { nome, setor, cbo, tipo: setor === 'Escritório' || setor === 'RH' ? 'Administrativo' : setor, superior_id: sup ? cargo[sup] : null } }) }
  await novoCargo('Gerente geral', 'Escritório', null, '1421-05')
  await novoCargo('Gerente de produção', 'Produção', 'Gerente geral', '1412-05')
  await novoCargo('Líder de produção', 'Produção', 'Gerente de produção', '7201-10')
  await novoCargo('Torneiro CNC', 'Usinagem', 'Líder de produção', '7212-15')
  await novoCargo('Operador de torno automático', 'Usinagem', 'Líder de produção', '7214-20')
  await novoCargo('Fresador', 'Usinagem', 'Líder de produção', '7212-10')
  await novoCargo('Ajudante geral', 'Produção', 'Líder de produção', '7842-05')
  await novoCargo('Coordenador de logística', 'Almoxarifado', 'Gerente geral', '1416-15')
  await novoCargo('Almoxarife', 'Almoxarifado', 'Coordenador de logística', '4141-05')
  await novoCargo('Assistente de RH', 'RH', 'Gerente geral', '4110-30')
  await novoCargo('Auxiliar administrativo', 'Escritório', 'Gerente geral', '4110-05')
  await novoCargo('Inspetor de qualidade', 'Qualidade', 'Gerente geral', '3912-05')
  // [nome, cargo, setor, admissão, salário, registro]
  const funcs: [string, string, string, string, number, string][] = [
    ['Beto Silva', 'Torneiro CNC', 'Usinagem', '2019-03-11', 3000, 'Matriz'], ['Caio Souza', 'Operador de torno automático', 'Usinagem', '2021-08-02', 3100, 'Matriz'],
    ['Denise Lima', 'Auxiliar administrativo', 'Escritório', '2022-01-17', 2800, 'Matriz'], ['Edu Rocha', 'Almoxarife', 'Almoxarifado', U.somaMeses(hoje, -23), 2900, 'Filial'],
    ['Fábio Nunes', 'Fresador', 'Usinagem', '2018-05-07', 3500, 'Filial'], ['Gil Prado', 'Ajudante geral', 'Produção', U.somaMeses(hoje, -5), 2100, 'Filial'],
    ['Helena Costa', 'Assistente de RH', 'RH', '2020-02-03', 3900, 'Matriz'], ['Ivo Martins', 'Gerente de produção', 'Produção', '2016-09-12', 7800, 'Matriz'],
    ['Júlia Alves', 'Inspetor de qualidade', 'Qualidade', U.somaDias(U.somaMeses(hoje, -21), -15), 3300, 'Matriz'],
    ['Kleber Dias', 'Líder de produção', 'Produção', U.somaDias(U.somaMeses(hoje, -22), -10), 4600, 'Filial'],
    ['Lia Ramos', 'Operador de torno automático', 'Usinagem', '2023-04-10', 2700, 'Upgrade'], ['Nina Barros', 'Ajudante geral', 'Produção', U.somaDias(hoje, -12), 2000, 'Filial'],
    ['Otávio Reis', 'Torneiro CNC', 'Usinagem', '2017-06-19', 3700, 'Matriz'], ['Paulo Gomes', 'Ajudante geral', 'Produção', '2024-02-05', 2100, 'Sem registro'],
  ]
  const ids: Record<string, string> = {}
  for (const [n, [nome, cg, setor, adm, sal, registro]] of funcs.entries()) {
    const [nm, ...sob] = nome.split(' ')
    ids[nome] = await API.rpc('salvar_funcionario', { p: { nome, cargo_id: cargo[cg], setor, admissao: adm, registro, matricula: 'JAF' + String(100 + n), horario: '07:00 às 17:00',
      descanso: 'Sábado e domingo', telefone: '(11) 95555-' + entre(1000, 9999),
      privado: { salario: sal, cpf: cpfTeste(123450000 + n * 7919), rg: String(entre(10000000, 49999999)) + '-X', pis: '1' + entre(1000000000, 9999999999),
        nascimento: `19${entre(70, 99)}-${String(entre(1, 12)).padStart(2, '0')}-${String(entre(1, 28)).padStart(2, '0')}`, sexo: ['Helena', 'Júlia', 'Lia', 'Nina', 'Denise'].includes(nm) ? 'Feminino' : 'Masculino',
        estado_civil: n % 3 ? 'Casado(a)' : 'Solteiro(a)', nacionalidade: 'Brasileira', naturalidade: 'São Paulo', uf_nascimento: 'SP', mae: 'Maria ' + sob.join(' ') + ' (exemplo)',
        instrucao: n % 2 ? 'Médio completo' : 'Técnico', celular: '(11) 9' + entre(4000, 9999) + '-' + entre(1000, 9999), endereco: 'Rua Exemplo', numero: String(entre(10, 999)), bairro: 'Centro',
        cidade: 'São Paulo', cep: '01000-000', banco: 'Banco Exemplo ag. 0001 c/c ' + entre(10000, 99999), uniforme: ['P', 'M', 'G', 'GG'][n % 4], calcado: String(37 + (n % 8)),
        emergencia_nome: 'Contato de ' + nm + ' (exemplo)', emergencia_fone: '(11) 9' + entre(4000, 9999) + '-' + entre(1000, 9999) } } })
  }
  // chefes diretos e gestores de setor
  const chefe = async (quem: string, de: string) => { await API._pg!.query('update public.funcionarios set superior_id = $1 where id = $2', [ids[de], ids[quem]]) }
  for (const q of ['Beto Silva', 'Caio Souza', 'Fábio Nunes', 'Gil Prado', 'Lia Ramos', 'Nina Barros', 'Otávio Reis', 'Paulo Gomes']) await chefe(q, 'Kleber Dias')
  await chefe('Kleber Dias', 'Ivo Martins')
  await API.rpc('criar_acesso', { p_login: 'escritorio', p_senha: senha, p_nome: 'Denise (teste)', p_perfil: 'escritorio', p_func: ids['Denise Lima'] })
  await API.rpc('criar_acesso', { p_login: 'almox', p_senha: senha, p_nome: 'Edu (teste)', p_perfil: 'almoxarife', p_func: ids['Edu Rocha'] })
  await API.rpc('criar_acesso', { p_login: 'pcp', p_senha: senha, p_nome: 'Paula (teste)', p_perfil: 'pcp', p_func: null })
  await API.rpc('criar_acesso', { p_login: 'operador', p_senha: senha, p_nome: 'Beto (teste)', p_perfil: 'producao', p_func: ids['Beto Silva'] })
  await API.rpc('criar_acesso', { p_login: 'helena', p_senha: senha, p_nome: 'Helena (teste)', p_perfil: 'rh', p_func: ids['Helena Costa'] })
  await API.rpc('criar_acesso', { p_login: 'gerente', p_senha: senha, p_nome: 'Ivo (teste)', p_perfil: 'gerente', p_func: ids['Ivo Martins'] })
  await API.rpc('criar_acesso', { p_login: 'tecnico', p_senha: senha, p_nome: 'Tiago (teste)', p_perfil: 'tecnico', p_func: null })
  await API.rpc('criar_acesso', { p_login: 'manut', p_senha: senha, p_nome: 'Márcio (teste)', p_perfil: 'manutencao', p_func: null })
  await API.rpc('criar_acesso', { p_login: 'comercial', p_senha: senha, p_nome: 'Carla (teste)', p_perfil: 'comercial', p_func: null })

  // na demonstração as senhas já são as definitivas (no sistema real o Dono cria provisórias)
  await API._pg!.query(`update public.perfis set trocar_senha = false`)
  // o almoxarifado da demonstração sai igual ao de antes do RH (mesma sequência de sorteios)
  semente = 20261019; for (let i = 0; i < 24; i++) rnd()
  const { movs, pedidos } = historico(dia)
  await API.rpc('importar_planilha', { p: {
    fornecedores: FORN(dia), maquinas: MAQ,
    pecas: PECAS.map(([codigo, descricao, utilizacao, fornecedor, est_min, est_max]) => ({ codigo, descricao, utilizacao, fornecedor, est_min, est_max })),
    movimentos: movs, pedidos,
  }, p_substituir: true })
  await S.carregar()
  const peca = (c: string) => S.lista('pecas').find(p => p.codigo === c)!
  const forn = (n: string) => S.lista('fornecedores').find(f => f.nome === n)!
  const maq = (n: string) => S.lista('maquinas').find(m => m.nome === n)!

  // pedidos em aberto (um atrasado, um que chega hoje)
  const preco = (c: string) => PECAS.find(p => p[0] === c)![6]
  const novoPed = async (fornNome: string, itens: [string, number][], data: string, prazo: string, doc: string) => API.rpc('salvar_pedido', { p: { fornecedor_id: forn(fornNome).id, data, prazo, documento: doc,
    itens: itens.map(([c, q]) => ({ peca_id: peca(c).id, qtd: q, valor: Math.round(q * preco(c) * 100) / 100 })) } })
  await novoPed('Gama Importados', [['MGMR 200-EX', 40], ['WGE 20R-EX', 20]], dia(-30), dia(-4), 'Pedido online 82141')
  await novoPed('Alfa Ferramentas', [['DNMG 150604-EX', 10], ['TCMT 110204-EX', 10]], dia(-5), hoje, 'Proposta 89192')
  await novoPed('Beta Rolamentos', [['6200 ZZ', 4]], dia(-2), dia(6), 'WhatsApp')

  // manutenções
  const prev = async (m: string, d: number) => API.rpc('salvar_manutencao', { p: { maquina_id: maq(m).id, data: dia(d), tipo: 'preventiva', status: 'concluida', concluida_em: dia(d), problema: 'Preventiva: lubrificação, folgas e limpeza', solucao: 'Feito conforme checklist', custo_servico: 0 } })
  await prev('Torno CNC 01', -40); await prev('Torno CNC 02', -95); await prev('TA 25', -20); await prev('Fresadora FS 01', -60)
  await prev('Serra Automática SR 03', -30); await prev('Prensa Hidráulica', -100); await prev('Cabine de pintura', -12)
  await API.rpc('salvar_manutencao', { p: { maquina_id: maq('TA 25').id, data: dia(-1), tipo: 'corretiva', status: 'aberta', problema: 'Barulho no cabeçote ao acelerar', funcionario_id: ids['Caio Souza'] } })
  await API.rpc('salvar_manutencao', { p: { maquina_id: maq('Curvadora').id, data: dia(-70), tipo: 'corretiva', status: 'concluida', concluida_em: dia(-69), problema: 'Sensor não detecta o tubo',
    solucao: 'Troca do sensor indutivo', fornecedor_id: forn('Carlos Eletricista').id, custo_servico: 250, horas_parada: 6 } })

  // clientes e ordens de produção
  const cUp = await API.rpc<string>('salvar_cliente', { p: { nome: 'Upgrade Barras de Apoio', cidade: 'São Paulo', uf: 'SP', contato: 'Compras' } })
  const cOutro = await API.rpc<string>('salvar_cliente', { p: { nome: 'Cliente Exemplo Ltda.', cidade: 'Guarulhos', uf: 'SP' } })
  const op = async (o: Record<string, unknown>) => API.rpc<{ id: string }>('salvar_ordem', { p: o })
  const o1 = await op({ cliente_id: cUp, pedido_cliente: 'PC 016/26', produto: 'Barra reta 400 mm inox', codigo: 'UP 01.0002', qtd: 80, prazo: dia(5), maquina_id: maq('Curvadora').id, responsavel_id: ids['Caio Souza'] })
  await op({ cliente_id: cUp, pedido_cliente: 'PC 017/26', produto: 'Barra em L 600 × 600 mm', codigo: 'UP 01.0010', qtd: 30, prazo: dia(-2), maquina_id: maq('Curvadora').id, prioridade: 1 })
  await op({ cliente_id: cOutro, produto: 'Pino usinado Ø12', codigo: 'PN-012', qtd: 500, prazo: dia(12), maquina_id: maq('TA 25').id, responsavel_id: ids['Caio Souza'] })
  const o4 = await op({ cliente_id: cUp, pedido_cliente: 'PC 015/26', produto: 'Barra reta 800 mm', codigo: 'UP 01.0004', qtd: 40, prazo: dia(-6), maquina_id: maq('Curvadora').id })
  await API.rpc('ordem_status', { p: { id: o1.id, status: 'producao', produzido: 35 } })
  await API.rpc('ordem_status', { p: { id: o4.id, status: 'pronta' } })
  await API.rpc('ordem_status', { p: { id: o4.id, status: 'entregue', entregue_em: dia(-1) } })

  // financeiro
  const conta = (o: Record<string, unknown>) => API.rpc<string>('salvar_lancamento', { p: o })
  await conta({ tipo: 'pagar', descricao: 'Energia elétrica', categoria: 'Energia', valor: 4280.55, vencimento: dia(-3) })
  await conta({ tipo: 'pagar', descricao: 'Aluguel do galpão', categoria: 'Aluguel', valor: 9500, vencimento: hoje.slice(0, 8) + '10', parcelas: 6, intervalo: 'mensal' })
  await conta({ tipo: 'pagar', descricao: 'Simples Nacional', categoria: 'Impostos', valor: 6120.4, vencimento: hoje })
  await conta({ tipo: 'pagar', descricao: 'Compra de inserto (Alfa)', categoria: 'Compras / almoxarifado', valor: 1840, vencimento: dia(12), parcelas: 2, intervalo: '30', fornecedor_id: forn('Alfa Ferramentas').id })
  await conta({ tipo: 'receber', descricao: 'Upgrade — PC 015/26', categoria: 'Upgrade', valor: 12800, vencimento: dia(20), cliente_id: cUp, ordem_id: o4.id })
  await conta({ tipo: 'receber', descricao: 'Upgrade — PC 012/26', categoria: 'Upgrade', valor: 8600, vencimento: dia(-5), cliente_id: cUp })
  const pago = await conta({ tipo: 'receber', descricao: 'Upgrade — PC 010/26', categoria: 'Upgrade', valor: 15400, vencimento: dia(-15), cliente_id: cUp })
  await API.rpc('baixar_lancamento', { p_id: pago, p_data: dia(-14), p_valor: 15400, p_forma: 'Boleto' })
  const pago2 = await conta({ tipo: 'pagar', descricao: 'Folha de pagamento', categoria: 'Folha de pagamento', valor: 18000, vencimento: dia(-13) })
  await API.rpc('baixar_lancamento', { p_id: pago2, p_data: dia(-13), p_valor: 18000, p_forma: 'Transferência' })
  await API.rpc('salvar_config', { p_chave: 'empresa', p_valor: { nome: 'JAF Metal (teste)', cidade: 'São Paulo', uf: 'SP' } })
  await API.rpc('salvar_config', { p_chave: 'saldo_inicial', p_valor: { valor: 25000, data: dia(-30) } })
  await demoRH(ids, cargo, dia)
  await demoFabrica(dia)

  await API.sair()
  API.precisaDemo = false
}

// ------------------------------------------------------------------ RH (tudo inventado)
async function demoRH(ids: Record<string, string>, cargo: Record<string, string>, dia: (n: number) => string): Promise<void> {
  const hoje = U.hoje(), ano = Number(hoje.slice(0, 4))
  const rpc = (f: string, p: unknown) => API.rpc(f, { p })
  await S.carregar()
  for (const s of ['Usinagem', 'Produção']) { const st = S.lista('rh_setores').find(x => x.nome === s); if (st) await rpc('rh_salvar_setor', { id: st.id, nome: s, gestor_id: ids[s === 'Usinagem' ? 'Kleber Dias' : 'Ivo Martins'] }) }
  // feriados do ano
  for (const [d, n] of [['01-01', 'Confraternização Universal'], ['04-21', 'Tiradentes'], ['05-01', 'Dia do Trabalho'], ['09-07', 'Independência do Brasil'], ['10-12', 'Nossa Senhora Aparecida'],
    ['11-02', 'Finados'], ['11-15', 'Proclamação da República'], ['11-20', 'Dia da Consciência Negra'], ['12-25', 'Natal']]) await API.rpc('rh_salvar_feriado', { p_data: `${ano}-${d}`, p_nome: n, p_excluir: false })
  // promoção e dissídio na linha do tempo
  await rpc('rh_alterar_cargo_salario', { funcionario_id: ids['Beto Silva'], vigencia: U.somaMeses(hoje, -14), motivo: 'Promoção', cargo_id: cargo['Torneiro CNC'], salario: 3400, obs: 'Era operador de torno automático' })
  await rpc('rh_alterar_cargo_salario', { funcionario_id: ids['Beto Silva'], vigencia: U.somaMeses(hoje, -6), motivo: 'Dissídio', salario: 3600 })
  // férias: períodos antigos tirados; Edu vencido, Kleber vence em 30 dias, Júlia em 60, Denise de férias agora, Fábio programado
  await S.carregar()
  const ferias = async (nome: string, deixar: number, extra?: (ps: R.PeriodoFerias[]) => Promise<void>) => {
    const f = S.get('funcionarios', ids[nome])!
    const ps = R.periodosFerias(f, []).filter(p => p.adquirido)
    for (const p of ps.slice(0, Math.max(0, ps.length - deixar))) {
      const ini = U.somaDias(p.fim, 70)
      if (U.somaDias(ini, 29) < hoje) await rpc('rh_salvar_ausencia', { funcionario_id: f.id, tipo: 'ferias', inicio: ini, fim: U.somaDias(ini, 29), aquisitivo_inicio: p.inicio })
    }
    await extra?.(ps)
  }
  await ferias('Beto Silva', 1); await ferias('Caio Souza', 1); await ferias('Helena Costa', 1); await ferias('Ivo Martins', 1); await ferias('Otávio Reis', 1); await ferias('Lia Ramos', 1); await ferias('Paulo Gomes', 1)
  await ferias('Edu Rocha', 1); await ferias('Kleber Dias', 1); await ferias('Júlia Alves', 1)
  await ferias('Denise Lima', 1, async (ps) => { const p = ps.at(-1); if (p) await rpc('rh_salvar_ausencia', { funcionario_id: ids['Denise Lima'], tipo: 'ferias', inicio: dia(-5), fim: dia(9), aquisitivo_inicio: p.inicio }) })
  await ferias('Fábio Nunes', 1, async (ps) => { const p = ps.at(-1); if (p) await rpc('rh_salvar_ausencia', { funcionario_id: ids['Fábio Nunes'], tipo: 'ferias', inicio: dia(40), fim: dia(59), aquisitivo_inicio: p.inicio }) })
  // atestado, afastamento pelo INSS e falta
  await rpc('rh_salvar_ausencia', { funcionario_id: ids['Gil Prado'], tipo: 'atestado', inicio: dia(-8), fim: dia(-7), cid: 'J11', motivo: 'Dr. Exemplo' })
  await rpc('rh_salvar_ausencia', { funcionario_id: ids['Otávio Reis'], tipo: 'afastamento', inicio: dia(-40), fim: null, motivo: 'Auxílio-doença (exemplo)' })
  // ponto: horas extras, sábado, domingo e um atraso (mês passado e este)
  const util = (d: string) => { const w = R.diaSemana(d); return w > 0 && w < 6 }
  const dias = (m: number) => { const ini = U.somaMeses(hoje.slice(0, 8) + '01', m), fim = m === 0 ? hoje : U.somaDias(U.somaMeses(ini, 1), -1); const l: string[] = []; for (let d = ini; d <= fim; d = U.somaDias(d, 1)) l.push(d); return l }
  for (const [nome, desloc] of [['Beto Silva', 0], ['Caio Souza', 1], ['Lia Ramos', 2], ['Kleber Dias', 3]] as [string, number][]) {
    for (const m of [-1, 0]) {
      const l = dias(m), ponto: Record<string, unknown>[] = []
      const uteis = l.filter(util)
      for (const [i, d] of uteis.entries()) if ((i + desloc) % 4 === 0) ponto.push({ data: d, e1: '07:00', s1: '12:00', e2: '13:00', s2: R.diaSemana(d) === 5 ? '18:00' : '19:00' })
      const sab = l.filter(d => R.diaSemana(d) === 6)[desloc % 2]; if (sab) ponto.push({ data: sab, e1: '07:00', s1: '12:00' })
      const dom = l.filter(d => R.diaSemana(d) === 0)[1]; if (dom && desloc < 2) ponto.push({ data: dom, e1: '07:00', s1: '11:00' })
      const atr = uteis[uteis.length - 2]; if (atr && nome === 'Caio Souza' && !ponto.some(x => x.data === atr)) ponto.push({ data: atr, e1: '07:40', s1: '12:00', e2: '13:00', s2: '17:00' })
      const falta = uteis[3]; if (falta && nome === 'Lia Ramos' && m === -1 && !ponto.some(x => x.data === falta)) ponto.push({ data: falta, justificativa: 'falta' })
      if (ponto.length) await rpc('rh_salvar_ponto', { funcionario_id: ids[nome], dias: ponto })
    }
  }
  await API.rpc('rh_fechar_mes', { p_func: ids['Beto Silva'], p_competencia: U.somaMeses(hoje.slice(0, 8) + '01', -1), p_fechar: true })
  // matrizes
  const usin = ['Beto Silva', 'Caio Souza', 'Fábio Nunes', 'Kleber Dias', 'Lia Ramos', 'Otávio Reis']
  const mT = await API.rpc<string>('rh_salvar_matriz', { p: { nome: 'Treinamentos e competências — Produção', tipo: 'treinamento', setor: 'Usinagem', gestor: 'Ivo Martins', aprovado_por: 'Helena Costa', aprovado_em: dia(-30),
    legenda: [{ nivel: 0, txt: 'Não requer' }, { nivel: 1, txt: 'Planejado' }, { nivel: 2, txt: 'Realizado' }],
    itens: [{ nome: 'Leitura e interpretação de desenhos', carga_horaria: 8 }, { nome: 'Paquímetro', carga_horaria: 4 }, { nome: 'Micrômetro', carga_horaria: 4 },
      { nome: 'NR-12 Segurança em máquinas', carga_horaria: 8, validade_meses: 24, obrigatorio: true }, { nome: 'Operador de empilhadeira', carga_horaria: 16, validade_meses: 12, obrigatorio: true }] } })
  const mV = await API.rpc<string>('rh_salvar_matriz', { p: { nome: 'Versatilidade — Usinagem', tipo: 'versatilidade', setor: 'Usinagem', gestor: 'Kleber Dias',
    legenda: [{ nivel: 1, txt: 'Em treinamento' }, { nivel: 2, txt: 'Opera' }, { nivel: 3, txt: 'Prepara e opera' }, { nivel: 4, txt: 'Prepara, opera e libera' }],
    itens: ['Torno CNC 01', 'Torno CNC 02', 'TA 25', 'Fresadora FS 01', 'Serra Automática SR 03'].map(nome => ({ nome })) } })
  const mP = await API.rpc<string>('rh_salvar_matriz', { p: { nome: 'Procedimentos do SGQ', tipo: 'procedimento', legenda: [{ nivel: 0, txt: 'Não se aplica' }, { nivel: 1, txt: 'Em treinamento' }, { nivel: 2, txt: 'Treinado' }],
    itens: ['PQ-7.1 Recursos', 'PQ-7.2 Competência', 'PQ-8.5 Produção', 'PQ-10.2 Não conformidade'].map(nome => ({ nome })) } })
  await S.carregar()
  const itens = (m: string) => S.lista('rh_matriz_itens').filter(i => i.matriz_id === m).sort((a, b) => a.ordem - b.ordem)
  for (const [k, nome] of usin.entries()) {
    for (const [j, it] of itens(mT).entries()) {
      const nivel = j === 4 ? (k < 2 ? 2 : 0) : (k + j) % 3 === 0 ? 1 : 2
      const data = j === 3 ? (k === 0 ? U.somaMeses(hoje, -25) : k === 1 ? U.somaDias(U.somaMeses(hoje, -24), 20) : U.somaMeses(hoje, -6)) : j === 4 ? U.somaMeses(hoje, -11) : U.somaMeses(hoje, -(k + j + 2))
      await rpc('rh_definir_nivel', { item_id: it.id, funcionario_id: ids[nome], nivel, data: nivel === 2 ? data : null })
    }
    for (const [j, it] of itens(mV).entries()) await rpc('rh_definir_nivel', { item_id: it.id, funcionario_id: ids[nome], nivel: 1 + ((k + j * 2) % 4) })
  }
  for (const [k, nome] of ['Beto Silva', 'Júlia Alves', 'Kleber Dias', 'Helena Costa', 'Edu Rocha'].entries())
    for (const [j, it] of itens(mP).entries()) await rpc('rh_definir_nivel', { item_id: it.id, funcionario_id: ids[nome], nivel: (k + j) % 3, data: (k + j) % 3 === 2 ? U.somaMeses(hoje, -3) : null })
  await rpc('rh_salvar_plano', { treinamento: 'Leitura e interpretação de desenhos', data: dia(-60), modalidade: 'Presencial', instituicao: 'Instrutor interno', status: 'realizado', matriz_id: mT })
  await rpc('rh_salvar_plano', { treinamento: 'Micrômetro', data: dia(20), modalidade: 'Presencial', instituicao: 'Escola técnica (exemplo)', matriz_id: mT })
  await rpc('rh_salvar_plano', { treinamento: 'FMEA', data: dia(45), modalidade: 'EAD', instituicao: 'Curso online (exemplo)' })
  await rpc('rh_salvar_meta', { funcionario_id: ids['Gil Prado'], objetivo: 'Operar a serra automática sozinho', acao: 'Acompanhar o Kleber por 2 semanas', prazo: dia(30) })
  await rpc('rh_salvar_meta', { funcionario_id: ids['Lia Ramos'], objetivo: 'Preparar o torno CNC 02', acao: 'Curso de programação CNC', prazo: dia(-5) })
  // exames (ASO): um vencido, um vencendo, o resto em dia
  for (const [k, nome] of Object.keys(ids).entries()) {
    if (nome === 'Gil Prado') continue
    const data = nome === 'Caio Souza' ? U.somaMeses(hoje, -13) : nome === 'Fábio Nunes' ? U.somaDias(U.somaMeses(hoje, -11), 10) : nome === 'Nina Barros' ? dia(-13) : U.somaMeses(hoje, -(1 + k % 9))
    await rpc('rh_salvar_aso', { funcionario_id: ids[nome], tipo: nome === 'Nina Barros' ? 'Admissional' : 'Periódico', data_exame: data, periodicidade_meses: 12, resultado: 'Apto', medico: 'Dr. Exemplo', crm: '000000-SP' })
  }
  // EPI
  for (const nome of ['Beto Silva', 'Caio Souza', 'Lia Ramos', 'Nina Barros']) {
    const ent = nome === 'Nina Barros' ? dia(-12) : U.somaMeses(hoje, -8)
    await rpc('rh_salvar_epi', { funcionario_id: ids[nome], epi: 'Óculos de proteção', ca: '12345', entrega: ent, vida_util_meses: 6, quantidade: 1, motivo: nome === 'Nina Barros' ? 'Admissional' : 'Troca por desgaste' })
    await rpc('rh_salvar_epi', { funcionario_id: ids[nome], epi: 'Protetor auricular tipo plug', ca: '54321', entrega: ent, vida_util_meses: 3, quantidade: 2, motivo: nome === 'Nina Barros' ? 'Admissional' : 'Troca por desgaste' })
    await rpc('rh_salvar_epi', { funcionario_id: ids[nome], epi: 'Botina de segurança', ca: '11111', entrega: ent, vida_util_meses: 12, validade_ca: nome === 'Caio Souza' ? dia(-20) : dia(400), quantidade: 1, motivo: nome === 'Nina Barros' ? 'Admissional' : 'Troca por desgaste' })
  }
  // cadastro de EPI com CA (um com CA vencido)
  await rpc('rh_salvar_epi_catalogo', { descricao: 'Luva de vaqueta', fabricante: 'Luvas Exemplo', ca: '99902', validade_ca: dia(700), tamanhos: 'P, M, G', onde_utiliza: 'Solda MIG e TIG', vida_util_meses: 3 })
  await rpc('rh_salvar_epi_catalogo', { descricao: 'Óculos de segurança', fabricante: 'Óculos Exemplo', ca: '99903', validade_ca: dia(300), tamanhos: 'Único', onde_utiliza: 'Fábrica', vida_util_meses: 6 })
  await rpc('rh_salvar_epi_catalogo', { descricao: 'Protetor auditivo tipo concha', fabricante: 'Protetor Exemplo', ca: '99904', validade_ca: dia(-30), onde_utiliza: 'Fábrica' })
  // salário de referência de dois cargos e a receita dos meses do ano (indicadores)
  await rpc('rh_salario_cargo', { cargo_id: cargo['Torneiro CNC'], salario: 4200 })
  await rpc('rh_salario_cargo', { cargo_id: cargo['Ajudante geral'], salario: 2300 })
  await rpc('rh_salvar_indicadores', { ano: Number(hoje.slice(0, 4)), meses: Array.from({ length: Number(hoje.slice(5, 7)) }, (_, i) => ({ mes: i + 1, receita: 180000 + i * 7500, beneficios: 9000 })) })
  // medidas disciplinares
  await rpc('rh_salvar_ocorrencia', { funcionario_id: ids['Gil Prado'], tipo: 'verbal', data_ocorrencia: dia(-50), status: 'assinado', categoria: 'Descumprimento de regras de segurança (EPI)', assunto: 'Sem óculos de proteção',
    descricao: 'Foi visto operando a esmerilhadeira sem os óculos de proteção (exemplo).', aplicador: 'Kleber Dias', aplicador_cargo: 'Líder de produção' })
  await rpc('rh_salvar_ocorrencia', { funcionario_id: ids['Caio Souza'], tipo: 'escrita', data_ocorrencia: dia(-3), status: 'pendente', categoria: 'Desídia (atrasos, faltas sem justificativa, baixa produção)', assunto: 'Atrasos repetidos',
    descricao: 'Chegou atrasado 3 vezes no mês sem justificativa (exemplo).', aplicador: 'Helena Costa', aplicador_cargo: 'Assistente de RH' })
  await rpc('rh_salvar_processo', { autor: 'Paulo Gomes', funcionario_id: ids['Paulo Gomes'], numero: '0000000-00.2026.5.02.0000 (exemplo)', data_autuacao: dia(-5), advogado: 'Escritório Exemplo' })
  // benefícios com valores de exemplo e quem recebe (o desconto do funcionário sai sozinho)
  await S.carregar(); await S.garantir(['rh_beneficios', 'rh_beneficio_vinculos', 'rh_eventos_folha'])
  const valorBen: Record<string, number> = { 'Vale alimentação': 300, VR: 660, VT: 352, Wellhub: 119.9 }
  const ben: Record<string, string> = {}
  for (const b of S.lista('rh_beneficios')) {
    ben[b.nome] = b.id
    if (valorBen[b.nome] != null) await rpc('rh_salvar_beneficio', { ...b, fornecedor: 'Operadora (exemplo)', valor: valorBen[b.nome] })
  }
  const inicioBen = U.somaMeses(hoje.slice(0, 8) + '01', -3)
  for (const [k, nome] of Object.keys(ids).entries()) {
    if (nome === 'Paulo Gomes') continue
    if (ben['Vale alimentação']) await rpc('rh_salvar_vinculo', { funcionario_id: ids[nome], beneficio_id: ben['Vale alimentação'], inicio: inicioBen })
    if (ben.VR) await rpc('rh_salvar_vinculo', { funcionario_id: ids[nome], beneficio_id: ben.VR, inicio: inicioBen })
    if (ben.VT && k % 3 !== 0) await rpc('rh_salvar_vinculo', { funcionario_id: ids[nome], beneficio_id: ben.VT, inicio: inicioBen, valor: k % 2 ? 352 : 264 })
    if (ben.Wellhub && k % 4 === 1) await rpc('rh_salvar_vinculo', { funcionario_id: ids[nome], beneficio_id: ben.Wellhub, inicio: U.somaMeses(inicioBen, 1) })
  }
  // um evento novo da contabilidade (exemplo) e as empresas da folha (dados inventados), metas dos indicadores
  if (ben.VR) await rpc('rh_salvar_evento', { codigo: 4501, descricao: 'Desc. Vale Refeição (exemplo)', origem: 'beneficio_desconto', beneficio_id: ben.VR })
  await S.carregar()
  await API.rpc('salvar_config', { p_chave: 'rh', p_valor: { ...S.cfg<Record<string, unknown>>('rh', {}), metas: { turnover: 2, absenteismo: 1.5 }, empresas_folha: [
    { registro: 'Matriz', razao: 'METALURGICA EXEMPLO LTDA', cnpj: '00.000.000/0001-91', prefixo: 'JAF' },
    { registro: 'Filial', razao: 'METALURGICA EXEMPLO LTDA', cnpj: '00.000.000/0002-72', prefixo: 'JAFII' },
    { registro: 'Upgrade', razao: 'BARRAS EXEMPLO LTDA', cnpj: '11.111.111/0001-91', prefixo: 'UPGRADE' }] } })
  // histórico dos indicadores do ano passado, como se viesse da planilha antiga do RH (números inventados)
  await rpc('rh_salvar_indicadores', { ano: ano - 1, meses: Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, origem: 'planilha',
    fim: 12 + (i > 5 ? 1 : 0), adm: i === 3 || i === 6 ? 1 : 0, dem: i === 3 ? 1 : 0, prev_h: 2050 + (i % 3) * 40, injust_h: [8, 0, 16, 4, 0, 24, 8, 0, 12, 40, 8, 4][i], just_h: [16, 24, 8, 30, 12, 8, 40, 16, 8, 24, 16, 8][i], he_h: 150 + (i * 37) % 90 })) })
  // um desligado
  const p = S.get('funcionarios', ids['Paulo Gomes'])!
  await rpc('salvar_funcionario', { ...p, situacao: 'desligado', demissao: dia(-20), privado: { ...(S.get('funcionarios_privado', p.id) || {}), motivo_demissao: 'Pedido de demissão' } })
}

// ------------------------------------------------------------------ fábrica (PCP, pedidos de clientes, técnico, manutenção) — tudo inventado.
// Entra pelo mesmo caminho da importação das planilhas reais (importar_fabrica), para testar esse caminho também.
async function demoFabrica(dia: (n: number) => string): Promise<void> {
  const imp = (parte: string, p: unknown, sub = false) => API.rpc('importar_fabrica', { p_parte: parte, p, p_substituir: sub })
  const aa = dia(0).slice(2, 4)
  await imp('inicio', {})
  await imp('fornecedores', [{ nome: 'Aço Exemplo Distribuidora', cidade: 'São Paulo', uf: 'SP' }, { nome: 'Zincagem Exemplo', cidade: 'Diadema', uf: 'SP' }])
  await imp('config', { codigo_inteligente: {
    liga: [{ c: 'AB', d: 'Aço SAE 1008' }, { c: 'AE', d: 'Aço SAE 1020' }, { c: 'IA', d: 'Inox 304' }],
    perfil: [{ c: '01', d: 'Redondo' }, { c: '05', d: 'Chapa' }, { c: '07', d: 'Tubo redondo' }],
    processo: [{ c: 'A', d: 'Laminado' }, { c: 'B', d: 'Trefilado' }],
    estado: [{ c: '01', d: 'h9' }, { c: '05', d: 'Decapado e oleado' }],
    medida: [{ c: 'ac', d: '6,35' }, { c: 'bb', d: '2,0' }, { c: 'bw', d: '1200' }, { c: 'cg', d: '25,4' }] },
    codigos: { siglas: [{ nome: 'Upgrade Barras de Apoio', sigla: 'UP' }, { nome: 'Cliente Exemplo Ltda.', sigla: 'CX' }],
      tipos: [{ prefixo: 'CF', tipo: '02', descricao: 'Componente fabricado' }, { prefixo: 'CC', tipo: '03', descricao: 'Componente comprado' }, { prefixo: 'SC', tipo: '04', descricao: 'Sub-conjunto' }] } })
  await imp('clientes', [{ nome: 'Upgrade Barras de Apoio', sigla: 'UP' }, { nome: 'Cliente Exemplo Ltda.', sigla: 'CX', contato2: 'Qualidade' }])
  await imp('produtos', [
    { codigo: 'AE01.B01.ac', descricao: 'Aço SAE 1020 redondo trefilado h9 6,35', classe: 'mp' },
    { codigo: 'AB05.A05.bb x bw', descricao: 'Aço SAE 1008 chapa laminada decapada 2,0 x 1200', classe: 'mp' },
    { codigo: 'IA07.B01.cg', descricao: 'Tubo inox 304 redondo 25,4', classe: 'mp' },
    { codigo: 'CF 02.0001', descricao: 'Pino 6 x 40', classe: 'peca', mp_codigo: 'AE01.B01.ac', mp_qtd: 0.012, mp_unidade: 'Kg', operacao: 'Tornear', cliente: 'Cliente Exemplo Ltda.', codigo_cliente: 'CX-1001', checks: { desenhos: true, rf_pc: true } },
    { codigo: 'CF 02.0002', descricao: 'Suporte dobrado', classe: 'peca', mp_codigo: 'AB05.A05.bb x bw', mp_qtd: 0.35, mp_unidade: 'Kg', operacao: 'Estampar e dobrar', checks: { desenhos: true } },
    { codigo: 'CF 02.0003', descricao: 'Tubo cortado 400 mm', classe: 'peca', mp_codigo: 'IA07.B01.cg', mp_qtd: 0.42, mp_unidade: 'Kg', operacao: 'Cortar e curvar' },
    { codigo: 'CC 03.0001', descricao: 'Parafuso M6 x 20 (comprado)', classe: 'peca' },
    { codigo: 'UP 01.0002', descricao: 'Barra reta 400 mm inox', classe: 'peca', cliente: 'Upgrade Barras de Apoio', codigo_cliente: 'BR-400', pecas_mes: 300, checks: { solic_desenv: true, desenhos: true, planos_montagem: true } },
    { codigo: 'UP 01.0004', descricao: 'Barra reta 800 mm inox', classe: 'peca', cliente: 'Upgrade Barras de Apoio', codigo_cliente: 'BR-800' },
  ])
  await imp('estrutura', [
    { pai: 'UP 01.0002', filho: 'CF 02.0003', qtd: 1, unidade: 'Pç', ordem: 1 }, { pai: 'UP 01.0002', filho: 'CF 02.0002', qtd: 2, unidade: 'Pç', ordem: 2 }, { pai: 'UP 01.0002', filho: 'CC 03.0001', qtd: 4, unidade: 'Pç', ordem: 3 },
    { pai: 'UP 01.0004', filho: 'CF 02.0002', qtd: 2, unidade: 'Pç', ordem: 1 }, { pai: 'UP 01.0004', filho: 'CC 03.0001', qtd: 4, unidade: 'Pç', ordem: 2 },
  ])
  await imp('lotes', [
    { ri: 1001, codigo: 'AE01.B01.ac', qtd: 120, data: dia(-60), nota: '1234', fornecedor: 'Aço Exemplo Distribuidora', pedido: '55', status: 'Aprovado' },
    { ri: 1002, codigo: 'AB05.A05.bb x bw', qtd: 800, data: dia(-30), nota: '1301', fornecedor: 'Aço Exemplo Distribuidora', status: 'Aprovado' },
    { ri: 1003, codigo: 'IA07.B01.cg', qtd: 60, data: dia(-12), nota: '1320', fornecedor: 'Aço Exemplo Distribuidora', status: 'Aprovado' },
    { ri: 1004, codigo: 'AE01.B01.ac', qtd: 100, data: dia(-2), nota: '1388', fornecedor: 'Aço Exemplo Distribuidora', status: 'Aguardando' },
  ])
  await imp('vendas', [
    { cliente: 'Upgrade', codigo: 'UP 01.0002', descricao: 'Barra reta 400 mm inox', pedido: 'PC 018/26', prazo: dia(-2), qtd: 50, valor: 38.5, entregue: 20, entregue_em: dia(-4) },
    { cliente: 'Upgrade', codigo: 'UP 01.0004', descricao: 'Barra reta 800 mm inox', pedido: 'PC 019/26', prazo: dia(10), qtd: 30, valor: 52 },
    { cliente: 'Cliente Exemplo', codigo: 'CF 02.0001', codigo_cliente: 'CX-1001', pedido: '4500-77', prazo: dia(0), qtd: 1000, valor: 0.9 },
    { cliente: 'Cliente Exemplo', codigo: 'CF 02.0001', codigo_cliente: 'CX-1001', pedido: '4500-61', prazo: dia(-20), qtd: 500, valor: 0.9, entregue: 500, entregue_em: dia(-21) },
    { cliente: 'Cliente Exemplo', descricao: 'Amostra de bucha (sem cadastro)', pedido: '4500-80', prazo: dia(25), qtd: 10 },
  ])
  await imp('ofs', [
    { numero: Number(aa) * 10000 + 1, tipo: 'componente', codigo: 'CF 02.0001', qtd: 500, produzido: 500, ri: 1001, kg: 6, emitido_por: 'Paula', emitida_em: dia(-25), realizado_por: 'Beto', realizada_em: dia(-22), status: 'encerrada' },
    { numero: Number(aa) * 10000 + 2, tipo: 'componente', codigo: 'CF 02.0002', qtd: 100, ri: 1002, kg: 35, emitido_por: 'Paula', emitida_em: dia(-6), status: 'aberta' },
    { numero: Number(aa) * 10000 + 3, tipo: 'componente', codigo: 'CF 02.0003', qtd: 50, ri: 1003, kg: 21, emitido_por: 'Paula', emitida_em: dia(-6), status: 'aberta' },
    { numero: Number(aa) * 10000 + 4, tipo: 'componente', codigo: 'CF 02.0001', qtd: 300, ri: 1099, kg: 3.6, emitido_por: 'Paula', emitida_em: dia(-1), status: 'aberta', obs: 'R.I. sem entrada (exemplo do que a planilha tem)' },
    { numero: Number(aa) * 100000 + 1, tipo: 'conjunto', codigo: 'UP 01.0002', qtd: 50, emitido_por: 'Paula', emitida_em: dia(-6), status: 'aberta',
      componentes: [{ codigo: 'CF 02.0003', qtd: 50, ref: String(Number(aa) * 10000 + 3) }, { codigo: 'CF 02.0002', qtd: 100, ref: String(Number(aa) * 10000 + 2) }, { codigo: 'CC 03.0001', qtd: 200, ref: null }] },
  ])
  await imp('maquinas', [
    { codigo: 'TA 25', nome: 'Torno automático TA 25', grupo: 'Máquina', preventiva_dias: 90, checklist: ['Nível de óleo', 'Folga do cabeçote', 'Limpeza do cavaco', 'Correias', 'Parte elétrica'] },
    { codigo: 'DD 01', nome: 'Dispositivo de dobra 01', grupo: 'Dispositivo', preventiva_dias: 180, checklist: ['Pinos guia', 'Desgaste da matriz', 'Fixação'] },
    { codigo: 'PRED MAT', nome: 'Predial — Matriz', grupo: 'Predial', preventiva_dias: 365, checklist: ['Telhado e calhas', 'Extintores', 'Quadro elétrico', 'Iluminação', 'Compressor'] },
  ])
  await imp('preventivas', [
    { maquina: 'TA 25', data: dia(-20), responsavel: 'Márcio', resultados: [{ item: 'Nível de óleo', situacao: 'Ok' }, { item: 'Folga do cabeçote', situacao: 'Corrigir' }, { item: 'Limpeza do cavaco', situacao: 'Ok' }, { item: 'Correias', situacao: 'Ok' }, { item: 'Parte elétrica', situacao: 'Ok' }] },
    { maquina: 'PRED MAT', data: dia(-380), responsavel: 'Márcio', resultados: [{ item: 'Telhado e calhas', situacao: 'Ok' }, { item: 'Extintores', situacao: 'Ocorrência 1' }] },
  ])
  await imp('manutencoes', [{ numero: 900, maquina: 'DD 01', data: dia(-45), tipo: 'corretiva', status: 'concluida', problema: 'Pino guia gasto', solucao: 'Troca do pino guia', custo: 120, horas_parada: 2,
    concluida_em: dia(-44), solicitante: 'Beto', responsavel: 'Márcio', pecas: 'Pino guia (feito na ferramentaria)', aprovacao: 'Ivo', equipamento: 'DD 01' }])
  const r = (tipo: string, x: Record<string, unknown>) => ({ tipo, ...x })
  await imp('registros', [
    r('desenvolvimento', { numero: 1, codigo: 'UP 01.0004', titulo: 'Barra reta 800 mm inox', status: 'Em andamento', prazo: dia(-3), responsavel: 'Tiago', data: dia(-40), dados: { cliente: 'Upgrade', codigo_cliente: 'BR-800' } }),
    r('desenvolvimento', { numero: 2, codigo: 'CF 02.0001', titulo: 'Pino 6 x 40', status: 'Concluído', concluido_em: dia(-90), responsavel: 'Tiago', data: dia(-120), dados: { cliente: 'Cliente Exemplo' } }),
    r('alteracao', { numero: 1, data: dia(-10), titulo: 'Aumentar o raio de dobra do suporte para não trincar', prazo: dia(20), responsavel: 'Tiago', status: 'Em andamento', codigo: 'CF 02.0002', dados: { solicitante: 'Beto', setor: 'Produção', justificativa: 'Peças trincando na dobra' } }),
    r('melhoria', { numero: 1, data: dia(-30), titulo: 'Organizar o cavaco do TA 25 em caçamba separada', prazo: dia(15), responsavel: 'Ivo', status: 'Em andamento', dados: { equipe: 'Produção', situacao_atual: 'Cavaco misturado' } }),
    r('desvio', { numero: 1, data: dia(-8), codigo: 'CF 02.0001', titulo: 'Material com dureza no limite superior', status: 'Aprovado', responsavel: 'Tiago', concluido_em: dia(-7), dados: { qtd: '300', solicitante: 'Paula' } }),
    r('desenho', { numero: 1, codigo: 'CF 02.0001', data: dia(-200), responsavel: 'Tiago', status: 'Em uso', dados: { rev: 'B', data_rev: dia(-210) } }),
    r('desenho', { numero: 2, codigo: 'CF 02.0002', data: dia(-150), responsavel: 'Tiago', status: 'Em uso', dados: { rev: 'A' } }),
    r('copia', { numero: 1, codigo: 'CF 02.0001', data: dia(-199), status: 'Distribuída', dados: { op: '10', rev: 'B', local: 'Tornos' } }),
    r('imds', { numero: 1, codigo: 'UP 01.0002', prazo: dia(30), status: 'Em andamento', data: dia(30), dados: { codigo_cliente: 'BR-400' } }),
    r('ata', { numero: 1, data: dia(-14), titulo: 'Reunião de qualidade do mês', responsavel: 'Ivo', status: 'Concluído', dados: { participantes: 'Ivo, Tiago, Paula', local: 'Escritório', hora: '09:00', assuntos: 'Trinca no suporte: Tiago abre alteração até sexta.' } }),
    r('setup', { numero: 1, codigo: 'CF 02.0001', status: 'Ativo', dados: { operacao: 'Tornear', setup_horas: 1.5, pecas_hora: 240 } }),
    r('servico_externo', { numero: 1, data: dia(-4), codigo: 'CF 02.0002', titulo: 'Zincagem branca', status: 'Fora (no fornecedor)', responsavel: 'Paula', dados: { qtd: 100, fornecedor: 'Zincagem Exemplo', saida: dia(-4), of: String(Number(aa) * 10000 + 2) } }),
    r('requisicao', { numero: 1, data: dia(-2), codigo: 'CC 03.0001', status: 'Em aberto', responsavel: 'Beto', dados: { qtd: 200, of: String(Number(aa) * 100000 + 1) } }),
    r('servico_manut', { data: dia(-15), titulo: 'Revisão do quadro elétrico', valor: 480, status: 'Pago', maquina: 'PRED MAT', dados: { prestador: 'Eletricista Exemplo', horas: 4, valor_hora: 120 } }),
    r('gasto_manut', { data: dia(-9), titulo: 'Óleo de corte 20 L', valor: 390, status: 'Pago', dados: { fornecedor: 'Aço Exemplo Distribuidora', plano: 'Manutenção', grupo: 'Máquina' } }),
    r('gasto_manut', { data: dia(-3), titulo: 'Correia do TA 25', valor: 145, status: 'Aguardando', dados: { grupo: 'Máquina', codigo: 'TA 25' } }),
    r('peca_critica', { titulo: 'Correia do cabeçote', maquina: 'TA 25', status: 'Comprar', valor: 145, data: dia(-200), prazo: dia(-20), dados: { vida_dias: 180, qtd: 0, min: 1, max: 2 } }),
    r('peca_critica', { titulo: 'Pino guia', maquina: 'DD 01', status: 'Ok', valor: 40, data: dia(-44), prazo: dia(130), dados: { vida_dias: 180, qtd: 2, min: 1 } }),
    r('pendencia', { titulo: '1: Trocar extintor vencido do galpão', maquina: 'PRED MAT', prazo: dia(-10), status: 'Aberta' }),
    r('ferramentaria', { data: dia(-6), titulo: 'Afiar a matriz de corte', prazo: dia(2), valor: 220, status: 'Aguardando', dados: { fornecedor: 'Ferramentaria Exemplo' } }),
  ])
  await imp('fim', { demo: true })
  // e o que se faz pelo sistema: uma OF nova, uma entrega e um check-list
  await S.carregar(); await S.garantir(['produtos', 'vendas', 'ofs', 'clientes'])
  const cod = (c: string) => S.lista('produtos').find(p => p.codigo === c)!
  const pr = cod('CF 02.0001')
  await API.rpc('emitir_of', { p: { produto_id: pr.id, qtd: 200, ri: 1001, prazo: dia(3), emitido_por: 'Paula' } })
  const v = S.lista('vendas').find(x => x.pedido === 'PC 018/26')!
  await API.rpc('entregar_venda', { p: { venda_id: v.id, qtd: 10, data: dia(-1), nf: '7001' } })
  // estoque de peça pronta: a primeira contagem e o mínimo de cada código; e uma NF-e de saída que baixou a entrega pelo XML
  for (const [c, saldo, minimo] of [['CF 02.0001', 1800, 300], ['CF 02.0002', 40, 150], ['UP 01.0002', 12, 20], ['UP 01.0004', 25, 0]] as [string, number, number][])
    await API.rpc('contar_produto', { p: { produto_id: cod(c).id, saldo, minimo, obs: 'Inventário (exemplo)' } })
  const up = S.lista('clientes').find(c => c.nome.startsWith('Upgrade'))
  if (up) await API.rpc('baixar_nota_saida', { p: { chave: '35261100000000000191550010000070021000070024', numero: '7002', serie: '1', emissao: dia(-1), cliente_id: up.id,
    cliente_nome: up.nome, valor: 520, itens: [{ n: 1, codigo: 'UP 01.0004', descricao: 'Barra reta 800 mm inox', qtd: 10, pedido: 'PC 019/26' }] } })
  // passo a passo conferido de uma peça (com máquina), um pedido de compra de material e uma necessidade do PCP
  const curv = S.lista('maquinas').find(m => m.nome === 'Curvadora')
  await API.rpc('salvar_processo', { p: { produto_id: cod('CF 02.0003').id, passos: [
    { operacao: 'Serrar no comprimento (400 mm)', peca: null, maquina_id: null }, { operacao: 'Amassar a ponta', peca: null, maquina_id: null },
    { operacao: 'Curvar', peca: null, maquina_id: curv?.id || null }, { operacao: 'Rebarbar e conferir', peca: null, maquina_id: null }] } })
  const aco = S.lista('fornecedores').find(f => f.nome === 'Aço Exemplo Distribuidora')!
  await API.rpc('salvar_pedido', { p: { tipo: 'mp', fornecedor_id: aco.id, data: dia(-3), prazo: dia(4), documento: 'Orçamento 2031',
    itens: [{ produto_id: cod('IA07.B01.cg').id, qtd: 40, valor: 1300 }] } })
  await API.rpc('salvar_necessidade', { p: { produto_id: cod('AE01.B01.ac').id, qtd: 50, prazo: dia(7), motivo: 'Estoque de segurança do pino' } })
}
