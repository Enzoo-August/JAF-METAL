/* Clientes (para quem a JAF produz) */
import { App } from '../app/controle.tsx'
import { API } from '../lib/api.ts'
import { S } from '../lib/dados.ts'
import type { Cliente } from '../lib/tipos.ts'
import * as U from '../lib/util.ts'
import { aviso } from '../ui/avisos.ts'
import { BuscaLista, Btn, Cab, Campo, Dl, temDl, Texto, Vazio, Voltar } from '../ui/base.tsx'
import { useLembrar, type Rota } from '../ui/ganchos.ts'
import { lerForm, modal } from '../ui/janelas.tsx'
import { form as formConta, LinhaConta } from './Financeiro.tsx'
import { AutoPreencher } from './Fornecedores.tsx'
import { CartaoOrdem, form as formOrdem } from './Producao.tsx'

const emAndamento = (s: string) => s === 'fila' || s === 'producao' || s === 'pronta'

function Linha({ c }: { c: Cliente }) {
  const ab = S.lista('ordens').filter(o => o.cliente_id === c.id && emAndamento(o.status)).length
  const rec = U.soma(S.lista('lancamentos').filter(l => l.cliente_id === c.id && l.tipo === 'receber' && !l.pago_em), 'valor')
  return <a className="linha" href={'#/cliente/' + c.id}><div className="meio"><b>{c.nome}{!c.ativo && <> <span className="tag t-cinza">inativo</span></>}</b>
    <small>{[c.contato, U.tel(c.telefone), c.cidade].filter(Boolean).join(' · ') || '—'}</small></div>
    <div className="lado"><b>{rec ? U.moeda0(rec) : '—'}</b><small>{ab ? U.plural(ab, 'ordem', 'ordens') + ' abertas' : rec ? 'a receber' : ''}</small></div></a>
}

export function TelaClientes({ r }: { r: Rota }) { return r.nome === 'cliente' ? <Ficha id={r.id!} /> : <Lista /> }
export const tituloClientes = (r: Rota) => r.nome === 'cliente' ? (S.get('clientes', r.id)?.nome || 'Cliente') : 'Clientes'

function Lista() {
  const [busca, setBusca] = useLembrar('cli.busca', '')
  const l = busca.trim() ? U.buscar(S.lista('clientes'), busca, c => [c.nome, c.razao || '', c.cnpj || '', c.cidade || ''])
    : U.ordenar(S.lista('clientes'), c => (c.ativo ? '0' : '1') + U.sem(c.nome))
  return <>
    <Cab titulo="Clientes" sub="Para quem a JAF produz"><Btn txt="Novo cliente" icone="mais" cls="pri" data-cl="novo" onClick={() => void form()} /></Cab>
    <div className="barra-filtros"><BuscaLista id="bCli" valor={busca} placeholder="Nome, CNPJ, cidade" aoMudar={setBusca} /></div>
    <div className="lista" id="lCli">{l.length ? l.map(c => <Linha key={c.id} c={c} />) : <Vazio icone="cliente" titulo="Nenhum cliente" texto="Cadastre os clientes para ligar ordens de produção e contas a receber." />}</div>
  </>
}

function Ficha({ id }: { id: string }) {
  const c = S.get('clientes', id)
  if (!c) return <Vazio icone="cliente" titulo="Cliente não encontrado"><a className="btn pri" href="#/clientes">Voltar</a></Vazio>
  const ords = S.lista('ordens').filter(o => o.cliente_id === c.id).sort((a, b) => b.numero - a.numero)
  const contas = S.lista('lancamentos').filter(l => l.cliente_id === c.id).sort((a, b) => a.vencimento < b.vencimento ? 1 : -1)
  const ano = U.hoje().slice(0, 4)
  const dados: [string, React.ReactNode][] = [['Contato', c.contato || ''], ['Telefone', U.tel(c.telefone || '')], ['E-mail', c.email ? <a href={'mailto:' + c.email}>{c.email}</a> : ''],
    ['Cidade', [c.cidade, c.uf].filter(Boolean).join('/')], ['Observações', c.obs ? <Texto t={c.obs} /> : '']]
  return <>
    <Voltar para="#/clientes" txt="Clientes" />
    <header className="cab"><div><h1>{c.nome}</h1><p className="sub">{[c.razao, c.cnpj].filter(Boolean).join(' · ')}</p></div>
      <div className="acoes">
        <Btn txt="Nova ordem" icone="producao" cls="pri" data-cl="ordem" onClick={() => void formOrdem({ cliente_id: c.id, cliente_nome: c.nome, unidade: 'pç', prioridade: 0 })} />
        <Btn txt="Conta a receber" icone="dinheiro" data-cl="conta" onClick={() => void formConta({ tipo: 'receber', cliente_id: c.id })} />
        <Btn txt="Editar" icone="lapis" cls="fantasma" data-cl="editar" onClick={() => void form(c)} />
      </div></header>
    <div className="grade g3"><div className="kpi"><small>Recebido em {ano}</small><b>{U.moeda0(U.soma(contas.filter(l => l.pago_em && l.pago_em.startsWith(ano)), 'valor_pago'))}</b></div>
      <div className="kpi"><small>A receber</small><b>{U.moeda0(U.soma(contas.filter(l => !l.pago_em), 'valor'))}</b></div>
      <div className="kpi"><small>Ordens</small><b>{ords.length}</b><span>{ords.filter(o => emAndamento(o.status)).length} em andamento</span></div></div>
    <section className="card mt">{temDl(dados) ? <Dl pares={dados} /> : <p className="sub">Sem dados de contato.</p>}</section>
    {ords.length > 0 && <section className="card mt"><div className="card-cab"><h2>Ordens de produção</h2></div>{ords.slice(0, 20).map(o => <CartaoOrdem key={o.id} o={o} />)}</section>}
    {contas.length > 0 && <section className="card mt"><div className="card-cab"><h2>Contas</h2></div><div className="lista">{contas.slice(0, 30).map(l => <LinhaConta key={l.id} l={l} />)}</div></section>}
  </>
}

export async function form(c?: Cliente | null, nomeInicial?: string): Promise<string | null> {
  const novo = !c
  const b: Partial<Cliente> = c || { ativo: true, nome: nomeInicial || '' }
  return modal<string>({
    titulo: novo ? 'Novo cliente' : 'Editar cliente',
    corpo: <>
      <AutoPreencher />
      <Campo nome="nome" rotulo="Nome" valor={b.nome} req />
      <div className="linha-campos"><Campo nome="cnpj" rotulo="CNPJ" valor={b.cnpj} /><Campo nome="razao" rotulo="Razão social" valor={b.razao} /></div>
      <div className="linha-campos"><Campo nome="contato" rotulo="Contato" valor={b.contato} /><Campo nome="telefone" rotulo="Telefone" tipo="tel" valor={b.telefone} /></div>
      <div className="linha-campos"><Campo nome="email" rotulo="E-mail" tipo="email" valor={b.email} /><Campo nome="cidade" rotulo="Cidade" valor={b.cidade} /><Campo nome="uf" rotulo="UF" valor={b.uf} attrs={{ maxLength: 2 }} /></div>
      <Campo nome="obs" rotulo="Observações" tipo="area" valor={b.obs} linhas={2} />
      {!novo && <Campo nome="ativo" rotulo="Cliente ativo" tipo="check" valor={b.ativo} />}
    </>,
    botoes: [{ txt: novo ? 'Cadastrar' : 'Salvar', acao: async (f) => {
      const d = lerForm(f); if (novo) d.ativo = true
      const id = await API.rpc<string>('salvar_cliente', { p: { ...d, id: b.id } })
      await App.gravou(['clientes', 'ordens']); aviso(novo ? 'Cliente cadastrado.' : 'Cliente salvo.'); return id
    } }],
  })
}
export async function novoRapido(nome: string): Promise<Cliente | null> { const id = await form(null, nome); return id ? S.get('clientes', id) : null }
