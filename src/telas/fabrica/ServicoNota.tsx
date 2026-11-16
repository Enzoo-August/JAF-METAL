/* Serviço externo pela nota fiscal (v3.5, pedido do Marcio/PCP).
 *  - nota de SAÍDA (a JAF manda a peça para zincar, tratar…): cada item vira um serviço externo "Fora (no fornecedor)";
 *  - nota de RETORNO (o fornecedor devolve; ou a nota de entrada que a JAF emite): soma na "Qde retornada"
 *    dos serviços em aberto daquele fornecedor e daquela peça — primeiro o da nota de saída citada, depois o mais antigo.
 * Lê o XML (o certo) ou o PDF/DANFE (pelo texto). Nada é gravado sem a pessoa conferir. */
import { useState } from 'react'
import { App } from '../../app/controle.tsx'
import { API } from '../../lib/api.ts'
import { S } from '../../lib/dados.ts'
import { lerDanfeTexto } from '../../lib/danfe.ts'
import { ErroNota, formatarDoc, lerNotaXml, nomeBonito, type ItemNota, type Nota } from '../../lib/nfe.ts'
import type { RegistroFab } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { aviso, erro } from '../../ui/avisos.ts'
import { Campo, Tag } from '../../ui/base.tsx'
import { Ic } from '../../ui/icones.tsx'
import { confirmar, lerForm, modal, useJanela } from '../../ui/janelas.tsx'
import { linhasDoPdf } from '../../ui/previa.tsx'
import { usados } from './comum.tsx'

const dig = (s: string | null | undefined) => String(s || '').replace(/\D/g, '')
const raizJaf = (): string => dig(S.cfg<Record<string, string>>('empresa', {}).cnpj).slice(0, 8)
const num = (v: unknown): number | null => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null }
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

// ---------------------------------------------------------------- códigos JAF ("GB 01.0088", "LA 01.0021M", "US 01 .0005")
export function codigosNoTexto(s: string | null | undefined): string[] {
  const t = semAcento(String(s || '')).toUpperCase()
  return [...t.matchAll(/(?<![A-Z0-9])([A-Z]{2,3})\s*[.-]?\s*(\d{2})\s*[.\s-]?\s*(\d{4})([A-Z]?)(?![A-Z0-9])/g)].map(m => `${m[1]} ${m[2]}.${m[3]}${m[4]}`)
}
export const chaveCodigo = (s: string | null | undefined): string | null => codigosNoTexto(s)[0] || null
const normal = (s: string | null | undefined) => semAcento(String(s || '')).toUpperCase().replace(/\s+/g, ' ').trim()
export function mesmoCodigo(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = chaveCodigo(a), kb = chaveCodigo(b)
  if (ka && kb) return ka === kb
  return !!normal(a) && normal(a) === normal(b)
}
// código JAF do item da nota: o que existe no cadastro (ou nos serviços) primeiro — no código, depois na descrição
function codigoDoItem(it: ItemNota, conhecidos: Set<string>, conhecidosTexto: Set<string>): string {
  const cand = [...codigosNoTexto(it.codigo), ...codigosNoTexto(`${it.codigo} ${it.descricao}`), ...codigosNoTexto(it.descricao)]
  return cand.find(c => conhecidos.has(c)) || (conhecidosTexto.has(normal(it.codigo)) ? it.codigo.trim() : '') || cand[0] || ''
}

// ---------------------------------------------------------------- fornecedor: o nome curto já usado nos serviços ("Guarapiranga")
const palavras = (s: string) => semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
export function fornecedorConhecido(nomesNota: string[], conhecidos: string[]): string | null {
  let melhor: string | null = null
  for (const k of conhecidos) {
    const c = palavras(k).join(''); if (c.length < 4) continue
    const acha = nomesNota.some(n => { const w = palavras(n); return w.some((_, i) => w.slice(i).join('').startsWith(c)) })
    if (acha && (!melhor || c.length > palavras(melhor).join('').length)) melhor = k
  }
  return melhor
}
const mesmoFornecedor = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && palavras(a).join('') === palavras(b).join('')

// ---------------------------------------------------------------- situação de um serviço
const qtdDe = (r: RegistroFab) => num(r.dados?.qtd)
const retDe = (r: RegistroFab) => num(r.dados?.qtd_retorno) || 0
/** ainda falta voltar algo? (o status "Retornou", em qualquer caixa, ou a quantidade toda de volta fecham o serviço) */
export const servicoRetornou = (r: RegistroFab): boolean => /^\s*retornou\s*$/i.test(r.status || '') || (qtdDe(r) !== null && retDe(r) >= (qtdDe(r) as number))
const falta = (r: RegistroFab): number | null => { const q = qtdDe(r); return q === null ? null : Math.max(0, q - retDe(r)) }

// linhas da nota que contam peça que voltou: se houver linha de "retorno" (CFOP x902, x903, x916, x925), só elas
// (a linha da cobrança do serviço, CFOP x124/x125, repete as mesmas peças e não pode somar duas vezes)
const CFOP_RET = /^[1-7](902|903|916|925)$/, CFOP_COBRA = /^[1-7](124|125)$/, CFOP_VENDA = /^[5-7](10[1-9]|11[0-9]|12[0-3]|40[1-5])$/
export function itensDeRetorno(nota: Nota): ItemNota[] {
  if (nota.itens.some(i => CFOP_RET.test(i.cfop))) return nota.itens.filter(i => CFOP_RET.test(i.cfop))
  const outras = nota.itens.filter(i => !CFOP_COBRA.test(i.cfop))
  return outras.length ? outras : nota.itens
}
// a nota fala em peso: a quantidade não é de peças
const emPeso = (u: string) => /^(KG|KGS|KILO|QUILO|G|GR|TON|T)$/i.test(u.trim())

// números de NF da JAF citados na nota de retorno (refNFe ou "NF 1234" nas informações / descrição)
function nfsCitadas(nota: Nota, raiz: string): Set<string> {
  const s = new Set<string>()
  for (const c of nota.refs) if (c.slice(6, 14) === raiz) s.add(String(Number(c.slice(25, 34))))
  const txt = [nota.infoAdicional, ...nota.itens.map(i => i.descricao)].join(' ')
  for (const m of txt.matchAll(/\bN\.?\s?F\.?(?:-?e)?\s*(?:N[º°O.]*\s*)?:?\s*(\d{1,3}(?:\.\d{3})+|\d{3,9})\b/gi)) s.add(String(Number(m[1].replace(/\./g, ''))))
  return s
}

// ---------------------------------------------------------------- escolher o arquivo
export async function lerNotaServico(): Promise<void> {
  await S.garantir(['registros', 'produtos', 'notas_servico'])
  await modal({ titulo: 'Serviço externo pela nota fiscal', corpo: <Escolher /> })
}

function Escolher() {
  const j = useJanela()
  const [lendo, setLendo] = useState(false)
  const ler = async (f: File) => {
    setLendo(true); j.erro('')
    try {
      const pdf = /\.pdf$/i.test(f.name) || f.type === 'application/pdf'
      if (f.size > (pdf ? 15 : 5) * 1024 * 1024) throw new ErroNota('Arquivo grande demais para uma nota fiscal.')
      let nota: Nota
      if (pdf) {
        const linhas = await linhasDoPdf(await f.arrayBuffer())
        if (!linhas.length) throw new ErroNota('Este PDF não tem texto (parece uma foto ou um documento escaneado). Use o arquivo XML da nota ou lance à mão.')
        nota = lerDanfeTexto(linhas)
      } else nota = lerNotaXml(await f.text())
      const ja = S.lista('notas_servico').find(n => n.chave === nota.chave && !n.desfeito_em)
      if (ja) throw new ErroNota(`A NF ${ja.numero || nota.numero} já foi lançada no serviço externo em ${U.data(ja.criado_em)}${ja.criado_nome ? ' por ' + ja.criado_nome : ''}. Se precisa lançar de novo, desfaça em “Notas lidas”.`)
      const raiz = raizJaf()
      if (!raiz) throw new ErroNota('O CNPJ da JAF não está nos dados da empresa (Configurações). Sem ele não dá para saber se a nota é de saída ou de retorno.')
      const doJaf = dig(nota.emitente.cnpj).slice(0, 8) === raiz
      const entrada = nota.itens.every(i => /^[123]/.test(i.cfop))
      if (doJaf && !entrada) {
        if (nota.itens.every(i => CFOP_RET.test(i.cfop) || CFOP_COBRA.test(i.cfop))) throw new ErroNota(`A NF ${nota.numero} é de retorno emitida pela JAF para um cliente (industrialização para terceiros), não de serviço externo.`)
        if (nota.itens.every(i => CFOP_VENDA.test(i.cfop))) throw new ErroNota(`A NF ${nota.numero} é de venda (CFOP ${nota.itens[0].cfop}), não de remessa para serviço. Para baixar entregas de cliente use “Baixar pela nota” em Pedidos.`)
        j.limparSujo(); j.fechar(null); void conferirSaida(nota); return
      }
      if (!doJaf && entrada) throw new ErroNota(`A NF ${nota.numero} é uma nota de entrada de ${nota.emitente.nome || 'outra empresa'}: não é saída nem retorno de serviço externo.`)
      if (!doJaf && nota.destCnpj && nota.destCnpj.slice(0, 8) !== raiz) throw new ErroNota(`A NF ${nota.numero} não é para a JAF (destinatário ${formatarDoc(nota.destCnpj)}).`)
      j.limparSujo(); j.fechar(null); void conferirRetorno(nota, doJaf)
    } catch (e) { if (e instanceof ErroNota) j.erro(e.message); else erro(e) } finally { setLendo(false) }
  }
  return <>
    <p>Escolha o arquivo da nota fiscal — o <b>XML</b> (melhor) ou o <b>PDF</b> (DANFE). O sistema descobre sozinho se é a nota de <b>saída</b> que a JAF emitiu para o fornecedor ou a nota de <b>retorno</b> do serviço, e mostra tudo para você conferir antes de gravar.</p>
    <label className={'btn pri grande arquivo-nota' + (lendo ? ' ocupado' : '')} data-sx="arquivo">
      <input type="file" accept=".xml,.pdf,text/xml,application/xml,application/pdf" hidden
        onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) void ler(f) }} />
      <Ic n="nota" /><span>{lendo ? 'Lendo…' : 'Escolher o XML ou o PDF da nota'}</span>
    </label>
    <ul className="dicas mt">
      <li><b>Saída:</b> cada peça da nota vira um serviço externo “Fora (no fornecedor)”, com o nº da NF.</li>
      <li><b>Retorno:</b> a quantidade que voltou entra na “Qde retornada”. Voltou tudo? O serviço fica “Retornou”. Voltou uma parte? Continua em aberto.</li>
      <li>A mesma nota não entra duas vezes. Errou? Desfaça em “Notas lidas”.</li>
    </ul>
  </>
}

const dadosNota = (nota: Nota) => ({ chave: nota.chave, numero: nota.numero, serie: nota.serie, emissao: nota.emissao || null, origem: nota.origem })
const avisoPdf = (nota: Nota) => nota.origem === 'pdf'
  ? <p className="nota amarela" data-sx-pdf>Lido do <b>PDF</b>: o número, a data e o CNPJ vêm da chave de acesso; os itens vêm do texto da folha. Confira as quantidades.</p>
  : !nota.autorizada ? <p className="nota amarela">Este XML não tem o protocolo de autorização da Sefaz. Confira se a nota foi mesmo autorizada.</p> : null
const servicos = () => S.lista('registros').filter(r => r.tipo === 'servico_externo')
const nomesFornecedores = () => usados(servicos().map(r => r.dados?.fornecedor as string))

// ================================================================ SAÍDA: a JAF manda para o fornecedor
async function conferirSaida(nota: Nota): Promise<void> {
  const prods = S.lista('produtos')
  const regs = U.ordenar(servicos(), r => (r.data || '') + String(r.numero || 0).padStart(6, '0'), true)
  const chaves = new Set([...prods.map(p => chaveCodigo(p.codigo)), ...regs.map(r => chaveCodigo(r.codigo))].filter((x): x is string => !!x))
  const textos = new Set(prods.map(p => normal(p.codigo)))
  const forn = fornecedorConhecido([nota.destNome], nomesFornecedores()) || nota.destNome
  const ofsInfo = [...new Set([...nota.infoAdicional.matchAll(/\bO\.?\s?F\.?\s*(?:N[º°O.]*\s*)?:?\s*(\d{5,7})\b/gi)].map(m => m[1]))]
  const linhas = nota.itens.map(it => {
    const cod = codigoDoItem(it, chaves, textos)
    const pr = cod ? prods.find(p => mesmoCodigo(p.codigo, cod)) : undefined
    const antes = cod ? regs.find(r => r.titulo && mesmoCodigo(r.codigo, cod)) : undefined
    const opProd = pr?.operacao && /servi[cç]o externo|tratam|zinc|galvan|cromad|cement|t[eê]mpera|niquel|fosfat|pint/i.test(pr.operacao) ? pr.operacao : ''
    const ofItem = it.descricao.match(/\bO\.?\s?F\.?\s*(?:N[º°O.]*\s*)?:?\s*(\d{5,7})\b/i)?.[1] || (ofsInfo.length === 1 ? ofsInfo[0] : '')
    return { it, cod: pr?.codigo || cod || it.codigo, desc: pr?.descricao || nomeBonito(it.descricao), serv: antes?.titulo || opProd, peso: emPeso(it.unidade), of: ofItem, temCadastro: !!pr }
  })
  const titulos = usados(regs.map(r => r.titulo))
  const envio = U.uuid()
  await modal({
    titulo: `NF ${nota.numero} · saída para serviço externo`, largura: 'grande',
    corpo: <>
      <Resumo itens={[['Emitida', U.data(nota.emissao)], ['Para', nota.destNome || '—', formatarDoc(nota.destCnpj)], ['Itens', String(nota.itens.length), nota.natureza || 'remessa']]} />
      {avisoPdf(nota)}
      <div className="linha-campos mt">
        <Campo nome="fornecedor" rotulo="Fornecedor do serviço" req valor={forn} attrs={{ list: 'sxForn' }} />
        <Campo nome="saida" rotulo="Data de saída" tipo="date" req valor={nota.emissao || U.hoje()} />
      </div>
      <datalist id="sxForn">{nomesFornecedores().map(s => <option key={s} value={s} />)}</datalist>
      <datalist id="sxServ">{titulos.map(s => <option key={s} value={s} />)}</datalist>
      <p className="sub">Cada item marcado vira um serviço externo. Confira a descrição do serviço (vem do último serviço da mesma peça).</p>
      <div id="sxItens">{linhas.map((l, i) => <div key={i} className="card mt sx-item" data-sx-item={i}>
        <label className="check"><input type="checkbox" name={`ok_${i}`} defaultChecked /> <span><b className="mono">{l.cod || '(sem código)'}</b> · {l.desc}
          <small className="sub"> · na nota: {U.qtd(l.it.qtd)} {l.it.unidade} · CFOP {l.it.cfop}</small></span></label>
        {!l.temCadastro && <small className="txt-vermelho" data-sx-semcad>Código não achado no cadastro de Produtos: confira.</small>}
        <div className="linha-campos l2">
          <Campo nome={`cod_${i}`} rotulo="Produto (código JAF)" valor={l.cod} />
          <Campo nome={`of_${i}`} rotulo="OF" valor={l.of} />
        </div>
        <div className="linha-campos l2">
          <Campo nome={`qtd_${i}`} rotulo="Qde (peças)" tipo="num" valor={l.peso ? null : l.it.qtd} placeholder={l.peso ? 'em peças' : ''} />
          <Campo nome={`peso_${i}`} rotulo="Peso" valor={l.peso ? U.qtd(l.it.qtd) + ' ' + l.it.unidade.toLowerCase() : ''} />
        </div>
        <Campo nome={`serv_${i}`} rotulo="Descrição do serviço" valor={l.serv} attrs={{ list: 'sxServ' }} placeholder="Ex.: Aplicar Zinco Bicromatizado Amarelo 8 a 12 Microns" />
        <input type="hidden" name={`desc_${i}`} defaultValue={l.desc} />
      </div>)}</div>
    </>,
    botoes: [{ txt: 'Lançar os serviços', icone: 'ok', acao: async (f) => {
      const v = lerForm(f)
      const itens = linhas.map((l, i) => ({ i, ok: !!v[`ok_${i}`], codigo: String(v[`cod_${i}`] || '').trim(), descricao: String(v[`desc_${i}`] || ''), titulo: String(v[`serv_${i}`] || '').trim(),
        qtd: v[`qtd_${i}`] as number | null, peso: String(v[`peso_${i}`] || '').trim(), of: String(v[`of_${i}`] || '').trim(), unidade: l.it.unidade })).filter(x => x.ok)
      if (!itens.length) throw new Error('Marque pelo menos um item da nota.')
      for (const x of itens) {
        if (!x.codigo) throw new Error(`Item ${x.i + 1}: falta o código da peça.`)
        if (!x.titulo) throw new Error(`Item ${x.i + 1} (${x.codigo}): preencha a descrição do serviço.`)
        if (!(Number(x.qtd) > 0) && !x.peso) throw new Error(`Item ${x.i + 1} (${x.codigo}): informe a quantidade de peças.`)
      }
      const r = await API.rpc<{ registros: number; itens: { numero: number }[] }>('lancar_nota_servico', { p: { ...dadosNota(nota), id: envio, tipo: 'saida',
        emissao: v.saida || nota.emissao, fornecedor: v.fornecedor, cnpj: nota.destCnpj, itens: itens.map(({ codigo, descricao, titulo, qtd, peso, of }) => ({ codigo, descricao, titulo, qtd, peso, of })) } })
      await App.gravou(['registros', 'notas_servico'])
      const nums = r.itens.map(x => x.numero).filter(Boolean)
      aviso(`NF ${nota.numero}: ${U.plural(r.registros, 'serviço externo lançado', 'serviços externos lançados')}${nums.length ? ` (nº ${nums.join(', ')})` : ''}.`)
      return true
    } }],
  })
}

// ================================================================ RETORNO: o fornecedor devolve
interface Baixa { r: RegistroFab; qtd: number }
interface LinhaRet { it: ItemNota; cod: string; peso: boolean; cands: RegistroFab[] }

// reparte a quantidade de cada item entre os serviços em aberto (o escolhido primeiro; depois o da NF citada; depois o mais antigo)
export function repartir(linhas: LinhaRet[], qtds: (number | null)[], escolhidos: (string | null)[]): { baixas: Baixa[]; sobra: number }[] {
  const usado = new Map<string, number>()
  return linhas.map((l, i) => {
    let resto = Number(qtds[i]) || 0
    const ordem = escolhidos[i] ? [...l.cands.filter(r => r.id === escolhidos[i]), ...l.cands.filter(r => r.id !== escolhidos[i])] : l.cands
    const baixas: Baixa[] = []
    for (const r of ordem) {
      if (resto <= 0) break
      const f = falta(r), u = usado.get(r.id) || 0
      const livre = f === null ? (u > 0 ? 0 : resto) : f - u
      const q = Math.min(resto, livre); if (q <= 0) continue
      baixas.push({ r, qtd: q }); usado.set(r.id, u + q); resto -= q
    }
    return { baixas, sobra: Math.max(0, resto) }
  })
}

async function conferirRetorno(nota: Nota, notaDaJaf: boolean): Promise<void> {
  const raiz = raizJaf()
  const abertos = servicos().filter(r => !servicoRetornou(r))
  const nomeNota = notaDaJaf ? [nota.destNome] : [nota.emitente.nome, nota.emitente.razao]
  const forn = fornecedorConhecido(nomeNota.filter(Boolean), nomesFornecedores())
  const citadas = nfsCitadas(nota, raiz)
  const chaves = new Set(abertos.map(r => chaveCodigo(r.codigo)).filter((x): x is string => !!x))
  const textos = new Set(abertos.map(r => normal(r.codigo)))
  const umAno = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10)
  const linhas: LinhaRet[] = itensDeRetorno(nota).map(it => {
    const cod = codigoDoItem(it, chaves, textos)
    const cands = cod ? abertos.filter(r => mesmoCodigo(r.codigo, cod) && (!forn || mesmoFornecedor(r.dados?.fornecedor as string, forn))) : []
    // primeiro o serviço da NF de saída citada; depois os do último ano (mais antigo primeiro); os muito antigos por último
    const chave = (r: RegistroFab) => { const s = String(r.dados?.saida || r.data || ''); return `${citadas.has(String(Number(dig(String(r.dados?.nf_saida || ''))) || '')) ? 0 : 1}${s >= umAno ? 0 : 1}${s}${String(r.numero || 0).padStart(7, '0')}` }
    return { it, cod, peso: emPeso(it.unidade), cands: U.ordenar(cands, chave) }
  })
  const nomeForn = forn || nomeBonito(nomeNota.find(Boolean) || '')
  const envio = U.uuid()
  const ler = (f: HTMLFormElement) => { const v = lerForm(f); return { qtds: linhas.map((_, i) => v[`ret_${i}`] as number | null), esc: linhas.map((_, i) => (v[`esc_${i}`] as string) || null) } }
  await modal({
    titulo: `NF ${nota.numero} · retorno de serviço externo`, largura: 'grande',
    corpo: <CorpoRetorno nota={nota} linhas={linhas} forn={nomeForn} fornAchado={!!forn} citadas={[...citadas]} />,
    botoes: [{ txt: 'Dar baixa no retorno', icone: 'ok', acao: async (f) => {
      const { qtds, esc } = ler(f)
      const rep = repartir(linhas, qtds, esc)
      const itens = rep.flatMap(x => x.baixas.map(b => ({ registro_id: b.r.id, qtd: b.qtd })))
      if (!itens.length) throw new Error('Nenhum item da nota tem serviço em aberto para dar baixa. Confira a quantidade que voltou.')
      const r = await API.rpc<{ registros: number; qtd: number }>('lancar_nota_servico', { p: { ...dadosNota(nota), id: envio, tipo: 'retorno',
        fornecedor: nomeForn, cnpj: notaDaJaf ? nota.destCnpj : dig(nota.emitente.cnpj), itens } })
      await App.gravou(['registros', 'notas_servico'])
      aviso(`NF ${nota.numero}: retorno de ${U.qtd(r.qtd)} pç em ${U.plural(r.registros, 'serviço')}.`)
      return true
    } }],
  })
}

function CorpoRetorno({ nota, linhas, forn, fornAchado, citadas }: { nota: Nota; linhas: LinhaRet[]; forn: string; fornAchado: boolean; citadas: string[] }) {
  const [qtds, setQtds] = useState<(number | null)[]>(() => linhas.map(l => (l.peso ? null : l.it.qtd)))
  const [esc, setEsc] = useState<(string | null)[]>(() => linhas.map(() => null))
  const rep = repartir(linhas, qtds, esc)
  const total = rep.reduce((s, x) => s + x.baixas.reduce((a, b) => a + b.qtd, 0), 0), nServ = new Set(rep.flatMap(x => x.baixas.map(b => b.r.id))).size
  const semServ = linhas.filter(l => !l.cands.length).length
  const tag = (i: number) => !linhas[i].cands.length ? <Tag s={{ txt: 'Sem serviço', cor: 'vermelho' }} /> : rep[i].baixas.length ? <Tag s={{ txt: 'Ok', cor: 'verde' }} /> : <Tag s={{ txt: 'Confira', cor: 'amarelo' }} />
  return <>
    <Resumo total={total} itens={[['Emitida', U.data(nota.emissao)], ['Fornecedor', forn || '—', fornAchado ? 'achado nos serviços' : 'nome da nota'], ['Vai dar baixa', `${U.qtd(total)} pç`, U.plural(nServ, 'serviço')]]} />
    {avisoPdf(nota)}
    {!fornAchado && <p className="nota amarela">Não achei serviço em aberto com o nome deste fornecedor; a baixa procura pela peça em qualquer fornecedor. Confira abaixo.</p>}
    {citadas.length > 0 && <p className="sub">A nota cita a NF de saída {citadas.join(', ')}: os serviços dela recebem a baixa primeiro.</p>}
    <div id="sxRet">{linhas.map((l, i) => <div key={i} className="card mt sx-item" data-sx-ret={i}>
      <div className="sx-cab"><b className="mono">{l.cod || l.it.codigo}</b>{tag(i)}</div>
      <small className="sub">{l.it.descricao} · na nota: {U.qtd(l.it.qtd)} {l.it.unidade} · CFOP {l.it.cfop}</small>
      {l.peso && l.cands.length > 0 && <small className="txt-amarelo" data-sx-peso>A nota está em {l.it.unidade.toLowerCase()}: digite quantas peças voltaram.</small>}
      {!l.cands.length ? <small className="txt-vermelho" data-sx-sem>Sem serviço externo em aberto {fornAchado ? 'deste fornecedor ' : ''}para esta peça: não dá baixa.</small> : <>
        <div className="linha-campos">
          <Campo nome={`ret_${i}`} rotulo="Peças que voltaram" tipo="num" valor={U.campoNum(qtds[i], 3)} placeholder="pç"
            attrs={{ onInput: (e: { currentTarget: HTMLInputElement }) => { const x = [...qtds]; x[i] = U.num(e.currentTarget.value); setQtds(x) } }} />
          {l.cands.length > 1 && <Campo nome={`esc_${i}`} rotulo="Dar baixa em" tipo="select" valor={esc[i] || ''}
            opcoes={[{ v: '', t: 'Automático (nota citada, depois o mais antigo)' }, ...l.cands.map(r => ({ v: r.id,
              t: `nº ${r.numero} · saiu ${U.dataCurta(String(r.dados?.saida || r.data || ''))} · falta ${falta(r) === null ? '?' : U.qtd(falta(r) as number)}${r.dados?.nf_saida ? ' · NF ' + r.dados.nf_saida : ''}` }))]}
            attrs={{ semBusca: true, 'data-sx-esc': i, onChange: (e: { target: HTMLSelectElement }) => { const x = [...esc]; x[i] = e.target.value || null; setEsc(x) } }} />}
        </div>
        {rep[i].baixas.length > 0 && <ul className="sx-baixas">{rep[i].baixas.map(b => <li key={b.r.id} className="sx-baixa" data-sx-baixa={b.r.numero ?? ''}>
          Serviço nº {b.r.numero} · {String(b.r.dados?.fornecedor || '')} · saiu {U.dataCurta(String(b.r.dados?.saida || b.r.data || ''))}: <b>{U.qtd(b.qtd)}</b>
          {falta(b.r) !== null ? <> de {U.qtd(falta(b.r) as number)} em aberto · {b.qtd >= (falta(b.r) as number) ? 'fica “Retornou”' : 'continua em aberto'}</> : ' · fica “Retornou”'}</li>)}</ul>}
        {rep[i].sobra > 0 && <small className="txt-vermelho">{U.qtd(rep[i].sobra)} a mais do que está em aberto: não dá baixa.</small>}
      </>}
    </div>)}</div>
    {semServ > 0 && <p className="sub mt">Se o serviço não foi lançado no sistema, lance-o em “Novo” e leia a nota de novo.</p>}
  </>
}

// resumo da nota numa faixa só (no celular não ocupa a tela toda)
function Resumo({ itens, total }: { itens: [string, string, string?][]; total?: number }) {
  return <div className="sx-resumo" {...(total !== undefined ? { 'data-sx-total': total } : {})}>{itens.map(([r, v, s]) => <div key={r}><small>{r}</small><b>{v}</b>{s ? <span>{s}</span> : null}</div>)}</div>
}

// ================================================================ notas já lidas (e desfazer)
export async function notasLidas(): Promise<void> {
  await S.garantir(['registros', 'notas_servico'])
  await modal({ titulo: 'Notas do serviço externo', largura: 'larga', corpo: <ListaNotas /> })
}

function ListaNotas() {
  const [, setVer] = useState(0)
  const l = U.ordenar(S.lista('notas_servico'), n => n.criado_em, true).slice(0, 40)
  if (!l.length) return <p className="sub">Nenhuma nota lida ainda. Use “Ler nota (XML ou PDF)”.</p>
  return <div className="lista" id="sxNotas">{l.map(n => <div key={n.id} className="linha" data-sx-nota={n.id}>
    <div className="meio"><b>NF {n.numero} · {n.tipo === 'saida' ? 'saída' : 'retorno'}</b>
      <small>{[n.fornecedor, U.data(n.emissao), `${U.plural(n.itens.length, 'serviço')}${n.qtd ? ' · ' + U.qtd(n.qtd) + ' pç' : ''}`, n.origem === 'pdf' ? 'lida do PDF' : 'lida do XML',
        `${n.criado_nome || ''} em ${U.data(n.criado_em)}`].filter(Boolean).join(' · ')}</small>
      {n.desfeito_em && <small className="txt-vermelho">Desfeita em {U.data(n.desfeito_em)}{n.desfeito_por ? ' por ' + n.desfeito_por : ''}</small>}</div>
    <div className="lado">{!n.desfeito_em && <button type="button" className="btn fantasma mini" data-sx-desfazer={n.id}
      onClick={() => void desfazer(n.id).then(() => setVer(x => x + 1))}>Desfazer</button>}</div>
  </div>)}</div>
}

async function desfazer(id: string): Promise<void> {
  const n = S.get('notas_servico', id); if (!n) return
  const ok = await confirmar(`Desfazer a NF ${n.numero || ''}?`, {
    detalhe: n.tipo === 'saida' ? `Os ${U.plural(n.itens.length, 'serviço externo', 'serviços externos')} que ela lançou serão excluídos.` : `A quantidade que voltou sai de ${U.plural(n.itens.length, 'serviço')}, que voltam para como estavam.`,
    ok: 'Desfazer', perigo: true })
  if (!ok) return
  try {
    await API.rpc('desfazer_nota_servico', { p_id: id })
    await App.gravou(['registros', 'notas_servico'], { inteira: ['registros'] })
    aviso('Nota desfeita.')
  } catch (e) { erro(e) }
}
