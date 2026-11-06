/* Nota fiscal pelo arquivo XML: escolhe o arquivo, confere e lança tudo de uma vez
 * (peças no estoque ou pelo pedido de compra, matéria-prima com R.I., parcelas no contas a pagar). */
import { useState } from 'react'
import { App } from '../app/controle.tsx'
import { API, ErroApp } from '../lib/api.ts'
import { C, S } from '../lib/dados.ts'
import { ErroNota, lerNotaXml, type ItemNota, type Nota } from '../lib/nfe.ts'
import { Perm } from '../lib/perm.ts'
import type { Fornecedor, Peca, Produto } from '../lib/tipos.ts'
import * as U from '../lib/util.ts'
import { aviso, erro } from '../ui/avisos.ts'
import { Campo } from '../ui/base.tsx'
import { ComboFornecedor, ComboPeca } from '../ui/Combo.tsx'
import { Ic } from '../ui/icones.tsx'
import { lerForm, modal, useJanela } from '../ui/janelas.tsx'
import { ComboProduto } from './fabrica/comum.tsx'

type Destino = 'peca' | 'mp' | 'ignorar'
interface Conferencia { lancada: { data: string; em: string; quem: string } | null; fornecedor_id: string | null; vinculos: { codigo: string; peca_id: string | null; produto_id: string | null }[] }

const podePecas = () => Perm.pode('entrada')
const podeMP = () => Perm.pode('mp_editar')
const limpo = (s: string | null | undefined) => U.sem(s || '').replace(/[^a-z0-9]/g, '')

// ---------------------------------------------------------------- passo 1: escolher o arquivo
export async function lerNota(): Promise<void> {
  await S.garantir(['produtos', 'mp_lotes'])
  await modal({
    titulo: 'Ler nota fiscal (XML)',
    corpo: <EscolherArquivo />,
  })
}

function EscolherArquivo() {
  const j = useJanela()
  const [lendo, setLendo] = useState(false)
  const ler = async (arq: File | undefined) => {
    if (!arq) return
    setLendo(true); j.erro('')
    try {
      if (arq.size > 5 * 1024 * 1024) throw new ErroNota('Arquivo grande demais para uma nota (o XML costuma ter menos de 100 KB).')
      const nota = lerNotaXml(await arq.text())
      const conf = await API.rpc<Conferencia>('conferir_nota', { p: { chave: nota.chave, cnpj: nota.emitente.cnpj } })
      j.limparSujo(); j.fechar(null)
      void conferir(nota, conf)
    } catch (e) {
      if (e instanceof ErroNota) j.erro(e.message); else erro(e)
    } finally { setLendo(false) }
  }
  return <>
    <p>O fornecedor manda a nota por e-mail em dois arquivos: o <b>PDF</b> (DANFE, para imprimir) e o <b>XML</b>. Escolha o <b>XML</b>: o sistema lê o fornecedor, os itens, os valores e as parcelas, e você só confere.</p>
    <label className={'btn pri grande arquivo-nota' + (lendo ? ' ocupado' : '')} data-nota="arquivo">
      <input type="file" accept=".xml,text/xml,application/xml" hidden onChange={(e) => { void ler(e.currentTarget.files?.[0]); e.currentTarget.value = '' }} />
      <Ic n="nota" /><span>{lendo ? 'Lendo a nota…' : 'Escolher o arquivo XML'}</span>
    </label>
    <ul className="dicas mt">
      <li>No celular: baixe o anexo .xml do e-mail e escolha em “Arquivos / Downloads”.</li>
      <li>A mesma nota não entra duas vezes: o sistema confere pela chave de 44 números.</li>
      <li>O arquivo não sai do seu aparelho: só os dados que você confirmar vão para o sistema.</li>
    </ul>
  </>
}

// ---------------------------------------------------------------- passo 2: conferir e lançar
interface Sugestao { destino: Destino; peca: Peca | null; produto: Produto | null }

function sugerir(it: ItemNota, conf: Conferencia): Sugestao {
  const v = conf.vinculos.find(x => x.codigo === it.codigo)
  const peca = v?.peca_id ? S.get('pecas', v.peca_id) : null
  const produto = v?.produto_id ? S.get('produtos', v.produto_id) : null
  if (peca && podePecas()) return { destino: 'peca', peca, produto: null }
  if (produto && podeMP()) return { destino: 'mp', peca: null, produto }
  // mesmo código ou mesma descrição no cadastro
  const cod = limpo(it.codigo), desc = limpo(it.descricao)
  const pc = podePecas() ? S.lista('pecas').find(p => p.ativo && (limpo(p.codigo) === cod || limpo(p.descricao) === desc)) : null
  if (pc) return { destino: 'peca', peca: pc, produto: null }
  const mp = podeMP() ? S.lista('produtos').find(p => p.classe === 'mp' && p.situacao !== 'inativo' && (limpo(p.codigo) === cod || limpo(p.descricao) === desc)) : null
  if (mp) return { destino: 'mp', peca: null, produto: mp }
  // serviço, frete e taxa não são estoque: já vêm como "Não lançar" (dá para trocar)
  if (it.ncm === '00' || /^(servicos?|serv\.|frete|taxas?|mao de obra|montagem)(\s|$)/.test(U.sem(it.descricao || '').trim())) return { destino: 'ignorar', peca: null, produto: null }
  // barra, chapa e bobina vêm em quilo
  const quilo = /^(kg|kgs|ton|t)$/i.test(it.unidade.trim())
  if (podeMP() && (quilo || !podePecas())) return { destino: 'mp', peca: null, produto: null }
  return { destino: podePecas() ? 'peca' : 'ignorar', peca: null, produto: null }
}

function fornecedorSugerido(nota: Nota, conf: Conferencia): Fornecedor | null {
  const f = S.get('fornecedores', conf.fornecedor_id)
  if (f) return f
  const nomes = [limpo(nota.emitente.nome), limpo(nota.emitente.razao)].filter(Boolean)
  return S.lista('fornecedores').find(x => x.ativo && (nomes.includes(limpo(x.nome)) || nomes.includes(limpo(x.razao)))) || null
}

async function conferir(nota: Nota, conf: Conferencia): Promise<void> {
  const sug = Object.fromEntries(nota.itens.map(it => [it.n, sugerir(it, conf)]))
  const pedidoDe: Record<number, string> = {}   // item da nota → item do pedido de compra sugerido
  await modal({
    titulo: `Nota fiscal ${nota.numero}`, largura: 'larga',
    corpo: <FormNota nota={nota} conf={conf} sug={sug} pedidoDe={pedidoDe} />,
    botoes: conf.lancada ? [] : [{ txt: 'Lançar a nota', icone: 'ok', acao: async (f) => {
      const d = lerForm(f)
      const itens = nota.itens.map(it => {
        const destino = (d['d_' + it.n] || 'ignorar') as Destino
        const base = { n: it.n, codigo: it.codigo || null, descricao: it.descricao, unidade: it.unidade, valor: it.valor, destino }
        if (destino === 'peca') {
          if (!d['pc_' + it.n]) throw new ErroApp(`Item ${it.n} (${it.descricao}): escolha a peça do estoque, ou marque “Não lançar”.`)
          if (!(d['q_' + it.n] > 0)) throw new ErroApp(`Item ${it.n}: informe a quantidade.`)
          return { ...base, peca_id: d['pc_' + it.n], qtd: d['q_' + it.n], preco_unit: d['p_' + it.n] ?? it.custoUnit, pedido_item_id: d['ped_' + it.n] ? pedidoDe[it.n] || null : null }
        }
        if (destino === 'mp') {
          if (!d['mp_' + it.n]) throw new ErroApp(`Item ${it.n} (${it.descricao}): escolha o material, ou marque “Não lançar”.`)
          if (!(d['q_' + it.n] > 0)) throw new ErroApp(`Item ${it.n}: informe a quantidade.`)
          return { ...base, produto_id: d['mp_' + it.n], qtd: d['q_' + it.n], status: d['st_' + it.n] || 'Aprovado', pedido: it.pedido || null, pedido_item_id: d['ped_' + it.n] ? pedidoDe[it.n] || null : null }
        }
        return base
      })
      let contas: { valor: number; vencimento: string }[] = []
      if (d.contas) {
        contas = nota.duplicatas.length ? nota.duplicatas.map(x => ({ valor: x.valor, vencimento: x.vencimento }))
          : [{ valor: d.cvalor, vencimento: d.cvenc }]
        if (contas.some(c => !(c.valor > 0) || !c.vencimento)) throw new ErroApp('Informe o valor e o vencimento da conta a pagar.')
      }
      if (!itens.some(i => i.destino !== 'ignorar') && !contas.length) throw new ErroApp('Escolha onde lançar pelo menos um item da nota.')
      if (!f.dataset.envio) f.dataset.envio = U.uuid()
      const e = nota.emitente
      const r = await API.rpc<{ documento: string; pecas: number; ris: number[]; contas: number; repetido?: boolean }>('lancar_nota', { p: {
        id: f.dataset.envio, chave: nota.chave, numero: nota.numero, serie: nota.serie, emissao: nota.emissao || null, data: d.data || null, valor: nota.valor,
        fornecedor_id: d.fornecedor_id || null,
        fornecedor: { nome: e.nome, razao: e.razao, cnpj: e.cnpj, ie: e.ie, endereco: e.endereco, bairro: e.bairro, cidade: e.cidade, uf: e.uf, cep: e.cep, telefone: e.telefone },
        itens, contas } })
      await App.gravou(['pecas', 'movimentos', 'mp_lotes', 'pedidos_compra', 'pedido_itens', 'lancamentos', 'fornecedores'], { inteira: ['pedido_itens'] })
      const partes = [r.pecas ? U.plural(r.pecas, 'item', 'itens') + ' no estoque de peças' : '', r.ris?.length ? (r.ris.length === 1 ? 'R.I. ' : 'R.I.s ') + r.ris.join(', ') : '',
        r.contas ? U.plural(r.contas, 'conta', 'contas') + ' a pagar' : ''].filter(Boolean)
      aviso(`Nota ${nota.numero} lançada${partes.length ? ': ' + partes.join(' · ') : ''}.`)
    } }],
  })
}

function FormNota({ nota, conf, sug, pedidoDe }: { nota: Nota; conf: Conferencia; sug: Record<number, Sugestao>; pedidoDe: Record<number, string> }) {
  const [destino, setDestino] = useState<Record<number, Destino>>(() => Object.fromEntries(nota.itens.map(it => [it.n, sug[it.n].destino])))
  const [peca, setPeca] = useState<Record<number, string>>(() => Object.fromEntries(nota.itens.map(it => [it.n, sug[it.n].peca?.id || ''])))
  const [mat, setMat] = useState<Record<number, string>>(() => Object.fromEntries(nota.itens.map(it => [it.n, sug[it.n].produto?.id || ''])))
  const [forn, setForn] = useState<string>(() => fornecedorSugerido(nota, conf)?.id || '')
  const fin = Perm.pode('financeiro')
  const [contas, setContas] = useState(() => fin && nota.duplicatas.length > 0 && !jaTemConta())
  const e = nota.emitente
  const empresa = (S.cfg<Record<string, string>>('empresa', {}).cnpj || '').replace(/\D/g, '')
  const fSug = fornecedorSugerido(nota, conf)

  // conta já lançada à mão com o número desta nota, do mesmo fornecedor (fornecedor novo não tem conta antiga)
  function jaTemConta() {
    const f = fornecedorSugerido(nota, conf)?.id
    return !!f && S.lista('lancamentos').some(l => l.fornecedor_id === f && (l.documento || '').replace(/\D/g, '') === nota.numero)
  }
  // pedido de compra aguardando para a peça (do mesmo fornecedor, se já se sabe qual é)
  const pedidoAberto = (pecaId: string) => {
    if (!pecaId || !Perm.pode('compras')) return null
    const l = C.pedidosAbertosDaPeca(pecaId)
    return l.find(x => x.ped.fornecedor_id === forn) || (forn ? null : l[0]) || null
  }
  // pedido de compra de matéria-prima aguardando para o material
  const pedidoAbertoMP = (produtoId: string) => {
    if (!produtoId || !Perm.pode('compras_mp')) return null
    const l = C.pedidosAbertosDoMaterial(produtoId)
    return l.find(x => x.ped.fornecedor_id === forn) || (forn ? null : l[0]) || null
  }

  const avisos: { cls: string; txt: string }[] = []
  if (conf.lancada) avisos.push({ cls: 'vermelha', txt: `Esta nota já foi lançada em ${U.data(conf.lancada.data)}${conf.lancada.quem ? ' por ' + conf.lancada.quem : ''}. Nada foi feito agora.` })
  if (!nota.autorizada) avisos.push({ cls: 'amarela', txt: 'O arquivo não tem o protocolo de autorização da Sefaz. Confira se a nota é válida antes de lançar.' })
  if (empresa.length === 14 && nota.destCnpj && nota.destCnpj !== empresa) avisos.push({ cls: 'amarela', txt: `Esta nota foi emitida para outro CNPJ (${nota.destCnpj}), não para a JAF.` })
  if (destinoSemPermissao()) avisos.push({ cls: '', txt: 'Seu acesso lança só matéria-prima. As peças do almoxarifado ficam com o almoxarifado ou o escritório.' })
  function destinoSemPermissao() { return !podePecas() && podeMP() }

  return <div className="form-nota">
    {avisos.map((a, i) => <div key={i} className={'nota mb ' + a.cls}>{a.txt}</div>)}
    <div className="card nf-cab" tabIndex={-1} data-autofocus="1">{/* foco aqui: no computador a lista de fornecedores não abre sozinha cobrindo os itens */}
      <div className="nf-cab-linha"><Ic n="nota" /><div><b>{e.razao || e.nome}</b><small>{[e.cnpj, [e.cidade, e.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ')}</small></div></div>
      <div className="grade g3 mt">
        <div className="kpi"><small>Nota</small><b>{nota.numero}</b><span>série {nota.serie || '—'} · {U.data(nota.emissao)}</span></div>
        <div className="kpi"><small>Valor da nota</small><b>{U.moeda(nota.valor)}</b><span>{[nota.ipi ? 'IPI ' + U.moeda(nota.ipi) : '', nota.frete ? 'frete ' + U.moeda(nota.frete) : ''].filter(Boolean).join(' · ') || 'produtos ' + U.moeda(nota.valorProdutos)}</span></div>
        <div className="kpi"><small>Itens</small><b>{nota.itens.length}</b><span>{nota.duplicatas.length ? U.plural(nota.duplicatas.length, 'parcela', 'parcelas') : 'sem parcelas na nota'}</span></div>
      </div>
    </div>
    {!conf.lancada && <>
      <div className="linha-campos mt">
        <ComboFornecedor id="nfForn" nome="fornecedor_id" rotulo="Fornecedor no sistema" placeholder="Em branco = cadastrar com os dados da nota" inicial={fSug}
          aoEscolher={(x) => setForn(x.id)} aoLimpar={() => setForn('')} />
        <Campo nome="data" rotulo="Data da entrada" tipo="date" valor={U.hoje()} attrs={{ max: U.hoje() }} />
      </div>
      <p className="sub">{forn ? (conf.fornecedor_id === forn ? 'Achei pelo CNPJ.' : 'Confira se é este mesmo; o CNPJ da nota fica guardado nele.')
        : `Não achei no cadastro: “${e.nome}” vai ser cadastrado com CNPJ, endereço e telefone da nota.`}</p>

      <h3 className="mt">Itens da nota</h3>
      <p className="sub">Diga para onde vai cada item. Da próxima nota deste fornecedor o sistema já lembra.</p>
      <div className="nf-itens">{nota.itens.map(it => {
        const dest = destino[it.n], s = sug[it.n]
        const ped = dest === 'peca' ? pedidoAberto(peca[it.n]) : dest === 'mp' ? pedidoAbertoMP(mat[it.n]) : null
        if (ped) pedidoDe[it.n] = ped.item.id; else delete pedidoDe[it.n]
        const ops: [Destino, string][] = [...(podePecas() ? [['peca', 'Peça do estoque'] as [Destino, string]] : []), ...(podeMP() ? [['mp', 'Matéria-prima'] as [Destino, string]] : []), ['ignorar', 'Não lançar']]
        return <section key={it.n} className="nf-item" data-item={it.n}>
          <div className="nf-item-cab"><span className="nf-n">{it.n}</span><div><b>{it.descricao}</b>
            <small>{it.codigo ? 'cód. ' + it.codigo + ' · ' : ''}{U.qtd(it.qtd)} {it.unidade} × {U.moeda(it.valorUnit)} = <b>{U.moeda(it.valor)}</b>{it.pedido ? ' · pedido ' + it.pedido : ''}</small></div></div>
          <div className="nf-destino" role="radiogroup" aria-label={'Para onde vai o item ' + it.n}>
            {ops.map(([v, t]) => <label key={v} className="chip-op"><input type="radio" name={'d_' + it.n} value={v} checked={dest === v} onChange={() => setDestino(x => ({ ...x, [it.n]: v }))} /><span>{t}</span></label>)}
          </div>
          {dest === 'peca' && <>
            <ComboPeca id={'nfPc' + it.n} nome={'pc_' + it.n} rotulo="Peça" req placeholder="Código ou nome da peça" inicial={s.peca}
              aoEscolher={(p) => setPeca(x => ({ ...x, [it.n]: p.id }))} aoLimpar={() => setPeca(x => ({ ...x, [it.n]: '' }))} />
            <div className="linha-campos l2">
              <Campo nome={'q_' + it.n} rotulo={`Quantidade (${it.unidade || 'un'})`} tipo="qtd" req valor={U.campoNum(it.qtd, 3)} />
              <Campo nome={'p_' + it.n} rotulo="Custo por unidade" tipo="dinheiro" valor={U.campoPreco(it.custoUnit)}
                ajuda={it.custoUnit !== it.valorUnit ? 'Já com IPI, frete e descontos da nota' : 'Preço da nota'} />
            </div>
            {ped && <label className="check"><input type="checkbox" name={'ped_' + it.n} defaultChecked /> <span>Chegou do pedido de compra nº {ped.ped.numero} (faltam {U.qtd(ped.item.qtd - ped.item.recebido)}): baixar o pedido</span></label>}
          </>}
          {dest === 'mp' && <>
            <ComboProduto id={'nfMp' + it.n} nome={'mp_' + it.n} rotulo="Material" classe="mp" req placeholder="Código ou descrição do material" inicial={s.produto}
              aoEscolher={(p) => setMat(x => ({ ...x, [it.n]: p.id }))} aoLimpar={() => setMat(x => ({ ...x, [it.n]: '' }))} />
            <div className="linha-campos l2">
              <Campo nome={'q_' + it.n} rotulo={`Quantidade (${it.unidade || 'kg'})`} tipo="qtd" req valor={U.campoNum(it.qtd, 3)} ajuda="Ganha um R.I. novo" />
              <Campo nome={'st_' + it.n} rotulo="Inspeção" tipo="select" valor="Aprovado" opcoes={['Aprovado', 'Aguardando', 'Reprovado'].map(v => ({ v, t: v }))} />
            </div>
            {ped && <label className="check"><input type="checkbox" name={'ped_' + it.n} defaultChecked /> <span>Chegou do pedido de compra nº {ped.ped.numero} (faltam {U.qtd(ped.item.qtd - ped.item.recebido)} {C.unidadeMP(mat[it.n])}): baixar o pedido</span></label>}
          </>}
        </section>
      })}</div>

      {fin && <div className="card mt nf-contas">
        <label className="check"><input type="checkbox" name="contas" checked={contas} onChange={(ev) => setContas(ev.target.checked)} />
          <span>{nota.duplicatas.length ? `Lançar ${nota.duplicatas.length === 1 ? 'a conta' : 'as ' + nota.duplicatas.length + ' parcelas'} a pagar com os vencimentos da nota` : 'Lançar a conta a pagar'}</span></label>
        {jaTemConta() && <p className="sub">Já existe conta a pagar com o número desta nota. Confira antes para não lançar duas vezes.</p>}
        {contas && (nota.duplicatas.length
          ? <div className="lista mt">{nota.duplicatas.map(x => <div key={x.numero + x.vencimento} className="linha"><div className="meio"><b>Parcela {x.numero}</b><small>vence {U.data(x.vencimento)}</small></div><div className="lado"><b>{U.moeda(x.valor)}</b></div></div>)}</div>
          : <div className="linha-campos l2 mt">
            <Campo nome="cvalor" rotulo="Valor" tipo="dinheiro" valor={U.campoNum(nota.valor)} />
            <Campo nome="cvenc" rotulo="Vencimento" tipo="date" valor={U.somaDias(nota.emissao || U.hoje(), 30)} />
          </div>)}
      </div>}
      {!fin && <p className="sub mt">A conta a pagar desta nota é lançada pelo escritório.</p>}
    </>}
  </div>
}
