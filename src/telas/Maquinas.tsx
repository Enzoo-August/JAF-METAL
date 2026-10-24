/* Máquinas e manutenção */
import { useEffect } from 'react'
import { App } from '../app/controle.tsx'
import { API } from '../lib/api.ts'
import { C, S } from '../lib/dados.ts'
import { Perm } from '../lib/perm.ts'
import type { Manutencao, Maquina } from '../lib/tipos.ts'
import * as U from '../lib/util.ts'
import { aviso } from '../ui/avisos.ts'
import { BuscaLista, Btn, Cab, Campo, Chips, Dl, Tag, temDl, Texto, Vazio, Voltar } from '../ui/base.tsx'
import { ComboFornecedor, ComboFuncionario, ComboMaquina } from '../ui/Combo.tsx'
import { useLembrar, type Rota } from '../ui/ganchos.ts'
import { Ic } from '../ui/icones.tsx'
import { lerForm, modal } from '../ui/janelas.tsx'
import { retirar } from './Movimentos.tsx'
import { LinhaPeca } from './Pecas.tsx'

const TIPO: Record<string, string> = { preventiva: 'Preventiva', corretiva: 'Corretiva (problema)', melhoria: 'Melhoria' }
const ST: Record<string, [string, 'vermelho' | 'amarelo' | 'verde']> = { aberta: ['Aberta', 'vermelho'], andamento: ['Em andamento', 'amarelo'], concluida: ['Concluída', 'verde'] }

// custo de peças retiradas para a máquina (pela máquina escolhida na retirada)
const custoPecas = (maq: Maquina, de: string) => U.soma(C.consumos(m => m.maquina_id === maq.id && m.data >= de), 'valor')

function Cartao({ m }: { m: Maquina }) {
  const prox = C.proximaPreventiva(m), ab = C.manutAbertas(m.id)
  return <a className="card linha-card" href={'#/maquina/' + m.id} style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}><div><b>{m.nome}</b><div className="sub">{[m.tipo, m.setor].filter(Boolean).join(' · ') || '—'}</div></div><Tag s={C.situacaoMaquina(m)} /></div>
    <p className="sub mt" style={{ marginBottom: 0 }}>{ab.length ? <><Ic n="alerta" /> {ab[0].problema.slice(0, 70)}</> : prox ? <>Próxima preventiva: <b>{U.relativo(prox)}</b></> : m.preventiva_dias ? 'Registre a última preventiva' : 'Sem preventiva programada'}</p></a>
}

export function LinhaManut({ m, comMaquina = true }: { m: Manutencao; comMaquina?: boolean }) {
  const mq = S.get('maquinas', m.maquina_id)
  const [st, cor] = ST[m.status] || [m.status, 'cinza']
  const custo = (Number(m.custo_servico) || 0) + U.soma(C.consumos(x => x.manutencao_id === m.id), 'valor')
  const quem = S.get('fornecedores', m.fornecedor_id)?.nome || S.get('funcionarios', m.funcionario_id)?.nome || ''
  return <div className="linha clicavel" data-manut={m.id} onClick={() => void formManutencao(S.get('manutencoes', m.id) || m)}><div className="meio"><b>{comMaquina && mq ? mq.nome + ' · ' : ''}{m.problema}</b>
    <small>{U.data(m.data)} · {TIPO[m.tipo]}{quem ? ' · ' + quem : ''}{m.horas_parada ? ' · ' + U.qtd(m.horas_parada) + ' h parada' : ''}</small></div>
    <div className="lado"><Tag s={{ txt: st, cor }} />{Perm.pode('precos') && custo ? <small>{U.moeda(custo)}</small> : null}</div></div>
}

export function TelaMaquinas({ r }: { r: Rota }) { return r.nome === 'maquina' ? <Ficha id={r.id!} /> : <Lista r={r} /> }
export const tituloMaquinas = (r: Rota) => r.nome === 'maquina' ? (S.get('maquinas', r.id)?.nome || 'Máquina') : 'Máquinas'

function Lista({ r }: { r: Rota }) {
  const [f, setF] = useLembrar('maq.f', 'todas')
  const [busca, setBusca] = useLembrar('maq.busca', '')
  useEffect(() => { const q = r.q.get('f'); if (q) setF(q) }, [r.hash, r.q, setF])
  const at = S.lista('maquinas').filter(m => m.ativo)
  const cod = (m: Maquina) => C.situacaoMaquina(m).cod
  const prob = at.filter(m => ['parada', 'manut'].includes(cod(m))).length
  const prev = at.filter(m => ['prevvencida', 'prevlogo', 'semprev'].includes(cod(m))).length
  const abertas = U.ordenar(C.manutAbertas(), m => m.data, true)
  let l = f === 'inativas' ? S.lista('maquinas').filter(m => !m.ativo) : at
  if (f === 'problema') l = l.filter(m => ['parada', 'manut'].includes(cod(m)))
  if (f === 'preventiva') l = l.filter(m => ['prevvencida', 'prevlogo', 'semprev'].includes(cod(m)))
  l = busca.trim() ? U.buscar(l, busca, m => [m.nome, m.tipo || '', m.setor || '', m.fabricante || ''])
    : U.ordenar(l, m => { const c = cod(m); return (c === 'parada' ? '0' : c === 'manut' ? '1' : c === 'prevvencida' ? '2' : '5') + U.sem(m.nome) })
  return <>
    <Cab titulo="Máquinas e manutenção" sub="Situação de cada máquina, preventivas e chamados">
      <Btn txt="Máquina com problema" icone="chave" cls="pri" data-m="chamado" onClick={() => void formManutencao({ tipo: 'corretiva' })} />
      {Perm.pode('maquinas_editar') && <Btn txt="Nova máquina" icone="mais" data-m="nova" onClick={() => void form()} />}
    </Cab>
    {abertas.length > 0 && <section className="card"><div className="card-cab"><h2>Chamados abertos</h2></div><div className="lista">{abertas.map(m => <LinhaManut key={m.id} m={m} />)}</div></section>}
    <div className="barra-filtros mt"><BuscaLista id="bMaq" valor={busca} placeholder="Buscar máquina" aoMudar={setBusca} /></div>
    <Chips atual={f} aoEscolher={setF} opcoes={[{ v: 'todas', t: 'Todas' }, { v: 'problema', t: 'Com problema', n: prob || null }, { v: 'preventiva', t: 'Preventiva', n: prev || null }, { v: 'inativas', t: 'Desativadas' }]} />
    <div className="grade g-auto mt" id="gMaq">{l.length ? l.map(m => <Cartao key={m.id} m={m} />)
      : <Vazio icone="maquina" titulo="Nenhuma máquina aqui" texto={Perm.pode('maquinas_editar') ? 'Cadastre as máquinas da fábrica para controlar manutenção e o gasto de peças de cada uma.' : ''} />}</div>
  </>
}

function Ficha({ id }: { id: string }) {
  const m = S.get('maquinas', id)
  if (!m) return <Vazio icone="maquina" titulo="Máquina não encontrada"><a className="btn pri" href="#/maquinas">Voltar</a></Vazio>
  const prox = C.proximaPreventiva(m), ult = C.ultimaPreventiva(m.id)
  const manut = U.ordenar(S.lista('manutencoes').filter(x => x.maquina_id === m.id), x => x.data + x.criado_em, true)
  const de12 = U.somaMeses(U.hoje(), -12)
  const precos = Perm.pode('precos')
  const cp = precos ? custoPecas(m, de12) : 0
  const cs = U.soma(manut.filter(x => x.data >= de12), 'custo_servico')
  const horas = U.soma(manut.filter(x => x.data >= de12), 'horas_parada')
  const pecas = U.ordenar(S.lista('pecas').filter(p => p.ativo && p.utilizacao && U.sem(p.utilizacao).includes(U.sem(m.nome))), p => U.sem(p.codigo))
  const dados: [string, React.ReactNode][] = [['Número de série', m.numero_serie || ''], ['Ano', m.ano || ''], ['Observações', m.obs ? <Texto t={m.obs} /> : '']]
  return <>
    <Voltar para="#/maquinas" txt="Máquinas" />
    <header className="cab"><div><h1>{m.nome} <Tag s={C.situacaoMaquina(m)} /></h1><p className="sub">{[m.tipo, m.fabricante, m.modelo, m.setor].filter(Boolean).join(' · ')}</p></div>
      <div className="acoes">
        <Btn txt="Abrir chamado" icone="chave" cls="pri" data-m="chamado" onClick={() => void formManutencao({ tipo: 'corretiva', maquina_id: m.id })} />
        <Btn txt="Registrar preventiva" icone="ok" data-m="prev" onClick={() => void formManutencao({ tipo: 'preventiva', maquina_id: m.id, status: 'concluida', problema: 'Manutenção preventiva' })} />
        {Perm.pode('maquinas_editar') && <Btn txt="Editar" icone="lapis" cls="fantasma" data-m="editar" onClick={() => void form(m)} />}
      </div></header>
    <div className="grade g4">
      <div className="kpi"><small>Preventiva</small><b style={{ fontSize: '1.15rem' }}>{prox ? U.relativo(prox) : m.preventiva_dias ? 'sem registro' : '—'}</b><span>{m.preventiva_dias ? `a cada ${m.preventiva_dias} dias${ult ? ' · última ' + U.dataCurta(ult) : ''}` : 'sem prazo definido'}</span></div>
      <div className="kpi"><small>Paradas (12 meses)</small><b>{U.qtd(horas)} h</b><span>{U.plural(manut.filter(x => x.data >= de12 && x.tipo === 'corretiva').length, 'problema')}</span></div>
      {precos && <><div className="kpi"><small>Peças (12 meses)</small><b>{U.moeda0(cp)}</b><span>retiradas para esta máquina</span></div>
        <div className="kpi"><small>Serviços (12 meses)</small><b>{U.moeda0(cs)}</b><span>técnicos e terceiros</span></div></>}
    </div>
    {temDl(dados) && <section className="card mt"><Dl pares={dados} /></section>}
    <section className="card mt"><div className="card-cab"><h2>Histórico de manutenção</h2><span className="sub">{U.plural(manut.length, 'registro')}</span></div>
      {manut.length ? <div className="lista">{manut.map(x => <LinhaManut key={x.id} m={x} comMaquina={false} />)}</div> : <p className="sub">Nada registrado ainda.</p>}</section>
    {pecas.length > 0 && <section className="card mt"><div className="card-cab"><h2>Peças de reposição desta máquina</h2><span className="sub">pelo campo "onde é usada"</span></div><div className="lista">{pecas.map(p => <LinhaPeca key={p.id} p={p} />)}</div></section>}
  </>
}

// ---------------------------------------------------------------- cadastros
export async function form(m?: Maquina | null, nomeInicial?: string): Promise<string | null> {
  const novo = !m
  const b: Partial<Maquina> = m || { ativo: true, nome: nomeInicial || '' }
  const setores = U.unicos(S.lista('maquinas').map(x => x.setor).filter((x): x is string => !!x))
  return modal<string>({
    titulo: novo ? 'Nova máquina' : 'Editar máquina',
    corpo: <>
      <Campo nome="nome" rotulo="Nome / identificação" valor={b.nome} req ajuda="Ex.: Torno CNC 02, TA 25" />
      <div className="linha-campos"><Campo nome="tipo" rotulo="Tipo" valor={b.tipo} placeholder="Torno, fresadora, prensa…" />
        <Campo nome="setor" rotulo="Setor" valor={b.setor} attrs={{ list: 'lSetor' }} /></div><datalist id="lSetor">{setores.map(s => <option key={s} value={s} />)}</datalist>
      <div className="linha-campos"><Campo nome="fabricante" rotulo="Fabricante" valor={b.fabricante} /><Campo nome="modelo" rotulo="Modelo" valor={b.modelo} /></div>
      <div className="linha-campos"><Campo nome="numero_serie" rotulo="Nº de série" valor={b.numero_serie} /><Campo nome="ano" rotulo="Ano" tipo="num" valor={b.ano} />
        <Campo nome="preventiva_dias" rotulo="Preventiva a cada (dias)" tipo="num" valor={b.preventiva_dias} ajuda="Em branco = sem preventiva programada" /></div>
      <Campo nome="obs" rotulo="Observações" tipo="area" valor={b.obs} linhas={2} />
      {!novo && <Campo nome="ativo" rotulo="Máquina ativa" tipo="check" valor={b.ativo} />}
    </>,
    botoes: [{ txt: novo ? 'Cadastrar' : 'Salvar', acao: async (f) => {
      const d = lerForm(f); if (novo) d.ativo = true
      const r = await API.rpc<string>('salvar_maquina', { p: { ...d, id: b.id } })
      await App.gravou(['maquinas']); aviso(novo ? 'Máquina cadastrada.' : 'Máquina salva.'); return r
    } }],
  })
}
export async function novaRapida(nome: string): Promise<Maquina | null> { const id = await form(null, nome); return id ? S.get('maquinas', id) : null }

export async function formManutencao(m: Partial<Manutencao> = {}): Promise<unknown> {
  const novo = !m.id
  const podeCusto = Perm.pode('precos')
  const usadas = m.id ? C.consumos(x => x.manutencao_id === m.id) : []
  return modal({
    titulo: novo ? (m.tipo === 'preventiva' ? 'Registrar preventiva' : 'Máquina com problema') : 'Manutenção',
    corpo: <>
      <ComboMaquina id="mMaq" nome="maquina_id" rotulo="Máquina" req placeholder="Digite para buscar" inicial={S.get('maquinas', m.maquina_id)} />
      <div className="linha-campos"><Campo nome="tipo" rotulo="Tipo" tipo="select" valor={m.tipo || 'corretiva'} opcoes={Object.entries(TIPO).map(([v, t]) => ({ v, t }))} />
        <Campo nome="data" rotulo="Data" tipo="date" valor={m.data || U.hoje()} />
        <Campo nome="status" rotulo="Situação" tipo="select" valor={m.status || 'aberta'} opcoes={Object.entries(ST).map(([v, [t]]) => ({ v, t }))} /></div>
      <Campo nome="problema" rotulo={m.tipo === 'preventiva' ? 'O que foi feito' : 'O que está acontecendo'} tipo="area" valor={m.problema} req linhas={2} placeholder="Ex.: barulho no cabeçote, vazamento de óleo…" />
      <Campo nome="solucao" rotulo="Solução / serviço feito" tipo="area" valor={m.solucao} linhas={2} />
      <div className="linha-campos">
        <ComboFuncionario id="mFunc" nome="funcionario_id" rotulo="Quem cuidou (da equipe)" placeholder="Nome" inicial={S.get('funcionarios', m.funcionario_id || (novo ? API.sessao?.funcionario_id : null))} />
        {Perm.pode('compras') && <ComboFornecedor id="mForn" nome="fornecedor_id" rotulo="Técnico / empresa de fora" placeholder="Eletricista, mecânico…" inicial={S.get('fornecedores', m.fornecedor_id)} />}
      </div>
      <div className="linha-campos">{podeCusto && <Campo nome="custo_servico" rotulo="Custo do serviço" tipo="dinheiro" valor={U.campoNum(m.custo_servico)} />}
        <Campo nome="horas_parada" rotulo="Horas com a máquina parada" tipo="num" valor={U.campoNum(m.horas_parada, 1)} /></div>
      {usadas.length > 0 && <p className="sub">Peças usadas: {usadas.map(u => S.get('pecas', u.mov.peca_id)?.codigo + ' × ' + U.qtd(u.qtd)).join(', ')}{podeCusto ? ' — ' + U.moeda(U.soma(usadas, 'valor')) : ''}</p>}
      {!novo && <p className="sub">Para ligar uma peça a esta manutenção, use <b>Retirar peça</b> e escolha esta máquina.</p>}
    </>,
    botoes: [
      ...(novo || m.status === 'concluida' ? [] : [{ txt: 'Retirar peça para esta manutenção', cls: 'sec', validar: false, acao: async () => { void retirar(); return true } }]),
      { txt: novo ? (m.tipo === 'preventiva' ? 'Registrar' : 'Abrir chamado') : 'Salvar', acao: async (f: HTMLFormElement) => {
        const d = lerForm(f)
        if (!Perm.pode('compras')) d.fornecedor_id = m.fornecedor_id || null
        if (!podeCusto) d.custo_servico = m.custo_servico || 0
        if (!f.dataset.envio) f.dataset.envio = m.id || U.uuid()
        const r = await API.rpc<string>('salvar_manutencao', { p: { ...d, id: f.dataset.envio } })
        await App.gravou(['manutencoes'])
        aviso(novo ? (d.status === 'concluida' ? 'Registrado.' : 'Chamado aberto.') : 'Salvo.')
        return r
      } },
    ],
  })
}
