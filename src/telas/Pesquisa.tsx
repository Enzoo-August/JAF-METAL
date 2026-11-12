/* Resultado da pesquisa rápida com a equipe (v3.3).
 * Só abre para quem está na lista de leitores do banco (pesquisa_leitores); nem o Dono vê sem estar nela.
 * As respostas são anônimas: aqui aparecem só as médias por setor e os comentários, sem nome. */
import { useEffect, useState } from 'react'
import { API } from '../lib/api.ts'
import * as U from '../lib/util.ts'
import { erro } from '../ui/avisos.ts'
import { BarraProg, Btn, Cab, Texto, Vazio } from '../ui/base.tsx'

interface Medias { melhorou: number | null; tarefa: number | null; futuro: number | null }
interface Setor extends Medias { setor: string; n: number }
interface Resultado { total: number; hoje: number; ultima: string | null; medias: Medias; tempo: Record<string, number>; setores: Setor[]; comentarios: { setor: string; texto: string; em: string }[] }

export const NOME_SETOR: Record<string, string> = {
  direcao: 'Dono / Direção', pcp: 'PCP', comercial: 'Comercial', rh: 'RH', almoxarifado: 'Almoxarifado', producao: 'Produção',
  financeiro: 'Financeiro / Escritório', engenharia: 'Engenharia / Qualidade', manutencao: 'Manutenção', outro: 'Outro',
}
const TEMPOS: [string, string, number][] = [['nada', 'Quase nada', 0], ['ate1', 'Até 1 hora', 0.5], ['1a3', '1 a 3 horas', 2], ['3a5', '3 a 5 horas', 4], ['mais5', 'Mais de 5 horas', 6]]

// quem pode ver: pergunta ao banco uma vez por sessão
let podeCache: { uid: string; pode: boolean } | null = null
export async function vePesquisa(): Promise<boolean> {
  const uid = API.sessao?.uid || ''
  if (podeCache?.uid === uid) return podeCache.pode
  let pode = false
  try { pode = !!(await API.rpc<boolean>('ve_pesquisa', {})) } catch { pode = false }
  podeCache = { uid, pode }
  return pode
}

const nota = (v: number | null | undefined) => v === null || v === undefined ? '—' : U.qtd(Number(v))
const cor = (v: number | null | undefined) => v === null || v === undefined ? undefined : Number(v) >= 7 ? 'var(--verde)' : Number(v) >= 5 ? 'var(--amarelo)' : 'var(--vermelho)'

export function TelaPesquisa() {
  const [r, setR] = useState<Resultado | null | 'sem'>(null)
  const carregar = async () => {
    try { setR(await API.rpc<Resultado>('resultado_pesquisa', {})) }
    catch (e) { if (/não pode/i.test(String((e as Error)?.message || ''))) setR('sem'); else { erro(e); setR('sem') } }
  }
  useEffect(() => { void carregar() }, [])

  if (r === null) return <><Cab titulo="Resultado da pesquisa" /><p className="sub">Carregando…</p></>
  if (r === 'sem') return <><Cab titulo="Resultado da pesquisa" /><Vazio icone="cadeado" titulo="Sem acesso" texto="Esta tela é particular." /></>

  const horas = r.total ? U.soma(TEMPOS, ([k, , h]) => (r.tempo[k] || 0) * h) / r.total : 0
  const maxT = Math.max(1, ...TEMPOS.map(([k]) => r.tempo[k] || 0))
  return <div id="telaPesquisa">
    <Cab titulo="Resultado da pesquisa" sub={<>Só você vê esta tela. As respostas são anônimas{r.ultima ? <> · última em {U.dataHora(r.ultima)}</> : null}.</>}>
      <Btn txt="Atualizar" icone="atualizar" data-pesq-atualizar="1" onClick={() => carregar()} />
    </Cab>
    {!r.total ? <Vazio icone="relogio" titulo="Ninguém respondeu ainda" texto="Assim que alguém responder, os números aparecem aqui." /> : <>
      <div className="grade g4">
        <div className="kpi"><small>Respostas</small><b data-pesq-total="1">{r.total}</b><span>{r.hoje ? `${r.hoje} hoje` : 'nenhuma hoje'}</span></div>
        <div className="kpi"><small>Vai melhorar o trabalho</small><b style={{ color: cor(r.medias.melhorou) }}>{nota(r.medias.melhorou)}<small style={{ display: 'inline', textTransform: 'none' }}> /10</small></b><span>média da pergunta 1</span></div>
        <div className="kpi"><small>Vai facilitar o setor</small><b style={{ color: cor(r.medias.tarefa) }}>{nota(r.medias.tarefa)}<small style={{ display: 'inline', textTransform: 'none' }}> /10</small></b><span>média da pergunta 2</span></div>
        <div className="kpi"><small>Vai ajudar a empresa</small><b style={{ color: cor(r.medias.futuro) }}>{nota(r.medias.futuro)}<small style={{ display: 'inline', textTransform: 'none' }}> /10</small></b><span>média da pergunta 4</span></div>
      </div>

      <section className="card mt"><h2>Por setor</h2>
        <div className="tabela-caixa mt"><table className="tabela" data-pesq-setores="1"><thead><tr><th>Setor</th><th>Respostas</th><th>Melhorar</th><th>Facilitar</th><th>Empresa</th></tr></thead><tbody>
          {r.setores.map(s => <tr key={s.setor}><td><b>{NOME_SETOR[s.setor] || s.setor}</b></td><td>{s.n}</td>
            <td style={{ color: cor(s.melhorou) }}>{nota(s.melhorou)}</td><td style={{ color: cor(s.tarefa) }}>{nota(s.tarefa)}</td><td style={{ color: cor(s.futuro) }}>{nota(s.futuro)}</td></tr>)}
        </tbody></table></div>
        <p className="peq mt">Notas de 0 a 10: verde de 7 para cima, amarelo de 5 a 6,9, vermelho abaixo de 5.</p>
      </section>

      <section className="card mt"><h2>Tempo que esperam economizar por semana</h2>
        <p className="sub">Em média, cerca de <b data-pesq-horas="1">{U.qtd(Math.round(horas * 10) / 10)} h</b> por pessoa, por semana.</p>
        <div className="lista mt">{TEMPOS.map(([k, t]) => <div key={k} className="linha"><div className="meio"><b>{t}</b><BarraProg v={r.tempo[k] || 0} de={maxT} /></div>
          <div className="lado"><b>{r.tempo[k] || 0}</b></div></div>)}</div>
      </section>

      <section className="card mt"><h2>Opiniões ({r.comentarios.length})</h2>
        {!r.comentarios.length ? <p className="sub">Ninguém escreveu opinião ainda.</p>
          : <div className="lista mt" data-pesq-comentarios="1">{r.comentarios.map((c, i) => <div key={i} className="linha"><div className="meio"><span><Texto t={c.texto} /></span>
            <small>{NOME_SETOR[c.setor] || c.setor} · {c.em.slice(8, 10)}/{c.em.slice(5, 7)}</small></div></div>)}</div>}
      </section>
    </>}
  </div>
}
