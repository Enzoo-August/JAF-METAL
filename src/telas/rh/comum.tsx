/* RH — pedaços usados em todas as telas do RH (situação da pessoa, etiquetas, anexos, listas de escolha) */
import { useRef, useState, type ReactNode } from 'react'
import { App } from '../../app/controle.tsx'
import { API } from '../../lib/api.ts'
import { C, S } from '../../lib/dados.ts'
import { Perm } from '../../lib/perm.ts'
import * as R from '../../lib/rh.ts'
import type { Cor, Funcionario, RhAnexo, Situacao, TipoAusencia } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { aviso, erro } from '../../ui/avisos.ts'
import { entregar } from '../../ui/arquivos.tsx'
import { Tag } from '../../ui/base.tsx'
import { Ic } from '../../ui/icones.tsx'
import { confirmar } from '../../ui/janelas.tsx'

export const pode = (): boolean => Perm.pode('rh_editar')
export const sensivel = (): boolean => Perm.pode('rh_sensivel')
export const nomeF = (id: string | null | undefined): string => S.get('funcionarios', id)?.nome || ''
export const primeiroNome = (n: string | null | undefined): string => String(n || '').trim().split(' ')[0]
export const jornada = (): R.Jornada => R.jornadaDe(S.cfg('rh', {}))
export const REGISTROS = ['Matriz', 'Filial', 'Upgrade', 'Sem registro'] as const

export const ativos = (): Funcionario[] => U.ordenar(S.lista('funcionarios').filter(f => f.ativo), f => U.sem(f.nome))
export const opcoesPessoas = (vazio = 'Escolha a pessoa', lista = ativos()) => [{ v: '', t: vazio }, ...lista.map(f => ({ v: f.id, t: f.nome }))]
export const opcoesSetores = (vazio = '—') => {
  const nomes = U.unicos([...S.lista('rh_setores').filter(s => s.ativo).map(s => s.nome), ...S.lista('funcionarios').map(f => f.setor).filter((x): x is string => !!x)])
  return [{ v: '', t: vazio }, ...U.ordenar(nomes, x => U.sem(x)).map(x => ({ v: x, t: x }))]
}
export const opcoesCargos = (vazio = '—') =>
  [{ v: '', t: vazio }, ...U.ordenar(S.lista('rh_cargos').filter(c => c.ativo), c => U.sem(c.nome)).map(c => ({ v: c.id, t: c.nome + (c.cbo ? ` (CBO ${c.cbo})` : '') }))]

// salário usado nas horas extras: o que vale no mês pela linha do tempo de cargo e salário (reajuste do cargo,
// promoção, dissídio…); sem linha do tempo, o salário do cadastro. m = 'AAAA-MM' (vazio = hoje)
export const salarioHE = (f: Funcionario, m?: string): number => {
  const ate = m ? U.somaDias(U.somaMeses(m + '-01', 1), -1) : U.hoje()
  const h = S.lista('rh_historico').filter(x => x.funcionario_id === f.id && x.salario && x.vigencia <= ate)
    .sort((a, b) => a.vigencia < b.vigencia ? 1 : a.vigencia > b.vigencia ? -1 : (a.criado_em < b.criado_em ? 1 : -1))[0]
  return Number(h?.salario) || Number(S.get('funcionarios_privado', f.id)?.salario) || 0
}

// salário de referência do cargo (só RH, Escritório e Dono recebem)
export const salarioCargo = (cargoId: string | null | undefined): number => Number(S.get('rh_cargos_salarios', cargoId)?.salario) || 0

// ausência que pega o dia (férias, atestado…)
export const ausenciaNoDia = (fid: string, dia: string) =>
  S.lista('rh_ausencias').find(a => a.funcionario_id === fid && a.inicio <= dia && (a.fim === null || a.fim >= dia)) || null

export function situacaoFunc(f: Funcionario): Situacao {
  if (f.situacao === 'desligado' || !f.ativo) return { cod: 'desligado', txt: 'Desligado', cor: 'cinza' }
  const hoje = ausenciaNoDia(f.id, U.hoje())
  if (hoje?.tipo === 'ferias') return { cod: 'ferias', txt: 'De férias', cor: 'azul' }
  if (hoje && R.TRAVA.has(hoje.tipo)) return { cod: 'afastado', txt: TIPO_AUS[hoje.tipo], cor: 'amarelo' }
  if (f.situacao === 'afastado') return { cod: 'afastado', txt: 'Afastado', cor: 'amarelo' }
  if (hoje) return { cod: 'ausente', txt: TIPO_AUS[hoje.tipo] + ' hoje', cor: 'amarelo' }
  if (R.experiencia(f.admissao)) return { cod: 'experiencia', txt: 'Em experiência', cor: 'azul' }
  return { cod: 'ativo', txt: 'Trabalhando', cor: 'verde' }
}

export const COR_SEM: Record<R.Semaforo, Cor> = { verde: 'verde', amarelo: 'amarelo', vermelho: 'vermelho' }
const COR_FERIAS: Record<R.SitFerias, Cor> = { vencido: 'vermelho', vence30: 'vermelho', vence60: 'amarelo', emdia: 'verde', formando: 'cinza', gozado: 'verde' }
export function TagFerias({ s }: { s: R.SitFerias }) {
  return <span className={`tag t-${COR_FERIAS[s]}${s === 'vencido' || s === 'vence30' ? ' pisca' : ''}`}>{R.TXT_FERIAS[s]}</span>
}
// etiqueta de vencimento (vermelho vencido, amarelo vencendo, verde em dia)
export function TagVence({ venc, ok = 'Em dia', amarelo = 60, pisca = false }: { venc: string | null; ok?: string; amarelo?: number; pisca?: boolean }) {
  const s = R.semaforoData(venc, U.hoje(), amarelo)
  if (!s) return null
  const txt = s === 'vermelho' ? 'Vencido' : s === 'amarelo' ? 'Vence ' + U.relativo(venc) : ok
  return <span className={`tag t-${COR_SEM[s]}${pisca && s !== 'verde' ? ' pisca' : ''}`}>{txt}</span>
}

// ------------------------------------------------------------------ anexos (PDF / foto) — certificados, exames, documentos assinados
export const TIPOS_OK = ['application/pdf', 'image/jpeg', 'image/png']
export const lerBase64 = (f: File) => new Promise<string>((ok, falha) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => falha(r.error); r.readAsDataURL(f) })
export async function abrirAnexo(a: Pick<RhAnexo, 'id'>): Promise<void> {
  const r = await API.rpc<{ nome: string; tipo: string; conteudo: string }>('rh_baixar_anexo', { p_id: a.id })
  const bin = Uint8Array.from(atob(r.conteudo), c => c.charCodeAt(0))
  await entregar(new Blob([bin], { type: r.tipo }), r.nome)
}
export const anexosDe = (tabela: string, registro: string) => S.lista('rh_anexos').filter(a => a.registro_id === registro && a.tabela === tabela)

export function Anexos({ tabela, registro, titulo = 'Arquivos anexados', vazio = 'Nenhum arquivo.' }: { tabela: string; registro: string; titulo?: string; vazio?: string }) {
  const [ocup, setOcup] = useState(false)
  const inp = useRef<HTMLInputElement>(null)
  if (!sensivel()) return null
  const lista = anexosDe(tabela, registro)
  const enviar = async (arqs: FileList | null) => {
    if (!arqs?.length) return
    setOcup(true)
    try {
      for (const f of Array.from(arqs)) {
        if (!TIPOS_OK.includes(f.type)) { aviso(`${f.name}: só PDF, JPG ou PNG.`, 'erro'); continue }
        if (f.size > 4 * 1024 * 1024) { aviso(`${f.name}: maior que 4 MB.`, 'erro'); continue }
        await API.rpc('rh_anexar', { p: { tabela, registro_id: registro, nome: f.name, tipo: f.type, conteudo: await lerBase64(f) } })
      }
      await App.gravou(['rh_anexos'], { inteira: ['rh_anexos'] }); aviso('Arquivo anexado.')
    } catch (e) { erro(e) } finally { setOcup(false); if (inp.current) inp.current.value = '' }
  }
  return <div className="anexos" data-anexos={tabela}>
    <p className="anexos-tit"><Ic n="link" /> {titulo}</p>
    {lista.length ? <ul>{lista.map(a => <li key={a.id}>
      <button type="button" className="link" onClick={() => void abrirAnexo(a).catch(erro)}>{a.nome}</button> <span className="fraco">{Math.ceil(a.tamanho / 1024)} KB · {U.dataCurta(a.criado_em)}</span>
      {pode() && <button type="button" className="icone-btn mini" aria-label={'Apagar ' + a.nome} onClick={async () => {
        if (!(await confirmar(`Apagar o arquivo "${a.nome}"?`, { ok: 'Apagar', perigo: true }))) return
        try { await API.rpc('rh_excluir_anexo', { p_id: a.id }); await App.gravou(['rh_anexos'], { inteira: ['rh_anexos'] }) } catch (e) { erro(e) }
      }}><Ic n="lixo" /></button>}</li>)}</ul> : <p className="sub">{vazio}</p>}
    {pode() && <label className={`btn sec mini${ocup ? ' carregando' : ''}`}><Ic n="enviar" /><span>{ocup ? 'Enviando…' : 'Anexar PDF ou foto'}</span>
      <input ref={inp} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" multiple hidden disabled={ocup} onChange={(e) => void enviar(e.target.files)} /></label>}
  </div>
}

// cor do círculo com a inicial (a mesma pessoa tem sempre a mesma cor)
export const corAvatar = (nome: string): string => 'avatar c' + ([...(nome || '')].reduce((t, c) => t + c.charCodeAt(0), 0) % 5)

// ------------------------------------------------------------------ linha de pessoa (listas)
export function LinhaPessoa({ f, direita, sub, href }: { f: Funcionario; direita?: ReactNode; sub?: ReactNode; href?: string }) {
  return <a className="linha" href={href || '#/funcionario/' + f.id} data-func={f.id}><span className={corAvatar(f.nome)}>{f.nome.charAt(0).toUpperCase()}</span>
    <div className="meio"><b>{f.nome}</b><small>{sub ?? ([f.funcao, f.setor, f.registro].filter(Boolean).join(' · ') || '—')}</small></div>
    <div className="lado">{direita ?? <Tag s={situacaoFunc(f)} />}</div></a>
}

// "02/06/2026 a 11/06/2026 (10 dias)"
export const periodo = (ini: string, fim: string | null): string =>
  fim ? `${U.data(ini)} a ${U.data(fim)} (${U.plural(U.dias(ini, fim) + 1, 'dia')})` : `desde ${U.data(ini)} (sem data para voltar)`

export const TIPO_AUS: Record<TipoAusencia, string> = { ferias: 'Férias', atestado: 'Atestado médico', afastamento: 'Afastamento (INSS)', licenca: 'Licença', suspensao: 'Suspensão', folga: 'Folga', falta: 'Falta', declaracao: 'Declaração de horas' }
export const empresaDe = () => S.cfg<{ nome?: string; razao?: string; cnpj?: string; cidade?: string; uf?: string }>('empresa', {})
export const razaoEmpresa = (): string => empresaDe().razao || empresaDe().nome || 'JAF Metal'
export const cidadeEmpresa = (): string => empresaDe().cidade || 'São Paulo'
export const dataExtenso = (iso: string): string => { const d = U.d(iso)!; return `${d.getDate()} de ${U.nomeMes(d.getMonth() + 1)} de ${d.getFullYear()}` }

// férias da pessoa (situação mais urgente) — reaproveita a conta do cálculo geral
export const feriasDe = (f: Funcionario) => C.ferias(f)
