/* RH — Relatórios: quadro de pessoas, turnover, absenteísmo, horas extras do ano (como as tabelas da planilha de HE) e custo por setor */
import type { ReactNode } from 'react'
import { S } from '../../lib/dados.ts'
import * as R from '../../lib/rh.ts'
import type { Funcionario, RhPonto } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { entregar, excelLinhas, pdfTabela, type ColunaPdf } from '../../ui/arquivos.tsx'
import { Btn, Cab, Chips, Vazio } from '../../ui/base.tsx'
import { useLembrar } from '../../ui/ganchos.ts'
import { REGISTROS, sensivel } from './comum.tsx'
import { feriadosMap, resumoDe } from './Ponto.tsx'

const ultimosMeses = (n: number) => Array.from({ length: n }, (_, i) => U.somaMeses(U.hoje().slice(0, 7) + '-01', -(n - 1 - i)).slice(0, 7))
const rotMes = (m: string) => U.mes(m + '-01')
// estava na empresa no último dia do mês?
const naEmpresa = (f: Funcionario, dia: string) => !!f.admissao && f.admissao <= dia && (!f.demissao || f.demissao >= dia)

interface Tabela { titulo: string; sub: string; cab: string[]; linhas: (string | number)[][]; total?: (string | number)[]; alinhar?: ('right' | undefined)[] }

export function TelaRelatoriosRH() {
  const [r, setR] = useLembrar('rrh.r', 'quadro')
  const sens = sensivel()
  const opcoes = [{ v: 'quadro', t: 'Quadro de pessoas' }, { v: 'turnover', t: 'Entradas e saídas (turnover)' }, { v: 'absenteismo', t: 'Absenteísmo' }, { v: 'he', t: 'Horas extras do ano' }]
  if (sens) opcoes.push({ v: 'custo', t: 'Custo por setor' })
  const t: Tabela = r === 'turnover' ? turnover() : r === 'absenteismo' ? absenteismo() : r === 'he' ? horasExtras(sens) : r === 'custo' && sens ? custo() : quadro()
  return <>
    <Cab titulo="Relatórios do RH" sub={t.sub}>
      <Btn txt="PDF" icone="imprimir" data-rrh="pdf" onClick={async () => {
        const cols: ColunaPdf[] = t.cab.map((c, i) => ({ t: c, alinhar: t.alinhar?.[i] }))
        await entregar(await pdfTabela(t.titulo, t.sub, cols, t.linhas, { totais: t.total, deitado: t.cab.length > 7 }), t.titulo + '.pdf')
      }} />
      <Btn txt="Excel" icone="planilha" data-rrh="excel" onClick={() => excelLinhas(t.titulo + '.xlsx', t.titulo.slice(0, 30), [t.cab, ...t.linhas, ...(t.total ? [t.total] : [])])} />
    </Cab>
    <Chips atual={r} aoEscolher={setR} nome="rr" opcoes={opcoes} />
    {r === 'turnover' && <Explica>Turnover do mês = (admissões + desligamentos) ÷ 2 ÷ pessoas no fim do mês. Abaixo de 2% ao mês é considerado baixo na indústria.</Explica>}
    {r === 'absenteismo' && <Explica>Absenteísmo = horas perdidas ÷ horas previstas. Faltas e atrasos vêm do ponto; atestados, licenças e afastamentos das ausências. Férias não contam.</Explica>}
    {r === 'he' && <Explica>Horas extras (50% a 100%) por pessoa e mês, como as tabelas da planilha de horas extras.</Explica>}
    {t.linhas.length ? <div className="tabela-caixa mt"><table className="tabela" id="tRelRh"><thead><tr>{t.cab.map((c, i) => <th key={i} className={t.alinhar?.[i] ? 'num' : ''}>{c}</th>)}</tr></thead>
      <tbody>{t.linhas.map((l, n) => <tr key={n}>{l.map((c, i) => <td key={i} className={t.alinhar?.[i] ? 'num' : ''}>{c}</td>)}</tr>)}</tbody>
      {t.total && <tfoot><tr>{t.total.map((c, i) => <td key={i} className={t.alinhar?.[i] ? 'num' : ''}>{c}</td>)}</tr></tfoot>}</table></div>
      : <Vazio icone="relatorio" titulo="Sem dados ainda" />}
  </>
}
const Explica = ({ children }: { children: ReactNode }) => <p className="sub mt">{children}</p>

function quadro(): Tabela {
  const at = S.lista('funcionarios').filter(f => f.ativo)
  const regs = REGISTROS.filter(g => at.some(f => (f.registro || 'Sem registro') === g))
  const porSetor = U.agrupar(at, f => f.setor || 'Sem setor')
  const linhas = U.ordenar([...porSetor.entries()], ([s]) => U.sem(s)).map(([s, l]) => [s, ...regs.map(g => l.filter(f => (f.registro || 'Sem registro') === g).length || ''), l.length])
  return { titulo: 'Quadro de pessoas', sub: `${U.plural(at.length, 'pessoa')} trabalhando em ${U.data(U.hoje())}`, cab: ['Setor', ...regs, 'Total'], linhas,
    total: ['Total', ...regs.map(g => at.filter(f => (f.registro || 'Sem registro') === g).length), at.length], alinhar: [undefined, ...regs.map(() => 'right' as const), 'right'] }
}

function turnover(): Tabela {
  const fs = S.lista('funcionarios')
  const linhas = ultimosMeses(12).map(m => {
    const fim = U.somaDias(U.somaMeses(m + '-01', 1), -1)
    const adm = fs.filter(f => f.admissao?.startsWith(m)).length, desl = fs.filter(f => f.demissao?.startsWith(m)).length
    const qt = fs.filter(f => naEmpresa(f, fim)).length
    return [rotMes(m), qt, adm, desl, qt ? ((adm + desl) / 2 / qt * 100).toFixed(1).replace('.', ',') + '%' : '—']
  })
  const fs12 = U.somaMeses(U.hoje(), -12)
  const motivos = U.agrupar(fs.filter(f => f.demissao && f.demissao >= fs12), f => f.motivo_demissao || 'Sem motivo')
  return { titulo: 'Turnover', sub: 'Últimos 12 meses' + (motivos.size ? ' · saídas: ' + [...motivos.entries()].map(([k, l]) => `${k} ${l.length}`).join(', ') : ''),
    cab: ['Mês', 'Pessoas no fim do mês', 'Admissões', 'Desligamentos', 'Turnover'], linhas, alinhar: [undefined, 'right', 'right', 'right', 'right'] }
}

// pontos agrupados por pessoa e mês (uma passada só)
function pontosPorPessoaMes(): Map<string, RhPonto[]> {
  const m = new Map<string, RhPonto[]>()
  for (const p of S.lista('rh_ponto')) { const k = p.funcionario_id + '|' + p.data.slice(0, 7); let l = m.get(k); if (!l) m.set(k, l = []); l.push(p) }
  return m
}
const ROT_SAUDE = new Set(['ATESTADO', 'AFASTADO', 'LICENÇA', 'DECLARAÇÃO', 'Atestado', 'Declaração', 'Licença'])
function absenteismo(): Tabela {
  const fer = feriadosMap(), pp = pontosPorPessoaMes()
  const fs = S.lista('funcionarios')
  const linhas = ultimosMeses(12).map(m => {
    const fim = U.somaDias(U.somaMeses(m + '-01', 1), -1), ini = m + '-01'
    let prev = 0, falta = 0, atraso = 0, saude = 0
    for (const f of fs) {
      if (!f.admissao || f.admissao > fim || (f.demissao && f.demissao < ini)) continue
      const r = resumoDe(f, m, pp.get(f.id + '|' + m) || [], fer)
      for (const d of r.dias) {
        if (d.rotulo === 'FÉRIAS' || d.rotulo === 'Fora do contrato') continue
        prev += d.prev; atraso += d.atraso
        if (d.falta) falta += d.prev
        else if (ROT_SAUDE.has(d.rotulo)) saude += d.abonado
      }
    }
    const pct = (x: number) => prev ? (x / prev * 100).toFixed(1).replace('.', ',') + '%' : '—'
    return [rotMes(m), R.horas(prev), R.horas(falta), R.horas(atraso), R.horas(saude), pct(falta + atraso), pct(falta + atraso + saude)]
  })
  return { titulo: 'Absenteísmo', sub: 'Últimos 12 meses', cab: ['Mês', 'Horas previstas', 'Faltas', 'Atrasos', 'Atestados e licenças', 'Sem justificativa', 'Total'], linhas,
    alinhar: [undefined, 'right', 'right', 'right', 'right', 'right', 'right'] }
}

function horasExtras(sens: boolean): Tabela {
  const fer = feriadosMap(), pp = pontosPorPessoaMes()
  const meses = ultimosMeses(12)
  const fs = U.ordenar(S.lista('funcionarios'), f => U.sem(f.nome))
  const totMes = meses.map(() => 0)
  let totValor = 0
  const linhas: (string | number)[][] = []
  for (const f of fs) {
    let tot = 0, val = 0
    const cel = meses.map((m, i) => { const ps = pp.get(f.id + '|' + m); if (!ps?.length) return ''; const r = resumoDe(f, m, ps, fer); const h = r.he + r.he100; tot += h; val += r.valores.total; totMes[i] += h; return h ? R.horas(h) : '' })
    if (!tot) continue
    totValor += val
    linhas.push([f.nome, ...cel, R.horas(tot), ...(sens ? [U.moeda(val)] : [])])
  }
  return { titulo: 'Horas extras do ano', sub: `${rotMes(meses[0])} a ${rotMes(meses[11])}`, cab: ['Pessoa', ...meses.map(rotMes), 'Total', ...(sens ? ['Valor'] : [])], linhas,
    total: ['Total', ...totMes.map(h => h ? R.horas(h) : ''), R.horas(U.soma(totMes, x => x)), ...(sens ? [U.moeda(totValor)] : [])],
    alinhar: [undefined, ...meses.map(() => 'right' as const), 'right', ...(sens ? ['right' as const] : [])] }
}

function custo(): Tabela {
  const m = U.hoje().slice(0, 7), ant = U.somaMeses(m + '-01', -1).slice(0, 7)
  const fer = feriadosMap(), pp = pontosPorPessoaMes()
  const at = S.lista('funcionarios').filter(f => f.ativo)
  const porSetor = U.agrupar(at, f => f.setor || 'Sem setor')
  let ts = 0, th = 0
  const linhas = U.ordenar([...porSetor.entries()], ([s]) => U.sem(s)).map(([s, l]) => {
    const sal = U.soma(l, f => Number(S.get('funcionarios_privado', f.id)?.salario) || 0)
    const he = U.soma(l, f => { const ps = pp.get(f.id + '|' + ant); return ps?.length ? resumoDe(f, ant, ps, fer).valores.total : 0 })
    ts += sal; th += he
    return [s, l.length, U.moeda(sal), U.moeda(l.length ? sal / l.length : 0), U.moeda(he), U.moeda(sal + he)]
  })
  return { titulo: 'Custo por setor', sub: `Salários de hoje + horas extras de ${U.nomeMes(Number(ant.slice(5)))} (sem encargos)`, cab: ['Setor', 'Pessoas', 'Salários', 'Média', 'Horas extras', 'Total'], linhas,
    total: ['Total', at.length, U.moeda(ts), U.moeda(at.length ? ts / at.length : 0), U.moeda(th), U.moeda(ts + th)], alinhar: [undefined, 'right', 'right', 'right', 'right', 'right'] }
}
