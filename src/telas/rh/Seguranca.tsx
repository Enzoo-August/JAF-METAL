/* RH — Segurança do trabalho: exames médicos (ASO, NR-7) e entrega de EPI (NR-6) com ficha para assinatura */
import { useEffect, useState } from 'react'
import { App } from '../../app/controle.tsx'
import { API, ErroApp } from '../../lib/api.ts'
import { S } from '../../lib/dados.ts'
import * as R from '../../lib/rh.ts'
import type { Funcionario, RhAso, RhEpi } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { aviso, erro } from '../../ui/avisos.ts'
import { entregar, pdfDocumento } from '../../ui/arquivos.tsx'
import { BuscaLista, Btn, Cab, Campo, Chips, Paginado, Tag, Vazio, type OpcaoChip } from '../../ui/base.tsx'
import { useLembrar, type Rota } from '../../ui/ganchos.ts'
import { Ic } from '../../ui/icones.tsx'
import { confirmar, lerForm, modal } from '../../ui/janelas.tsx'
import { Anexos, ativos, LinhaPessoa, nomeF, opcoesPessoas, pode, razaoEmpresa, TagVence } from './comum.tsx'

const TIPOS_ASO = ['Admissional', 'Periódico', 'Retorno ao trabalho', 'Mudança de risco', 'Demissional']
const EPIS_COMUNS = ['Óculos de proteção', 'Protetor auricular tipo plug', 'Protetor auricular tipo concha', 'Luva de vaqueta', 'Luva nitrílica', 'Luva anticorte', 'Botina de segurança',
  'Avental de raspa', 'Manga de raspa', 'Máscara PFF2', 'Máscara de solda', 'Capacete', 'Protetor facial', 'Uniforme (calça e camisa)', 'Creme de proteção']
const MOTIVOS_EPI = ['Admissional', 'Troca por desgaste', 'Danificado/Perdido', 'Alteração de função']

// última entrega de cada EPI de cada pessoa (para saber o que precisa trocar)
export function ultimasEntregas(): RhEpi[] {
  const m = new Map<string, RhEpi>()
  for (const e of S.lista('rh_epis')) { const k = e.funcionario_id + '|' + U.sem(e.epi); const x = m.get(k); if (!x || x.entrega < e.entrega) m.set(k, e) }
  return [...m.values()]
}

export function TelaSeguranca({ r }: { r: Rota }) {
  const [aba, setAba] = useLembrar('seg.aba', 'aso')
  useEffect(() => { const q = r.q.get('f'); if (q === 'epi' || q === 'aso') setAba(q) }, [r.hash, r.q, setAba])
  return <>
    <Cab titulo="EPI e exames" sub="Exames médicos (ASO) com vencimento e entregas de EPI com ficha para assinar.">
      {pode() && (aba === 'aso' ? <Btn txt="Lançar exame (ASO)" icone="mais" cls="pri" data-seg="aso" onClick={() => void formAso()} />
        : <Btn txt="Entregar EPI" icone="mais" cls="pri" data-seg="epi" onClick={() => void formEpi()} />)}
    </Cab>
    <nav className="abas-tela"><button type="button" data-aba="aso" className={aba === 'aso' ? 'on' : ''} onClick={() => setAba('aso')}>Exames (ASO)</button>
      <button type="button" data-aba="epi" className={aba === 'epi' ? 'on' : ''} onClick={() => setAba('epi')}>EPI</button></nav>
    {aba === 'aso' ? <PainelAso /> : <PainelEpi />}
  </>
}

function PainelAso() {
  const [f, setF] = useLembrar('seg.f', 'atencao')
  const l = ativos().map(p => { const a = R.ultimoAso(S.lista('rh_asos'), p.id); const v = a ? R.vencimentoAso(a) : null; return { p, a, v, s: R.semaforoData(v) } })
  const g = (s: string) => l.filter(x => (x.s || 'sem') === s)
  const chips: OpcaoChip[] = [{ v: 'atencao', t: 'Vencidos e vencendo', n: g('vermelho').length + g('amarelo').length }, { v: 'vermelho', t: 'Vencidos', n: g('vermelho').length },
    { v: 'amarelo', t: 'Vencem em 60 dias', n: g('amarelo').length }, { v: 'verde', t: 'Em dia', n: g('verde').length }, { v: 'sem', t: 'Sem exame lançado', n: g('sem').length }]
  const vis = U.ordenar(f === 'atencao' ? [...g('vermelho'), ...g('amarelo')] : g(f), x => x.v || '0')
  return <>
    <Chips atual={f} aoEscolher={setF} nome="sa" opcoes={chips} />
    <div className="mt"><Paginado itens={vis} render={({ p, a, v }) => <LinhaPessoa key={p.id} f={p} href={`#/funcionario/${p.id}?aba=seguranca`}
      sub={a ? `${a.tipo} em ${U.data(a.data_exame)}${a.resultado ? ' · ' + a.resultado : ''}` : 'nenhum exame lançado'}
      direita={a ? <><TagVence venc={v} ok="Em dia" /><small>vence {U.dataCurta(v)}</small></> : pode() ? <button type="button" className="btn sec mini" onClick={(e) => { e.preventDefault(); void formAso(p) }}>Lançar</button> : null} />}
      vazio={<Vazio icone="ok" titulo="Ninguém aqui" />} /></div>
    <p className="sub mt">Vermelho = vencido; amarelo = vence em até 60 dias; verde = mais de 60 dias. Periódico padrão: a cada 12 meses (dá para mudar em cada exame, conforme o PCMSO).</p>
  </>
}

function PainelEpi() {
  const [f, setF] = useLembrar('seg.epi', 'recentes')
  const [busca, setBusca] = useLembrar('seg.busca', '')
  const hoje = U.hoje()
  const ult = ultimasEntregas()
  const at = new Set(ativos().map(p => p.id))
  const trocar = ult.filter(e => at.has(e.funcionario_id) && (R.trocaEpi(e) || '9999') < hoje)
  const caVenc = ult.filter(e => at.has(e.funcionario_id) && e.validade_ca && e.validade_ca < hoje)
  let l = f === 'trocar' ? trocar : f === 'ca' ? caVenc : S.lista('rh_epis')
  if (busca.trim()) l = U.buscar(l, busca, e => [nomeF(e.funcionario_id), e.epi, e.ca || ''])
  l = U.ordenar(l, e => e.entrega, true)
  return <>
    <div className="barra-filtros"><BuscaLista id="bEpi" valor={busca} placeholder="Pessoa, EPI ou CA" aoMudar={setBusca} /></div>
    <Chips atual={f} aoEscolher={setF} nome="se" opcoes={[{ v: 'recentes', t: 'Todas as entregas', n: S.lista('rh_epis').length }, { v: 'trocar', t: 'Passou do prazo de troca', n: trocar.length }, { v: 'ca', t: 'CA vencido', n: caVenc.length }]} />
    <div className="mt"><Paginado itens={l} render={e => <LinhaEpi key={e.id} e={e} comNome />} vazio={<Vazio icone="admin" titulo="Nenhuma entrega" texto="Registre cada EPI entregue: o sistema avisa quando passar do prazo de troca e gera a ficha para assinatura (NR-6)." />} /></div>
  </>
}
function LinhaEpi({ e, comNome }: { e: RhEpi; comNome?: boolean }) {
  const troca = R.trocaEpi(e)
  return <div className={`linha${pode() ? ' clicavel' : ''}`} data-epi={e.id} onClick={() => { const p = S.get('funcionarios', e.funcionario_id); if (pode() && p) void formEpi(p, e) }}>
    <span className="sinal ent"><Ic n="admin" /></span>
    <div className="meio"><b>{comNome ? nomeF(e.funcionario_id) + ' — ' : ''}{e.epi}{e.quantidade !== 1 ? ` (${U.qtd(e.quantidade)})` : ''}</b>
      <small>{[U.data(e.entrega), e.ca && 'CA ' + e.ca, e.motivo, troca && 'trocar em ' + U.data(troca)].filter(Boolean).join(' · ')}</small></div>
    <div className="lado">{e.validade_ca && e.validade_ca < U.hoje() ? <Tag s={{ cor: 'vermelho', txt: 'CA vencido' }} /> : troca && troca < U.hoje() ? <Tag s={{ cor: 'amarelo', txt: 'Trocar' }} /> : null}</div></div>
}

// ------------------------------------------------------------------ formulários
export async function formAso(f?: Funcionario | null, a?: RhAso) {
  await modal({
    titulo: a ? `ASO — ${nomeF(a.funcionario_id)}` : f ? 'Exame (ASO) — ' + f.nome : 'Lançar exame (ASO)',
    corpo: <>
      {!f && !a && <Campo nome="funcionario_id" rotulo="Quem" tipo="select" req opcoes={opcoesPessoas()} />}
      <div className="campo"><label>Tipo de exame</label><div className="opcoes">{TIPOS_ASO.map(t => <label key={t} className="opcao"><input type="radio" name="tipo" value={t} defaultChecked={(a?.tipo || 'Periódico') === t} /><span><b>{t}</b></span></label>)}</div></div>
      <div className="linha-campos"><Campo nome="data_exame" rotulo="Data do exame" tipo="date" valor={a?.data_exame || U.hoje()} req />
        <Campo nome="periodicidade_meses" rotulo="Próximo exame em" tipo="select" valor={String(a?.periodicidade_meses || 12)} opcoes={[6, 12, 24].map(n => ({ v: String(n), t: `${n} meses` }))} />
        <Campo nome="resultado" rotulo="Resultado" tipo="select" valor={a?.resultado || 'Apto'} opcoes={['Apto', 'Apto com restrição', 'Inapto'].map(x => ({ v: x, t: x }))} /></div>
      <div className="linha-campos"><Campo nome="medico" rotulo="Médico (opcional)" valor={a?.medico} /><Campo nome="crm" rotulo="CRM" valor={a?.crm} /></div>
      <Campo nome="obs" rotulo="Observação / restrição" valor={a?.obs} />
      {a ? <Anexos tabela="rh_asos" registro={a.id} titulo="ASO digitalizado" /> : <p className="sub">Depois de salvar, abra de novo para anexar o ASO digitalizado.</p>}
    </>,
    botoes: [...(a ? [{ txt: 'Apagar', cls: 'perigo-txt', validar: false, acao: async () => {
      if (!(await confirmar('Apagar este exame?', { ok: 'Apagar', perigo: true }))) return false
      await API.rpc('rh_salvar_aso', { p: { id: a.id, excluir: true } }); await App.gravou(['rh_asos'], { inteira: ['rh_asos'] })
    } }] : []), { txt: 'Salvar', acao: async (frm: HTMLFormElement) => {
      const d = lerForm(frm)
      await API.rpc('rh_salvar_aso', { p: { ...d, id: a?.id, funcionario_id: a?.funcionario_id || f?.id || d.funcionario_id } }); await App.gravou(['rh_asos']); aviso('Exame salvo.')
    } }],
  })
}

interface LinhaEd { epi: string; ca: string; quantidade: string; vida: string; validade_ca: string }
const linhaVazia: LinhaEd = { epi: '', ca: '', quantidade: '1', vida: '', validade_ca: '' }
function VariosEpis() {
  const [l, setL] = useState<LinhaEd[]>([{ ...linhaVazia }])
  const mud = (n: number, k: keyof LinhaEd, v: string) => setL(x => x.map((y, i) => i === n ? { ...y, [k]: v } : y))
  return <>
    <input type="hidden" name="epis_json" value={JSON.stringify(l.filter(x => x.epi.trim()))} />
    <datalist id="lEpis">{U.unicos([...EPIS_COMUNS, ...S.lista('rh_epis').map(e => e.epi)]).map(x => <option key={x} value={x} />)}</datalist>
    <div className="itens-matriz">{l.map((x, n) => <div key={n} className="item-matriz epi">
      <input aria-label="EPI" placeholder="EPI" list="lEpis" value={x.epi} onChange={(e) => mud(n, 'epi', e.target.value)} />
      <input aria-label="CA" placeholder="CA" inputMode="numeric" value={x.ca} onChange={(e) => mud(n, 'ca', e.target.value)} />
      <input aria-label="Quantidade" placeholder="Qtd" inputMode="decimal" value={x.quantidade} onChange={(e) => mud(n, 'quantidade', e.target.value)} />
      <input aria-label="Trocar a cada (meses)" placeholder="Troca (meses)" inputMode="numeric" value={x.vida} onChange={(e) => mud(n, 'vida', e.target.value)} />
      <span className="item-acoes"><button type="button" className="icone-btn mini" aria-label="Tirar" disabled={l.length === 1} onClick={() => setL(y => y.filter((_, i) => i !== n))}><Ic n="x" /></button></span></div>)}</div>
    <button type="button" className="btn sec mini" data-seg="addEpi" onClick={() => setL(y => [...y, { ...linhaVazia }])}><Ic n="mais" /><span>Mais um EPI</span></button>
  </>
}
export async function formEpi(f?: Funcionario | null, e?: RhEpi) {
  await modal({
    titulo: e ? `EPI — ${nomeF(e.funcionario_id)}` : f ? 'Entregar EPI — ' + f.nome : 'Entregar EPI', largura: e ? '' : 'larga',
    corpo: <>
      {!f && !e && <Campo nome="funcionario_id" rotulo="Para quem" tipo="select" req opcoes={opcoesPessoas()} />}
      <div className="linha-campos"><Campo nome="entrega" rotulo="Data da entrega" tipo="date" valor={e?.entrega || U.hoje()} req />
        <Campo nome="motivo" rotulo="Motivo" tipo="select" valor={e?.motivo || 'Troca por desgaste'} opcoes={MOTIVOS_EPI.map(x => ({ v: x, t: x }))} /></div>
      {e ? <>
        <div className="linha-campos"><Campo nome="epi" rotulo="EPI" valor={e.epi} req attrs={{ list: 'lEpis1' }} /><Campo nome="ca" rotulo="CA" valor={e.ca} /><Campo nome="quantidade" rotulo="Quantidade" tipo="qtd" valor={U.campoNum(e.quantidade, 1)} /></div>
        <datalist id="lEpis1">{EPIS_COMUNS.map(x => <option key={x} value={x} />)}</datalist>
        <div className="linha-campos"><Campo nome="vida_util_meses" rotulo="Trocar a cada (meses)" tipo="num" valor={e.vida_util_meses} /><Campo nome="validade_ca" rotulo="Validade do CA" tipo="date" valor={e.validade_ca} /></div>
        <Anexos tabela="rh_epis" registro={e.id} titulo="Ficha assinada" />
      </> : <VariosEpis />}
      <Campo nome="obs" rotulo="Observação" valor={e?.obs} />
    </>,
    botoes: [...(e ? [{ txt: 'Apagar', cls: 'perigo-txt', validar: false, acao: async () => {
      if (!(await confirmar('Apagar esta entrega?', { ok: 'Apagar', perigo: true }))) return false
      await API.rpc('rh_salvar_epi', { p: { id: e.id, excluir: true } }); await App.gravou(['rh_epis'], { inteira: ['rh_epis'] })
    } }] : []), { txt: e ? 'Salvar' : 'Registrar entrega', acao: async (frm: HTMLFormElement) => {
      const d = lerForm(frm)
      const fid = e?.funcionario_id || f?.id || d.funcionario_id
      if (e) await API.rpc('rh_salvar_epi', { p: { ...d, id: e.id, funcionario_id: fid, validade_ca: d.validade_ca || null } })
      else {
        const l = JSON.parse(d.epis_json || '[]') as LinhaEd[]
        if (!l.length) throw new ErroApp('Escreva pelo menos um EPI.')
        for (const x of l) await API.rpc('rh_salvar_epi', { p: { funcionario_id: fid, entrega: d.entrega, motivo: d.motivo, obs: d.obs, epi: x.epi, ca: x.ca, quantidade: U.num(x.quantidade) || 1, vida_util_meses: U.num(x.vida), validade_ca: x.validade_ca || null } })
      }
      await App.gravou(['rh_epis'])
      const p = S.get('funcionarios', fid)
      aviso(e ? 'Salvo.' : 'Entrega registrada.', 'ok', !e && p ? { acao: { txt: 'Ficha para assinar', fn: () => fichaEpi(p).catch(erro) }, tempo: 9000 } : {})
    } }],
  })
}

// ficha de EPI (NR-6): o que foi entregue, com espaço para assinatura
export async function fichaEpi(f: Funcionario): Promise<void> {
  const l = U.ordenar(S.lista('rh_epis').filter(e => e.funcionario_id === f.id), e => e.entrega)
  const blob = await pdfDocumento('Ficha de entrega de EPI', 'NR-6 — Equipamento de Proteção Individual', (c) => {
    let y = c.y + 2
    y = c.texto([`Funcionário: ${f.nome}`, f.funcao && `Função: ${f.funcao}`, f.setor && `Setor: ${f.setor}`, f.admissao && `Admissão: ${U.data(f.admissao)}`].filter(Boolean).join('    '), y, { tam: 10, negrito: true }) + 2
    y = c.texto('Declaro que recebi gratuitamente da empresa os Equipamentos de Proteção Individual abaixo, que fui orientado(a) sobre o uso correto, a guarda e a conservação, e que devo comunicar qualquer dano ou extravio. Estou ciente de que a recusa injustificada ao uso do EPI constitui ato faltoso (art. 158 da CLT e NR-6).', y, { tam: 9.5 }) + 3
    c.tabela({ ...c.estilo, startY: y, head: [['Data', 'EPI', 'CA', 'Qtd', 'Motivo', 'Assinatura']],
      body: [...l.map(e => [U.data(e.entrega), e.epi, e.ca || '', U.qtd(e.quantidade), e.motivo || '', '']), ...Array.from({ length: Math.max(0, 8 - l.length) }, () => ['', '', '', '', '', ''])],
      columnStyles: { 0: { cellWidth: 22 }, 2: { cellWidth: 18 }, 3: { cellWidth: 12, halign: 'center' }, 5: { cellWidth: 45 } }, styles: { ...c.estilo.styles, minCellHeight: 8 } })
    y = c.doc.lastAutoTable.finalY + 22
    if (y > c.H - 30) { c.doc.addPage(); y = 40 }
    c.assinatura(f.nome, 'Funcionário', 14, y, 80)
    c.assinatura(razaoEmpresa(), 'Responsável pela entrega', c.W - 94, y, 80)
  })
  await entregar(blob, `Ficha EPI ${f.nome}.pdf`)
}

// ------------------------------------------------------------------ na ficha
export function SegurancaDaPessoa({ f }: { f: Funcionario }) {
  const asos = U.ordenar(S.lista('rh_asos').filter(a => a.funcionario_id === f.id), a => a.data_exame, true)
  const epis = U.ordenar(S.lista('rh_epis').filter(e => e.funcionario_id === f.id), e => e.entrega, true)
  return <>
    <section className="card"><div className="card-cab"><h2>Exames (ASO)</h2>{pode() && <Btn txt="Lançar exame" icone="mais" cls="sec mini" data-seg="aso" onClick={() => void formAso(f)} />}</div>
      {asos.length ? <div className="lista">{asos.map((a, i) => <div key={a.id} className={`linha${pode() ? ' clicavel' : ''}`} onClick={() => pode() && void formAso(f, a)}>
        <div className="meio"><b>{a.tipo} — {U.data(a.data_exame)}</b><small>{[a.resultado, a.medico, a.obs].filter(Boolean).join(' · ')}</small></div>
        <div className="lado">{i === 0 && <><TagVence venc={R.vencimentoAso(a)} ok="Em dia" /><small>vence {U.dataCurta(R.vencimentoAso(a))}</small></>}</div></div>)}</div>
        : <p className="sub">Nenhum exame lançado.</p>}</section>
    <section className="card mt"><div className="card-cab"><h2>EPI entregues</h2><div className="grupo-btn">
      {epis.length > 0 && <Btn txt="Ficha para assinar" icone="imprimir" cls="sec mini" data-seg="fichaEpi" onClick={() => fichaEpi(f)} />}
      {pode() && <Btn txt="Entregar EPI" icone="mais" cls="sec mini" data-seg="epi" onClick={() => void formEpi(f)} />}</div></div>
      {epis.length ? <div className="lista">{epis.map(e => <LinhaEpi key={e.id} e={e} />)}</div> : <p className="sub">Nenhuma entrega registrada.</p>}</section>
  </>
}
