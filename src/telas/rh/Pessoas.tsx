/* RH — Pessoas: lista (como a "Relação de funcionários"), ficha completa (como a "Consulta rápida") e cadastro (como o "Banco de dados") */
import { useEffect, useState, type ReactNode } from 'react'
import { App } from '../../app/controle.tsx'
import { API, ErroApp } from '../../lib/api.ts'
import { C, S } from '../../lib/dados.ts'
import { Perm } from '../../lib/perm.ts'
import * as R from '../../lib/rh.ts'
import type { Funcionario, FuncionarioPrivado, MotivoHist, RhMatrizItem } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { aviso, erro } from '../../ui/avisos.ts'
import { entregar, excel, pdfDocumento } from '../../ui/arquivos.tsx'
import { BuscaLista, Btn, Cab, Campo, Chips, Dl, Paginado, Tag, Texto, Vazio, Voltar, type OpcaoChip } from '../../ui/base.tsx'
import { useLembrar, type Rota } from '../../ui/ganchos.ts'
import { Ic } from '../../ui/icones.tsx'
import { confirmar, lerForm, modal } from '../../ui/janelas.tsx'
import { CartaoOrdem } from '../Producao.tsx'
import { Anexos, feriasDe, LinhaPessoa, nomeF, opcoesCargos, opcoesPessoas, opcoesSetores, pode, REGISTROS, sensivel, situacaoFunc, TagFerias, TagVence } from './comum.tsx'
import { DisciplinaDaPessoa } from './Disciplina.tsx'
import { FeriasDaPessoa } from './Ferias.tsx'
import { PontoDaPessoa } from './Ponto.tsx'
import { SegurancaDaPessoa } from './Seguranca.tsx'
import { TreinosDaPessoa } from './Treinamentos.tsx'

export const tituloPessoa = (r: Rota): string => r.nome === 'funcionario' ? (S.get('funcionarios', r.id)?.nome || 'Funcionário') : 'Pessoas'

// ------------------------------------------------------------------ lista
export function TelaPessoas({ r }: { r: Rota }) {
  const [busca, setBusca] = useLembrar('rh.busca', '')
  const [f, setF] = useLembrar('rh.f', 'ativos')
  const [reg, setReg] = useLembrar('rh.reg', '')
  const [setor, setSetor] = useLembrar('rh.setor', '')
  useEffect(() => { const q = r.q.get('f'); if (q) setF(q) }, [r.hash, r.q, setF])
  const rh = Perm.pode('rh_ver'), sens = sensivel()
  const todos = S.lista('funcionarios')
  const at = todos.filter(x => x.ativo)
  const exp = at.filter(x => R.experiencia(x.admissao))
  const fora = at.filter(x => { const c = situacaoFunc(x).cod; return c === 'ferias' || c === 'afastado' || c === 'ausente' })
  const mes = U.hoje().slice(5, 7)
  const aniver = sens ? at.filter(x => S.get('funcionarios_privado', x.id)?.nascimento?.slice(5, 7) === mes) : []
  const chips: OpcaoChip[] = [{ v: 'ativos', t: 'Ativos', n: at.length }]
  if (rh) chips.push({ v: 'experiencia', t: 'Em experiência', n: exp.length }, { v: 'fora', t: 'Fora hoje', n: fora.length })
  if (sens) chips.push({ v: 'aniver', t: 'Aniversariantes do mês', n: aniver.length })
  chips.push({ v: 'desligados', t: 'Desligados', n: todos.length - at.length })

  let l = f === 'desligados' ? todos.filter(x => !x.ativo) : f === 'experiencia' ? exp : f === 'fora' ? fora : f === 'aniver' ? aniver : at
  if (reg) l = l.filter(x => (x.registro || 'Sem registro') === reg)
  if (setor) l = l.filter(x => (x.setor || '') === setor)
  l = busca.trim() ? U.buscar(l, busca, x => [x.nome, x.funcao || '', x.setor || '', x.matricula || '']) : U.ordenar(l, x => U.sem(x.nome))
  if (f === 'aniver') l = U.ordenar(l, x => S.get('funcionarios_privado', x.id)?.nascimento?.slice(8, 10) || '')
  const porReg = REGISTROS.map(g => [g, at.filter(x => (x.registro || 'Sem registro') === g).length] as const).filter(x => x[1])

  const direita = (x: Funcionario) => {
    if (f === 'experiencia') { const e = R.experiencia(x.admissao)!; return <><Tag s={{ cor: e.fase === 1 ? 'azul' : 'amarelo', txt: e.fase === 1 ? '1º período' : '2º período' }} /><small>termina {U.relativo(e.fase === 1 ? e.fim1 : e.fim2)}</small></> }
    if (f === 'aniver') return <small>dia {S.get('funcionarios_privado', x.id)?.nascimento?.slice(8, 10)}</small>
    if (f === 'desligados') return <small>{x.demissao ? U.data(x.demissao) : ''}{x.motivo_demissao ? <><br />{x.motivo_demissao}</> : null}</small>
    const fe = rh && sens ? feriasDe(x) : null
    return <>{fe?.situacao && fe.situacao !== 'emdia' ? <TagFerias s={fe.situacao} /> : <Tag s={situacaoFunc(x)} />}</>
  }
  return <>
    <Cab titulo={rh ? 'Pessoas' : 'Equipe'} sub={`${U.plural(at.length, 'pessoa')} trabalhando${porReg.length > 1 ? ' · ' + porReg.map(([g, n]) => `${g} ${n}`).join(' · ') : ''}`}>
      {sens && <Btn txt="Planilha" icone="planilha" data-rh="exportar" onClick={() => exportarPessoas()} />}
      {pode() && <Btn txt="Nova pessoa" icone="mais" cls="pri" data-rh="novo" onClick={() => void formPessoa()} />}
    </Cab>
    <div className="barra-filtros"><BuscaLista id="bRh" valor={busca} placeholder="Nome, função, setor ou matrícula" aoMudar={setBusca} />
      {rh && <select aria-label="Registro" value={reg} onChange={(e) => setReg(e.target.value)}><option value="">Todos os registros</option>{REGISTROS.map(x => <option key={x}>{x}</option>)}</select>}
      {rh && <select aria-label="Setor" value={setor} onChange={(e) => setSetor(e.target.value)}>{opcoesSetores('Todos os setores').map(o => <option key={o.v} value={o.v}>{o.t}</option>)}</select>}</div>
    <Chips atual={f} aoEscolher={setF} opcoes={chips} />
    {f === 'experiencia' && <p className="nota mt">Contrato de experiência de 30 + 30 dias (como na planilha): o 1º período termina 29 dias depois da admissão e o 2º, 29 dias depois do 1º.</p>}
    <div className="mt" id="lRh"><Paginado itens={l} render={x => <LinhaPessoa key={x.id} f={x} direita={direita(x)} />}
      vazio={<Vazio icone="equipe" titulo="Ninguém aqui" texto={busca ? 'Tente outro nome.' : undefined} />} /></div>
  </>
}

// planilha igual à da JAF: "Relação ativos" (com as férias) + "Banco de dados" (tudo)
async function exportarPessoas() {
  const d = (x: string | null | undefined) => x ? U.d(x) : null
  const at = U.ordenar(S.lista('funcionarios').filter(f => f.ativo), f => (f.registro || 'zz') + U.sem(f.setor) + U.sem(f.nome))
  const rel = at.map(f => {
    const p = S.get('funcionarios_privado', f.id), ps = C.periodosFerias(f), pior = R.feriasPior(ps)
    return { Registro: f.registro || '', Setor: f.setor || '', Horário: f.horario || '', Matrícula: f.matricula || '', Nome: f.nome, Função: f.funcao || '',
      'Data início': d(f.admissao), Salário: p?.salario ?? null, 'Período aquisitivo (início)': d(pior?.inicio), 'Período aquisitivo (fim)': d(pior?.fim),
      'Data limite': d(pior?.limite), Situação: pior ? R.TXT_FERIAS[pior.situacao] : '' }
  })
  const banco = U.ordenar(S.lista('funcionarios'), f => U.sem(f.nome)).map(f => {
    const p = S.get('funcionarios_privado', f.id) || ({} as Partial<FuncionarioPrivado>)
    const aso = R.ultimoAso(S.lista('rh_asos'), f.id)
    const oc = S.lista('rh_ocorrencias').filter(o => o.funcionario_id === f.id && o.status !== 'cancelado').sort((a, b) => a.data_ocorrencia < b.data_ocorrencia ? -1 : 1)
    const linha: Record<string, unknown> = {
      Nome: f.nome, Função: f.funcao, Setor: f.setor, Admissão: d(f.admissao), Celular: p.celular || f.telefone, 'Matrícula eSocial': f.matricula_esocial, Matrícula: f.matricula,
      CBO: S.get('rh_cargos', f.cargo_id)?.cbo || '', 'Tempo de serviço': R.tempoCasa(f.admissao, f.demissao || U.hoje()), Salário: p.salario, 'Salário (horas extras)': p.salario_he,
      RG: p.rg, CPF: p.cpf, PIS: p.pis, 'Título de eleitor': p.titulo_eleitor, Reservista: p.reservista, CNH: p.cnh, 'E-mail': p.email, Nascimento: d(p.nascimento),
      Idade: R.idade(p.nascimento || null), Sexo: p.sexo, 'Estado civil': p.estado_civil, Naturalidade: p.naturalidade, Estado: p.uf_nascimento, Nacionalidade: p.nacionalidade,
      Mãe: p.mae, Pai: p.pai, 'Grau de instrução': p.instrucao, 'Dados bancários': p.banco, Pix: p.pix, 'Exame médico': d(aso?.data_exame),
      'Exame - status': aso ? (R.vencimentoAso(aso) < U.hoje() ? 'Vencido' : 'No prazo') : '', Endereço: p.endereco, 'Nº': p.numero, Compl: p.complemento, Bairro: p.bairro,
      CEP: p.cep, Cidade: p.cidade, 'Horário de trabalho': f.horario, 'Descanso semanal': f.descanso, 'Superior direto': nomeF(f.superior_id), Uniforme: p.uniforme,
      Botina: p.calcado, 'Chave celular': p.chave_celular, 'Chave vestiário': p.chave_vestiario,
    }
    for (let i = 0; i < 3; i++) { const o = oc[i]; linha[`Data ${i + 1}`] = d(o?.data_ocorrencia); linha[`Motivo ${i + 1}`] = o?.assunto || o?.categoria || ''; linha[`Ação corretiva ${i + 1}`] = o ? TIPO_MEDIDA[o.tipo] : '' }
    Object.assign(linha, { 'Abono / observações': p.obs, 'Data demissão': d(f.demissao), 'Motivo demissão': f.motivo_demissao, Indicação: p.indicacao,
      Situação: f.ativo ? 'Ativo' : 'Inativo', 'Limite férias': d(R.feriasPior(C.periodosFerias(f))?.limite), Registro: f.registro, 'Contato emergência': p.emergencia_nome,
      Telefone: p.emergencia_fone, 'Telefone corporativo': p.telefone_corp })
    return linha
  })
  await excel(`Relacao de funcionarios ${U.hoje()}.xlsx`, [['Relação ativos', rel], ['Banco de dados', banco]], true)
}
const TIPO_MEDIDA: Record<string, string> = { verbal: 'ADVERTÊNCIA VERBAL', escrita: 'ADVERTÊNCIA FORMAL', suspensao: 'SUSPENSÃO' }

// ------------------------------------------------------------------ ficha
const ABAS: [string, string, 'rh' | 'sens' | 'todos'][] = [
  ['resumo', 'Resumo', 'todos'], ['dados', 'Dados pessoais', 'sens'], ['cargo', 'Cargo e salário', 'sens'], ['ferias', 'Férias e ausências', 'rh'],
  ['ponto', 'Ponto', 'rh'], ['treinos', 'Treinamentos', 'rh'], ['seguranca', 'EPI e exames', 'rh'], ['disciplina', 'Advertências', 'rh'], ['documentos', 'Documentos', 'sens'],
]
export function TelaFicha({ r }: { r: Rota }) {
  const f = S.get('funcionarios', r.id)
  const rh = Perm.pode('rh_ver'), sens = sensivel()
  if (!f) return <Vazio icone="equipe" titulo="Pessoa não encontrada"><a className="btn pri" href={rh ? '#/rh' : '#/equipe'}>Voltar</a></Vazio>
  const abas = ABAS.filter(([, , q]) => q === 'todos' || (q === 'rh' ? rh : sens))
  const aba = abas.some(a => a[0] === r.q.get('aba')) ? r.q.get('aba')! : 'resumo'
  const sit = situacaoFunc(f)
  const fe = rh && sens ? feriasDe(f) : null
  const exp = R.experiencia(f.admissao)
  return <>
    <Voltar para={rh ? '#/rh' : '#/equipe'} txt={rh ? 'Pessoas' : 'Equipe'} />
    <header className="cab ficha-cab"><div className="ficha-id"><span className="avatar grande">{f.nome.charAt(0).toUpperCase()}</span>
      <div><h1>{f.nome}</h1><p className="sub">{[f.funcao, f.setor, f.registro].filter(Boolean).join(' · ') || '—'}</p>
        <div className="tags"><Tag s={sit} />{exp && <Tag s={{ cor: 'azul', txt: `Experiência até ${U.dataCurta(exp.fase === 1 ? exp.fim1 : exp.fim2)}` }} />}{fe?.situacao && fe.situacao !== 'emdia' && <TagFerias s={fe.situacao} />}</div></div></div>
      <div className="acoes">{pode() && <Btn txt="Editar" icone="lapis" data-rh="editar" onClick={() => void formPessoa(f)} />}
        {sens && <Btn txt="Ficha PDF" icone="imprimir" data-rh="fichaPdf" onClick={() => fichaPdf(f)} />}</div></header>
    {abas.length > 1 && <nav className="abas-tela" aria-label="Partes da ficha">{abas.map(([k, t]) => <a key={k} href={`#/funcionario/${f.id}?aba=${k}`} data-aba={k} className={k === aba ? 'on' : ''}>{t}</a>)}</nav>}
    {aba === 'resumo' && <Resumo f={f} />}
    {aba === 'dados' && <DadosPessoais f={f} />}
    {aba === 'cargo' && <CargoSalario f={f} />}
    {aba === 'ferias' && <FeriasDaPessoa f={f} />}
    {aba === 'ponto' && <PontoDaPessoa f={f} />}
    {aba === 'treinos' && <TreinosDaPessoa f={f} />}
    {aba === 'seguranca' && <SegurancaDaPessoa f={f} />}
    {aba === 'disciplina' && <DisciplinaDaPessoa f={f} />}
    {aba === 'documentos' && <section className="card"><h2>Documentos</h2><p className="sub">Contrato, documentos pessoais, comprovantes… (PDF ou foto, até 4 MB cada). Só RH, Escritório e Dono veem.</p>
      <Anexos tabela="funcionarios" registro={f.id} titulo="Arquivos da pessoa" /></section>}
  </>
}

function Resumo({ f }: { f: Funcionario }) {
  const rh = Perm.pode('rh_ver'), sens = sensivel()
  const acesso = S.lista('perfis').find(p => p.funcionario_id === f.id)
  const exp = R.experiencia(f.admissao)
  const aso = rh ? R.ultimoAso(S.lista('rh_asos'), f.id) : null
  const fe = rh && sens ? feriasDe(f) : null
  const oc12 = rh ? S.lista('rh_ocorrencias').filter(o => o.funcionario_id === f.id && o.status !== 'cancelado' && o.data_ocorrencia >= U.somaMeses(U.hoje(), -12)) : []
  const treinoVence = rh ? S.lista('rh_matriz_niveis').filter(n => n.funcionario_id === f.id).map(n => { const it = S.get('rh_matriz_itens', n.item_id); return it?.ativo ? { it, v: R.vencimentoTreino(n, it) } : null })
    .filter((x): x is { it: RhMatrizItem; v: string } => !!x?.v && U.dias(U.hoje(), x.v) <= 60) : []
  const fora = S.lista('rh_ausencias').filter(a => a.funcionario_id === f.id && (a.fim === null || a.fim >= U.hoje())).sort((a, b) => a.inicio < b.inicio ? -1 : 1)[0]
  return <>
    <section className="card"><Dl pares={[
      ['Matrícula', f.matricula], ['Registro', f.registro], ['Admissão', f.admissao ? `${U.data(f.admissao)} (${R.tempoCasa(f.admissao, f.demissao || U.hoje())})` : ''],
      exp && ['Experiência', `1º período até ${U.data(exp.fim1)} · 2º até ${U.data(exp.fim2)}`],
      ['Horário', f.horario], ['Descanso semanal', f.descanso], ['Responde a', f.superior_id ? <a href={'#/funcionario/' + f.superior_id}>{nomeF(f.superior_id)}</a> : ''],
      ['Telefone', f.telefone ? <a href={'tel:' + f.telefone.replace(/\D/g, '')}>{f.telefone}</a> : ''],
      !f.ativo && ['Desligado em', f.demissao ? `${U.data(f.demissao)}${f.motivo_demissao ? ' — ' + f.motivo_demissao : ''}` : 'Sim'],
      ['Acesso ao sistema', acesso ? `${acesso.login} (${Perm.nome(acesso.perfil)})` : ''],
    ]} /></section>
    {rh && <div className="grade g-auto mt">
      {sens && <a className="kpi" href={`#/funcionario/${f.id}?aba=ferias`}><small>Férias</small><b className="kpi-txt">{fe?.situacao ? R.TXT_FERIAS[fe.situacao] : f.ativo ? 'Adquirindo' : '—'}</b>
        <span>{fe?.limite ? 'tirar até ' + U.data(fe.limite) : fe?.direitoEm ? 'direito a partir de ' + U.data(fe.direitoEm) : ''}</span></a>}
      <a className="kpi" href={`#/funcionario/${f.id}?aba=seguranca`}><small>Exame (ASO)</small><b className="kpi-txt">{aso ? <TagVence venc={R.vencimentoAso(aso)} ok="Em dia" /> : 'Sem exame'}</b>
        <span>{aso ? `${aso.tipo} em ${U.data(aso.data_exame)} · vence ${U.data(R.vencimentoAso(aso))}` : 'lance o último ASO'}</span></a>
      <a className="kpi" href={`#/funcionario/${f.id}?aba=treinos`}><small>Treinamentos</small><b className="kpi-txt">{treinoVence.length ? U.plural(treinoVence.length, 'vencendo', 'vencendo') : 'Em dia'}</b>
        <span>{treinoVence.slice(0, 2).map(x => x.it.nome).join(', ') || 'nada para reciclar em 60 dias'}</span></a>
      <a className="kpi" href={`#/funcionario/${f.id}?aba=disciplina`}><small>Advertências (12 meses)</small><b>{oc12.length}</b><span>{oc12.length ? oc12.map(o => TIPO_MEDIDA[o.tipo].toLowerCase()).join(', ') : 'nenhuma'}</span></a>
    </div>}
    {fora && <p className="nota amarela mt"><b>{fora.inicio <= U.hoje() ? 'Fora agora' : 'Programado'}:</b> {({ ferias: 'férias', atestado: 'atestado', afastamento: 'afastamento', licenca: 'licença', suspensao: 'suspensão', folga: 'folga', falta: 'falta', declaracao: 'declaração' } as Record<string, string>)[fora.tipo]} de {U.data(fora.inicio)} {fora.fim ? 'a ' + U.data(fora.fim) : '(sem data para voltar)'}.</p>}
    {pode() && <div className="grupo-btn mt">
      {sens && f.ativo && <Btn txt="Alterar cargo ou salário" icone="relatorio" data-rh="cargo" onClick={() => void alterarCargoSalario(f)} />}
      {f.ativo ? <Btn txt="Desligar" icone="sair" cls="perigo-txt" data-rh="desligar" onClick={() => void desligar(f)} />
        : <Btn txt="Readmitir" icone="desfazer" data-rh="readmitir" onClick={() => void readmitir(f)} />}
    </div>}
    {Perm.pode('fabrica') && <DaFabrica f={f} />}
  </>
}

// o que a pessoa fez na fábrica (retiradas e ordens)
function DaFabrica({ f }: { f: Funcionario }) {
  const de12 = U.somaMeses(U.hoje(), -12)
  const porPeca = U.agrupar(C.consumos(m => m.funcionario_id === f.id && m.data >= de12), x => x.mov.peca_id)
  const top = [...porPeca.entries()].map(([pid, l]) => ({ p: S.get('pecas', pid), q: U.soma(l, 'qtd'), v: U.soma(l, 'valor') })).filter(x => x.q > 0).sort((a, b) => b.v - a.v).slice(0, 8)
  const ords = S.lista('ordens').filter(o => o.responsavel_id === f.id && (o.status === 'fila' || o.status === 'producao'))
  return <>
    {ords.length > 0 && <section className="card mt"><div className="card-cab"><h2>Ordens com {f.nome.split(' ')[0]}</h2></div>{ords.map(o => <CartaoOrdem key={o.id} o={o} />)}</section>}
    {top.length > 0 && <section className="card mt"><div className="card-cab"><h2>Peças que mais retirou (12 meses)</h2></div><div className="lista">{top.map(x => <a key={x.p?.id} className="linha" href={'#/peca/' + x.p?.id}>
      <div className="meio"><b><span className="codigo">{x.p?.codigo || ''}</span> · {x.p?.descricao || ''}</b></div>
      <div className="lado"><b>{U.qtd(x.q)}</b>{Perm.pode('precos') && <small>{U.moeda(x.v)}</small>}</div></a>)}</div></section>}
  </>
}

function Escondido({ v, mostrar }: { v: string | null | undefined; mostrar: boolean }) {
  if (!v) return null
  return <span className="num">{mostrar ? v : R.mascarar(v, 4)}</span>
}
function DadosPessoais({ f }: { f: Funcionario }) {
  const [ver, setVer] = useState(false)
  const p = S.get('funcionarios_privado', f.id)
  if (!p) return <Vazio icone="cadeado" titulo="Sem dados pessoais" texto="Toque em Editar para preencher documentos, endereço e contato.">{pode() && <Btn txt="Editar" icone="lapis" cls="pri" onClick={() => void formPessoa(f, 'documentos')} />}</Vazio>
  const idade = R.idade(p.nascimento)
  return <>
    <p className="nota"><Ic n="cadeado" /> Dados protegidos pela LGPD: só RH, Escritório e Dono veem. CPF e conta bancária aparecem escondidos — <button type="button" className="link" data-rh="mostrar" onClick={() => setVer(!ver)}>{ver ? 'esconder' : 'mostrar tudo'}</button>.</p>
    <section className="card mt"><h2>Documentos</h2><div className="mt"><Dl pares={[['CPF', ver ? p.cpf : R.mascaraCpf(p.cpf)], ['RG', <Escondido key="rg" v={p.rg} mostrar={ver} />], ['PIS', <Escondido key="pis" v={p.pis} mostrar={ver} />],
      ['Título de eleitor', <Escondido key="t" v={p.titulo_eleitor} mostrar={ver} />], ['Reservista', [p.reservista, p.categoria_militar && 'categoria ' + p.categoria_militar].filter(Boolean).join(' · ')],
      ['CNH', p.cnh ? <>{<Escondido key="c" v={p.cnh} mostrar={ver} />}{p.cnh_categoria ? ' · ' + p.cnh_categoria : ''}{p.cnh_validade ? <> · vence {U.data(p.cnh_validade)} {p.cnh_validade < U.hoje() && <span className="tag t-vermelho">vencida</span>}</> : null}</> : ''],
      ['CTPS', <Escondido key="ct" v={p.ctps} mostrar={ver} />], ['Órgão do RG', [p.rg_orgao, p.rg_uf, p.rg_emissao && 'emitido em ' + U.data(p.rg_emissao)].filter(Boolean).join(' · ')],
      ['Matrícula eSocial', f.matricula_esocial], ['CBO', S.get('rh_cargos', f.cargo_id)?.cbo]]} /></div></section>
    <section className="card mt"><h2>Pessoal</h2><div className="mt"><Dl pares={[['Nascimento', p.nascimento ? `${U.data(p.nascimento)} (${idade} anos)` : ''], ['Sexo', p.sexo], ['Estado civil', p.estado_civil],
      ['Nacionalidade', [p.nacionalidade, p.pais_origem && p.pais_origem !== 'Brasil' ? p.pais_origem : ''].filter(Boolean).join(' · ')], ['Naturalidade', [p.naturalidade, p.uf_nascimento].filter(Boolean).join(' / ')], ['Raça/cor', p.raca_cor], ['Mãe', p.mae], ['Pai', p.pai], ['Grau de instrução', p.instrucao], ['Indicação', p.indicacao]]} /></div></section>
    <section className="card mt"><h2>Contato e endereço</h2><div className="mt"><Dl pares={[['Celular', p.celular ? <a href={'tel:' + p.celular.replace(/\D/g, '')}>{p.celular}</a> : ''], ['E-mail', p.email ? <a href={'mailto:' + p.email}>{p.email}</a> : ''],
      ['Telefone fixo', p.telefone_fixo], ['Telefone corporativo', p.telefone_corp], ['Endereço', [p.endereco, p.numero, p.complemento].filter(Boolean).join(', ')], ['Bairro', p.bairro], ['Cidade', p.cidade], ['CEP', p.cep],
      ['Emergência', [p.emergencia_nome, p.emergencia_fone].filter(Boolean).join(' — ')]]} /></div></section>
    <section className="card mt"><h2>Pagamento e itens entregues</h2><div className="mt"><Dl pares={[['Dados bancários', <Escondido key="b" v={p.banco} mostrar={ver} />], ['Pix', <Escondido key="px" v={p.pix} mostrar={ver} />],
      ['Uniforme', p.uniforme], ['Calçado (botina)', p.calcado], ['Chave do celular', p.chave_celular], ['Chave do vestiário', p.chave_vestiario]]} /></div>
      {p.obs && <><h3 className="mt">Observações</h3><p><Texto t={p.obs} /></p></>}
      {p.obs_desligamento && <><h3 className="mt">Sobre o desligamento</h3><p><Texto t={p.obs_desligamento} /></p></>}</section>
  </>
}

const COR_MOTIVO: Record<string, 'azul' | 'verde' | 'amarelo' | 'cinza'> = { Admissão: 'cinza', Promoção: 'verde', Dissídio: 'azul', Mérito: 'verde', Espontâneo: 'verde', Correção: 'amarelo', 'Mudança de setor': 'azul' }
function CargoSalario({ f }: { f: Funcionario }) {
  const h = S.lista('rh_historico').filter(x => x.funcionario_id === f.id).sort((a, b) => a.vigencia < b.vigencia ? 1 : a.vigencia > b.vigencia ? -1 : (a.criado_em < b.criado_em ? 1 : -1))
  const p = S.get('funcionarios_privado', f.id)
  const salAnt = (i: number): number | null => { for (let k = i + 1; k < h.length; k++) if (h[k].salario) return Number(h[k].salario); return null }
  return <>
    <section className="card"><div className="card-cab"><div><h2>Hoje</h2><p className="sub">{f.funcao || 'Sem cargo'} · {f.setor || 'sem setor'}</p></div>
      <div className="estoque-grande">{p?.salario ? U.moeda(p.salario) : '—'}</div></div>
      {p?.salario_he && Number(p.salario_he) !== Number(p.salario) ? <p className="sub">Para as horas extras a planilha usava {U.moeda(p.salario_he)} (fica assim até alguém mudar no cadastro).</p> : null}
      {pode() && f.ativo && <Btn txt="Alterar cargo ou salário" icone="relatorio" cls="pri" data-rh="cargo" onClick={() => void alterarCargoSalario(f)} />}</section>
    <section className="card mt"><h2>Linha do tempo</h2>
      {h.length ? <ol className="linha-tempo mt">{h.map((x, i) => {
        const ant = salAnt(i), dif = x.salario && ant ? (Number(x.salario) - ant) / ant : null
        return <li key={x.id} className={x.vigencia > U.hoje() ? 'futuro' : ''}><div className="lt-data">{U.data(x.vigencia)}{x.vigencia > U.hoje() && <small>a partir de</small>}</div>
          <div className="lt-corpo"><Tag s={{ cor: COR_MOTIVO[x.motivo] || 'cinza', txt: x.motivo }} /> <b>{x.cargo || ''}</b>{x.setor ? <span className="sub"> · {x.setor}</span> : null}
            {x.salario ? <div><b className="num">{U.moeda(x.salario)}</b>{dif !== null && dif !== 0 ? <span className={dif > 0 ? 'positivo' : 'negativo'}> {dif > 0 ? '+' : ''}{(dif * 100).toFixed(1).replace('.', ',')}%</span> : null}</div> : null}
            {x.obs && <p className="sub">{x.obs}</p>}<small className="fraco">lançado por {S.nomeUsuario(x.criado_por) || '—'} em {U.dataHora(x.criado_em)}</small></div>
          {pode() && x.motivo !== 'Admissão' && <button type="button" className="icone-btn" aria-label="Apagar esta linha" onClick={async () => {
            if (!(await confirmar('Apagar esta linha do histórico?', { detalhe: 'O cadastro atual não muda. Use quando lançou errado.', ok: 'Apagar', perigo: true }))) return
            try { await API.rpc('rh_excluir_historico', { p_id: x.id }); await App.gravou(['rh_historico'], { inteira: ['rh_historico'] }); aviso('Linha apagada.') } catch (e) { erro(e) }
          }}><Ic n="lixo" /></button>}</li>
      })}</ol> : <p className="sub">Nada registrado. A admissão e cada promoção, dissídio ou aumento aparecem aqui.</p>}</section>
  </>
}

// ------------------------------------------------------------------ cadastro (janela com partes)
const PARTES: [string, string][] = [['trabalho', 'Trabalho'], ['documentos', 'Documentos'], ['pessoal', 'Pessoal'], ['contato', 'Contato'], ['outros', 'Outros']]
// as partes ficam todas no formulário (só escondidas): nada do que foi digitado se perde ao trocar de parte
function ComPartes({ inicial, children }: { inicial: string; children: (on: string) => ReactNode }) {
  const [on, setOn] = useState(inicial)
  return <>
    <nav className="abas-tela partes" aria-label="Partes do cadastro">{PARTES.map(([k, t]) => <button key={k} type="button" data-parte-btn={k} className={k === on ? 'on' : ''} onClick={() => setOn(k)}>{t}</button>)}</nav>
    {children(on)}
  </>
}
function CampoCargo({ f }: { f: Partial<Funcionario> }) {
  const cargos = opcoesCargos('Sem cargo cadastrado (escrever)')
  const [cargo, setCargo] = useState(f.cargo_id || '')
  return <div className="linha-campos">
    {cargos.length > 1 && <Campo nome="cargo_id" rotulo="Cargo" tipo="select" valor={cargo} opcoes={cargos} attrs={{ onChange: (e: { target: HTMLSelectElement }) => setCargo(e.target.value) }} ajuda={<a href="#/rh/ajustes" target="_blank" rel="noopener">Cadastrar cargos</a>} />}
    {!cargo && <Campo nome="funcao" rotulo="Função" valor={f.funcao} attrs={{ list: 'lFuncaoRh' }} />}
    <datalist id="lFuncaoRh">{U.unicos(S.lista('funcionarios').map(x => x.funcao).filter((x): x is string => !!x)).map(x => <option key={x} value={x} />)}</datalist>
  </div>
}
export async function formPessoa(f?: Funcionario | null, parte = 'trabalho'): Promise<string | null> {
  const novo = !f
  const b: Partial<Funcionario> = f || { ativo: true, situacao: 'ativo', registro: 'Matriz', horario: '07:00 às 17:00', descanso: 'Sábado e domingo' }
  const p: Partial<FuncionarioPrivado> = (f && S.get('funcionarios_privado', f.id)) || { nacionalidade: 'Brasileira' }
  // valor que veio da planilha e não está na lista continua aparecendo (não some ao salvar)
  const sel = (o: string[], atual?: string | null) => [{ v: '', t: '—' }, ...(atual && !o.includes(atual) ? [atual, ...o] : o).map(x => ({ v: x, t: x }))]
  return modal<string>({
    titulo: novo ? 'Nova pessoa' : 'Editar — ' + f!.nome, largura: 'larga',
    corpo: <ComPartes inicial={parte}>{(on) => { const vis = (k: string) => ({ 'data-parte': k, hidden: k !== on }); return <div data-cadastro>
      <div {...vis('trabalho')}>
        <Campo nome="nome" rotulo="Nome completo" valor={b.nome} req />
        <CampoCargo f={b} />
        <div className="linha-campos"><Campo nome="setor" rotulo="Setor" tipo="select" valor={b.setor} opcoes={opcoesSetores()} />
          <Campo nome="registro" rotulo="Registro" tipo="select" valor={b.registro} opcoes={REGISTROS.map(x => ({ v: x, t: x }))} />
          <Campo nome="superior_id" rotulo="Responde a (chefe direto)" tipo="select" valor={b.superior_id} opcoes={opcoesPessoas('—', S.lista('funcionarios').filter(x => (x.ativo || x.id === b.superior_id) && x.id !== b.id))} /></div>
        <div className="linha-campos"><Campo nome="admissao" rotulo="Admissão" tipo="date" valor={b.admissao} req={novo} /><Campo nome="matricula" rotulo="Matrícula (código)" valor={b.matricula} placeholder="Ex.: JAF166" />
          <Campo nome="matricula_esocial" rotulo="Matrícula eSocial" valor={b.matricula_esocial} /></div>
        <div className="linha-campos"><Campo nome="horario" rotulo="Horário de trabalho" valor={b.horario} placeholder="07:00 às 17:00" />
          <Campo nome="descanso" rotulo="Descanso semanal" tipo="select" valor={b.descanso} opcoes={sel(['Sábado e domingo', 'Domingo', 'Escala'], b.descanso)} />
          <Campo nome="telefone" rotulo="Telefone" tipo="tel" valor={b.telefone} /></div>
        {novo ? <div className="linha-campos"><Campo nome="salario" rotulo="Salário" tipo="dinheiro" valor="" ajuda="Abre a linha do tempo de cargo e salário." /></div>
          : <p className="nota">Salário atual: <b>{p.salario ? U.moeda(p.salario) : '—'}</b>. Para mudar salário ou cargo use <b>Alterar cargo ou salário</b> na ficha — assim fica guardado o motivo e a data.</p>}
      </div>
      <div {...vis('documentos')}>
        <div className="linha-campos"><Campo nome="cpf" rotulo="CPF" valor={p.cpf} placeholder="000.000.000-00" attrs={{ inputMode: 'numeric' }} ajuda="O sistema confere os números e não deixa repetir." />
          <Campo nome="rg" rotulo="RG" valor={p.rg} /><Campo nome="pis" rotulo="PIS / NIS" valor={p.pis} attrs={{ inputMode: 'numeric' }} /></div>
        <div className="linha-campos"><Campo nome="titulo_eleitor" rotulo="Título de eleitor" valor={p.titulo_eleitor} attrs={{ inputMode: 'numeric' }} /><Campo nome="reservista" rotulo="Reservista" valor={p.reservista} />
          <Campo nome="cnh" rotulo="CNH (habilitação)" valor={p.cnh} /></div>
        <div className="linha-campos"><Campo nome="cnh_categoria" rotulo="Categoria da CNH" valor={p.cnh_categoria} /><Campo nome="cnh_validade" rotulo="Validade da CNH" tipo="date" valor={p.cnh_validade} />
          <Campo nome="ctps" rotulo="CTPS (nº / série / UF)" valor={p.ctps} /></div>
        <div className="linha-campos"><Campo nome="rg_orgao" rotulo="Órgão emissor do RG" valor={p.rg_orgao} /><Campo nome="rg_uf" rotulo="UF do RG" valor={p.rg_uf} attrs={{ maxLength: 2 }} />
          <Campo nome="rg_emissao" rotulo="Emissão do RG" tipo="date" valor={p.rg_emissao} /><Campo nome="categoria_militar" rotulo="Categoria militar" valor={p.categoria_militar} /></div>
      </div>
      <div {...vis('pessoal')}>
        <div className="linha-campos"><Campo nome="nascimento" rotulo="Nascimento" tipo="date" valor={p.nascimento} /><Campo nome="sexo" rotulo="Sexo" tipo="select" valor={p.sexo} opcoes={sel(['Masculino', 'Feminino'], p.sexo)} />
          <Campo nome="estado_civil" rotulo="Estado civil" tipo="select" valor={p.estado_civil} opcoes={sel(['Solteiro(a)', 'Casado(a)', 'União estável', 'Divorciado(a)', 'Viúvo(a)'], p.estado_civil)} /></div>
        <div className="linha-campos"><Campo nome="nacionalidade" rotulo="Nacionalidade" valor={p.nacionalidade} /><Campo nome="naturalidade" rotulo="Naturalidade (cidade)" valor={p.naturalidade} />
          <Campo nome="uf_nascimento" rotulo="UF" valor={p.uf_nascimento} attrs={{ maxLength: 2 }} /></div>
        <div className="linha-campos"><Campo nome="mae" rotulo="Nome da mãe" valor={p.mae} /><Campo nome="pai" rotulo="Nome do pai" valor={p.pai} /></div>
        <div className="linha-campos"><Campo nome="raca_cor" rotulo="Raça/cor" tipo="select" valor={p.raca_cor} opcoes={sel(['Branca', 'Preta', 'Parda', 'Amarela', 'Indígena', 'Não informado'], p.raca_cor)} />
          <Campo nome="pais_origem" rotulo="País de origem" valor={p.pais_origem} /></div>
        <Campo nome="instrucao" rotulo="Grau de instrução" tipo="select" valor={p.instrucao} opcoes={sel(['Fundamental incompleto', 'Fundamental completo', 'Médio incompleto', 'Médio completo', 'Técnico', 'Superior incompleto', 'Superior completo', 'Pós-graduação'], p.instrucao)} />
      </div>
      <div {...vis('contato')}>
        <div className="linha-campos"><Campo nome="celular" rotulo="Celular" tipo="tel" valor={p.celular} /><Campo nome="email" rotulo="E-mail" tipo="email" valor={p.email} /><Campo nome="telefone_corp" rotulo="Telefone corporativo" tipo="tel" valor={p.telefone_corp} /><Campo nome="telefone_fixo" rotulo="Telefone fixo" tipo="tel" valor={p.telefone_fixo} /></div>
        <div className="linha-campos"><Campo nome="cep" rotulo="CEP" valor={p.cep} attrs={{ inputMode: 'numeric' }} /><Campo nome="endereco" rotulo="Endereço (rua)" valor={p.endereco} cls="largo" /><Campo nome="numero" rotulo="Nº" valor={p.numero} /></div>
        <div className="linha-campos"><Campo nome="complemento" rotulo="Complemento" valor={p.complemento} /><Campo nome="bairro" rotulo="Bairro" valor={p.bairro} /><Campo nome="cidade" rotulo="Cidade" valor={p.cidade} /></div>
        <div className="linha-campos"><Campo nome="emergencia_nome" rotulo="Contato de emergência" valor={p.emergencia_nome} /><Campo nome="emergencia_fone" rotulo="Telefone de emergência" tipo="tel" valor={p.emergencia_fone} /></div>
      </div>
      <div {...vis('outros')}>
        <div className="linha-campos"><Campo nome="banco" rotulo="Dados bancários" valor={p.banco} placeholder="Banco, agência e conta" /><Campo nome="pix" rotulo="Chave Pix" valor={p.pix} /></div>
        <div className="linha-campos"><Campo nome="uniforme" rotulo="Uniforme (tamanho)" valor={p.uniforme} /><Campo nome="calcado" rotulo="Calçado / botina (nº)" valor={p.calcado} />
          <Campo nome="chave_celular" rotulo="Chave do celular" valor={p.chave_celular} /><Campo nome="chave_vestiario" rotulo="Chave do vestiário" valor={p.chave_vestiario} /></div>
        <div className="linha-campos"><Campo nome="indicacao" rotulo="Indicado por" valor={p.indicacao} /><Campo nome="salario_he" rotulo="Salário para horas extras" tipo="dinheiro" valor={U.campoNum(p.salario_he)} ajuda="Deixe vazio para usar o salário do cadastro." />
          <Campo nome="ferias_base" rotulo="Início do período aquisitivo" tipo="date" valor={b.ferias_base} ajuda="Só se for diferente da admissão (ex.: afastamento longo)." /></div>
        <Campo nome="pobs" rotulo="Abono / observações" tipo="area" valor={p.obs} linhas={2} />
      </div>
    </div> }}</ComPartes>,
    botoes: [{ txt: novo ? 'Cadastrar' : 'Salvar', acao: async (frm) => {
      const d = lerForm(frm)
      if (d.cpf && !R.cpfValido(d.cpf)) throw new ErroApp('CPF inválido: confira os números.')
      const priv: Record<string, unknown> = {
        salario: novo ? d.salario : p.salario ?? null, salario_he: d.salario_he, cpf: d.cpf, rg: d.rg, pis: d.pis, titulo_eleitor: d.titulo_eleitor, reservista: d.reservista, cnh: d.cnh,
        nascimento: d.nascimento || null, sexo: d.sexo, estado_civil: d.estado_civil, nacionalidade: d.nacionalidade, naturalidade: d.naturalidade, uf_nascimento: d.uf_nascimento,
        mae: d.mae, pai: d.pai, instrucao: d.instrucao, email: d.email, celular: d.celular, endereco: d.endereco, numero: d.numero, complemento: d.complemento, bairro: d.bairro,
        cep: d.cep, cidade: d.cidade, banco: d.banco, pix: d.pix, emergencia_nome: d.emergencia_nome, emergencia_fone: d.emergencia_fone, telefone_corp: d.telefone_corp,
        uniforme: d.uniforme, calcado: d.calcado, chave_celular: d.chave_celular, chave_vestiario: d.chave_vestiario, indicacao: d.indicacao, obs: d.pobs,
        obs_desligamento: p.obs_desligamento ?? null, ferias: p.ferias || [], ctps: d.ctps, raca_cor: d.raca_cor, pais_origem: d.pais_origem, telefone_fixo: d.telefone_fixo,
        rg_orgao: d.rg_orgao, rg_uf: d.rg_uf, rg_emissao: d.rg_emissao || null, cnh_categoria: d.cnh_categoria, cnh_validade: d.cnh_validade || null, categoria_militar: d.categoria_militar,
      }
      const id = await API.rpc<string>('salvar_funcionario', { p: {
        id: b.id, nome: d.nome, cargo_id: d.cargo_id || null, funcao: d.cargo_id ? null : d.funcao, setor: d.setor, telefone: d.telefone, admissao: d.admissao || null,
        matricula: d.matricula, matricula_esocial: d.matricula_esocial, registro: d.registro, superior_id: d.superior_id || null, horario: d.horario, descanso: d.descanso,
        situacao: b.situacao || 'ativo', demissao: b.demissao || null, motivo_demissao: b.motivo_demissao || null, ferias_base: d.ferias_base || null, privado: priv,
      } })
      await App.gravou(['funcionarios', 'funcionarios_privado', 'rh_historico']); aviso(novo ? 'Pessoa cadastrada.' : 'Cadastro salvo.')
      if (novo) location.hash = '#/funcionario/' + id
      return id
    } }],
  })
}

// salva a pessoa com os dados que já tem + o que mudou (desligar, readmitir)
async function salvarCom(f: Funcionario, extra: Partial<Funcionario>, privExtra: Partial<FuncionarioPrivado> = {}) {
  const priv = S.get('funcionarios_privado', f.id)
  await API.rpc('salvar_funcionario', { p: { ...f, ...extra, privado: (priv || Object.keys(privExtra).length) ? { ...(priv || {}), ...privExtra } : undefined } })
  await App.gravou(['funcionarios', 'funcionarios_privado'])
}

const MOTIVOS_DESLIG = ['Pedido de demissão', 'Dispensa sem justa causa — aviso indenizado', 'Dispensa sem justa causa — aviso trabalhado', 'Término do contrato de experiência',
  'Dispensa por justa causa', 'Acordo entre as partes (art. 484-A)', 'Aposentadoria', 'Falecimento']
async function desligar(f: Funcionario) {
  const acesso = S.lista('perfis').find(p => p.funcionario_id === f.id && p.ativo)
  await modal({
    titulo: 'Desligar — ' + f.nome,
    corpo: <>
      <div className="linha-campos"><Campo nome="demissao" rotulo="Último dia de trabalho" tipo="date" valor={U.hoje()} req />
        <Campo nome="motivo" rotulo="Motivo" tipo="select" req opcoes={[{ v: '', t: 'Escolha' }, ...MOTIVOS_DESLIG.map(x => ({ v: x, t: x }))]} /></div>
      <Campo nome="obs" rotulo="Observações (opcional)" tipo="area" linhas={2} />
      <p className="nota amarela">Lembretes: exame demissional (ASO), devolução de uniforme, EPI, crachá e chaves{acesso ? <>, e <b>desativar o acesso “{acesso.login}”</b> em Administração</> : ''}. O histórico da pessoa continua guardado.</p>
    </>,
    botoes: [{ txt: 'Desligar', cls: 'perigo', acao: async (frm) => {
      const d = lerForm(frm)
      await salvarCom(f, { situacao: 'desligado', ativo: false, demissao: d.demissao, motivo_demissao: d.motivo }, d.obs ? { obs_desligamento: d.obs } : {})
      aviso(f.nome.split(' ')[0] + ' foi desligado(a).')
    } }],
  })
}
async function readmitir(f: Funcionario) {
  if (!(await confirmar(`Readmitir ${f.nome}?`, { detalhe: 'Volta para a lista de ativos. Se for uma nova contratação, mude a data de admissão em Editar.', ok: 'Readmitir' }))) return
  try { await salvarCom(f, { situacao: 'ativo', ativo: true, demissao: null, motivo_demissao: null }); aviso('Readmitido(a).') } catch (e) { erro(e) }
}

const MOTIVOS: MotivoHist[] = ['Promoção', 'Dissídio', 'Mérito', 'Espontâneo', 'Mudança de setor', 'Correção']
const DICA: Record<string, string> = { Promoção: 'Mudou de cargo (com ou sem aumento).', Dissídio: 'Reajuste da convenção coletiva.', Mérito: 'Aumento por desempenho.', Espontâneo: 'Aumento dado pela empresa.', 'Mudança de setor': 'Foi para outro setor.', Correção: 'Acerto de um valor lançado errado.' }
export async function alterarCargoSalario(f: Funcionario) {
  const p = S.get('funcionarios_privado', f.id)
  await modal({
    titulo: 'Alterar cargo ou salário — ' + f.nome,
    corpo: <>
      <div className="campo"><label>Motivo</label><div className="opcoes">{MOTIVOS.map((m, i) => <label key={m} className="opcao"><input type="radio" name="motivo" value={m} defaultChecked={i === 0} /><span><b>{m}</b><small>{DICA[m]}</small></span></label>)}</div></div>
      <div className="linha-campos"><Campo nome="vigencia" rotulo="Vale a partir de" tipo="date" valor={U.hoje()} req /><Campo nome="salario" rotulo={`Novo salário (hoje ${p?.salario ? U.moeda(p.salario) : '—'})`} tipo="dinheiro" placeholder="deixe vazio se não mudou" /></div>
      <div className="linha-campos">{S.lista('rh_cargos').length > 0 && <Campo nome="cargo_id" rotulo="Novo cargo" tipo="select" valor="" opcoes={opcoesCargos(`Continua: ${f.funcao || 'sem cargo'}`)} />}
        <Campo nome="setor" rotulo="Novo setor" tipo="select" valor="" opcoes={opcoesSetores(`Continua: ${f.setor || 'sem setor'}`)} /></div>
      <Campo nome="obs" rotulo="Observação (opcional)" />
      <p className="sub">Data no futuro: o cadastro muda sozinho quando chegar o dia (fica marcado na linha do tempo).</p>
    </>,
    botoes: [{ txt: 'Registrar', acao: async (frm) => {
      const d = lerForm(frm)
      const sal = d.salario && Number(d.salario) !== Number(p?.salario) ? d.salario : null
      const setor = d.setor && d.setor !== f.setor ? d.setor : null
      if (!sal && !d.cargo_id && !setor) throw new ErroApp('Escolha o novo cargo, o novo setor ou digite o novo salário.')
      await API.rpc('rh_alterar_cargo_salario', { p: { funcionario_id: f.id, vigencia: d.vigencia, motivo: d.motivo, salario: sal, cargo_id: d.cargo_id || null, setor, obs: d.obs } })
      await App.gravou(['rh_historico', 'funcionarios', 'funcionarios_privado'], { inteira: ['rh_historico'] })
      const pct = sal && p?.salario ? ` (${((sal - Number(p.salario)) / Number(p.salario) * 100).toFixed(1).replace('.', ',')}%)` : ''
      aviso('Registrado' + pct + '.')
    } }],
  })
}

// ------------------------------------------------------------------ ficha em PDF (a "Consulta rápida" da planilha, completa)
async function fichaPdf(f: Funcionario) {
  const p = S.get('funcionarios_privado', f.id) || ({} as Partial<FuncionarioPrivado>)
  const ps = C.periodosFerias(f)
  const aso = R.ultimoAso(S.lista('rh_asos'), f.id)
  const hist = S.lista('rh_historico').filter(x => x.funcionario_id === f.id).sort((a, b) => a.vigencia < b.vigencia ? -1 : 1)
  const oc = S.lista('rh_ocorrencias').filter(o => o.funcionario_id === f.id).sort((a, b) => a.data_ocorrencia < b.data_ocorrencia ? -1 : 1)
  const exp = R.experiencia(f.admissao)
  const blob = await pdfDocumento('Ficha do funcionário', `${f.nome}${f.matricula ? ' · ' + f.matricula : ''}`, (c) => {
    let y = c.y + 2
    const bloco = (titulo: string, pares: [string, unknown][]) => {
      const linhas = pares.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [k, String(v)])
      if (!linhas.length) return
      if (y > c.H - 40) { c.doc.addPage(); y = 20 }
      c.texto(titulo, y, { tam: 11, negrito: true })
      c.tabela({ ...c.estilo, startY: y + 2, body: linhas, theme: 'plain', styles: { ...c.estilo.styles, fontSize: 9, cellPadding: 1.2 }, columnStyles: { 0: { cellWidth: 52, textColor: 100 } } })
      y = c.doc.lastAutoTable.finalY + 6
    }
    bloco('Trabalho', [['Função', f.funcao], ['Setor', f.setor], ['Registro', f.registro], ['Admissão', f.admissao ? `${U.data(f.admissao)} (${R.tempoCasa(f.admissao, f.demissao || U.hoje())})` : ''],
      ['Experiência', exp ? `1º até ${U.data(exp.fim1)} · 2º até ${U.data(exp.fim2)}` : ''], ['Horário', f.horario], ['Descanso', f.descanso], ['Superior direto', nomeF(f.superior_id)],
      ['Salário', p.salario ? U.moeda(p.salario) : ''], ['Situação', situacaoFunc(f).txt], ['Desligamento', f.demissao ? `${U.data(f.demissao)} — ${f.motivo_demissao || ''}` : '']])
    bloco('Documentos', [['CPF', p.cpf], ['RG', p.rg], ['PIS', p.pis], ['Título de eleitor', p.titulo_eleitor], ['Reservista', p.reservista], ['CNH', p.cnh], ['Matrícula eSocial', f.matricula_esocial]])
    bloco('Pessoal e contato', [['Nascimento', p.nascimento ? `${U.data(p.nascimento)} (${R.idade(p.nascimento)} anos)` : ''], ['Naturalidade', [p.naturalidade, p.uf_nascimento].filter(Boolean).join('/')],
      ['Estado civil', p.estado_civil], ['Instrução', p.instrucao], ['Mãe', p.mae], ['Pai', p.pai], ['Celular', p.celular || f.telefone], ['E-mail', p.email],
      ['Endereço', [p.endereco, p.numero, p.complemento, p.bairro, p.cidade, p.cep].filter(Boolean).join(', ')], ['Emergência', [p.emergencia_nome, p.emergencia_fone].filter(Boolean).join(' — ')],
      ['Uniforme / calçado', [p.uniforme, p.calcado].filter(Boolean).join(' / ')], ['Chaves', [p.chave_celular && 'celular ' + p.chave_celular, p.chave_vestiario && 'vestiário ' + p.chave_vestiario].filter(Boolean).join(' · ')]])
    if (ps.length) { c.texto('Férias', y, { tam: 11, negrito: true }); c.tabela({ ...c.estilo, startY: y + 2, head: [['Período aquisitivo', 'Data limite', 'Tirados', 'Saldo', 'Situação']],
      body: ps.slice(-4).map(x => [`${U.data(x.inicio)} a ${U.data(x.fim)}`, U.data(x.limite), x.gozados + ' dias', x.saldo + ' dias', R.TXT_FERIAS[x.situacao]]) }); y = c.doc.lastAutoTable.finalY + 6 }
    if (hist.length) { if (y > c.H - 40) { c.doc.addPage(); y = 20 } c.texto('Cargo e salário', y, { tam: 11, negrito: true }); c.tabela({ ...c.estilo, startY: y + 2, head: [['Vigência', 'Motivo', 'Cargo', 'Setor', 'Salário']],
      body: hist.map(x => [U.data(x.vigencia), x.motivo, x.cargo || '', x.setor || '', x.salario ? U.moeda(x.salario) : '']) }); y = c.doc.lastAutoTable.finalY + 6 }
    bloco('Saúde e segurança', [['Último ASO', aso ? `${aso.tipo} em ${U.data(aso.data_exame)} — ${aso.resultado || ''} — vence ${U.data(R.vencimentoAso(aso))}` : 'sem registro']])
    if (oc.length) { if (y > c.H - 40) { c.doc.addPage(); y = 20 } c.texto('Medidas disciplinares', y, { tam: 11, negrito: true }); c.tabela({ ...c.estilo, startY: y + 2, head: [['Data', 'Medida', 'Assunto', 'Situação']],
      body: oc.map(o => [U.data(o.data_ocorrencia), TIPO_MEDIDA[o.tipo], o.assunto || o.categoria || '', o.status]) }); y = c.doc.lastAutoTable.finalY + 6 }
    if (p.obs) { if (y > c.H - 30) { c.doc.addPage(); y = 20 } c.texto('Observações', y, { tam: 11, negrito: true }); c.texto(p.obs, y + 5, { tam: 9 }) }
  })
  await entregar(blob, `Ficha ${f.nome}.pdf`)
}
