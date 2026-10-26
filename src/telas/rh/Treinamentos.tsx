/* RH — Treinamentos: matrizes (Plano de treinamentos e competências, Procedimentos SGQ, Versatilidade por setor),
 * plano do ano, reciclagens vencendo e metas de desenvolvimento por pessoa */
import { useEffect, useState } from 'react'
import { App } from '../../app/controle.tsx'
import { API, ErroApp } from '../../lib/api.ts'
import { S } from '../../lib/dados.ts'
import * as R from '../../lib/rh.ts'
import type { Cor, Funcionario, RhMatriz, RhMatrizItem, RhMeta, RhNivel, RhPlano, TipoMatriz } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { aviso } from '../../ui/avisos.ts'
import { excelLinhas } from '../../ui/arquivos.tsx'
import { Btn, Cab, Campo, Chips, Tag, Vazio, type OpcaoChip } from '../../ui/base.tsx'
import { useLembrar, type Rota } from '../../ui/ganchos.ts'
import { Ic } from '../../ui/icones.tsx'
import { confirmar, lerForm, modal } from '../../ui/janelas.tsx'
import { Anexos, LinhaPessoa, nomeF, opcoesPessoas, opcoesSetores, pode } from './comum.tsx'

export const TIPO_MATRIZ: Record<TipoMatriz, string> = { treinamento: 'Treinamentos e competências', procedimento: 'Procedimentos (SGQ)', versatilidade: 'Versatilidade' }
export const LEGENDA_PADRAO: Record<TipoMatriz, { nivel: number; txt: string }[]> = {
  treinamento: [{ nivel: 0, txt: 'Não requer' }, { nivel: 1, txt: 'Planejado' }, { nivel: 2, txt: 'Realizado' }],
  procedimento: [{ nivel: 0, txt: 'Não se aplica' }, { nivel: 1, txt: 'Em treinamento' }, { nivel: 2, txt: 'Treinado' }],
  versatilidade: [{ nivel: 1, txt: 'Em treinamento' }, { nivel: 2, txt: 'Opera' }, { nivel: 3, txt: 'Prepara e opera' }, { nivel: 4, txt: 'Prepara, opera e libera' }],
}
const legendaDe = (m: RhMatriz) => (m.legenda?.length ? m.legenda : LEGENDA_PADRAO[m.tipo]).slice().sort((a, b) => a.nivel - b.nivel)
// cor do nível: 0 cinza, o maior verde, o menor (acima de 0) amarelo, o meio azul
export function corNivel(m: RhMatriz, n: number): Cor {
  const pos = legendaDe(m).map(x => x.nivel).filter(x => x > 0)
  if (n <= 0) return 'cinza'
  if (n >= Math.max(...pos)) return 'verde'
  if (n <= Math.min(...pos)) return 'amarelo'
  return 'azul'
}
const txtNivel = (m: RhMatriz, n: number) => legendaDe(m).find(x => x.nivel === n)?.txt || String(n)
const itensDe = (mid: string) => S.lista('rh_matriz_itens').filter(i => i.matriz_id === mid && i.ativo).sort((a, b) => a.ordem - b.ordem)
const nivelDe = (item: string, fid: string) => S.lista('rh_matriz_niveis').find(n => n.item_id === item && n.funcionario_id === fid) || null
// quem aparece na matriz: quem já tem alguma marcação nela + quem é do setor dela
function pessoasDa(m: RhMatriz): Funcionario[] {
  const ids = new Set(itensDe(m.id).map(i => i.id))
  const com = new Set(S.lista('rh_matriz_niveis').filter(n => ids.has(n.item_id)).map(n => n.funcionario_id))
  return U.ordenar(S.lista('funcionarios').filter(f => f.ativo && (com.has(f.id) || (!!m.setor && f.setor === m.setor))), f => U.sem(f.nome))
}

export function TelaTreinamentos({ r }: { r: Rota }) {
  const [aba, setAba] = useLembrar('tr.aba', 'matrizes')
  useEffect(() => { const q = r.q.get('f'); if (q === 'reciclagem') setAba('reciclagem'); const a = r.q.get('aba'); if (a) setAba(a) }, [r.hash, r.q, setAba])
  const venc = reciclagens().filter(x => x.dias <= 30).length
  return <>
    <Cab titulo="Treinamentos" sub="Matrizes de competência, versatilidade, procedimentos e o plano do ano." />
    <nav className="abas-tela">{([['matrizes', 'Matrizes'], ['plano', 'Plano do ano'], ['reciclagem', 'Reciclagem' + (venc ? ` (${venc})` : '')], ['metas', 'Metas por pessoa']] as const).map(([k, t]) =>
      <button key={k} type="button" data-aba={k} className={aba === k ? 'on' : ''} onClick={() => setAba(k)}>{t}</button>)}</nav>
    {aba === 'matrizes' ? <Matrizes /> : aba === 'plano' ? <Plano /> : aba === 'reciclagem' ? <Reciclagem /> : <Metas />}
  </>
}

// ------------------------------------------------------------------ matrizes
function Matrizes() {
  const ORD: TipoMatriz[] = ['treinamento', 'versatilidade', 'procedimento']
  const ms = S.lista('rh_matrizes').filter(m => m.ativo).sort((a, b) => ORD.indexOf(a.tipo) - ORD.indexOf(b.tipo) || a.ordem - b.ordem || a.nome.localeCompare(b.nome))
  const [id, setId] = useLembrar('tr.matriz', '')
  const m = ms.find(x => x.id === id) || ms[0]
  if (!ms.length) return <Vazio icone="lista" titulo="Nenhuma matriz ainda" texto="Crie a matriz de treinamentos, de procedimentos ou de versatilidade de um setor.">{pode() && <Btn txt="Nova matriz" icone="mais" cls="pri" onClick={() => void formMatriz()} />}</Vazio>
  const grupos = U.agrupar(ms, x => x.tipo)
  return <>
    <div className="barra-filtros"><select aria-label="Matriz" id="selMatriz" value={m.id} onChange={(e) => setId(e.target.value)} className="sel-grande">
      {[...grupos.entries()].map(([t, l]) => <optgroup key={t} label={TIPO_MATRIZ[t]}>{l.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}</optgroup>)}</select>
      {pode() && <><Btn txt="Editar matriz" icone="lapis" data-tr="editar" onClick={() => void formMatriz(m)} /><Btn txt="Nova matriz" icone="mais" data-tr="nova" onClick={() => void formMatriz()} /></>}</div>
    <Grade m={m} />
  </>
}

function Grade({ m }: { m: RhMatriz }) {
  const itens = itensDe(m.id)
  const pessoas = pessoasDa(m)
  const leg = legendaDe(m)
  const max = Math.max(...leg.map(x => x.nivel))
  return <section className="card">
    <div className="card-cab"><div><h2>{m.nome}</h2><p className="sub">{[TIPO_MATRIZ[m.tipo], m.setor, m.gestor && 'Gestor: ' + m.gestor, m.aprovado_por && `Aprovado por ${m.aprovado_por}${m.aprovado_em ? ' em ' + U.data(m.aprovado_em) : ''}`].filter(Boolean).join(' · ')}</p></div>
      <div className="grupo-btn">{pode() && <Btn txt="Incluir pessoa" icone="mais" data-tr="incluir" onClick={() => void incluirPessoa(m)} />}
        <Btn txt="Planilha" icone="planilha" onClick={() => exportarMatriz(m)} /></div></div>
    {m.objetivo && <p className="sub">{m.objetivo}</p>}
    <div className="legenda">{leg.map(x => <span key={x.nivel}><i className={`nivel t-${corNivel(m, x.nivel)}`}>{x.nivel}</i> {x.txt}</span>)}</div>
    {!itens.length ? <p className="nota mt">Esta matriz ainda não tem colunas. Toque em <b>Editar matriz</b> e adicione os treinamentos / habilidades.</p>
      : !pessoas.length ? <p className="nota mt">Ninguém nesta matriz ainda. Toque em <b>Incluir pessoa</b>{m.setor ? ` (ou cadastre pessoas no setor ${m.setor})` : ''}.</p>
      : <div className="matriz-caixa mt"><table className="matriz" data-matriz={m.id}><thead><tr><th className="m-nome">Pessoa</th>{itens.map(i => <th key={i.id} title={i.nome}><span>{i.nome}{i.obrigatorio ? ' ★' : ''}</span></th>)}</tr></thead>
        <tbody>{pessoas.map(f => <tr key={f.id}><th className="m-nome"><a href={`#/funcionario/${f.id}?aba=treinos`}>{f.nome}</a><small>{f.funcao || ''}</small></th>
          {itens.map(i => { const n = nivelDe(i.id, f.id), v = n ? R.vencimentoTreino(n, i) : null, sem = R.semaforoData(v, U.hoje(), 30)
            return <td key={i.id}><button type="button" className={`nivel t-${n ? corNivel(m, n.nivel) : 'vazio'}${sem === 'vermelho' ? ' vencido' : sem === 'amarelo' ? ' vencendo' : ''}`} data-cel={`${f.id}|${i.id}`}
              title={`${f.nome} — ${i.nome}: ${n ? txtNivel(m, n.nivel) : 'sem marcação'}${n?.data ? ' em ' + U.data(n.data) : ''}${v ? ' · vence ' + U.data(v) : ''}`}
              disabled={!pode()} onClick={() => void formNivel(m, i, f)}>{n ? n.nivel : ''}</button></td> })}</tr>)}</tbody>
        <tfoot><tr><th className="m-nome">Com nível {txtNivel(m, max).toLowerCase()}</th>{itens.map(i => { const ok = pessoas.filter(f => (nivelDe(i.id, f.id)?.nivel ?? -1) >= max).length
          return <td key={i.id} className="num">{pessoas.length ? Math.round(ok / pessoas.length * 100) + '%' : ''}</td> })}</tr></tfoot></table></div>}
    <p className="sub mt">Toque num quadrado para marcar o nível, a data e anexar o certificado. ★ = obrigatório por lei. Borda vermelha = reciclagem vencida.</p>
  </section>
}

async function formNivel(m: RhMatriz, i: RhMatrizItem, f: Funcionario) {
  const n = nivelDe(i.id, f.id)
  const leg = legendaDe(m)
  await modal({
    titulo: i.nome,
    corpo: <><p className="sub"><b>{f.nome}</b> · {m.nome}</p>
      <div className="campo"><label>Nível</label><div className="opcoes niveis">{leg.map(x => <label key={x.nivel} className="opcao"><input type="radio" name="nivel" value={x.nivel} defaultChecked={n ? n.nivel === x.nivel : x === leg[leg.length - 1]} />
        <span><b><i className={`nivel t-${corNivel(m, x.nivel)}`}>{x.nivel}</i> {x.txt}</b></span></label>)}</div></div>
      <div className="linha-campos"><Campo nome="data" rotulo="Data do treinamento" tipo="date" valor={n?.data || U.hoje()} ajuda={i.validade_meses ? `Reciclagem a cada ${U.plural(i.validade_meses, 'mês', 'meses')}.` : ''} /><Campo nome="obs" rotulo="Observação" valor={n?.obs} /></div>
      {n && <Anexos tabela="rh_matriz_niveis" registro={n.id} titulo="Certificado / lista de presença" />}
      {!n && <p className="sub">Depois de salvar, abra de novo para anexar o certificado.</p>}</>,
    botoes: [...(n ? [{ txt: 'Tirar marcação', cls: 'perigo-txt', validar: false, acao: async () => {
      await API.rpc('rh_definir_nivel', { p: { item_id: i.id, funcionario_id: f.id, nivel: null } }); await App.gravou(['rh_matriz_niveis'], { inteira: ['rh_matriz_niveis'] })
    } }] : []), { txt: 'Salvar', acao: async (frm: HTMLFormElement) => {
      const d = lerForm(frm)
      await API.rpc('rh_definir_nivel', { p: { item_id: i.id, funcionario_id: f.id, nivel: Number(d.nivel), data: d.data || null, obs: d.obs } })
      await App.gravou(['rh_matriz_niveis'])
    } }],
  })
}

async function incluirPessoa(m: RhMatriz) {
  const ja = new Set(pessoasDa(m).map(f => f.id))
  const itens = itensDe(m.id)
  if (!itens.length) { aviso('Adicione as colunas da matriz primeiro (Editar matriz).', 'erro'); return }
  await modal({
    titulo: 'Incluir pessoa — ' + m.nome,
    corpo: <><Campo nome="fid" rotulo="Quem" tipo="select" req opcoes={opcoesPessoas('Escolha', S.lista('funcionarios').filter(f => f.ativo && !ja.has(f.id)).sort((a, b) => a.nome.localeCompare(b.nome)))} />
      <p className="sub">A pessoa entra com “{txtNivel(m, legendaDe(m)[0].nivel)}” na primeira coluna; depois é só tocar nos quadrados.</p></>,
    botoes: [{ txt: 'Incluir', acao: async (frm) => {
      const d = lerForm(frm)
      await API.rpc('rh_definir_nivel', { p: { item_id: itens[0].id, funcionario_id: d.fid, nivel: legendaDe(m)[0].nivel } })
      await App.gravou(['rh_matriz_niveis'])
    } }],
  })
}

// editar matriz: nome, tipo, legenda e colunas
interface ItemEd { id?: string; nome: string; carga_horaria: string; validade_meses: string; obrigatorio: boolean }
function EditorItens({ inicial, tipo0 }: { inicial: ItemEd[]; tipo0: TipoMatriz }) {
  const [itens, setItens] = useState<ItemEd[]>(inicial.length ? inicial : [{ nome: '', carga_horaria: '', validade_meses: '', obrigatorio: false }])
  const [tipo, setTipo] = useState(tipo0)
  const mud = (n: number, k: keyof ItemEd, v: string | boolean) => setItens(l => l.map((x, i) => i === n ? { ...x, [k]: v } : x))
  const mover = (n: number, d: number) => setItens(l => { const c = l.slice(); const [x] = c.splice(n, 1); c.splice(Math.max(0, Math.min(c.length, n + d)), 0, x); return c })
  return <>
    <input type="hidden" name="itens_json" value={JSON.stringify(itens.filter(x => x.nome.trim()))} />
    <div className="campo"><label>Tipo</label><div className="opcoes">{(Object.keys(TIPO_MATRIZ) as TipoMatriz[]).map(t => <label key={t} className="opcao"><input type="radio" name="tipo" value={t} checked={tipo === t} onChange={() => setTipo(t)} /><span><b>{TIPO_MATRIZ[t]}</b></span></label>)}</div></div>
    <input type="hidden" name="tipo_atual" value={tipo} />
    <h3 className="mt">Colunas ({tipo === 'versatilidade' ? 'máquinas / habilidades' : tipo === 'procedimento' ? 'procedimentos' : 'treinamentos'})</h3>
    <div className="itens-matriz">{itens.map((x, n) => <div key={n} className="item-matriz">
      <input aria-label="Nome" placeholder="Nome" value={x.nome} onChange={(e) => mud(n, 'nome', e.target.value)} />
      {tipo === 'treinamento' && <><input aria-label="Carga horária" placeholder="Horas" inputMode="decimal" value={x.carga_horaria} onChange={(e) => mud(n, 'carga_horaria', e.target.value)} />
        <input aria-label="Reciclagem (meses)" placeholder="Recicla (meses)" inputMode="numeric" value={x.validade_meses} onChange={(e) => mud(n, 'validade_meses', e.target.value)} />
        <label className="check"><input type="checkbox" checked={x.obrigatorio} onChange={(e) => mud(n, 'obrigatorio', e.target.checked)} /> <span>Lei</span></label></>}
      <span className="item-acoes"><button type="button" className="icone-btn mini" aria-label="Subir" onClick={() => mover(n, -1)} disabled={!n}><Ic n="voltar" cls="cima" /></button>
        <button type="button" className="icone-btn mini" aria-label="Tirar" onClick={() => setItens(l => l.filter((_, i) => i !== n))}><Ic n="x" /></button></span></div>)}</div>
    <button type="button" className="btn sec mini" data-tr="addItem" onClick={() => setItens(l => [...l, { nome: '', carga_horaria: '', validade_meses: '', obrigatorio: false }])}><Ic n="mais" /><span>Adicionar coluna</span></button>
    <p className="sub">Tirar uma coluna esconde ela da matriz, mas o que já foi marcado fica guardado.</p>
  </>
}
async function formMatriz(m?: RhMatriz) {
  const itens: ItemEd[] = m ? itensDe(m.id).map(i => ({ id: i.id, nome: i.nome, carga_horaria: U.campoNum(i.carga_horaria, 1), validade_meses: i.validade_meses ? String(i.validade_meses) : '', obrigatorio: i.obrigatorio })) : []
  const leg = m ? legendaDe(m) : null
  await modal({
    titulo: m ? 'Editar matriz' : 'Nova matriz', largura: 'larga',
    corpo: <>
      <div className="linha-campos"><Campo nome="nome" rotulo="Nome" valor={m?.nome} req placeholder="Ex.: Versatilidade — Produção Matriz" /><Campo nome="setor" rotulo="Setor (quem é dele aparece sozinho)" tipo="select" valor={m?.setor} opcoes={opcoesSetores()} /></div>
      <div className="linha-campos"><Campo nome="gestor" rotulo="Gestor / responsável" valor={m?.gestor} /><Campo nome="aprovado_por" rotulo="Aprovado por" valor={m?.aprovado_por} /><Campo nome="aprovado_em" rotulo="Atualizado em" tipo="date" valor={m?.aprovado_em} /></div>
      <Campo nome="objetivo" rotulo="Objetivo (opcional)" valor={m?.objetivo} />
      <EditorItens inicial={itens} tipo0={m?.tipo || 'treinamento'} />
      <Campo nome="legenda" rotulo="Legenda dos níveis (um por linha: número = texto)" tipo="area" linhas={4} valor={leg ? leg.map(x => `${x.nivel} = ${x.txt}`).join('\n') : ''} ajuda="Vazio = legenda padrão do tipo." />
    </>,
    botoes: [...(m ? [{ txt: 'Arquivar', cls: 'perigo-txt', validar: false, acao: async () => {
      if (!(await confirmar(`Arquivar a matriz “${m.nome}”?`, { detalhe: 'Some da lista; as marcações ficam guardadas.', ok: 'Arquivar', perigo: true }))) return false
      await API.rpc('rh_salvar_matriz', { p: { ...m, ativo: false } }); await App.gravou(['rh_matrizes'])
    } }] : []), { txt: 'Salvar', acao: async (frm: HTMLFormElement) => {
      const d = lerForm(frm)
      const its = JSON.parse(d.itens_json || '[]') as ItemEd[]
      const tipo = d.tipo_atual as TipoMatriz
      const legenda = String(d.legenda || '').split('\n').map(l => /^\s*(\d)\s*[=:-]\s*(.+)$/.exec(l)).filter((x): x is RegExpExecArray => !!x).map(x => ({ nivel: Number(x[1]), txt: x[2].trim() }))
      if (legenda.some(x => x.nivel > 4)) throw new ErroApp('Os níveis vão de 0 a 4.')
      const id = await API.rpc<string>('rh_salvar_matriz', { p: { id: m?.id, nome: d.nome, tipo, setor: d.setor, gestor: d.gestor, objetivo: d.objetivo, aprovado_por: d.aprovado_por, aprovado_em: d.aprovado_em || null,
        legenda: legenda.length ? legenda : LEGENDA_PADRAO[tipo], ordem: m?.ordem ?? 0,
        itens: its.map(x => ({ id: x.id, nome: x.nome, carga_horaria: U.num(x.carga_horaria), validade_meses: U.num(x.validade_meses), obrigatorio: x.obrigatorio })) } })
      await App.gravou(['rh_matrizes', 'rh_matriz_itens'], { inteira: ['rh_matriz_itens'] })
      aviso(m ? 'Matriz salva.' : 'Matriz criada.'); void id
    } }],
  })
}

async function exportarMatriz(m: RhMatriz) {
  const itens = itensDe(m.id), pessoas = pessoasDa(m)
  const linhas: unknown[][] = [[m.nome], [TIPO_MATRIZ[m.tipo] + (m.setor ? ' · ' + m.setor : '')], ['Legenda: ' + legendaDe(m).map(x => `${x.nivel} = ${x.txt}`).join(' · ')], [],
    ['Pessoa', 'Função', ...itens.map(i => i.nome)], ...pessoas.map(f => [f.nome, f.funcao || '', ...itens.map(i => nivelDe(i.id, f.id)?.nivel ?? '')])]
  await excelLinhas(`${m.nome}.xlsx`, 'Matriz', linhas)
}

// ------------------------------------------------------------------ plano do ano
const STATUS_PLANO: Record<RhPlano['status'], [string, Cor]> = { planejado: ['Planejado', 'azul'], realizado: ['Realizado', 'verde'], cancelado: ['Cancelado', 'cinza'] }
function Plano() {
  const [ano, setAno] = useLembrar('tr.ano', U.hoje().slice(0, 4))
  const l = U.ordenar(S.lista('rh_plano_treinos').filter(p => (p.data || '').startsWith(ano) || (!p.data && ano === U.hoje().slice(0, 4))), p => p.data || '9999')
  const anos = U.unicos([U.hoje().slice(0, 4), ...S.lista('rh_plano_treinos').map(p => (p.data || '').slice(0, 4)).filter(Boolean)]).sort()
  const porMes = U.agrupar(l, p => p.data ? p.data.slice(0, 7) : 'sem data')
  return <>
    <div className="barra-filtros"><select aria-label="Ano" value={ano} onChange={(e) => setAno(e.target.value)}>{anos.map(a => <option key={a}>{a}</option>)}</select>
      {pode() && <Btn txt="Novo treinamento no plano" icone="mais" cls="pri" data-tr="plano" onClick={() => void formPlano()} />}</div>
    {l.length ? [...porMes.entries()].map(([mes, ps]) => <section key={mes} className="mt"><h3>{mes === 'sem data' ? 'Sem data' : U.cap(U.nomeMes(Number(mes.slice(5))))}</h3>
      <div className="lista mt">{ps.map(p => <div key={p.id} className={`linha${pode() ? ' clicavel' : ''}`} onClick={() => pode() && void formPlano(p)}>
        <span className="sinal ent"><Ic n="calendario" /></span><div className="meio"><b>{p.treinamento}</b><small>{[p.data && U.data(p.data), p.modalidade, p.instituicao, p.matriz_id && S.get('rh_matrizes', p.matriz_id)?.nome].filter(Boolean).join(' · ')}</small></div>
        <div className="lado"><Tag s={{ txt: STATUS_PLANO[p.status][0], cor: STATUS_PLANO[p.status][1] }} /></div></div>)}</div></section>)
      : <Vazio icone="calendario" titulo={`Nada planejado para ${ano}`} texto="Monte o calendário de treinamentos do ano (data, presencial ou EAD, instituição)." />}
  </>
}
async function formPlano(p?: RhPlano) {
  await modal({
    titulo: p ? 'Treinamento do plano' : 'Novo treinamento no plano',
    corpo: <>
      <Campo nome="treinamento" rotulo="Treinamento" valor={p?.treinamento} req attrs={{ list: 'lTreinos' }} />
      <datalist id="lTreinos">{U.unicos(S.lista('rh_matriz_itens').map(i => i.nome)).map(x => <option key={x} value={x} />)}</datalist>
      <div className="linha-campos"><Campo nome="data" rotulo="Data" tipo="date" valor={p?.data} /><Campo nome="modalidade" rotulo="Modalidade" tipo="select" valor={p?.modalidade || 'Presencial'} opcoes={['Presencial', 'EAD', 'Interno', 'Externo'].map(x => ({ v: x, t: x }))} /></div>
      <div className="linha-campos"><Campo nome="instituicao" rotulo="Instituição / instrutor" valor={p?.instituicao} />
        <Campo nome="matriz_id" rotulo="Matriz" tipo="select" valor={p?.matriz_id} opcoes={[{ v: '', t: '—' }, ...S.lista('rh_matrizes').filter(m => m.ativo).map(m => ({ v: m.id, t: m.nome }))]} /></div>
      <Campo nome="status" rotulo="Situação" tipo="select" valor={p?.status || 'planejado'} opcoes={Object.entries(STATUS_PLANO).map(([v, [t]]) => ({ v, t }))} />
      <Campo nome="obs" rotulo="Observação" valor={p?.obs} />
    </>,
    botoes: [...(p ? [{ txt: 'Apagar', cls: 'perigo-txt', validar: false, acao: async () => {
      if (!(await confirmar('Apagar do plano?', { ok: 'Apagar', perigo: true }))) return false
      await API.rpc('rh_salvar_plano', { p: { id: p.id, excluir: true } }); await App.gravou(['rh_plano_treinos'], { inteira: ['rh_plano_treinos'] })
    } }] : []), { txt: 'Salvar', acao: async (frm: HTMLFormElement) => {
      const d = lerForm(frm)
      await API.rpc('rh_salvar_plano', { p: { ...d, id: p?.id, matriz_id: d.matriz_id || null, data: d.data || null } }); await App.gravou(['rh_plano_treinos'])
    } }],
  })
}

// ------------------------------------------------------------------ reciclagem
export function reciclagens() {
  const hoje = U.hoje()
  const at = new Set(S.lista('funcionarios').filter(f => f.ativo).map(f => f.id))
  return S.lista('rh_matriz_niveis').flatMap(n => {
    const it = S.get('rh_matriz_itens', n.item_id)
    if (!it?.ativo || !at.has(n.funcionario_id)) return []
    const v = R.vencimentoTreino(n, it)
    return v ? [{ n, it, v, dias: U.dias(hoje, v) }] : []
  }).sort((a, b) => a.dias - b.dias)
}
function Reciclagem() {
  const [f, setF] = useLembrar('tr.rec', '60')
  const todos = reciclagens()
  const l = f === 'todos' ? todos : todos.filter(x => x.dias <= Number(f))
  const chips: OpcaoChip[] = [{ v: '30', t: 'Vencidas e até 30 dias', n: todos.filter(x => x.dias <= 30).length }, { v: '60', t: 'Até 60 dias', n: todos.filter(x => x.dias <= 60).length }, { v: 'todos', t: 'Todas com validade', n: todos.length }]
  return <>
    <Chips atual={f} aoEscolher={setF} nome="rc" opcoes={chips} />
    <div className="lista mt">{l.length ? l.map(({ n, it, v, dias }) => { const p = S.get('funcionarios', n.funcionario_id)!; const m = S.get('rh_matrizes', it.matriz_id)
      return <LinhaPessoa key={n.id} f={p} href={`#/funcionario/${p.id}?aba=treinos`} sub={`${it.nome}${it.obrigatorio ? ' ★' : ''} · feito em ${U.data(n.data)}${m ? ' · ' + m.nome : ''}`}
        direita={<><span className={`tag t-${dias < 0 ? 'vermelho' : dias <= 30 ? 'vermelho' : dias <= 60 ? 'amarelo' : 'verde'}${dias <= 30 && it.obrigatorio ? ' pisca' : ''}`}>{dias < 0 ? 'Vencido' : dias <= 60 ? 'Vence ' + U.relativo(v) : 'Em dia'}</span><small>{U.data(v)}</small></>} /> })
      : <Vazio icone="ok" titulo="Nada para reciclar" texto="Treinamentos com validade (ex.: NR-12, empilhadeira) aparecem aqui antes de vencer. A validade se coloca na coluna da matriz." />}</div>
  </>
}

// ------------------------------------------------------------------ metas (plano de desenvolvimento)
const STATUS_META: Record<RhMeta['status'], [string, Cor]> = { andamento: ['Em andamento', 'azul'], concluido: ['Concluída', 'verde'], cancelado: ['Cancelada', 'cinza'] }
function Metas() {
  const [st, setSt] = useLembrar('tr.meta', 'andamento')
  const l = U.ordenar(S.lista('rh_metas').filter(x => !st || x.status === st), x => x.prazo || '9999')
  return <>
    <div className="barra-filtros"><Chips atual={st} aoEscolher={setSt} nome="ms" opcoes={[{ v: 'andamento', t: 'Em andamento' }, { v: 'concluido', t: 'Concluídas' }, { v: '', t: 'Todas' }]} />
      {pode() && <Btn txt="Nova meta" icone="mais" cls="pri" data-tr="meta" onClick={() => void formMeta()} />}</div>
    <div className="lista mt">{l.length ? l.map(x => <LinhaMeta key={x.id} x={x} mostrarNome />) : <Vazio icone="lista" titulo="Nenhuma meta" texto="Plano de desenvolvimento de cada pessoa: objetivo, ação e prazo." />}</div>
  </>
}
function LinhaMeta({ x, mostrarNome }: { x: RhMeta; mostrarNome?: boolean }) {
  const atras = x.status === 'andamento' && x.prazo && x.prazo < U.hoje()
  return <div className={`linha${pode() ? ' clicavel' : ''}`} onClick={() => pode() && void formMeta(x)}><div className="meio"><b>{mostrarNome ? nomeF(x.funcionario_id) + ' — ' : ''}{x.objetivo}</b>
    <small>{[x.acao, x.prazo && 'prazo ' + U.data(x.prazo)].filter(Boolean).join(' · ')}</small></div>
    <div className="lado"><Tag s={atras ? { txt: 'Atrasada', cor: 'vermelho' } : { txt: STATUS_META[x.status][0], cor: STATUS_META[x.status][1] }} /></div></div>
}
export async function formMeta(x?: RhMeta, f?: Funcionario) {
  await modal({
    titulo: x ? 'Meta' : 'Nova meta',
    corpo: <>
      {!x && !f && <Campo nome="funcionario_id" rotulo="Quem" tipo="select" req opcoes={opcoesPessoas()} />}
      <Campo nome="objetivo" rotulo="Objetivo" valor={x?.objetivo} req placeholder="Ex.: Operar o torno CNC sozinho" />
      <Campo nome="acao" rotulo="O que vai ser feito" tipo="area" linhas={2} valor={x?.acao} placeholder="Ex.: Acompanhar o preparador 2 semanas + curso SENAI" />
      <div className="linha-campos"><Campo nome="prazo" rotulo="Prazo" tipo="date" valor={x?.prazo} /><Campo nome="status" rotulo="Situação" tipo="select" valor={x?.status || 'andamento'} opcoes={Object.entries(STATUS_META).map(([v, [t]]) => ({ v, t }))} /></div>
    </>,
    botoes: [...(x ? [{ txt: 'Apagar', cls: 'perigo-txt', validar: false, acao: async () => {
      if (!(await confirmar('Apagar esta meta?', { ok: 'Apagar', perigo: true }))) return false
      await API.rpc('rh_salvar_meta', { p: { id: x.id, excluir: true } }); await App.gravou(['rh_metas'], { inteira: ['rh_metas'] })
    } }] : []), { txt: 'Salvar', acao: async (frm: HTMLFormElement) => {
      const d = lerForm(frm)
      await API.rpc('rh_salvar_meta', { p: { ...d, id: x?.id, funcionario_id: x?.funcionario_id || f?.id || d.funcionario_id, prazo: d.prazo || null } }); await App.gravou(['rh_metas'])
    } }],
  })
}

// ------------------------------------------------------------------ na ficha
export function TreinosDaPessoa({ f }: { f: Funcionario }) {
  const niveis = S.lista('rh_matriz_niveis').filter(n => n.funcionario_id === f.id)
  const porMatriz = U.agrupar(niveis.map(n => ({ n, it: S.get('rh_matriz_itens', n.item_id) })).filter((x): x is { n: RhNivel; it: RhMatrizItem } => !!x.it?.ativo), x => x.it.matriz_id)
  const metas = S.lista('rh_metas').filter(x => x.funcionario_id === f.id)
  return <>
    {porMatriz.size ? [...porMatriz.entries()].map(([mid, l]) => { const m = S.get('rh_matrizes', mid); if (!m) return null
      return <section key={mid} className="card mt"><div className="card-cab"><h2>{m.nome}</h2><span className="sub">{TIPO_MATRIZ[m.tipo]}</span></div>
        <div className="lista">{l.sort((a, b) => a.it.ordem - b.it.ordem).map(({ n, it }) => { const v = R.vencimentoTreino(n, it)
          return <div key={n.id} className={`linha${pode() ? ' clicavel' : ''}`} onClick={() => pode() && void formNivel(m, it, f)}><i className={`nivel t-${corNivel(m, n.nivel)}`}>{n.nivel}</i>
            <div className="meio"><b>{it.nome}{it.obrigatorio ? ' ★' : ''}</b><small>{txtNivel(m, n.nivel)}{n.data ? ' · ' + U.data(n.data) : ''}{v ? ' · vence ' + U.data(v) : ''}</small></div>
            <div className="lado">{v && <TagVenceTreino v={v} />}</div></div> })}</div></section> })
      : <section className="card"><p className="sub">Esta pessoa ainda não está em nenhuma matriz. Abra <a href="#/rh/treinamentos">Treinamentos</a> e use <b>Incluir pessoa</b>.</p></section>}
    <section className="card mt"><div className="card-cab"><h2>Metas de desenvolvimento</h2>{pode() && <Btn txt="Nova meta" icone="mais" cls="sec mini" onClick={() => void formMeta(undefined, f)} />}</div>
      {metas.length ? <div className="lista">{metas.map(x => <LinhaMeta key={x.id} x={x} />)}</div> : <p className="sub">Nenhuma meta.</p>}</section>
  </>
}
function TagVenceTreino({ v }: { v: string }) {
  const d = U.dias(U.hoje(), v)
  return <span className={`tag t-${d < 0 ? 'vermelho' : d <= 30 ? 'vermelho' : d <= 60 ? 'amarelo' : 'verde'}`}>{d < 0 ? 'Vencido' : d <= 60 ? 'Vence ' + U.relativo(v) : 'Em dia'}</span>
}
