/* Programação de entregas do cliente (release).
 * O cliente manda um arquivo com tudo o que ainda quer receber e manda de novo quando muda (às vezes toda semana).
 * Em vez de lançar item por item: escolhe o arquivo → o sistema compara com os pedidos em aberto do cliente e mostra
 * o que é novo, o que mudou de quantidade e o que saiu → a pessoa confere e confirma. Fica guardado quando foi a
 * última atualização, quem fez e o que mudou; a última dá para desfazer. */
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { App } from '../../app/controle.tsx'
import { API, ErroApp } from '../../lib/api.ts'
import { S } from '../../lib/dados.ts'
import { Perm } from '../../lib/perm.ts'
import { dataDoNome, detectar, ErroRelease, exemplos, lerGrade, montar, type CampoRel, type Grade, type Leitura, type LinhaRel, type Mapa } from '../../lib/release.ts'
import type { Cliente, Release, ReleaseItem } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { excel } from '../../ui/arquivos.tsx'
import { aviso, erro } from '../../ui/avisos.ts'
import { Tag } from '../../ui/base.tsx'
import { ComboCliente, type ComboApi } from '../../ui/Combo.tsx'
import { Ic } from '../../ui/icones.tsx'
import { confirmar, lerForm, modal, useJanela } from '../../ui/janelas.tsx'

// ---------------------------------------------------------------- contas
// a última atualização que vale (não desfeita) de cada cliente
export function ultimasReleases(): Map<string, Release> {
  const m = new Map<string, Release>()
  for (const r of S.lista('vendas_releases')) {
    if (r.desfeito_em) continue
    const k = r.cliente_id || r.cliente_nome || ''
    const a = m.get(k)
    if (!a || r.criado_em > a.criado_em) m.set(k, r)
  }
  return m
}
// "terça-feira, 10/11/26 às 17:02"
export const quando = (ts: string | null | undefined): string => ts
  ? `${new Date(ts).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' })}, ${U.dataHora(ts).replace(', ', ' às ')}` : '—'
// há quantos dias foi (pelo dia de São Paulo)
export const diasDesde = (ts: string): number => U.dias(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(ts)), U.hoje())
export const resumoRelease = (r: Pick<Release, 'novos' | 'alterados' | 'sairam'>): string => {
  const p = [r.novos ? U.plural(r.novos, 'entrega nova', 'entregas novas') : '', r.alterados ? `${U.qtd(r.alterados)} com quantidade diferente` : '', r.sairam ? U.plural(r.sairam, 'saiu', 'saíram') : ''].filter(Boolean)
  return p.length ? p.join(' · ') : 'nada mudou'
}
const conhecidos = (): Set<string> => {
  const s = new Set<string>()
  for (const p of S.lista('produtos')) { if (p.classe !== 'peca') continue; s.add(p.codigo.toLowerCase()); if (p.codigo_cliente) s.add(p.codigo_cliente.toLowerCase()) }
  return s
}

const PERIODOS: [string, string][] = [['30', '1 mês'], ['60', '2 meses'], ['90', '3 meses'], ['120', '4 meses'], ['180', '6 meses'], ['365', '1 ano'], ['0', 'Tudo o que veio']]
const CAMPOS: [CampoRel, string, boolean][] = [['codigo', 'Código da peça', true], ['qtd', 'Quantidade', true], ['prazo', 'Data de entrega', true], ['pedido', 'Nº do pedido / contrato', false], ['descricao', 'Descrição', false]]

interface Est { grade: Grade | null; mapa: Mapa; leitura: Leitura | null }
interface ItemSim { venda_id: string; codigo: string | null; codigo_cliente: string | null; descricao: string | null; pedido: string | null; prazo: string; de: number; para: number; entregue?: number }
interface Sim { id: string; linhas: number; iguais: number; n_novos: number; n_alterados: number; n_sairam: number; novos: ItemSim[]; alterados: ItemSim[]; sairam: ItemSim[]; sem_cadastro: string[]; repetido?: boolean }
interface Envio { cliente_id: string; arquivo: string; data_ref: string; ate: string | null; qtd_saldo: boolean; layout: Record<string, unknown>; ultimas_nf: unknown[]; linhas: LinhaRel[] }

// ---------------------------------------------------------------- passo 1: o arquivo
export async function atualizarProgramacao(ini: { cliente_id?: string | null } = {}): Promise<void> {
  await S.garantir(['produtos', 'vendas', 'vendas_releases'])
  const est: Est = { grade: null, mapa: {}, leitura: null }
  await modal({
    titulo: 'Atualizar a programação do cliente', largura: 'larga',
    corpo: <Arquivo est={est} cliIni={S.get('clientes', ini.cliente_id)} />,
    botoes: [{ txt: 'Comparar com o sistema', icone: 'atualizar', acao: async (f) => {
      if (!est.grade || !est.leitura) throw new ErroApp('Escolha primeiro o arquivo que o cliente mandou.')
      const d = lerForm(f)
      if (!d.cliente_id) throw new ErroApp('Escolha o cliente desta programação.')
      if (!est.leitura.linhas.length) throw new ErroApp('Não consegui ler nenhuma entrega. Abra “Como o arquivo foi lido” e confira as colunas.')
      const ref = d.data_ref || U.hoje()
      const ate = d.periodo === '0' ? null : U.somaDias(ref, Number(d.periodo) || 120)
      const linhas = ate ? est.leitura.linhas.filter(x => x.prazo <= ate) : est.leitura.linhas
      if (!linhas.length) throw new ErroApp('Nenhuma entrega do arquivo cai no período escolhido. Aumente o período.')
      const envio: Envio = { cliente_id: d.cliente_id, arquivo: est.grade.nome, data_ref: ref, ate, qtd_saldo: d.qtd_saldo !== 'total',
        layout: { mapa: est.mapa, colunas: est.grade.colunas, periodo: d.periodo, qtd_saldo: d.qtd_saldo !== 'total' }, ultimas_nf: est.leitura.ultimas, linhas }
      const sim = await API.rpc<Sim>('importar_release', { p: { ...envio, simular: true } })
      setTimeout(() => void conferir(envio, sim, est.leitura!.linhas.length - linhas.length), 250)
      return true
    } }],
  })
}

function Arquivo({ est, cliIni }: { est: Est; cliIni: Cliente | null }) {
  const j = useJanela()
  const combo = useRef<ComboApi<Cliente>>(null)
  const [lendo, setLendo] = useState(false)
  const [, redesenhar] = useState(0)
  const [periodo, setPeriodo] = useState('120')
  const [ref, setRef] = useState(U.hoje())
  const [saldo, setSaldo] = useState('saldo')
  const cods = useMemo(conhecidos, [])
  const g = est.grade, l = est.leitura

  // a programação anterior do cliente diz como ler o arquivo dele (colunas, período)
  const usarAnterior = (cli: Cliente | null) => {
    if (!cli) return
    const ant = [...S.lista('vendas_releases')].filter(r => r.cliente_id === cli.id && r.layout).sort((a, b) => (a.criado_em < b.criado_em ? 1 : -1))[0]
    const lay = ant?.layout as { mapa?: Mapa; colunas?: number; periodo?: string; qtd_saldo?: boolean } | undefined
    if (!lay) return
    if (lay.periodo) setPeriodo(String(lay.periodo))
    if (lay.qtd_saldo === false) setSaldo('total')
    if (est.grade && lay.mapa && lay.colunas === est.grade.colunas) { est.mapa = lay.mapa; est.leitura = montar(est.grade, est.mapa, cods); redesenhar(x => x + 1) }
  }
  const ler = async (arq: File | undefined) => {
    if (!arq) return
    setLendo(true); j.erro('')
    try {
      const grade = await lerGrade(arq)
      est.grade = grade; est.mapa = detectar(grade, cods); est.leitura = montar(grade, est.mapa, cods)
      setRef(dataDoNome(arq.name) || U.hoje())
      // de quem é: o cliente da maioria das peças do arquivo
      let cli = combo.current?.valor() ? S.get('clientes', combo.current.valor()) : null
      if (!cli) {
        const cont = new Map<string, number>()
        const porCod = new Map<string, string>()
        for (const p of S.lista('produtos')) if (p.cliente_id) { porCod.set(p.codigo.toLowerCase(), p.cliente_id); if (p.codigo_cliente) porCod.set(p.codigo_cliente.toLowerCase(), p.cliente_id) }
        for (const c of new Set(est.leitura.linhas.map(x => x.codigo.toLowerCase()))) { const id = porCod.get(c); if (id) cont.set(id, (cont.get(id) || 0) + 1) }
        const [id, n] = [...cont].sort((a, b) => b[1] - a[1])[0] || []
        cli = id && n >= est.leitura.pecas * 0.5 ? S.get('clientes', id) : null
        if (cli) combo.current?.definir(cli)
      }
      usarAnterior(cli)
      redesenhar(x => x + 1)
    } catch (e) {
      est.grade = null; est.leitura = null
      if (e instanceof ErroRelease) j.erro(e.message); else erro(e)
    } finally { setLendo(false) }
  }
  const trocar = (campo: CampoRel, v: string) => {
    if (!est.grade) return
    const m = { ...est.mapa }
    if (v === '') delete m[campo]; else m[campo] = Number(v)
    est.mapa = m; est.leitura = montar(est.grade, m, cods); redesenhar(x => x + 1)
  }
  const ate = periodo === '0' ? null : U.somaDias(ref || U.hoje(), Number(periodo))
  const dentro = l ? (ate ? l.linhas.filter(x => x.prazo <= ate).length : l.linhas.length) : 0
  const falta = !!g && CAMPOS.some(([c, , obrig]) => obrig && est.mapa[c] === undefined)
  const ex = g ? exemplos(g) : []
  return <>
    <p>O cliente manda a programação (release) num arquivo e manda de novo quando muda. Escolha o arquivo: o sistema <b>compara com os pedidos em aberto</b> dele e mostra o que mudou <b>antes de gravar</b>.</p>
    <label className={'btn grande arquivo-nota ' + (g ? 'sec' : 'pri') + (lendo ? ' ocupado' : '')} data-rel="arquivo">
      <input type="file" accept=".txt,.csv,.xlsx,.xlsm,.xls,text/plain,text/csv" hidden onChange={(e) => { void ler(e.currentTarget.files?.[0]); e.currentTarget.value = '' }} />
      <Ic n="planilha" /><span>{lendo ? 'Lendo o arquivo…' : g ? 'Trocar o arquivo' : 'Escolher o arquivo do cliente'}</span>
    </label>
    {!g && <ul className="dicas mt">
      <li>Serve o arquivo do jeito que o cliente manda: <b>.TXT</b>, <b>.CSV</b> ou <b>Excel</b>. Não precisa arrumar nada antes.</li>
      <li>O sistema acha sozinho a coluna do código, da quantidade, da data e do pedido.</li>
      <li>Nada é gravado nesta etapa: primeiro você vê a comparação.</li>
    </ul>}
    {g && l && <div className={'nota mt ' + (l.linhas.length && !falta ? 'verde' : 'amarela')} id="relLido">
      <b>{g.nome}</b><br />{l.linhas.length
        ? <>{U.plural(l.linhas.length, 'entrega')} de {U.plural(l.pecas, 'peça')} · de {U.dataCurta(l.de)} a {U.dataCurta(l.ate)}{l.ignoradas ? ` · ${U.plural(l.ignoradas, 'linha incompleta ficou', 'linhas incompletas ficaram')} de fora` : ''}</>
        : 'Não consegui ler as entregas. Confira abaixo qual coluna é o quê.'}
    </div>}
    <fieldset className="secao mt"><legend>De quem é e até quando</legend>
      <ComboCliente ref={combo} id="relCli" nome="cliente_id" rotulo="Cliente" req placeholder="Nome do cliente" inicial={cliIni} aoEscolher={usarAnterior} />
      <div className="linha-campos l2">
        <div className="campo"><label htmlFor="relRef">Data da programação</label><input id="relRef" name="data_ref" type="date" value={ref} onChange={(e) => setRef(e.target.value)} required />
          <small>A data em que o cliente gerou o arquivo.</small></div>
        <div className="campo"><label htmlFor="relPer">Trazer as entregas dos próximos</label>
          <select id="relPer" name="periodo" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>{PERIODOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
          <small>{l ? <>Entram <b>{U.qtd(dentro)}</b> de {U.qtd(l.linhas.length)} entregas{ate ? ` (até ${U.dataCurta(ate)})` : ''}.</> : 'Na planilha, o costume é 4 meses.'}</small></div>
      </div>
    </fieldset>
    {g && <details className="rel-mapa" open={falta || !l?.linhas.length}><summary>Como o arquivo foi lido {falta ? <Tag s={{ txt: 'confira', cor: 'amarelo' }} /> : <Tag s={{ txt: 'automático', cor: 'verde' }} />}</summary>
      <div className="linha-campos l2 mt">
        {CAMPOS.map(([c, rot, obrig]) => <div className="campo" key={c}><label htmlFor={'relM_' + c}>{rot}{obrig && <> <i className="req">*</i></>}</label>
          <select id={'relM_' + c} data-rel-col={c} value={est.mapa[c] ?? ''} onChange={(e) => trocar(c, e.target.value)}>
            <option value="">{obrig ? 'Escolha a coluna' : 'Não tem no arquivo'}</option>
            {ex.map((e, n) => <option key={n} value={n}>Coluna {n + 1}{e ? ` — ex.: ${e.slice(0, 28)}` : ' (vazia)'}</option>)}
          </select></div>)}
        <div className="campo"><label htmlFor="relSaldo">A quantidade do arquivo é</label>
          <select id="relSaldo" name="qtd_saldo" value={saldo} onChange={(e) => setSaldo(e.target.value)}>
            <option value="saldo">O que ainda falta entregar (programação)</option><option value="total">O total do pedido</option></select></div>
      </div>
      {l && l.linhas.length > 0 && <div className="rolagem-x mt"><table className="tabela-fab"><thead><tr><th>Código</th><th>Pedido</th><th>Entrega</th><th className="n">Qtd</th><th className="so-largo">Descrição</th></tr></thead>
        <tbody>{l.linhas.slice(0, 4).map((x, n) => <tr key={n}><td className="mono">{x.codigo}</td><td>{x.pedido}</td><td>{U.dataCurta(x.prazo)}</td><td className="n">{U.qtd(x.qtd)}</td><td className="so-largo">{x.descricao}</td></tr>)}</tbody></table></div>}
    </details>}
    {!g && <input type="hidden" name="qtd_saldo" value={saldo} />}
  </>
}

// ---------------------------------------------------------------- passo 2: conferir o que muda e gravar
const linhaItem = (x: ItemSim | ReleaseItemVisto) => [x.codigo || x.codigo_cliente || '', x.codigo && x.codigo_cliente ? x.codigo_cliente : '', x.descricao || ''] as const
interface ReleaseItemVisto { codigo: string | null; codigo_cliente: string | null; descricao: string | null; pedido: string | null; prazo: string | null; de: number; para: number }

function Mudanca({ x, tipo, children }: { x: ReleaseItemVisto; tipo: 'novo' | 'alterado' | 'saiu'; children?: ReactNode }) {
  const [cod, codCli, desc] = linhaItem(x)
  const sobe = x.para > x.de
  return <div className="linha" data-rel-item={tipo}>{children}
    <div className="meio"><b><span className="mono">{cod}</span> · {U.dataCurta(x.prazo)}</b><small>{[desc, codCli, x.pedido ? 'pedido ' + x.pedido : ''].filter(Boolean).join(' · ')}</small></div>
    <div className="lado">{tipo === 'novo' ? <><b>{U.qtd(x.para)}</b><small>entra</small></>
      : tipo === 'saiu' ? <><b className="rel-de">{U.qtd(x.de)}</b><small>saldo</small></>
      : <><b><span className="rel-de">{U.qtd(x.de)}</span> → <span className={sobe ? 'rel-sobe' : 'rel-desce'}>{U.qtd(x.para)}</span></b><small>{sobe ? '+' : '−'}{U.qtd(Math.abs(x.para - x.de))}</small></>}</div></div>
}
const LIMITE = 150
function Bloco({ titulo, cor, itens, tipo, aberto, nota }: { titulo: string; cor: 'azul' | 'amarelo' | 'cinza'; itens: ReleaseItemVisto[]; tipo: 'novo' | 'alterado' | 'saiu'; aberto?: boolean; nota?: string }) {
  if (!itens.length) return null
  return <details className="rel-bloco" open={aberto} data-rel-bloco={tipo}><summary><Tag s={{ txt: String(itens.length), cor }} /> {titulo}</summary>
    {nota && <p className="peq">{nota}</p>}
    <div className="lista nec-lista">{itens.slice(0, LIMITE).map((x, n) => <Mudanca key={n} x={x} tipo={tipo} />)}</div>
    {itens.length > LIMITE && <p className="peq">… e mais {U.qtd(itens.length - LIMITE)}. Baixe em Excel para ver todos.</p>}
  </details>
}

const planilha = (nome: string, grupos: [string, ReleaseItemVisto[]][]) => excel(nome, grupos.filter(([, l]) => l.length).map(([aba, l]) => [aba, l.map(x => ({
  'Cód. JAF': x.codigo || '', 'Cód. cliente': x.codigo_cliente || '', Descrição: x.descricao || '', Pedido: x.pedido || '', Entrega: x.prazo ? U.data(x.prazo) : '', 'Saldo antes': x.de, 'Saldo agora': x.para, Diferença: U.r4(x.para - x.de) }))]))

async function conferir(envio: Envio, sim: Sim, fora: number): Promise<void> {
  const cli = S.get('clientes', envio.cliente_id)
  const nada = !sim.n_novos && !sim.n_alterados && !sim.n_sairam
  await modal({
    titulo: `Conferir: programação · ${cli?.nome || ''}`, largura: 'larga',
    corpo: <Conferir envio={envio} sim={sim} fora={fora} nada={nada} />,
    botoes: [
      ...(nada ? [] : [{ txt: 'Baixar em Excel', cls: 'sec', icone: 'planilha' as const, validar: false, acao: async () => {
        await planilha(`Programação ${cli?.nome || ''} - comparação.xlsx`, [['Entregas novas', sim.novos], ['Quantidade mudou', sim.alterados], ['Saíram', sim.sairam]]); return false } }]),
      { txt: nada ? 'Registrar que conferi' : 'Atualizar a programação', icone: 'ok', acao: async (f) => {
        const d = lerForm(f)
        const manter = sim.sairam.filter(x => !d['sai_' + x.venda_id]).map(x => x.venda_id)
        if (!f.dataset.envio) f.dataset.envio = U.uuid()
        const r = await API.rpc<Sim>('importar_release', { p: { ...envio, id: f.dataset.envio, manter, simular: false } })
        await App.gravou(['vendas', 'vendas_releases'])
        aviso(`${cli ? cli.nome + ': programação' : 'Programação'} atualizada — ${resumoRelease({ novos: r.n_novos, alterados: r.n_alterados, sairam: r.n_sairam })}.`,
          'ok', { acao: { txt: 'Ver', fn: () => void verRelease(r.id) }, tempo: 7000 })
        return true
      } }],
  })
}

function Conferir({ envio, sim, fora, nada }: { envio: Envio; sim: Sim; fora: number; nada: boolean }) {
  const [fechar, setFechar] = useState<Set<string>>(() => new Set(sim.sairam.map(x => x.venda_id)))
  const marcar = (id: string, on: boolean) => setFechar(s => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })
  return <div id="relConf">
    <p className="sub">Arquivo <b>{envio.arquivo}</b> · programação de {U.data(envio.data_ref)} · {U.plural(sim.linhas, 'entrega')}{envio.ate ? ` até ${U.dataCurta(envio.ate)}` : ''}{fora ? ` (${U.qtd(fora)} mais para a frente ficaram de fora)` : ''}</p>
    <div className="grade g4 mt">
      <div className="kpi" data-rel-kpi="novos"><small>Entregas novas</small><b>{U.qtd(sim.n_novos)}</b><span>entram agora</span></div>
      <div className="kpi" data-rel-kpi="alterados"><small>Quantidade mudou</small><b>{U.qtd(sim.n_alterados)}</b><span>serão acertadas</span></div>
      <div className="kpi" data-rel-kpi="sairam"><small>Saíram do arquivo</small><b>{U.qtd(sim.n_sairam)}</b><span>{fechar.size === sim.sairam.length ? 'serão fechadas' : `${U.qtd(fechar.size)} serão fechadas`}</span></div>
      <div className="kpi" data-rel-kpi="iguais"><small>Sem mudança</small><b>{U.qtd(sim.iguais)}</b><span>ficam como estão</span></div>
    </div>
    {nada && <p className="nota verde mt">A programação do arquivo está <b>igual</b> à do sistema: não há nada para mudar. Registre a conferência para ficar anotado que hoje ela foi conferida.</p>}
    {sim.sem_cadastro.length > 0 && <p className="nota amarela mt" id="relSemCad"><b>{U.plural(sim.sem_cadastro.length, 'peça sem cadastro', 'peças sem cadastro')}:</b> {sim.sem_cadastro.slice(0, 15).join(', ')}{sim.sem_cadastro.length > 15 ? '…' : ''}.
      Elas entram só com o código do cliente e ficam fora da conta de necessidade até o produto ser cadastrado (Produtos › Novo, com este código em “Código do cliente”).</p>}
    <Bloco titulo="Quantidade mudou" cor="amarelo" itens={sim.alterados} tipo="alterado" aberto />
    <Bloco titulo="Entregas novas" cor="azul" itens={sim.novos} tipo="novo" aberto={sim.novos.length <= 30} />
    {sim.sairam.length > 0 && <details className="rel-bloco" open data-rel-bloco="saiu"><summary><Tag s={{ txt: String(sim.sairam.length), cor: 'cinza' }} /> Estavam em aberto e não vieram no arquivo</summary>
      <p className="peq">O cliente tirou ou mudou a data (a data nova aparece em “Entregas novas”). Marcado = o saldo é fechado. <b>Se alguma já foi entregue</b> e só falta lançar, desmarque e registre a entrega depois.</p>
      <p><button type="button" className="btn fantasma mini" onClick={() => setFechar(new Set(fechar.size ? [] : sim.sairam.map(x => x.venda_id)))}>{fechar.size ? 'Desmarcar todos' : 'Marcar todos'}</button></p>
      <div className="lista nec-lista">{sim.sairam.map(x => <Mudanca key={x.venda_id} x={x} tipo="saiu">
        <input type="checkbox" className="nec-ck" name={'sai_' + x.venda_id} checked={fechar.has(x.venda_id)} onChange={(e) => marcar(x.venda_id, e.target.checked)} aria-label={'Fechar ' + (x.codigo || x.codigo_cliente || '')} /></Mudanca>)}</div>
    </details>}
    {!nada && <p className="peq mt">Dá para desfazer depois: em Pedidos de clientes, toque na programação do cliente › Desfazer.</p>}
  </div>
}

// ---------------------------------------------------------------- uma atualização já feita: o que mudou, quem fez, desfazer
export async function verRelease(id: string): Promise<void> {
  await S.garantir(['produtos', 'vendas', 'vendas_releases'])
  const r = S.get('vendas_releases', id); if (!r) return
  let itens: ReleaseItem[] = []
  try { itens = await API.lerOnde('vendas_release_itens', 'release_id', id) } catch (e) { erro(e); return }
  const ult = ultimasReleases().get(r.cliente_id || r.cliente_nome || '')
  const podeDesfazer = Perm.pode('vendas_editar') && !r.desfeito_em && ult?.id === r.id
  const visto = (t: ReleaseItem['tipo']): ReleaseItemVisto[] => U.ordenar(itens.filter(x => x.tipo === t), x => (x.prazo || '') + (x.codigo || ''))
    .map(x => ({ codigo: x.codigo, codigo_cliente: x.codigo_cliente, descricao: x.descricao, pedido: x.pedido, prazo: x.prazo, de: Number(x.saldo_antes) || 0, para: Number(x.saldo_depois) || 0 }))
  const grupos: [string, ReleaseItemVisto[]][] = [['Quantidade mudou', visto('alterado')], ['Entregas novas', visto('novo')], ['Saíram', visto('saiu')]]
  await modal({
    titulo: `Programação · ${r.cliente_nome || ''}`, largura: 'larga', fecharTxt: 'Fechar',
    corpo: <Detalhe r={r} grupos={grupos} />,
    botoes: [
      ...(itens.length ? [{ txt: 'Excel', cls: 'sec', icone: 'planilha' as const, validar: false, acao: async () => { await planilha(`Programação ${r.cliente_nome || ''} ${U.data(r.data_ref)}.xlsx`.replace(/\//g, '-'), grupos); return false } }] : []),
      ...(podeDesfazer ? [{ txt: 'Desfazer esta atualização', cls: 'perigo-txt', validar: false, acao: async () => {
        if (!await confirmar('Desfazer esta atualização da programação?', { detalhe: 'As quantidades voltam ao que eram e o que entrou novo sai (menos o que já tiver entrega ou OF).', ok: 'Desfazer', perigo: true })) return false
        const x = await API.rpc<{ desfeitos: number; ficaram: number }>('desfazer_release', { p_id: r.id })
        await App.gravou(['vendas', 'vendas_releases'], { inteira: ['vendas'] })
        aviso(`Atualização desfeita.${x.ficaram ? ` ${U.plural(x.ficaram, 'item ficou', 'itens ficaram')} porque já tinha entrega ou OF.` : ''}`)
        return true
      } }] : []),
    ],
  })
}

function Detalhe({ r, grupos }: { r: Release; grupos: [string, ReleaseItemVisto[]][] }) {
  const j = useJanela()
  const outras = U.ordenar(S.lista('vendas_releases').filter(x => x.id !== r.id && (x.cliente_id || x.cliente_nome) === (r.cliente_id || r.cliente_nome)), x => x.criado_em, true).slice(0, 8)
  // notas que o cliente diz ter recebido e que são mais novas que a última entrega lançada aqui
  const pend = useMemo(() => {
    const porCod = new Map<string, string>()
    for (const p of S.lista('produtos')) if (p.codigo_cliente) porCod.set(p.codigo_cliente.toLowerCase(), p.id)
    const ultima = new Map<string, string>()
    for (const v of S.lista('vendas')) if (v.produto_id && v.entregue_em && (v.cliente_id || v.cliente_nome) === (r.cliente_id || r.cliente_nome) && v.entregue_em > (ultima.get(v.produto_id) || '')) ultima.set(v.produto_id, v.entregue_em)
    return (r.ultimas_nf || []).map(n => { const pid = porCod.get(String(n.codigo).toLowerCase()); return { ...n, pid, aqui: pid ? ultima.get(pid) || '' : '' } })
      .filter(n => n.pid && n.data && n.data > n.aqui).sort((a, b) => (a.data! < b.data! ? 1 : -1))
  }, [r])
  const dias = diasDesde(r.criado_em)
  return <div id="relDet">
    {r.desfeito_em && <p className="nota amarela">Esta atualização foi <b>desfeita</b> em {U.dataHora(r.desfeito_em)}{r.desfeito_por ? ' por ' + r.desfeito_por : ''}.</p>}
    <p><b>Atualizada {quando(r.criado_em)}</b>{r.criado_nome ? ' por ' + r.criado_nome : ''}{dias > 0 ? ` (há ${U.plural(dias, 'dia')})` : ' (hoje)'}</p>
    <p className="sub">Arquivo {r.arquivo || '—'} · programação de {U.data(r.data_ref)} · {U.plural(r.linhas, 'entrega')}{r.ate ? ` até ${U.dataCurta(r.ate)}` : ''}</p>
    <div className="grade g4 mt">
      <div className="kpi"><small>Entregas novas</small><b>{U.qtd(r.novos)}</b></div><div className="kpi"><small>Quantidade mudou</small><b>{U.qtd(r.alterados)}</b></div>
      <div className="kpi"><small>Saíram</small><b>{U.qtd(r.sairam)}</b></div><div className="kpi"><small>Sem mudança</small><b>{U.qtd(r.iguais)}</b></div>
    </div>
    {r.sem_cadastro?.length > 0 && <p className="nota amarela mt"><b>Sem cadastro:</b> {r.sem_cadastro.slice(0, 20).join(', ')}{r.sem_cadastro.length > 20 ? '…' : ''}</p>}
    <Bloco titulo="Quantidade mudou" cor="amarelo" itens={grupos[0][1]} tipo="alterado" aberto />
    <Bloco titulo="Entregas novas" cor="azul" itens={grupos[1][1]} tipo="novo" aberto={grupos[1][1].length <= 20} />
    <Bloco titulo="Saíram da programação" cor="cinza" itens={grupos[2][1]} tipo="saiu" />
    {pend.length > 0 && <details className="rel-bloco" data-rel-bloco="nf"><summary><Tag s={{ txt: String(pend.length), cor: 'amarelo' }} /> Notas que o cliente já recebeu e não estão lançadas aqui</summary>
      <p className="peq">O arquivo traz a última nota que o cliente recebeu de cada peça. Nestas, a nota é mais nova que a última entrega registrada no sistema: confira se falta registrar a entrega.</p>
      <div className="lista nec-lista">{pend.slice(0, 60).map(n => { const p = S.get('produtos', n.pid)
        return <div className="linha" key={n.codigo}><div className="meio"><b className="mono">{p?.codigo || n.codigo}</b><small>{[p?.descricao, n.codigo].filter(Boolean).join(' · ')}</small></div>
          <div className="lado"><b>NF {n.nf}</b><small>{U.dataCurta(n.data)}{n.qtd ? ` · ${U.qtd(n.qtd)} pç` : ''}</small><small>{n.aqui ? 'aqui: ' + U.dataCurta(n.aqui) : 'sem entrega aqui'}</small></div></div> })}</div>
    </details>}
    {outras.length > 0 && <><h3 className="mt">Atualizações anteriores</h3>
      <div className="lista">{outras.map(x => <div key={x.id} className="linha clicavel" onClick={() => { j.fechar(null); setTimeout(() => void verRelease(x.id), 250) }}>
        <div className="meio"><b>{quando(x.criado_em)}</b><small>{[x.criado_nome, x.arquivo].filter(Boolean).join(' · ')}</small></div>
        <div className="lado"><small>{resumoRelease(x)}</small>{x.desfeito_em && <Tag s={{ txt: 'Desfeita', cor: 'cinza' }} />}</div></div>)}</div></>}
  </div>
}
