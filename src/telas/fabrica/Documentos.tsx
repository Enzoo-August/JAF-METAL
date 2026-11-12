/* Documentos que chegam prontos e viram lançamento:
 *  - pedido do cliente em PDF (ordem de compra): lê os itens e lança no Controle de Pedidos, sem repetir;
 *  - nota fiscal emitida pela JAF (XML de saída): baixa as entregas nos pedidos em aberto do cliente. */
import { useEffect, useState } from 'react'
import { App } from '../../app/controle.tsx'
import { API } from '../../lib/api.ts'
import { S } from '../../lib/dados.ts'
import { ErroNota, formatarDoc, lerNotaXml, type Nota } from '../../lib/nfe.ts'
import { lerPedidoTexto, type ItemPdf, type PedidoLido } from '../../lib/pedidopdf.ts'
import type { Cliente, ItemNotaSaida } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { aviso, erro } from '../../ui/avisos.ts'
import { Campo, Tag } from '../../ui/base.tsx'
import { ComboCliente } from '../../ui/Combo.tsx'
import { Ic } from '../../ui/icones.tsx'
import { confirmar, lerForm, modal, useJanela } from '../../ui/janelas.tsx'
import { linhasDoPdf } from '../../ui/previa.tsx'

const digitos = (s: string | null | undefined) => String(s || '').replace(/\D/g, '')
const clientePorCnpj = (cnpjs: string[]): Cliente | null => {
  for (const c of cnpjs) { const x = S.lista('clientes').find(k => digitos(k.cnpj) === c); if (x) return x }
  return null
}
const raizJaf = (): string => digitos(S.cfg<Record<string, string>>('empresa', {}).cnpj).slice(0, 8)

function Arquivo({ tipo, txt, lendo, aoEscolher }: { tipo: 'pdf' | 'xml'; txt: string; lendo: boolean; aoEscolher: (f: File) => void }) {
  return <label className={'btn pri grande arquivo-nota' + (lendo ? ' ocupado' : '')} data-doc={tipo}>
    <input type="file" accept={tipo === 'pdf' ? '.pdf,application/pdf' : '.xml,text/xml,application/xml'} hidden
      onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) aoEscolher(f) }} />
    <Ic n={tipo === 'pdf' ? 'imprimir' : 'nota'} /><span>{lendo ? 'Lendo…' : txt}</span>
  </label>
}

// ================================================================ pedido do cliente em PDF
export async function lerPedidoPdf(): Promise<void> {
  await S.garantir(['produtos', 'vendas'])
  await modal({ titulo: 'Ler pedido do cliente (PDF)', corpo: <EscolherPdf /> })
}

function EscolherPdf() {
  const j = useJanela()
  const [lendo, setLendo] = useState(false)
  const ler = async (f: File) => {
    setLendo(true); j.erro('')
    try {
      if (f.size > 15 * 1024 * 1024) throw new ErroNota('Arquivo grande demais para um pedido.')
      const linhas = await linhasDoPdf(await f.arrayBuffer())
      if (!linhas.length) throw new ErroNota('Este PDF não tem texto (parece uma foto ou um documento escaneado). Peça ao cliente o PDF gerado pelo sistema dele ou lance à mão.')
      const ped = lerPedidoTexto(linhas)
      if (!ped.itens.length) throw new ErroNota('Não achei os itens neste PDF. O leitor procura linhas com código, descrição, data de entrega e quantidade. Lance à mão em “Novo pedido” e mande o PDF para o suporte ajustar.')
      j.limparSujo(); j.fechar(null)
      void conferirPedido(ped, f.name)
    } catch (e) { if (e instanceof ErroNota) j.erro(e.message); else erro(e) } finally { setLendo(false) }
  }
  return <>
    <p>Escolha o <b>PDF da ordem de compra</b> que o cliente mandou. O sistema lê o número do pedido, os códigos, as datas de entrega, as quantidades e os preços; você confere e lança tudo de uma vez.</p>
    <Arquivo tipo="pdf" txt="Escolher o PDF do pedido" lendo={lendo} aoEscolher={(f) => void ler(f)} />
    <ul className="dicas mt">
      <li>Lê o código do cliente (ex.: o “Artículo” da ordem de compra) e acha a peça pelo cadastro de Produtos.</li>
      <li>Mandou o mesmo pedido de novo? O que já estava lançado (mesmo pedido, peça e data) não entra outra vez.</li>
      <li>O arquivo não sai do seu aparelho: só os itens que você confirmar vão para o sistema.</li>
    </ul>
  </>
}

interface SimItem { codigo: string | null; prazo: string; qtd: number; produto: string | null; status: 'novo' | 'sem_cadastro' | 'ja_lancado' }
const TAG_ST: Record<SimItem['status'], { txt: string; cor: 'verde' | 'amarelo' | 'cinza' }> = {
  novo: { txt: 'Novo', cor: 'verde' }, sem_cadastro: { txt: 'Novo · sem cadastro', cor: 'amarelo' }, ja_lancado: { txt: 'Já lançado', cor: 'cinza' } }

async function conferirPedido(ped: PedidoLido, arquivo: string): Promise<void> {
  const raiz = raizJaf()
  const cli = clientePorCnpj(ped.cnpjs.filter(c => !raiz || !c.startsWith(raiz)))
  await modal({
    titulo: 'Conferir o pedido do cliente', largura: 'grande',
    corpo: <ConferirPedido ped={ped} arquivo={arquivo} inicial={cli} />,
    botoes: [{ txt: 'Lançar os itens marcados', icone: 'ok', acao: async (f) => {
      const d = lerForm(f)
      const marcados = ped.itens.filter((_, i) => d['it' + i])
      if (!d.cliente_id) throw new Error('Escolha o cliente do pedido')
      if (!marcados.length) throw new Error('Marque pelo menos um item')
      const r = await API.rpc<{ novos: number; ja_lancados: number }>('lancar_pedido_cliente', { p: { cliente_id: d.cliente_id, pedido: d.pedido, itens: marcados.map(paraEnvio) } })
      await App.gravou(['vendas'])
      aviso(r.novos ? `${U.plural(r.novos, 'item lançado', 'itens lançados')} no Controle de Pedidos${r.ja_lancados ? ` (${U.plural(r.ja_lancados, 'já estava', 'já estavam')} lá)` : ''}.` : 'Todos os itens já estavam lançados.')
      return true
    } }],
  })
}
const paraEnvio = (x: ItemPdf) => ({ codigo: x.codigo, descricao: x.descricao, prazo: x.prazo, qtd: x.qtd, valor: x.preco })

function ConferirPedido({ ped, arquivo, inicial }: { ped: PedidoLido; arquivo: string; inicial: Cliente | null }) {
  const [cli, setCli] = useState<string>(inicial?.id || '')
  const [numPed, setNumPed] = useState(ped.pedido)
  const [sim, setSim] = useState<SimItem[] | null>(null)
  useEffect(() => {
    if (!cli) { setSim(null); return }
    let vivo = true
    API.rpc<{ itens: SimItem[] }>('lancar_pedido_cliente', { p: { cliente_id: cli, pedido: numPed, itens: ped.itens.map(paraEnvio), simular: true } })
      .then(r => { if (vivo) setSim(r.itens) }).catch(() => { if (vivo) setSim(null) })
    return () => { vivo = false }
  }, [cli, numPed, ped])
  const total = U.soma(ped.itens, x => x.qtd * (x.preco || 0))
  const nNovo = sim ? sim.filter(x => x.status !== 'ja_lancado').length : ped.itens.length
  const semCad = sim ? sim.filter(x => x.status === 'sem_cadastro').length : 0
  return <>
    <p className="sub">Arquivo: {arquivo}{ped.data ? ` · emitido em ${U.data(ped.data)}` : ''} · {U.plural(ped.itens.length, 'item', 'itens')}{total > 0 ? ` · ${U.moeda(total)}` : ''}</p>
    <div className="linha-campos l2">
      <ComboCliente id="pdfCli" nome="cliente_id" rotulo="Cliente" req inicial={inicial} placeholder="Nome do cliente" aoEscolher={(c) => setCli(c.id)} aoLimpar={() => setCli('')} />
      <Campo nome="pedido" rotulo="Nº do pedido do cliente" valor={ped.pedido} attrs={{ onBlur: (e: { currentTarget: HTMLInputElement }) => setNumPed(e.currentTarget.value.trim()) }} />
    </div>
    {!inicial && <p className="nota amarela">Não achei o cliente pelo CNPJ do PDF{ped.cnpjs.length ? ` (${ped.cnpjs.map(formatarDoc).join(', ')})` : ''}. Escolha o cliente — e cadastre o CNPJ dele para a próxima vez vir sozinho.</p>}
    <div className="rolagem-x mt"><table className="tabela-fab" id="tPdfItens"><thead><tr><th /><th>Código</th><th className="so-largo">Descrição</th><th>Entrega</th><th className="n">Qtde</th><th className="n so-largo">Preço</th><th className="so-largo">Situação</th></tr></thead>
      <tbody>{ped.itens.map((x, i) => { const s = sim?.[i]
        return <tr key={i + ':' + (s?.status || '')} data-pdf-item={i}><td><input type="checkbox" name={'it' + i} defaultChecked={s?.status !== 'ja_lancado'} aria-label={'Lançar ' + x.codigo} /></td>
          <td className="mono">{x.codigo}{s?.produto ? <small className="col-sub">JAF {s.produto}</small> : null}{s ? <span className="so-estreito"><Tag s={TAG_ST[s.status]} /></span> : null}</td><td className="so-largo">{x.descricao}</td><td>{U.dataCurta(x.prazo)}</td>
          <td className="n">{U.qtd(x.qtd)} {x.unidade}</td><td className="n so-largo">{x.preco !== null ? U.moeda(x.preco) : '—'}</td>
          <td className="so-largo">{s ? <Tag s={TAG_ST[s.status]} /> : <span className="sub">escolha o cliente</span>}</td></tr> })}</tbody></table></div>
    {sim && <p className={'nota mt ' + (semCad ? 'amarela' : 'verde')} id="pdfResumo">{nNovo ? `${U.plural(nNovo, 'item novo', 'itens novos')} para lançar.` : 'Todos os itens já estão lançados.'}
      {semCad ? ` ${U.plural(semCad, 'item', 'itens')} sem cadastro técnico: entra${semCad > 1 ? 'm' : ''} com o código do cliente (cadastre a peça em Produtos depois para entrar na Necessidade).` : ''}</p>}
  </>
}

// ================================================================ nota fiscal emitida (XML de saída) → entregas
interface Simulacao { cliente: string; cliente_id: string; entregas: number; baixado: number; sobra: number; itens: ItemNotaSaida[]; repetido?: boolean }

export async function baixarPelaNota(): Promise<void> {
  await S.garantir(['produtos', 'vendas', 'vendas_entregas', 'notas_saida'])
  await modal({ titulo: 'Baixar entrega pela nota fiscal (XML)', corpo: <EscolherXml /> })
}

function EscolherXml() {
  const j = useJanela()
  const [lendo, setLendo] = useState(false)
  const ler = async (f: File) => {
    setLendo(true); j.erro('')
    try {
      if (f.size > 5 * 1024 * 1024) throw new ErroNota('Arquivo grande demais para uma nota (o XML costuma ter menos de 100 KB).')
      const nota = lerNotaXml(await f.text())
      const raiz = raizJaf()
      if (!nota.saida || (raiz && digitos(nota.emitente.cnpj).slice(0, 8) !== raiz)) {
        throw new ErroNota(`Esta nota foi emitida por ${nota.emitente.nome || 'outra empresa'} — é nota de compra. Para dar entrada de material use “Ler nota fiscal (XML)” em Matéria-prima ou Compras.`)
      }
      j.limparSujo(); j.fechar(null)
      void simularNota(nota, null)
    } catch (e) { if (e instanceof ErroNota) j.erro(e.message); else erro(e) } finally { setLendo(false) }
  }
  return <>
    <p>Escolha o <b>XML da nota fiscal que a JAF emitiu</b> para o cliente. O sistema acha o cliente pelo CNPJ, acha cada peça e baixa a quantidade nos pedidos em aberto — primeiro o pedido que está na nota, depois o de prazo mais antigo.</p>
    <Arquivo tipo="xml" txt="Escolher o XML da nota" lendo={lendo} aoEscolher={(f) => void ler(f)} />
    <ul className="dicas mt">
      <li>É o mesmo jeito da entrada de material pelo XML do fornecedor, só que ao contrário: aqui a peça sai.</li>
      <li>A mesma nota não baixa duas vezes (o sistema confere pela chave de 44 números). Errou? Dá para desfazer.</li>
      <li>A entrega também tira a peça do estoque de peça pronta.</li>
    </ul>
  </>
}

const dadosNota = (nota: Nota) => ({ chave: nota.chave, numero: nota.numero, serie: nota.serie, emissao: nota.emissao, cnpj: nota.destCnpj, cliente_nome: nota.destNome, valor: nota.valor,
  itens: nota.itens.map(i => ({ n: i.n, codigo: i.codigo, descricao: i.descricao, qtd: i.qtd, pedido: i.pedido })) })

async function simularNota(nota: Nota, clienteId: string | null): Promise<void> {
  let sim: Simulacao
  try { sim = await API.rpc<Simulacao>('baixar_nota_saida', { p: { ...dadosNota(nota), cliente_id: clienteId, simular: true } }) }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/não está no cadastro de clientes/.test(msg)) { void escolherCliente(nota); return }
    erro(e); return
  }
  const envio = U.uuid()
  await modal({
    titulo: `NF ${nota.numero} · ${sim.cliente}`, largura: 'grande',
    corpo: <>
      <div className="grade g3"><div className="kpi"><small>Nota fiscal</small><b>{nota.numero}</b><span>emitida {U.data(nota.emissao)}</span></div>
        <div className="kpi"><small>Vai baixar</small><b>{U.qtd(sim.baixado)} pç</b><span>{U.plural(sim.entregas, 'entrega')}</span></div>
        <div className="kpi"><small>Sem pedido em aberto</small><b style={{ color: sim.sobra ? 'var(--vermelho)' : undefined }}>{U.qtd(sim.sobra)}</b><span>{sim.sobra ? 'não baixa' : 'tudo certo'}</span></div></div>
      <div className="lista mt" id="nsItens">{sim.itens.map(it => <div key={it.n} className="linha" data-ns-item={it.n}>
        <div className="meio"><b className="mono">{it.codigo}</b><small>{it.descricao}{it.pedido ? ` · pedido ${it.pedido}` : ''}</small>
          {it.baixas.map(b => <small key={b.venda_id} className="ns-baixa">→ pedido {b.pedido || 's/ nº'} · prazo {U.dataCurta(b.prazo)} · <b>{U.qtd(b.qtd)}</b> de {U.qtd(b.saldo || 0)} em aberto</small>)}
          {Number(it.sobra) > 0 && <small className="txt-vermelho">{U.qtd(it.sobra)} sem pedido em aberto deste cliente{!it.produto_id ? ' (código sem cadastro em Produtos)' : ''}: não baixa</small>}</div>
        <div className="lado"><b>{U.qtd(it.qtd)}</b><small>na nota</small>{Number(it.sobra) > 0 ? <Tag s={{ txt: Number(it.baixado) > 0 ? 'Parcial' : 'Sem pedido', cor: 'amarelo' }} /> : <Tag s={{ txt: 'Ok', cor: 'verde' }} />}</div></div>)}</div>
      {!nota.autorizada && <p className="nota amarela mt">Este XML não tem o protocolo de autorização da Sefaz. Confira se a nota foi mesmo autorizada.</p>}
    </>,
    botoes: sim.entregas ? [{ txt: `Confirmar a baixa (${U.plural(sim.entregas, 'entrega')})`, icone: 'ok', acao: async () => {
      const r = await API.rpc<Simulacao>('baixar_nota_saida', { p: { ...dadosNota(nota), cliente_id: sim.cliente_id, id: envio } })
      await App.gravou(['vendas', 'vendas_entregas', 'notas_saida', 'produto_saldos'], { inteira: ['vendas_entregas'] })
      aviso(`NF ${nota.numero}: ${U.qtd(r.baixado)} pç baixadas em ${U.plural(r.entregas, 'entrega')}.`)
      return true
    } }] : [],
  })
}

async function escolherCliente(nota: Nota): Promise<void> {
  const r = await modal<string>({
    titulo: 'De qual cliente é esta nota?',
    corpo: <><p>O CNPJ da nota (<b>{formatarDoc(nota.destCnpj) || 'sem CNPJ'}</b> · {nota.destNome}) não está no cadastro de clientes.</p>
      <ComboCliente id="nsCli" nome="cliente_id" rotulo="Cliente" req placeholder="Nome do cliente" />
      <p className="sub">Dica: cadastre o CNPJ no cliente para a próxima nota vir sozinha.</p></>,
    botoes: [{ txt: 'Continuar', acao: async (f) => { const d = lerForm(f); if (!d.cliente_id) throw new Error('Escolha o cliente'); return d.cliente_id as string } }],
  })
  if (r) void simularNota(nota, r)
}

export async function desfazerNota(id: string): Promise<void> {
  const ns = S.get('notas_saida', id); if (!ns) return
  if (!await confirmar(`Desfazer a baixa da NF ${ns.numero || ''}?`, { detalhe: `As ${U.plural(ns.entregas, 'entrega')} que ela lançou saem dos pedidos e a peça volta ao estoque.`, ok: 'Desfazer', perigo: true })) return
  try {
    await API.rpc('desfazer_nota_saida', { p_id: id })
    await App.gravou(['vendas', 'vendas_entregas', 'notas_saida', 'produto_saldos'], { inteira: ['vendas_entregas'] })
    aviso('Baixa desfeita.')
  } catch (e) { erro(e) }
}
