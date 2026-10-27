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
  const novoCargo = async (nome: string, setor: string, sup: string | null, cbo: string) => { cargo[nome] = await API.rpc<string>('rh_salvar_cargo', { p: { nome, setor, cbo, superior_id: sup ? cargo[sup] : null } }) }
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
  // medidas disciplinares
  await rpc('rh_salvar_ocorrencia', { funcionario_id: ids['Gil Prado'], tipo: 'verbal', data_ocorrencia: dia(-50), status: 'assinado', categoria: 'Descumprimento de regras de segurança (EPI)', assunto: 'Sem óculos de proteção',
    descricao: 'Foi visto operando a esmerilhadeira sem os óculos de proteção (exemplo).', aplicador: 'Kleber Dias', aplicador_cargo: 'Líder de produção' })
  await rpc('rh_salvar_ocorrencia', { funcionario_id: ids['Caio Souza'], tipo: 'escrita', data_ocorrencia: dia(-3), status: 'pendente', categoria: 'Desídia (atrasos, faltas sem justificativa, baixa produção)', assunto: 'Atrasos repetidos',
    descricao: 'Chegou atrasado 3 vezes no mês sem justificativa (exemplo).', aplicador: 'Helena Costa', aplicador_cargo: 'Assistente de RH' })
  await rpc('rh_salvar_processo', { autor: 'Paulo Gomes', funcionario_id: ids['Paulo Gomes'], numero: '0000000-00.2026.5.02.0000 (exemplo)', data_autuacao: dia(-5), advogado: 'Escritório Exemplo' })
  // um desligado
  const p = S.get('funcionarios', ids['Paulo Gomes'])!
  await rpc('salvar_funcionario', { ...p, situacao: 'desligado', demissao: dia(-20), motivo_demissao: 'Pedido de demissão', privado: { ...(S.get('funcionarios_privado', p.id) || {}) } })
}
