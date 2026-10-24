/* Financeiro: contas a pagar e a receber, fluxo de caixa */
import { useEffect, useState } from 'react'
import { App } from '../app/controle.tsx'
import { API, ErroApp, traduzir } from '../lib/api.ts'
import { C, S } from '../lib/dados.ts'
import { Perm } from '../lib/perm.ts'
import type { Lancamento } from '../lib/tipos.ts'
import * as U from '../lib/util.ts'
import { aviso } from '../ui/avisos.ts'
import { BuscaLista, Btn, Cab, Campo, Chips, Dl, Paginado, Tag, Texto, Vazio, Voltar } from '../ui/base.tsx'
import { ComboCliente, ComboFornecedor } from '../ui/Combo.tsx'
import { useLembrar, type Rota } from '../ui/ganchos.ts'
import { Ic } from '../ui/icones.tsx'
import { confirmar, lerForm, modal, useJanela } from '../ui/janelas.tsx'

const FORMAS = ['Pix', 'Boleto', 'Transferência', 'Dinheiro', 'Cartão', 'Cheque', 'Débito automático']

export function LinhaConta({ l }: { l: Lancamento }) {
  const sit = C.situacaoConta(l)
  const quem = S.get('fornecedores', l.fornecedor_id)?.nome || S.get('clientes', l.cliente_id)?.nome || S.get('funcionarios', l.funcionario_id)?.nome || ''
  const rel = U.relativo(l.vencimento)
  return <div className="linha clicavel" data-conta={l.id} onClick={() => void abrir(l.id)}>
    <span className={`sinal ${l.tipo === 'receber' ? 'ent' : 'sai'}`}><Ic n={l.tipo === 'receber' ? 'entrada' : 'retirar'} /></span>
    <div className="meio"><b>{l.descricao}{l.parcela && <> <span className="fraco">({l.parcela})</span></>}</b>
      <small>{l.pago_em ? (l.tipo === 'pagar' ? 'Paga em ' : 'Recebida em ') + U.data(l.pago_em) : 'Vence ' + rel + (rel !== U.data(l.vencimento) ? ' · ' + U.dataCurta(l.vencimento) : '')}{quem ? ' · ' + quem : ''}{l.categoria ? ' · ' + l.categoria : ''}</small></div>
    <div className="lado"><b style={{ color: `var(--${l.tipo === 'receber' ? 'verde' : 'texto'})` }}>{U.moeda(l.pago_em ? l.valor_pago : l.valor)}</b><Tag s={sit} /></div></div>
}

export function TelaFinanceiro({ r }: { r: Rota }) { return r.sub === 'fluxo' ? <Fluxo /> : <Contas r={r} /> }
export const tituloFinanceiro = (r: Rota) => r.sub === 'fluxo' ? 'Fluxo de caixa' : 'Contas'

// ---------------------------------------------------------------- lista de contas
function filtrar(t: string, f: string, cat: string, busca: string): Lancamento[] {
  const hoje = U.hoje()
  let l = S.lista('lancamentos').filter(x => x.tipo === t)
  if (f === 'abertas') l = l.filter(x => !x.pago_em)
  else if (f === 'vencida') l = l.filter(x => !x.pago_em && x.vencimento < hoje)
  else if (f === 'hoje') l = l.filter(x => !x.pago_em && x.vencimento === hoje)
  else if (f === 'semana') l = l.filter(x => !x.pago_em && x.vencimento <= U.somaDias(hoje, 7))
  else if (f === 'mes') l = l.filter(x => !x.pago_em && x.vencimento.slice(0, 7) === hoje.slice(0, 7))
  else if (f === 'pagas') l = l.filter(x => x.pago_em)
  if (cat) l = l.filter(x => x.categoria === cat)
  if (busca.trim()) { const ts = U.sem(busca.trim()).split(' ')
    l = l.filter(x => { const s = U.sem([x.descricao, x.categoria, x.documento, x.obs, S.get('fornecedores', x.fornecedor_id)?.nome, S.get('clientes', x.cliente_id)?.nome, U.dec(x.valor)].join(' ')); return ts.every(p => s.includes(p)) }) }
  return f === 'pagas' ? l.sort((a, b) => (a.pago_em || '') < (b.pago_em || '') ? 1 : -1) : l.sort((a, b) => a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0)
}

function Contas({ r }: { r: Rota }) {
  const [t, setT] = useLembrar('fin.t', 'pagar')
  const [f, setF] = useLembrar('fin.f', 'abertas')
  const [busca, setBusca] = useLembrar('fin.busca', '')
  const [cat, setCat] = useLembrar('fin.cat', '')
  useEffect(() => { const qt = r.q.get('t'), qf = r.q.get('f'); if (qt) { setT(qt); setCat('') } if (qf) setF(qf) }, [r.hash, r.q, setT, setF, setCat])
  const hoje = U.hoje(), todas = S.lista('lancamentos')
  const ab = (x: string) => todas.filter(l => l.tipo === x && !l.pago_em)
  const venc = (x: string) => ab(x).filter(l => l.vencimento < hoje)
  const cats = U.unicos(todas.filter(x => x.tipo === t).map(x => x.categoria).filter((x): x is string => !!x)).sort()
  const n = (x: string) => filtrar(t, x, cat, busca).length
  const l = filtrar(t, f, cat, busca)
  const ir = (tt: string, ff: string) => { setT(tt); setF(ff); setCat('') }
  const kpi = (cls: string, alvo: [string, string], rot: string, lst: Lancamento[]) =>
    <button type="button" className={`kpi ${cls}`} data-ir={alvo.join('|')} style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer' }} onClick={() => ir(...alvo)}>
      <small>{rot}</small><b>{U.moeda0(U.soma(lst, 'valor'))}</b><span>{U.plural(lst.length, 'conta')}</span></button>
  return <>
    <Cab titulo="Contas a pagar e a receber">
      <Btn txt="Nova conta" icone="mais" cls="pri" data-fi="nova" onClick={() => void form({ tipo: t as Lancamento['tipo'] })} />
      {Perm.pode('salarios') && <Btn txt="Lançar folha" icone="equipe" data-fi="folha" onClick={() => void folha()} />}
      <a className="btn sec" href="#/financeiro/fluxo"><Ic n="relatorio" /><span>Fluxo de caixa</span></a>
    </Cab>
    <div className="grade g4">
      {kpi(venc('pagar').length ? 'alerta' : '', ['pagar', 'vencida'], 'A pagar vencidas', venc('pagar'))}
      {kpi('', ['pagar', 'abertas'], 'A pagar em aberto', ab('pagar'))}
      {kpi(venc('receber').length ? 'alerta' : '', ['receber', 'vencida'], 'A receber atrasadas', venc('receber'))}
      {kpi('', ['receber', 'abertas'], 'A receber em aberto', ab('receber'))}
    </div>
    <nav className="abas-tela mt2"><button type="button" className={t === 'pagar' ? 'on' : ''} data-t="pagar" onClick={() => { setT('pagar'); setCat('') }}>A pagar</button>
      <button type="button" className={t === 'receber' ? 'on' : ''} data-t="receber" onClick={() => { setT('receber'); setCat('') }}>A receber</button></nav>
    <div className="barra-filtros"><BuscaLista id="bFin" valor={busca} placeholder="Descrição, fornecedor, cliente, valor…" aoMudar={setBusca} />
      <select id="fCat" aria-label="Categoria" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Todas as categorias</option>{cats.map(c => <option key={c}>{c}</option>)}</select></div>
    <Chips atual={f} aoEscolher={setF} opcoes={[{ v: 'abertas', t: 'Em aberto', n: n('abertas') }, { v: 'vencida', t: t === 'pagar' ? 'Vencidas' : 'Atrasadas', n: n('vencida') || null }, { v: 'hoje', t: 'Hoje', n: n('hoje') || null },
      { v: 'semana', t: 'Próximos 7 dias' }, { v: 'mes', t: 'Este mês' }, { v: 'pagas', t: t === 'pagar' ? 'Pagas' : 'Recebidas' }, { v: 'todas', t: 'Todas' }]} />
    <p className="sub mt" id="resFin">{U.plural(l.length, 'conta')} · <b>{U.moeda(U.soma(l, x => x.pago_em ? x.valor_pago : x.valor))}</b></p>
    <Paginado key={[t, f, cat, busca].join('|')} itens={l} passo={60} render={(x) => <LinhaConta key={x.id} l={x} />} vazio={<Vazio icone="dinheiro" titulo="Nenhuma conta aqui" />} />
  </>
}

// ---------------------------------------------------------------- detalhe / baixa
export async function abrir(id: string): Promise<void> {
  const l = S.get('lancamentos', id); if (!l) return
  const pagar = l.tipo === 'pagar'
  await modal({
    titulo: l.descricao,
    corpo: <DetalheConta l={l} />,
    botoes: !l.pago_em ? [{ txt: pagar ? 'Marcar como paga' : 'Marcar como recebida', cls: 'verde', icone: 'ok', acao: async (f) => {
      const d = lerForm(f)
      if (!(d.bvalor >= 0)) throw new ErroApp('Informe o valor.')
      await API.rpc('baixar_lancamento', { p_id: l.id, p_data: d.bdata, p_valor: d.bvalor, p_forma: d.bforma || null })
      await App.gravou(['lancamentos']); aviso(pagar ? 'Conta paga.' : 'Recebimento registrado.')
    } }] : [{ txt: pagar ? 'Desfazer pagamento' : 'Desfazer recebimento', cls: 'sec', icone: 'desfazer', validar: false, acao: async () => {
      if (!(await confirmar('Voltar esta conta para "em aberto"?', { ok: 'Desfazer' }))) return false
      await API.rpc('baixar_lancamento', { p_id: l.id, p_data: null, p_valor: null, p_forma: null })
      await App.gravou(['lancamentos']); aviso('Conta voltou para em aberto.')
    } }],
  })
}

function DetalheConta({ l }: { l: Lancamento }) {
  const j = useJanela()
  const pagar = l.tipo === 'pagar'
  const grupo = l.grupo ? S.lista('lancamentos').filter(x => x.grupo === l.grupo).sort((a, b) => a.vencimento < b.vencimento ? -1 : 1) : []
  const ped = S.get('pedidos_compra', l.pedido_id), op = S.get('ordens', l.ordem_id)
  const excluir = async () => {
    const abertasGrupo = grupo.filter(g => !g.pago_em).length
    const todas = grupo.length > 1 && abertasGrupo > 1 && await confirmar(`Esta conta tem ${grupo.length} parcelas. Excluir também as outras ${abertasGrupo - 1} que não foram pagas?`, { ok: 'Excluir todas em aberto', nao: 'Só esta' })
    if (!todas && !(await confirmar('Excluir esta conta?', { detalhe: 'Fica registrado no histórico de alterações.', ok: 'Excluir', perigo: true }))) return
    try {
      const n = await API.rpc<number>('excluir_lancamento', { p_id: l.id, p_grupo: !!todas })
      await App.gravou(['lancamentos'], { inteira: ['lancamentos'] }); j.limparSujo(); j.fechar(); aviso(`${U.plural(n, 'conta excluída', 'contas excluídas')}.`)
    } catch (err) { j.erro(traduzir(err).message) }
  }
  return <>
    <p><Tag s={C.situacaoConta(l)} /> <span className="sub">{pagar ? 'Conta a pagar' : 'Conta a receber'}{l.parcela ? ' · parcela ' + l.parcela : ''}</span></p>
    <Dl pares={[['Valor', <b>{U.moeda(l.valor)}</b>], ['Vencimento', U.data(l.vencimento)], ['Pago em', l.pago_em ? `${U.data(l.pago_em)} · ${U.moeda(l.valor_pago)}` : ''],
      ['Forma', l.forma || ''], ['Categoria', l.categoria || ''], ['Fornecedor', S.get('fornecedores', l.fornecedor_id)?.nome || ''],
      ['Cliente', S.get('clientes', l.cliente_id)?.nome || ''], ['Funcionário', S.get('funcionarios', l.funcionario_id)?.nome || ''],
      ['Pedido de compra', ped ? <a href={'#/pedido/' + ped.id} onClick={() => j.fechar()}>nº {ped.numero}</a> : ''], ['Ordem de produção', op ? `OP ${op.numero}` : ''],
      ['Documento', l.documento || ''], ['Observações', l.obs ? <Texto t={l.obs} /> : ''], ['Lançada por', S.nomeUsuario(l.criado_por)]]} />
    {grupo.length > 1 && <><p className="mt"><b>Parcelas</b></p><div className="lista">{grupo.map(g => <div key={g.id} className={`linha ${g.id === l.id ? 'on' : ''}`} style={{ minHeight: 44 }}>
      <div className="meio"><b>{g.parcela || ''} · {U.data(g.vencimento)}</b></div><div className="lado">{U.moeda(g.valor)} <Tag s={C.situacaoConta(g)} /></div></div>)}</div></>}
    {!l.pago_em && <div className="card mt" style={{ background: 'var(--cartao-2)' }}><div className="linha-campos l3">
      <Campo nome="bdata" rotulo={pagar ? 'Pago em' : 'Recebido em'} tipo="date" valor={U.hoje()} />
      <Campo nome="bvalor" rotulo="Valor" tipo="dinheiro" valor={U.campoNum(l.valor)} ajuda="Mude se teve juros ou desconto" />
      <Campo nome="bforma" rotulo="Forma" tipo="select" valor={l.forma || ''} opcoes={[{ v: '', t: '—' }, ...FORMAS.map(v => ({ v, t: v }))]} /></div></div>}
    <div className="grupo-btn mt"><button type="button" className="btn fantasma mini" data-x="editar" onClick={() => { j.limparSujo(); j.fechar(); void form(l) }}><Ic n="lapis" /><span>Editar</span></button>
      <button type="button" className="btn perigo-txt mini" data-x="excluir" onClick={() => void excluir()}><Ic n="lixo" /><span>Excluir</span></button></div>
  </>
}

// ---------------------------------------------------------------- nova / editar
export async function form(l: Partial<Lancamento> = {}): Promise<string | null> {
  const novo = !l.id
  return modal<string>({
    titulo: novo ? 'Nova conta' : 'Editar conta',
    corpo: <FormConta l={l} />,
    botoes: [{ txt: novo ? 'Lançar' : 'Salvar', acao: async (f) => {
      const d = lerForm(f)
      if (d.tipo === 'pagar') d.cliente_id = null; else d.fornecedor_id = null
      if (!f.dataset.envio) f.dataset.envio = l.id || U.uuid()
      const payload: Record<string, unknown> = { ...d, id: f.dataset.envio, pedido_id: l.pedido_id || null, ordem_id: l.ordem_id || null, funcionario_id: l.funcionario_id || null }
      if (!novo) { payload.pago_em = l.pago_em; payload.valor_pago = l.valor_pago }
      if (novo && d.jaPago) payload.pago_em = U.hoje()
      const id = await API.rpc<string>('salvar_lancamento', { p: payload })
      await App.gravou(['lancamentos'])
      aviso(novo ? 'Conta lançada.' : 'Conta salva.')
      return id
    } }],
  })
}

function FormConta({ l }: { l: Partial<Lancamento> }) {
  const novo = !l.id
  const cats = C.categorias()
  const [tipo, setTipo] = useState<'pagar' | 'receber'>(l.tipo || 'pagar')
  const [valor, setValor] = useState<number | null>(l.valor ?? null)
  const [parcelas, setParcelas] = useState(1)
  return <>
    <div className="opcoes" role="radiogroup">
      {(['pagar', 'receber'] as const).map(v => <label key={v} className="opcao"><input type="radio" name="tipo" value={v} defaultChecked={tipo === v} onChange={() => setTipo(v)} />
        <span><b>{v === 'pagar' ? 'A pagar' : 'A receber'}</b><small>{v === 'pagar' ? 'despesa' : 'receita'}</small></span></label>)}</div>
    <Campo nome="descricao" rotulo="Descrição" valor={l.descricao} req placeholder="Ex.: Energia elétrica, Upgrade — PC 016/26" />
    <div className="linha-campos">
      <Campo nome="valor" rotulo={novo ? 'Valor total' : 'Valor'} tipo="dinheiro" valor={U.campoNum(l.valor)} req attrs={{ onInput: (e: React.FormEvent<HTMLInputElement>) => setValor(U.num(e.currentTarget.value)) }} />
      <Campo nome="vencimento" rotulo={novo ? '1º vencimento' : 'Vencimento'} tipo="date" valor={l.vencimento || U.hoje()} req />
    </div>
    {novo && <><div className="linha-campos">
      <Campo nome="parcelas" rotulo="Repetir / parcelar" tipo="select" opcoes={[1, 2, 3, 4, 5, 6, 10, 12].map(n => ({ v: n, t: n === 1 ? 'Só uma vez' : n + ' vezes' }))}
        attrs={{ onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setParcelas(Number(e.currentTarget.value)) }} />
      <Campo nome="intervalo" rotulo="De quanto em quanto" tipo="select" opcoes={[{ v: 'mensal', t: 'Todo mês (mesmo dia)' }, { v: '30', t: 'A cada 30 dias' }, { v: '28', t: 'A cada 28 dias' }, { v: '15', t: 'A cada 15 dias' }, { v: '7', t: 'Toda semana' }]} />
    </div>
      <p className="sub" id="lParc">{parcelas > 1 && valor ? `${parcelas} contas de ${U.moeda(Math.floor(valor / parcelas * 100) / 100)} (o total ${U.moeda(valor)} é dividido; para repetir o mesmo valor todo mês, digite o valor × ${parcelas}).` : ''}</p></>}
    <div className="linha-campos">
      <Campo nome="categoria" rotulo="Categoria" valor={l.categoria} attrs={{ list: 'lCat' }} />
      <Campo nome="forma" rotulo="Forma" tipo="select" valor={l.forma || ''} opcoes={[{ v: '', t: '—' }, ...FORMAS.map(v => ({ v, t: v }))]} />
    </div>
    <datalist id="lCat">{cats[tipo].map(c => <option key={c} value={c} />)}</datalist>
    <div className="so-pagar" hidden={tipo !== 'pagar'}><ComboFornecedor id="lForn" nome="fornecedor_id" rotulo="Fornecedor" placeholder="Opcional" inicial={S.get('fornecedores', l.fornecedor_id)} /></div>
    <div className="so-receber" hidden={tipo !== 'receber'}><ComboCliente id="lCli" nome="cliente_id" rotulo="Cliente" placeholder="Opcional" inicial={S.get('clientes', l.cliente_id)} /></div>
    <Campo nome="documento" rotulo="Documento (NF, boleto…)" valor={l.documento} />
    <Campo nome="obs" rotulo="Observações" tipo="area" valor={l.obs} linhas={2} />
    {novo && <Campo nome="jaPago" rotulo="Já foi paga / recebida hoje" tipo="check" />}
  </>
}

// folha do mês: uma conta com a soma dos salários dos ativos
async function folha() {
  const ativos = S.lista('funcionarios').filter(f => f.ativo)
  const sal = ativos.map(f => ({ f, s: Number(S.get('funcionarios_privado', f.id)?.salario) || 0 }))
  const total = U.soma(sal, 's'), sem = sal.filter(x => !x.s)
  const hoje = U.hoje(), mes = U.nomeMes(Number(hoje.slice(5, 7))) + '/' + hoje.slice(0, 4)
  const jaTem = S.lista('lancamentos').some(l => l.categoria === 'Folha de pagamento' && l.descricao.includes(mes))
  await form({ tipo: 'pagar', descricao: `Folha de pagamento ${mes}`, categoria: 'Folha de pagamento', valor: total, vencimento: U.somaMeses(hoje.slice(0, 8) + '05', 1),
    obs: `${ativos.length} funcionários ativos.${sem.length ? ' Sem salário cadastrado: ' + sem.map(x => x.f.nome).join(', ') + '.' : ''}${jaTem ? ' ATENÇÃO: já existe uma folha deste mês lançada.' : ''}` })
}

// ---------------------------------------------------------------- fluxo de caixa
export function saldoHoje(): number | null {
  const si = S.cfg<{ valor?: number; data?: string; em?: string } | null>('saldo_inicial', null)
  if (!si || si.valor === undefined) return null
  const de = si.data || '0000'
  // no dia em que o saldo foi informado, só conta o que foi baixado DEPOIS de informar
  const pagos = S.lista('lancamentos').filter(l => l.pago_em && (l.pago_em > de || (l.pago_em === de && (!si.em || l.atualizado_em > si.em))))
  return Number(si.valor) + U.soma(pagos.filter(l => l.tipo === 'receber'), 'valor_pago') - U.soma(pagos.filter(l => l.tipo === 'pagar'), 'valor_pago')
}

function Fluxo() {
  const hoje = U.hoje(), saldo = saldoHoje()
  const ini = U.somaMeses(hoje.slice(0, 8) + '01', -3)
  const L = S.lista('lancamentos')
  const meses = Array.from({ length: 10 }, (_, i) => { const a = U.somaMeses(ini, i); const fim = U.somaDias(U.somaMeses(a, 1), -1)
    const dentro = (d: string) => d >= a && d <= fim
    return { ini: a, fim,
      recebido: U.soma(L.filter(l => l.tipo === 'receber' && l.pago_em && dentro(l.pago_em)), 'valor_pago'),
      pago: U.soma(L.filter(l => l.tipo === 'pagar' && l.pago_em && dentro(l.pago_em)), 'valor_pago'),
      aReceber: U.soma(L.filter(l => l.tipo === 'receber' && !l.pago_em && dentro(l.vencimento < hoje ? hoje : l.vencimento)), 'valor'),
      aPagar: U.soma(L.filter(l => l.tipo === 'pagar' && !l.pago_em && dentro(l.vencimento < hoje ? hoje : l.vencimento)), 'valor'),
      proj: null as number | null } })
  // saldo projetado: a partir de hoje
  let acum = saldo ?? 0
  for (const m of meses) { if (m.fim < hoje.slice(0, 8) + '01') continue; acum += m.aReceber - m.aPagar; m.proj = acum }
  const proxDias = (n: number) => { const ate = U.somaDias(hoje, n); return (saldo ?? 0) + U.soma(L.filter(l => l.tipo === 'receber' && !l.pago_em && l.vencimento <= ate), 'valor') - U.soma(L.filter(l => l.tipo === 'pagar' && !l.pago_em && l.vencimento <= ate), 'valor') }
  return <>
    <Voltar para="#/financeiro" txt="Contas" />
    <Cab titulo="Fluxo de caixa" sub="O que entrou, o que saiu e o que vem pela frente"><Btn txt="Informar saldo do caixa" icone="dinheiro" data-fl="saldo" onClick={() => void informarSaldo()} /></Cab>
    {saldo === null && <p className="nota amarela">Informe quanto tem hoje no caixa/banco (botão acima) para o sistema calcular o saldo e a projeção. Sem isso, a projeção começa do zero.</p>}
    <div className="grade g4 mt">
      <div className={`kpi ${saldo !== null && saldo < 0 ? 'alerta' : ''}`}><small>Saldo hoje (estimado)</small><b>{saldo === null ? '—' : U.moeda0(saldo)}</b><span>{saldo === null ? 'informe o saldo' : 'desde ' + U.data(S.cfg<{ data?: string }>('saldo_inicial', {}).data)}</span></div>
      {[7, 30, 90].map(n => { const v = proxDias(n); return <div key={n} className={`kpi ${v < 0 ? 'alerta' : ''}`}><small>Em {n} dias</small><b>{U.moeda0(v)}</b><span>se tudo for pago e recebido em dia</span></div> })}
    </div>
    <section className="card mt"><div className="tabela-caixa"><table className="tabela cartoes"><thead><tr><th>Mês</th><th className="num">Recebido</th><th className="num">Pago</th><th className="num">A receber</th><th className="num">A pagar</th><th className="num">Resultado</th><th className="num">Saldo projetado</th></tr></thead>
      <tbody>{meses.map(m => { const res = m.recebido + m.aReceber - m.pago - m.aPagar; const atual = hoje >= m.ini && hoje <= m.fim
        return <tr key={m.ini} style={atual ? { background: 'var(--marca-suave)' } : undefined}><td data-r="Mês" className="titulo">{U.cap(U.nomeMes(Number(m.ini.slice(5, 7))))} {m.ini.slice(0, 4)}{atual ? ' (atual)' : ''}</td>
          <td data-r="Recebido" className="num">{U.moeda0(m.recebido)}</td><td data-r="Pago" className="num">{U.moeda0(m.pago)}</td>
          <td data-r="A receber" className="num">{m.aReceber ? U.moeda0(m.aReceber) : '—'}</td><td data-r="A pagar" className="num">{m.aPagar ? U.moeda0(m.aPagar) : '—'}</td>
          <td data-r="Resultado" className="num" style={{ color: `var(--${res < 0 ? 'vermelho' : 'verde'})`, fontWeight: 700 }}>{U.moeda0(res)}</td>
          <td data-r="Saldo projetado" className="num">{m.proj === null ? '—' : <b style={{ color: `var(--${m.proj < 0 ? 'vermelho' : 'texto'})` }}>{U.moeda0(m.proj)}</b>}</td></tr> })}</tbody></table></div>
      <p className="sub mt">Contas vencidas e não pagas entram no mês atual. "Resultado" = recebido + a receber − pago − a pagar.</p></section>
    {Perm.pode('relatorios') && <p className="mt"><a href="#/relatorios?r=financeiro">Ver despesas e receitas por categoria →</a></p>}
  </>
}

async function informarSaldo() {
  const atual = saldoHoje()
  await modal({
    titulo: 'Saldo do caixa hoje',
    corpo: <><p className="sub">Some o que tem em caixa e nas contas do banco hoje. A partir daí o sistema soma o que for recebido e tira o que for pago.</p>
      <Campo nome="valor" rotulo="Saldo de hoje" tipo="dinheiro" valor={atual === null ? '' : U.campoNum(atual)} req /></>,
    botoes: [{ txt: 'Salvar', acao: async (f) => {
      const d = lerForm(f); if (d.valor === null) throw new ErroApp('Informe o saldo.')
      await API.rpc('salvar_config', { p_chave: 'saldo_inicial', p_valor: { valor: d.valor, data: U.hoje(), em: new Date().toISOString() } })
      await App.gravou(['config']); aviso('Saldo salvo.')
    } }],
  })
}
