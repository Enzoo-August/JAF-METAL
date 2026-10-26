/* RH — Medidas disciplinares: advertência verbal, advertência escrita e suspensão (com os modelos de documento da JAF e o art. 482 da CLT) */
import { useState } from 'react'
import { App } from '../../app/controle.tsx'
import { API, ErroApp } from '../../lib/api.ts'
import { S } from '../../lib/dados.ts'
import * as R from '../../lib/rh.ts'
import type { Cor, Funcionario, RhOcorrencia } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { aviso, erro } from '../../ui/avisos.ts'
import { entregar, pdfDocumento } from '../../ui/arquivos.tsx'
import { Btn, Cab, Campo, Chips, Paginado, Tag, Vazio, type OpcaoChip } from '../../ui/base.tsx'
import { useLembrar } from '../../ui/ganchos.ts'
import { Ic } from '../../ui/icones.tsx'
import { lerForm, modal } from '../../ui/janelas.tsx'
import { Anexos, cidadeEmpresa, dataExtenso, nomeF, opcoesPessoas, pode, razaoEmpresa, sensivel } from './comum.tsx'

export const TIPO_OC: Record<RhOcorrencia['tipo'], [string, Cor]> = { verbal: ['Advertência verbal', 'azul'], escrita: ['Advertência escrita', 'amarelo'], suspensao: ['Suspensão', 'vermelho'] }
export const STATUS_OC: Record<RhOcorrencia['status'], [string, Cor]> = { rascunho: ['Rascunho', 'cinza'], pendente: ['Falta assinar', 'amarelo'], assinado: ['Assinado', 'verde'], recusado: ['Recusou assinar', 'vermelho'], cancelado: ['Cancelado', 'cinza'] }

// histórico dos últimos 12 meses e a próxima medida sugerida (gradação das penas)
export function gradacao(fid: string, ignorar?: string) {
  const de = U.somaMeses(U.hoje(), -12)
  const l = S.lista('rh_ocorrencias').filter(o => o.funcionario_id === fid && o.id !== ignorar && o.status !== 'cancelado' && o.status !== 'rascunho' && o.data_ocorrencia >= de)
  const n = { verbal: l.filter(o => o.tipo === 'verbal').length, escrita: l.filter(o => o.tipo === 'escrita').length, suspensao: l.filter(o => o.tipo === 'suspensao').length }
  const sugestao = n.suspensao ? 'Já teve suspensão: nova falta grave pode levar à dispensa por justa causa (consulte o jurídico).'
    : n.escrita ? 'Próximo passo, se repetir: suspensão.' : n.verbal ? 'Próximo passo, se repetir: advertência escrita.' : 'Primeira medida: em geral começa pela advertência verbal (exceto falta grave).'
  return { l, n, sugestao }
}

export function TelaDisciplina() {
  const [st, setSt] = useLembrar('disc.st', 'abertas')
  const todas = S.lista('rh_ocorrencias')
  const n = (s: string) => todas.filter(o => o.status === s).length
  const chips: OpcaoChip[] = [{ v: 'abertas', t: 'Falta assinar', n: n('pendente') + n('rascunho') }, { v: 'assinado', t: 'Assinadas', n: n('assinado') }, { v: 'recusado', t: 'Recusou assinar', n: n('recusado') },
    { v: 'cancelado', t: 'Canceladas', n: n('cancelado') }, { v: '', t: 'Todas', n: todas.length }]
  const l = U.ordenar(todas.filter(o => !st || (st === 'abertas' ? o.status === 'pendente' || o.status === 'rascunho' : o.status === st)), o => o.data_ocorrencia, true)
  return <>
    <Cab titulo="Advertências e suspensões" sub="Medidas disciplinares com o documento pronto para assinar.">
      {pode() && <Btn txt="Nova medida" icone="mais" cls="pri" data-disc="nova" onClick={() => void formOcorrencia()} />}
    </Cab>
    <Chips atual={st} aoEscolher={setSt} nome="ds" opcoes={chips} />
    <div className="mt"><Paginado itens={l} render={o => <LinhaOc key={o.id} o={o} comNome />} vazio={<Vazio icone="ok" titulo="Nada aqui" />} /></div>
    <p className="sub mt">Confidencial: só RH, Escritório, Dono e gerente de fábrica veem. Toda mudança fica no histórico do sistema.</p>
  </>
}
function LinhaOc({ o, comNome }: { o: RhOcorrencia; comNome?: boolean }) {
  return <div className={`linha${pode() ? ' clicavel' : ''}`} data-oc={o.id} onClick={() => { const f = S.get('funcionarios', o.funcionario_id); if (pode() && f) void formOcorrencia(f, o) }}>
    <span className={`sinal ${o.tipo === 'suspensao' ? 'sai' : 'ent'}`}><Ic n="alerta" /></span>
    <div className="meio"><b>{comNome ? nomeF(o.funcionario_id) + ' — ' : ''}{TIPO_OC[o.tipo][0]} nº {o.numero}</b>
      <small>{[U.data(o.data_ocorrencia), o.assunto || o.categoria, o.tipo === 'suspensao' && o.dias ? `${U.plural(o.dias, 'dia')} (${U.dataCurta(o.inicio)} a ${U.dataCurta(U.somaDias(o.retorno!, -1))})` : ''].filter(Boolean).join(' · ')}</small></div>
    <div className="lado"><Tag s={{ txt: STATUS_OC[o.status][0], cor: STATUS_OC[o.status][1] }} />
      {sensivel() && o.tipo !== 'verbal' && <button type="button" className="btn sec mini" onClick={(e) => { e.stopPropagation(); const f = S.get('funcionarios', o.funcionario_id); if (f) void documento(f, o).catch(erro) }}><Ic n="imprimir" /><span>PDF</span></button>}</div></div>
}

// modelos de texto (a partir dos documentos que a JAF já usa)
const MODELOS: Record<string, string> = {
  'Desídia (atrasos, faltas sem justificativa, baixa produção)': 'Informamos que foi constatada sua ausência no dia __/__/____ sem a devida justificativa ou comunicação prévia à empresa. A ausência injustificada configura descumprimento das obrigações previstas no contrato de trabalho e nas normas internas da empresa, podendo comprometer o bom andamento das atividades.',
  'Agressão verbal ou física': 'Em razão de ter se envolvido em discussão com agressões verbais e físicas contra outro colaborador, nas dependências da empresa. Sua conduta viola as normas internas da empresa, os princípios de respeito mútuo, disciplina e convivência adequada no ambiente de trabalho, além de comprometer a ordem e a segurança de todos os colaboradores.',
  'Descumprimento de regras de segurança (EPI)': 'Foi constatado que o(a) colaborador(a) não utilizava o Equipamento de Proteção Individual obrigatório durante a execução de suas atividades, apesar de ter recebido o EPI e as orientações de uso (NR-6 e art. 158 da CLT).',
  'Insubordinação ou indisciplina': 'Foi constatado o descumprimento de ordem direta do superior imediato / das normas internas da empresa, caracterizando ato de indisciplina ou insubordinação.',
}

function CamposOcorrencia({ f0, o }: { f0: Funcionario | null; o: Partial<RhOcorrencia> }) {
  const [fid, setFid] = useState(f0?.id || o.funcionario_id || '')
  const [tipo, setTipo] = useState<RhOcorrencia['tipo']>(o.tipo || 'verbal')
  const [status, setStatus] = useState<RhOcorrencia['status']>(o.status || 'pendente')
  const [cat, setCat] = useState(o.categoria || '')
  const [desc, setDesc] = useState(o.descricao || '')
  const [ini, setIni] = useState(o.inicio || '')
  const [dias, setDias] = useState(String(o.dias || 1))
  const g = fid ? gradacao(fid, o.id) : null
  const reinc = fid && cat ? S.lista('rh_ocorrencias').some(x => x.funcionario_id === fid && x.id !== o.id && x.categoria === cat && x.status !== 'cancelado' && x.data_ocorrencia >= U.somaMeses(U.hoje(), -6)) : false
  const n = Number(dias) || 0
  return <>
    {!f0 && <Campo nome="funcionario_id" rotulo="Quem" tipo="select" req valor={fid} opcoes={opcoesPessoas()} attrs={{ onChange: (e: { target: HTMLSelectElement }) => setFid(e.target.value) }} />}
    {f0 && <input type="hidden" name="funcionario_id" value={f0.id} />}
    {g && <p className={`nota${g.l.length ? ' amarela' : ''}`}>Últimos 12 meses: {g.n.verbal} verbal, {g.n.escrita} escrita, {g.n.suspensao} suspensão. {g.sugestao}</p>}
    <div className="campo"><label>Medida</label><div className="opcoes">{(Object.keys(TIPO_OC) as RhOcorrencia['tipo'][]).map(t => <label key={t} className="opcao"><input type="radio" name="tipo" value={t} checked={tipo === t} onChange={() => setTipo(t)} /><span><b>{TIPO_OC[t][0]}</b></span></label>)}</div></div>
    <div className="linha-campos"><Campo nome="data_ocorrencia" rotulo="Quando aconteceu" tipo="date" req valor={o.data_ocorrencia || U.hoje()} /><Campo nome="data_aplicacao" rotulo="Data da medida" tipo="date" valor={o.data_aplicacao || U.hoje()} /></div>
    <div className="linha-campos"><Campo nome="categoria" rotulo="Tipo de falta" tipo="select" valor={cat} opcoes={[{ v: '', t: 'Escolha' }, ...R.CATEGORIAS_DISC.map(x => ({ v: x, t: x }))]} attrs={{ onChange: (e: { target: HTMLSelectElement }) => setCat(e.target.value) }} />
      <Campo nome="assunto" rotulo="Assunto (curto)" valor={o.assunto} placeholder="Ex.: Falta sem justificativa" /></div>
    {reinc && <p className="nota vermelha">Reincidência: já houve medida pelo mesmo motivo nos últimos 6 meses.</p>}
    <div className="campo"><label htmlFor="ocDesc">O que aconteceu <i className="req">*</i></label>
      <textarea id="ocDesc" name="descricao" rows={4} required value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Descreva o fato: dia, hora, local e o que foi feito." />
      {MODELOS[cat] && !desc && <button type="button" className="btn fantasma mini" onClick={() => setDesc(MODELOS[cat])}><Ic n="copiar" /><span>Usar texto modelo</span></button>}</div>
    {tipo === 'suspensao' && <div className="linha-campos"><Campo nome="dias" rotulo="Dias de suspensão" tipo="select" valor={dias} opcoes={Array.from({ length: 30 }, (_, i) => ({ v: String(i + 1), t: U.plural(i + 1, 'dia') }))} attrs={{ onChange: (e: { target: HTMLSelectElement }) => setDias(e.target.value) }} />
      <div className="campo"><label htmlFor="ocIni">Primeiro dia <i className="req">*</i></label><input id="ocIni" type="date" name="inicio" required value={ini} onChange={(e) => setIni(e.target.value)} />
        {ini && n ? <small>Fica suspenso(a) de {U.data(ini)} a {U.data(U.somaDias(ini, n - 1))} e volta em {U.data(U.somaDias(ini, n))}. Os dias ficam travados no ponto, sem pagamento.</small> : null}</div></div>}
    <Campo nome="status" rotulo="Situação" tipo="select" valor={status} opcoes={Object.entries(STATUS_OC).map(([v, [t]]) => ({ v, t }))} attrs={{ onChange: (e: { target: HTMLSelectElement }) => setStatus(e.target.value as RhOcorrencia['status']) }} />
    {status === 'recusado' && <><p className="nota amarela">Quando a pessoa se recusa a assinar, duas testemunhas assinam no lugar.</p>
      <div className="linha-campos"><Campo nome="testemunha1" rotulo="Testemunha 1" req valor={o.testemunha1} /><Campo nome="testemunha1_cpf" rotulo="CPF" valor={o.testemunha1_cpf} /></div>
      <div className="linha-campos"><Campo nome="testemunha2" rotulo="Testemunha 2" req valor={o.testemunha2} /><Campo nome="testemunha2_cpf" rotulo="CPF" valor={o.testemunha2_cpf} /></div></>}
    <div className="linha-campos"><Campo nome="aplicador" rotulo="Quem aplicou" valor={o.aplicador || API.sessao?.nome} /><Campo nome="aplicador_cargo" rotulo="Cargo de quem aplicou" valor={o.aplicador_cargo} /></div>
    <Campo nome="obs" rotulo="Observação interna" valor={o.obs} />
    {o.id && <Anexos tabela="rh_ocorrencias" registro={o.id} titulo="Documento assinado / provas" />}
  </>
}
export async function formOcorrencia(f?: Funcionario | null, o?: RhOcorrencia): Promise<void> {
  const r = await modal<{ id: string; fid: string }>({
    titulo: o ? `${TIPO_OC[o.tipo][0]} nº ${o.numero} — ${nomeF(o.funcionario_id)}` : f ? 'Nova medida — ' + f.nome : 'Nova medida disciplinar', largura: 'larga',
    corpo: <CamposOcorrencia f0={f || null} o={o || {}} />,
    botoes: [{ txt: 'Salvar', acao: async (frm) => {
      const d = lerForm(frm)
      if (d.status === 'recusado' && (!d.testemunha1 || !d.testemunha2)) throw new ErroApp('Quando a pessoa se recusa a assinar, são obrigatórias 2 testemunhas.')
      const res = await API.rpc<{ id: string; numero: number }>('rh_salvar_ocorrencia', { p: { ...d, id: o?.id, recusou: d.status === 'recusado', dias: d.dias ? Number(d.dias) : null, inicio: d.inicio || null, data_aplicacao: d.data_aplicacao || null } })
      await App.gravou(['rh_ocorrencias', 'rh_ausencias'], { inteira: ['rh_ausencias'] })
      return { id: res.id, fid: d.funcionario_id }
    } }],
  })
  if (!r) return
  const oc = S.get('rh_ocorrencias', r.id), p = S.get('funcionarios', r.fid)
  aviso('Salvo.', 'ok', oc && p && oc.tipo !== 'verbal' && sensivel() ? { acao: { txt: 'Documento PDF', fn: () => documento(p, oc).catch(erro) }, tempo: 9000 } : {})
}

// ------------------------------------------------------------------ documento para assinar
const EXTENSO = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove', 'vinte']
const extenso = (n: number) => n <= 20 ? EXTENSO[n] : n < 30 ? 'vinte e ' + EXTENSO[n - 20] : 'trinta'
const ALINEAS = 'As alíneas do art. 482 da CLT (justa causa): a) ato de improbidade; b) incontinência de conduta ou mau procedimento; c) negociação habitual sem permissão do empregador; d) condenação criminal sem suspensão da pena; e) desídia no desempenho das funções; f) embriaguez habitual ou em serviço; g) violação de segredo da empresa; h) ato de indisciplina ou de insubordinação; i) abandono de emprego; j) ato lesivo da honra ou da boa fama, ou ofensas físicas, contra qualquer pessoa no serviço; k) o mesmo contra o empregador e superiores; l) prática constante de jogos de azar.'
export async function documento(f: Funcionario, o: RhOcorrencia): Promise<void> {
  const priv = S.get('funcionarios_privado', f.id)
  const susp = o.tipo === 'suspensao'
  const blob = await pdfDocumento(susp ? 'Suspensão disciplinar' : 'Advertência disciplinar', `Nº ${o.numero}${o.assunto ? ' · ' + o.assunto : ''}`, (c) => {
    let y = c.y + 2
    c.tabela({ ...c.estilo, startY: y, theme: 'plain', styles: { ...c.estilo.styles, fontSize: 9.5, cellPadding: 1 }, columnStyles: { 0: { cellWidth: 30, textColor: 100 } },
      body: [['Empresa', razaoEmpresa()], ['Funcionário', f.nome], ['CPF', priv?.cpf || ''], ['Cargo', f.funcao || ''], ['Data', U.data(o.data_aplicacao || U.hoje())], ...(o.assunto ? [['Assunto', o.assunto]] : [])] })
    y = c.doc.lastAutoTable.finalY + 6
    if (susp && o.inicio && o.dias) {
      y = c.texto(`Ao Sr.(a) ${f.nome},`, y, { tam: 10.5 }) + 2
      y = c.texto(`Comunicamos que V.Sa. está sendo suspenso(a) disciplinarmente por ${String(o.dias).padStart(2, '0')} (${extenso(o.dias)}) dia(s), no período de ${U.data(o.inicio)} a ${U.data(U.somaDias(o.inicio, o.dias - 1))}, devendo retornar ao trabalho em ${U.data(U.somaDias(o.inicio, o.dias))}, em razão dos fatos ocorridos no dia ${U.data(o.data_ocorrencia)}:`, y, { tam: 10.5 }) + 2
      y = c.texto(o.descricao || '', y, { tam: 10.5 }) + 2
      y = c.texto('Diante da gravidade dos fatos, fica aplicada a presente penalidade disciplinar, nos termos da legislação trabalhista e do regulamento interno da empresa. Advertimos que a reincidência em condutas semelhantes poderá ensejar medidas disciplinares mais severas, inclusive dispensa por justa causa, conforme previsto no art. 482 da CLT.', y, { tam: 10.5 }) + 2
      y = c.texto('Declaro estar ciente do conteúdo desta suspensão.', y, { tam: 10.5 }) + 3
    } else {
      y = c.texto(`Prezado(a) Sr.(a) ${f.nome},`, y, { tam: 10.5 }) + 2
      y = c.texto(o.descricao || '', y, { tam: 10.5 }) + 2
      y = c.texto('Diante do exposto, fica o(a) Sr.(a) formalmente advertido(a), sendo esta uma medida de caráter educativo. Alertamos que a reincidência poderá acarretar medidas disciplinares mais severas, conforme previsto na Consolidação das Leis do Trabalho (CLT). Solicitamos maior comprometimento com suas responsabilidades e o cumprimento das normas estabelecidas.', y, { tam: 10.5 }) + 3
    }
    y = c.texto(`${cidadeEmpresa()}, ${dataExtenso(o.data_aplicacao || U.hoje())}.`, y, { tam: 10.5 }) + 18
    if (y > c.H - 70) { c.doc.addPage(); y = 30 }
    c.assinatura(razaoEmpresa(), o.aplicador ? `${o.aplicador}${o.aplicador_cargo ? ' — ' + o.aplicador_cargo : ''}` : 'Representante da empresa', 14, y, 80)
    c.assinatura(f.nome, o.recusou ? 'Recusou-se a assinar' : 'Funcionário(a)', c.W - 94, y, 80)
    y += 16
    if (o.recusou) y = c.texto('O(a) empregado(a) recusou-se a assinar o presente documento, sendo colhidas as assinaturas das testemunhas abaixo.', y, { tam: 9.5 }) + 14
    else y += 6
    c.assinatura(o.testemunha1 || 'Testemunha 1', o.testemunha1_cpf ? 'CPF ' + o.testemunha1_cpf : '', 14, y, 80)
    c.assinatura(o.testemunha2 || 'Testemunha 2', o.testemunha2_cpf ? 'CPF ' + o.testemunha2_cpf : '', c.W - 94, y, 80)
    y += 18
    if (y > c.H - 30) { c.doc.addPage(); y = 20 }
    c.texto(ALINEAS, y, { tam: 7.5, cor: 110 })
  })
  await entregar(blob, `${susp ? 'Suspensao' : 'Advertencia'} ${o.numero} ${f.nome}.pdf`)
}

// ------------------------------------------------------------------ na ficha
export function DisciplinaDaPessoa({ f }: { f: Funcionario }) {
  const l = U.ordenar(S.lista('rh_ocorrencias').filter(o => o.funcionario_id === f.id), o => o.data_ocorrencia, true)
  const g = gradacao(f.id)
  return <section className="card"><div className="card-cab"><h2>Advertências e suspensões</h2>{pode() && f.ativo && <Btn txt="Nova medida" icone="mais" cls="sec mini" data-disc="nova" onClick={() => void formOcorrencia(f)} />}</div>
    {l.length ? <><p className="sub">Últimos 12 meses: {g.n.verbal} verbal, {g.n.escrita} escrita, {g.n.suspensao} suspensão.</p><div className="lista mt">{l.map(o => <LinhaOc key={o.id} o={o} />)}</div></>
      : <p className="sub">Nenhuma medida disciplinar.</p>}</section>
}
