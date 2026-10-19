// Testes do banco (schema.sql) com Postgres de verdade rodando local (PGlite).
// Rodar:  PGLITE=<pasta com node_modules/@electric-sql/pglite> node testes/banco.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = process.env.PGLITE || '.'
const imp = (p) => import(pathToFileURL(path.join(base, 'node_modules', '@electric-sql', 'pglite', 'dist', p)).href)
const { PGlite } = await imp('index.js')
const { pgcrypto } = await imp('contrib/pgcrypto.js')

process.on('unhandledRejection', e => { console.log('ERRO:', e.message, '|', e.where || ''); process.exit(2) })
const db = await PGlite.create({ extensions: { pgcrypto } })
const sqlAuth = readFileSync(path.join(raiz, 'supabase', 'auth-simulado.sql'), 'utf8')
const sqlSchema = readFileSync(path.join(raiz, 'supabase', 'schema.sql'), 'utf8')
await db.exec(sqlAuth)
await db.exec(sqlSchema)
await db.exec(sqlSchema) // tem de poder rodar de novo sem erro

let ok = 0, falhas = []
const conf = (cond, nome, extra) => { if (cond) ok++; else { falhas.push(nome + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')) } }

async function como(uid, fn) {
  await db.exec('reset role')
  if (uid === 'anon') await db.exec(`set role anon; select set_config('request.jwt.claims', '', false)`)
  else if (uid) await db.exec(`set role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: uid, role: 'authenticated' })}', false)`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`) }
}
const q = async (sql, params) => (await db.query(sql, params)).rows
async function rpc(uid, nome, ...args) {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ')
  return como(uid, async () => {
    const r = await db.query(`select public.${nome}(${ph}) as r`, args.map(a => (a !== null && typeof a === 'object') ? JSON.stringify(a) : a))
    return r.rows[0].r
  })
}
async function erro(uid, nome, ...args) {
  try { await rpc(uid, nome, ...args); return null } catch (e) { return e.message }
}
async function ver(uid, sql, params) { return como(uid, () => q(sql, params)) }

// ---------------------------------------------------------------- fuso
{
  const r = await q(`select public.hoje() = (now() at time zone 'America/Sao_Paulo')::date as ok`)
  conf(r[0].ok, 'hoje() no fuso de SP')
}

// ---------------------------------------------------------------- acessos
conf(await rpc('anon', 'ha_dono') === false, 'sem dono no começo')
conf((await erro('anon', 'primeiro_dono', 'fl', '12345678', 'Dono')) !== null, 'login curto recusado')
conf((await erro('anon', 'primeiro_dono', 'donoteste', '1234', 'Dono'))?.includes('8 caracteres'), 'senha curta recusada')
const dono = await rpc('anon', 'primeiro_dono', 'DonoTeste', 'senha-forte-1', 'Dono Teste')
conf(!!dono, 'primeiro dono criado')
conf((await erro('anon', 'primeiro_dono', 'outro', 'senha-forte-1', 'Intruso'))?.includes('já foi feito'), 'segundo primeiro acesso recusado')
conf((await q(`select auth.entrar_teste('donoteste@jafmetal.local', 'senha-forte-1') = $1 as ok`, [dono]))[0].ok, 'senha confere (bcrypt)')
conf((await q(`select auth.entrar_teste('donoteste@jafmetal.local', 'errada') is null as ok`))[0].ok, 'senha errada não entra')

const esc = await rpc(dono, 'criar_acesso', 'ana', 'senha-forte-2', 'Ana Escritório', 'escritorio', null)
const alm = await rpc(dono, 'criar_acesso', 'jose', 'senha-forte-3', 'José Almox', 'almoxarife', null)
const prod = await rpc(dono, 'criar_acesso', 'beto', 'senha-forte-4', 'Beto Torno', 'producao', null)
const prod2 = await rpc(dono, 'criar_acesso', 'caio', 'senha-forte-5', 'Caio Fresa', 'producao', null)
conf(esc && alm && prod && prod2, 'acessos criados')
conf((await erro(dono, 'criar_acesso', 'ana', 'senha-forte-2', 'Ana 2', 'escritorio', null))?.includes('já existe'), 'login repetido recusado')
conf((await erro(dono, 'criar_acesso', 'zé ruela', 'senha-forte-2', 'Zé', 'escritorio', null)) !== null, 'login com espaço recusado')
conf((await erro(dono, 'criar_acesso', 'xyz', 'senha-forte-2', 'Xis', 'admin', null))?.includes('Perfil'), 'perfil inválido recusado')
conf((await erro(esc, 'criar_acesso', 'bia', 'senha-forte-2', 'Bia', 'dono', null))?.includes('perfil não pode'), 'escritório não cria acesso')
conf((await erro('anon', 'criar_acesso', 'bia', 'senha-forte-2', 'Bia', 'dono', null)) !== null, 'anônimo não cria acesso')
conf((await erro(dono, 'editar_acesso', dono, 'Flávio', 'escritorio', true, null))?.includes('pelo menos um Dono'), 'último dono não pode deixar de ser dono')
conf((await ver(esc, 'select * from public.perfis')).length === 1, 'escritório só vê o próprio acesso')
conf((await ver(dono, 'select * from public.perfis')).length === 5, 'dono vê todos os acessos')
conf((await ver(prod, 'select * from public.nomes_usuarios()')).length === 5, 'nomes de quem lança visíveis para todos')
const flag = async (u) => (await q(`select trocar_senha from public.perfis where user_id = $1`, [u]))[0].trocar_senha
conf(await flag(dono) === false, 'senha do primeiro acesso não é provisória')
conf(await flag(prod) === true, 'senha criada pelo Dono é provisória (troca no 1º acesso)')
conf((await erro(prod, 'trocar_senha', esc, 'nova-senha-123'))?.includes('Só o Dono'), 'produção não troca senha dos outros')
conf((await erro(prod, 'trocar_senha', prod, 'nova-senha-123')) === null, 'cada um troca a própria senha')
conf(await flag(prod) === false, 'depois de trocar, deixa de ser provisória')
await rpc(dono, 'trocar_senha', prod2, 'outra-senha-9')
conf(await flag(prod2) === true, 'Dono redefinindo a senha de alguém: vira provisória de novo')
let bloqueou = false
try { await q(`insert into auth.users (id, email) values (gen_random_uuid(), 'invasor@x.com')`) } catch (e) { bloqueou = e.message.includes('Cadastro desativado') }
conf(bloqueou, 'cadastro por fora do sistema bloqueado (gatilho em auth.users)')
conf((await q(`select auth.entrar_teste('beto@jafmetal.local', 'nova-senha-123') is not null as ok`))[0].ok, 'senha nova vale')

// acesso desativado perde tudo
const tmp = await rpc(dono, 'criar_acesso', 'tmp', 'senha-forte-9', 'Temporário', 'almoxarife', null)
await rpc(dono, 'editar_acesso', tmp, 'Temporário', 'almoxarife', false, null)
conf((await ver(tmp, 'select * from public.pecas')).length === 0 && (await erro(tmp, 'salvar_peca', { codigo: 'X', descricao: 'Y' }))?.includes('sessão'), 'acesso desativado não lê nem grava')

// ---------------------------------------------------------------- escrita direta bloqueada
for (const [uid, quem] of [[dono, 'dono'], [prod, 'produção'], ['anon', 'anônimo']]) {
  let bloqueado = 0
  for (const sql of [`insert into public.pecas (codigo, descricao) values ('Z1','z')`, `update public.pecas set est_min = 99`,
                     `delete from public.movimentos`, `insert into public.lancamentos (tipo, descricao, valor, vencimento) values ('pagar','x',1,now())`,
                     `update public.perfis set perfil = 'dono'`, `insert into public.historico (tabela, acao) values ('x','y')`]) {
    try { await ver(uid, sql) } catch (e) { bloqueado++ }
  }
  conf(bloqueado === 6, `escrita direta nas tabelas bloqueada (${quem})`, bloqueado)
}
conf((await ver('anon', 'select * from public.pecas').catch(() => [])).length === 0, 'anônimo não lê peças')

// ---------------------------------------------------------------- cadastros
const fMR = await rpc(alm, 'salvar_fornecedor', { nome: ' Alfa  Tools ', razao: 'Alfatools Ferramentas de Corte', email: 'VENDAS@ALFA.COM', uf: 'sp' })
const fWF = await rpc(esc, 'salvar_fornecedor', { nome: 'Beta Ferramentas' })
conf((await ver(dono, `select nome, email, uf from public.fornecedores where id = $1`, [fMR]))[0].nome === 'Alfa Tools', 'nome limpo (espaços)')
conf((await ver(dono, `select email from public.fornecedores where id = $1`, [fMR]))[0].email === 'vendas@alfa.com', 'e-mail em minúsculas')
conf((await erro(alm, 'salvar_fornecedor', { nome: 'alfa tools' }))?.includes('Já existe'), 'fornecedor repetido recusado')
conf((await erro(prod, 'salvar_fornecedor', { nome: 'Novo' }))?.includes('perfil não pode'), 'produção não cadastra fornecedor')
conf((await ver(prod, 'select * from public.fornecedores')).length === 0, 'produção não vê fornecedores')

const pA = await rpc(alm, 'salvar_peca', { codigo: 'GCMR2002', descricao: 'Inserto para cortar', utilizacao: 'Torno CNC', fornecedor_id: fMR, est_min: 10, est_max: 30 })
const pB = await rpc(alm, 'salvar_peca', { codigo: '6204 ZZ', descricao: 'Rolamento', est_min: 0, est_max: 5 })
conf((await erro(alm, 'salvar_peca', { codigo: 'gcmr2002', descricao: 'dup' }))?.includes('Já existe'), 'código repetido recusado (maiúsc./minúsc.)')
conf((await erro(alm, 'salvar_peca', { codigo: 'X1', descricao: 'x', est_min: 10, est_max: 5 }))?.includes('menor que o mínimo'), 'máximo menor que mínimo recusado')
conf((await erro(alm, 'salvar_peca', { codigo: 'X1', descricao: 'x', est_min: 'abc' }))?.includes('Número inválido'), 'número inválido recusado')
conf((await erro(prod, 'salvar_peca', { codigo: 'X1', descricao: 'x' })) !== null, 'produção não cadastra peça')
conf((await ver(prod, 'select * from public.pecas')).length === 2, 'produção vê as peças')

const maq = await rpc(alm, 'salvar_maquina', { nome: 'Torno CNC 02', preventiva_dias: 90 })
const func = await rpc(esc, 'salvar_funcionario', { nome: 'Beto Silva', funcao: 'Torneiro', admissao: '2020-03-01', privado: { salario: '3500,50', cpf: '123' } })
await rpc(dono, 'editar_acesso', prod, 'Beto Torno', 'producao', true, func)
conf((await ver(alm, 'select * from public.funcionarios_privado')).length === 0, 'almoxarife não vê salário')
conf(Number((await ver(esc, 'select salario from public.funcionarios_privado'))[0].salario) === 3500.5, 'salário com vírgula gravado')
conf((await ver(prod, 'select * from public.funcionarios')).length === 1, 'nomes dos funcionários visíveis')
conf((await erro(alm, 'salvar_funcionario', { nome: 'X' }))?.includes('perfil não pode'), 'almoxarife não cadastra funcionário')

// ---------------------------------------------------------------- estoque / PEPS
const mov = (uid, o) => rpc(uid, 'movimentar', o)
await mov(alm, { tipo: 'entrada', peca_id: pA, qtd: 10, preco_unit: 36, documento: 'NF 1', data: '2026-01-10' })
await mov(alm, { tipo: 'entrada', peca_id: pA, qtd: 20, preco_unit: '39,90', documento: 'NF 2', data: '2026-02-10' })
const est = async (id) => Number((await q(`select estoque from public.pecas where id = $1`, [id]))[0].estoque)
conf(await est(pA) === 30, 'estoque soma entradas', await est(pA))
let lotes = await ver(alm, `select documento, resta::float, preco_unit::float from public.lotes($1)`, [pA])
conf(lotes.length === 2 && lotes[0].documento === 'NF 1' && lotes[0].resta === 10, 'lotes do mais antigo para o mais novo', lotes)
conf((await ver(prod, `select * from public.lotes($1)`, [pA])).length === 0, 'produção não vê preço dos lotes')

const idS = '11111111-1111-1111-1111-111111111111'
const s1 = await mov(prod, { id: idS, tipo: 'saida', peca_id: pA, qtd: 15, funcionario_id: func, maquina_id: maq })
conf(s1.ids.length === 2 && Number(s1.custo) === Math.round((10 * 36 + 5 * 39.9) * 100) / 100, 'saída PEPS divide em dois lotes (10×36 + 5×39,90)', s1)
conf(await est(pA) === 15, 'estoque depois da retirada', await est(pA))
const rep = await mov(prod, { id: idS, tipo: 'saida', peca_id: pA, qtd: 15 })
conf(rep.repetido === true && await est(pA) === 15, 'envio repetido (toque duplo) não tira de novo')
lotes = await ver(alm, `select documento, resta::float from public.lotes($1)`, [pA])
conf(lotes.length === 1 && lotes[0].resta === 15 && lotes[0].documento === 'NF 2', 'sobra só o lote NF 2', lotes)
conf((await erro(prod, 'movimentar', { tipo: 'saida', peca_id: pA, qtd: 16 }))?.includes('Só tem 15'), 'não retira mais do que tem')
conf((await erro(prod, 'movimentar', { tipo: 'saida', peca_id: pA, qtd: 0 }))?.includes('quantidade'), 'quantidade zero recusada')
conf((await erro(prod, 'movimentar', { tipo: 'entrada', peca_id: pA, qtd: 5, preco_unit: 1 }))?.includes('perfil não pode'), 'produção não dá entrada')
conf((await erro(prod, 'movimentar', { tipo: 'saida', motivo: 'ajuste', peca_id: pA, qtd: 1 }))?.includes('perfil não pode'), 'produção não faz ajuste')
conf((await erro(alm, 'movimentar', { tipo: 'saida', peca_id: pA, qtd: 1, data: '2099-01-01' }))?.includes('futuro'), 'data no futuro recusada')
conf((await ver(prod, 'select * from public.movimentos')).length === 2, 'produção vê só as próprias retiradas')
conf((await ver(prod2, 'select * from public.movimentos')).length === 0, 'outro operador não vê as retiradas do colega')

// estorno
conf((await erro(prod2, 'estornar', s1.ids[0], null))?.includes('não pode desfazer'), 'operador não desfaz retirada do colega')
const e1 = await rpc(prod, 'estornar', s1.ids[1], null)
conf(!!e1 && await est(pA) === 20, 'operador desfaz a própria retirada', await est(pA))
conf((await erro(prod, 'estornar', s1.ids[1], null))?.includes('já foi desfeita'), 'não desfaz duas vezes')
conf((await erro(alm, 'estornar', e1, null))?.includes('já é um estorno'), 'não desfaz um estorno')
await mov(alm, { tipo: 'saida', peca_id: pA, qtd: 18 })
const entNF2 = (await q(`select id from public.movimentos where documento = 'NF 2' and tipo = 'entrada'`))[0].id
conf((await erro(alm, 'estornar', entNF2, null))?.includes('só restam 2'), 'não desfaz entrada já consumida')
// imutável mesmo para o dono do banco
let imut = 0
for (const sql of [`update public.movimentos set qtd = 1`, `delete from public.movimentos`]) { try { await q(sql) } catch (e) { if (e.message.includes('não pode ser alterada')) imut++ } }
conf(imut === 2, 'movimentação imutável (gatilho)')
conf(await est(pA) === 2, 'estoque final confere', await est(pA))
conf((await q(`select (select estoque from public.pecas where id = $1) = (select sum(case when tipo='entrada' then qtd else -qtd end) from public.movimentos where peca_id = $1) as ok`, [pA]))[0].ok, 'estoque = soma das movimentações')

// contagem
const c1 = await rpc(alm, 'contar_estoque', pA, 7, null)
conf(Number(c1.diferenca) === 5 && await est(pA) === 7, 'contagem para mais lança ajuste de entrada', c1)
const c2 = await rpc(alm, 'contar_estoque', pA, 0, 'quebrou')
conf(Number(c2.diferenca) === -7 && await est(pA) === 0, 'contagem para menos lança ajuste de saída', c2)
conf((await erro(alm, 'contar_estoque', pA, -1, null)) !== null, 'contagem negativa recusada')

// ---------------------------------------------------------------- pedidos de compra
const it1 = '22222222-2222-2222-2222-222222222222', it2 = '33333333-3333-3333-3333-333333333333'
const ped = await rpc(alm, 'salvar_pedido', { fornecedor_id: fMR, documento: 'Proposta 51850', prazo: '2026-10-25',
  itens: [{ id: it1, peca_id: pA, qtd: 20, valor: 798 }, { id: it2, peca_id: pB, qtd: 4, valor: 100 }] })
conf(ped.numero === 1, 'pedido nº 1', ped)
conf((await erro(prod, 'salvar_pedido', { fornecedor_id: fMR, itens: [{ peca_id: pA, qtd: 1 }] })) !== null, 'produção não faz pedido')
conf((await erro(alm, 'salvar_pedido', { fornecedor_id: fMR, itens: [] }))?.includes('pelo menos uma'), 'pedido vazio recusado')
// edita (troca qtd)
await rpc(alm, 'salvar_pedido', { id: ped.id, fornecedor_id: fMR, documento: 'Proposta 51850', prazo: '2026-10-25',
  itens: [{ id: it1, peca_id: pA, qtd: 20, valor: 798 }, { id: it2, peca_id: pB, qtd: 5, valor: 125 }] })
conf(Number((await q(`select qtd from public.pedido_itens where id = $1`, [it2]))[0].qtd) === 5, 'pedido editado')
const r1 = await rpc(alm, 'receber_pedido', { pedido_id: ped.id, documento: 'NF 900', itens: [{ item_id: it1, qtd: 10 }] })
conf(r1.status === 'aguardando' && r1.entradas === 1 && Number(r1.valor) === 399, 'recebimento parcial', r1)
conf(await est(pA) === 10, 'parcial entrou no estoque')
conf(Number((await q(`select preco_unit from public.movimentos where pedido_item_id = $1`, [it1]))[0].preco_unit) === 39.9, 'preço = valor ÷ quantidade')
conf((await erro(alm, 'salvar_pedido', { id: ped.id, fornecedor_id: fMR, itens: [{ id: it2, peca_id: pB, qtd: 5, valor: 125 }] }))?.includes('já chegou'), 'não tira do pedido peça que já chegou')
conf((await erro(alm, 'receber_pedido', { pedido_id: ped.id, itens: [{ item_id: it1, qtd: 1 }], conta: { valor: 10, vencimento: '2026-11-20' } }))?.includes('Escritório lançam'), 'almoxarife não lança a conta ao receber')
conf(await est(pA) === 10, 'recebimento recusado não mexeu no estoque')
const chave = '44444444-4444-4444-4444-444444444444'
const r2 = await rpc(esc, 'receber_pedido', { pedido_id: ped.id, chave, itens: [{ item_id: it1, qtd: 10 }, { item_id: it2, qtd: 5 }],
  conta: { valor: 923, vencimento: '2026-11-20', parcelas: 3, intervalo: '30' } })
conf(r2.status === 'recebido', 'recebimento completo fecha o pedido', r2)
const r2b = await rpc(esc, 'receber_pedido', { pedido_id: ped.id, chave, itens: [{ item_id: it1, qtd: 10 }, { item_id: it2, qtd: 5 }] })
conf(r2b.repetido === true && await est(pA) === 20, 'recebimento enviado duas vezes não entra em dobro', r2b)
const contas = await ver(esc, `select valor::float, vencimento::text, parcela from public.lancamentos where pedido_id = $1 order by vencimento`, [ped.id])
conf(contas.length === 3 && Math.round(contas.reduce((s, c) => s + c.valor, 0) * 100) === 92300, 'conta a pagar em 3 parcelas soma o total', contas)
conf(contas[1]?.vencimento === '2026-12-20', 'parcela a cada 30 dias', contas)
conf((await erro(alm, 'receber_pedido', { pedido_id: ped.id, itens: [{ item_id: it1, qtd: 1 }] }))?.includes('já está recebido'), 'pedido recebido não recebe de novo')
// desfazer a entrada do pedido reabre
const entPed = (await q(`select id from public.movimentos where pedido_item_id = $1 and tipo = 'entrada' order by seq desc limit 1`, [it2]))[0].id
await rpc(alm, 'estornar', entPed, null)
conf((await q(`select status from public.pedidos_compra where id = $1`, [ped.id]))[0].status === 'aguardando', 'desfazer entrada reabre o pedido')
conf(Number((await q(`select recebido from public.pedido_itens where id = $1`, [it2]))[0].recebido) === 0, 'item volta a pendente')
await rpc(alm, 'cancelar_pedido', ped.id, 'fornecedor sem estoque')
conf((await q(`select status from public.pedidos_compra where id = $1`, [ped.id]))[0].status === 'recebido', 'cancelar com parte recebida encerra')
await rpc(alm, 'reabrir_pedido', ped.id)
conf((await q(`select status from public.pedidos_compra where id = $1`, [ped.id]))[0].status === 'aguardando', 'reabrir pedido')
const ped2 = await rpc(alm, 'salvar_pedido', { fornecedor_id: fWF, itens: [{ peca_id: pB, qtd: 2, valor: 50 }] })
await rpc(alm, 'cancelar_pedido', ped2.id, null)
conf((await q(`select status from public.pedidos_compra where id = $1`, [ped2.id]))[0].status === 'cancelado', 'cancelar pedido sem nada recebido')
conf(ped2.numero === 2, 'numeração seguida')

// ---------------------------------------------------------------- financeiro
const l1 = await rpc(esc, 'salvar_lancamento', { tipo: 'pagar', descricao: 'Energia', valor: '1.234,56', vencimento: '2026-01-31', parcelas: 3, intervalo: 'mensal' })
conf(Number((await q(`select sum(valor) s from public.lancamentos where descricao = 'Energia'`))[0].s) === 1234.56, 'valor "1.234,56" lido certo')
const venc = await ver(esc, `select vencimento::text, valor::float from public.lancamentos where descricao = 'Energia' order by vencimento`)
conf(venc.map(v => v.vencimento).join() === '2026-01-31,2026-02-28,2026-03-31', 'mensal cai no fim do mês certo', venc)
const l2 = await rpc(esc, 'salvar_lancamento', { tipo: 'receber', descricao: 'Upgrade - OP 1', valor: 100, vencimento: '2026-10-10', parcelas: 3 })
const somaL2 = (await ver(esc, `select sum(valor)::float s, count(*)::int n from public.lancamentos where descricao = 'Upgrade - OP 1'`))[0]
conf(somaL2.s === 100 && somaL2.n === 3, '100 em 3 parcelas = 33,33 + 33,33 + 33,34', somaL2)
await rpc(esc, 'baixar_lancamento', l2, '2026-10-10', 30, 'Pix')
conf(Number((await q(`select valor_pago from public.lancamentos where id = $1`, [l2]))[0].valor_pago) === 30, 'baixa com valor diferente')
await rpc(esc, 'baixar_lancamento', l2, null, null, null)
conf((await q(`select pago_em from public.lancamentos where id = $1`, [l2]))[0].pago_em === null, 'desfazer baixa')
conf((await erro(alm, 'salvar_lancamento', { tipo: 'pagar', descricao: 'x', valor: 1, vencimento: '2026-01-01' }))?.includes('perfil não pode'), 'almoxarife não lança financeiro')
conf((await ver(alm, 'select * from public.lancamentos')).length === 0, 'almoxarife não vê financeiro')
conf((await ver(prod, 'select * from public.lancamentos')).length === 0, 'produção não vê financeiro')
const nEx = await rpc(esc, 'excluir_lancamento', l2, true)
conf(nEx === 3, 'excluir parcelas não pagas do grupo', nEx)
conf((await erro(esc, 'salvar_lancamento', { tipo: 'pagar', descricao: 'x', valor: 0, vencimento: '2026-01-01' }))?.includes('valor'), 'valor zero recusado')

// ---------------------------------------------------------------- produção
const cli = await rpc(esc, 'salvar_cliente', { nome: 'Upgrade Barras de Apoio', cnpj: '00.000.000/0001-00' })
const op = await rpc(esc, 'salvar_ordem', { cliente_id: cli, pedido_cliente: 'PC 016/26', produto: 'Barra reta 400 mm', codigo: 'UP 01.0002', qtd: 80, prazo: '2026-10-30', maquina_id: maq })
conf(op.numero === 1, 'ordem nº 1')
conf((await ver(prod, `select cliente_nome from public.ordens`))[0].cliente_nome === 'Upgrade Barras de Apoio', 'produção vê o nome do cliente na ordem')
conf((await ver(prod, 'select * from public.clientes')).length === 0, 'produção não abre o cadastro de clientes')
await rpc(prod, 'ordem_status', { id: op.id, status: 'producao' })
await rpc(prod, 'ordem_status', { id: op.id, produzido: 30 })
let o = (await q(`select status, produzido::float, iniciada_em from public.ordens where id = $1`, [op.id]))[0]
conf(o.status === 'producao' && o.produzido === 30 && o.iniciada_em, 'apontamento de produção', o)
conf((await erro(prod, 'ordem_status', { id: op.id, status: 'entregue' }))?.includes('escritório'), 'produção não marca entregue')
await rpc(prod, 'ordem_status', { id: op.id, status: 'pronta' })
o = (await q(`select status, produzido::float from public.ordens where id = $1`, [op.id]))[0]
conf(o.status === 'pronta' && o.produzido === 80, 'pronta completa a quantidade', o)
await rpc(esc, 'ordem_status', { id: op.id, status: 'entregue' })
conf((await erro(esc, 'salvar_ordem', { id: op.id, produto: 'x', qtd: 1 }))?.includes('não pode ser alterada'), 'ordem entregue não muda')
await rpc(esc, 'salvar_cliente', { id: cli, nome: 'Upgrade' })
conf((await q(`select cliente_nome from public.ordens where id = $1`, [op.id]))[0].cliente_nome === 'Upgrade', 'renomear cliente atualiza as ordens')

// manutenção (produção abre chamado)
const man = await rpc(prod, 'salvar_manutencao', { maquina_id: maq, problema: 'Barulho no cabeçote' })
conf(!!man, 'produção abre chamado de manutenção')
await mov(alm, { tipo: 'entrada', peca_id: pB, qtd: 2, preco_unit: 50 })
await mov(alm, { tipo: 'saida', peca_id: pB, qtd: 1, maquina_id: maq, manutencao_id: man })
conf((await q(`select count(*)::int n from public.movimentos where manutencao_id = $1`, [man]))[0].n === 1, 'peça ligada à manutenção')
await rpc(alm, 'salvar_manutencao', { id: man, maquina_id: maq, problema: 'Barulho no cabeçote', solucao: 'Troca do rolamento', status: 'concluida', custo_servico: 250 })
conf((await q(`select concluida_em is not null as ok from public.manutencoes where id = $1`, [man]))[0].ok, 'concluída com data')

// ---------------------------------------------------------------- histórico
const h = await ver(dono, `select tabela, acao, quem from public.historico where tabela = 'fornecedores' and acao = 'insert' order by id limit 1`)
conf(h[0]?.quem === 'José Almox', 'histórico guarda quem fez', h)
conf((await ver(esc, 'select * from public.historico')).length === 0, 'histórico só para o dono')

// ---------------------------------------------------------------- configuração
await rpc(esc, 'salvar_config', 'empresa', { nome: 'JAF Metal' })
conf((await ver(prod, `select valor->>'nome' n from public.config where chave = 'empresa'`))[0]?.n === 'JAF Metal', 'configuração lida por todos')
conf((await erro(esc, 'salvar_config', 'qualquer', {}))?.includes('desconhecida'), 'chave de configuração desconhecida recusada')

// ---------------------------------------------------------------- importação
const pay = {
  fornecedores: [{ nome: 'Alfa Tools' }, { nome: 'Gama Importados' }],
  pecas: [{ codigo: 'P1', descricao: 'Peça 1', fornecedor: 'Alfa Tools', est_min: 5, est_max: 10 }, { codigo: 'P2', descricao: 'Peça 2', fornecedor: 'Gama Importados' }],
  maquinas: [{ nome: 'TA 25' }],
  movimentos: [{ data: '2022-01-01', codigo: 'P1', tipo: 'entrada', qtd: 10, preco_unit: 2.5, fornecedor: 'Alfa Tools', documento: 'NF 1' },
               { data: '2022-02-01', codigo: 'P1', tipo: 'saida', qtd: 4, preco_unit: 2.5, fornecedor: 'Alfa Tools', documento: 'NF 1' },
               { data: '2022-02-01', codigo: 'NAOEXISTE', tipo: 'saida', qtd: 1 }],
  pedidos: [{ data: '2022-01-01', fornecedor: 'Alfa Tools', documento: 'Prop 1', prazo: '2022-01-05', status: 'recebido', itens: [{ codigo: 'P1', qtd: 10, valor: 25 }] },
            { data: '2026-10-14', fornecedor: 'Fornecedor Novo', documento: 'Prop 2', prazo: '2026-11-02', status: 'aguardando', itens: [{ codigo: 'SO-NO-PEDIDO', descricao: 'Inserto', qtd: 10, valor: 378.31 }] }]
}
conf((await erro(esc, 'importar_planilha', pay, true))?.includes('perfil não pode'), 'só o dono importa')
conf((await erro(dono, 'importar_planilha', pay, false))?.includes('substituir'), 'importar sem substituir com dados recusado')
const imp1 = await rpc(dono, 'importar_planilha', pay, true)
conf(imp1.movimentos === 2 && imp1.sem_peca.length === 1 && imp1.pedidos === 2, 'importação', imp1)
conf(Number((await q(`select estoque from public.pecas where codigo = 'P1'`))[0].estoque) === 6, 'estoque importado = entradas − saídas')
conf((await q(`select ativo from public.pecas where codigo = 'SO-NO-PEDIDO'`))[0]?.ativo === false, 'código só do pedido vira peça desativada')
conf((await q(`select count(*)::int n from public.pecas`))[0].n === 3, 'substituir apagou as peças antigas')
conf((await q(`select status from public.pedidos_compra where documento = 'Prop 2'`))[0].status === 'aguardando', 'pedido aguardando importado')
const novoPed = await rpc(alm, 'salvar_pedido', { fornecedor_id: (await q(`select id from public.fornecedores where nome = 'Alfa Tools'`))[0].id, itens: [{ peca_id: (await q(`select id from public.pecas where codigo='P1'`))[0].id, qtd: 1 }] })
conf(novoPed.numero === 3, 'numeração continua depois da importação', novoPed)
conf((await q(`select count(*)::int n from public.lancamentos where pedido_id is not null`))[0].n === 0, 'contas do pedido apagado perdem só o vínculo')
conf((await q(`select count(*)::int n from public.lancamentos`))[0].n >= 6, 'financeiro preservado na importação')
conf((await q(`select count(*)::int n from public.historico where tabela = 'importacao'`))[0].n === 1, 'importação registrada no histórico')
conf((await q(`select count(*)::int n from public.historico where tabela = 'movimentos' and depois->>'motivo' = 'importado'`))[0].n === 0, 'importação não enche o histórico')
// lote com preço importado
const p1 = (await q(`select id from public.pecas where codigo='P1'`))[0].id
const s2 = await mov(alm, { tipo: 'saida', peca_id: p1, qtd: 1 })
conf(Number(s2.custo) === 2.5 && s2.partes[0].documento === 'NF 1', 'saída depois da importação usa o lote importado', s2)

// ---------------------------------------------------------------- funções liberadas
const livres = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`)
conf(livres.map(r => r.proname).join() === 'ha_dono,primeiro_dono', 'anônimo só chama ha_dono e primeiro_dono', livres.map(r => r.proname))
const definer = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')`)
conf(definer.length === 0, 'toda função "security definer" fixa o search_path', definer)
// rodar o schema de novo com Dono existente fecha o primeiro acesso
await db.exec(sqlSchema)
const livres2 = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`)
conf(livres2.length === 0, 'com Dono criado, quem não entrou não chama nenhuma função', livres2.map(r => r.proname))
conf(/permission denied/i.test(await erro(dono, 'primeiro_dono', 'x2', 'senha-forte-1', 'Outro') || ''), 'primeiro acesso fechado também para quem está logado')
conf((await q(`select count(*)::int n from public.perfis`))[0].n >= 5, 'rodar o schema de novo não apaga acessos')

console.log(`\n${ok} conferências OK, ${falhas.length} falha(s)`)
for (const f of falhas) console.log('  ✗ ' + f)
process.exit(falhas.length ? 1 : 0)
