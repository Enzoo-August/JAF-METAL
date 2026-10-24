/* Movimentações: retirar, dar entrada, histórico e desfazer */
import { useRef, useState } from 'react'
import { App } from '../app/controle.tsx'
import { API, ErroApp } from '../lib/api.ts'
import { C, S } from '../lib/dados.ts'
import { Perm } from '../lib/perm.ts'
import type { Fornecedor, Maquina, Movimento, Peca } from '../lib/tipos.ts'
import * as U from '../lib/util.ts'
import { aviso, erro } from '../ui/avisos.ts'
import { BuscaLista, Btn, Cab, Campo, Chips, Dl, Paginado, Vazio } from '../ui/base.tsx'
import { ComboFornecedor, ComboFuncionario, ComboMaquina, ComboPeca, type ComboApi } from '../ui/Combo.tsx'
import { excel } from '../ui/arquivos.tsx'
import { useLembrar } from '../ui/ganchos.ts'
import { Ic } from '../ui/icones.tsx'
import { confirmar, lerForm, modal, useJanela } from '../ui/janelas.tsx'
import { receber } from './Compras.tsx'

export const MOTIVO: Record<string, string> = { compra: 'Compra', retirada: 'Retirada', ajuste: 'Ajuste de contagem', devolucao: 'Devolução', importado: 'Planilha', estorno: 'Desfeito' }

const desfeitos = () => new Set(S.lista('movimentos').filter(m => m.estorno_de).map(m => m.estorno_de))

// ---------------------------------------------------------------- uma linha de movimentação (abre o detalhe)
export function LinhaMov({ m, curta, desf }: { m: Movimento; curta?: boolean; desf?: Set<string | null> }) {
  const p = S.get('pecas', m.peca_id)
  const ent = m.tipo === 'entrada'
  const riscada = (desf || desfeitos()).has(m.id)
  const quem = S.get('funcionarios', m.funcionario_id)?.nome || ''
  const maq = S.get('maquinas', m.maquina_id)?.nome || m.destino || ''
  const forn = Perm.pode('compras') ? S.get('fornecedores', m.fornecedor_id)?.nome : ''
  const info = [curta ? U.relativo(m.data) : U.data(m.data), MOTIVO[m.motivo] || m.motivo, quem, maq, ent && m.motivo !== 'estorno' ? forn : '', m.documento && m.motivo !== 'retirada' ? m.documento : ''].filter(Boolean)
  return <div className={`linha clicavel ${riscada ? 'riscada' : ''}`} data-mov={m.id} onClick={() => void detalhe(m.id)}>
    <span className={`sinal ${ent ? 'ent' : 'sai'}`}><Ic n={ent ? 'entrada' : 'retirar'} /></span>
    <div className="meio"><b><span className="codigo">{p?.codigo || '?'}</span> · {p?.descricao || ''}</b><small>{info.join(' · ')}{riscada ? ' · desfeito' : ''}</small></div>
    <div className="lado"><b style={{ color: `var(--${ent ? 'verde' : 'vermelho'})` }}>{ent ? '+' : '−'}{U.qtd(m.qtd)}</b>{Perm.pode('precos') && <small>{U.moeda(m.qtd * m.preco_unit)}</small>}</div></div>
}

// ---------------------------------------------------------------- retirar
interface CtlRetirar { limpar?: () => void }
export async function retirar(peca?: Peca | null): Promise<unknown> {
  let resultado: unknown = null
  const ctl: CtlRetirar = {}
  await modal({
    titulo: 'Retirar peça',
    corpo: <FormRetirar peca={peca || null} ctl={ctl} />,
    botoes: [
      { txt: 'Retirar e lançar outra', cls: 'sec', acao: async (f) => { await enviarRetirada(f); ctl.limpar?.(); return false } },
      { txt: 'Retirar', icone: 'retirar', acao: async (f) => { resultado = await enviarRetirada(f) } },
    ],
  })
  return resultado
}

const maquinaDaUtilizacao = (p: Peca | null): Maquina | null =>
  p?.utilizacao ? S.lista('maquinas').find(x => x.ativo && U.sem(x.nome) === U.sem(p.utilizacao)) || null : null

function FormRetirar({ peca, ctl }: { peca: Peca | null; ctl: CtlRetirar }) {
  const j = useJanela()
  const precos = Perm.pode('precos'), podeData = Perm.pode('entrada')
  const [pecaId, setPecaId] = useState(peca?.id || '')
  const [qtd, setQtd] = useState('1')
  const [maqId, setMaqId] = useState(maquinaDaUtilizacao(peca)?.id || '')
  const comboPeca = useRef<ComboApi<Peca>>(null), comboMaq = useRef<ComboApi<Maquina>>(null)
  const qtdRef = useRef<HTMLInputElement>(null)
  const p = S.get('pecas', pecaId)
  const n = U.num(qtd) || 0
  const fica = p ? p.estoque - n : 0
  const abertas = maqId ? C.manutAbertas(maqId) : []

  ctl.limpar = () => {
    comboPeca.current?.definir(null); setPecaId(''); setQtd('1')
    const o = j.form?.elements.namedItem('obs') as HTMLInputElement | null; if (o) o.value = ''
    j.limparSujo()
    document.getElementById('rPeca')?.focus()
  }
  const passo = (d: number) => { setQtd(U.qtd(Math.max(1, (U.num(qtd) || 0) + d)).replace(/\./g, '')); if (j.form) j.form.dataset.sujo = '1' }

  return <>
    <ComboPeca ref={comboPeca} id="rPeca" nome="peca_id" rotulo="Peça" req placeholder="Digite o código ou o nome" inicial={peca}
      aoEscolher={(x) => {
        setPecaId(x.id)
        // sugere a máquina pela utilização da peça
        if (!comboMaq.current?.valor()) { const m = maquinaDaUtilizacao(x); if (m) comboMaq.current?.definir(m) }
        setTimeout(() => qtdRef.current?.select(), 30)
      }}
      aoLimpar={() => setPecaId('')} />
    <div id="rInfo">{p && <p className={`nota ${fica < 0 ? 'vermelha' : fica < p.est_min ? 'amarela' : ''}`}>
      No estoque: <b>{U.qtd(p.estoque)} {p.unidade}</b>{p.local ? ' · prateleira ' + p.local : ''}{precos && n > 0 ? ` · custo ${U.moeda(C.custoRetirada(p.id, n))}` : ''}<br />
      {fica < 0 ? 'Não tem tudo isso no sistema. Se tem na prateleira, peça ao almoxarifado para contar o estoque.'
        : <>Depois da retirada fica <b>{U.qtd(fica)}</b>{fica < p.est_min ? ' — abaixo do mínimo (' + U.qtd(p.est_min) + ')' : ''}.</>}</p>}</div>
    <div className="linha-campos l2">
      <div className="campo"><label htmlFor="rQtd">Quantidade <i className="req">*</i></label><div className="passo-qtd">
        <button type="button" data-p="-1" aria-label="Menos" onClick={() => passo(-1)}>−</button>
        <input ref={qtdRef} id="rQtd" name="qtd" data-num="qtd" inputMode="decimal" value={qtd} required onChange={(e) => setQtd(e.target.value)} {...(peca ? { 'data-autofocus': '1' } : {})} />
        <button type="button" data-p="1" aria-label="Mais" onClick={() => passo(1)}>+</button></div></div>
      {podeData && <Campo nome="data" rotulo="Data" tipo="date" valor={U.hoje()} attrs={{ max: U.hoje() }} />}
    </div>
    <div className="linha-campos l2">
      <ComboFuncionario id="rFunc" nome="funcionario_id" rotulo="Quem está retirando" placeholder="Nome" inicial={S.get('funcionarios', API.sessao?.funcionario_id)} />
      <ComboMaquina ref={comboMaq} id="rMaq" nome="maquina_id" rotulo="Para qual máquina" placeholder="Máquina" novo={null} inicial={maquinaDaUtilizacao(peca)}
        aoEscolher={(m) => setMaqId(m.id)} aoLimpar={() => setMaqId('')} />
    </div>
    <div id="rManut">{abertas.length > 0 && <Campo key={maqId} nome="manutencao_id" rotulo="É para esta manutenção?" tipo="select"
      opcoes={[{ v: '', t: 'Não, uso normal' }, ...abertas.map(m => ({ v: m.id, t: `${U.data(m.data)} — ${m.problema.slice(0, 60)}` }))]} />}</div>
    <Campo nome="obs" rotulo="Observação (opcional)" placeholder="Ex.: troca por desgaste, quebrou…" />
  </>
}

async function enviarRetirada(f: HTMLFormElement) {
  const d = lerForm(f)
  const p = S.get('pecas', d.peca_id)
  if (!p) throw new ErroApp('Escolha a peça.')
  if (!(d.qtd > 0)) throw new ErroApp('Informe a quantidade.')
  const maq = S.get('maquinas', d.maquina_id)
  // id gerado aqui: se a internet cair e tocar de novo, o banco não lança duas vezes
  if (!f.dataset.envio) f.dataset.envio = U.uuid()
  const r = await API.rpc<{ ids: string[] }>('movimentar', { p: { id: f.dataset.envio, tipo: 'saida', motivo: 'retirada', peca_id: p.id, qtd: d.qtd, data: d.data || null,
    funcionario_id: d.funcionario_id || null, maquina_id: d.maquina_id || null, destino: maq?.nome || null, manutencao_id: d.manutencao_id || null, obs: d.obs || null } })
  delete f.dataset.envio
  await App.gravou(['pecas', 'movimentos'])
  const novo = S.get('pecas', p.id)!
  const ids = r.ids || []
  aviso(`Retirado ${U.qtd(d.qtd)} × ${p.codigo}. Ficou ${U.qtd(novo.estoque)}${novo.estoque < novo.est_min ? ' (abaixo do mínimo)' : ''}.`, 'ok', {
    acao: { txt: 'Desfazer', fn: () => desfazerVarios(ids) } })
  return r
}

async function desfazerVarios(ids: string[]) {
  try {
    for (const id of ids) await API.rpc('estornar', { p_id: id, p_obs: 'Desfeito logo depois de lançar' })
    await App.gravou(['pecas', 'movimentos', 'pedido_itens', 'pedidos_compra'])
    aviso('Desfeito. O estoque voltou.')
  } catch (e) { erro(e) }
}

// ---------------------------------------------------------------- entrada
export async function entrada(peca?: Peca | null): Promise<unknown> {
  let resultado: unknown = null
  await modal({
    titulo: 'Dar entrada no estoque',
    corpo: <FormEntrada peca={peca || null} />,
    botoes: [{ txt: 'Dar entrada', icone: 'entrada', acao: async (f) => {
      const d = lerForm(f)
      const p = S.get('pecas', d.peca_id)
      if (!p) throw new ErroApp('Escolha a peça.')
      if (!(d.qtd > 0)) throw new ErroApp('Informe a quantidade.')
      if (d.motivo === 'compra' && !(d.preco_unit > 0) && !(await confirmar('Entrada de compra sem preço?', { detalhe: 'O valor do estoque e o custo das retiradas vão ficar zerados para estas peças.', ok: 'Sim, sem preço' }))) return false
      if (!f.dataset.envio) f.dataset.envio = U.uuid()
      const compra = d.motivo === 'compra'
      const r = await API.rpc<{ ids: string[] }>('movimentar', { p: { id: f.dataset.envio, tipo: 'entrada', motivo: d.motivo, peca_id: p.id, qtd: d.qtd,
        preco_unit: d.preco_unit, fornecedor_id: compra ? d.fornecedor_id : null, documento: compra ? d.documento || null : null,
        data: compra ? d.data || null : null, obs: d.obs || null } })
      delete f.dataset.envio
      await App.gravou(['pecas', 'movimentos'])
      aviso(`Entrada de ${U.qtd(d.qtd)} × ${p.codigo}. Agora tem ${U.qtd(S.get('pecas', p.id)!.estoque)}.`, 'ok', { acao: { txt: 'Desfazer', fn: () => desfazerVarios(r.ids) } })
      resultado = r
    } }],
  })
  return resultado
}

function FormEntrada({ peca }: { peca: Peca | null }) {
  const j = useJanela()
  const [pecaId, setPecaId] = useState(peca?.id || '')
  const [motivo, setMotivo] = useState('compra')
  const [total, setTotal] = useState(0)
  const preco = useRef<HTMLInputElement>(null), qtd = useRef<HTMLInputElement>(null)
  const forn = useRef<ComboApi<Fornecedor>>(null)
  const ult = peca ? C.ultimaEntrada(peca.id) : null
  const abertos = pecaId && Perm.pode('compras') ? C.pedidosAbertosDaPeca(pecaId) : []
  const somar = () => { const q = U.num(qtd.current?.value), v = U.num(preco.current?.value); setTotal(q && v ? q * v : 0) }
  return <div onInput={somar}>
    <ComboPeca id="ePeca" nome="peca_id" rotulo="Peça" req placeholder="Digite o código ou o nome" inicial={peca}
      aoEscolher={(p) => {
        setPecaId(p.id)
        const u = C.ultimaEntrada(p.id)
        if (u && preco.current && !preco.current.value) preco.current.value = U.campoPreco(u.preco_unit)
        if (!forn.current?.valor()) { const f = S.get('fornecedores', u?.fornecedor_id || p.fornecedor_id); if (f) forn.current?.definir(f) }
        somar(); setTimeout(() => qtd.current?.focus(), 30)
      }}
      aoLimpar={() => setPecaId('')} />
    <div id="eAberto">{abertos.length > 0 && <div className="nota amarela"><b>Esta peça tem pedido de compra aguardando.</b> Se chegou desse pedido, receba por ele (assim o pedido é baixado):
      <div className="grupo-btn mt">{abertos.map(({ ped, item }) => <button key={ped.id} type="button" className="btn sec mini" data-receber={ped.id}
        onClick={() => { j.limparSujo(); j.fechar(null); void receber(S.get('pedidos_compra', ped.id)) }}>Receber pedido nº {ped.numero} (faltam {U.qtd(item.qtd - item.recebido)})</button>)}</div></div>}</div>
    <div className="opcoes" role="radiogroup" aria-label="Tipo de entrada">
      {([['compra', 'Compra', 'chegou do fornecedor'], ['devolucao', 'Devolução', 'voltou da produção'], ['ajuste', 'Ajuste', 'achei a mais']] as const).map(([v, t, s]) =>
        <label key={v} className="opcao"><input type="radio" name="motivo" value={v} defaultChecked={v === 'compra'} onChange={() => setMotivo(v)} /><span><b>{t}</b><small>{s}</small></span></label>)}
    </div>
    <div className="linha-campos l2">
      <Campo nome="qtd" rotulo="Quantidade" tipo="qtd" req foco={!!peca} inputRef={qtd} />
      <Campo nome="preco_unit" rotulo="Preço unitário" tipo="dinheiro" valor={ult ? U.campoPreco(ult.preco_unit) : ''} ajuda="Vem o último preço pago; confira na nota." inputRef={preco} />
    </div>
    <div className="so-compra" hidden={motivo !== 'compra'}>
      <ComboFornecedor ref={forn} id="eForn" nome="fornecedor_id" rotulo="Fornecedor" placeholder="Digite para buscar"
        inicial={peca ? S.get('fornecedores', ult?.fornecedor_id || peca.fornecedor_id) : null} />
      <div className="linha-campos l2">
        <Campo nome="documento" rotulo="Nota fiscal / documento" placeholder="Ex.: NF 000.044.892" />
        <Campo nome="data" rotulo="Data da entrada" tipo="date" valor={U.hoje()} attrs={{ max: U.hoje() }} />
      </div>
    </div>
    <Campo nome="obs" rotulo="Observação (opcional)" />
    <p className="sub" id="eTotal">{total ? <>Total: <b>{U.moeda(total)}</b></> : null}</p>
  </div>
}

// ---------------------------------------------------------------- detalhe / desfazer
export async function detalhe(id: string): Promise<void> {
  const m = S.get('movimentos', id); if (!m) return
  const p = S.get('pecas', m.peca_id)
  const desfeitoPor = S.lista('movimentos').find(x => x.estorno_de === m.id)
  const original = m.estorno_de ? S.get('movimentos', m.estorno_de) : null
  const precos = Perm.pode('precos')
  const ped = m.pedido_item_id ? S.get('pedidos_compra', S.get('pedido_itens', m.pedido_item_id)?.pedido_id) : null
  const podeDesfazer = !desfeitoPor && m.motivo !== 'estorno' &&
    (Perm.pode('entrada') || (m.criado_por === API.sessao?.uid && m.motivo === 'retirada' && Date.now() - new Date(m.criado_em).getTime() < 2 * 3600e3))
  await modal({
    titulo: (m.tipo === 'entrada' ? 'Entrada' : 'Saída') + ' — ' + (p?.codigo || ''),
    corpo: <>
      <p className="sub">{p?.descricao || ''}</p>
      <Dl pares={[
        ['Data', U.data(m.data)], ['Tipo', MOTIVO[m.motivo] || m.motivo], ['Quantidade', `${m.tipo === 'entrada' ? '+' : '−'}${U.qtd(m.qtd)} ${p?.unidade || ''}`],
        precos && ['Preço unitário', U.moeda(m.preco_unit)], precos && ['Total', U.moeda(m.qtd * m.preco_unit)],
        ['Documento / lote', m.documento || ''], Perm.pode('compras') && ['Fornecedor', S.get('fornecedores', m.fornecedor_id)?.nome || ''],
        ['Quem retirou', S.get('funcionarios', m.funcionario_id)?.nome || ''], ['Máquina', S.get('maquinas', m.maquina_id)?.nome || m.destino || ''],
        ['Manutenção', m.manutencao_id ? (S.get('manutencoes', m.manutencao_id)?.problema || '').slice(0, 80) : ''],
        ['Pedido de compra', ped ? <a href={'#/pedido/' + ped.id}>nº {ped.numero}</a> : ''],
        ['Observação', m.obs || ''], ['Lançado por', S.nomeUsuario(m.criado_por) || (m.motivo === 'importado' ? 'Importação da planilha' : '')],
        ['Lançado em', U.dataHora(m.criado_em)],
      ]} />
      {desfeitoPor && <p className="nota amarela mt">Desfeito em {U.dataHora(desfeitoPor.criado_em)} por {S.nomeUsuario(desfeitoPor.criado_por) || '—'}.</p>}
      {original && <p className="nota mt">Este lançamento desfez uma {original.tipo === 'entrada' ? 'entrada' : 'saída'} de {U.data(original.data)}.</p>}
      {!podeDesfazer && !desfeitoPor && m.motivo !== 'estorno' && !Perm.pode('entrada') && <p className="sub mt">Para corrigir, peça ao almoxarifado (você pode desfazer suas retiradas até 2 horas depois).</p>}
    </>,
    botoes: podeDesfazer ? [{ txt: 'Desfazer este lançamento', cls: 'perigo', icone: 'desfazer', acao: async () => {
      if (!(await confirmar('Desfazer este lançamento?', { detalhe: 'Fica registrado no histórico como "desfeito". O estoque volta ao que era.', ok: 'Desfazer', perigo: true }))) return false
      await API.rpc('estornar', { p_id: m.id, p_obs: null })
      await App.gravou(['pecas', 'movimentos', 'pedido_itens', 'pedidos_compra'])
      aviso('Lançamento desfeito.')
    } }] : [],
  })
}

// ---------------------------------------------------------------- histórico
export function TelaMovimentos() {
  const [periodo, setPeriodo] = useLembrar('mov.periodo', '30')
  const [tipo, setTipo] = useLembrar('mov.tipo', 'todos')
  const [busca, setBusca] = useLembrar('mov.busca', '')
  const [func, setFunc] = useLembrar('mov.func', '')
  const [maq, setMaq] = useLembrar('mov.maq', '')
  const producao = API.sessao?.perfil === 'producao'
  const precos = Perm.pode('precos')

  const hoje = U.hoje()
  const de = ({ hoje, '7': U.somaDias(hoje, -6), '30': U.somaDias(hoje, -29), ano: hoje.slice(0, 4) + '-01-01', tudo: '0000' } as Record<string, string>)[periodo] || '0000'
  const desf = desfeitos()
  let l = S.lista('movimentos').filter(m => m.data >= de)
  if (tipo === 'entradas') l = l.filter(m => m.tipo === 'entrada' && m.motivo !== 'estorno' && m.motivo !== 'ajuste')
  else if (tipo === 'saidas') l = l.filter(m => m.tipo === 'saida' && (m.motivo === 'retirada' || m.motivo === 'importado'))
  else if (tipo === 'ajustes') l = l.filter(m => m.motivo === 'ajuste')
  else if (tipo === 'desfeitos') l = l.filter(m => m.motivo === 'estorno' || desf.has(m.id))
  if (func) l = l.filter(m => m.funcionario_id === func)
  if (maq) l = l.filter(m => m.maquina_id === maq)
  if (busca.trim()) {
    const t = U.sem(busca.trim()).split(' ')
    l = l.filter(m => { const p = S.get('pecas', m.peca_id)
      const txt = U.sem([p?.codigo, p?.descricao, m.documento, m.obs, S.get('fornecedores', m.fornecedor_id)?.nome, S.get('funcionarios', m.funcionario_id)?.nome, S.get('maquinas', m.maquina_id)?.nome, m.destino].join(' '))
      return t.every(x => txt.includes(x)) })
  }
  l = l.slice().sort((a, b) => a.data < b.data ? 1 : a.data > b.data ? -1 : b.seq - a.seq)
  const vivos = l.filter(m => !desf.has(m.id) && m.motivo !== 'estorno')
  const ent = vivos.filter(m => m.tipo === 'entrada'), sai = vivos.filter(m => m.tipo === 'saida')

  return <>
    <Cab titulo="Movimentações" sub={producao ? 'Suas retiradas' : 'Tudo o que entrou e saiu do almoxarifado'}>
      <Btn txt="Retirar" icone="retirar" cls="pri" data-acao="retirar" onClick={() => void retirar()} />
      {Perm.pode('entrada') && <Btn txt="Dar entrada" icone="entrada" data-acao="entrada" onClick={() => void entrada()} />}
      {precos && <Btn txt="Excel" icone="baixar" data-h="excel" onClick={() => exportar(l)} />}
    </Cab>
    <div className="barra-filtros">
      <BuscaLista id="bHist" valor={busca} placeholder="Peça, nota, fornecedor, pessoa…" aoMudar={setBusca} />
      {!producao && <select id="hFunc" aria-label="Pessoa" value={func} onChange={(e) => setFunc(e.target.value)}><option value="">Todas as pessoas</option>
        {U.ordenar(S.lista('funcionarios'), f => U.sem(f.nome)).map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}</select>}
      <select id="hMaq" aria-label="Máquina" value={maq} onChange={(e) => setMaq(e.target.value)}><option value="">Todas as máquinas</option>
        {U.ordenar(S.lista('maquinas'), m => U.sem(m.nome)).map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}</select>
    </div>
    <Chips nome="per" atual={periodo} aoEscolher={setPeriodo} opcoes={[{ v: 'hoje', t: 'Hoje' }, { v: '7', t: '7 dias' }, { v: '30', t: '30 dias' }, { v: 'ano', t: 'Este ano' }, { v: 'tudo', t: 'Tudo' }]} />
    <div className="mt"><Chips nome="tp" atual={tipo} aoEscolher={setTipo} opcoes={[{ v: 'todos', t: 'Todos' }, { v: 'saidas', t: 'Retiradas' }, { v: 'entradas', t: 'Entradas' }, { v: 'ajustes', t: 'Ajustes' }, { v: 'desfeitos', t: 'Desfeitos' }]} /></div>
    <p className="sub mt" id="resHist">{U.plural(l.length, 'lançamento')} · entradas <b>{U.qtd(U.soma(ent, 'qtd'))}</b>{precos ? ` (${U.moeda0(U.soma(ent, m => m.qtd * m.preco_unit))})` : ''} · saídas <b>{U.qtd(U.soma(sai, 'qtd'))}</b>{precos ? ` (${U.moeda0(U.soma(sai, m => m.qtd * m.preco_unit))})` : ''}</p>
    <Paginado key={[periodo, tipo, busca, func, maq].join('|')} itens={l} passo={60} render={(m) => <LinhaMov key={m.id} m={m} desf={desf} />}
      vazio={<Vazio icone="historico" titulo="Nada neste período" texto="Escolha outro período ou tire os filtros." />} />
  </>
}

// mesmo formato da aba "Estoque" da planilha antiga
function exportar(lista: Movimento[]) {
  return excel(`Movimentações JAF ${U.hoje()}.xlsx`, [['Estoque', lista.slice().reverse().map(m => { const p = S.get('pecas', m.peca_id); const ent = m.tipo === 'entrada'
    return { 'Data': U.d(m.data), 'Código': p?.codigo, 'Descrição': p?.descricao, 'Entrada': ent ? m.qtd : null, 'Saída': ent ? null : m.qtd,
      'Saldo': ent ? m.qtd : -m.qtd, 'Fornecedor': S.get('fornecedores', m.fornecedor_id)?.nome || '', 'Documento': m.documento || '',
      'R$ Unitário': m.preco_unit, 'Total Entrada (R$)': ent ? U.r2(m.qtd * m.preco_unit) : 0, 'Total Saída (R$)': ent ? 0 : U.r2(m.qtd * m.preco_unit),
      'Saldo (R$)': U.r2((ent ? 1 : -1) * m.qtd * m.preco_unit), 'Ano': Number(m.data.slice(0, 4)), 'Mês': Number(m.data.slice(5, 7)),
      'Tipo': MOTIVO[m.motivo] || m.motivo, 'Quem retirou': S.get('funcionarios', m.funcionario_id)?.nome || '', 'Máquina': S.get('maquinas', m.maquina_id)?.nome || m.destino || '', 'Obs.': m.obs || '' } })]], true)
}
