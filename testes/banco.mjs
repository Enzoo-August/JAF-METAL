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
conf((await erro(dono, 'editar_acesso', dono, 'Fulano', 'escritorio', true, null))?.includes('pelo menos um Dono'), 'último dono não pode deixar de ser dono')
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
// v2.4: motivo de demissão é dado sensível; senha fácil é recusada
const fDesl = await rpc(esc, 'salvar_funcionario', { nome: 'Desligado Teste', situacao: 'desligado', demissao: '2026-01-10', privado: { motivo_demissao: 'Pedido de demissão' } })
conf((await ver(esc, `select motivo_demissao from public.funcionarios_privado where funcionario_id = '${fDesl}'`))[0]?.motivo_demissao === 'Pedido de demissão', 'motivo do desligamento gravado na parte privada')
conf(!('motivo_demissao' in (await ver(prod, 'select * from public.funcionarios'))[0]), 'produção não recebe o motivo do desligamento')
conf((await ver(prod, `select * from public.funcionarios_privado where funcionario_id = '${fDesl}'`)).length === 0, 'produção não lê a parte privada de quem saiu')
for (const fraca of ['12345678', 'jafmetal', 'aaaaaaaa', 'beto']) conf((await erro(prod, 'trocar_senha', prod, fraca)) !== null, 'senha fácil recusada: ' + fraca)
conf((await erro(prod, 'conferir_senha', 'beto', 'senha-forte-9')) !== null, 'ninguém chama a conferência de senha direto')

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
  conf(!!(await rpc(pcp, 'salvar_cliente', { nome: 'Cliente do PCP' })), 'PCP cadastra cliente (recebe os pedidos)')
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
  conf((await ver(rh, 'select * from public.funcionarios_privado')).length === 2, 'RH vê os dados pessoais')
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

  // ---------------- v2.2: salário do cargo, banco de horas, EPI com CA e termo assinado, indicadores
  const cSol = await rpc(rh, 'rh_salvar_cargo', { nome: 'Soldador A', tipo: 'Solda', setor: 'Produção' })
  conf((await ver(rh, 'select tipo from public.rh_cargos where id = $1', [cSol]))[0].tipo === 'Solda', 'cargo guarda o tipo')
  conf(await rpc(rh, 'rh_salario_cargo', { cargo_id: cSol, salario: 4800.5 }) === 0, 'salário do cargo sem aplicar não mexe em ninguém')
  const bia = await rpc(rh, 'salvar_funcionario', { nome: 'Bia Soldadora', cargo_id: cSol, setor: 'Produção', admissao: '2025-01-06', registro: 'Matriz', privado: { salario: '4800' } })
  const caio = await rpc(rh, 'salvar_funcionario', { nome: 'Caio Soldador', cargo_id: cSol, setor: 'Produção', admissao: '2025-03-03', registro: 'Matriz', privado: { salario: '4800,5' } })
  conf((await erro(ger, 'rh_salario_cargo', { cargo_id: cSol, salario: 1 }))?.includes('perfil não pode'), 'gerente não muda salário de cargo')
  conf((await erro(rh, 'rh_salario_cargo', { cargo_id: cSol, salario: -5 }))?.includes('inválido'), 'salário negativo recusado')
  const nAplic = await rpc(rh, 'rh_salario_cargo', { cargo_id: cSol, salario: 5300, aplicar: true, vigencia: '2026-01-01' })
  const sal = async (id) => Number((await ver(rh, 'select salario from public.funcionarios_privado where funcionario_id = $1', [id]))[0].salario)
  conf(nAplic === 2 && await sal(bia) === 5300 && await sal(caio) === 5300, 'atualizar o cargo muda o salário de todos do cargo', nAplic)
  const hb = await ver(rh, `select motivo, salario::float s from public.rh_historico where funcionario_id = $1 order by vigencia desc, criado_em desc limit 1`, [bia])
  conf(hb[0].motivo === 'Reajuste do cargo' && hb[0].s === 5300, 'reajuste do cargo entra na linha do tempo', hb)
  conf(await rpc(rh, 'rh_salario_cargo', { cargo_id: cSol, salario: 5300, aplicar: true }) === 0, 'aplicar de novo não duplica (ninguém muda)')
  conf((await ver(ger, 'select * from public.rh_cargos_salarios')).length === 0 && (await ver(rh, 'select * from public.rh_cargos_salarios')).length === 1, 'salário do cargo só para RH, Escritório e Dono')
  // banco de horas no ponto
  await rpc(rh, 'rh_salvar_ponto', { funcionario_id: bia, dias: [{ data: '2026-02-02', e1: '07:00', s1: '12:00', e2: '13:00', s2: '19:00', justificativa: 'bh_pos' }, { data: '2026-02-03', justificativa: 'bh_neg' }] })
  conf((await ver(rh, `select string_agg(justificativa, ',' order by data) j from public.rh_ponto where funcionario_id = $1`, [bia]))[0].j === 'bh_pos,bh_neg', 'ponto aceita BH+ e BH−')
  conf((await erro(rh, 'rh_salvar_ponto', { funcionario_id: bia, dias: [{ data: '2026-02-04', justificativa: 'bh_x' }] }))?.includes('Justificativa inválida'), 'ocorrência desconhecida recusada')
  // EPI: cadastro com CA, entrega pelo cadastro, termo assinado
  const cat = await rpc(rh, 'rh_salvar_epi_catalogo', { descricao: 'Luva de vaqueta', ca: ' 12 345 ', validade_ca: '2029-02-08', fabricante: 'Fabricante Teste', tamanhos: 'P, M, G', onde_utiliza: 'Solda MIG e TIG', vida_util_meses: 3 })
  conf((await ver(rh, 'select ca from public.rh_epi_catalogo where id = $1', [cat]))[0].ca === '12345', 'CA guardado só com números')
  conf((await erro(rh, 'rh_salvar_epi_catalogo', { ca: '1' }))?.includes('descrição'), 'EPI sem descrição recusado')
  conf((await erro(ger, 'rh_salvar_epi_catalogo', { descricao: 'X' }))?.includes('perfil não pode') && (await ver(ger, 'select * from public.rh_epi_catalogo')).length === 1, 'gerente consulta o cadastro de EPI e não altera')
  const ent = await rpc(rh, 'rh_salvar_epi', { funcionario_id: bia, catalogo_id: cat, entrega: '2026-10-15', tamanho: 'M' })
  const en = (await ver(rh, 'select epi, ca, fabricante, tamanho, validade_ca::text v, vida_util_meses from public.rh_epis where id = $1', [ent]))[0]
  conf(en.epi === 'Luva de vaqueta' && en.ca === '12345' && en.fabricante === 'Fabricante Teste' && en.tamanho === 'M' && en.v === '2029-02-08' && en.vida_util_meses === 3, 'entrega pelo cadastro traz CA, validade e fabricante', en)
  conf((await erro(rh, 'rh_assinar_epis', { ids: [ent], modo: 'facial' }))?.includes('Falta a foto'), 'assinatura facial sem foto recusada')
  conf(await rpc(rh, 'rh_assinar_epis', { ids: [ent], modo: 'facial', conteudo: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', tipo: 'image/jpeg' }) === 1, 'termo assinado por foto')
  const as = (await ver(rh, `select e.assinatura, (select count(*)::int from public.rh_anexos a where a.registro_id = e.id) n from public.rh_epis e where e.id = $1`, [ent]))[0]
  conf(as.assinatura === 'facial' && as.n === 1, 'a foto fica guardada na entrega', as)
  conf(await rpc(rh, 'rh_assinar_epis', { ids: [ent], modo: 'papel' }) === 1, 'termo para assinar no papel')
  await rpc(rh, 'rh_anexar', { tabela: 'rh_epi_catalogo', registro_id: cat, nome: 'CA 12345.pdf', tipo: 'application/pdf', conteudo: 'JVBERi0xLjQKJcfsj6IKMSAwIG9iago=' })
  conf((await ver(rh, `select count(*)::int n from public.rh_anexos where tabela = 'rh_epi_catalogo'`))[0].n === 1, 'PDF do CA anexado ao cadastro do EPI')
  // indicadores (receita e custos lançados à mão)
  await rpc(rh, 'rh_salvar_indicadores', { ano: 2026, meses: [{ mes: 1, receita: 123456.78, beneficios: 1000 }, { mes: 2, receita: 100000.5 }] })
  conf((await ver(rh, 'select count(*)::int n, sum(receita)::float r from public.rh_indicadores'))[0].r === 223457.28, 'receita do mês gravada')
  await rpc(rh, 'rh_salvar_indicadores', { ano: 2026, meses: [{ mes: 2 }] })
  conf((await ver(rh, 'select count(*)::int n from public.rh_indicadores'))[0].n === 1, 'mês vazio apaga o lançamento')
  conf((await erro(rh, 'rh_salvar_indicadores', { ano: 2026, meses: [{ mes: 3, receita: -1 }] }))?.includes('negativo'), 'valor negativo recusado')
  conf((await erro(ger, 'rh_salvar_indicadores', { ano: 2026, meses: [] }))?.includes('perfil não pode') && (await ver(ger, 'select * from public.rh_indicadores')).length === 0, 'indicadores (receita) só para RH, Escritório e Dono')
}

// ---------------------------------------------------------------- v2.5: fábrica (PCP, pedidos de clientes, técnico, manutenção) — dados inventados
{
  const pcp = (await q(`select user_id from public.perfis where login = 'paula.pcp'`))[0].user_id
  const rh = (await q(`select user_id from public.perfis where login = 'rita.rh'`))[0].user_id
  const ger = (await q(`select user_id from public.perfis where login = 'gil.ger'`))[0].user_id
  const tec = await rpc(dono, 'criar_acesso', 'tiago.tec', 'senha-forte-10', 'Tiago Técnico', 'tecnico', null)
  const man = await rpc(dono, 'criar_acesso', 'marcio.man', 'senha-forte-11', 'Márcio Manutenção', 'manutencao', null)
  conf(!!tec && !!man, 'perfis novos: técnico e manutenção')
  conf((await erro(dono, 'criar_acesso', 'x.y', 'senha-forte-12', 'X', 'qualquer', null))?.length > 0, 'perfil inventado recusado')

  // importação das planilhas (pedaços, como o botão faz)
  const imp = (parte, p, sub = false) => rpc(dono, 'importar_fabrica', parte, p, sub)
  conf((await erro(esc, 'importar_fabrica', 'inicio', {}, false))?.includes('perfil não pode'), 'só o Dono importa as planilhas da fábrica')
  await imp('inicio', {})
  await imp('clientes', [{ nome: 'Cliente Fab Teste', sigla: 'CF' }])
  await imp('fornecedores', [{ nome: 'Usina Teste' }])
  await imp('config', { codigo_inteligente: { liga: [{ c: 'AA', d: 'Aço teste' }] } })
  await imp('produtos', [{ codigo: 'MP-1', descricao: 'Barra teste', classe: 'mp' }, { codigo: 'P-1', descricao: 'Peça teste', mp_codigo: 'MP-1', mp_qtd: 0.5, mp_unidade: 'Kg', cliente: 'Cliente Fab' },
    { codigo: 'P-2', descricao: 'Peça 2' }, { codigo: 'CJ-1', descricao: 'Conjunto teste' }, { codigo: 'p-1', descricao: 'duplicado em minúscula' }])
  conf((await q(`select count(*)::int n from public.produtos`))[0].n === 4, 'produtos importados (código repetido fica um só)')
  conf((await q(`select c.nome from public.produtos p join public.clientes c on c.id = p.cliente_id where p.codigo = 'P-1'`))[0]?.nome === 'Cliente Fab Teste', 'cliente do produto achado pelo nome curto')
  await imp('estrutura', [{ pai: 'CJ-1', filho: 'P-1', qtd: 2, ordem: 1 }, { pai: 'CJ-1', filho: 'P-2', qtd: 1, ordem: 2 }, { pai: 'CJ-1', filho: 'NAO-EXISTE', qtd: 1 }])
  conf((await q(`select count(*)::int n from public.produto_estrutura`))[0].n === 2, 'estrutura importada (componente sem cadastro fica fora)')
  await imp('lotes', [{ ri: 5001, codigo: 'MP-1', qtd: 100, data: '2026-10-01', fornecedor: 'Usina Teste' }, { ri: 5002, codigo: 'MP-1', qtd: 50, data: '2026-10-02', status: 'Reprovado' }])
  await imp('vendas', [{ cliente: 'Cliente Fab', codigo: 'CJ-1', pedido: 'PC1', prazo: '2026-01-10', qtd: 10, valor: 5 }])
  conf((await q(`select cliente_nome from public.vendas`))[0].cliente_nome === 'Cliente Fab Teste', 'pedido fica com o nome do cadastro do cliente')
  await imp('ofs', [{ numero: 260001, tipo: 'componente', codigo: 'P-1', qtd: 20, ri: 5001, kg: 10, emitida_em: '2026-10-05', status: 'encerrada', produzido: 20 },
    { numero: 2600001, tipo: 'conjunto', codigo: 'CJ-1', qtd: 10, emitida_em: '2026-10-05', componentes: [{ codigo: 'P-1', qtd: 20, ref: '260001' }] }])
  conf((await q(`select (select numero from public.ofs where id = f.pai_id) p from public.ofs f where numero = 260001`))[0].p === 2600001, 'OF de componente ligada à OF do conjunto')
  await imp('maquinas', [{ codigo: 'TA 01', nome: 'Torno teste', grupo: 'Máquina', preventiva_dias: 90, checklist: ['Óleo', 'Correia'] }, { codigo: 'PRED MAT', nome: 'Predial', grupo: 'Predial' }])
  await imp('preventivas', [{ maquina: 'TA 01', data: '2026-09-01', resultados: [{ item: 'Óleo', situacao: 'Ok' }] }])
  const osApp = await rpc(alm, 'salvar_manutencao', { maquina_id: (await q(`select id from public.maquinas where codigo = 'TA 01'`))[0].id, problema: 'Aberta no sistema antes da importação' })
  const nApp = (await q(`select numero from public.manutencoes where id = $1`, [osApp]))[0].numero
  await imp('manutencoes', [{ numero: nApp, maquina: 'TA 01', problema: 'OS da planilha', data: '2026-08-01', status: 'concluida' }])
  const nums = await q(`select numero, problema from public.manutencoes where problema in ('OS da planilha', 'Aberta no sistema antes da importação') order by numero`)
  conf(nums.length === 2 && nums.find(x => x.problema === 'OS da planilha').numero === nApp && nums[0].numero !== nums[1].numero, 'OS da planilha fica com o número dela; a do sistema ganha outro', nums)
  await imp('registros', [{ tipo: 'desenvolvimento', numero: 1, codigo: 'P-1', titulo: 'Teste', dados: { cliente: 'Cliente Fab' } }, { tipo: 'gasto_manut', titulo: 'Óleo', valor: 50, maquina: 'TA 01' },
    { tipo: 'inventado', titulo: 'x' }])
  conf((await q(`select count(*)::int n from public.registros`))[0].n === 2, 'registros importados (tipo desconhecido fica fora)')
  await imp('pecas', [{ codigo: 'PM-1', descricao: 'Rolamento' }, { codigo: null, descricao: 'sem código' }])
  const fim = await imp('fim', {})
  conf(fim.ofs === 2 && fim.lotes === 2, 'fim da importação devolve as contagens', fim)
  conf((await erro(dono, 'importar_fabrica', 'inicio', {}, false))?.includes('já foram importadas'), 'importar de novo pede para marcar substituir')

  // matéria-prima e OFs
  const lote = await rpc(alm, 'salvar_lote', { produto_id: (await q(`select id from public.produtos where codigo = 'MP-1'`))[0].id, qtd: 80, fornecedor_nome: 'Usina Teste' })
  conf(lote.ri === 5003, 'R.I. novo = o próximo número', lote)
  conf((await erro(prod, 'salvar_lote', { produto_id: 'x', qtd: 1 }))?.includes('perfil não pode'), 'produção não lança entrada de material')
  const p1 = (await q(`select id from public.produtos where codigo = 'P-1'`))[0].id
  const cj = (await q(`select id from public.produtos where codigo = 'CJ-1'`))[0].id
  conf((await erro(pcp, 'emitir_of', { produto_id: p1, qtd: 10, ri: 5002 }))?.includes('reprovado'), 'OF com R.I. reprovado recusada')
  conf((await erro(pcp, 'emitir_of', { produto_id: p1, qtd: 10, ri: 9999 }))?.includes('não existe'), 'OF com R.I. sem entrada recusada')
  const of1 = await rpc(pcp, 'emitir_of', { produto_id: p1, qtd: 10, ri: 5001, emitida_em: '2026-11-03' })
  conf(of1.numero === 260002, 'número da OF de componente segue a planilha (AA + sequência)', of1)
  conf((await q(`select kg::float k from public.ofs where id = $1`, [of1.id]))[0].k === 5, 'kg da OF calculado pelo cadastro (qtd × kg por peça)')
  conf(Number((await q('select public.consumo_lote(5001) c'))[0].c) === 15, 'consumo do lote = soma das OFs')
  const of2 = await rpc(pcp, 'emitir_of', { produto_id: cj, qtd: 5, emitida_em: '2026-11-03', gerar_componentes: true })
  const filhos = await q(`select numero, qtd::float q from public.ofs where pai_id = $1 order by numero`, [of2.id])
  conf(of2.numero === 2600002 && filhos.length === 1 && filhos[0].q === 10, 'OF de conjunto gera as OFs dos componentes fabricados', { of2, filhos })
  conf((await q(`select componentes from public.ofs where id = $1`, [of2.id]))[0].componentes.find(c => c.codigo === 'P-1').ref === String(filhos[0].numero), 'conjunto guarda o nº da OF de cada componente')
  conf((await erro(prod, 'emitir_of', { produto_id: p1, qtd: 1 }))?.includes('perfil não pode'), 'produção não emite OF')
  await rpc(prod, 'apontar_of', { id: of1.id, produzido: 10, status: 'encerrada' })
  const o1 = (await q(`select status, realizado_por, realizada_em is not null d from public.ofs where id = $1`, [of1.id]))[0]
  conf(o1.status === 'encerrada' && o1.realizado_por === 'Beto Torno' && o1.d, 'produção aponta e encerra a OF', o1)
  conf((await erro(prod, 'apontar_of', { id: of1.id, status: 'aberta' }))?.includes('PCP'), 'reabrir OF é com o PCP')
  conf((await erro(pcp, 'emitir_of', { id: of1.id, produto_id: p1, qtd: 3 }))?.includes('reabra'), 'OF encerrada não se altera sem reabrir')
  await rpc(alm, 'ajustar_lote', { id: (await q(`select id from public.mp_lotes where ri = 5001`))[0].id, contado: 70 })
  const l1 = (await q(`select qtd::float - public.consumo_lote(ri)::float - baixa::float s from public.mp_lotes where ri = 5001`))[0].s
  conf(l1 === 70, 'inventário acerta o saldo do lote', l1)
  await rpc(dono, 'salvar_produto', { id: p1, codigo: 'P-1', descricao: 'Peça teste', situacao: 'bloqueado', mp_codigo: 'MP-1', mp_qtd: 0.5 })
  conf((await erro(pcp, 'emitir_of', { produto_id: p1, qtd: 1 }))?.includes('bloqueado'), 'código bloqueado não vai para OF')
  conf((await erro(tec, 'salvar_produto', { id: cj, codigo: 'CJ-1', descricao: 'Conj', estrutura: [{ codigo: 'CJ-1', qtd: 1 }] }))?.includes('ele mesmo'), 'estrutura não aceita o próprio produto')
  const p2 = (await q(`select id from public.produtos where codigo = 'P-2'`))[0].id
  conf((await erro(tec, 'salvar_produto', { id: p2, codigo: 'P-2', descricao: 'P2', estrutura: [{ codigo: 'CJ-1', qtd: 1 }] }))?.includes('já leva'), 'estrutura recusa ciclo (A dentro de B dentro de A)')
  conf((await erro(prod, 'salvar_produto', { codigo: 'Z', descricao: 'z' }))?.includes('perfil não pode'), 'produção não cadastra produto')

  // pedidos de clientes
  const v = (await q(`select id from public.vendas limit 1`))[0].id
  await rpc(pcp, 'entregar_venda', { venda_id: v, qtd: 4, nf: '123' })
  const e2 = await rpc(pcp, 'entregar_venda', { venda_id: v, qtd: 6, data: '2026-11-04' })
  conf((await q(`select entregue::float e from public.vendas where id = $1`, [v]))[0].e === 10, 'entregas somam no pedido')
  await rpc(pcp, 'excluir_entrega', e2)
  conf((await q(`select entregue::float e from public.vendas where id = $1`, [v]))[0].e === 4, 'desfazer entrega volta o saldo')
  conf((await erro(ger, 'entregar_venda', { venda_id: v, qtd: 1 }))?.includes('perfil não pode'), 'gerente vê os pedidos mas não lança entrega')
  conf((await ver(ger, 'select * from public.vendas')).length === 1 && (await ver(prod, 'select * from public.vendas')).length === 0, 'produção não vê pedidos de clientes (preços)')
  conf((await ver(rh, 'select * from public.produtos')).length === 0 && (await ver(rh, 'select * from public.ofs')).length === 0, 'RH não vê a fábrica')
  // a planilha tem itens zerados pelo cliente: entram como cancelados, nada fica de fora
  await imp('vendas', [{ cliente: 'Cliente Fab', codigo: 'P-1', pedido: 'PC2', prazo: '2026-02-01', qtd: 0, valor: 5 }])
  const vz = (await q(`select id, cancelado, qtd::float q, obs from public.vendas where pedido = 'PC2'`))[0]
  conf(vz?.cancelado && vz.q === 0 && vz.obs?.includes('zerada'), 'item zerado na planilha entra como cancelado', vz)
  conf((await erro(pcp, 'entregar_venda', { venda_id: vz.id, qtd: 1 }))?.includes('cancelado'), 'item cancelado não recebe entrega')
  conf((await erro(pcp, 'salvar_venda', { cliente_nome: 'Cliente Fab Teste', codigo: 'P-1', qtd: 0 }))?.includes('quantidade'), 'item novo com quantidade zero recusado')
  conf(!!(await rpc(pcp, 'salvar_venda', { id: vz.id, cliente_nome: 'Cliente Fab Teste', codigo: 'P-1', qtd: 0, cancelado: true, obs: 'ok' })), 'item cancelado zerado pode ser editado')

  // registros (técnico, PCP, manutenção)
  const alt = await rpc(prod, 'salvar_registro', { tipo: 'alteracao', titulo: 'Trocar o raio da dobra', dados: { solicitante: 'Beto' } })
  conf(alt.numero === 1, 'produção pede alteração e ganha o número', alt)
  conf((await erro(prod, 'salvar_registro', { id: alt.id, tipo: 'alteracao', titulo: 'mudei' }))?.includes('perfil não pode'), 'produção não edita a alteração depois de pedir')
  conf((await erro(rh, 'salvar_registro', { tipo: 'alteracao', titulo: 'x' }))?.includes('perfil não pode'), 'RH não pede alteração')
  conf((await erro(prod, 'salvar_registro', { tipo: 'desvio', titulo: 'x' }))?.includes('perfil não pode'), 'desvio só o técnico lança')
  const dv = await rpc(tec, 'salvar_registro', { tipo: 'desvio', titulo: 'Dureza no limite', codigo: 'P-1' })
  conf(dv.numero === 1, 'técnico lança desvio numerado')
  conf((await erro(tec, 'salvar_registro', { tipo: 'gasto_manut', titulo: 'x' }))?.includes('perfil não pode'), 'técnico não lança gasto da manutenção')
  await rpc(man, 'salvar_registro', { tipo: 'peca_critica', titulo: 'Correia', status: 'Comprar' })
  conf((await ver(prod, `select * from public.registros where tipo = 'gasto_manut'`)).length === 0, 'produção não vê gastos da manutenção')
  conf((await ver(prod, `select * from public.registros where tipo = 'alteracao'`)).length === 1, 'produção vê as alterações (técnico)')
  conf((await ver(man, `select * from public.registros where tipo = 'gasto_manut'`)).length === 1, 'manutenção vê os gastos')
  const se = await rpc(pcp, 'salvar_registro', { tipo: 'servico_externo', titulo: 'Zincagem', codigo: 'P-1' })
  conf(se.numero === 1, 'PCP lança serviço externo numerado')
  conf((await erro(prod, 'excluir_registro', alt.id))?.includes('perfil não pode'), 'produção não exclui registro')
  await rpc(tec, 'excluir_registro', dv.id)
  conf((await q(`select count(*)::int n from public.registros where id = $1`, [dv.id]))[0].n === 0, 'técnico exclui registro dele')

  // manutenção
  const maq = (await q(`select id from public.maquinas where codigo = 'TA 01'`))[0].id
  const os = await rpc(man, 'salvar_manutencao', { maquina_id: maq, problema: 'Vazamento', tipo: 'preditiva', responsavel: 'Márcio' })
  const o = (await q(`select numero, solicitante, tipo from public.manutencoes where id = $1`, [os]))[0]
  conf(o.numero > 0 && o.solicitante === 'Márcio Manutenção' && o.tipo === 'preditiva', 'manutenção abre OS numerada (preditiva) e fica como solicitante', o)
  const pv = await rpc(man, 'salvar_preventiva', { maquina_id: maq, data: '2026-11-04', resultados: [{ item: 'Óleo', situacao: 'Ok' }, { item: 'Correia', situacao: 'Trocar' }] })
  conf(!!pv && (await ver(prod, 'select * from public.preventivas')).length === 2, 'check-list da preventiva gravado (produção consulta)')
  conf((await erro(prod, 'salvar_preventiva', { maquina_id: maq }))?.includes('perfil não pode'), 'produção não preenche preventiva')
  conf((await erro(prod, 'salvar_maquina', { nome: 'X' }))?.includes('perfil não pode'), 'produção não cadastra máquina')
  const mq2 = await rpc(man, 'salvar_maquina', { codigo: 'PE 09', nome: 'Prensa teste', grupo: 'Máquina', checklist: ['Freio', 'Embreagem'] })
  conf((await q(`select jsonb_array_length(checklist) n from public.maquinas where id = $1`, [mq2]))[0].n === 2, 'manutenção cadastra máquina com check-list')
  conf((await erro(man, 'salvar_maquina', { codigo: 'pe 09', nome: 'Outra' }))?.length > 0, 'código de máquina repetido recusado')
  conf((await ver(man, 'select * from public.lancamentos')).length === 0 && (await ver(man, 'select * from public.rh_ponto')).length === 0, 'manutenção não vê financeiro nem RH')
  conf((await ver(tec, 'select * from public.clientes')).length > 0 && (await ver(tec, 'select * from public.lancamentos')).length === 0, 'técnico vê clientes, não vê financeiro')

  // nota fiscal pelo arquivo XML (dados inventados)
  const chaveNF = '35' + '2611' + '12345678000199' + '55' + '001' + '000044892' + '1' + '00044892' + '0'
  conf(chaveNF.length === 44, 'chave de teste com 44 números')
  const pcNF = (await q(`select id, estoque::float e from public.pecas where ativo order by codigo limit 1`))[0]
  const mpNF = (await q(`select id from public.produtos where codigo = 'MP-1'`))[0].id
  const lotesAntes = (await q(`select count(*)::int n from public.mp_lotes`))[0].n
  const nf0 = await rpc(alm, 'conferir_nota', { chave: chaveNF, cnpj: '12.345.678/0001-99' })
  conf(nf0.lancada === null && nf0.fornecedor_id === null && nf0.vinculos.length === 0, 'nota nova: não lançada e fornecedor ainda desconhecido', nf0)
  conf((await erro(prod, 'conferir_nota', { chave: chaveNF }))?.includes('perfil não pode'), 'produção não lê nota')
  const idNF = '6f1c2a10-0000-4000-8000-000000000001'
  const nf = await rpc(alm, 'lancar_nota', { id: idNF, chave: chaveNF, numero: '44892', serie: '1', emissao: '2026-11-03', valor: 150,
    fornecedor: { nome: 'Aços Nota Teste', razao: 'Aços Nota Teste Ltda', cnpj: '12.345.678/0001-99', uf: 'sp', cidade: 'Guarulhos' },
    itens: [{ n: 1, codigo: 'X-10', descricao: 'Rolamento', destino: 'peca', peca_id: pcNF.id, qtd: 3, preco_unit: 10 },
      { n: 2, codigo: 'BR-5', descricao: 'Barra redonda', destino: 'mp', produto_id: mpNF, qtd: 40, pedido: 'PC-77' },
      { n: 3, codigo: 'FR', descricao: 'Frete', destino: 'ignorar' }] })
  conf(nf.pecas === 1 && nf.ris.length === 1 && nf.documento === 'NF 44892', 'nota lança a peça e o R.I. de uma vez', nf)
  conf((await q(`select estoque::float e from public.pecas where id = $1`, [pcNF.id]))[0].e === pcNF.e + 3, 'estoque da peça sobe com a nota')
  const loteNF = (await q(`select nota, pedido, fornecedor_nome from public.mp_lotes where ri = $1`, [nf.ris[0]]))[0]
  conf(loteNF?.nota === '44892' && loteNF.pedido === 'PC-77' && loteNF.fornecedor_nome === 'Aços Nota Teste', 'R.I. guarda nota, pedido e fornecedor', loteNF)
  const fNF = (await q(`select uf, cidade, razao from public.fornecedores where id = $1`, [nf.fornecedor_id]))[0]
  conf(fNF?.uf === 'SP' && fNF.cidade === 'Guarulhos', 'fornecedor novo cadastrado com os dados da nota', fNF)
  conf((await rpc(alm, 'lancar_nota', { id: idNF, chave: chaveNF }))?.repetido === true, 'toque duplo não lança a nota duas vezes')
  conf((await erro(alm, 'lancar_nota', { chave: chaveNF, fornecedor_id: nf.fornecedor_id, itens: [{ destino: 'peca', peca_id: pcNF.id, qtd: 1 }] }))?.includes('já foi lançada'), 'a mesma nota não entra duas vezes')
  const nf1 = await rpc(alm, 'conferir_nota', { chave: chaveNF, cnpj: '12345678000199' })
  conf(!!nf1.lancada && nf1.lancada.quem === 'José Almox' && nf1.fornecedor_id === nf.fornecedor_id && nf1.vinculos.length === 2, 'conferir: já lançada (por quem), fornecedor pelo CNPJ e códigos lembrados', nf1)
  const chaveNF2 = chaveNF.slice(0, 43) + '1'
  conf((await erro(pcp, 'lancar_nota', { chave: chaveNF2, fornecedor_id: nf.fornecedor_id, itens: [{ destino: 'peca', peca_id: pcNF.id, qtd: 1 }] }))?.includes('matéria-prima'), 'PCP não dá entrada de peça pela nota')
  conf((await erro(alm, 'lancar_nota', { chave: chaveNF2, fornecedor_id: nf.fornecedor_id, itens: [{ destino: 'mp', produto_id: mpNF, qtd: 5 }],
    contas: [{ valor: 10, vencimento: '2026-12-01' }] }))?.includes('Escritório'), 'almoxarifado não lança a conta a pagar da nota')
  conf((await q(`select count(*)::int n from public.mp_lotes`))[0].n === lotesAntes + 1, 'nota recusada não deixa nada pela metade')
  conf((await erro(alm, 'lancar_nota', { chave: chaveNF2, fornecedor_id: nf.fornecedor_id, itens: [{ destino: 'ignorar' }] }))?.includes('pelo menos um'), 'nota sem nenhum item lançado recusada')
  conf((await erro(alm, 'lancar_nota', { chave: '123', fornecedor_id: nf.fornecedor_id, itens: [] }))?.includes('44'), 'chave inválida recusada')
  const pdNF = await rpc(alm, 'salvar_pedido', { fornecedor_id: nf.fornecedor_id, itens: [{ peca_id: pcNF.id, qtd: 4, valor: 48 }] })
  const itNF = (await q(`select id from public.pedido_itens where pedido_id = $1`, [pdNF.id]))[0].id
  const nf2 = await rpc(dono, 'lancar_nota', { chave: chaveNF2, numero: '50', fornecedor_id: nf.fornecedor_id,
    itens: [{ n: 1, codigo: 'X-10', destino: 'peca', peca_id: pcNF.id, qtd: 4, pedido_item_id: itNF }],
    contas: [{ valor: 28.8, vencimento: '2026-12-01' }, { valor: 19.2, vencimento: '2027-01-01' }] })
  conf((await q(`select status from public.pedidos_compra where id = $1`, [pdNF.id]))[0].status === 'recebido', 'nota que chegou de um pedido de compra baixa o pedido')
  const ctsNF = await q(`select valor::float v, parcela, categoria from public.lancamentos where documento = 'NF 50' order by vencimento`)
  conf(nf2.contas === 2 && ctsNF.length === 2 && ctsNF[0].parcela === '1/2' && ctsNF[1].v === 19.2, 'parcelas da nota viram contas a pagar com os vencimentos dela', ctsNF)
  const usinaNF = (await q(`select id from public.fornecedores where nome = 'Usina Teste'`))[0].id
  await rpc(alm, 'lancar_nota', { chave: chaveNF.slice(0, 42) + '22', numero: '60', fornecedor_id: usinaNF, fornecedor: { nome: 'USINA X', cnpj: '98.765.432/0001-10', uf: 'mg' },
    itens: [{ destino: 'mp', produto_id: mpNF, qtd: 2 }] })
  const uNF = (await q(`select nome, cnpj, uf from public.fornecedores where id = $1`, [usinaNF]))[0]
  conf(uNF.nome === 'Usina Teste' && uNF.cnpj === '98.765.432/0001-10' && uNF.uf === 'MG', 'fornecedor da planilha sem CNPJ fica completo com a nota (o nome não muda)', uNF)
  conf((await rpc(alm, 'conferir_nota', { chave: chaveNF, cnpj: '98765432000110' })).fornecedor_id === usinaNF, 'próxima nota já acha esse fornecedor pelo CNPJ')
  const negado = async (sql) => { try { await ver(dono, sql); return false } catch (e) { return /permission denied/i.test(e.message) } }
  conf(await negado('select * from public.notas_fiscais') && await negado('select * from public.nota_vinculos'), 'tabelas da nota só pelas funções')
  conf((await q(`select count(*)::int n from public.historico where tabela = 'notas_fiscais'`))[0].n === 3, 'cada nota lançada fica no histórico')
}

// ---------------------------------------------------------------- v2.7: processo na OF, perfil Comercial, compra de matéria-prima — dados inventados
{
  const pcp = (await q(`select user_id from public.perfis where login = 'paula.pcp'`))[0].user_id
  const tec = (await q(`select user_id from public.perfis where login = 'tiago.tec'`))[0].user_id
  const jul = await rpc(dono, 'criar_acesso', 'carla.com', 'senha-forte-13', 'Carla Comercial', 'comercial', null)
  conf(!!jul, 'perfil novo: comercial')
  const maq = (await q(`select id from public.maquinas where codigo = 'TA 01'`))[0].id

  // produtos de teste: barra (conjunto) = tubo (cortado aqui) + 2 flanges (usinadas) + 4 parafusos (comprados)
  const novoProd = (p) => rpc(dono, 'salvar_produto', p)
  const mpInox = await novoProd({ codigo: 'TB-INOX-T', descricao: 'Tubo inox teste', classe: 'mp' })
  const tubo = await novoProd({ codigo: 'TUBO-T', descricao: 'Tubo cortado teste', mp_codigo: 'TB-INOX-T', mp_qtd: 0.3, mp_unidade: 'Kg', operacao: 'Cortar Blank Conforme Desenho' })
  const flange = await novoProd({ codigo: 'FLANGE-T', descricao: 'Flange teste', mp_codigo: 'TB-INOX-T', mp_qtd: 0.1, mp_unidade: 'Kg', operacao: 'Usinar Conforme Desenho' })
  await novoProd({ codigo: 'PARAF-T', descricao: 'Parafuso teste', mp_codigo: 'PARAF-T', operacao: 'Controlar Recebimento Conforme P. Inspeção' })
  const barra = await novoProd({ codigo: 'BARRA-T', descricao: 'Barra de apoio teste', mp_codigo: 'Conforme Componentes', operacao: 'Montar e Soldar Conjunto',
    estrutura: [{ codigo: 'TUBO-T', qtd: 1 }, { codigo: 'FLANGE-T', qtd: 2 }, { codigo: 'PARAF-T', qtd: 4 }] })

  // processo montado sozinho pela estrutura
  const sug = await rpc(pcp, 'processo_sugerido', barra)
  conf(sug.length === 3 && sug[0].operacao.startsWith('Cortar') && sug[0].peca === 'Tubo cortado teste' && sug[1].peca === 'Flange teste'
    && sug[2].operacao === 'Montar e Soldar Conjunto' && !sug[2].peca, 'passo a passo sugerido pela estrutura (peça comprada fica fora)', sug)
  conf((await erro((await q(`select user_id from public.perfis where login = 'beto'`))[0].user_id, 'salvar_processo', { produto_id: tubo, passos: [] }))?.includes('perfil não pode'), 'produção não mexe no processo')
  conf((await erro(tec, 'salvar_processo', { produto_id: tubo, passos: [{ operacao: '  ' }] }))?.includes('Escreva'), 'passo sem descrição recusado')
  await rpc(tec, 'salvar_processo', { produto_id: tubo, passos: [{ operacao: 'Serrar no comprimento', maquina_id: maq }, { operacao: 'Amassar a ponta' }] })
  const sug2 = await rpc(pcp, 'processo_sugerido', barra)
  conf(sug2.length === 4 && sug2[1].operacao === 'Amassar a ponta' && sug2[0].peca === 'Tubo cortado teste', 'processo salvo de um componente entra no passo a passo do conjunto', sug2)

  // a OF nasce com o passo a passo e os quadradinhos
  const ofB = await rpc(pcp, 'emitir_of', { produto_id: barra, qtd: 100 })
  const pas = (await q(`select passos from public.ofs where id = $1`, [ofB.id]))[0].passos
  conf(pas.length === 4 && pas.every((x, i) => x.n === i + 1 && x.feito === false) && pas[0].maquina === 'Torno teste', 'OF já sai com o passo a passo (máquina com nome)', pas)
  const ofT = await rpc(pcp, 'emitir_of', { produto_id: tubo, qtd: 100 })
  conf((await q(`select jsonb_array_length(passos) n from public.ofs where id = $1`, [ofT.id]))[0].n === 2, 'OF do componente usa o processo dele')
  const beto = (await q(`select user_id from public.perfis where login = 'beto'`))[0].user_id
  const m1 = await rpc(beto, 'marcar_passo_of', { id: ofB.id, n: 2, feito: true })
  conf(m1[1].feito === true && m1[1].feito_por === 'Beto Torno' && !!m1[1].feito_em && m1[0].feito === false, 'produção marca o passo feito (quem e quando)', m1[1])
  conf((await erro(pcp, 'refazer_passos_of', ofB.id))?.includes('já tem passo marcado'), 'passo a passo não troca depois de começar')
  const m2 = await rpc(beto, 'marcar_passo_of', { id: ofB.id, n: 2, feito: false })
  conf(m2[1].feito === false && m2[1].feito_por === null, 'desmarcar um passo')
  conf((await erro(beto, 'marcar_passo_of', { id: ofB.id, n: 9 }))?.includes('não encontrado'), 'passo que não existe recusado')
  await rpc(tec, 'salvar_processo', { produto_id: barra, passos: [{ operacao: 'Serrar' }, { operacao: 'Amassar' }, { operacao: 'Soldar', maquina_id: maq }] })
  const ref = await rpc(pcp, 'refazer_passos_of', ofB.id)
  conf(ref.length === 3 && ref[2].maquina === 'Torno teste', 'OF que não começou pega o processo novo do produto', ref)
  await rpc(beto, 'apontar_of', { id: ofT.id, produzido: 100, status: 'encerrada' })
  conf((await erro(beto, 'marcar_passo_of', { id: ofT.id, n: 1 }))?.includes('encerrada'), 'OF encerrada não marca passo')
  await rpc(tec, 'salvar_processo', { produto_id: barra, passos: [] })
  conf((await q(`select processo from public.produtos where id = $1`, [barra]))[0].processo === null, 'lista vazia volta a montar pela estrutura')

  // v2.9: o mesmo passo fica marcado na OF do conjunto e na OF do componente
  const ofC = await rpc(pcp, 'emitir_of', { produto_id: barra, qtd: 10, gerar_componentes: true })
  const fil = await q(`select f.id, p.codigo from public.ofs f join public.produtos p on p.id = f.produto_id where f.pai_id = $1`, [ofC.id])
  const ofTubo = fil.find(x => x.codigo === 'TUBO-T')?.id, ofFl = fil.find(x => x.codigo === 'FLANGE-T')?.id
  const passosDe = async (id) => (await q(`select passos from public.ofs where id = $1`, [id]))[0].passos
  const pC0 = await passosDe(ofC.id)
  conf(!!ofTubo && !!ofFl && pC0.length === 4 && pC0[1].operacao === 'Amassar a ponta' && pC0[1].peca === 'Tubo cortado teste', 'conjunto com as OFs dos componentes para sincronizar', { fil, pC0 })
  await rpc(beto, 'marcar_passo_of', { id: ofTubo, n: 2, feito: true })
  let pC = await passosDe(ofC.id)
  conf(pC[1].feito === true && pC[1].feito_por === 'Beto Torno' && !!pC[1].feito_em && !pC[0].feito && !pC[2].feito && !pC[3].feito, 'marcou na OF do componente: marca o mesmo passo na OF do conjunto', pC)
  await rpc(beto, 'marcar_passo_of', { id: ofC.id, n: 1, feito: true })
  let pT = await passosDe(ofTubo)
  conf(pT[0].feito === true && pT[0].feito_por === 'Beto Torno' && pT[1].feito === true, 'marcou na OF do conjunto: marca na OF do componente', pT)
  await rpc(beto, 'marcar_passo_of', { id: ofC.id, n: 3, feito: true })
  conf((await passosDe(ofFl))[0].feito === true && (await passosDe(ofTubo)).every(x => x.feito), 'passo de outra peça vai para a OF dessa peça')
  await rpc(beto, 'marcar_passo_of', { id: ofC.id, n: 4, feito: true })
  conf((await passosDe(ofTubo)).length === 2 && (await passosDe(ofFl)).filter(x => x.feito).length === 1, 'passo do próprio conjunto (montar) não mexe nos componentes')
  await rpc(beto, 'marcar_passo_of', { id: ofTubo, n: 2, feito: true })   // já estava marcado: não muda nada
  conf((await passosDe(ofC.id)).filter(x => x.feito).length === 4, 'marcar de novo o que já estava feito não muda nada')
  await rpc(beto, 'marcar_passo_of', { id: ofTubo, n: 2, feito: false })
  pC = await passosDe(ofC.id)
  conf(pC[1].feito === false && pC[1].feito_por === null && pC[0].feito === true, 'desmarcou no componente: desmarca no conjunto', pC)
  await rpc(beto, 'marcar_passo_of', { id: ofC.id, n: 1, feito: false })
  conf((await passosDe(ofTubo))[0].feito === false, 'desmarcou no conjunto: desmarca no componente')
  await rpc(beto, 'apontar_of', { id: ofFl, produzido: 20, status: 'encerrada' })
  await rpc(beto, 'marcar_passo_of', { id: ofC.id, n: 3, feito: false })
  conf((await passosDe(ofC.id))[2].feito === false && (await passosDe(ofFl))[0].feito === true, 'OF de componente já encerrada não é mexida')
  await rpc(beto, 'apontar_of', { id: ofC.id, produzido: 10, status: 'encerrada' })
  await rpc(beto, 'marcar_passo_of', { id: ofTubo, n: 1, feito: true })
  conf((await passosDe(ofTubo))[0].feito === true && (await passosDe(ofC.id))[0].feito === false, 'conjunto encerrado: o componente marca sozinho')
  conf((await erro(beto, '_sinc_passo_of', ofTubo, 'x', true, 'a', 'b'))?.includes('permission denied') && (await erro(beto, '_chave_passo', {}, 'x'))?.includes('permission denied'),
    'funções internas da sincronização fechadas para o aplicativo')

  // perfil Comercial: o que vê e o que não vê
  conf((await ver(jul, 'select * from public.vendas')).length > 0 && (await ver(jul, 'select * from public.clientes')).length > 0
    && (await ver(jul, 'select * from public.mp_lotes')).length > 0, 'comercial vê pedidos de clientes, clientes e matéria-prima')
  conf((await ver(jul, 'select * from public.lancamentos')).length === 0 && (await ver(jul, 'select * from public.funcionarios_privado')).length === 0
    && (await ver(jul, 'select * from public.rh_ponto')).length === 0, 'comercial não vê financeiro nem RH (dados pessoais e ponto)')
  const forn = await rpc(jul, 'salvar_fornecedor', { nome: 'Aço Inox Teste Ltda' })
  conf(!!forn, 'comercial cadastra fornecedor')

  // necessidade (PCP) → pedido de compra de matéria-prima (Comercial)
  conf((await erro(beto, 'salvar_necessidade', { produto_id: mpInox, qtd: 10 }))?.includes('perfil não pode'), 'produção não lança necessidade')
  const nec1 = await rpc(pcp, 'salvar_necessidade', { produto_id: mpInox, qtd: 50, motivo: 'Estoque para a barra' })
  const nec2 = await rpc(pcp, 'salvar_necessidade', { produto_id: mpInox, qtd: 20 })
  conf((await ver(jul, `select criado_nome, status from public.necessidades where id = $1`, [nec1]))[0]?.criado_nome === 'Paula PCP', 'comercial vê a necessidade do PCP (com quem pediu)')
  conf((await erro(jul, 'salvar_pedido', { tipo: 'pecas', fornecedor_id: forn, itens: [{ peca_id: null, qtd: 1 }] }))?.includes('matéria-prima'), 'comercial não faz pedido de peças do almoxarifado')
  conf((await erro(pcp, 'salvar_pedido', { tipo: 'mp', fornecedor_id: forn, itens: [{ produto_id: mpInox, qtd: 1 }] }))?.includes('perfil não pode'), 'PCP não faz pedido de compra')
  conf((await erro(jul, 'salvar_pedido', { tipo: 'mp', fornecedor_id: forn, itens: [] }))?.includes('material'), 'pedido sem material recusado')
  const ped = await rpc(jul, 'salvar_pedido', { tipo: 'mp', fornecedor_id: forn, prazo: '2026-12-01', itens: [{ produto_id: mpInox, qtd: 100, valor: 2500 }], necessidades: [nec1] })
  const n1 = (await q(`select status, pedido_id from public.necessidades where id = $1`, [nec1]))[0]
  conf(n1.status === 'pedido' && n1.pedido_id === ped.id, 'necessidade vira "pedido" ligada ao pedido de compra', n1)
  const it = (await q(`select id, produto_id, peca_id from public.pedido_itens where pedido_id = $1`, [ped.id]))[0]
  conf(it.produto_id === mpInox && it.peca_id === null, 'item do pedido é material (não peça)')
  conf((await ver(pcp, 'select * from public.pedidos_compra')).length === 0, 'PCP continua sem ver preços de compra')

  // recebimento: o R.I. nasce sozinho, sem duplicar
  conf((await erro(jul, 'receber_pedido', { pedido_id: ped.id, itens: [{ item_id: it.id, qtd: 10 }], conta: { valor: 100, vencimento: '2026-12-10' } }))?.includes('Só o Dono'), 'comercial não lança conta a pagar')
  const lotesAntes = (await q(`select count(*)::int n from public.mp_lotes`))[0].n
  const chave = '6f1c2a54-0000-4000-8000-000000000027'
  const rec1 = await rpc(jul, 'receber_pedido', { pedido_id: ped.id, chave, documento: 'NF 777', itens: [{ item_id: it.id, qtd: 60 }] })
  const rec1b = await rpc(jul, 'receber_pedido', { pedido_id: ped.id, chave, documento: 'NF 777', itens: [{ item_id: it.id, qtd: 60 }] })
  const lt = await q(`select ri, qtd::float q, status, pedido, nota, pedido_item_id from public.mp_lotes where pedido_item_id = $1`, [it.id])
  conf(rec1.ris.length === 1 && rec1b.repetido === true && lt.length === 1 && (await q(`select count(*)::int n from public.mp_lotes`))[0].n === lotesAntes + 1,
    'receber matéria-prima cria um R.I. (o toque repetido não cria outro)', { rec1, rec1b, lt })
  conf(lt[0].q === 60 && lt[0].status === 'Aguardando' && lt[0].pedido === String((await q(`select numero from public.pedidos_compra where id = $1`, [ped.id]))[0].numero)
    && lt[0].nota === 'NF 777', 'R.I. vem com quantidade, nº do pedido, nota e aguardando inspeção', lt[0])
  const p1st = (await q(`select status from public.pedidos_compra where id = $1`, [ped.id]))[0].status
  await rpc(jul, 'receber_pedido', { pedido_id: ped.id, chave: '6f1c2a54-0000-4000-8000-000000000028', itens: [{ item_id: it.id, qtd: 40, status: 'Aprovado' }] })
  const p2 = (await q(`select p.status, i.recebido::float r from public.pedidos_compra p join public.pedido_itens i on i.pedido_id = p.id where p.id = $1`, [ped.id]))[0]
  conf(p1st === 'aguardando' && p2.status === 'recebido' && p2.r === 100, 'chegou tudo: pedido baixado sozinho', { p1st, p2 })

  // pedido cancelado devolve a necessidade para a lista
  const ped2 = await rpc(jul, 'salvar_pedido', { tipo: 'mp', fornecedor_id: forn, itens: [{ produto_id: mpInox, qtd: 20, valor: 500 }], necessidades: [nec2] })
  await rpc(jul, 'cancelar_pedido', ped2.id, 'Fornecedor sem estoque')
  conf((await q(`select status, pedido_id from public.necessidades where id = $1`, [nec2]))[0].status === 'aberta', 'pedido cancelado: a necessidade volta para comprar')
  await rpc(pcp, 'cancelar_necessidade', nec2, 'Não precisa mais')
  conf((await erro(pcp, 'cancelar_necessidade', nec2))?.includes('aberta'), 'necessidade cancelada não cancela de novo')
  conf((await erro(pcp, 'salvar_necessidade', { id: nec1, produto_id: mpInox, qtd: 5 }))?.includes('virou pedido'), 'necessidade que virou pedido não muda')

  // pedido de peças do almoxarifado continua só com o almoxarifado
  const pecaX = (await q(`select id from public.pecas limit 1`))[0].id
  const pedP = await rpc(dono, 'salvar_pedido', { fornecedor_id: forn, itens: [{ peca_id: pecaX, qtd: 2, valor: 10 }] })
  await rpc(dono, 'cancelar_pedido', pedP.id, null)
  conf((await erro(jul, 'reabrir_pedido', pedP.id))?.includes('almoxarifado') && (await erro(jul, 'cancelar_pedido', pedP.id))?.includes('aguardando'), 'comercial não reabre pedido de peças')
  await rpc(dono, 'reabrir_pedido', pedP.id)
  conf((await erro(jul, 'cancelar_pedido', pedP.id))?.includes('almoxarifado'), 'comercial não cancela pedido de peças')

  // nota fiscal de matéria-prima baixa o pedido de matéria-prima
  const ped3 = await rpc(jul, 'salvar_pedido', { tipo: 'mp', fornecedor_id: forn, itens: [{ produto_id: mpInox, qtd: 30, valor: 750 }] })
  const it3 = (await q(`select id from public.pedido_itens where pedido_id = $1`, [ped3.id]))[0].id
  const chaveNF = '35' + '2611' + '11222333000181' + '55' + '001' + '000004321' + '1' + '12345678' + '9'
  const nf = await rpc(jul, 'lancar_nota', { chave: chaveNF, numero: '4321', fornecedor_id: forn,
    itens: [{ n: 1, destino: 'mp', produto_id: mpInox, qtd: 30, pedido_item_id: it3, status: 'Aprovado', descricao: 'TUBO INOX' }] })
  const l3 = await q(`select qtd::float q, pedido_item_id, nota, status from public.mp_lotes where pedido_item_id = $1`, [it3])
  conf(nf.ris.length === 1 && l3.length === 1 && l3[0].q === 30 && l3[0].nota === '4321' && l3[0].status === 'Aprovado'
    && (await q(`select status from public.pedidos_compra where id = $1`, [ped3.id]))[0].status === 'recebido', 'nota de matéria-prima recebe pelo pedido (R.I. + baixa)', { nf, l3 })
  conf((await q(`select count(*)::int n from public.historico where tabela = 'necessidades'`))[0].n >= 3, 'necessidade fica no histórico')
}

// ---------------------------------------------------------------- v3.0: programação de entregas do cliente (release) — dados inventados
{
  const pcp = (await q(`select user_id from public.perfis where login = 'paula.pcp'`))[0].user_id
  const cli = await rpc(dono, 'salvar_cliente', { nome: 'Montadora Teste', razao: 'Montadora Teste S.A.' })
  const np = (p) => rpc(dono, 'salvar_produto', p)
  const eixo = await np({ codigo: 'MT 01.0001', descricao: 'Eixo teste', cliente_id: cli, codigo_cliente: 'Z40.010.001', mp_codigo: 'TB-INOX-T', mp_qtd: 0.2, mp_unidade: 'Kg', operacao: 'Tornear' })
  const bucha = await np({ codigo: 'MT 01.0002', descricao: 'Bucha teste', cliente_id: cli, codigo_cliente: 'Z40.010.002', mp_codigo: 'TB-INOX-T', mp_qtd: 0.1, mp_unidade: 'Kg', operacao: 'Tornear' })
  await np({ codigo: 'MT 01.0003', descricao: 'Pino teste', cliente_id: cli, codigo_cliente: 'Z40.010.003', mp_codigo: 'TB-INOX-T', mp_qtd: 0.1, mp_unidade: 'Kg', operacao: 'Tornear' })
  const venda = (o) => rpc(pcp, 'salvar_venda', { cliente_id: cli, ...o })
  // o que já está em aberto no sistema (lançado à mão antes)
  const vA = await venda({ produto_id: eixo, pedido: '5700000001', prazo: '2026-12-03', qtd: 200, valor: 4.5 })        // vai mudar para 40
  const vB = await venda({ produto_id: eixo, pedido: '5700000001', prazo: '2026-12-10', qtd: 300, valor: 4.5 })        // igual
  const vC = await venda({ produto_id: bucha, pedido: '5700000002', prazo: '2026-11-26', qtd: 500, valor: 1.2 })       // 180 entregues; o arquivo pede mais 400
  await rpc(pcp, 'entregar_venda', { venda_id: vC, qtd: 180, data: '2026-11-20', nf: '9001' })
  const vD = await venda({ produto_id: bucha, pedido: '5700000002', prazo: '2026-12-17', qtd: 250, valor: 1.2 })       // saiu do arquivo (nada entregue)
  const vE = await venda({ produto_id: bucha, pedido: '5700000002', prazo: '2026-11-19', qtd: 100, valor: 1.2 })       // saiu do arquivo (60 entregues)
  await rpc(pcp, 'entregar_venda', { venda_id: vE, qtd: 60, data: '2026-11-18', nf: '9000' })
  const vF = await venda({ produto_id: eixo, pedido: '5700000001', prazo: '2027-06-10', qtd: 90, valor: 4.5 })         // fora do período: não mexe
  const vG = await venda({ produto_id: eixo, pedido: 'AVULSO-1', prazo: '2026-12-01', qtd: 15, valor: 5 })              // saiu, mas a pessoa manda manter
  const outro = await rpc(pcp, 'salvar_venda', { cliente_nome: 'Outro Cliente Teste', descricao: 'Peça de outro cliente', prazo: '2026-12-03', qtd: 7 })
  const linhas = [
    { codigo: 'Z40.010.001', pedido: '5700000001', prazo: '2026-12-03', qtd: 40, descricao: 'EIXO TESTE' },
    { codigo: 'z40.010.001', pedido: '5700000001', prazo: '2026-12-10', qtd: 100 }, { codigo: 'Z40.010.001', pedido: '5700000001', prazo: '2026-12-10', qtd: 200 },   // a mesma entrega em duas linhas: soma 300
    { codigo: 'Z40.010.002', pedido: '5700000002', prazo: '2026-11-26', qtd: 400 },
    { codigo: 'Z40.010.002', pedido: '5700000002', prazo: '2026-12-24', qtd: 250 },      // a data nova do que saiu de 17/12
    { codigo: 'Z40.010.003', pedido: '5700000003', prazo: '2026-12-05', qtd: 60 },       // peça com cadastro, sem pedido ainda
    { codigo: 'Z99.999.999', pedido: '5700000009', prazo: '2026-12-08', qtd: 12, descricao: 'PECA NOVA SEM CADASTRO' },
    { codigo: 'Z40.010.001', pedido: '5700000001', prazo: '2027-09-09', qtd: 999 },      // depois do período
    { codigo: 'Z40.010.003', pedido: '5700000003', prazo: '2026-12-12', qtd: 0 },        // zerada: ignora
  ]
  const base = { cliente_id: cli, arquivo: 'RELEASE TESTE 20.11.2026.TXT', data_ref: '2026-11-20', ate: '2027-03-20', linhas,
    ultimas_nf: [{ codigo: 'Z40.010.002', nf: '9002-1', data: '2026-11-21', qtd: 100 }], layout: { periodo: '120' } }
  const estado = async () => Object.fromEntries((await q(`select id, qtd::float q, entregue::float e, cancelado c, release_de::float de, release_id r, obs from public.vendas where cliente_id = $1 or id = $2`, [cli, outro])).map(x => [x.id, x]))
  const antes = await estado()

  // simular não grava nada
  const sim = await rpc(pcp, 'importar_release', { ...base, simular: true })
  conf(sim.simulado === true && sim.linhas === 6 && sim.fora === 1 && sim.iguais === 1 && sim.n_novos === 3 && sim.n_alterados === 2 && sim.n_sairam === 3, 'simulação da programação: novas, alteradas, saíram e iguais', sim)
  conf(JSON.stringify(await estado()) === JSON.stringify(antes) && (await q(`select count(*)::int n from public.vendas_releases`))[0].n === 0, 'simular não grava nada')
  const a1 = sim.alterados.find(x => x.venda_id === vA), a2 = sim.alterados.find(x => x.venda_id === vC)
  conf(a1?.de === 200 && a1?.para === 40 && a2?.de === 320 && a2?.para === 400, 'simulação mostra o saldo de antes e o de agora', sim.alterados)
  conf(sim.sem_cadastro.join() === 'Z99.999.999' && sim.sairam.map(x => x.venda_id).sort().join() === [vD, vE, vG].sort().join(), 'peça sem cadastro e o que saiu aparecem na conferência', { s: sim.sem_cadastro, sai: sim.sairam })
  conf(!sim.sairam.some(x => x.venda_id === vF || x.venda_id === outro), 'entrega fora do período e pedido de outro cliente não entram na comparação')

  // quem pode
  conf((await erro(prod, 'importar_release', { ...base, simular: true }))?.includes('perfil não pode'), 'produção não atualiza programação')
  conf((await erro(pcp, 'importar_release', { ...base, cliente_id: null }))?.includes('Escolha o cliente'), 'programação sem cliente recusada')
  conf((await erro(pcp, 'importar_release', { ...base, linhas: [] }))?.includes('nenhuma entrega'), 'arquivo vazio recusado')
  conf((await erro(pcp, 'importar_release', { ...base, linhas: [{ codigo: 'X', prazo: '32/13/2026', qtd: 1 }] }))?.includes('Data inválida'), 'data inválida recusada')
  conf((await erro(pcp, 'importar_release', { ...base, linhas: [{ codigo: '', prazo: '2026-12-01', qtd: 1 }] }))?.includes('sem código'), 'linha sem código recusada')
  conf((await erro(pcp, 'importar_release', { ...base, ate: '2026-01-01' }))?.includes('período'), 'período que não pega nenhuma entrega recusado')

  // gravar (mantendo o avulso em aberto)
  const idRel = '11111111-2222-4333-8444-555555555555'
  const hAntes = (await q(`select count(*)::int n from public.historico where tabela = 'vendas'`))[0].n
  const r1 = await rpc(pcp, 'importar_release', { ...base, id: idRel, manter: [vG] })
  const d = await estado()
  conf(r1.id === idRel && r1.n_novos === 3 && r1.n_alterados === 2 && r1.n_sairam === 2 && r1.iguais === 1, 'programação gravada', r1)
  conf(d[vA].q === 40 && d[vA].de === 200 && d[vA].r === idRel && !d[vA].c, 'quantidade menor: o pedido é acertado e guarda quanto era', d[vA])
  conf(d[vC].q === 580 && d[vC].e === 180 && d[vC].de === 320, 'quantidade do arquivo é o saldo: pedido = entregue + saldo', d[vC])
  conf(d[vB].q === 300 && d[vB].r === null, 'entrega igual não é mexida', d[vB])
  conf(d[vD].c === true && d[vD].q === 250 && /Saiu da programação do cliente em 20\/11\/2026/.test(d[vD].obs), 'saiu sem entrega: cancelado com a anotação', d[vD])
  conf(d[vE].c === false && d[vE].q === 60 && d[vE].e === 60, 'saiu com parte entregue: fecha no que foi entregue', d[vE])
  conf(d[vG].q === 15 && !d[vG].c && d[vG].r === null && d[vF].q === 90 && d[outro].q === 7, 'mantido, fora do período e outro cliente continuam iguais')
  const novos = await q(`select v.codigo, v.codigo_cliente cc, v.descricao d, v.pedido, v.prazo::text p, v.qtd::float q, v.valor::float val, v.produto_id pid from public.vendas v
    where v.release_id = $1 and v.release_de is null and not v.cancelado order by v.prazo`, [idRel])
  conf(novos.length === 3 && novos[0].codigo === 'MT 01.0003' && novos[0].q === 60 && novos[1].cc === 'Z99.999.999' && novos[1].pid === null && novos[1].d === 'PECA NOVA SEM CADASTRO'
    && novos[2].codigo === 'MT 01.0002' && novos[2].p === '2026-12-24' && novos[2].val === 1.2, 'entregas novas entram com produto, descrição e o último preço do cliente', novos)
  const rel = (await q(`select * from public.vendas_releases where id = $1`, [idRel]))[0]
  conf(rel.cliente_nome === 'Montadora Teste' && rel.criado_nome === 'Paula PCP' && rel.linhas === 6 && rel.novos === 3 && rel.alterados === 2 && rel.sairam === 2 && rel.iguais === 1
    && rel.sem_cadastro[0] === 'Z99.999.999' && rel.ultimas_nf[0].nf === '9002-1', 'a atualização guarda quem fez, o arquivo e o resumo', rel)
  const itens = await q(`select tipo, count(*)::int n from public.vendas_release_itens where release_id = $1 group by 1 order by 1`, [idRel])
  conf(itens.map(x => x.tipo + x.n).join() === 'alterado2,novo3,saiu2', 'cada mudança fica registrada', itens)
  conf((await q(`select count(*)::int n from public.historico where tabela = 'vendas'`))[0].n === hAntes, 'a programação não enche o histórico geral (tem o registro próprio)')
  const r1b = await rpc(pcp, 'importar_release', { ...base, id: idRel, manter: [vG] })
  conf(r1b.repetido === true && (await q(`select count(*)::int n from public.vendas_releases`))[0].n === 1, 'o mesmo envio de novo não grava duas vezes')

  // o mesmo arquivo de novo: nada muda
  const sim2 = await rpc(pcp, 'importar_release', { ...base, simular: true })
  conf(sim2.n_novos === 0 && sim2.n_alterados === 0 && sim2.iguais === 6 && sim2.sairam.length === 1 && sim2.sairam[0].venda_id === vG, 'importar o mesmo arquivo de novo não muda nada', sim2)

  // quem lê
  const jul = (await q(`select user_id from public.perfis where login = 'carla.com'`))[0].user_id
  conf((await ver(jul, 'select * from public.vendas_releases')).length === 1 && (await ver(jul, 'select * from public.vendas_release_itens')).length === 7, 'comercial vê as programações')
  conf((await ver(prod, 'select * from public.vendas_releases')).length === 0 && (await ver(prod, 'select * from public.vendas_release_itens')).length === 0, 'produção não vê as programações')
  conf((await erro(pcp, '_chave_venda', null, 'x', 'y', '2026-01-01'))?.includes('permission denied'), 'função interna da programação fechada')
  let direto = null
  try { await ver(pcp, `insert into public.vendas_releases (cliente_nome) values ('x')`) } catch (e) { direto = e.message }
  conf(/permission denied/.test(direto || ''), 'ninguém grava programação direto na tabela', direto)

  // segunda atualização (a quantidade sobe e uma entrega nova é entregue), depois desfazer
  await rpc(pcp, 'entregar_venda', { venda_id: (await q(`select id from public.vendas where release_id = $1 and codigo = 'MT 01.0003'`, [idRel]))[0].id, qtd: 10, data: '2026-11-25' })
  const base2 = { ...base, arquivo: 'RELEASE TESTE 27.11.2026.TXT', data_ref: '2026-11-27', manter: [vG],
    linhas: linhas.filter(x => x.qtd > 0 && x.prazo < '2027-01-01').map(x => x.prazo === '2026-12-03' ? { ...x, qtd: 75 } : x.codigo === 'Z40.010.003' ? { ...x, qtd: 50 } : x).concat([{ codigo: 'Z40.010.001', pedido: '5700000001', prazo: '2026-12-29', qtd: 33 }]) }
  conf((await erro(pcp, 'desfazer_release', '00000000-0000-4000-8000-000000000000'))?.includes('não encontrada'), 'desfazer atualização que não existe recusado')
  const r2 = await rpc(pcp, 'importar_release', base2)
  const d2 = await estado()
  conf(r2.n_novos === 1 && r2.n_alterados === 1 && r2.n_sairam === 0 && d2[vA].q === 75 && d2[vA].de === 40 && d2[vA].r === r2.id, 'segunda atualização: só o que mudou de novo', { r2: { n: r2.n_novos, a: r2.n_alterados, s: r2.n_sairam }, vA: d2[vA] })
  conf((await erro(pcp, 'desfazer_release', idRel))?.includes('última atualização'), 'só dá para desfazer a última atualização do cliente')
  conf((await erro(prod, 'desfazer_release', r2.id))?.includes('perfil não pode'), 'produção não desfaz programação')
  const nov2 = (await q(`select id from public.vendas where release_id = $1 and release_de is null`, [r2.id]))[0].id
  await rpc(pcp, 'emitir_of', { produto_id: eixo, qtd: 33, venda_id: nov2 })
  const u2 = await rpc(pcp, 'desfazer_release', r2.id)
  const d3 = await estado()
  conf(u2.desfeitos === 1 && u2.ficaram === 1 && d3[vA].q === 40 && d3[vA].r === null && !!d3[nov2], 'desfazer volta a quantidade; o que já tem OF fica', { u2, vA: d3[vA] })
  conf((await erro(pcp, 'desfazer_release', r2.id))?.includes('já foi desfeita'), 'desfazer duas vezes recusado')
  const u1 = await rpc(pcp, 'desfazer_release', idRel)
  const d4 = await estado()
  conf(u1.ficaram === 1 && d4[vA].q === 200 && d4[vC].q === 500 && d4[vD].c === false && d4[vD].obs === null && d4[vE].q === 100 && d4[vB].q === 300, 'desfazer a primeira: tudo volta ao que era (menos o que já teve entrega)', { u1, d: [d4[vA], d4[vC], d4[vD], d4[vE]] })
  conf((await q(`select count(*)::int n from public.vendas where release_id is not null`))[0].n === 0
    && (await q(`select count(*)::int n from public.vendas_releases where desfeito_em is not null and desfeito_por = 'Paula PCP'`))[0].n === 2, 'atualizações desfeitas ficam marcadas (quem e quando)')

  // quantidade = total do pedido (cliente que manda o pedido inteiro, não o saldo)
  const r3 = await rpc(pcp, 'importar_release', { ...base, qtd_saldo: false, arquivo: 'pedido total.csv', manter: [vD, vE, vG],
    linhas: [{ codigo: 'Z40.010.002', pedido: '5700000002', prazo: '2026-11-26', qtd: 600 }, { codigo: 'MT 01.0001', pedido: '5700000001', prazo: '2026-12-03', qtd: 200 }, { codigo: 'Z40.010.001', pedido: '5700000001', prazo: '2026-12-10', qtd: 300 }] })
  const d5 = await estado()
  conf(r3.n_alterados === 1 && d5[vC].q === 600 && d5[vC].e === 180 && r3.iguais === 2, 'quantidade como total do pedido: desconta o que já foi entregue; acha a peça também pelo código JAF', { r3: { a: r3.n_alterados, i: r3.iguais }, vC: d5[vC] })
}

// ---------------------------------------------------------------- funções liberadas
const sb = await rpc(dono, 'saude_banco')
conf(sb.bytes > 0 && sb.tabelas.length > 0 && sb.historico > 0, 'Dono vê o espaço usado no banco', sb)
conf((await erro(esc, 'saude_banco'))?.includes('perfil não pode'), 'só o Dono vê o espaço do banco')
const gat = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`)
conf(gat.length === 0, 'funções de gatilho fechadas para quem usa o aplicativo', gat.map(r => r.proname))
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
