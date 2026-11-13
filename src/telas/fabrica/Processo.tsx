/* Passo a passo (processo) de cada produto e os quadradinhos da OF.
   O passo a passo nasce sozinho da estrutura (peças fabricadas aqui + operação de cada uma);
   o Técnico / PCP completa uma vez por produto (ex.: pôr "Amassar", escolher a máquina) e toda OF nova já sai com ele. */
import { useEffect, useRef, useState } from 'react'
import { App } from '../../app/controle.tsx'
import { API, ErroApp } from '../../lib/api.ts'
import { C, S } from '../../lib/dados.ts'
import { Perm } from '../../lib/perm.ts'
import type { OF, PassoProcesso, Produto } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { aviso } from '../../ui/avisos.ts'
import { Btn, Tag } from '../../ui/base.tsx'
import { Ic } from '../../ui/icones.tsx'
import { confirmar, modal } from '../../ui/janelas.tsx'

// a mesma regra do banco (_passos_de): primeiro as peças fabricadas aqui, depois a operação do próprio produto
export function passosSugeridos(prodId: string, nivel = 0): PassoProcesso[] {
  const pr = S.get('produtos', prodId)
  if (!pr) return []
  if (nivel > 0 && pr.processo?.length) return pr.processo.map(x => ({ operacao: x.operacao, peca: x.peca || pr.descricao, maquina_id: x.maquina_id || null }))
  const v: PassoProcesso[] = []
  if (nivel < 4) {
    for (const e of C.componentes(prodId)) {
      const f = S.get('produtos', e.filho_id)
      if (!f || f.classe !== 'peca' || C.comprado(f)) continue
      if (f.mp_codigo || C.componentes(f.id).length) v.push(...passosSugeridos(f.id, nivel + 1))
    }
  }
  if (pr.operacao?.trim()) v.push({ operacao: pr.operacao.trim(), peca: nivel > 0 ? pr.descricao : null, maquina_id: null })
  return v
}
export const passosDoProduto = (p: Produto): { passos: PassoProcesso[]; auto: boolean } =>
  p.processo?.length ? { passos: p.processo, auto: false } : { passos: passosSugeridos(p.id), auto: true }
const nomeMaq = (id: string | null | undefined): string => { const m = S.get('maquinas', id); return m ? C.nomeMaquina(m) : '' }

/* Qual máquina faz cada passo. As planilhas da JAF só têm a OPERAÇÃO (ex.: "Cortar Blank Conforme Desenho");
   a máquina sai do verbo, com os nomes da lista de máquinas da Preventiva (Serra, Torno, Solda…).
   É sugestão: o PCP / Técnico confirma escolhendo a máquina certa no passo a passo do produto. */
const TIPOS_MAQ: { tipo: string; op: RegExp; maq: RegExp | null }[] = [
  { tipo: 'Serviço externo', op: /servi[cç]o externo|tratam|zinc|galvan|cromad|laser/i, maq: null },
  { tipo: 'Serra', op: /\b(cort|serr)/i, maq: /serra|policorte/i },
  { tipo: 'Escareadora', op: /escare/i, maq: /escarea/i },
  { tipo: 'Inspeção', op: /inspe[cç]|inspecion/i, maq: null },
  { tipo: 'Embalagem', op: /embal/i, maq: null },
  { tipo: 'Curvadora', op: /curv/i, maq: /curvadora/i },
  { tipo: 'Prensa', op: /prens|estamp|amass|recort|conformar|crav|dobr|reduz/i, maq: /prensa/i },
  { tipo: 'Fresadora', op: /fres/i, maq: /fresadora/i },
  { tipo: 'Torno', op: /usin|torne|facea|chanfr/i, maq: /torno/i },
  { tipo: 'Furadeira', op: /fur[aoe]|calibr/i, maq: /furadeira|furad\./i },
  { tipo: 'Rosqueadeira', op: /rosc|rosq/i, maq: /rosqueadeira/i },
  { tipo: 'Solda', op: /sold/i, maq: /solda/i },
  { tipo: 'Lixadeira', op: /\blix|polir|polim|rebarb/i, maq: /lixadeira|politriz/i },
  { tipo: 'Pintura', op: /pint/i, maq: /estufa|pintura/i },
  { tipo: 'Montagem', op: /mont/i, maq: null },
]
// tipos na ordem em que aparecem no texto (ex.: "Montar e Soldar" → Montagem → Solda)
export function tiposDaOperacao(op: string | null | undefined): { tipo: string; maq: RegExp | null }[] {
  const t = op || ''
  const l = TIPOS_MAQ.map(x => ({ x, i: t.search(x.op) })).filter(y => y.i >= 0).sort((a, b) => a.i - b.i).map(y => y.x)
  return l.some(x => x.tipo === 'Serviço externo') ? l.filter(x => x.tipo === 'Serviço externo') : l   // feito fora: nenhuma máquina daqui
}
export const maquinaSugerida = (op: string | null | undefined): string => tiposDaOperacao(op).map(x => x.tipo).join(' → ')
// texto da máquina do passo: a escolhida ou a sugerida
export const maqDoPasso = (x: { maquina_id?: string | null; maquina?: string | null; operacao: string }): { txt: string; sug: boolean } => {
  const m = x.maquina || nomeMaq(x.maquina_id)
  if (m) return { txt: m, sug: false }
  const s = maquinaSugerida(x.operacao)
  return { txt: s, sug: !!s }
}
const TxtMaq = ({ x }: { x: { maquina_id?: string | null; maquina?: string | null; operacao: string } }) => {
  const m = maqDoPasso(x)
  return m.txt ? <span className={'maq' + (m.sug ? ' sug' : '')} title={m.sug ? 'Sugerida pela operação — confirme no passo a passo do produto' : undefined}><Ic n="maquina" />{m.txt}{m.sug ? ' (sugerida)' : ''}</span> : null
}

// ---------------------------------------------------------------- no cadastro do produto
export function SecaoProcesso({ p }: { p: Produto }) {
  const { passos, auto } = passosDoProduto(p)
  const pode = Perm.pode('produtos_editar')
  return <section className="card mt" id="secProcesso"><div className="card-cab"><h2>Passo a passo (processo)</h2>
    {passos.length > 0 && <Tag s={auto ? { txt: 'Montado pela estrutura', cor: 'cinza' } : { txt: 'Conferido', cor: 'verde' }} />}
    {pode && <Btn txt={auto ? 'Completar' : 'Editar'} icone="lapis" cls="fantasma mini" data-proc="editar" onClick={() => editarProcesso(p)} />}</div>
    {passos.length ? <ol className="passos">{passos.map((x, i) => <li key={i}><span><b>{x.operacao}</b>{x.peca && <small>{x.peca}</small>}<TxtMaq x={x} /></span></li>)}</ol>
      : <p className="sub">Ainda sem passo a passo.{pode ? ' Toque em Completar e escreva os passos (serrar, amassar, soldar…).' : ''}</p>}
    {auto && passos.length > 0 && <p className="peq">Montado sozinho pela estrutura e pela operação de cada peça (como no Cad. Componentes / Cad. Conjuntos). A máquina é sugerida pela operação. {pode ? 'Confira, ponha o que falta (ex.: amassar) e escolha as máquinas.' : ''}</p>}
    <p className="peq">Toda OF nova deste código sai com estes passos e os quadradinhos para marcar.</p>
  </section>
}

interface LinhaP { k: number; operacao: string; peca: string; maquina_id: string }
let kP = 0
const linhaP = (x?: PassoProcesso): LinhaP => ({ k: ++kP, operacao: x?.operacao || '', peca: x?.peca || '', maquina_id: x?.maquina_id || '' })

export async function editarProcesso(p: Produto): Promise<void> {
  await S.garantir(['produtos', 'produto_estrutura'])
  const { passos, auto } = passosDoProduto(p)
  const ler = (f: HTMLElement): PassoProcesso[] => [...f.querySelectorAll<HTMLElement>('.passo-ed')].map(r => ({
    operacao: U.limpa(r.querySelector<HTMLInputElement>('[name=op]')!.value), peca: U.limpa(r.querySelector<HTMLInputElement>('[name=pc]')!.value) || null,
    maquina_id: r.querySelector<HTMLSelectElement>('[name=mq]')!.value || null })).filter(x => x.operacao || x.peca || x.maquina_id)
  const gravar = async (lista: PassoProcesso[]) => {
    await API.rpc('salvar_processo', { p: { produto_id: p.id, passos: lista } })
    await App.gravou(['produtos'])
  }
  await modal({
    titulo: `Passo a passo — ${p.codigo}`, largura: 'larga',
    corpo: <EditorPassos ini={passos} auto={auto} />,
    botoes: [
      ...(!auto ? [{ txt: 'Voltar ao automático', cls: 'fantasma', icone: 'desfazer' as const, acao: async () => {
        if (!(await confirmar('Apagar o passo a passo conferido e voltar a montar pela estrutura?', { ok: 'Sim, voltar ao automático' }))) return false
        await gravar([]); aviso('Passo a passo volta a ser montado pela estrutura.')
      } }] : []),
      { txt: 'Salvar passo a passo', icone: 'ok', acao: async (f) => {
        const l = ler(f)
        const sem = l.findIndex(x => !x.operacao)
        if (sem >= 0) throw new ErroApp(`Escreva o que se faz no passo ${sem + 1}.`)
        if (!l.length) throw new ErroApp('Coloque pelo menos um passo (ou use “Voltar ao automático”).')
        await gravar(l); aviso('Passo a passo salvo. As próximas OFs já saem com ele.')
      } }],
  })
}

function EditorPassos({ ini, auto }: { ini: PassoProcesso[]; auto: boolean }) {
  const [ls, setLs] = useState<LinhaP[]>(() => ini.length ? ini.map(linhaP) : [linhaP()])
  const focar = useRef<number | null>(null)
  useEffect(() => { if (focar.current) { document.querySelector<HTMLInputElement>(`.passo-ed[data-k="${focar.current}"] [name=op]`)?.focus(); focar.current = null } })
  const maqs = U.ordenar(S.lista('maquinas').filter(m => m.ativo), m => C.nomeMaquina(m))
  const mudar = (k: number, m: Partial<LinhaP>) => setLs(l => l.map(x => x.k === k ? { ...x, ...m } : x))
  const mover = (i: number, d: number) => setLs(l => { const c = [...l]; const j = i + d; if (j < 0 || j >= c.length) return l; [c[i], c[j]] = [c[j], c[i]]; return c })
  return <>
    <p className="sub">{auto ? 'Estes passos foram montados pela estrutura. Confira, ponha o que falta e escolha a máquina de cada um.' : 'Na ordem em que a peça é feita.'} Ex.: Serrar, Amassar, Furar, Soldar, Polir.</p>
    <datalist id="lOper">{U.unicos(['Serrar', 'Cortar', 'Amassar', 'Dobrar', 'Curvar', 'Furar', 'Rosquear', 'Tornear', 'Soldar', 'Lixar', 'Polir', 'Montar', 'Embalar',
      ...S.lista('produtos').map(x => x.operacao || '').filter(Boolean)]).slice(0, 80).map(o => <option key={o} value={o} />)}</datalist>
    <div className="passos-ed" id="procEd">{ls.map((x, i) => <div key={x.k} className="passo-ed" data-k={x.k}>
      <span className="pn">{i + 1}</span>
      <div className="campo"><label>O que fazer</label><input name="op" list="lOper" value={x.operacao} maxLength={200} placeholder="Ex.: Amassar ponta" onChange={(e) => mudar(x.k, { operacao: e.target.value })} /></div>
      <div className="campo"><label>Peça</label><input name="pc" value={x.peca} maxLength={120} placeholder="(o próprio produto)" onChange={(e) => mudar(x.k, { peca: e.target.value })} /></div>
      <div className="campo"><label>Máquina</label><SelMaq x={x} maqs={maqs} aoMudar={(v) => mudar(x.k, { maquina_id: v })} /></div>
      <div className="pbtn">
        <button type="button" className="icone-btn" aria-label="Subir" disabled={i === 0} onClick={() => mover(i, -1)}><Ic n="seta" /></button>
        <button type="button" className="icone-btn desce" aria-label="Descer" disabled={i === ls.length - 1} onClick={() => mover(i, 1)}><Ic n="seta" /></button>
        <button type="button" className="icone-btn" aria-label="Tirar o passo" onClick={() => setLs(l => { const r = l.filter(y => y.k !== x.k); return r.length ? r : [linhaP()] })}><Ic n="lixo" /></button>
      </div></div>)}</div>
    <button type="button" className="btn sec mini mt" data-add-passo onClick={() => { const n = linhaP(); focar.current = n.k; setLs(l => [...l, n]) }}><Ic n="mais" /><span>Adicionar passo</span></button>
  </>
}

function SelMaq({ x, maqs, aoMudar }: { x: LinhaP; maqs: ReturnType<typeof S.lista<'maquinas'>>; aoMudar: (v: string) => void }) {
  const tipos = tiposDaOperacao(x.operacao).filter(t => t.maq)
  const sug = maqs.filter(m => tipos.some(t => t.maq!.test(m.nome)))
  const resto = maqs.filter(m => !sug.includes(m))
  const s = maquinaSugerida(x.operacao)
  return <select name="mq" value={x.maquina_id} onChange={(e) => aoMudar(e.target.value)}>
    <option value="">{s ? `— (sugerida: ${s})` : '—'}</option>
    {sug.length > 0 && <optgroup label={'Para ' + tipos.map(t => t.tipo.toLowerCase()).join(' e ')}>{sug.map(m => <option key={m.id} value={m.id}>{C.nomeMaquina(m)}</option>)}</optgroup>}
    <optgroup label={sug.length ? 'Outras máquinas' : 'Máquinas'}>{resto.map(m => <option key={m.id} value={m.id}>{C.nomeMaquina(m)}</option>)}</optgroup>
  </select>
}

// ---------------------------------------------------------------- na OF: os quadradinhos
export function PassosOF({ o }: { o: OF }) {
  const [ocup, setOcup] = useState<number | null>(null)
  const passos = o.passos || []
  const aberta = o.status === 'aberta'
  const marca = Perm.pode('of_passos') && aberta
  const feitos = passos.filter(x => x.feito).length
  // OF ligada (conjunto ↔ componente): o banco marca o mesmo passo nas duas
  const pai = o.pai_id ? S.get('ofs', o.pai_id) : null
  const filhas = S.lista('ofs').filter(x => x.pai_id === o.id && x.status === 'aberta')
  const ligadas = [pai && pai.status === 'aberta' ? `na OF ${pai.numero} do conjunto` : '',
    filhas.length === 1 ? `na OF ${filhas[0].numero} do componente` : filhas.length > 1 ? 'nas OFs dos componentes' : ''].filter(Boolean).join(' e ')
  const marcar = async (n: number, feito: boolean) => {
    setOcup(n)
    try { await API.rpc('marcar_passo_of', { p: { id: o.id, n, feito } }); await App.gravou(['ofs']) } finally { setOcup(null) }
  }
  const refazer = async () => {
    await API.rpc('refazer_passos_of', { p_id: o.id }); await App.gravou(['ofs']); aviso('Passo a passo atualizado pelo cadastro do produto.')
  }
  const podeRefazer = aberta && Perm.pode('of_emitir') && !feitos
  return <section className="card mt" id="ofPassos"><div className="card-cab"><h2>Passo a passo</h2>
    {passos.length > 0 && <span className="sub">{feitos} de {passos.length} feitos</span>}
    {podeRefazer && <Btn txt="Atualizar" icone="atualizar" cls="fantasma mini" data-of-acao="refazer" title="Trocar pelo passo a passo atual do produto" onClick={refazer} />}</div>
    {passos.length > 0 && <div className="barra-prog" aria-hidden><i style={{ width: `${Math.round(feitos / passos.length * 100)}%` }} /></div>}
    {passos.length ? <ul className="passos-of">{passos.map(x => <li key={x.n} className={x.feito ? 'feito' : ''}>
      <label><input type="checkbox" checked={!!x.feito} disabled={!marca || ocup !== null} data-passo={x.n} onChange={(e) => void marcar(x.n, e.target.checked)} />
        <span className="pt"><b>{x.n}. {x.operacao}</b>{x.peca && <small>{x.peca}</small>}<TxtMaq x={x} /></span></label>
      {x.feito && <small className="pq">{x.feito_por}{x.feito_em ? ' · ' + U.dataCurta(x.feito_em) + ' ' + x.feito_em.slice(11, 16) : ''}</small>}
      {ocup === x.n && <span className="giro" />}</li>)}</ul>
      : <p className="sub">Esta OF não tem passo a passo. {Perm.pode('produtos_editar') ? <a href={'#/produto/' + o.produto_id}>Monte no cadastro do produto</a> : 'Peça ao Técnico ou ao PCP para montar no cadastro do produto.'}{podeRefazer ? ' e depois toque em Atualizar.' : '.'}</p>}
    {!aberta && passos.length > 0 && <p className="peq">A OF está {o.status}: reabra para marcar.</p>}
    {marca && passos.length > 0 && ligadas && <p className="peq" id="ofPassosLig">O passo marcado aqui também fica marcado {ligadas}.</p>}
  </section>
}

// prévia na hora de emitir a OF
export function PreviaPassos({ p }: { p: Produto }) {
  const { passos, auto } = passosDoProduto(p)
  if (!passos.length) return <p className="peq">Este produto ainda não tem passo a passo: a OF sai sem os quadradinhos.</p>
  return <details className="previa-passos" open><summary>Processo: por onde a peça passa ({U.plural(passos.length, 'passo')}){auto ? ' — montado pela estrutura' : ''}</summary>
    <ol className="passos">{passos.map((x, i) => <li key={i}><span><b>{x.operacao}</b>{x.peca && <small>{x.peca}</small>}<TxtMaq x={x} /></span></li>)}</ol></details>
}
