/* Ajuda e boas-vindas */
import type { ReactNode } from 'react'
import { App } from '../app/controle.tsx'
import { API } from '../lib/api.ts'
import { Perm, type Acao } from '../lib/perm.ts'
import { Cab } from '../ui/base.tsx'
import { Ic } from '../ui/icones.tsx'
import { modal } from '../ui/janelas.tsx'

const TOPICOS: { q: string; perm: Acao; r: ReactNode }[] = [
  { q: 'Como retiro uma peça do almoxarifado?', perm: 'retirar', r: <ol className="passos"><li><span>Toque em <b>Retirar</b> (botão azul no meio da barra de baixo, ou no menu).</span></li>
    <li><span>Digite parte do código ou do nome da peça e escolha na lista.</span></li><li><span>Confira a quantidade, quem está retirando e a máquina.</span></li>
    <li><span>Toque em <b>Retirar</b>. Errou? Toque em <b>Desfazer</b> no aviso que aparece embaixo (ou abra a movimentação e desfaça).</span></li></ol> },
  { q: 'Chegou peça. Como dou entrada?', perm: 'entrada', r: <><p>Se a peça veio de um <b>pedido de compra</b>, abra o pedido e toque em <b>Receber</b>: o estoque sobe e o pedido é baixado (dá para receber só uma parte).</p>
    <p>Sem pedido: <b>Dar entrada</b> → escolha a peça → Compra → quantidade, preço da nota, fornecedor e número da NF.</p></> },
  { q: 'O estoque do sistema não bate com a prateleira', perm: 'entrada', r: <p>Abra a peça e toque em <b>Contar</b>. Digite quanto tem de verdade: o sistema lança o ajuste da diferença e guarda no histórico. Para muitas peças, use <b>Estoque → Contar estoque</b> (inventário).</p> },
  { q: 'Como sei o que precisa comprar?', perm: 'compras', r: <p>Em <b>Lista de compras</b>: aparecem as peças abaixo do mínimo (a mesma regra da planilha). A quantidade sugerida completa até o máximo e já desconta o que está a caminho. Marque as peças e toque em <b>Gerar pedido</b>.</p> },
  { q: 'Como mando o pedido para o fornecedor?', perm: 'compras', r: <p>Abra o pedido → <b>Enviar</b>. Dá para mandar o PDF, abrir o WhatsApp do fornecedor com o texto pronto ou o e-mail.</p> },
  { q: 'O que é o "lote" ou "PEPS" na ficha da peça?', perm: 'precos', r: <p>Cada entrada (nota fiscal) é um lote com o preço que vocês pagaram. Quando alguém retira, o sistema tira do lote mais antigo primeiro (Primeiro que Entra, Primeiro que Sai) e usa o preço dele — como era feito na planilha, só que automático.</p> },
  { q: 'A máquina deu problema. O que faço?', perm: 'manutencao', r: <p>Toque em <b>Máquina com problema</b> (no Início ou em Máquinas), escolha a máquina e descreva. Quando resolver, abra o chamado, escreva a solução e marque <b>Concluída</b>. Peças usadas: retire escolhendo a máquina e a manutenção.</p> },
  { q: 'Como funcionam as ordens de produção?', perm: 'producao_status', r: <p>Cada ordem anda: <b>Na fila → Produzindo → Pronta → Entregue</b>. Abra a ordem para começar, anotar quantas já foram feitas e marcar como pronta. A entrega é marcada pelo escritório, que já pode lançar a conta a receber.</p> },
  { q: 'Como lanço uma conta parcelada ou que repete todo mês?', perm: 'financeiro', r: <p><b>Nova conta</b> → informe o valor total e o 1º vencimento → em "Repetir / parcelar" escolha o número de vezes. Para conta fixa (aluguel), escolha "Todo mês" e digite o valor de um mês × o número de meses.</p> },
  { q: 'O que é o fluxo de caixa?', perm: 'financeiro', r: <p>Mostra mês a mês o que entrou, o que saiu e o que ainda vai entrar/sair. Informe o saldo do caixa uma vez (botão <b>Informar saldo</b>) e o sistema calcula quanto vai ter daqui a 7, 30 e 90 dias.</p> },
  { q: 'Quem vê o quê?', perm: 'todos', r: <p><b>Dono</b>: tudo. <b>Escritório</b>: tudo do dia a dia, sem criar acessos. <b>Almoxarifado</b>: estoque, compras, máquinas e produção, sem financeiro e salários. <b>Produção</b>: retirar peça, ver estoque (sem preços), ordens e chamados. Essa regra está no banco de dados — não depende do aparelho.</p> },
  { q: 'Ficou sem internet. Perco alguma coisa?', perm: 'todos', r: <p>Sem internet dá para consultar o que já estava carregado, mas <b>nada é salvo</b> — o sistema avisa na hora. Nada fica "esperando" escondido: quando a internet voltar, é só tocar de novo. Mesmo que toque duas vezes, o sistema não lança em dobro.</p> },
  { q: 'Como instalo no celular?', perm: 'todos', r: <p>Veja em <a href="#/conta">Minha conta → Usar como aplicativo</a>.</p> },
  { q: 'Como faço cópia de segurança?', perm: 'config', r: <p><a href="#/admin?aba=copia">Administração → Cópia dos dados</a> → <b>Baixar cópia completa</b>. Faça uma vez por semana e guarde no Drive.</p> },
]

function PassosPerfil() {
  const L: Record<string, ReactNode[]> = {
    producao: [<>Para pegar uma peça: <b>Retirar</b> (botão do meio).</>, <>Suas ordens aparecem no <b>Início</b>; toque nelas para atualizar.</>, <>Máquina parou? <b>Máquina com problema</b>.</>],
    almoxarife: [<>Peça saiu: <b>Retirar</b>. Peça chegou: abra o pedido e <b>Receber</b>.</>, <>Todo dia, olhe o <b>Início</b>: o que está faltando e o que vai chegar.</>, <>Para comprar: <b>Lista de compras → Gerar pedido</b>.</>],
    escritorio: [<>O <b>Início</b> mostra tudo que precisa de atenção (contas vencendo, pedidos atrasados…).</>, <>Contas: <b>Contas a pagar e receber</b>. Ao receber pedido, já dá para lançar a conta.</>, <>Toda semana: <a href="#/admin?aba=copia">baixar a cópia dos dados</a>.</>],
    dono: [<>O <b>Início</b> resume o que precisa de atenção.</>, <>Crie os acessos da equipe em <a href="#/admin">Administração → Acessos</a>.</>, <>Veja <a href="#/relatorios">Relatórios</a> e o <a href="#/financeiro/fluxo">Fluxo de caixa</a> para decidir.</>],
  }
  return <ol className="passos">{(L[API.sessao?.perfil || ''] || []).map((x, n) => <li key={n}><span>{x}</span></li>)}</ol>
}

export function TelaAjuda() {
  return <>
    <Cab titulo="Ajuda" sub="Dúvidas mais comuns" />
    <section className="card"><h2>Começo rápido</h2><div className="mt"><PassosPerfil /></div>
      <button type="button" className="btn sec mt" data-a="tour" onClick={() => boasVindas()}><Ic n="ajuda" /><span>Ver as boas-vindas de novo</span></button></section>
    <div className="mt2">{TOPICOS.filter(x => Perm.pode(x.perm)).map(x => <details key={x.q} className="duvida"><summary>{x.q}</summary>{x.r}</details>)}</div>
    <p className="sub mt2">Não achou? Fale com quem cuida do sistema e conte o que estava tentando fazer e em que tela.</p>
  </>
}

export function boasVindas(): void {
  void modal({
    titulo: 'Bem-vindo ao sistema da JAF Metal',
    corpo: <><p>Olá, <b>{(API.sessao?.nome || '').split(' ')[0]}</b>! Este é o novo jeito de cuidar do almoxarifado, das compras, da produção{Perm.pode('financeiro') ? ' e do financeiro' : ''} — no lugar da planilha.</p>
      <PassosPerfil /><p className="sub mt">A qualquer hora: <b>Ajuda</b>, no menu.</p></>,
    fecharTxt: 'Começar',
  }).then(() => App.gravarPref('boasVindas', true))
}
