/* RH — Segurança do trabalho: exames médicos (ASO, NR-7), cadastro de EPI com CA e entrega de EPI (NR-6)
 * com o termo de responsabilidade assinado por foto do rosto (assinatura facial), na tela ou no papel */
import { useEffect, useRef, useState, type PointerEvent as EvPonteiro } from 'react'
import { App } from '../../app/controle.tsx'
import { API, ErroApp } from '../../lib/api.ts'
import { S } from '../../lib/dados.ts'
import * as R from '../../lib/rh.ts'
import type { Funcionario, RhAso, RhEpi, RhEpiCatalogo } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { aviso } from '../../ui/avisos.ts'
import { entregar, excel, pdfDocumento } from '../../ui/arquivos.tsx'
import { BuscaLista, Btn, Cab, Campo, Chips, Paginado, Tag, Vazio, type OpcaoChip } from '../../ui/base.tsx'
import { useLembrar, type Rota } from '../../ui/ganchos.ts'
import { Ic } from '../../ui/icones.tsx'
import { confirmar, lerForm, modal } from '../../ui/janelas.tsx'
import { Anexos, anexosDe, ativos, empresaDe, lerBase64, LinhaPessoa, nomeF, opcoesPessoas, pode, razaoEmpresa, TagVence, TIPOS_OK } from './comum.tsx'

const TIPOS_ASO = ['Admissional', 'Periódico', 'Retorno ao trabalho', 'Mudança de risco', 'Demissional']
const EPIS_COMUNS = ['Óculos de proteção', 'Protetor auricular tipo plug', 'Protetor auricular tipo concha', 'Luva de vaqueta', 'Luva nitrílica', 'Luva anticorte', 'Botina de segurança',
  'Avental de raspa', 'Manga de raspa', 'Máscara PFF2', 'Máscara de solda', 'Capacete', 'Protetor facial', 'Uniforme (calça e camisa)', 'Creme de proteção']
const MOTIVOS_EPI = ['Admissional', 'Troca por desgaste', 'Danificado/Perdido', 'Alteração de função']
const TXT_ASSIN: Record<string, string> = { facial: 'Assinado por foto (facial)', tela: 'Assinado na tela', papel: 'Assinar no papel' }

// última entrega de cada EPI de cada pessoa (para saber o que precisa trocar)
export function ultimasEntregas(): RhEpi[] {
  const m = new Map<string, RhEpi>()
  for (const e of S.lista('rh_epis')) { const k = e.funcionario_id + '|' + U.sem(e.epi); const x = m.get(k); if (!x || x.entrega < e.entrega) m.set(k, e) }
  return [...m.values()]
}
export const catalogoAtivo = (): RhEpiCatalogo[] => U.ordenar(S.lista('rh_epi_catalogo').filter(c => c.ativo), c => U.sem(c.descricao) + (c.fabricante || ''))
const nomeCat = (c: RhEpiCatalogo) => [c.descricao, c.fabricante, c.ca && 'CA ' + c.ca].filter(Boolean).join(' — ')

export function TelaSeguranca({ r }: { r: Rota }) {
  const [aba, setAba] = useLembrar('seg.aba', 'aso')
  useEffect(() => { const q = r.q.get('f'); if (q === 'epi' || q === 'aso' || q === 'ca') setAba(q) }, [r.hash, r.q, setAba])
  return <>
    <Cab titulo="EPI e exames" sub="Exames médicos (ASO), cadastro dos EPIs com o CA e entregas com termo de responsabilidade.">
      {pode() && (aba === 'aso' ? <Btn txt="Lançar exame (ASO)" icone="mais" cls="pri" data-seg="aso" onClick={() => void formAso()} />
        : aba === 'ca' ? <Btn txt="Cadastrar EPI" icone="mais" cls="pri" data-seg="novoCa" onClick={() => void formCatalogo()} />
        : <Btn txt="Entregar EPI" icone="mais" cls="pri" data-seg="epi" onClick={() => void formEpi()} />)}
    </Cab>
    <nav className="abas-tela"><button type="button" data-aba="aso" className={aba === 'aso' ? 'on' : ''} onClick={() => setAba('aso')}>Exames (ASO)</button>
      <button type="button" data-aba="epi" className={aba === 'epi' ? 'on' : ''} onClick={() => setAba('epi')}>Entregas de EPI</button>
      <button type="button" data-aba="ca" className={aba === 'ca' ? 'on' : ''} onClick={() => setAba('ca')}>EPIs e CA</button></nav>
    {aba === 'aso' ? <PainelAso /> : aba === 'ca' ? <PainelCatalogo /> : <PainelEpi />}
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
  const semAss = S.lista('rh_epis').filter(e => at.has(e.funcionario_id) && !e.assinatura)
  let l = f === 'trocar' ? trocar : f === 'ca' ? caVenc : f === 'assinar' ? semAss : S.lista('rh_epis')
  if (busca.trim()) l = U.buscar(l, busca, e => [nomeF(e.funcionario_id), e.epi, e.ca || '', e.fabricante || ''])
  l = U.ordenar(l, e => e.entrega, true)
  return <>
    <div className="barra-filtros"><BuscaLista id="bEpi" valor={busca} placeholder="Pessoa, EPI, CA ou fabricante" aoMudar={setBusca} /></div>
    <Chips atual={f} aoEscolher={setF} nome="se" opcoes={[{ v: 'recentes', t: 'Todas as entregas', n: S.lista('rh_epis').length }, { v: 'assinar', t: 'Falta assinar o termo', n: semAss.length },
      { v: 'trocar', t: 'Passou do prazo de troca', n: trocar.length }, { v: 'ca', t: 'CA vencido', n: caVenc.length }]} />
    <div className="mt"><Paginado itens={l} render={e => <LinhaEpi key={e.id} e={e} comNome />} vazio={<Vazio icone="admin" titulo="Nenhuma entrega" texto="Registre cada EPI entregue: o sistema avisa quando passar do prazo de troca e gera o termo de responsabilidade (NR-6) para assinar." />} /></div>
  </>
}
function LinhaEpi({ e, comNome }: { e: RhEpi; comNome?: boolean }) {
  const troca = R.trocaEpi(e)
  return <div className={`linha${pode() ? ' clicavel' : ''}`} data-epi={e.id} onClick={() => { const p = S.get('funcionarios', e.funcionario_id); if (pode() && p) void formEpi(p, e) }}>
    <span className="sinal ent"><Ic n="admin" /></span>
    <div className="meio"><b>{comNome ? nomeF(e.funcionario_id) + ' — ' : ''}{e.epi}{e.quantidade !== 1 ? ` (${U.qtd(e.quantidade)})` : ''}</b>
      <small>{[U.data(e.entrega), e.ca && 'CA ' + e.ca, e.fabricante, e.tamanho && 'tam. ' + e.tamanho, e.motivo, troca && 'trocar em ' + U.data(troca)].filter(Boolean).join(' · ')}</small></div>
    <div className="lado">{e.validade_ca && e.validade_ca < U.hoje() ? <Tag s={{ cor: 'vermelho', txt: 'CA vencido' }} /> : troca && troca < U.hoje() ? <Tag s={{ cor: 'amarelo', txt: 'Trocar' }} /> : null}
      {e.assinatura && e.assinatura !== 'papel' ? <small className="verde-txt">{TXT_ASSIN[e.assinatura]}</small> : <small className="fraco">{e.assinatura === 'papel' ? 'termo impresso' : 'sem assinatura'}</small>}</div></div>
}

// ------------------------------------------------------------------ EPIs e CA (a planilha "CA - Certificado de Aprovação dos EPIs")
function PainelCatalogo() {
  const [f, setF] = useLembrar('seg.ca', 'todos')
  const [busca, setBusca] = useLembrar('seg.bca', '')
  const hoje = U.hoje(), em90 = U.somaDias(hoje, 90)
  const todos = U.ordenar(S.lista('rh_epi_catalogo'), c => (c.ativo ? '0' : '1') + U.sem(c.descricao))
  const ativosCat = todos.filter(c => c.ativo)
  const venc = ativosCat.filter(c => c.validade_ca && c.validade_ca < hoje), vence = ativosCat.filter(c => c.validade_ca && c.validade_ca >= hoje && c.validade_ca <= em90)
  const semPdf = ativosCat.filter(c => !anexosDe('rh_epi_catalogo', c.id).length)
  let l = f === 'vencido' ? venc : f === 'vence' ? vence : f === 'sempdf' ? semPdf : f === 'inativos' ? todos.filter(c => !c.ativo) : ativosCat
  if (busca.trim()) l = U.buscar(l, busca, c => [c.descricao, c.fabricante || '', c.ca || '', c.onde_utiliza || ''])
  return <>
    <div className="barra-filtros"><BuscaLista id="bCa" valor={busca} placeholder="EPI, fabricante, CA ou onde usa" aoMudar={setBusca} />
      <Btn txt="Excel" icone="planilha" cls="sec mini" data-seg="caExcel" onClick={() => excel('EPIs e CA.xlsx', [['EPIs', l.map(c => ({ Descrição: c.descricao, 'Onde utiliza': c.onde_utiliza || '', Fabricante: c.fabricante || '', CA: c.ca || '',
        Validade: c.validade_ca ? U.data(c.validade_ca) : '', Status: !c.validade_ca ? '' : c.validade_ca < hoje ? 'Vencido' : 'Ok', Tamanhos: c.tamanhos || '' }))]])} /></div>
    <Chips atual={f} aoEscolher={setF} nome="sc" opcoes={[{ v: 'todos', t: 'Em uso', n: ativosCat.length }, { v: 'vencido', t: 'CA vencido', n: venc.length }, { v: 'vence', t: 'Vence em 90 dias', n: vence.length },
      { v: 'sempdf', t: 'Sem o PDF do CA', n: semPdf.length }, { v: 'inativos', t: 'Fora de uso', n: todos.length - ativosCat.length }]} />
    <div className="mt"><Paginado itens={l} render={c => <div key={c.id} className={`linha${pode() ? ' clicavel' : ''}`} data-ca={c.id} onClick={() => pode() && void formCatalogo(c)}>
      <span className="sinal ent"><Ic n="admin" /></span>
      <div className="meio"><b>{c.descricao}{!c.ativo && <> <span className="tag t-cinza">fora de uso</span></>}</b>
        <small>{[c.ca ? 'CA ' + c.ca : 'sem CA', c.fabricante, c.onde_utiliza, c.tamanhos && 'tam. ' + c.tamanhos, anexosDe('rh_epi_catalogo', c.id).length ? 'PDF do CA anexado' : ''].filter(Boolean).join(' · ')}</small></div>
      <div className="lado">{c.validade_ca ? <><TagVence venc={c.validade_ca} ok="Ok" amarelo={90} /><small>validade {U.dataCurta(c.validade_ca)}</small></> : <small className="fraco">sem validade</small>}</div></div>}
      vazio={<Vazio icone="admin" titulo="Nenhum EPI aqui" texto="Cadastre cada EPI com o número do CA, a validade e o fabricante. Na entrega, é só escolher da lista." />} /></div>
    <p className="sub mt">O CA (Certificado de Aprovação) é emitido pelo Ministério do Trabalho. Com o CA vencido o EPI não pode ser entregue (NR-6). O sistema avisa 90 dias antes.</p>
  </>
}
export async function formCatalogo(c?: RhEpiCatalogo) {
  await modal({
    titulo: c ? 'EPI — ' + c.descricao : 'Cadastrar EPI',
    corpo: <>
      <Campo nome="descricao" rotulo="Descrição do EPI" valor={c?.descricao} req placeholder="Ex.: Luva de vaqueta" />
      <div className="linha-campos"><Campo nome="ca" rotulo="Número do C.A." valor={c?.ca} attrs={{ inputMode: 'numeric' }} req ajuda="Certificado de Aprovação" />
        <Campo nome="validade_ca" rotulo="Validade do CA" tipo="date" valor={c?.validade_ca} req /></div>
      <div className="linha-campos"><Campo nome="fabricante" rotulo="Fabricante" valor={c?.fabricante} /><Campo nome="tamanhos" rotulo="Tamanho(s)" valor={c?.tamanhos} placeholder="Ex.: P, M, G, GG ou 38 a 44" /></div>
      <div className="linha-campos"><Campo nome="onde_utiliza" rotulo="Onde utiliza" valor={c?.onde_utiliza} placeholder="Ex.: Fábrica, Solda MIG e TIG" attrs={{ list: 'lOnde' }} />
        <Campo nome="vida_util_meses" rotulo="Trocar a cada (meses)" tipo="num" valor={c?.vida_util_meses} ajuda="Opcional: avisa quando passar do prazo de troca." /></div>
      <datalist id="lOnde">{U.unicos(S.lista('rh_epi_catalogo').map(x => x.onde_utiliza).filter((x): x is string => !!x)).map(x => <option key={x} value={x} />)}</datalist>
      <Campo nome="obs" rotulo="Observação" valor={c?.obs} />
      {c ? <><Campo nome="ativo" rotulo="EPI em uso" tipo="check" valor={c.ativo} /><Anexos tabela="rh_epi_catalogo" registro={c.id} titulo="Documento do CA (PDF)" vazio="Nenhum PDF anexado." /></>
        : <div className="campo"><label htmlFor="caPdf">Documento do CA (PDF, opcional)</label><input id="caPdf" name="ca_pdf" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" /></div>}
    </>,
    botoes: [...(c ? [{ txt: 'Apagar', cls: 'perigo-txt', validar: false, acao: async () => {
      if (S.lista('rh_epis').some(e => e.catalogo_id === c.id)) { if (!(await confirmar('Este EPI já foi entregue. Marcar como fora de uso em vez de apagar?', { ok: 'Marcar fora de uso' }))) return false
        await API.rpc('rh_salvar_epi_catalogo', { p: { ...c, ativo: false } }); await App.gravou(['rh_epi_catalogo']); return }
      if (!(await confirmar('Apagar este EPI do cadastro?', { ok: 'Apagar', perigo: true }))) return false
      await API.rpc('rh_salvar_epi_catalogo', { p: { id: c.id, excluir: true } }); await App.gravou(['rh_epi_catalogo'], { inteira: ['rh_epi_catalogo'] })
    } }] : []), { txt: 'Salvar', acao: async (frm: HTMLFormElement) => {
      const d = lerForm(frm)
      const arq = (frm.elements.namedItem('ca_pdf') as HTMLInputElement | null)?.files?.[0]
      if (arq && (!TIPOS_OK.includes(arq.type) || arq.size > 4 * 1024 * 1024)) throw new ErroApp('O documento do CA precisa ser PDF, JPG ou PNG de até 4 MB.')
      const id = await API.rpc<string>('rh_salvar_epi_catalogo', { p: { descricao: d.descricao, ca: d.ca, validade_ca: d.validade_ca || null, fabricante: d.fabricante, tamanhos: d.tamanhos,
        onde_utiliza: d.onde_utiliza, vida_util_meses: U.num(d.vida_util_meses), obs: d.obs, id: c?.id, ativo: c ? d.ativo : true } })
      if (arq) await API.rpc('rh_anexar', { p: { tabela: 'rh_epi_catalogo', registro_id: id, nome: arq.name, tipo: arq.type, conteudo: await lerBase64(arq) } })
      await App.gravou(['rh_epi_catalogo', ...(arq ? ['rh_anexos'] as const : [])], arq ? { inteira: ['rh_anexos'] } : {}); aviso('EPI salvo.')
    } }],
  })
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

// linhas da entrega: escolhe o EPI do cadastro (CA, validade e fabricante vêm juntos) ou digita outro
interface LinhaEd { cat: string; epi: string; ca: string; tamanho: string; quantidade: string; vida: string }
const linhaVazia: LinhaEd = { cat: '', epi: '', ca: '', tamanho: '', quantidade: '1', vida: '' }
function VariosEpis() {
  const cats = catalogoAtivo()
  const [l, setL] = useState<LinhaEd[]>([{ ...linhaVazia }])
  const mud = (n: number, k: keyof LinhaEd, v: string) => setL(x => x.map((y, i) => i === n ? { ...y, [k]: v } : y))
  const hoje = U.hoje()
  return <>
    <input type="hidden" name="epis_json" value={JSON.stringify(l.filter(x => x.cat && x.cat !== 'outro' ? true : x.epi.trim()))} />
    <datalist id="lEpis">{U.unicos([...EPIS_COMUNS, ...S.lista('rh_epis').map(e => e.epi)]).map(x => <option key={x} value={x} />)}</datalist>
    <div className="itens-epi">{l.map((x, n) => { const c = x.cat && x.cat !== 'outro' ? S.get('rh_epi_catalogo', x.cat) : null
      return <div key={n} className="item-epi" data-item-epi={n}>
        <select aria-label="EPI" value={x.cat} onChange={(e) => mud(n, 'cat', e.target.value)} data-campo="cat">
          <option value="">{cats.length ? 'Escolha o EPI' : 'Digite o EPI abaixo'}</option>{cats.map(k => <option key={k.id} value={k.id}>{nomeCat(k)}</option>)}<option value="outro">Outro (digitar)</option></select>
        {(x.cat === 'outro' || !cats.length) && <div className="linha-campos"><input aria-label="Nome do EPI" placeholder="Nome do EPI" list="lEpis" value={x.epi} onChange={(e) => mud(n, 'epi', e.target.value)} />
          <input aria-label="CA" placeholder="CA" inputMode="numeric" value={x.ca} onChange={(e) => mud(n, 'ca', e.target.value)} /></div>}
        {c?.validade_ca && c.validade_ca < hoje && <p className="nota vermelha">CA {c.ca} vencido em {U.data(c.validade_ca)}: pela NR-6 este EPI não deveria ser entregue.</p>}
        <div className="linha-campos l3">
          <input aria-label="Tamanho" placeholder={c?.tamanhos ? 'Tamanho (' + c.tamanhos + ')' : 'Tamanho (ou N/A)'} value={x.tamanho} onChange={(e) => mud(n, 'tamanho', e.target.value)} />
          <input aria-label="Quantidade" placeholder="Qtd" inputMode="decimal" value={x.quantidade} onChange={(e) => mud(n, 'quantidade', e.target.value)} />
          <input aria-label="Trocar a cada (meses)" placeholder={c?.vida_util_meses ? `Troca: ${c.vida_util_meses} meses` : 'Troca (meses)'} inputMode="numeric" value={x.vida} onChange={(e) => mud(n, 'vida', e.target.value)} />
        </div>
        {l.length > 1 && <button type="button" className="btn fantasma mini" onClick={() => setL(y => y.filter((_, i) => i !== n))}><Ic n="x" /><span>Tirar este</span></button>}
      </div> })}</div>
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
        <div className="linha-campos"><Campo nome="fabricante" rotulo="Fabricante" valor={e.fabricante} /><Campo nome="tamanho" rotulo="Tamanho" valor={e.tamanho} /></div>
        <div className="linha-campos"><Campo nome="vida_util_meses" rotulo="Trocar a cada (meses)" tipo="num" valor={e.vida_util_meses} /><Campo nome="validade_ca" rotulo="Validade do CA" tipo="date" valor={e.validade_ca} /></div>
        <p className="sub">{e.assinatura ? `${TXT_ASSIN[e.assinatura]}${e.assinado_em ? ' em ' + U.dataHora(e.assinado_em) : ''}.` : 'Ainda sem assinatura do termo.'}</p>
        <Anexos tabela="rh_epis" registro={e.id} titulo="Assinatura e termo assinado" />
      </> : <VariosEpis />}
      <Campo nome="obs" rotulo="Observação" valor={e?.obs} />
    </>,
    botoes: [...(e ? [{ txt: 'Apagar', cls: 'perigo-txt', validar: false, acao: async () => {
      if (!(await confirmar('Apagar esta entrega?', { ok: 'Apagar', perigo: true }))) return false
      await API.rpc('rh_salvar_epi', { p: { id: e.id, excluir: true } }); await App.gravou(['rh_epis'], { inteira: ['rh_epis'] })
    } }] : []), { txt: e ? 'Salvar' : 'Registrar entrega', acao: async (frm: HTMLFormElement) => {
      const d = lerForm(frm)
      const fid = e?.funcionario_id || f?.id || d.funcionario_id
      const ids: string[] = []
      if (e) await API.rpc('rh_salvar_epi', { p: { ...d, id: e.id, catalogo_id: e.catalogo_id, funcionario_id: fid, validade_ca: d.validade_ca || null } })
      else {
        const l = JSON.parse(d.epis_json || '[]') as LinhaEd[]
        if (!l.length) throw new ErroApp('Escolha ou escreva pelo menos um EPI.')
        for (const x of l) {
          const cat = x.cat && x.cat !== 'outro' ? x.cat : null
          ids.push(await API.rpc<string>('rh_salvar_epi', { p: { funcionario_id: fid, entrega: d.entrega, motivo: d.motivo, obs: d.obs, catalogo_id: cat, epi: cat ? null : x.epi, ca: cat ? null : x.ca,
            tamanho: x.tamanho, quantidade: U.num(x.quantidade) || 1, vida_util_meses: U.num(x.vida) } }))
        }
      }
      await App.gravou(['rh_epis'])
      const p = S.get('funcionarios', fid)
      aviso(e ? 'Salvo.' : 'Entrega registrada.', 'ok', !e && p ? { acao: { txt: 'Assinar o termo', fn: () => void termoEpi(p, ids) }, tempo: 10000 } : {})
    } }],
  })
}

// ------------------------------------------------------------------ assinatura: foto do rosto (câmera) ou na tela (dedo / mouse)
function FotoRosto({ aoMudar }: { aoMudar: (b64: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [estado, setEstado] = useState<'ligando' | 'ao vivo' | 'sem camera' | 'foto'>('ligando')
  const [foto, setFoto] = useState('')
  const stream = useRef<MediaStream | null>(null)
  const ligar = async () => {
    setEstado('ligando')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('sem câmera')
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false })
      if (video.current) { video.current.srcObject = stream.current; await video.current.play().catch(() => null) }
      setEstado('ao vivo')
    } catch { setEstado('sem camera') }
  }
  const parar = () => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null }
  useEffect(() => { void ligar(); return parar }, [])
  const tirar = () => {
    const v = video.current; if (!v || !v.videoWidth) return
    const cv = document.createElement('canvas'), w = 480, h = Math.round(v.videoHeight * w / v.videoWidth)
    cv.width = w; cv.height = h
    const ctx = cv.getContext('2d')!; ctx.translate(w, 0); ctx.scale(-1, 1); ctx.drawImage(v, 0, 0, w, h)
    const url = cv.toDataURL('image/jpeg', 0.82)
    setFoto(url); aoMudar(url.split(',')[1] || ''); setEstado('foto'); parar()
  }
  const arquivo = async (fl: FileList | null) => {
    const a = fl?.[0]; if (!a) return
    const url = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(a) })
    // diminui a foto (o celular tira fotos enormes)
    const img = new Image(); img.src = url; await img.decode().catch(() => null)
    const cv = document.createElement('canvas'), w = Math.min(480, img.width || 480), h = Math.round((img.height || 360) * w / (img.width || 480))
    cv.width = w; cv.height = h; cv.getContext('2d')!.drawImage(img, 0, 0, w, h)
    const menor = cv.toDataURL('image/jpeg', 0.82)
    setFoto(menor); aoMudar(menor.split(',')[1] || ''); setEstado('foto')
  }
  return <div className="assin-caixa" data-assin="facial">
    {estado === 'foto' ? <img src={foto} alt="Foto do rosto" className="assin-foto" /> : <video ref={video} className="assin-video" playsInline muted hidden={estado !== 'ao vivo'} />}
    {estado === 'ligando' && <p className="sub">Ligando a câmera… Se o navegador perguntar, toque em Permitir.</p>}
    {estado === 'sem camera' && <p className="sub">Não deu para abrir a câmera aqui. Tire a foto do rosto pelo botão abaixo.</p>}
    <div className="grupo-btn mt">
      {estado === 'ao vivo' && <button type="button" className="btn pri" data-assin="tirar" onClick={tirar}><Ic n="ok" /><span>Tirar a foto</span></button>}
      {estado === 'foto' && <button type="button" className="btn sec" onClick={() => { setFoto(''); aoMudar(''); void ligar() }}><Ic n="desfazer" /><span>Tirar de novo</span></button>}
      {estado !== 'ao vivo' && <label className="btn sec"><Ic n="enviar" /><span>{estado === 'foto' ? 'Escolher outra foto' : 'Tirar / escolher foto'}</span>
        <input type="file" accept="image/*" capture="user" hidden onChange={(e) => void arquivo(e.target.files)} /></label>}
    </div>
  </div>
}
function AssinaturaTela({ aoMudar }: { aoMudar: (b64: string) => void }) {
  const cv = useRef<HTMLCanvasElement>(null)
  const des = useRef(false), tem = useRef(false)
  useEffect(() => {
    const c = cv.current!; const r = c.getBoundingClientRect()
    c.width = Math.round(r.width * 2); c.height = Math.round(r.height * 2)
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
    ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'
  }, [])
  const ponto = (e: EvPonteiro<HTMLCanvasElement>) => { const r = cv.current!.getBoundingClientRect(); return [(e.clientX - r.left) * 2, (e.clientY - r.top) * 2] as const }
  const fim = () => { if (!des.current) return; des.current = false; if (tem.current) aoMudar(cv.current!.toDataURL('image/png').split(',')[1] || '') }
  const limpar = () => { const c = cv.current!, ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); tem.current = false; aoMudar('') }
  return <div className="assin-caixa" data-assin="tela">
    <canvas ref={cv} className="assin-tela" aria-label="Assine aqui com o dedo ou o mouse"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); des.current = true; const [x, y] = ponto(e); const ctx = cv.current!.getContext('2d')!; ctx.beginPath(); ctx.moveTo(x, y) }}
      onPointerMove={(e) => { if (!des.current) return; const [x, y] = ponto(e); const ctx = cv.current!.getContext('2d')!; ctx.lineTo(x, y); ctx.stroke(); tem.current = true }}
      onPointerUp={fim} onPointerCancel={fim} onPointerLeave={fim} />
    <div className="grupo-btn mt"><span className="sub">Assine dentro do quadro com o dedo ou o mouse.</span><button type="button" className="btn fantasma mini" onClick={limpar}><Ic n="lixo" /><span>Limpar</span></button></div>
  </div>
}
function EscolhaAssinatura({ epis, marcar }: { epis: RhEpi[]; marcar: string[] }) {
  const [modo, setModo] = useState<'facial' | 'tela' | 'papel'>('facial')
  const [img, setImg] = useState('')
  const sel = (e: RhEpi) => marcar.length ? marcar.includes(e.id) : !e.assinatura || epis.every(x => x.assinatura)
  return <>
    <div className="campo"><label>EPIs deste termo</label>
      <div className="escolher-pessoas">{epis.map(e => <label key={e.id} className="check"><input type="checkbox" name={'e_' + e.id} defaultChecked={sel(e)} />
        <span>{U.dataCurta(e.entrega)} — {e.epi}{e.ca ? ' · CA ' + e.ca : ''}{e.tamanho ? ' · tam. ' + e.tamanho : ''}<small className="fraco"> {e.assinatura ? '· ' + TXT_ASSIN[e.assinatura].toLowerCase() : '· sem assinatura'}</small></span></label>)}</div></div>
    <div className="campo"><label>Como a pessoa vai assinar</label><div className="opcoes">{([['facial', 'Assinatura facial', 'tira uma foto do rosto agora (câmera do celular, tablet ou computador)'],
      ['tela', 'Assinar na tela', 'a pessoa assina com o dedo ou o mouse'], ['papel', 'Imprimir e assinar no papel', 'gera o termo com a linha para assinar à mão']] as const).map(([v, t, d]) =>
      <label key={v} className="opcao"><input type="radio" name="modo" value={v} checked={modo === v} onChange={() => { setModo(v); setImg('') }} /><span><b>{t}</b><small>{d}</small></span></label>)}</div></div>
    <input type="hidden" name="assin" value={img} />
    {modo === 'facial' ? <FotoRosto key="f" aoMudar={setImg} /> : modo === 'tela' ? <AssinaturaTela key="t" aoMudar={setImg} /> : null}
  </>
}

// termo de responsabilidade (NR-6): escolhe os EPIs, a forma de assinar e gera o PDF
export async function termoEpi(f: Funcionario, marcar: string[] = []): Promise<void> {
  const epis = U.ordenar(S.lista('rh_epis').filter(e => e.funcionario_id === f.id), e => e.entrega, true)
  if (!epis.length) { aviso('Nenhum EPI entregue para esta pessoa.', 'erro'); return }
  const ordem = marcar.length ? [...epis.filter(e => marcar.includes(e.id)), ...epis.filter(e => !marcar.includes(e.id))] : epis
  await modal({
    titulo: 'Termo de responsabilidade de EPI — ' + f.nome, largura: 'larga',
    corpo: <EscolhaAssinatura epis={ordem} marcar={marcar} />,
    botoes: [{ txt: 'Só gerar o PDF', cls: 'sec', validar: false, acao: async (frm: HTMLFormElement) => {
      const ids = [...frm.querySelectorAll<HTMLInputElement>('input[name^="e_"]:checked')].map(x => x.name.slice(2))
      if (!ids.length) throw new ErroApp('Marque pelo menos um EPI.')
      await pdfTermo(f, ids)
    } }, { txt: pode() ? 'Assinar e gerar o termo' : 'Gerar o termo', acao: async (frm: HTMLFormElement) => {
      const d = lerForm(frm)
      const ids = [...frm.querySelectorAll<HTMLInputElement>('input[name^="e_"]:checked')].map(x => x.name.slice(2))
      if (!ids.length) throw new ErroApp('Marque pelo menos um EPI.')
      if (d.modo !== 'papel' && !d.assin) throw new ErroApp(d.modo === 'facial' ? 'Tire a foto do rosto antes.' : 'Faça a assinatura no quadro antes.')
      if (pode()) {
        await API.rpc('rh_assinar_epis', { p: { ids, modo: d.modo, conteudo: d.modo === 'papel' ? null : d.assin, tipo: d.modo === 'tela' ? 'image/png' : 'image/jpeg' } })
        await App.gravou(['rh_epis', 'rh_anexos'], { inteira: ['rh_anexos'] })
      }
      await pdfTermo(f, ids, d.modo === 'papel' ? null : { modo: d.modo as 'facial' | 'tela', b64: d.assin })
      aviso(d.modo === 'papel' ? 'Termo pronto para imprimir e assinar.' : 'Termo assinado.')
    } }],
  })
}
// a imagem mais recente de assinatura dos EPIs escolhidos (para pôr no PDF)
async function ultimaAssinatura(ids: string[]): Promise<{ modo: 'facial' | 'tela'; b64: string } | null> {
  const es = S.lista('rh_epis').filter(e => ids.includes(e.id) && (e.assinatura === 'facial' || e.assinatura === 'tela')).sort((a, b) => (a.assinado_em || '') < (b.assinado_em || '') ? 1 : -1)
  for (const e of es) {
    const a = anexosDe('rh_epis', e.id).filter(x => x.tipo.startsWith('image/') && /^Assinatura/.test(x.nome)).sort((x, y) => x.criado_em < y.criado_em ? 1 : -1)[0]
    if (!a) continue
    try { const r = await API.rpc<{ conteudo: string }>('rh_baixar_anexo', { p_id: a.id }); return { modo: e.assinatura as 'facial' | 'tela', b64: r.conteudo } } catch { /* sem acesso: fica só o texto */ }
  }
  return null
}
async function pdfTermo(f: Funcionario, ids: string[], nova: { modo: 'facial' | 'tela'; b64: string } | null = null) {
  const l = U.ordenar(S.lista('rh_epis').filter(e => ids.includes(e.id)), e => e.entrega)
  const assin = nova || await ultimaAssinatura(ids)
  const emp = empresaDe() as Record<string, string>
  const p = S.get('funcionarios_privado', f.id)
  const empresa = razaoEmpresa().toUpperCase()
  const blob = await pdfDocumento('Declaração de recebimento de EPI', 'e responsabilidade de uso e guarda — NR-6', (c) => {
    let y = c.y + 1
    c.tabela({ ...c.estilo, startY: y, theme: 'plain', styles: { ...c.estilo.styles, fontSize: 8.6, cellPadding: 0.9 },
      body: [[`Funcionário: ${[f.matricula, f.nome].filter(Boolean).join(' / ')}`, `Setor: ${f.setor || ''}`], [`Empresa: ${empresa}`, `Matrícula: ${f.matricula || ''}`],
        [`Cargo: ${f.funcao || ''}`, `Admissão: ${f.admissao ? U.data(f.admissao) : ''}`], [`Registro: ${f.registro || ''}`, `Nascimento: ${p?.nascimento ? U.data(p.nascimento) + (R.idade(p.nascimento) ? ` (${R.idade(p.nascimento)} anos)` : '') : ''}`],
        ...(p?.rg ? [['', `RG: ${p.rg}`]] : [])] })
    y = c.doc.lastAutoTable.finalY + 4
    const local = [emp.endereco, emp.cidade && emp.uf ? emp.cidade + '/' + emp.uf : emp.cidade].filter(Boolean).join(', ').toUpperCase()
    y = c.texto(`Eu, ${f.nome.toUpperCase()}, declaro para todos os efeitos legais que recebi gratuitamente, conforme os artigos 166 e 167 da C.L.T., a NR-6 e os itens 1.4.2 e 1.5.5.1.2 da NR-1 (Disposições Gerais e Gerenciamento de Riscos Ocupacionais), depois de treinamento e orientação sobre o uso adequado, aplicação, guarda, conservação, substituição e higiene, da empresa ${empresa}${local ? ', situada em ' + local : ''}, o(s) equipamento(s) de proteção individual (EPI) descrito(s) abaixo, que me obrigo a usar sempre em meu trabalho, nos seguintes termos:`, y, { tam: 8.8 }) + 1
    for (const t of ['a) O EPI será usado somente para a finalidade a que se destina; qualquer dano que o torne parcial ou totalmente inutilizável será comunicado por mim à empresa;',
      'b) Responsabilizo-me pela guarda e conservação dos EPIs que me foram confiados; não podendo usá-los, comunicarei a chefia imediatamente e os devolverei ao fim da vida útil ou para substituição;',
      'c) Estou ciente de que a falta de uso dos EPIs fornecidos pela empresa constitui ato faltoso, sujeito às sanções disciplinares previstas na legislação, no Regulamento Interno e nas Normas de Segurança da empresa;',
      'd) Reconheço que a recusa injustificada ao uso configura falta grave (art. 158, parágrafo único, e art. 482, alínea "h", da C.L.T. — indisciplina ou insubordinação), podendo levar à rescisão do contrato por justa causa;',
      'e) Autorizo a empresa a descontar do meu salário o valor dos EPIs que forem danificados de propósito, extraviados ou não devolvidos para substituição;',
      'f) Li, entendi e concordo com os termos desta declaração, que assino de livre e espontânea vontade.']) y = c.texto(t, y, { tam: 8.6 })
    y += 2
    const ultimaData = l.at(-1)?.assinado_em ? U.data(l.at(-1)!.assinado_em!.slice(0, 10)) : '____/____/______'
    y = c.texto(`Data: ${nova ? U.data(U.hoje()) : ultimaData}`, y, { tam: 9 }) + 2
    // assinatura: foto do rosto / desenho, ou a linha para assinar à mão
    if (y > c.H - 95) { c.doc.addPage(); y = 20 }
    const x0 = c.W / 2 - 40
    if (assin) {
      const tipo = assin.modo === 'tela' ? 'PNG' : 'JPEG'
      const alt = assin.modo === 'facial' ? 30 : 18, larg = assin.modo === 'facial' ? 24 : 60
      try { c.doc.addImage('data:image/' + tipo.toLowerCase() + ';base64,' + assin.b64, tipo, c.W / 2 - larg / 2, y, larg, alt) } catch { /* imagem ruim: fica a linha */ }
      y += alt + 2
    } else y += 14
    c.assinatura(f.nome.toUpperCase(), assin ? (assin.modo === 'facial' ? 'Assinatura facial (foto do rosto)' : 'Assinatura na tela') : 'Assinatura do funcionário', x0, y, 80)
    y += 14
    c.tabela({ ...c.estilo, startY: y, head: [['Data de entrega', 'Qtd.', 'EPI', 'CA', 'Tamanho', 'Assinatura', 'Ativo']],
      body: l.map(e => [U.data(e.entrega), U.qtd(e.quantidade), [e.epi, e.fabricante].filter(Boolean).join('\n'), e.ca || '', e.tamanho || 'N/A',
        e.assinatura === 'facial' ? 'Assinado por foto (facial)' : e.assinatura === 'tela' ? 'Assinado na tela' : (nova && ids.includes(e.id) ? TXT_ASSIN[nova.modo] : ''),
        S.get('funcionarios', e.funcionario_id)?.ativo ? 'Sim' : 'Não']),
      columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 11, halign: 'center' }, 3: { cellWidth: 16 }, 4: { cellWidth: 18, halign: 'center' }, 5: { cellWidth: 40 }, 6: { cellWidth: 12, halign: 'center' } } })
  })
  await entregar(blob, `Termo EPI ${f.nome} ${U.hoje()}.pdf`)
}
// nome antigo (ficha de EPI): agora é o termo
export const fichaEpi = (f: Funcionario) => termoEpi(f)

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
      {epis.length > 0 && <Btn txt="Termo de responsabilidade" icone="imprimir" cls="sec mini" data-seg="fichaEpi" onClick={() => termoEpi(f)} />}
      {pode() && <Btn txt="Entregar EPI" icone="mais" cls="sec mini" data-seg="epi" onClick={() => void formEpi(f)} />}</div></div>
      {epis.length ? <div className="lista">{epis.map(e => <LinhaEpi key={e.id} e={e} />)}</div> : <p className="sub">Nenhuma entrega registrada.</p>}</section>
  </>
}
