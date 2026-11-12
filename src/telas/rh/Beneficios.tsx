/* Benefícios (VA, VR, VT, Wellhub…): o cadastro de cada benefício, quem recebe e quanto custa.
 * Desconto do funcionário: % do valor do benefício — ou, no VT, % do salário limitado ao valor do benefício (regra da lei).
 * Custo da empresa = valor − desconto. Os números entram sozinhos nos Indicadores (custo com benefícios do mês). */
import { useState } from 'react'
import { App } from '../../app/controle.tsx'
import { API } from '../../lib/api.ts'
import { S } from '../../lib/dados.ts'
import type { Funcionario, RhBeneficio, RhBeneficioVinculo } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { excel } from '../../ui/arquivos.tsx'
import { aviso, erro } from '../../ui/avisos.ts'
import { BuscaLista, Btn, Cab, Campo, Cols, Tag, Vazio } from '../../ui/base.tsx'
import { useLembrar } from '../../ui/ganchos.ts'
import { Ic } from '../../ui/icones.tsx'
import { confirmar, lerForm, modal } from '../../ui/janelas.tsx'
import { Barras } from '../Relatorios.tsx'
import { ativos, nomeF, pode } from './comum.tsx'

export const CATEGORIAS_BEN = ['Cesta básica / Alimentação', 'Alimentação', 'Transporte', 'Saúde / Bem-estar', 'Plano de saúde', 'Plano odontológico', 'Seguro de vida', 'Educação', 'Outros']

// ---------------------------------------------------------------- contas
const salario = (fid: string): number => Number(S.get('funcionarios_privado', fid)?.salario) || 0
export const vinculoAtivo = (v: RhBeneficioVinculo, dia = U.hoje()): boolean =>
  (!v.inicio || v.inicio <= dia) && (!v.fim || v.fim >= dia) && !!S.get('funcionarios', v.funcionario_id)?.ativo && !!S.get('rh_beneficios', v.beneficio_id)?.ativo
// no mês: vale quem estava com o benefício em algum dia do mês (sem olhar se a pessoa ainda está ativa hoje)
export const vinculoNoMes = (v: RhBeneficioVinculo, m: string): boolean => {
  const ini = m + '-01', fim = U.somaDias(U.somaMeses(ini, 1), -1), f = S.get('funcionarios', v.funcionario_id)
  if (!f || (f.admissao && f.admissao > fim) || (f.demissao && f.demissao < ini)) return false
  return (!v.inicio || v.inicio <= fim) && (!v.fim || v.fim >= ini)
}
export function contaBeneficio(b: RhBeneficio, v: Pick<RhBeneficioVinculo, 'valor' | 'desconto_pct' | 'funcionario_id'> | null): { valor: number; desconto: number; empresa: number; pct: number } {
  const valor = Number(v?.valor ?? b.valor) || 0
  const pct = Number(v?.desconto_pct ?? b.desconto_pct) || 0
  const desconto = U.r2(b.desconto_base === 'salario' ? Math.min(valor, (v ? salario(v.funcionario_id) : 0) * pct / 100) : valor * pct / 100)
  return { valor, desconto, empresa: U.r2(valor - desconto), pct }
}
// totais da empresa (hoje, ou de um mês AAAA-MM para os indicadores)
export function totaisBeneficios(mes?: string) {
  const vs = S.lista('rh_beneficio_vinculos').filter(v => mes ? vinculoNoMes(v, mes) && S.get('rh_beneficios', v.beneficio_id) : vinculoAtivo(v))
  let bruto = 0, desconto = 0
  const porCat = new Map<string, number>(), porBen = new Map<string, { n: number; bruto: number; desconto: number; empresa: number }>()
  for (const v of vs) {
    const b = S.get('rh_beneficios', v.beneficio_id)!; const c = contaBeneficio(b, v)
    bruto += c.valor; desconto += c.desconto
    porCat.set(b.categoria, (porCat.get(b.categoria) || 0) + c.empresa)
    const x = porBen.get(b.id) || { n: 0, bruto: 0, desconto: 0, empresa: 0 }
    x.n++; x.bruto += c.valor; x.desconto += c.desconto; x.empresa += c.empresa; porBen.set(b.id, x)
  }
  return { vinculos: vs.length, bruto: U.r2(bruto), desconto: U.r2(desconto), empresa: U.r2(bruto - desconto), porCat, porBen }
}
const descDesconto = (b: RhBeneficio) => b.desconto_pct ? `${U.dec(b.desconto_pct).replace(',00', '')}% ${b.desconto_base === 'salario' ? 'do salário (até o valor)' : 'do valor'}` : 'sem desconto'

// ---------------------------------------------------------------- tela
export function TelaBeneficios() {
  const [busca, setBusca] = useLembrar('ben.busca', '')
  const [cat, setCat] = useLembrar('ben.cat', '')
  const [forn, setForn] = useLembrar('ben.forn', '')
  const [inativos, setInativos] = useState(false)
  const todos = S.lista('rh_beneficios')
  const t = totaisBeneficios()
  let l = todos.filter(b => (inativos || b.ativo) && (!cat || b.categoria === cat) && (!forn || (b.fornecedor || '') === forn))
  l = busca.trim() ? U.buscar(l, busca, b => [b.nome, b.categoria, b.fornecedor || '']) : U.ordenar(l, b => (b.ativo ? '0' : '1') + U.sem(b.nome))
  const cats = U.unicos(todos.map(b => b.categoria)).sort(), forns = U.unicos(todos.map(b => b.fornecedor || '').filter(Boolean)).sort()
  const semValor = todos.filter(b => b.ativo && b.valor === null).length
  return <>
    <Cab titulo="Benefícios" sub="Cadastro, quem recebe, desconto do funcionário e custo da empresa">
      {pode() && <Btn txt="Novo benefício" icone="mais" cls="pri" data-ben="novo" onClick={() => void formBeneficio()} />}
      <Btn txt="Excel" icone="planilha" cls="fantasma" onClick={() => exportar()} />
    </Cab>
    <div className="grade g4" id="benKpis">
      <div className="kpi bom"><small>Custo líquido da empresa</small><b>{U.moeda(t.empresa)}</b><span>por mês</span></div>
      <div className="kpi"><small>Descontado dos funcionários</small><b>{U.moeda(t.desconto)}</b><span>de {U.moeda(t.bruto)} no total</span></div>
      <div className="kpi"><small>Benefícios ativos</small><b>{todos.filter(b => b.ativo).length}</b><span>{U.plural(todos.length, 'cadastrado')}</span></div>
      <div className="kpi"><small>Pessoas com benefício</small><b>{new Set(S.lista('rh_beneficio_vinculos').filter(v => vinculoAtivo(v)).map(v => v.funcionario_id)).size}</b><span>{U.plural(t.vinculos, 'vínculo')} ativo{t.vinculos === 1 ? '' : 's'}</span></div>
    </div>
    {semValor > 0 && <p className="nota amarela mt">{U.plural(semValor, 'benefício', 'benefícios')} sem valor: complete o valor mensal para o custo aparecer (toque no benefício).</p>}
    {t.porCat.size > 0 && <section className="card mt"><div className="card-cab"><h2>Custo da empresa por categoria</h2><span className="sub">por mês</span></div>
      <Barras itens={U.ordenar([...t.porCat].map(([k, v]) => ({ t: k, v })), x => -x.v)} fmt={U.moeda0} /></section>}
    <div className="barra-filtros mt"><BuscaLista id="bBen" valor={busca} placeholder="Nome, categoria ou fornecedor" aoMudar={setBusca} />
      <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoria" data-ben-cat="1"><option value="">Todas as categorias</option>{cats.map(c => <option key={c}>{c}</option>)}</select>
      <select value={forn} onChange={(e) => setForn(e.target.value)} aria-label="Fornecedor" data-ben-forn="1"><option value="">Todos os fornecedores</option>{forns.map(c => <option key={c}>{c}</option>)}</select>
      <label className="check"><input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> <span>Mostrar inativos</span></label></div>
    <div className="lista mt" id="lBen">{l.map(b => { const x = t.porBen.get(b.id)
      return <div key={b.id} className="linha clicavel cols" data-ben={b.nome} onClick={() => void verBeneficio(b.id)}>
        <div className="meio"><b>{b.nome}</b><small>{b.categoria}{b.fornecedor ? ' · ' + b.fornecedor : ''}</small></div>
        <Cols itens={[['Valor', b.valor !== null ? U.moeda(b.valor) : <span className="txt-amarelo">sem valor</span>], ['Desconto', descDesconto(b)], ['Pessoas', String(x?.n || 0)]]} />
        <div className="lado"><b>{U.moeda(x?.empresa || 0)}</b><small>custo/mês</small>{!b.ativo && <Tag s={{ txt: 'Inativo', cor: 'cinza' }} />}</div></div> })}
      {!l.length && <Vazio icone="dinheiro" titulo="Nenhum benefício aqui" texto={todos.length ? 'Troque o filtro.' : 'Cadastre o primeiro benefício.'} />}</div>
  </>
}

function exportar() {
  const vs = S.lista('rh_beneficio_vinculos').filter(v => vinculoAtivo(v))
  return excel(`Beneficios ${U.hoje()}.xlsx`, [
    ['Benefícios', S.lista('rh_beneficios').map(b => { const x = totaisBeneficios().porBen.get(b.id)
      return { Benefício: b.nome, Categoria: b.categoria, Fornecedor: b.fornecedor || '', 'Valor mensal': b.valor ?? '', 'Desconto %': b.desconto_pct, 'Desconto sobre': b.desconto_base === 'salario' ? 'Salário (até o valor)' : 'Valor do benefício',
        Ativo: b.ativo ? 'Sim' : 'Não', Pessoas: x?.n || 0, 'Total bruto': x?.bruto || 0, 'Descontado': x?.desconto || 0, 'Custo empresa': x?.empresa || 0 } })],
    ['Quem recebe', U.ordenar(vs, v => U.sem(nomeF(v.funcionario_id))).map(v => { const b = S.get('rh_beneficios', v.beneficio_id)!; const c = contaBeneficio(b, v)
      return { Pessoa: nomeF(v.funcionario_id), Benefício: b.nome, Valor: c.valor, 'Desconto %': c.pct, Desconto: c.desconto, 'Custo empresa': c.empresa, Início: v.inicio ? U.data(v.inicio) : '', Fim: v.fim ? U.data(v.fim) : '' } })],
  ])
}

// ---------------------------------------------------------------- benefício: cadastro
export async function formBeneficio(b: Partial<RhBeneficio> = {}): Promise<void> {
  const novo = !b.id
  await modal({
    titulo: novo ? 'Novo benefício' : 'Editar ' + b.nome,
    corpo: <CorpoBeneficio b={b} />,
    botoes: [{ txt: novo ? 'Cadastrar' : 'Salvar', acao: async (f) => {
      const d = lerForm(f)
      if (!f.dataset.envio) f.dataset.envio = b.id || U.uuid()
      await API.rpc('rh_salvar_beneficio', { p: { ...d, id: f.dataset.envio, ativo: novo ? true : d.ativo } })
      await App.gravou(['rh_beneficios']); aviso(novo ? 'Benefício cadastrado.' : 'Benefício salvo.'); return true
    } }],
  })
}
function CorpoBeneficio({ b }: { b: Partial<RhBeneficio> }) {
  const [valor, setValor] = useState<number | null>(b.valor ?? null)
  const [pct, setPct] = useState<number>(Number(b.desconto_pct) || 0)
  const [base, setBase] = useState(b.desconto_base || 'valor')
  const num = (s: string) => U.num(s)
  const desc = valor === null ? null : base === 'salario' ? null : U.r2(valor * pct / 100)
  return <>
    <Campo nome="nome" rotulo="Nome do benefício" req valor={b.nome} placeholder="Ex.: Vale refeição" foco />
    <div className="linha-campos l2"><Campo nome="categoria" rotulo="Categoria" req valor={b.categoria || 'Outros'} attrs={{ list: 'benCats' }} />
      <Campo nome="fornecedor" rotulo="Fornecedor" valor={b.fornecedor} placeholder="Nome da operadora do benefício" /></div>
    <datalist id="benCats">{U.unicos([...CATEGORIAS_BEN, ...S.lista('rh_beneficios').map(x => x.categoria)]).map(c => <option key={c} value={c} />)}</datalist>
    <div className="linha-campos l2"><Campo nome="valor" rotulo="Valor mensal por pessoa" tipo="dinheiro" valor={U.campoNum(b.valor)} attrs={{ onInput: (e: { currentTarget: HTMLInputElement }) => setValor(num(e.currentTarget.value)) }} ajuda="Em branco = ainda não definido" />
      <Campo nome="desconto_pct" rotulo="Desconto do funcionário (%)" tipo="num" valor={U.campoNum(b.desconto_pct ?? 0)} attrs={{ onInput: (e: { currentTarget: HTMLInputElement }) => setPct(num(e.currentTarget.value) || 0) }} /></div>
    <div className="campo"><label>O desconto é sobre</label><div className="opcoes">
      {([['valor', 'O valor do benefício', 'ex.: VR com 20% de desconto'], ['salario', 'O salário (até o valor do benefício)', 'ex.: VT — 6% do salário, nunca mais que o valor do VT']] as const).map(([v, t, d]) =>
        <label key={v} className="opcao"><input type="radio" name="desconto_base" value={v} checked={base === v} onChange={() => setBase(v)} /><span><b>{t}</b><small>{d}</small></span></label>)}</div></div>
    <p className="nota mt" id="benLiquido">{valor === null ? 'Sem valor: o custo aparece quando o valor for preenchido.' : desc !== null
      ? <>Por pessoa: <b>{U.moeda(valor)}</b> − desconto <b>{U.moeda(desc)}</b> = custo da empresa <b>{U.moeda(valor - desc)}</b></>
      : <>Por pessoa: <b>{U.moeda(valor)}</b> − {U.dec(pct)}% do salário de cada um (até {U.moeda(valor)}) = o custo da empresa sai pessoa a pessoa.</>}</p>
    <Campo nome="obs" rotulo="Observações" tipo="area" linhas={2} valor={b.obs} />
    {b.id && <Campo nome="ativo" rotulo="Benefício ativo" tipo="check" valor={b.ativo} />}
  </>
}

// ---------------------------------------------------------------- benefício: quem recebe
export async function verBeneficio(id: string): Promise<void> {
  const b = S.get('rh_beneficios', id); if (!b) return
  await modal({
    titulo: b.nome, largura: 'larga',
    corpo: <QuemRecebe id={id} />,
    botoes: pode() ? [
      { txt: 'Excluir', cls: 'perigo', validar: false, acao: async () => {
        const n = S.lista('rh_beneficio_vinculos').filter(v => v.beneficio_id === id).length
        if (!await confirmar(`Excluir o benefício ${b.nome}?`, { detalhe: n ? `${U.plural(n, 'pessoa deixa', 'pessoas deixam')} de ter este benefício. Para guardar o histórico, prefira desativar (Editar → Benefício ativo).` : 'Não dá para desfazer.', ok: 'Excluir', perigo: true })) return false
        await API.rpc('rh_excluir_beneficio', { p_id: id }); await App.gravou(['rh_beneficios', 'rh_beneficio_vinculos'], { inteira: ['rh_beneficio_vinculos'] }); aviso('Benefício excluído.'); return true
      } },
      { txt: 'Editar', cls: 'sec', validar: false, acao: async () => { void formBeneficio(b); return true } },
      { txt: 'Incluir pessoas', icone: 'mais', validar: false, acao: async () => { void incluirPessoas(b); return true } },
    ] : [],
  })
}
function QuemRecebe({ id }: { id: string }) {
  const b = S.get('rh_beneficios', id)!
  const vs = U.ordenar(S.lista('rh_beneficio_vinculos').filter(v => v.beneficio_id === id), v => (vinculoAtivo(v) ? '0' : '1') + U.sem(nomeF(v.funcionario_id)))
  const at = vs.filter(v => vinculoAtivo(v))
  const tot = at.reduce((a, v) => { const c = contaBeneficio(b, v); return { v: a.v + c.valor, d: a.d + c.desconto, e: a.e + c.empresa } }, { v: 0, d: 0, e: 0 })
  return <>
    <p className="sub">{b.categoria}{b.fornecedor ? ' · ' + b.fornecedor : ''} · {b.valor !== null ? U.moeda(b.valor) + ' por pessoa' : 'sem valor'} · desconto {descDesconto(b)}</p>
    <div className="grade g3"><div className="kpi"><small>Pessoas</small><b>{at.length}</b><span>com o benefício hoje</span></div>
      <div className="kpi"><small>Descontado</small><b>{U.moeda(tot.d)}</b><span>dos funcionários</span></div>
      <div className="kpi"><small>Custo da empresa</small><b>{U.moeda(tot.e)}</b><span>de {U.moeda(tot.v)}</span></div></div>
    {vs.length ? <div className="lista mt" id="lBenPessoas">{vs.map(v => { const c = contaBeneficio(b, v), ok = vinculoAtivo(v)
      return <div key={v.id} className={'linha' + (pode() ? ' clicavel' : '')} onClick={() => pode() && void formVinculo(S.get('funcionarios', v.funcionario_id)!, v)}>
        <div className="meio"><b>{nomeF(v.funcionario_id)}</b><small>{[v.inicio ? 'desde ' + U.dataCurta(v.inicio) : '', v.fim ? 'até ' + U.dataCurta(v.fim) : '', v.valor !== null ? 'valor próprio' : '', v.desconto_pct !== null ? 'desconto próprio' : ''].filter(Boolean).join(' · ')}</small></div>
        <div className="lado"><b>{U.moeda(c.empresa)}</b><small>desconto {U.moeda(c.desconto)}</small>{!ok && <Tag s={{ txt: 'Encerrado', cor: 'cinza' }} />}</div></div> })}</div>
      : <p className="sub mt">Ninguém com este benefício ainda. Use “Incluir pessoas”.</p>}
  </>
}
async function incluirPessoas(b: RhBeneficio): Promise<void> {
  const ja = new Set(S.lista('rh_beneficio_vinculos').filter(v => v.beneficio_id === b.id && vinculoAtivo(v)).map(v => v.funcionario_id))
  const livres = ativos().filter(f => !ja.has(f.id))
  if (!livres.length) { aviso('Todas as pessoas ativas já têm este benefício.'); return }
  await modal({
    titulo: 'Incluir pessoas em ' + b.nome, largura: 'larga',
    corpo: <><div className="linha-campos l2"><Campo nome="inicio" rotulo="A partir de" tipo="date" valor={U.hoje()} /><div /></div>
      <div className="campo"><label>Pessoas</label><MarcarTodos /><div className="escolher-pessoas" id="benEscolher">{livres.map(f => <label key={f.id} className="check"><input type="checkbox" name={'f_' + f.id} />
        <span>{f.nome}<small className="fraco"> · {f.funcao || f.setor || ''}{f.registro ? ' · ' + f.registro : ''}</small></span></label>)}</div></div></>,
    botoes: [{ txt: 'Incluir', acao: async (frm) => {
      const d = lerForm(frm), ids = Object.keys(d).filter(k => k.startsWith('f_') && d[k]).map(k => k.slice(2))
      if (!ids.length) throw new Error('Marque pelo menos uma pessoa')
      let n = 0
      try { for (const fid of ids) { await API.rpc('rh_salvar_vinculo', { p: { funcionario_id: fid, beneficio_id: b.id, inicio: d.inicio || null } }); n++ } }
      finally { if (n) { await App.gravou(['rh_beneficio_vinculos']); aviso(`${U.plural(n, 'pessoa incluída', 'pessoas incluídas')} em ${b.nome}.`) } }
      return true
    } }],
  })
}
function MarcarTodos() {
  return <button type="button" className="btn fantasma mini" onClick={(e) => { const cx = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLInputElement>('.escolher-pessoas input') || [])]; const todos = cx.every(x => x.checked); cx.forEach(x => { x.checked = !todos }) }}>Marcar / desmarcar todos</button>
}

// ---------------------------------------------------------------- na ficha da pessoa (Cargo e salário)
export function BeneficiosDaPessoa({ f }: { f: Funcionario }) {
  const vs = U.ordenar(S.lista('rh_beneficio_vinculos').filter(v => v.funcionario_id === f.id), v => (vinculoAtivo(v) ? '0' : '1') + (S.get('rh_beneficios', v.beneficio_id)?.nome || ''))
  const at = vs.filter(v => vinculoAtivo(v))
  const tot = at.reduce((a, v) => { const c = contaBeneficio(S.get('rh_beneficios', v.beneficio_id)!, v); return { d: a.d + c.desconto, e: a.e + c.empresa } }, { d: 0, e: 0 })
  return <section className="card mt" id="benPessoa"><div className="card-cab"><div><h2>Benefícios</h2>{at.length > 0 && <p className="sub">Desconto {U.moeda(tot.d)}/mês · custo da empresa {U.moeda(tot.e)}/mês</p>}</div>
    {pode() && f.ativo && <Btn txt="Incluir benefício" icone="mais" cls="sec mini" data-rh="beneficio" onClick={() => void formVinculo(f)} />}</div>
    {vs.length ? <div className="lista">{vs.map(v => { const b = S.get('rh_beneficios', v.beneficio_id); if (!b) return null; const c = contaBeneficio(b, v)
      return <div key={v.id} className={'linha' + (pode() ? ' clicavel' : '')} data-ben-vinc={b.nome} onClick={() => pode() && void formVinculo(f, v)}>
        <div className="meio"><b>{b.nome}</b><small>{b.categoria}{b.fornecedor ? ' · ' + b.fornecedor : ''}{v.inicio ? ' · desde ' + U.dataCurta(v.inicio) : ''}{v.fim ? ' · até ' + U.dataCurta(v.fim) : ''}</small></div>
        <Cols itens={[['Valor', U.moeda(c.valor)], ['Desconto', `${U.moeda(c.desconto)} (${U.dec(c.pct).replace(',00', '')}%)`]]} />
        <div className="lado"><b>{U.moeda(c.empresa)}</b><small>custo empresa</small>{!vinculoAtivo(v) && <Tag s={{ txt: 'Encerrado', cor: 'cinza' }} />}</div></div> })}</div>
      : <p className="sub">Nenhum benefício. {pode() && f.ativo ? 'Use “Incluir benefício”.' : ''}</p>}
  </section>
}

export async function formVinculo(f: Funcionario, v?: RhBeneficioVinculo): Promise<void> {
  const bens = U.ordenar(S.lista('rh_beneficios').filter(b => b.ativo || b.id === v?.beneficio_id), b => U.sem(b.nome))
  if (!bens.length) { aviso('Cadastre os benefícios antes (RH › Benefícios).', 'erro'); return }
  await modal({
    titulo: (v ? 'Benefício de ' : 'Incluir benefício para ') + f.nome.split(' ')[0],
    corpo: <CorpoVinculo f={f} v={v} />,
    botoes: [
      ...(v ? [{ txt: 'Tirar', cls: 'perigo', validar: false, acao: async () => {
        if (!await confirmar('Tirar este benefício da pessoa?', { detalhe: 'Para guardar o histórico, prefira preencher a data de fim.', ok: 'Tirar', perigo: true })) return false
        try { await API.rpc('rh_excluir_vinculo', { p_id: v.id }); await App.gravou(['rh_beneficio_vinculos'], { inteira: ['rh_beneficio_vinculos'] }); aviso('Benefício tirado.') } catch (e) { erro(e); return false }
        return true
      } }] : []),
      { txt: 'Salvar', acao: async (frm) => {
        const d = lerForm(frm)
        if (!frm.dataset.envio) frm.dataset.envio = v?.id || U.uuid()
        await API.rpc('rh_salvar_vinculo', { p: { ...d, id: frm.dataset.envio, funcionario_id: f.id } })
        await App.gravou(['rh_beneficio_vinculos']); aviso('Benefício salvo.'); return true
      } }],
  })
}
function CorpoVinculo({ f, v }: { f: Funcionario; v?: RhBeneficioVinculo }) {
  const bens = U.ordenar(S.lista('rh_beneficios').filter(b => b.ativo || b.id === v?.beneficio_id), b => U.sem(b.nome))
  const [bid, setBid] = useState(v?.beneficio_id || bens[0].id)
  const [valor, setValor] = useState<number | null>(v?.valor ?? null)
  const [pct, setPct] = useState<number | null>(v?.desconto_pct ?? null)
  const b = S.get('rh_beneficios', bid)!
  const c = contaBeneficio(b, { valor, desconto_pct: pct, funcionario_id: f.id })
  return <>
    <Campo nome="beneficio_id" rotulo="Benefício" tipo="select" req valor={bid} opcoes={bens.map(x => ({ v: x.id, t: `${x.nome} (${x.categoria})` }))} attrs={{ onChange: (e: { currentTarget: HTMLSelectElement }) => setBid(e.currentTarget.value), semBusca: true }} />
    <div className="linha-campos l2"><Campo nome="valor" rotulo="Valor para esta pessoa" tipo="dinheiro" valor={U.campoNum(v?.valor)} ajuda={`Em branco = ${b.valor !== null ? U.moeda(b.valor) : 'o do benefício'}`}
        attrs={{ onInput: (e: { currentTarget: HTMLInputElement }) => setValor(U.num(e.currentTarget.value)) }} />
      <Campo nome="desconto_pct" rotulo="Desconto (%)" tipo="num" valor={U.campoNum(v?.desconto_pct)} ajuda={`Em branco = ${U.dec(b.desconto_pct).replace(',00', '')}%`}
        attrs={{ onInput: (e: { currentTarget: HTMLInputElement }) => setPct(U.num(e.currentTarget.value)) }} /></div>
    <div className="linha-campos l2"><Campo nome="inicio" rotulo="Início" tipo="date" valor={v?.inicio || (v ? '' : U.hoje())} /><Campo nome="fim" rotulo="Fim" tipo="date" valor={v?.fim} ajuda="Em branco = continua" /></div>
    <p className="nota" id="vincConta"><Ic n="dinheiro" /> Valor {U.moeda(c.valor)} − desconto {U.moeda(c.desconto)}{b.desconto_base === 'salario' ? ` (${U.dec(c.pct).replace(',00', '')}% do salário, até o valor)` : ''} = <b>custo da empresa {U.moeda(c.empresa)}</b> por mês</p>
    <Campo nome="obs" rotulo="Observação" valor={v?.obs} />
  </>
}
