// Testes do banco (schema.sql) com Postgres de verdade rodando local (PGlite).
// Rodar (depois do npm install):  node testes/banco.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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
// CPF inventado, mas com os dígitos verificadores certos (nunca usar CPF de gente de verdade aqui: o repositório é público)
function cpfTeste(base) {
  const d = String(base).padStart(9, '0').slice(0, 9).split('').map(Number)
  for (const n of [10, 11]) { const s = d.reduce((a, x, i) => a + x * (n - i), 0); const r = (s * 10) % 11; d.push(r === 10 ? 0 : r) }
  return d.join('').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
}

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
const func = await rpc(esc, 'salvar_funcionario', { nome: 'Beto Silva', funcao: 'Torneiro', admissao: '2020-03-01', privado: { salario: '3500,50', cpf: cpfTeste(111222333) } })
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
conf((await erro(prod, 'ordem_status', { id: op.id, status: 'entregue' }))?.includes('PCP ou pelo escritório'), 'produção não marca entregue')
await rpc(prod, 'ordem_status', { id: op.id, status: 'pronta' })
o = (await q(`select status, produzido::float from public.ordens where id = $1`, [op.id]))[0]
conf(o.status === 'pronta' && o.produzido === 80, 'pronta completa a quantidade', o)
await rpc(esc, 'ordem_status', { id: op.id, status: 'entregue' })
conf((await erro(esc, 'salvar_ordem', { id: op.id, produto: 'x', qtd: 1 }))?.includes('não pode ser alterada'), 'ordem entregue não muda')
await rpc(esc, 'salvar_cliente', { id: cli, nome: 'Upgrade' })
conf((await q(`select cliente_nome from public.ordens where id = $1`, [op.id]))[0].cliente_nome === 'Upgrade', 'renomear cliente atualiza as ordens')
// PCP: cria e encerra ordens; consulta estoque e clientes; não mexe no almoxarifado, compras, financeiro nem RH
{
  const pcp = await rpc(dono, 'criar_acesso', 'paula.pcp', 'senha-forte-6', 'Paula PCP', 'pcp', null)
  conf(!!pcp, 'acesso do PCP criado')
  const op2 = await rpc(pcp, 'salvar_ordem', { cliente_id: cli, produto: 'Barra curva', qtd: 10, prazo: '2026-11-10', maquina_id: maq })
  conf(op2.numero === 2, 'PCP cria ordem', op2)
  await rpc(pcp, 'ordem_status', { id: op2.id, status: 'producao' })
  await rpc(pcp, 'ordem_status', { id: op2.id, status: 'cancelada' })
  conf((await q(`select status from public.ordens where id = $1`, [op2.id]))[0].status === 'cancelada', 'PCP cancela ordem')
  await rpc(pcp, 'ordem_status', { id: op2.id, status: 'pronta' })
  conf((await q(`select status from public.ordens where id = $1`, [op2.id]))[0].status === 'pronta', 'PCP reabre ordem')
  conf((await ver(pcp, 'select * from public.pecas')).length > 0 && (await ver(pcp, 'select * from public.clientes')).length > 0, 'PCP consulta estoque e clientes')
  conf((await ver(pcp, 'select * from public.movimentos')).length === 0 && (await ver(pcp, 'select * from public.pedidos_compra')).length === 0
    && (await ver(pcp, 'select * from public.lancamentos')).length === 0 && (await ver(pcp, 'select * from public.funcionarios_privado')).length === 0, 'PCP não vê movimentações, compras, financeiro nem dados pessoais')
  conf((await erro(pcp, 'salvar_cliente', { nome: 'X' }))?.includes('perfil não pode'), 'PCP não cadastra cliente')
  conf((await erro(pcp, 'salvar_maquina', { nome: 'X' }))?.includes('perfil não pode'), 'PCP não cadastra máquina')
  conf((await erro(alm, 'salvar_ordem', { produto: 'x', qtd: 1 }))?.includes('perfil não pode'), 'almoxarifado não cria ordem (é do PCP)')
}

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
conf((await ver(esc, "select * from public.historico where tabela not like 'rh\_%' and tabela not in ('funcionarios','funcionarios_privado')")).length === 0, 'histórico do almoxarifado e do financeiro só para o dono')
conf((await ver(alm, 'select * from public.historico')).length === 0, 'almoxarife não vê histórico')

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

// ---------------------------------------------------------------- RH
{
  const rh = await rpc(dono, 'criar_acesso', 'rita.rh', 'senha-forte-7', 'Rita RH', 'rh', null)
  const ger = await rpc(dono, 'criar_acesso', 'gil.ger', 'senha-forte-8', 'Gil Gerente', 'gerente', null)
  conf(!!rh && !!ger, 'acessos de RH e de gerente criados')
  conf((await erro(dono, 'criar_acesso', 'xx.yy', 'senha-forte-9', 'Xis', 'chefe', null))?.includes('Perfil inválido'), 'perfil desconhecido recusado')
  // quem vê o quê
  conf((await ver(rh, 'select * from public.pecas')).length === 0, 'RH não vê o estoque')
  conf((await ver(rh, 'select * from public.lancamentos')).length === 0, 'RH não vê o financeiro')
  conf((await ver(ger, 'select * from public.pecas')).length > 0, 'gerente vê o estoque')
  conf((await ver(ger, 'select * from public.funcionarios_privado')).length === 0, 'gerente não vê dados pessoais nem salário')
  conf((await ver(rh, 'select * from public.funcionarios_privado')).length === 1, 'RH vê os dados pessoais')
  // cargos e organograma
  const cGer = await rpc(rh, 'rh_salvar_cargo', { nome: 'Gerente de Produção', cbo: '141205' })
  const cLid = await rpc(rh, 'rh_salvar_cargo', { nome: 'Líder de Produção', superior_id: cGer })
  const cOp = await rpc(rh, 'rh_salvar_cargo', { nome: 'Operador de Máquina A', cbo: '721420', superior_id: cLid, setor: 'Produção' })
  conf((await erro(rh, 'rh_salvar_cargo', { id: cGer, nome: 'Gerente de Produção', superior_id: cOp }))?.includes('círculo'), 'organograma não aceita círculo')
  conf((await erro(rh, 'rh_salvar_cargo', { nome: 'operador de máquina a' }))?.includes('Já existe'), 'cargo repetido recusado')
  conf((await erro(ger, 'rh_salvar_cargo', { nome: 'Novo' }))?.includes('perfil não pode'), 'gerente não altera nada')
  await rpc(rh, 'rh_salvar_setor', { nome: 'Produção' })
  // cadastro: CPF validado e sem repetir
  conf((await erro(rh, 'salvar_funcionario', { nome: 'Teste', privado: { cpf: '111.111.111-11' } }))?.includes('CPF inválido'), 'CPF inválido recusado')
  conf((await erro(rh, 'salvar_funcionario', { nome: 'Teste', privado: { cpf: cpfTeste(111222333) } }))?.includes('Já existe um funcionário com o CPF'), 'CPF repetido recusado')
  conf((await erro(rh, 'salvar_funcionario', { nome: 'Teste', registro: 'Outra' }))?.includes('Registro inválido'), 'registro (Matriz/Filial/Upgrade) conferido')
  const ana = await rpc(rh, 'salvar_funcionario', { nome: 'Ana Operadora', cargo_id: cOp, setor: 'Produção', admissao: '2024-02-05', registro: 'Filial', matricula: 'T-01',
    privado: { salario: '2.932,03', cpf: cpfTeste(222333444), banco: 'Banco 0001/12345-6', calcado: '38', uniforme: 'm' } })
  const fa = (await ver(rh, 'select f.funcao, f.situacao, p.salario::float s, p.uniforme from public.funcionarios f join public.funcionarios_privado p on p.funcionario_id = f.id where f.id = $1', [ana]))[0]
  conf(fa.funcao === 'Operador de Máquina A' && fa.situacao === 'ativo' && fa.s === 2932.03 && fa.uniforme === 'M', 'funcionário com cargo, salário e uniforme', fa)
  const h0 = await ver(rh, 'select motivo, salario::float s, cargo from public.rh_historico where funcionario_id = $1', [ana])
  conf(h0.length === 1 && h0[0].motivo === 'Admissão' && h0[0].s === 2932.03, 'admissão abre a linha do tempo', h0)
  conf((await ver(ger, 'select * from public.rh_historico')).length === 0, 'gerente não vê a linha do tempo de salário')
  // editar o cadastro não muda o salário (só pela alteração de cargo/salário)
  await rpc(rh, 'salvar_funcionario', { id: ana, nome: 'Ana Operadora', cargo_id: cOp, setor: 'Produção', admissao: '2024-02-05', registro: 'Filial', privado: { salario: '9999', cpf: cpfTeste(222333444) } })
  conf(Number((await ver(rh, 'select salario from public.funcionarios_privado where funcionario_id = $1', [ana]))[0].salario) === 2932.03, 'editar cadastro não muda o salário escondido')
  await rpc(rh, 'rh_alterar_cargo_salario', { funcionario_id: ana, vigencia: '2025-03-01', salario: 3200, motivo: 'Dissídio' })
  await rpc(rh, 'rh_alterar_cargo_salario', { funcionario_id: ana, vigencia: '2099-01-01', salario: '5000', cargo_id: cLid, motivo: 'Promoção' })
  const fa2 = (await ver(rh, 'select f.funcao, p.salario::float s from public.funcionarios f join public.funcionarios_privado p on p.funcionario_id = f.id where f.id = $1', [ana]))[0]
  conf(fa2.s === 3200 && fa2.funcao === 'Operador de Máquina A', 'aumento vale na vigência; o do futuro ainda não', fa2)
  conf((await ver(rh, 'select * from public.rh_historico where funcionario_id = $1', [ana])).length === 3, 'linha do tempo com 3 marcos')
  conf((await erro(rh, 'rh_alterar_cargo_salario', { funcionario_id: ana, vigencia: '2025-01-01', motivo: 'Mérito' }))?.includes('Informe'), 'alteração vazia recusada')
  // férias (CLT): mínimo 5 dias, até 3 partes, uma com 14+
  const ferias = (ini, fim, aq = '2024-02-05') => rpc(rh, 'rh_salvar_ausencia', { funcionario_id: ana, tipo: 'ferias', inicio: ini, fim, aquisitivo_inicio: aq })
  conf((await erro(rh, 'rh_salvar_ausencia', { funcionario_id: ana, tipo: 'ferias', inicio: '2025-06-01', fim: '2025-06-03', aquisitivo_inicio: '2024-02-05' }))?.includes('menos de 5'), 'férias de menos de 5 dias recusadas')
  await ferias('2025-06-02', '2025-06-11')   // 10
  await ferias('2025-07-01', '2025-07-10')   // 10
  conf((await erro(rh, 'rh_salvar_ausencia', { funcionario_id: ana, tipo: 'ferias', inicio: '2025-08-01', fim: '2025-08-10', aquisitivo_inicio: '2024-02-05' }))?.includes('14 dias'), 'sem uma parte de 14 dias recusado')
  conf((await erro(rh, 'rh_salvar_ausencia', { funcionario_id: ana, tipo: 'ferias', inicio: '2025-06-05', fim: '2025-06-20', aquisitivo_inicio: '2025-02-05' }))?.includes('Já existe'), 'férias em cima de outra recusadas')
  conf((await erro(rh, 'rh_salvar_ausencia', { funcionario_id: ana, tipo: 'ferias', inicio: '2025-08-01', fim: '2025-08-12', aquisitivo_inicio: '2024-02-05' }))?.includes('30 dias'), 'mais de 30 dias no período recusado')
  // ponto
  const ponto = (dias) => rpc(rh, 'rh_salvar_ponto', { funcionario_id: ana, dias })
  conf(await ponto([{ data: '2025-09-01', e1: '07:00', s1: '12:00', e2: '13:00', s2: '19:00' }, { data: '2025-09-02', justificativa: 'atestado' }]) === 2, 'ponto gravado')
  conf((await erro(rh, 'rh_salvar_ponto', { funcionario_id: ana, dias: [{ data: '2025-09-03', e1: '12:00', s1: '07:00' }] }))?.includes('fora de ordem'), 'horário fora de ordem recusado')
  conf((await erro(rh, 'rh_salvar_ponto', { funcionario_id: ana, dias: [{ data: '2025-09-03', e1: '07:00' }] }))?.includes('saída'), 'entrada sem saída recusada')
  conf((await erro(rh, 'rh_salvar_ponto', { funcionario_id: ana, dias: [{ data: '2025-06-05', e1: '07:00', s1: '12:00' }] }))?.includes('travado'), 'dia de férias travado no ponto')
  conf((await erro(rh, 'rh_salvar_ponto', { funcionario_id: ana, dias: [{ data: '2025-09-04', e1: '7h', s1: '12:00' }] }))?.includes('Horário inválido'), 'horário inválido recusado')
  await rpc(rh, 'rh_fechar_mes', ana, '2025-09-15', true)
  conf((await erro(rh, 'rh_salvar_ponto', { funcionario_id: ana, dias: [{ data: '2025-09-05', e1: '07:00', s1: '12:00' }] }))?.includes('fechado'), 'mês fechado não aceita mudança')
  await rpc(rh, 'rh_fechar_mes', ana, '2025-09-01', false)
  conf(await ponto([{ data: '2025-09-01' }]) === 1 && (await ver(rh, 'select * from public.rh_ponto where funcionario_id = $1', [ana])).length === 1, 'dia apagado quando fica vazio; mês reaberto aceita')
  conf((await ver(ger, 'select * from public.rh_ponto')).length === 1 && (await erro(ger, 'rh_salvar_ponto', { funcionario_id: ana, dias: [] }))?.includes('perfil não pode'), 'gerente vê o ponto e não altera')
  conf((await ver(prod, 'select * from public.rh_ponto')).length === 0 && (await ver(alm, 'select * from public.rh_ponto')).length === 0, 'produção e almoxarifado não veem o ponto')
  // afastamento: situação e CID protegido
  await rpc(rh, 'rh_salvar_ausencia', { funcionario_id: ana, tipo: 'afastamento', inicio: '2025-12-01', motivo: 'Doença', cid: 'm54.5' })
  conf((await ver(rh, "select cid from public.rh_ausencias where tipo = 'afastamento'"))[0].cid === 'M54.5', 'afastamento com CID')
  conf((await ver(ger, 'select * from public.rh_ausencias')).length === 0, 'gerente não lê o CID')
  conf((await ver(ger, 'select * from public.rh_ausencias_resumo()')).length === 3, 'gerente sabe quem está fora (sem CID)')
  conf((await ver(rh, 'select situacao from public.funcionarios where id = $1', [ana]))[0].situacao === 'afastado', 'afastado hoje fica "afastado"')
  // medidas disciplinares
  conf((await erro(rh, 'rh_salvar_ocorrencia', { funcionario_id: ana, tipo: 'suspensao', data_ocorrencia: '2025-10-01', descricao: 'x', dias: 31, inicio: '2025-10-02' }))?.includes('30 dias'), 'suspensão acima de 30 dias recusada')
  conf((await erro(rh, 'rh_salvar_ocorrencia', { funcionario_id: ana, tipo: 'escrita', data_ocorrencia: '2025-10-01', descricao: 'x', recusou: true, testemunha1: 'A' }))?.includes('2 testemunhas'), 'recusa de assinatura exige 2 testemunhas')
  const oc = await rpc(rh, 'rh_salvar_ocorrencia', { funcionario_id: ana, tipo: 'suspensao', data_ocorrencia: '2025-10-01', descricao: 'Briga', categoria: 'j', dias: 3, inicio: '2025-10-02' })
  const sus = await ver(rh, "select inicio::text, fim::text, abona from public.rh_ausencias where tipo = 'suspensao'")
  conf(oc.numero >= 1 && sus.length === 1 && sus[0].fim === '2025-10-04' && sus[0].abona === false, 'suspensão trava 3 dias no ponto, sem pagamento', sus)
  await rpc(rh, 'rh_salvar_ocorrencia', { id: oc.id, funcionario_id: ana, tipo: 'suspensao', data_ocorrencia: '2025-10-01', descricao: 'Briga', dias: 3, inicio: '2025-10-02', status: 'cancelado' })
  conf((await ver(rh, "select * from public.rh_ausencias where tipo = 'suspensao'")).length === 0, 'suspensão cancelada libera os dias')
  // treinamentos e matrizes
  const mz = await rpc(rh, 'rh_salvar_matriz', { nome: 'Treinamentos Produção', tipo: 'treinamento', legenda: [{ nivel: 1, txt: 'Planejado' }],
    itens: [{ nome: 'Paquímetro', validade_meses: 24, obrigatorio: false }, { nome: 'NR-12', validade_meses: 12, obrigatorio: true }] })
  const itens = await ver(rh, 'select id, nome from public.rh_matriz_itens where matriz_id = $1 order by ordem', [mz])
  await rpc(rh, 'rh_definir_nivel', { item_id: itens[1].id, funcionario_id: ana, nivel: 2, data: '2025-01-10' })
  await rpc(rh, 'rh_definir_nivel', { item_id: itens[1].id, funcionario_id: ana, nivel: 4 })
  const nv = (await ver(ger, 'select nivel, data::text from public.rh_matriz_niveis'))[0]
  conf(nv.nivel === 4 && nv.data === '2025-01-10', 'nível muda e a data de realização fica', nv)
  await rpc(rh, 'rh_salvar_matriz', { id: mz, nome: 'Treinamentos Produção', tipo: 'treinamento', itens: [{ id: itens[1].id, nome: 'NR-12' }] })
  conf((await ver(rh, 'select ativo from public.rh_matriz_itens where id = $1', [itens[0].id]))[0].ativo === false, 'coluna tirada some, mas fica guardada')
  // anexos
  conf((await erro(rh, 'rh_anexar', { tabela: 'rh_asos', registro_id: ana, nome: 'x.exe', tipo: 'application/x-msdownload', conteudo: 'AAAAAAAAAAAA' }))?.includes('PDF'), 'anexo só PDF/JPG/PNG')
  const ax = await rpc(rh, 'rh_anexar', { tabela: 'funcionarios', registro_id: ana, nome: 'rg.pdf', tipo: 'application/pdf', conteudo: 'JVBERi0xLjQKJcfsj6IKJSVFT0YK' })
  conf((await rpc(rh, 'rh_baixar_anexo', ax)).conteudo.startsWith('JVBER'), 'anexo guardado e baixado')
  conf((await erro(ger, 'rh_baixar_anexo', ax))?.includes('perfil não pode') && (await ver(ger, 'select * from public.rh_anexos')).length === 0, 'gerente não abre documentos')
  conf(/permission denied/i.test((await como(rh, async () => { try { await q('select * from public.rh_anexos_conteudo'); return '' } catch (e) { return e.message } })) || ''), 'conteúdo dos anexos só pela função')
  // EPI e ASO
  await rpc(rh, 'rh_salvar_epi', { funcionario_id: ana, epi: 'Botina com biqueira', ca: '12345', entrega: '2025-01-05', vida_util_meses: 6, motivo: 'Admissional' })
  await rpc(rh, 'rh_salvar_aso', { funcionario_id: ana, tipo: 'Periódico', data_exame: '2025-01-05', periodicidade_meses: 12, resultado: 'Apto' })
  conf((await ver(ger, 'select * from public.rh_epis')).length === 1 && (await ver(ger, 'select * from public.rh_asos')).length === 1, 'EPI e ASO gravados (gerente consulta)')
  conf((await erro(rh, 'rh_salvar_epi', { funcionario_id: ana, epi: 'Luva', entrega: '2025-01-05', motivo: 'Outro' })) !== null, 'motivo de entrega de EPI conferido')
  // histórico (auditoria) com quem fez
  const hist = await ver(rh, "select quem from public.historico where tabela = 'rh_ponto'")
  conf(hist.length > 0 && hist.every(h => h.quem === 'Rita RH'), 'auditoria do ponto mostra quem mudou')
  conf((await ver(rh, "select * from public.historico where tabela = 'pecas'")).length === 0, 'RH não vê o histórico do estoque')
  // preferências da própria pessoa
  await rpc(ger, 'salvar_preferencias', { inicio: { atalhos: ['retirar'] } })
  conf((await ver(ger, 'select preferencias from public.perfis where user_id = auth.uid()'))[0].preferencias.inicio.atalhos[0] === 'retirar', 'cada pessoa guarda o próprio Início')
  // feriados e regras do RH
  await rpc(rh, 'rh_salvar_feriado', '2025-12-25', 'Natal', false)
  conf((await ver(prod, 'select * from public.rh_feriados')).length === 1, 'feriados gravados')
  await rpc(rh, 'salvar_config', 'rh', { jornada: { divisor: 220 } })
  conf((await erro(rh, 'salvar_config', 'empresa', { nome: 'X' }))?.includes('perfil não pode'), 'RH só mexe na configuração do RH')
  // processos trabalhistas: só RH, Escritório e Dono
  await rpc(rh, 'rh_salvar_processo', { autor: 'Fulano Exemplo', numero: '0000000-00.2024.5.02.0000', data_autuacao: '2024-05-02' })
  conf((await ver(rh, 'select * from public.rh_processos')).length === 1, 'RH registra processo trabalhista')
  conf((await ver(ger, 'select * from public.rh_processos')).length === 0, 'gerente não vê processos trabalhistas')
  conf((await erro(ger, 'rh_salvar_processo', { autor: 'X' }))?.includes('perfil não pode'), 'gerente não registra processo')
  // importação das planilhas do RH: só o Dono, e não por cima do que já existe
  conf((await erro(rh, 'importar_rh', { pessoas: [] }, false))?.includes('perfil não pode'), 'só o Dono importa as planilhas do RH')
  conf((await erro(dono, 'importar_rh', { pessoas: [] }, false))?.includes('Já existem funcionários'), 'importação do RH não passa por cima sem "substituir"')
  conf((await erro(dono, 'importar_rh', { pessoas: [] }, true))?.includes('ligados a retiradas'), 'não substitui quem já está ligado a retiradas e acessos')
}

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
