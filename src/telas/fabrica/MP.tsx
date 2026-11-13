/* Matéria-prima (planilha PCP, aba "E.S.M." = Entrada e Saída de Material).
 * Cada recebimento ganha um R.I. (lote). O saldo do lote = recebido − o que foi para as OFs − acerto de inventário. */
import { useState } from 'react'
import { App } from '../../app/controle.tsx'
import { API, ErroApp } from '../../lib/api.ts'
import { C, S } from '../../lib/dados.ts'
import { Perm } from '../../lib/perm.ts'
import type { LoteMP } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { entregar, excel, pdfLivre } from '../../ui/arquivos.tsx'
import { aviso } from '../../ui/avisos.ts'
import { BarraProg, Btn, BuscaLista, Cab, Campo, Chips, Cols, Dl, Paginado, Tag, Texto, Vazio } from '../../ui/base.tsx'
import { ComboFornecedor } from '../../ui/Combo.tsx'
import { useLembrar, type Rota } from '../../ui/ganchos.ts'
import { lerForm, modal, useJanela } from '../../ui/janelas.tsx'
import { lerNota } from '../Nota.tsx'
import { ComboProduto, ComTabelas } from './comum.tsx'
import { LinhaOF } from './OFs.tsx'

const COR_ST = { Aprovado: 'verde', Reprovado: 'vermelho', Aguardando: 'amarelo' } as const

// R.I. que aparecem nas OFs mas não têm entrada lançada
export function riSemEntrada(): Map<number, number> {
  const m = new Map<number, number>()
  for (const o of S.lista('ofs')) if (o.ri && o.status !== 'cancelada' && !C.loteDoRI(o.ri)) m.set(o.ri, (m.get(o.ri) || 0) + 1)
  return m
}

function LinhaLote({ l }: { l: LoteMP }) {
  const p = S.get('produtos', l.produto_id), s = C.saldoLote(l)
  return <div className="linha clicavel cols" data-ri={l.ri} onClick={() => void detalhe(l.id)}><div className="meio"><b>R.I. {l.ri} · {p?.codigo || '?'}</b>
    <small>{p?.descricao}<span className="so-estreito">{[' ', U.dataCurta(l.data), l.fornecedor_nome, l.nota ? 'NF ' + l.nota : ''].filter(Boolean).join(' · ').replace(/^ · /, ' · ')}</span></small></div>
    <Cols itens={[['Entrada', U.dataCurta(l.data)], ['Fornecedor', l.fornecedor_nome], ['Nota fiscal', l.nota], ['Usado', <>{U.qtd(Number(l.qtd) - s)} de {U.qtd(l.qtd)}<BarraProg v={Number(l.qtd) - s} de={Number(l.qtd) || 0} /></>]]} />
    <div className="lado"><b>{U.qtd(s)}</b><small>de {U.qtd(l.qtd)}</small>{l.status !== 'Aprovado' && <Tag s={{ txt: l.status, cor: COR_ST[l.status] }} />}</div></div>
}

export function TelaMP(_: { r: Rota }) {
  return <ComTabelas tabs={['produtos', 'mp_lotes', 'ofs']}>{() => <Lista />}</ComTabelas>
}

function Lista() {
  const [f, setF] = useLembrar('mp.f', 'saldo')
  const [busca, setBusca] = useLembrar('mp.busca', '')
  const [verRI, setVerRI] = useState(false)
  const todos = S.lista('mp_lotes')
  const semEnt = riSemEntrada()
  let l = todos
  if (f === 'saldo') l = l.filter(x => x.status === 'Aprovado' && C.saldoLote(x) > 0)
  else if (f === 'zerado') l = l.filter(x => x.status === 'Aprovado' && C.saldoLote(x) <= 0)
  else if (f !== 'todos' && f !== 'material') l = l.filter(x => x.status === f)
  l = busca.trim() ? U.buscar(l, busca, x => { const p = S.get('produtos', x.produto_id); return [String(x.ri), p?.codigo || '', p?.descricao || '', x.nota || '', x.fornecedor_nome || '', x.pedido || ''] })
    : U.ordenar(l, x => x.ri, true)
  const porMat = [...C.estoqueMP()].map(([id, q]) => ({ p: S.get('produtos', id)!, q })).filter(x => x.p)
  const porMatF = busca.trim() ? U.buscar(porMat, busca, x => [x.p.codigo, x.p.descricao]) : U.ordenar(porMat, x => x.p.codigo)
  return <>
    <Cab titulo="Matéria-prima" sub="Entrada de material (R.I.), saldo de cada lote e para qual OF foi">
      {Perm.pode('mp_editar') && <Btn txt="Ler nota (XML)" icone="nota" data-mp="nota" onClick={() => void lerNota()} />}
      {Perm.pode('mp_editar') && <Btn txt="Nova entrada" icone="entrada" cls="pri" data-mp="nova" onClick={() => void formLote()} />}
      <Btn txt="Etiquetas" icone="imprimir" cls="sec" data-mp="etiquetas" onClick={() => void folhaEtiquetas()} />
      <Btn txt="Excel" icone="planilha" cls="fantasma" onClick={() => exportar(l)} />
    </Cab>
    {semEnt.size > 0 && <section className="card alerta-card" data-ri-sem-entrada={semEnt.size}><div className="card-cab"><h2>{U.plural(semEnt.size, 'R.I.')} usado{semEnt.size > 1 ? 's' : ''} em OF sem entrada lançada</h2>
      <button type="button" className="btn fantasma" onClick={() => setVerRI(!verRI)}>{verRI ? 'Esconder' : 'Ver quais'}</button></div>
      <p className="sub">A planilha E.S.M. parou de ser preenchida, mas as OFs continuaram usando R.I. novos. Lance cada um em <b>Nova entrada</b> com o mesmo número de R.I. para o saldo ficar certo.</p>
      {verRI && <p className="mono" style={{ fontSize: '.85rem' }}>{[...semEnt.keys()].sort((a, b) => a - b).map(ri => <span key={ri} style={{ marginRight: 10 }}>
        {Perm.pode('mp_editar') ? <a href="#" onClick={(e) => { e.preventDefault(); void formLote({ ri }) }}>{ri}</a> : ri} ({semEnt.get(ri)})</span>)}</p>}</section>}
    <div className="barra-filtros mt"><BuscaLista id="bMP" valor={busca} placeholder="R.I., código, nota, fornecedor" aoMudar={setBusca} /></div>
    <Chips atual={f} aoEscolher={setF} opcoes={[{ v: 'saldo', t: 'Com saldo' }, { v: 'material', t: 'Saldo por material' }, { v: 'Aguardando', t: 'Aguardando inspeção', n: todos.filter(x => x.status === 'Aguardando').length || null },
      { v: 'Reprovado', t: 'Reprovados' }, { v: 'zerado', t: 'Zerados' }, { v: 'todos', t: 'Todos' }]} />
    {f === 'material'
      ? <section className="card mt"><div className="rolagem-x"><table className="tabela-fab" id="tMat"><thead><tr><th>Material</th><th className="so-largo">Descrição</th><th className="n">Saldo</th><th className="n">Lotes</th></tr></thead>
        <tbody>{porMatF.map(x => <tr key={x.p.id} className="clicavel" onClick={() => { setF('saldo'); setBusca(x.p.codigo) }}><td className="mono">{x.p.codigo}</td><td className="so-largo">{x.p.descricao}</td>
          <td className="n"><b>{U.qtd(x.q)}</b></td><td className="n">{todos.filter(y => y.produto_id === x.p.id && y.status === 'Aprovado' && C.saldoLote(y) > 0).length}</td></tr>)}</tbody></table></div>
        {!porMatF.length && <p className="sub">Nenhum material com saldo.</p>}</section>
      : <div className="mt" id="lMP"><Paginado itens={l} render={x => <LinhaLote key={x.id} l={x} />} vazio={<Vazio icone="estoque" titulo="Nenhum lote aqui" />} /></div>}
  </>
}

function exportar(l: LoteMP[]) {
  return excel('Materia-prima (E.S.M.).xlsx', [['E.S.M.', l.map(x => { const p = S.get('produtos', x.produto_id)
    return { 'R.I.': x.ri, Data: U.data(x.data), Nota: x.nota || '', 'Cód. Material': p?.codigo || '', Descrição: p?.descricao || '', 'Qde/Kg': x.qtd, Fornecedor: x.fornecedor_nome || '',
      Pedido: x.pedido || '', Status: x.status, 'Consumo OFs': C.consumoPorRI().get(x.ri) || 0, 'Acerto inventário': x.baixa || 0, 'Saldo/ Kg': C.saldoLote(x) } })]])
}

// ---------------------------------------------------------------- lote
export async function detalhe(id: string): Promise<unknown> {
  // abre de qualquer lugar (Início, barra de baixo): garante as tabelas antes de montar a janela
  await S.garantir(['produtos', 'mp_lotes', 'ofs'])
  const l = S.get('mp_lotes', id); if (!l) return
  const p = S.get('produtos', l.produto_id)
  const ofs = U.ordenar(S.lista('ofs').filter(o => o.ri === l.ri), o => o.numero, true)
  const podeEd = Perm.pode('mp_editar')
  return modal({
    titulo: `R.I. ${l.ri}`, largura: 'larga',
    corpo: <>
      <p><b>{p?.codigo}</b> — {p?.descricao} <Tag s={{ txt: l.status, cor: COR_ST[l.status] }} /></p>
      <div className="grade g3 mt"><div className="kpi"><small>Recebido</small><b>{U.qtd(l.qtd)}</b></div>
        <div className="kpi"><small>Usado nas OFs</small><b>{U.qtd(C.consumoPorRI().get(l.ri) || 0)}</b><span>{U.plural(ofs.length, 'OF')}</span></div>
        <div className="kpi"><small>Saldo</small><b>{U.qtd(C.saldoLote(l))}</b>{l.baixa ? <span>acerto de inventário {U.qtd(l.baixa)}</span> : null}</div></div>
      <div className="mt"><Dl pares={[['Data', U.data(l.data)], ['Nota fiscal', l.nota || ''], ['Fornecedor', l.fornecedor_nome || ''], ['Pedido', l.pedido || ''], ['Observações', l.obs ? <Texto t={l.obs} /> : '']]} /></div>
      {ofs.length > 0 && <><h3 className="mt">OFs que usaram este lote</h3><div className="lista">{ofs.map(o => <LinhaOF key={o.id} o={o} />)}</div></>}
    </>,
    botoes: [
      { txt: 'Etiqueta', cls: 'sec', validar: false, acao: async () => { await etiqueta(l); return false } },
      ...(podeEd ? [{ txt: 'Inventário', cls: 'sec', validar: false, acao: async () => { void inventario(l); return true } },
        { txt: 'Editar', validar: false, acao: async () => { void formLote(l); return true } }] : []),
    ],
  })
}

// dentro da entrada manual: quem tem o XML da nota lança tudo de uma vez
function LerNotaDica() {
  const j = useJanela()
  return <p className="nota mb">Tem o arquivo XML da nota? <button type="button" className="link" data-mp="lerNota" onClick={() => { j.limparSujo(); j.fechar(null); void lerNota() }}>Ler a nota</button> e lançar todos os itens de uma vez.</p>
}

export async function formLote(b: Partial<LoteMP> = {}): Promise<unknown> {
  // abre de qualquer lugar (Início, barra de baixo): garante as tabelas antes de montar a janela
  await S.garantir(['produtos', 'mp_lotes'])
  const novo = !b.id
  return modal({
    titulo: novo ? 'Entrada de matéria-prima' : `Editar R.I. ${b.ri}`, largura: 'larga',
    corpo: <>
      {novo && <LerNotaDica />}
      <fieldset className="secao"><legend>Material que chegou</legend>
        <ComboProduto id="mpProd" nome="produto_id" rotulo="Material" classe="mp" req placeholder="Código ou descrição do material" inicial={S.get('produtos', b.produto_id)} />
        <div className="linha-campos l3">
          <Campo nome="qtd" rotulo="Quantidade (kg ou pç)" tipo="qtd" req valor={U.campoNum(b.qtd, 3)} />
          <Campo nome="data" rotulo="Data da entrada" tipo="date" valor={b.data || U.hoje()} />
          <Campo nome="ri" rotulo="R.I. (número do lote)" tipo="num" valor={b.ri} ajuda={novo ? 'Em branco = próximo número' : ''} />
        </div>
      </fieldset>
      <fieldset className="secao"><legend>Nota e fornecedor</legend>
        <ComboFornecedor id="mpForn" nome="fornecedor_id" rotulo="Fornecedor" placeholder="Usina, distribuidor…" inicial={S.get('fornecedores', b.fornecedor_id)} />
        {!b.fornecedor_id && b.fornecedor_nome && <p className="sub">Na planilha: {b.fornecedor_nome}</p>}
        <div className="linha-campos l3">
          <Campo nome="nota" rotulo="Nota fiscal" valor={b.nota} />
          <Campo nome="pedido" rotulo="Nº do pedido de compra" valor={b.pedido} />
          <Campo nome="status" rotulo="Inspeção" tipo="select" valor={b.status || 'Aprovado'} opcoes={['Aprovado', 'Aguardando', 'Reprovado'].map(v => ({ v, t: v }))} />
        </div>
      </fieldset>
      <Campo nome="obs" rotulo="Observações" tipo="area" linhas={2} valor={novo ? '' : b.obs} />
    </>,
    botoes: [{ txt: novo ? 'Lançar entrada' : 'Salvar', acao: async (f) => {
      const d = lerForm(f)
      if (!d.fornecedor_id && b.fornecedor_nome) d.fornecedor_nome = b.fornecedor_nome
      if (!f.dataset.envio) f.dataset.envio = b.id || U.uuid()
      const r = await API.rpc<{ id: string; ri: number }>('salvar_lote', { p: { ...d, id: f.dataset.envio } })
      await App.gravou(['mp_lotes']); aviso(novo ? `Entrada lançada: R.I. ${r.ri}.` : 'Lote salvo.')
      if (novo) { const l = S.get('mp_lotes', r.id); if (l) setTimeout(() => void etiqueta(l, `R.I. ${l.ri} lançado — etiqueta (4 por folha)`), 250) }
      return r.id
    } }],
  })
}

async function inventario(l: LoteMP) {
  return modal({
    titulo: `Inventário do R.I. ${l.ri}`,
    corpo: <><p className="sub">O sistema calcula {U.qtd(C.saldoLote(l))}. Informe quanto tem de verdade no lote (zero se acabou).</p>
      <Campo nome="contado" rotulo="Quantidade contada" tipo="qtd" req foco />
      <Campo nome="obs" rotulo="Observação" valor="" /></>,
    botoes: [{ txt: 'Acertar saldo', acao: async (f) => { await API.rpc('ajustar_lote', { p: { ...lerForm(f), id: l.id } }); await App.gravou(['mp_lotes']); aviso('Saldo do lote acertado.'); return true } }],
  })
}

// ---------------------------------------------------------------- etiquetas "Identificação de Material" (Form. 001)
// v3.4 (pedido do PCP): uma folha A4 com 4 etiquetas, como o modelo da JAF, buscando pelo número do R.I.
// Posição em branco = etiqueta que já foi usada na folha (dá para reaproveitar a folha pela metade).
type DocPdf = Parameters<Parameters<typeof pdfLivre>[0]>[0]
function desenharEtiqueta(doc: DocPdf, l: LoteMP, x: number, y: number, w: number, h: number, logo: string | null): void {
  const p = S.get('produtos', l.produto_id), pad = 4, xi = x + pad, wi = w - pad * 2
  const linha = (yy: number) => { doc.setDrawColor(70); doc.setLineWidth(0.25); doc.line(xi, yy, xi + wi, yy) }
  doc.setDrawColor(40); doc.setLineWidth(0.5); doc.rect(x, y, w, h)
  // cabeçalho
  let yy = y + pad
  if (logo) doc.addImage(logo, 'PNG', xi, yy, 26, 5.4)
  else { doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20); doc.text('JAF METAL', xi, yy + 4.5) }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(20); doc.text('IDENTIFICAÇÃO DE MATERIAL', xi + wi, yy + 4.3, { align: 'right' })
  yy += 8; doc.setDrawColor(40); doc.setLineWidth(0.5); doc.line(xi, yy, xi + wi, yy)
  // R.I. e data
  yy += 10.5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90); doc.text('RI:', xi, yy - 1)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(24); doc.setTextColor(10); doc.text(String(l.ri), xi + 7, yy)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90); doc.text('Data:', xi + wi - 28, yy - 1)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(10); doc.text(U.data(l.data), xi + wi, yy - 1, { align: 'right' })
  yy += 3; linha(yy)
  // campos
  const campo = (rot: string, valor: string, maxLinhas = 1, tam = 10.5) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90)
    doc.text(rot, xi, yy + 4.6)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(tam); doc.setTextColor(10)
    let ls = doc.splitTextToSize(valor || '', wi - 24) as string[]
    if (ls.length > maxLinhas) { ls = ls.slice(0, maxLinhas); ls[maxLinhas - 1] = ls[maxLinhas - 1].replace(/\s*\S*$/, '') + '…' }
    const alt = tam * 0.42
    ls.forEach((t, k) => doc.text(t, xi + 24, yy + 4.8 + k * (alt + 0.8)))
    yy += Math.max(7.5, 3 + ls.length * (alt + 0.8) + 2.2); linha(yy)
  }
  campo('Código:', p?.codigo || '', 1, 12)
  campo('Material:', p?.descricao || '', 3)
  campo('Fornecedor:', l.fornecedor_nome || '', 2)
  campo('Qtde./Peso:', `${U.qtd(l.qtd)} ${C.unidadeMP(l.produto_id)}`, 1, 12)
  campo('Local:', '')
  campo('Obs.:', [l.nota ? 'NF ' + l.nota : '', l.pedido ? 'Pedido ' + l.pedido : '', l.obs || ''].filter(Boolean).join(' · '), 2, 9.5)
  // situação da inspeção
  const yRod = y + h - pad - 4
  const ySit = Math.min(yy + 3, yRod - 26)
  doc.setDrawColor(40); doc.setLineWidth(0.4); doc.rect(xi, ySit, wi, 14)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90); doc.text('SITUAÇÃO DA INSPEÇÃO', xi + wi / 2, ySit + 3.6, { align: 'center' })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(10); doc.text(l.status.toUpperCase(), xi + wi / 2, ySit + 11, { align: 'center' })
  // data e visto (à mão)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(30)
  doc.text('DATA: ____/____/____', xi, yRod - 3); doc.text('VISTO: ______________', xi + wi, yRod - 3, { align: 'right' })
  doc.setFontSize(7); doc.setTextColor(120); doc.text('Form. 001/0', xi + wi, yRod + 2.5, { align: 'right' })
}

export async function imprimirEtiquetas(posicoes: (LoteMP | null)[], titulo?: string): Promise<void> {
  const blob = await pdfLivre((doc, W, H, logo) => {
    const m = 7, gap = 6, w = (W - m * 2 - gap) / 2, h = (H - m * 2 - gap) / 2
    for (let pg = 0; pg * 4 < posicoes.length; pg++) {
      if (pg) doc.addPage()
      // linhas de corte (tracejadas) no meio da folha
      doc.setDrawColor(160); doc.setLineWidth(0.2); doc.setLineDashPattern([2, 1.5], 0)
      doc.line(W / 2, 3, W / 2, H - 3); doc.line(3, H / 2, W - 3, H / 2); doc.setLineDashPattern([], 0)
      posicoes.slice(pg * 4, pg * 4 + 4).forEach((l, k) => {
        if (l) desenharEtiqueta(doc, l, m + (k % 2) * (w + gap), m + Math.floor(k / 2) * (h + gap), w, h, logo)
      })
    }
  })
  const ris = posicoes.filter((l): l is LoteMP => !!l).map(l => l.ri)
  await entregar(blob, `Etiquetas RI ${ris.join(' ')}.pdf`, { titulo: titulo || `Etiquetas: R.I. ${ris.join(', ')}`,
    dica: 'Folha A4 com 4 etiquetas: imprima em tamanho real (100%), recorte nas linhas tracejadas e cole no material.' })
}

function CorpoEtiquetas({ ini }: { ini: string[] }) {
  const [v, setV] = useState<string[]>(ini)
  const [ver, setVer] = useState(0)   // remonta os campos quando o botão preenche sozinho
  const mudar = (i: number, s: string) => setV(x => x.map((y, k) => k === i ? s : y))
  const ultimos = () => {
    const usados = new Set(v.map(x => x.trim()).filter(Boolean))
    const recentes = U.ordenar(S.lista('mp_lotes'), l => l.ri, true).map(l => String(l.ri)).filter(r => !usados.has(r))
    setV(x => x.map(y => y.trim() ? y : recentes.shift() || '')); setVer(n => n + 1)
  }
  return <>
    <p className="sub">Folha A4 com 4 etiquetas (Form. 001). Digite o número do R.I. em cada posição.
      Se a folha já tem etiqueta usada, deixe essa posição em branco: a etiqueta sai só nas outras.</p>
    <div className="etq-grade mt" key={ver}>{v.map((s, i) => {
      const l = s.trim() ? C.loteDoRI(Number(s)) : null, p = l ? S.get('produtos', l.produto_id) : null
      return <div key={i} className="etq-pos" data-etq-pos={i + 1}>
        <Campo nome={'ri' + i} rotulo={`Posição ${i + 1}`} tipo="num" valor={s} placeholder="Nº do R.I." attrs={{ onInput: (e: { target: HTMLInputElement }) => mudar(i, e.target.value) }} />
        <small className={s.trim() && !l ? 'txt-vermelho' : 'sub'} data-etq-info={i + 1}>{!s.trim() ? 'Em branco' : l ? `${p?.codigo || '?'} · ${U.qtd(l.qtd)} ${C.unidadeMP(l.produto_id)}` : 'R.I. não encontrado'}</small>
      </div> })}</div>
    <button type="button" className="link mt" data-etq="ultimos" onClick={ultimos}>Completar as posições vazias com os últimos R.I. lançados</button>
  </>
}

// janela da folha de etiquetas: já vem com o(s) R.I. pedido(s) nas primeiras posições
export async function folhaEtiquetas(ris: number[] = [], titulo?: string): Promise<unknown> {
  await S.garantir(['produtos', 'mp_lotes'])
  const ini = [0, 1, 2, 3].map(k => ris[k] ? String(ris[k]) : '')
  return modal({
    titulo: titulo || 'Etiquetas de R.I. (4 por folha)', largura: 'larga',
    corpo: <CorpoEtiquetas ini={ini} />,
    botoes: [{ txt: 'Gerar folha', icone: 'imprimir', acao: async (f) => {
      const nums = [0, 1, 2, 3].map(k => (f.querySelector<HTMLInputElement>(`[name=ri${k}]`)?.value || '').trim())
      const ruim = nums.find(s => s && !C.loteDoRI(Number(s)))
      if (ruim) throw new ErroApp(`O R.I. ${ruim} não foi encontrado. Confira o número.`)
      const pos = nums.map(s => s ? C.loteDoRI(Number(s)) : null)
      if (!pos.some(Boolean)) throw new ErroApp('Digite pelo menos um número de R.I.')
      await imprimirEtiquetas(pos)
      return true
    } }],
  })
}
// uma etiqueta só (botão "Etiqueta" do R.I. e depois de lançar a entrada): abre a folha com ele na 1ª posição
export const etiqueta = (l: LoteMP, titulo?: string): Promise<unknown> => folhaEtiquetas([l.ri], titulo)
