/* Fornecedores e prestadores de serviço */
import { useEffect } from 'react'
import { App } from '../app/controle.tsx'
import { API } from '../lib/api.ts'
import { C, S } from '../lib/dados.ts'
import type { Fornecedor } from '../lib/tipos.ts'
import * as U from '../lib/util.ts'
import { aviso } from '../ui/avisos.ts'
import { BuscaLista, Btn, Cab, Campo, Chips, Dl, Paginado, Tag, Texto, Vazio, Voltar } from '../ui/base.tsx'
import { useLembrar, type Rota } from '../ui/ganchos.ts'
import { Ic } from '../ui/icones.tsx'
import { lerForm, modal, useJanela } from '../ui/janelas.tsx'
import { form as formPedido, LinhaPedido } from './Compras.tsx'
import { LinhaManut } from './Maquinas.tsx'
import { LinhaPeca } from './Pecas.tsx'

// entradas de compra do fornecedor (para total comprado)
const compras = (fid: string) => S.lista('movimentos').filter(m => m.fornecedor_id === fid && m.tipo === 'entrada' && (m.motivo === 'compra' || m.motivo === 'importado'))

// pontualidade: só pedidos recebidos pelo sistema (data real de chegada)
export function pontualidade(fid: string): { n: number; noPrazo: number; pct: number; atrasoMedio: number } | null {
  const r: { atraso: number; aberto?: boolean }[] = []
  for (const p of S.lista('pedidos_compra').filter(x => x.fornecedor_id === fid && x.prazo)) {
    const itens = C.itensDoPedido(p.id).map(i => i.id)
    const chegadas = S.lista('movimentos').filter(m => m.pedido_item_id && itens.includes(m.pedido_item_id) && m.tipo === 'entrada' && m.motivo === 'compra')
    if (!chegadas.length) { if (p.status === 'aguardando' && p.prazo! < U.hoje()) r.push({ atraso: U.dias(p.prazo!, U.hoje()), aberto: true }); continue }
    const primeira = chegadas.reduce((a, m) => m.data < a ? m.data : a, chegadas[0].data)
    r.push({ atraso: Math.max(0, U.dias(p.prazo!, primeira)) })
  }
  if (!r.length) return null
  const noPrazo = r.filter(x => x.atraso === 0 && !x.aberto).length
  const atr = r.filter(x => x.atraso > 0)
  return { n: r.length, noPrazo, pct: noPrazo / r.length, atrasoMedio: U.soma(atr, 'atraso') / Math.max(1, atr.length) }
}

function Linha({ f }: { f: Fornecedor }) {
  const n = S.lista('pecas').filter(p => p.fornecedor_id === f.id && p.ativo).length
  const ano = U.hoje().slice(0, 4)
  const tot = U.soma(compras(f.id).filter(m => m.data.startsWith(ano)), m => m.qtd * m.preco_unit)
  return <a className="linha" href={'#/fornecedor/' + f.id}><div className="meio"><b>{f.nome}{!f.ativo && <> <span className="tag t-cinza">inativo</span></>}</b>
    <small>{[f.tipo !== 'Peças' ? f.tipo : '', f.contato, U.tel(f.celular || f.telefone), f.cidade].filter(Boolean).join(' · ') || '—'}</small></div>
    <div className="lado"><b>{tot ? U.moeda0(tot) : '—'}</b><small>{n ? U.plural(n, 'peça') : ''} {tot ? 'em ' + ano : ''}</small></div></a>
}

export function TelaFornecedores({ r }: { r: Rota }) { return r.nome === 'fornecedor' ? <Ficha id={r.id!} /> : <Lista r={r} /> }
export const tituloFornecedores = (r: Rota) => r.nome === 'fornecedor' ? (S.get('fornecedores', r.id)?.nome || 'Fornecedor') : 'Fornecedores'

function Lista({ r }: { r: Rota }) {
  const [busca, setBusca] = useLembrar('forn.busca', '')
  const [f, setF] = useLembrar('forn.f', 'ativos')
  useEffect(() => { const q = r.q.get('f'); if (q) setF(q) }, [r.hash, r.q, setF])
  const hoje = U.hoje()
  const venc = S.lista('fornecedores').filter(x => x.ativo && x.qualif_validade && x.qualif_validade < hoje).length
  let l = S.lista('fornecedores')
  if (f === 'ativos') l = l.filter(x => x.ativo)
  else if (f === 'pecas') l = l.filter(x => x.ativo && x.tipo !== 'Serviço')
  else if (f === 'servico') l = l.filter(x => x.ativo && x.tipo !== 'Peças')
  else if (f === 'qualif') l = l.filter(x => x.ativo && x.qualif_validade && x.qualif_validade < hoje)
  else if (f === 'inativos') l = l.filter(x => !x.ativo)
  l = busca.trim() ? U.buscar(l, busca, x => [x.nome, x.razao || '', x.contato || '', x.cidade || '', x.cnpj || '', x.obs || '']) : U.ordenar(l, x => U.sem(x.nome))
  return <>
    <Cab titulo="Fornecedores" sub="Quem vende peças e quem presta serviço (eletricista, mecânico, ferramentaria…)"><Btn txt="Novo fornecedor" icone="mais" cls="pri" data-fo="novo" onClick={() => void form()} /></Cab>
    <div className="barra-filtros"><BuscaLista id="bForn" valor={busca} placeholder="Nome, contato, cidade, CNPJ…" aoMudar={setBusca} /></div>
    <Chips atual={f} aoEscolher={setF} opcoes={[{ v: 'ativos', t: 'Ativos' }, { v: 'pecas', t: 'Peças' }, { v: 'servico', t: 'Serviços' }, { v: 'qualif', t: 'Qualificação vencida', n: venc || null }, { v: 'inativos', t: 'Inativos' }]} />
    <p className="sub mt" id="resForn">{U.plural(l.length, 'fornecedor', 'fornecedores')}</p>
    <Paginado key={f + '|' + busca} itens={l} render={(x) => <Linha key={x.id} f={x} />} vazio={<Vazio icone="fornecedor" titulo="Nenhum fornecedor aqui" />} />
  </>
}

function Contatos({ f }: { f: Fornecedor }) {
  const b: React.ReactNode[] = []
  for (const t of [f.celular, f.telefone].filter((x): x is string => !!x)) {
    const dig = t.replace(/^\(0xx/i, '(').replace(/[^\d]/g, '')
    b.push(<a key={'t' + t} className="btn sec mini" href={'tel:' + dig}><Ic n="telefone" /><span>{U.tel(t)}</span></a>)
    if (U.ehCelular(t)) b.push(<a key={'z' + t} className="btn sec mini" target="_blank" rel="noopener" href={'https://wa.me/' + U.telZap(t)}><Ic n="whatsapp" /><span>WhatsApp</span></a>)
  }
  if (f.email) b.push(<a key="e" className="btn sec mini" href={'mailto:' + f.email}><Ic n="email" /><span>{f.email}</span></a>)
  if (U.site(f.site)) b.push(<a key="s" className="btn sec mini" target="_blank" rel="noopener" href={U.site(f.site)}><Ic n="link" /><span>Site</span></a>)
  return b.length ? <div className="grupo-btn">{b}</div> : null
}

function Ficha({ id }: { id: string }) {
  const f = S.get('fornecedores', id)
  if (!f) return <Vazio icone="fornecedor" titulo="Fornecedor não encontrado"><a className="btn pri" href="#/fornecedores">Voltar</a></Vazio>
  const pecas = U.ordenar(S.lista('pecas').filter(p => p.fornecedor_id === f.id), p => U.sem(p.codigo))
  const porAno = U.agrupar(compras(f.id), m => m.data.slice(0, 4))
  const anos = [...porAno.keys()].sort().reverse().slice(0, 6)
  const valorAno = (a: string) => U.soma(porAno.get(a)!, m => m.qtd * m.preco_unit)
  const maxAno = Math.max(1, ...anos.map(valorAno))
  const peds = S.lista('pedidos_compra').filter(p => p.fornecedor_id === f.id).sort((a, b) => b.numero - a.numero)
  const pont = pontualidade(f.id)
  const manut = S.lista('manutencoes').filter(m => m.fornecedor_id === f.id)
  const qualVenc = !!f.qualif_validade && f.qualif_validade < U.hoje()
  return <>
    <Voltar para="#/fornecedores" txt="Fornecedores" />
    <header className="cab"><div><h1>{f.nome} {!f.ativo && <span className="tag t-cinza">inativo</span>}</h1><p className="sub">{[f.razao, f.tipo].filter(Boolean).join(' · ')}</p></div>
      <div className="acoes"><Btn txt="Novo pedido" icone="compras" cls="pri" data-fo="pedido" onClick={() => void formPedido({ fornecedor_id: f.id })} /><Btn txt="Editar" icone="lapis" data-fo="editar" onClick={() => void form(f)} /></div></header>
    <section className="card"><Contatos f={f} />
      <div className="mt"><Dl pares={[['Contato', [f.contato, f.contato2].filter(Boolean).join(' / ')], ['CNPJ', f.cnpj || ''], ['Inscrição estadual', f.ie || ''],
        ['Endereço', [f.endereco, f.bairro, [f.cidade, f.uf].filter(Boolean).join('/'), f.cep].filter(Boolean).join(' — ')],
        ['Qualificação', f.qualificacao ? <><Tag s={{ txt: f.qualificacao, cor: f.qualificacao === 'Aprovado' ? (qualVenc ? 'vermelho' : 'verde') : f.qualificacao === 'Reprovado' ? 'vermelho' : 'amarelo' }} />
          {f.qualif_validade ? ` até ${U.data(f.qualif_validade)}${qualVenc ? ' (vencida)' : ''}` : ''}{f.qualif_metodo ? ' · ' + f.qualif_metodo : ''}</> : ''],
        ['Observações', f.obs ? <Texto t={f.obs} /> : '']]} /></div></section>
    <div className="grade g2 mt">
      <section className="card"><div className="card-cab"><h2>Compras por ano</h2></div>
        {anos.length ? <div className="barras">{anos.map(a => { const v = valorAno(a); return <div key={a} className="barra-h"><span>{a}</span><div className="trilho"><i style={{ width: `${v / maxAno * 100}%` }} /></div><b>{U.moeda0(v)}</b></div> })}</div>
          : <p className="sub">Nenhuma compra registrada.</p>}</section>
      <section className="card"><div className="card-cab"><h2>Entrega no prazo</h2></div>
        {pont ? <><div className="estoque-grande" style={{ color: `var(--${pont.pct >= .8 ? 'verde' : pont.pct >= .5 ? 'amarelo' : 'vermelho'})` }}>{U.pct(pont.pct)}</div>
          <p className="sub mt">{pont.noPrazo} de {U.plural(pont.n, 'pedido')} chegaram no prazo combinado.{pont.atrasoMedio ? ` Quando atrasa, atrasa ${U.plural(Math.round(pont.atrasoMedio), 'dia')} em média.` : ''}</p></>
          : <p className="sub">Começa a medir quando os pedidos forem recebidos pelo sistema (com prazo combinado).</p>}</section>
    </div>
    {pecas.length > 0 && <section className="card mt"><div className="card-cab"><h2>Peças deste fornecedor</h2><span className="sub">{U.plural(pecas.length, 'peça')}</span></div>
      <div className="lista">{pecas.map(p => <LinhaPeca key={p.id} p={p} />)}</div></section>}
    {peds.length > 0 && <section className="card mt"><div className="card-cab"><h2>Pedidos de compra</h2></div><div className="lista">{peds.slice(0, 15).map(p => <LinhaPedido key={p.id} p={p} />)}</div>
      {peds.length > 15 && <p className="sub mt">Mostrando os 15 mais recentes de {peds.length}.</p>}</section>}
    {manut.length > 0 && <section className="card mt"><div className="card-cab"><h2>Serviços de manutenção</h2></div><div className="lista">{manut.map(m => <LinhaManut key={m.id} m={m} />)}</div></section>}
  </>
}

// ---------------------------------------------------------------- cadastro
export async function form(f?: Fornecedor | null, nomeInicial?: string): Promise<string | null> {
  const novo = !f
  const b: Partial<Fornecedor> = f || { tipo: 'Peças', ativo: true, nome: nomeInicial || '' }
  return modal<string>({
    titulo: novo ? 'Novo fornecedor' : 'Editar fornecedor', largura: 'larga',
    corpo: <>
      <AutoPreencher />
      <div className="linha-campos">
        <Campo nome="nome" rotulo="Nome (como vocês chamam)" valor={b.nome} req ajuda="O nome curto do dia a dia. A razão social vai no campo próprio." />
        <Campo nome="tipo" rotulo="Fornece" tipo="select" valor={b.tipo} opcoes={['Peças', 'Serviço', 'Peças e serviço'].map(v => ({ v, t: v }))} />
      </div>
      <div className="linha-campos">
        <Campo nome="cnpj" rotulo="CNPJ" valor={b.cnpj} ajuda="Digite e saia do campo: o sistema busca razão social e endereço." />
        <Campo nome="razao" rotulo="Razão social" valor={b.razao} />
      </div>
      <div className="linha-campos"><Campo nome="contato" rotulo="Contato" valor={b.contato} /><Campo nome="contato2" rotulo="Outro contato" valor={b.contato2} /></div>
      <div className="linha-campos">
        <Campo nome="celular" rotulo="Celular / WhatsApp" valor={U.tel(b.celular)} tipo="tel" />
        <Campo nome="telefone" rotulo="Telefone" valor={U.tel(b.telefone)} tipo="tel" />
        <Campo nome="email" rotulo="E-mail" valor={b.email} tipo="email" />
      </div>
      <Campo nome="site" rotulo="Site" valor={b.site} />
      <div className="linha-campos">
        <Campo nome="cep" rotulo="CEP" valor={b.cep} ajuda="Preenche o endereço sozinho." />
        <Campo nome="endereco" rotulo="Endereço" valor={b.endereco} />
        <Campo nome="bairro" rotulo="Bairro" valor={b.bairro} />
      </div>
      <div className="linha-campos">
        <Campo nome="cidade" rotulo="Cidade" valor={b.cidade} />
        <Campo nome="uf" rotulo="UF" valor={b.uf} attrs={{ maxLength: 2 }} />
        <Campo nome="ie" rotulo="Inscrição estadual" valor={b.ie} />
      </div>
      <h3 className="mt">Qualificação do fornecedor</h3>
      <div className="linha-campos">
        <Campo nome="qualificacao" rotulo="Situação" tipo="select" valor={b.qualificacao || ''} opcoes={[{ v: '', t: '—' }, ...['Aprovado', 'Em avaliação', 'Reprovado'].map(v => ({ v, t: v }))]} />
        <Campo nome="qualif_metodo" rotulo="Método" valor={b.qualif_metodo} placeholder="Ex.: Qualificação interna" />
        <Campo nome="qualif_validade" rotulo="Válida até" tipo="date" valor={b.qualif_validade} />
      </div>
      <Campo nome="obs" rotulo="Observações" tipo="area" valor={b.obs} linhas={2} />
      {!novo && <Campo nome="ativo" rotulo="Fornecedor ativo (desmarque se não compra mais dele — o histórico continua)" tipo="check" valor={b.ativo} />}
    </>,
    botoes: [{ txt: novo ? 'Cadastrar' : 'Salvar', acao: async (frm) => {
      const d = lerForm(frm)
      if (novo) d.ativo = true
      const r = await API.rpc<string>('salvar_fornecedor', { p: { ...d, id: b.id } })
      await App.gravou(['fornecedores'])
      aviso(novo ? 'Fornecedor cadastrado.' : 'Fornecedor salvo.')
      return r
    } }],
  })
}

// CNPJ → razão social / endereço (BrasilAPI); CEP → endereço (ViaCEP). Só preenche o que está vazio.
export function AutoPreencher() {
  const j = useJanela()
  useEffect(() => {
    const form = j.form; if (!form) return
    const v = (n: string) => form.querySelector<HTMLInputElement>(`[name=${n}]`)
    const por = (n: string, val: string | null | undefined) => { const i = v(n); if (i && !i.value.trim() && val) { i.value = val; i.dispatchEvent(new Event('input', { bubbles: true })) } }
    const cnpj = async (e: Event) => {
      const t = e.target as HTMLInputElement
      if (t.name === 'cnpj') {
        const d = t.value.replace(/\D/g, '')
        if (d.length !== 14) return
        t.value = d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
        try {
          const r = await fetch('https://brasilapi.com.br/api/cnpj/v1/' + d); if (!r.ok) return
          const x = await r.json() as Record<string, string>
          por('razao', x.razao_social); por('cep', x.cep && String(x.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2'))
          por('endereco', [x.descricao_tipo_de_logradouro, x.logradouro].filter(Boolean).join(' ') + (x.numero ? ', ' + x.numero : '') + (x.complemento ? ' ' + x.complemento : ''))
          por('bairro', x.bairro); por('cidade', x.municipio && U.cap(x.municipio.toLowerCase()).replace(/\b(\w)/g, c => c.toUpperCase())); por('uf', x.uf)
          aviso('Dados do CNPJ preenchidos. Confira.')
        } catch { /* sem internet: segue manual */ }
      } else if (t.name === 'cep') {
        const d = t.value.replace(/\D/g, '')
        if (d.length !== 8) return
        t.value = d.replace(/^(\d{5})(\d{3})$/, '$1-$2')
        try {
          const r = await fetch(`https://viacep.com.br/ws/${d}/json/`); if (!r.ok) return
          const x = await r.json() as Record<string, string>; if (x.erro) return
          por('endereco', x.logradouro); por('bairro', x.bairro); por('cidade', x.localidade); por('uf', x.uf)
        } catch { /* sem internet */ }
      }
    }
    form.addEventListener('change', cnpj)
    return () => form.removeEventListener('change', cnpj)
  }, [j])
  return null
}

// cadastro rápido de dentro de outro formulário
export async function novoRapido(nome: string): Promise<Fornecedor | null> { const id = await form(null, nome); return id ? S.get('fornecedores', id) : null }
