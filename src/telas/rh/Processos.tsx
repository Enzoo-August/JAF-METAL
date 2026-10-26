/* RH — Processos trabalhistas (a aba "PROCESSOS" da relação de funcionários). Confidencial: só RH, Escritório e Dono. */
import { App } from '../../app/controle.tsx'
import { API } from '../../lib/api.ts'
import { S } from '../../lib/dados.ts'
import type { Cor, RhProcesso } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { aviso } from '../../ui/avisos.ts'
import { Btn, Cab, Campo, Chips, Tag, Vazio } from '../../ui/base.tsx'
import { useLembrar } from '../../ui/ganchos.ts'
import { Ic } from '../../ui/icones.tsx'
import { confirmar, lerForm, modal } from '../../ui/janelas.tsx'
import { Anexos, nomeF, opcoesPessoas, pode } from './comum.tsx'

const SIT: Record<RhProcesso['situacao'], [string, Cor]> = { andamento: ['Em andamento', 'amarelo'], acordo: ['Acordo', 'azul'], ganho: ['Ganho', 'verde'], perdido: ['Perdido', 'vermelho'], arquivado: ['Arquivado', 'cinza'] }

export function TelaProcessos() {
  const [f, setF] = useLembrar('proc.f', 'andamento')
  const todos = S.lista('rh_processos')
  const l = U.ordenar(todos.filter(p => !f || p.situacao === f), p => p.data_autuacao || '', true)
  return <>
    <Cab titulo="Processos trabalhistas" sub="Confidencial: só RH, Escritório e Dono veem.">
      {pode() && <Btn txt="Novo processo" icone="mais" cls="pri" data-proc="novo" onClick={() => void formProcesso()} />}
    </Cab>
    <Chips atual={f} aoEscolher={setF} nome="pf" opcoes={[{ v: 'andamento', t: 'Em andamento', n: todos.filter(p => p.situacao === 'andamento').length }, { v: '', t: 'Todos', n: todos.length }]} />
    <div className="lista mt">{l.length ? l.map(p => <div key={p.id} className={`linha${pode() ? ' clicavel' : ''}`} data-proc={p.id} onClick={() => pode() && void formProcesso(p)}>
      <span className="sinal sai"><Ic n="admin" /></span>
      <div className="meio"><b>{p.autor}{p.funcionario_id && nomeF(p.funcionario_id) !== p.autor ? ` (${nomeF(p.funcionario_id)})` : ''}</b>
        <small>{[p.numero, p.data_autuacao && 'autuado em ' + U.data(p.data_autuacao), p.advogado].filter(Boolean).join(' · ')}</small></div>
      <div className="lado"><Tag s={{ txt: SIT[p.situacao][0], cor: SIT[p.situacao][1] }} />{p.valor ? <small>{U.moeda(p.valor)}</small> : null}</div></div>)
      : <Vazio icone="ok" titulo="Nenhum processo aqui" />}</div>
  </>
}

async function formProcesso(p?: RhProcesso) {
  await modal({
    titulo: p ? 'Processo — ' + p.autor : 'Novo processo trabalhista',
    corpo: <>
      <div className="linha-campos"><Campo nome="autor" rotulo="Quem abriu (autor)" valor={p?.autor} req /><Campo nome="funcionario_id" rotulo="É funcionário / ex-funcionário" tipo="select" valor={p?.funcionario_id}
        opcoes={opcoesPessoas('—', U.ordenar(S.lista('funcionarios'), x => U.sem(x.nome)))} /></div>
      <div className="linha-campos"><Campo nome="numero" rotulo="Nº do processo" valor={p?.numero} /><Campo nome="data_autuacao" rotulo="Data da autuação" tipo="date" valor={p?.data_autuacao} /></div>
      <div className="linha-campos"><Campo nome="advogado" rotulo="Advogado do autor" valor={p?.advogado} /><Campo nome="cnpj_advogado" rotulo="CNPJ do escritório" valor={p?.cnpj_advogado} /></div>
      <div className="linha-campos"><Campo nome="situacao" rotulo="Situação" tipo="select" valor={p?.situacao || 'andamento'} opcoes={Object.entries(SIT).map(([v, [t]]) => ({ v, t }))} />
        <Campo nome="valor" rotulo="Valor (acordo / condenação)" tipo="dinheiro" valor={U.campoNum(p?.valor)} /></div>
      <Campo nome="obs" rotulo="Observações" tipo="area" linhas={3} valor={p?.obs} />
      {p && <Anexos tabela="rh_processos" registro={p.id} titulo="Documentos do processo" />}
    </>,
    botoes: [...(p ? [{ txt: 'Apagar', cls: 'perigo-txt', validar: false, acao: async () => {
      if (!(await confirmar('Apagar este processo?', { ok: 'Apagar', perigo: true }))) return false
      await API.rpc('rh_salvar_processo', { p: { id: p.id, excluir: true } }); await App.gravou(['rh_processos'], { inteira: ['rh_processos'] })
    } }] : []), { txt: 'Salvar', acao: async (frm: HTMLFormElement) => {
      const d = lerForm(frm)
      await API.rpc('rh_salvar_processo', { p: { ...d, id: p?.id, funcionario_id: d.funcionario_id || null, data_autuacao: d.data_autuacao || null } })
      await App.gravou(['rh_processos']); aviso('Processo salvo.')
    } }],
  })
}
