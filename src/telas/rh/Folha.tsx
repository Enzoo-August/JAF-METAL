/* Folha para a contabilidade:
 *  - eventos da folha (os códigos do sistema da contabilidade): os que vieram da contabilidade ficam como estão;
 *    o RH cadastra eventos novos sem mexer nem sobrescrever os que existem;
 *  - empresas (Matriz, Filial, Upgrade): razão social, CNPJ e o nome do arquivo;
 *  - exportação: um arquivo .xls por empresa, no mesmo modelo que a contabilidade mandou
 *    ("Planilha de Apontamento": Código, Nome, Cargo, Salário, Evento, Descrição, Ref./Valor, Tipo Empregado). */
import { useState } from 'react'
import { App } from '../../app/controle.tsx'
import { API } from '../../lib/api.ts'
import { S } from '../../lib/dados.ts'
import type * as R from '../../lib/rh.ts'
import type { Funcionario, OrigemEvento, RhEventoFolha } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { entregar, xlsx } from '../../ui/arquivos.tsx'
import { aviso } from '../../ui/avisos.ts'
import { Btn, Campo, Tag, Vazio } from '../../ui/base.tsx'
import { Ic } from '../../ui/icones.tsx'
import { lerForm, modal } from '../../ui/janelas.tsx'
import { contaBeneficio, vinculoNoMes } from './Beneficios.tsx'
import { salarioHE } from './comum.tsx'
import { exportarFechamento, pessoasDoMes, resumoDe } from './Ponto.tsx'

export const ORIGENS: Record<OrigemEvento, string> = {
  he50: 'Horas extras 50% (horas)', he60: 'Horas extras 60% (horas)', he80: 'Horas extras 80% (horas)', he100: 'Horas extras 100% (horas)',
  faltas_dias: 'Faltas (dias)', dsr_dias: 'DSR perdido por falta (dias)', atrasos_horas: 'Atrasos / faltas em horas',
  beneficio_desconto: 'Benefício: desconto do funcionário (R$)', beneficio_empresa: 'Benefício: valor fornecido (R$)', manual: 'Em branco (a contabilidade preenche)',
}

// ---------------------------------------------------------------- empresas (config "rh" → empresas_folha)
export interface EmpresaFolha { registro: 'Matriz' | 'Filial' | 'Upgrade'; razao: string; cnpj: string; prefixo: string }
const PADRAO: EmpresaFolha[] = [{ registro: 'Matriz', razao: '', cnpj: '', prefixo: 'JAF' }, { registro: 'Filial', razao: '', cnpj: '', prefixo: 'JAFII' }, { registro: 'Upgrade', razao: '', cnpj: '', prefixo: 'UPGRADE' }]
export const empresasFolha = (): EmpresaFolha[] => {
  const c = S.cfg<{ empresas_folha?: EmpresaFolha[] }>('rh', {}).empresas_folha || []
  return PADRAO.map(p => ({ ...p, ...(c.find(x => x.registro === p.registro) || {}) }))
}
export const codigoFolha = (f: Funcionario): number | null => { const d = String(f.matricula || '').replace(/\D/g, ''); return d ? Number(d) : null }
export const eventosAtivos = (): RhEventoFolha[] => U.ordenar(S.lista('rh_eventos_folha').filter(e => e.ativo), e => e.ordem * 100000 + e.codigo)

// número de cada evento para uma pessoa no mês (vazio = a contabilidade preenche)
export function valorEvento(e: RhEventoFolha, f: Funcionario, r: R.ResumoMes, m: string): number | null {
  const h = (n: number) => n > 0 ? U.r2(n) : null
  switch (e.origem) {
    case 'he50': return h(r.faixas.p50)
    case 'he60': return h(r.faixas.p60)
    case 'he80': return h(r.faixas.p80)
    case 'he100': return h(r.faixas.p100)
    case 'faltas_dias': return r.faltas > 0 ? r.faltas : null
    case 'dsr_dias': return r.dsr > 0 ? r.dsr : null
    case 'atrasos_horas': return h(r.atraso)
    case 'beneficio_desconto': case 'beneficio_empresa': {
      const b = S.get('rh_beneficios', e.beneficio_id); if (!b) return null
      const v = S.lista('rh_beneficio_vinculos').find(x => x.funcionario_id === f.id && x.beneficio_id === b.id && vinculoNoMes(x, m)); if (!v) return null
      const c = contaBeneficio(b, v)
      return h(e.origem === 'beneficio_desconto' ? c.desconto : c.valor)
    }
    default: return null
  }
}

// ---------------------------------------------------------------- Ajustes → Eventos da folha
export function EventosFolha() {
  const l = U.ordenar(S.lista('rh_eventos_folha'), e => (e.ativo ? 0 : 1) * 1e9 + e.ordem * 100000 + e.codigo)
  return <>
    <div className="barra-filtros"><p className="sub" style={{ flex: 1 }}>Os códigos são os do sistema da contabilidade. Os que vieram dela não mudam de código nem de nome; cadastre um evento novo quando a contabilidade criar outro código.</p>
      <Btn txt="Novo evento" icone="mais" cls="pri" data-aj="evento" onClick={() => void formEvento()} /></div>
    <div className="lista mt" id="lEventos">{l.length ? l.map(e => <div key={e.id} className="linha clicavel" data-evento={e.codigo} onClick={() => void formEvento(e)}>
      <div className="meio"><b><span className="mono">{e.codigo}</span> · {e.descricao}{e.padrao && <> <Ic n="cadeado" /></>}</b>
        <small>{ORIGENS[e.origem]}{e.beneficio_id ? ' · ' + (S.get('rh_beneficios', e.beneficio_id)?.nome || '') : ''}</small></div>
      <div className="lado">{e.ativo ? <Tag s={{ txt: 'No arquivo', cor: 'verde' }} /> : <Tag s={{ txt: 'Desativado', cor: 'cinza' }} />}</div></div>)
      : <Vazio icone="lista" titulo="Nenhum evento" />}</div>
  </>
}
async function formEvento(e?: RhEventoFolha): Promise<void> {
  await modal({
    titulo: e ? `Evento ${e.codigo}` : 'Novo evento da folha',
    corpo: <CorpoEvento e={e} />,
    botoes: [{ txt: e ? 'Salvar' : 'Cadastrar', acao: async (f) => {
      const d = lerForm(f)
      if (!f.dataset.envio) f.dataset.envio = e?.id || U.uuid()
      await API.rpc('rh_salvar_evento', { p: { ...d, id: f.dataset.envio, codigo: e ? e.codigo : d.codigo, ativo: e ? d.ativo : true } })
      await App.gravou(['rh_eventos_folha']); aviso(e ? 'Evento salvo.' : 'Evento cadastrado.'); return true
    } }],
  })
}
function CorpoEvento({ e }: { e?: RhEventoFolha }) {
  const [orig, setOrig] = useState<OrigemEvento>(e?.origem || 'manual')
  const bens = U.ordenar(S.lista('rh_beneficios'), b => U.sem(b.nome))
  const [cod, setCod] = useState('')
  const dup = !e && cod ? S.lista('rh_eventos_folha').find(x => String(x.codigo) === cod.trim()) : null
  return <>
    <div className="linha-campos l2">
      {e ? <div className="campo"><label>Código</label><input value={e.codigo} readOnly className="mono" /><small>O código não muda.</small></div>
        : <Campo nome="codigo" rotulo="Código (o da contabilidade)" req tipo="text" attrs={{ inputMode: 'numeric', onInput: (x: { currentTarget: HTMLInputElement }) => setCod(x.currentTarget.value) }} foco />}
      {e?.padrao ? <div className="campo"><label>Descrição</label><input value={e.descricao} readOnly /><small>Veio da contabilidade: o nome não muda.</small></div>
        : <Campo nome="descricao" rotulo="Descrição" req valor={e?.descricao} placeholder="Como está na contabilidade" />}
    </div>
    {dup && <p className="nota vermelha">O código {dup.codigo} já existe ({dup.descricao}). Não dá para cadastrar de novo nem sobrescrever.</p>}
    <Campo nome="origem" rotulo="De onde vem o número de cada pessoa" tipo="select" valor={orig} opcoes={Object.entries(ORIGENS).map(([v, t]) => ({ v, t }))}
      attrs={{ onChange: (x: { currentTarget: HTMLSelectElement }) => setOrig(x.currentTarget.value as OrigemEvento), semBusca: true }} />
    {orig.startsWith('beneficio') && <Campo nome="beneficio_id" rotulo="Benefício" tipo="select" req valor={e?.beneficio_id || ''} opcoes={[{ v: '', t: 'Escolha o benefício' }, ...bens.map(b => ({ v: b.id, t: b.nome }))]} attrs={{ semBusca: true }} />}
    {e && <Campo nome="ativo" rotulo="Sai no arquivo da contabilidade" tipo="check" valor={e.ativo} />}
  </>
}

// ---------------------------------------------------------------- Ajustes → Empresas
export function EmpresasFolha() {
  const l = empresasFolha()
  return <>
    <p className="sub">Os dados do cabeçalho de cada arquivo da contabilidade (um arquivo por registro). O nome do arquivo sai como <b>PREFIXO.ORIGEM_dia.AAAAMM.xls</b>.</p>
    <div className="lista mt" id="lEmpFolha">{l.map(x => <div key={x.registro} className="linha clicavel" data-emp={x.registro} onClick={() => void formEmpresa(x)}>
      <div className="meio"><b>{x.registro}</b><small>{x.razao || <span className="txt-amarelo">razão social não preenchida</span>} · {x.cnpj || <span className="txt-amarelo">sem CNPJ</span>}</small></div>
      <div className="lado"><b className="mono">{x.prefixo}</b><small>arquivo</small></div></div>)}</div>
  </>
}
async function formEmpresa(x: EmpresaFolha): Promise<void> {
  await modal({
    titulo: 'Empresa · ' + x.registro,
    corpo: <><Campo nome="razao" rotulo="Razão social" req valor={x.razao} foco /><div className="linha-campos l2"><Campo nome="cnpj" rotulo="CNPJ" req valor={x.cnpj} placeholder="00.000.000/0000-00" />
      <Campo nome="prefixo" rotulo="Começo do nome do arquivo" req valor={x.prefixo} /></div></>,
    botoes: [{ txt: 'Salvar', acao: async (f) => {
      const d = lerForm(f)
      const cnpj = String(d.cnpj).replace(/\D/g, '')
      if (cnpj.length !== 14) throw new Error('CNPJ com 14 números')
      const lista = empresasFolha().map(e => e.registro === x.registro ? { ...e, razao: String(d.razao).toUpperCase(), cnpj: cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'), prefixo: String(d.prefixo).toUpperCase().replace(/[^A-Z0-9_-]/g, '') } : e)
      await API.rpc('salvar_config', { p_chave: 'rh', p_valor: { ...S.cfg<Record<string, unknown>>('rh', {}), empresas_folha: lista } })
      await App.gravou(['config']); aviso('Empresa salva.'); return true
    } }],
  })
}

// ---------------------------------------------------------------- exportar para a contabilidade
interface Arquivo { emp: EmpresaFolha; pessoas: { f: Funcionario; cod: number; r: R.ResumoMes }[]; linhas: (string | number | null)[][] }

function montar(m: string): { arquivos: Arquivo[]; semCodigo: Funcionario[]; repetidos: string[]; foraDoArquivo: Funcionario[]; eventos: RhEventoFolha[] } {
  const evs = eventosAtivos()
  const pessoas = pessoasDoMes(m)
  const semCodigo: Funcionario[] = [], foraDoArquivo: Funcionario[] = [], repetidos: string[] = []
  const arquivos = empresasFolha().map(emp => {
    const ps = pessoas.filter(f => f.registro === emp.registro)
    const vistos = new Map<number, Funcionario>()
    const ok: Arquivo['pessoas'] = []
    for (const f of ps) {
      const cod = codigoFolha(f)
      if (cod === null) { semCodigo.push(f); continue }
      const outro = vistos.get(cod)
      if (outro) { repetidos.push(`${emp.registro} ${cod}: ${outro.nome} e ${f.nome}`); continue }
      vistos.set(cod, f); ok.push({ f, cod, r: resumoDe(f, m) })
    }
    ok.sort((a, b) => a.cod - b.cod)
    const linhas = ok.flatMap(({ f, cod, r }) => evs.map(e => [cod, f.nome.toUpperCase(), (f.funcao || '').toUpperCase(), salarioHE(f, m) || null, e.codigo, e.descricao, valorEvento(e, f, r, m), 'Funcionário']))
    return { emp, pessoas: ok, linhas }
  })
  for (const f of pessoas) if (!['Matriz', 'Filial', 'Upgrade'].includes(f.registro || '')) foraDoArquivo.push(f)
  return { arquivos, semCodigo, repetidos, foraDoArquivo, eventos: evs }
}

export const montarFolha = (m: string) => montar(m)
const serialExcel = (iso: string) => Math.round((Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) - Date.UTC(1899, 11, 30)) / 864e5)
export const nomeArquivoFolha = (prefixo: string, m: string, dia = U.hoje().slice(8, 10)) => `${prefixo}.ORIGEM_${dia}.${m.replace('-', '')}.xls`

async function gerarXls(a: Arquivo, m: string): Promise<void> {
  const X = await xlsx()
  const aoa: (string | number | null)[][] = [['Planilha de Apontamento', '', '', '', 'Referência', null, '', ''], ['Razão Social', a.emp.razao, '', '', 'CNPJ/CEI/CPF:', a.emp.cnpj, '', ''],
    ['', '', '', '', '', '', '', ''], ['Código', 'Nome', 'Cargo', 'Salário', 'Evento', 'Descrição', 'Ref./Valor', 'Tipo Empregado'], ...a.linhas.map(l => l.map(v => v === null ? '' : v))]
  const ws = X.utils.aoa_to_sheet(aoa)
  ws['F1'] = { t: 'n', v: serialExcel(m + '-01'), z: 'dd/mm/yyyy' }
  ws['!cols'] = [{ wch: 8 }, { wch: 38 }, { wch: 30 }, { wch: 11 }, { wch: 8 }, { wch: 30 }, { wch: 10 }, { wch: 14 }]
  const wb = X.utils.book_new()
  X.utils.book_append_sheet(wb, ws, 'Plan1')
  await entregar(new Blob([X.write(wb, { bookType: 'biff8', type: 'array' })], { type: 'application/vnd.ms-excel' }), nomeArquivoFolha(a.emp.prefixo, m))
}

export async function exportarContabilidade(m: string): Promise<void> {
  await S.garantir(['funcionarios', 'funcionarios_privado', 'rh_ponto', 'rh_ausencias', 'rh_feriados', 'rh_eventos_folha', 'rh_beneficios', 'rh_beneficio_vinculos', 'config'])
  await modal({ titulo: `Exportar para a contabilidade · ${U.nomeMes(Number(m.slice(5)))}/${m.slice(0, 4)}`, largura: 'grande', corpo: <Exportar m={m} /> })
}
function Exportar({ m }: { m: string }) {
  const x = montar(m)
  const faltaEmp = x.arquivos.filter(a => a.pessoas.length && (!a.emp.razao || !a.emp.cnpj))
  const problemas = x.semCodigo.length + x.repetidos.length + faltaEmp.length
  const [baixando, setBaixando] = useState('')
  const baixar = async (a: Arquivo) => { setBaixando(a.emp.registro); try { await gerarXls(a, m) } finally { setBaixando('') } }
  const tot = (a: Arquivo, e: RhEventoFolha) => U.soma(a.linhas.filter(l => l[4] === e.codigo), l => Number(l[6]) || 0)
  return <>
    <p className="sub">Um arquivo por empresa, no modelo da contabilidade (Planilha de Apontamento), com {U.plural(x.eventos.length, 'evento')} por pessoa. Horas em decimal (6,5 = 6 h 30 min). <a href="#/rh/ajustes?aba=eventos">Eventos</a> · <a href="#/rh/ajustes?aba=empresas">Empresas</a></p>
    <div className={'nota mt ' + (problemas ? 'amarela' : 'verde')} id="folhaConf">
      {problemas ? <><b>Confira antes de mandar:</b><ul>
        {faltaEmp.map(a => <li key={a.emp.registro}>{a.emp.registro}: falta a razão social ou o CNPJ (Ajustes do RH › Empresas).</li>)}
        {x.semCodigo.length > 0 && <li>{U.plural(x.semCodigo.length, 'pessoa')} sem matrícula (o código da contabilidade) ficou fora: {x.semCodigo.map(f => f.nome).join(', ')}.</li>}
        {x.repetidos.map(t => <li key={t}>Código repetido — {t} (só a primeira entrou).</li>)}
      </ul></> : <><Ic n="ok" /> Tudo certo: todas as pessoas têm código e as empresas estão preenchidas.</>}
      {x.foraDoArquivo.length > 0 && <p className="peq">{U.plural(x.foraDoArquivo.length, 'pessoa')} sem registro (Matriz/Filial/Upgrade) não entra{x.foraDoArquivo.length > 1 ? 'm' : ''} em nenhum arquivo: {x.foraDoArquivo.map(f => f.nome).join(', ')}.</p>}
    </div>
    <div className="lista mt" id="folhaArqs">{x.arquivos.map(a => <div key={a.emp.registro} className="linha" data-folha={a.emp.registro}>
      <div className="meio"><b>{a.emp.registro} · <span className="mono">{nomeArquivoFolha(a.emp.prefixo, m)}</span></b>
        <small>{U.plural(a.pessoas.length, 'pessoa')} · {U.plural(a.linhas.length, 'linha')}</small>
        <small>{x.eventos.filter(e => tot(a, e)).map(e => `${e.codigo}: ${U.dec(tot(a, e)).replace(',00', '')}`).join(' · ') || 'nenhum evento com valor no mês'}</small></div>
      <div className="lado"><Btn txt={baixando === a.emp.registro ? 'Gerando…' : 'Baixar .xls'} icone="baixar" cls="pri mini" disabled={!a.pessoas.length || !!baixando} onClick={() => baixar(a)} /></div></div>)}</div>
    <p className="sub mt">Quer conferir as horas de cada um antes? <button type="button" className="btn fantasma mini" data-folha="conferencia" onClick={() => void exportarFechamento(m, pessoasDoMes(m).map(f => ({ f, r: resumoDe(f, m) })))}>Planilha de conferência (Excel)</button></p>
  </>
}
