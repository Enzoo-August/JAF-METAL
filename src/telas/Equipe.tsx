/* Equipe: funcionários */
import { useEffect } from 'react'
import { App } from '../app/controle.tsx'
import { API, ErroApp } from '../lib/api.ts'
import { C, S } from '../lib/dados.ts'
import { Perm } from '../lib/perm.ts'
import type { Funcionario } from '../lib/tipos.ts'
import * as U from '../lib/util.ts'
import { aviso, erro, ocupado } from '../ui/avisos.ts'
import { BuscaLista, Btn, Cab, Campo, Chips, Dl, Tag, Texto, Vazio, Voltar, type OpcaoChip } from '../ui/base.tsx'
import { useLembrar, type Rota } from '../ui/ganchos.ts'
import { Ic } from '../ui/icones.tsx'
import { confirmar, lerForm, modal } from '../ui/janelas.tsx'
import { CartaoOrdem } from './Producao.tsx'

const tempoCasa = (adm: string | null) => { if (!adm) return ''; const m = Math.floor(U.dias(adm, U.hoje()) / 30.4375); const a = Math.floor(m / 12), r = m % 12
  return a ? `${U.plural(a, 'ano')}${r ? ' e ' + U.plural(r, 'mês', 'meses') : ''}` : U.plural(r, 'mês', 'meses') }

function Linha({ f }: { f: Funcionario }) {
  const priv = S.get('funcionarios_privado', f.id)
  const fe = Perm.pode('salarios') ? C.ferias(f, priv) : null
  const aviso = fe?.limite ? (fe.vencida ? 'Férias vencidas' : (fe.diasParaVencer ?? 99) <= 60 ? 'Férias vencem ' + U.relativo(fe.limite) : '') : ''
  const acesso = S.lista('perfis').find(p => p.funcionario_id === f.id)
  return <a className="linha" href={'#/funcionario/' + f.id}><span className="avatar">{f.nome.charAt(0).toUpperCase()}</span>
    <div className="meio"><b>{f.nome}{!f.ativo && <> <span className="tag t-cinza">desligado</span></>}</b>
      <small>{[f.funcao, f.setor, f.admissao ? tempoCasa(f.admissao) + ' de casa' : ''].filter(Boolean).join(' · ') || '—'}{acesso ? ' · tem acesso ao sistema' : ''}</small></div>
    <div className="lado">{aviso && <Tag s={{ txt: aviso, cor: fe?.vencida ? 'vermelho' : 'amarelo' }} />}{Perm.pode('salarios') && priv?.salario ? <small>{U.moeda0(priv.salario)}</small> : null}</div></a>
}

export function TelaEquipe({ r }: { r: Rota }) { return r.nome === 'funcionario' ? <Ficha id={r.id!} /> : <Lista r={r} /> }
export const tituloEquipe = (r: Rota) => r.nome === 'funcionario' ? (S.get('funcionarios', r.id)?.nome || 'Funcionário') : 'Equipe'

function Lista({ r }: { r: Rota }) {
  const [busca, setBusca] = useLembrar('eq.busca', '')
  const [f, setF] = useLembrar('eq.f', 'ativos')
  useEffect(() => { const q = r.q.get('f'); if (q) setF(q) }, [r.hash, r.q, setF])
  const at = S.lista('funcionarios').filter(x => x.ativo)
  const sal = Perm.pode('salarios')
  const folha = sal ? U.soma(at, x => Number(S.get('funcionarios_privado', x.id)?.salario) || 0) : 0
  const setores = U.agrupar(at, x => x.setor || 'Sem setor')
  const chips: OpcaoChip[] = [{ v: 'ativos', t: 'Ativos', n: at.length }]
  if (sal) chips.push({ v: 'ferias', t: 'Férias vencendo' }, { v: 'aniver', t: 'Aniversariantes do mês' })
  chips.push({ v: 'desligados', t: 'Desligados' })
  let l = S.lista('funcionarios')
  if (f === 'ativos') l = l.filter(x => x.ativo)
  else if (f === 'desligados') l = l.filter(x => !x.ativo)
  else if (f === 'ferias') l = l.filter(x => { const fe = C.ferias(x, S.get('funcionarios_privado', x.id)); return !!fe?.limite && (fe.diasParaVencer ?? 99) <= 60 })
  else if (f === 'aniver') { const m = U.hoje().slice(5, 7); l = l.filter(x => x.ativo && S.get('funcionarios_privado', x.id)?.nascimento?.slice(5, 7) === m) }
  l = busca.trim() ? U.buscar(l, busca, x => [x.nome, x.funcao || '', x.setor || '']) : U.ordenar(l, x => U.sem(x.nome))
  const comAdm = at.filter(x => x.admissao)
  return <>
    <Cab titulo="Equipe" sub={`${U.plural(at.length, 'pessoa')} · ${[...setores.entries()].map(([s, x]) => `${s} ${x.length}`).join(' · ')}`}>
      {Perm.pode('equipe_editar') && <Btn txt="Novo funcionário" icone="mais" cls="pri" data-eq="novo" onClick={() => void form()} />}</Cab>
    {sal && <div className="grade g3"><div className="kpi"><small>Folha mensal (salários)</small><b>{U.moeda0(folha)}</b><span>sem encargos</span></div>
      <div className="kpi"><small>Média por pessoa</small><b>{U.moeda0(at.length ? folha / at.length : 0)}</b></div>
      <div className="kpi"><small>Tempo médio de casa</small><b style={{ fontSize: '1.15rem' }}>{comAdm.length ? tempoCasa(U.somaDias(U.hoje(), -Math.round(U.soma(comAdm, x => U.dias(x.admissao!, U.hoje())) / comAdm.length))) : '—'}</b></div></div>}
    <div className="barra-filtros mt"><BuscaLista id="bEq" valor={busca} placeholder="Nome, função, setor" aoMudar={setBusca} /></div>
    <Chips atual={f} aoEscolher={setF} opcoes={chips} />
    <div className="lista mt" id="lEq">{l.length ? l.map(x => <Linha key={x.id} f={x} />) : <Vazio icone="equipe" titulo="Ninguém aqui" />}</div>
  </>
}

function Ficha({ id }: { id: string }) {
  const f = S.get('funcionarios', id)
  if (!f) return <Vazio icone="equipe" titulo="Funcionário não encontrado"><a className="btn pri" href="#/equipe">Voltar</a></Vazio>
  const sal = Perm.pode('salarios'), priv = S.get('funcionarios_privado', f.id)
  const fe = sal ? C.ferias(f, priv) : null
  const de12 = U.somaMeses(U.hoje(), -12)
  const porPeca = U.agrupar(C.consumos(m => m.funcionario_id === f.id && m.data >= de12), x => x.mov.peca_id)
  const top = [...porPeca.entries()].map(([pid, l]) => ({ p: S.get('pecas', pid), q: U.soma(l, 'qtd'), v: U.soma(l, 'valor') })).filter(x => x.q > 0).sort((a, b) => b.v - a.v).slice(0, 8)
  const ords = S.lista('ordens').filter(o => o.responsavel_id === f.id && (o.status === 'fila' || o.status === 'producao'))
  const acesso = S.lista('perfis').find(p => p.funcionario_id === f.id)
  const idade = priv?.nascimento ? Math.floor(U.dias(priv.nascimento, U.hoje()) / 365.25) : null
  const apagarFerias = async (n: number) => {
    if (!(await confirmar('Apagar este registro de férias?', { ok: 'Apagar', perigo: true }))) return
    const p = { ...(S.get('funcionarios_privado', f.id) || {}) }
    p.ferias = (p.ferias || []).filter((_, i) => i !== n)
    await API.rpc('salvar_funcionario', { p: { ...f, privado: p } }); await App.gravou(['funcionarios', 'funcionarios_privado']); aviso('Registro apagado.')
  }
  return <>
    <Voltar para="#/equipe" txt="Equipe" />
    <header className="cab"><div><h1>{f.nome} {!f.ativo && <span className="tag t-cinza">desligado</span>}</h1><p className="sub">{[f.funcao, f.setor].filter(Boolean).join(' · ')}</p></div>
      <div className="acoes">{Perm.pode('equipe_editar') && <Btn txt="Editar" icone="lapis" data-eq="editar" onClick={() => void form(f)} />}
        {sal && f.ativo && <Btn txt="Registrar férias" icone="calendario" data-eq="ferias" onClick={() => void registrarFerias(f)} />}</div></header>
    <section className="card"><Dl pares={[['Telefone', f.telefone ? <a href={'tel:' + f.telefone.replace(/\D/g, '')}>{f.telefone}</a> : ''], ['Admissão', f.admissao ? `${U.data(f.admissao)} (${tempoCasa(f.admissao)})` : ''],
      sal && ['Salário', priv?.salario ? U.moeda(priv.salario) : ''], sal && ['Nascimento', priv?.nascimento ? `${U.data(priv.nascimento)} (${idade} anos)` : ''],
      sal && ['CPF', priv?.cpf || ''], sal && ['RG', priv?.rg || ''], sal && ['Endereço', priv?.endereco || ''], sal && ['Pix', priv?.pix || ''],
      ['Acesso ao sistema', acesso ? `${acesso.login} (${Perm.nome(acesso.perfil)})` : ''], sal && ['Observações', priv?.obs ? <Texto t={priv.obs} /> : '']]} /></section>
    {fe && <section className="card mt"><div className="card-cab"><h2>Férias</h2></div>
      {fe.pendentes > 0 ? <p className={`nota ${fe.vencida ? 'vermelha' : (fe.diasParaVencer ?? 99) <= 60 ? 'amarela' : ''}`}>{U.plural(fe.pendentes, 'período')} de férias para tirar. {fe.vencida
        ? <><b>Venceu em {U.data(fe.limite)}</b> (a lei manda pagar em dobro).</> : <>Precisa sair até <b>{U.data(fe.limite)}</b> ({U.relativo(fe.limite)}).</>}</p>
        : <p className="sub">Em dia. Ganha direito a novas férias em {U.data(fe.direitoEm)}.</p>}
      {(priv?.ferias || []).length > 0 && <div className="lista mt">{priv!.ferias.map((x, n) => <div key={n} className="linha" style={{ minHeight: 44 }}><div className="meio"><b>{U.data(x.inicio)} a {U.data(x.fim)}</b><small>{U.plural(U.dias(x.inicio, x.fim) + 1, 'dia')}{x.obs ? ' · ' + x.obs : ''}</small></div>
        <button type="button" className="icone-btn" aria-label="Apagar registro" data-tirarferias={n} onClick={(e) => void ocupado(e.currentTarget, () => apagarFerias(n).catch(erro))}><Ic n="lixo" /></button></div>)}</div>}
      <p className="sub mt">Conta simplificada da CLT: cada 12 meses de casa dá um período; cada férias registrada usa o período mais antigo.</p></section>}
    {ords.length > 0 && <section className="card mt"><div className="card-cab"><h2>Ordens com {f.nome.split(' ')[0]}</h2></div>{ords.map(o => <CartaoOrdem key={o.id} o={o} />)}</section>}
    {top.length > 0 && <section className="card mt"><div className="card-cab"><h2>Peças que mais retirou (12 meses)</h2></div><div className="lista">{top.map(x => <a key={x.p?.id} className="linha" href={'#/peca/' + x.p?.id}>
      <div className="meio"><b><span className="codigo">{x.p?.codigo || ''}</span> · {x.p?.descricao || ''}</b></div>
      <div className="lado"><b>{U.qtd(x.q)}</b>{Perm.pode('precos') && <small>{U.moeda(x.v)}</small>}</div></a>)}</div></section>}
  </>
}

async function registrarFerias(f: Funcionario) {
  await modal({
    titulo: 'Registrar férias — ' + f.nome,
    corpo: <><div className="linha-campos"><Campo nome="inicio" rotulo="Início" tipo="date" req /><Campo nome="fim" rotulo="Fim" tipo="date" req /></div>
      <Campo nome="obs" rotulo="Observação" placeholder="Ex.: 1º período, vendeu 10 dias…" /></>,
    botoes: [{ txt: 'Registrar', acao: async (frm) => {
      const d = lerForm(frm)
      if (d.fim < d.inicio) throw new ErroApp('O fim é antes do início.')
      const p = { ...(S.get('funcionarios_privado', f.id) || {}) }
      p.ferias = [...(p.ferias || []), { inicio: d.inicio, fim: d.fim, obs: d.obs || undefined }].sort((a, b) => a.inicio < b.inicio ? -1 : 1)
      await API.rpc('salvar_funcionario', { p: { ...f, privado: p } })
      await App.gravou(['funcionarios', 'funcionarios_privado']); aviso('Férias registradas.')
    } }],
  })
}

export async function form(f?: Funcionario | null): Promise<string | null> {
  const novo = !f
  const b: Partial<Funcionario> = f || { ativo: true }
  const sal = Perm.pode('salarios'), priv = S.get('funcionarios_privado', b.id)
  const setores = U.unicos(S.lista('funcionarios').map(x => x.setor).filter((x): x is string => !!x))
  const funcoes = U.unicos(S.lista('funcionarios').map(x => x.funcao).filter((x): x is string => !!x))
  return modal<string>({
    titulo: novo ? 'Novo funcionário' : 'Editar funcionário',
    corpo: <>
      <Campo nome="nome" rotulo="Nome completo" valor={b.nome} req />
      <div className="linha-campos"><Campo nome="funcao" rotulo="Função" valor={b.funcao} attrs={{ list: 'lFuncao' }} /><Campo nome="setor" rotulo="Setor" valor={b.setor} attrs={{ list: 'lSetorEq' }} /></div>
      <datalist id="lFuncao">{funcoes.map(x => <option key={x} value={x} />)}</datalist><datalist id="lSetorEq">{setores.map(x => <option key={x} value={x} />)}</datalist>
      <div className="linha-campos"><Campo nome="telefone" rotulo="Telefone" tipo="tel" valor={b.telefone} /><Campo nome="admissao" rotulo="Admissão" tipo="date" valor={b.admissao} /></div>
      {sal && <>
        <h3 className="mt">Dados pessoais <span className="sub">(só Dono e Escritório veem)</span></h3>
        <div className="linha-campos"><Campo nome="salario" rotulo="Salário" tipo="dinheiro" valor={U.campoNum(priv?.salario)} /><Campo nome="nascimento" rotulo="Nascimento" tipo="date" valor={priv?.nascimento} /></div>
        <div className="linha-campos"><Campo nome="cpf" rotulo="CPF" valor={priv?.cpf} /><Campo nome="rg" rotulo="RG" valor={priv?.rg} /><Campo nome="pix" rotulo="Chave Pix" valor={priv?.pix} /></div>
        <Campo nome="endereco" rotulo="Endereço" valor={priv?.endereco} />
        <Campo nome="pobs" rotulo="Observações" tipo="area" valor={priv?.obs} linhas={2} />
      </>}
      {!novo && <Campo nome="ativo" rotulo="Trabalha na empresa (desmarque se foi desligado — o histórico fica)" tipo="check" valor={b.ativo} />}
    </>,
    botoes: [{ txt: novo ? 'Cadastrar' : 'Salvar', acao: async (frm) => {
      const d = lerForm(frm); if (novo) d.ativo = true
      const p: Record<string, unknown> = { id: b.id, nome: d.nome, funcao: d.funcao, setor: d.setor, telefone: d.telefone, admissao: d.admissao || null, ativo: d.ativo }
      if (sal) p.privado = { salario: d.salario, nascimento: d.nascimento || null, cpf: d.cpf, rg: d.rg, pix: d.pix, endereco: d.endereco, obs: d.pobs, ferias: priv?.ferias || [] }
      const id = await API.rpc<string>('salvar_funcionario', { p })
      await App.gravou(['funcionarios', 'funcionarios_privado']); aviso(novo ? 'Funcionário cadastrado.' : 'Salvo.'); return id
    } }],
  })
}
