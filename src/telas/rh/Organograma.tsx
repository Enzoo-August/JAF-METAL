/* RH — Organograma: árvore de cargos (quem responde a quem) com as pessoas de cada cargo; ou a árvore de pessoas pelo chefe direto */
import { S } from '../../lib/dados.ts'
import type { Funcionario, RhCargo } from '../../lib/tipos.ts'
import * as U from '../../lib/util.ts'
import { entregar, pdfDocumento } from '../../ui/arquivos.tsx'
import { Btn, Cab, Chips, Vazio } from '../../ui/base.tsx'
import { useLembrar } from '../../ui/ganchos.ts'
import { opcoesSetores, pode } from './comum.tsx'

const ativosDoCargo = (id: string) => U.ordenar(S.lista('funcionarios').filter(f => f.ativo && f.cargo_id === id), f => U.sem(f.nome))

export function TelaOrganograma() {
  const [modo, setModo] = useLembrar('org.modo', 'cargos')
  const [setor, setSetor] = useLembrar('org.setor', '')
  const cargos = S.lista('rh_cargos').filter(c => c.ativo)
  const semCargo = S.lista('funcionarios').filter(f => f.ativo && !f.cargo_id)
  const m = cargos.length ? modo : 'pessoas'
  return <>
    <Cab titulo="Organograma" sub="Quem responde a quem.">
      <Btn txt="PDF" icone="imprimir" data-org="pdf" onClick={() => pdfOrganograma(m, setor)} />
      {pode() && <a className="btn sec" href="#/rh/ajustes?aba=cargos">Cargos</a>}
    </Cab>
    <div className="barra-filtros">{cargos.length > 0 && <Chips atual={m} aoEscolher={setModo} nome="om" opcoes={[{ v: 'cargos', t: 'Por cargos' }, { v: 'pessoas', t: 'Por chefe direto' }]} />}
      <select aria-label="Setor" value={setor} onChange={(e) => setSetor(e.target.value)}>{opcoesSetores('Todos os setores').map(o => <option key={o.v} value={o.v}>{o.t}</option>)}</select></div>
    {m === 'cargos' ? <ArvoreCargos setor={setor} /> : <ArvorePessoas setor={setor} />}
    {m === 'cargos' && semCargo.length > 0 && <section className="card mt"><h2>Sem cargo no organograma <span className="sub">({semCargo.length})</span></h2>
      <p className="sub">Escolha o cargo no cadastro da pessoa (Editar → Cargo) para ela aparecer na árvore.</p>
      <div className="org-pessoas mt">{U.ordenar(semCargo, f => U.sem(f.nome)).filter(f => !setor || f.setor === setor).map(f => <a key={f.id} href={'#/funcionario/' + f.id} className="org-pessoa">{f.nome}<small>{f.funcao || ''}</small></a>)}</div></section>}
  </>
}

// cargos de um setor + os chefes deles (para a árvore não ficar solta)
function visiveis(cargos: RhCargo[], setor: string): Set<string> {
  const ids = new Set<string>()
  const porId = new Map(cargos.map(c => [c.id, c]))
  for (const c of cargos) if (!setor || c.setor === setor || ativosDoCargo(c.id).some(f => f.setor === setor)) {
    let x: RhCargo | undefined = c, n = 0
    while (x && n++ < 30) { ids.add(x.id); x = x.superior_id ? porId.get(x.superior_id) : undefined }
  }
  return ids
}
function ArvoreCargos({ setor }: { setor: string }) {
  const cargos = S.lista('rh_cargos').filter(c => c.ativo)
  const vis = visiveis(cargos, setor)
  const filhos = U.agrupar(cargos.filter(c => vis.has(c.id)), c => (c.superior_id && cargos.some(x => x.id === c.superior_id) ? c.superior_id : ''))
  const raiz = filhos.get('') || []
  if (!raiz.length) return <Vazio icone="equipe" titulo="Nenhum cargo neste setor" />
  const No = ({ c }: { c: RhCargo }) => {
    const ps = ativosDoCargo(c.id).filter(f => !setor || f.setor === setor || !c.setor || c.setor === setor)
    const fs = U.ordenar(filhos.get(c.id) || [], x => U.sem(x.nome))
    return <li><div className="org-no"><b>{c.nome}</b><small>{[c.setor, c.cbo && 'CBO ' + c.cbo].filter(Boolean).join(' · ')}</small>
      {ps.length > 0 && <div className="org-pessoas">{ps.map(f => <a key={f.id} href={'#/funcionario/' + f.id} className="org-pessoa">{f.nome}</a>)}</div>}</div>
      {fs.length > 0 && <ul>{fs.map(x => <No key={x.id} c={x} />)}</ul>}</li>
  }
  return <div className="org card"><ul className="org-raiz">{U.ordenar(raiz, x => U.sem(x.nome)).map(c => <No key={c.id} c={c} />)}</ul></div>
}

function ArvorePessoas({ setor }: { setor: string }) {
  const at = S.lista('funcionarios').filter(f => f.ativo)
  const ids = new Set(at.map(f => f.id))
  const filhos = U.agrupar(at, f => (f.superior_id && ids.has(f.superior_id) ? f.superior_id : ''))
  const temSub = (f: Funcionario): boolean => (filhos.get(f.id) || []).some(x => !setor || x.setor === setor || temSub(x))
  const raiz = (filhos.get('') || []).filter(f => !setor || f.setor === setor || temSub(f))
  if (!at.some(f => f.superior_id)) return <Vazio icone="equipe" titulo="Ninguém com chefe direto cadastrado" texto="No cadastro de cada pessoa, preencha “Responde a (chefe direto)”. Ou cadastre os cargos em Ajustes → Cargos e use a árvore por cargos." />
  const No = ({ f }: { f: Funcionario }) => {
    const fs = U.ordenar((filhos.get(f.id) || []).filter(x => !setor || x.setor === setor || temSub(x)), x => U.sem(x.nome))
    return <li><div className="org-no"><a href={'#/funcionario/' + f.id}><b>{f.nome}</b></a><small>{[f.funcao, f.setor].filter(Boolean).join(' · ')}{fs.length ? ` · ${U.plural(fs.length, 'pessoa')}` : ''}</small></div>
      {fs.length > 0 && <ul>{fs.map(x => <No key={x.id} f={x} />)}</ul>}</li>
  }
  const comSub = raiz.filter(f => (filhos.get(f.id) || []).length), soltos = raiz.filter(f => !(filhos.get(f.id) || []).length)
  return <>
    <div className="org card"><ul className="org-raiz">{U.ordenar(comSub, x => U.sem(x.nome)).map(f => <No key={f.id} f={f} />)}</ul></div>
    {soltos.length > 0 && <section className="card mt"><h2>Sem chefe direto cadastrado <span className="sub">({soltos.length})</span></h2>
      <div className="org-pessoas mt">{U.ordenar(soltos, f => U.sem(f.nome)).map(f => <a key={f.id} href={'#/funcionario/' + f.id} className="org-pessoa">{f.nome}<small>{f.funcao || ''}</small></a>)}</div></section>}
  </>
}

async function pdfOrganograma(modo: string, setor: string) {
  const linhas: [number, string, string][] = []
  if (modo === 'cargos') {
    const cargos = S.lista('rh_cargos').filter(c => c.ativo), vis = visiveis(cargos, setor)
    const filhos = U.agrupar(cargos.filter(c => vis.has(c.id)), c => (c.superior_id && cargos.some(x => x.id === c.superior_id) ? c.superior_id : ''))
    const andar = (c: RhCargo, n: number) => { linhas.push([n, c.nome, ativosDoCargo(c.id).map(f => f.nome).join(', ')]); for (const x of U.ordenar(filhos.get(c.id) || [], x => U.sem(x.nome))) andar(x, n + 1) }
    for (const c of U.ordenar(filhos.get('') || [], x => U.sem(x.nome))) andar(c, 0)
  } else {
    const at = S.lista('funcionarios').filter(f => f.ativo), ids = new Set(at.map(f => f.id))
    const filhos = U.agrupar(at, f => (f.superior_id && ids.has(f.superior_id) ? f.superior_id : ''))
    const andar = (f: Funcionario, n: number) => { linhas.push([n, f.nome, f.funcao || '']); for (const x of U.ordenar(filhos.get(f.id) || [], x => U.sem(x.nome))) andar(x, n + 1) }
    for (const f of U.ordenar((filhos.get('') || []).filter(f => (filhos.get(f.id) || []).length), x => U.sem(x.nome))) andar(f, 0)
  }
  const blob = await pdfDocumento('Organograma', (modo === 'cargos' ? 'Por cargos' : 'Por chefe direto') + (setor ? ' · ' + setor : ''), (c) => {
    c.tabela({ ...c.estilo, startY: c.y + 2, head: [[modo === 'cargos' ? 'Cargo' : 'Pessoa', modo === 'cargos' ? 'Pessoas' : 'Função']],
      body: linhas.map(([n, a, b]) => [`${'      '.repeat(n)}${n ? '› ' : ''}${a}`, b]), columnStyles: { 0: { cellWidth: 95 } } })
  })
  await entregar(blob, 'Organograma.pdf')
}
