/* Janelinha "O que mudou" depois de cada atualização (regra fixa desde a v3.4).
 * Cada novidade diz para quem é (pelo que a pessoa pode fazer no sistema): quem foi afetado vê uma vez só,
 * logo depois de entrar; quem é de outra área não vê nada. Em Ajuda › "O que mudou" dá para ver de novo.
 * Para uma atualização nova: acrescente um bloco NO COMEÇO da lista NOVIDADES (versão, data e os itens). */
import { App } from '../app/controle.tsx'
import { Perm } from '../lib/perm.ts'
import * as U from '../lib/util.ts'
import { Ic } from '../ui/icones.tsx'
import { fecharTodas, modal } from '../ui/janelas.tsx'

export interface ItemNovidade { titulo: string; txt: string; pode: () => boolean; ir?: { rota: string; txt: string } }
export interface Novidade { versao: string; data: string; itens: ItemNovidade[] }

export const NOVIDADES: Novidade[] = [
  { versao: '3.6', data: '2026-11-17', itens: [
    { titulo: 'Romaneio por semana (de uma data até outra)', pode: () => Perm.pode('vendas'), ir: { rota: '#/entregas?aba=romaneio', txt: 'Abrir o Romaneio' },
      txt: 'No Romaneio, uma faixa mostra as próximas semanas com a carga de cada uma. Esta semana soma os atrasados; as seguintes trazem só os pedidos daquela semana, sem acumular. Em "Outro período" você escolhe de uma data até outra.' },
    { titulo: 'As 3 semanas de uma vez, como a planilha', pode: () => Perm.pode('vendas'), ir: { rota: '#/entregas?aba=romaneio', txt: 'Gerar as semanas' },
      txt: 'Em "Várias semanas de uma vez", escolha quantas semanas e toque em Excel: sai a aba geral + uma aba por semana (19-11, 26-11, 03-12...). O PDF sai com uma página por semana, pronta para assinar.' },
  ] },
  { versao: '3.5', data: '2026-11-16', itens: [
    { titulo: 'Serviço externo pela nota fiscal', pode: () => Perm.pode('pcp_reg_editar'), ir: { rota: '#/reg/servico_externo', txt: 'Abrir Serviço externo' },
      txt: 'Em Serviço externo, botão "Ler nota (XML ou PDF)". A nota de saída para o fornecedor lança os serviços; a nota de retorno dá a baixa na quantidade que voltou. Você confere tudo antes de gravar.' },
    { titulo: 'Retorno parcial continua em aberto', pode: () => Perm.pode('pcp_reg_editar'),
      txt: 'O serviço externo só sai de "Em aberto" quando volta tudo. Voltou uma parte? Ele mostra quanto voltou e continua na lista. A ficha também mostra o nº da NF de saída e de retorno.' },
  ] },
  { versao: '3.4', data: '2026-11-13', itens: [
    { titulo: 'Etiquetas de R.I.: 4 por folha', pode: () => Perm.pode('mp_editar'), ir: { rota: '#/mp', txt: 'Abrir Matéria-prima' },
      txt: 'Em Matéria-prima, botão "Etiquetas": digite até 4 números de R.I. e sai uma folha A4 com 4 etiquetas no modelo Form. 001. Deixe em branco a posição que já foi usada na folha.' },
    { titulo: 'Compras de matéria-prima em andamento', pode: () => Perm.pode('compras_mp_ver') && Perm.pode('necessidade'), ir: { rota: '#/necessidade?aba=mp', txt: 'Ver as compras' },
      txt: 'Em Necessidade › Matéria-prima aparece cada pedido de compra em aberto: material, quanto falta chegar, fornecedor e prazo (atrasado, chega hoje, chega em poucos dias).' },
    { titulo: 'Aviso de compra atrasada no Início', pode: () => Perm.pode('compras_mp_ver'),
      txt: 'Os pedidos de matéria-prima atrasados ou que chegam nos próximos 3 dias aparecem nos avisos do Início e no sininho.' },
    { titulo: 'OF de conjunto: componente comprado não ganha OF', pode: () => Perm.pode('of_emitir'),
      txt: 'Só os componentes fabricados aqui (CF, sub-conjuntos) ganham OF automática. O componente comprado (CC) é tratado como matéria-prima: chega do fornecedor pelo R.I. e aparece na compra de material.' },
  ] },
]

const vistas = (): string[] => App.lerPref<string[]>('novidades') || []
// marca tudo como visto (quem entra pela primeira vez já recebe as boas-vindas: não precisa do "o que mudou")
export const marcarVistas = (): void => App.gravarPref('novidades', NOVIDADES.map(n => n.versao))
// o que esta pessoa ainda não viu (só dos últimos 60 dias) e que mexe no trabalho dela
export function pendentes(todas = false): Novidade[] {
  const v = new Set(vistas()), limite = U.somaDias(U.hoje(), -60)
  return NOVIDADES.filter(n => todas || (!v.has(n.versao) && n.data >= limite))
    .map(n => ({ ...n, itens: n.itens.filter(i => i.pode()) })).filter(n => n.itens.length)
}

export async function mostrar(todas = false): Promise<void> {
  const l = pendentes(todas)
  if (!l.length) { if (!todas) marcarVistas(); return }
  const ir = (rota: string) => { fecharTodas(); location.hash = rota }
  await modal({
    titulo: l.length === 1 ? `Atualização ${l[0].versao} — o que mudou` : 'Atualizações — o que mudou',
    corpo: <div className="novidades" data-novidades={l.map(n => n.versao).join(',')}>
      {l.map(n => <section key={n.versao}>
        {l.length > 1 && <h3>Versão {n.versao} <small>· {U.data(n.data)}</small></h3>}
        <ul className="nov-lista">{n.itens.map((i, k) => <li key={k} data-nov-item={k}><span className="nov-ic"><Ic n="ok" /></span>
          <span><b>{i.titulo}</b><small>{i.txt}</small>
            {i.ir && <button type="button" className="link" onClick={() => ir(i.ir!.rota)}>{i.ir.txt}</button>}</span></li>)}</ul>
      </section>)}
      {l.length === 1 && <p className="peq">{U.data(l[0].data)} · Dúvidas: Ajuda, no menu.</p>}
    </div>,
    fecharTxt: 'Entendi',
  })
  if (!todas) marcarVistas()
}
