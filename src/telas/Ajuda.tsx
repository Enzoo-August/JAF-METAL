/* Ajuda: central pesquisável (digite "férias", "RH", "retirar"…), passo a passo com "Me mostre na tela", manual em PDF e boas-vindas */
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { areasVisiveis } from '../app/areas.ts'
import { App } from '../app/controle.tsx'
import { API } from '../lib/api.ts'
import { Perm, type Acao } from '../lib/perm.ts'
import * as U from '../lib/util.ts'
import { entregar, pdfDocumento } from '../ui/arquivos.tsx'
import { Btn, Cab, Chips, Vazio } from '../ui/base.tsx'
import type { Rota } from '../ui/ganchos.ts'
import { Ic } from '../ui/icones.tsx'
import { fecharTodas, modal } from '../ui/janelas.tsx'

// ------------------------------------------------------------------ artigos (texto: *negrito*; passos numerados)
type Bloco = string | { passos: string[] }
interface Passo { rota?: string; alvo: string; texto: string }
interface Artigo { id: string; area: string; titulo: string; palavras: string; perm: Acao; rota?: string; corpo: Bloco[]; tour?: Passo[] }

export const ARTIGOS: Artigo[] = [
  // ---------------- começo
  { id: 'menu', area: 'inicio', titulo: 'Como o sistema está organizado', palavras: 'menu áreas abas onde fica perdido navegar', perm: 'todos', corpo: [
    'O menu tem poucas *áreas*, na ordem do que mais se usa: Início, Estoque, Compras, Fábrica, RH, Financeiro… Cada área tem *abas* no alto da tela (ex.: no RH: Pessoas, Ponto, Férias…).',
    'No celular, a barra de baixo tem os atalhos do seu perfil e o botão *Menu* abre todas as áreas. O *?* ao lado das abas abre a ajuda daquela área.',
    'A *lupa* no topo procura peça, pessoa ou tela: digite “férias” e toque no resultado.'],
    tour: [{ alvo: '.lateral-menu, .abas', texto: 'Aqui ficam as áreas do sistema. Toque numa área para abrir.' }, { alvo: '#buscaGeral, [data-acao=buscar]', texto: 'A lupa procura peça, pessoa ou tela pelo nome.' }, { alvo: '[data-acao=alertas]', texto: 'O sininho mostra o que precisa de atenção (férias vencendo, peça faltando…).' }] },
  { id: 'personalizar', area: 'inicio', titulo: 'Personalizar o Início (tirar ou pôr atalhos)', palavras: 'início atalho quadro tirar pôr ordem personalizar fornecedores', perm: 'todos', rota: '#/inicio', corpo: [
    { passos: ['No *Início*, toque em *Personalizar* (canto de cima).', 'Marque o que quer ver e desmarque o que não usa.', 'Use as setas para mudar a ordem.', 'Toque em *Salvar*. Vale só para você, em qualquer aparelho. *Voltar ao padrão* desfaz.'] }],
    tour: [{ rota: '#/inicio', alvo: '[data-acao=personalizar]', texto: 'Toque aqui para escolher os atalhos e quadros do seu Início.' }] },
  { id: 'avisos', area: 'inicio', titulo: 'O que é o sininho (avisos)', palavras: 'sino avisos alerta vermelho piscando', perm: 'todos', corpo: [
    'O sininho junta tudo que precisa de atenção para o seu perfil: peças abaixo do mínimo, pedidos atrasados, contas vencendo, férias vencendo, exames (ASO) e treinamentos vencidos, fim de experiência.',
    'Aviso que *pisca* é urgente (férias vencidas ou vencendo em 30 dias, reciclagem obrigatória perto de vencer). Toque no aviso para ir direto à tela.'] },
  // ---------------- estoque
  { id: 'retirar', area: 'estoque', titulo: 'Como retirar uma peça do almoxarifado', palavras: 'retirar tirar pegar saída peça', perm: 'retirar', corpo: [
    { passos: ['Toque em *Retirar* (botão azul do meio no celular, ou *Retirar peça* no menu).', 'Digite parte do código ou do nome da peça e escolha na lista.', 'Confira a quantidade, quem está retirando e a máquina.', 'Toque em *Retirar*. Errou? Toque em *Desfazer* no aviso que aparece embaixo.'] }],
    tour: [{ alvo: '[data-acao=retirar]', texto: 'Este botão abre a retirada de peça. Ele está sempre à mão.' }] },
  { id: 'entrada', area: 'estoque', titulo: 'Chegou peça: como dar entrada', palavras: 'entrada chegou nota fiscal compra receber', perm: 'entrada', corpo: [
    'Se a peça veio de um *pedido de compra*, abra o pedido e toque em *Receber*: o estoque sobe e o pedido é baixado (dá para receber só uma parte).',
    'Sem pedido: *Dar entrada* → escolha a peça → Compra → quantidade, preço da nota, fornecedor e número da NF.'] },
  { id: 'contar', area: 'estoque', titulo: 'O estoque do sistema não bate com a prateleira', palavras: 'contar inventário ajuste diferença saldo errado', perm: 'entrada', corpo: [
    'Abra a peça e toque em *Contar*. Digite quanto tem de verdade: o sistema lança o ajuste da diferença e guarda no histórico. Para muitas peças use *Estoque → Contar estoque* (inventário).'] },
  { id: 'peps', area: 'estoque', titulo: 'O que é o lote (PEPS) na ficha da peça', palavras: 'peps lote preço custo valor', perm: 'precos', corpo: [
    'Cada entrada (nota) é um lote com o preço pago. Quem retira usa o lote mais antigo primeiro (Primeiro que Entra, Primeiro que Sai) — como na planilha, só que automático.'] },
  // ---------------- compras
  { id: 'comprar', area: 'compras', titulo: 'Como sei o que precisa comprar', palavras: 'lista de compras mínimo faltando comprar', perm: 'compras', rota: '#/compras/lista', corpo: [
    'Em *Compras → O que comprar* aparecem as peças abaixo do mínimo (a mesma regra da planilha). A quantidade sugerida completa até o máximo e já desconta o que está a caminho. Marque e toque em *Gerar pedido*.'] },
  { id: 'enviarPedido', area: 'compras', titulo: 'Como mandar o pedido para o fornecedor', palavras: 'enviar pedido whatsapp email pdf fornecedor', perm: 'compras', corpo: [
    'Abra o pedido → *Enviar*. Dá para mandar o PDF, abrir o WhatsApp do fornecedor com o texto pronto ou o e-mail.'] },
  // ---------------- fábrica
  { id: 'chamado', area: 'fabrica', titulo: 'A máquina deu problema', palavras: 'máquina quebrou chamado manutenção corretiva', perm: 'manutencao', corpo: [
    'Em *Fábrica → Máquinas* toque em *Máquina com problema* (ou ponha esse atalho no Início), escolha a máquina e descreva. Quando resolver, abra o chamado, escreva a solução e marque *Concluída*.'] },
  { id: 'ordens', area: 'fabrica', titulo: 'Como funcionam as ordens de produção', palavras: 'ordem produção op fila pronta entregue', perm: 'producao_status', corpo: [
    'Cada ordem anda: *Na fila → Produzindo → Pronta → Entregue*. Abra a ordem para começar, anotar quantas já foram feitas e marcar pronta. A entrega é marcada pelo escritório.'] },
  // ---------------- RH
  { id: 'rhVisao', area: 'rh', titulo: 'RH: o que tem e onde fica', palavras: 'rh recursos humanos planilhas excel onde', perm: 'rh_ver', rota: '#/rh', corpo: [
    'O RH junta as planilhas: *Relação de funcionários* e *Banco de dados* → aba *Pessoas*; *Planilha de horas extras* → *Ponto e horas extras*; datas limite de férias → *Férias e ausências*; *Plano de treinamentos*, *Procedimentos SGQ* e *Versatilidade* → *Treinamentos*; ASO e EPI → *EPI e exames*; modelos de advertência e suspensão → *Advertências*; organograma → *Organograma*.',
    'Os avisos de férias vencendo, exame vencido, reciclagem e fim de experiência aparecem no sininho e no Início.'] },
  { id: 'admissao', area: 'rh', titulo: 'Cadastrar uma pessoa (admissão)', palavras: 'admissão contratar novo funcionário cadastro cpf', perm: 'rh_editar', rota: '#/rh', corpo: [
    { passos: ['Em *RH → Pessoas* toque em *Nova pessoa*.', 'Na parte *Trabalho*: nome, cargo, setor, registro (Matriz, Filial, Upgrade), admissão e salário.', 'Nas partes *Documentos*, *Pessoal*, *Contato* e *Outros* preencha o que tiver (dá para completar depois).', 'Toque em *Cadastrar*. O sistema confere o CPF e não deixa repetir.'] },
    'A admissão abre a *linha do tempo* de cargo e salário e já calcula a experiência (30 + 30 dias) e as férias.'],
    tour: [{ rota: '#/rh', alvo: '[data-rh=novo]', texto: 'Toque aqui para cadastrar uma pessoa nova.' }] },
  { id: 'ficha', area: 'rh', titulo: 'A ficha da pessoa (consulta rápida)', palavras: 'ficha consulta rápida dados funcionário pdf imprimir', perm: 'rh_ver', corpo: [
    'Toque no nome da pessoa. A ficha tem abas: Resumo, Dados pessoais, Cargo e salário, Férias, Ponto, Treinamentos, EPI e exames, Advertências e Documentos.',
    '*Ficha PDF* gera tudo num documento (como a “Consulta rápida” da planilha). CPF e conta bancária aparecem escondidos; toque em *mostrar tudo* para ver.'] },
  { id: 'promocao', area: 'rh', titulo: 'Promoção, dissídio ou aumento de salário', palavras: 'promoção dissídio aumento salário cargo mudar histórico', perm: 'rh_sensivel', corpo: [
    { passos: ['Abra a ficha da pessoa → *Alterar cargo ou salário*.', 'Escolha o motivo (Promoção, Dissídio, Mérito…).', 'Informe a data em que passa a valer e o que mudou (cargo, setor e/ou salário).', 'Toque em *Registrar*. Fica na *linha do tempo* com a diferença em %.'] },
    'Data no futuro: o cadastro muda sozinho quando chegar o dia.'] },
  { id: 'desligar', area: 'rh', titulo: 'Desligar ou readmitir alguém', palavras: 'demissão desligar mandar embora pedido de demissão readmitir', perm: 'rh_editar', corpo: [
    'Na ficha → *Desligar* → último dia e motivo. O histórico continua guardado (aparece em *Desligados*). O sistema lembra do exame demissional, devolução de EPI e de desativar o acesso ao sistema.'] },
  { id: 'experiencia', area: 'rh', titulo: 'Contrato de experiência (30 + 30 dias)', palavras: 'experiência 30 dias 60 dias contrato prazo', perm: 'rh_ver', rota: '#/rh?f=experiencia', corpo: [
    'Igual à planilha: o 1º período termina 29 dias depois da admissão e o 2º, 29 dias depois do 1º. Em *Pessoas → Em experiência* aparece quando termina cada um, e o sininho avisa 7 dias antes.'] },
  { id: 'ponto', area: 'rh', titulo: 'Lançar o ponto e as horas extras', palavras: 'ponto hora extra cartão marcação entrada saída almoço', perm: 'rh_editar', rota: '#/rh/ponto', corpo: [
    { passos: ['Em *RH → Ponto e horas extras* escolha o mês e toque na pessoa.', 'Digite os horários do dia: entrada, saída para o almoço, volta e saída.', 'Falta, atestado, folga? Escolha em *Ocorrência*.', 'Toque em *Salvar*. As horas extras já saem separadas em 50%, 60%, 80% e 100%.'] },
    'Como na planilha, só precisa lançar os dias diferentes do normal (extra, falta, atraso). *Preencher horário padrão* completa os dias úteis de uma vez. Para um sábado com várias pessoas use *Lançar para várias pessoas*.',
    'Domingo e feriado contam a 100%; registro Upgrade a 60%. A tolerância da CLT (5 min por marcação, 10 no dia) é aplicada sozinha.'],
    tour: [{ rota: '#/rh/ponto', alvo: '#tPonto, .seletor-mes', texto: 'Escolha o mês e toque na pessoa para abrir o cartão de ponto.' }, { rota: '#/rh/ponto', alvo: '[data-ponto=exportar]', texto: 'Aqui sai a planilha do fechamento para a contabilidade.' }] },
  { id: 'fechamento', area: 'rh', titulo: 'Fechar o mês e mandar para a contabilidade', palavras: 'fechamento contabilidade excel exportar folha mês fechar', perm: 'rh_sensivel', rota: '#/rh/ponto', corpo: [
    'Em *Ponto e horas extras* toque em *Exportar para a contabilidade*: sai um Excel com ID, nome, cargo, salário, HE 50/60/80/100, faltas, DSR e atrasos (e os valores), mais a aba de lançamentos dia a dia.',
    '*Fechar o mês de todos* trava o ponto do mês (para mudar, reabra o mês da pessoa).'] },
  { id: 'ferias', area: 'rh', titulo: 'Férias: data limite e como programar', palavras: 'férias vencidas dobro programar período aquisitivo limite aviso', perm: 'rh_sensivel', rota: '#/rh/ferias', corpo: [
    'A conta é a mesma da planilha: período aquisitivo de 12 meses e *data limite* = fim do aquisitivo + 1 ano − 1 mês − 1 dia. Passou do limite = pagamento em dobro (aparece em vermelho piscando).',
    { passos: ['Em *Férias e ausências* toque em *Programar férias* (ou na ficha da pessoa).', 'Escolha a pessoa, o período aquisitivo, o primeiro dia e quantos dias.', 'Toque em *Programar* e depois em *Aviso em PDF* para imprimir o aviso de férias (30 dias antes, art. 135 da CLT).'] },
    'O sistema confere as regras da CLT: até 3 partes, uma com 14 dias ou mais e nenhuma com menos de 5.'],
    tour: [{ rota: '#/rh/ferias', alvo: '[data-fer=programar]', texto: 'Toque aqui para programar as férias de alguém.' }] },
  { id: 'atestado', area: 'rh', titulo: 'Atestado, afastamento pelo INSS, licença ou falta', palavras: 'atestado médico afastamento inss licença maternidade falta folga cid', perm: 'rh_editar', rota: '#/rh/ferias?aba=ausencias', corpo: [
    'Em *Férias e ausências* toque em *Lançar atestado ou falta*. Escolha o tipo, a pessoa e as datas. Licença maternidade, paternidade, casamento e luto já preenchem os dias.',
    'O CID é opcional e só RH, Escritório e Dono veem. Afastamento sem data para voltar: marque *Ainda não tem data para voltar*. Os dias ficam travados no ponto.'] },
  { id: 'treinamentos', area: 'rh', titulo: 'Matrizes de treinamento, procedimentos e versatilidade', palavras: 'treinamento matriz competência versatilidade procedimento sgq nível certificado', perm: 'rh_ver', rota: '#/rh/treinamentos', corpo: [
    'Em *Treinamentos → Matrizes* escolha a matriz (Produção, Suporte, Procedimentos SGQ, Versatilidade de cada setor). Cada quadrado é o nível da pessoa naquele item, com as cores da legenda.',
    { passos: ['Toque no quadrado.', 'Escolha o nível e a data do treinamento.', 'Salve. Abra de novo para anexar o certificado.'] },
    'Coluna com validade (ex.: NR-12) avisa a reciclagem. *Plano do ano* é o calendário de treinamentos; *Metas por pessoa* é o plano de desenvolvimento (objetivo, ação, prazo).'] },
  { id: 'aso', area: 'rh', titulo: 'Exames médicos (ASO)', palavras: 'aso exame médico periódico admissional demissional pcmso vencido', perm: 'rh_ver', rota: '#/rh/seguranca', corpo: [
    'Em *EPI e exames → Exames (ASO)* aparece o último exame de cada pessoa: vermelho vencido, amarelo vence em até 60 dias, verde em dia. *Lançar exame* registra tipo, data, resultado e o próximo exame; depois dá para anexar o ASO digitalizado.'] },
  { id: 'epi', area: 'rh', titulo: 'Entrega de EPI e ficha para assinar', palavras: 'epi entrega ficha nr-6 ca luva óculos botina protetor', perm: 'rh_editar', rota: '#/rh/seguranca?f=epi', corpo: [
    'Em *EPI e exames → EPI* toque em *Entregar EPI*. Dá para pôr vários de uma vez (kit da admissão). Informe o CA e a troca em meses: o sistema avisa quando passar do prazo.',
    '*Ficha para assinar* gera o PDF da NR-6 com a declaração e as linhas de assinatura.'] },
  { id: 'advertencia', area: 'rh', titulo: 'Advertência e suspensão', palavras: 'advertência verbal escrita suspensão disciplina justa causa 482 testemunha', perm: 'rh_editar', rota: '#/rh/disciplina', corpo: [
    { passos: ['Em *Advertências* toque em *Nova medida*.', 'Escolha a pessoa: aparece o histórico dos últimos 12 meses e a próxima medida sugerida.', 'Escolha o tipo, descreva o fato (há texto modelo) e, se for suspensão, os dias.', 'Salve e toque em *Documento PDF* para imprimir (com o art. 482 da CLT).'] },
    'Se a pessoa se recusar a assinar, escolha *Recusou assinar* e informe as 2 testemunhas. A suspensão trava os dias no ponto, sem pagamento.'] },
  { id: 'organograma', area: 'rh', titulo: 'Organograma', palavras: 'organograma cargos hierarquia chefe gerente', perm: 'rh_ver', rota: '#/rh/organograma', corpo: [
    'Cadastre os cargos em *Ajustes → Cargos* dizendo a quem cada um responde, e escolha o cargo no cadastro de cada pessoa. O organograma monta sozinho; dá para filtrar por setor e gerar PDF. Também há a visão *Por chefe direto*.'] },
  { id: 'relatoriosRh', area: 'rh', titulo: 'Relatórios do RH', palavras: 'turnover absenteísmo custo quadro relatório', perm: 'rh_ver', rota: '#/rh/relatorios', corpo: [
    'Quadro de pessoas por setor e registro, entradas e saídas (turnover), absenteísmo, horas extras do ano por pessoa e custo por setor. Todos saem em PDF e Excel.'] },
  { id: 'feriados', area: 'rh', titulo: 'Feriados e regras do ponto', palavras: 'feriado jornada tolerância divisor faixa 44 horas regras', perm: 'rh_editar', rota: '#/rh/ajustes?aba=feriados', corpo: [
    'Em *RH → Ajustes → Feriados* toque em *Cadastrar feriados do ano* (nacionais, SP estado e cidade). Em *Regras do ponto* ficam as horas de cada dia, a tolerância, as faixas de hora extra e o divisor.'] },
  { id: 'processos', area: 'rh', titulo: 'Processos trabalhistas', palavras: 'processo trabalhista justiça advogado ação', perm: 'rh_sensivel', rota: '#/rh/processos', corpo: [
    'Em *RH → Processos* ficam os processos (a aba “PROCESSOS” da planilha): autor, número, data, advogado, situação e valor. Dá para anexar os documentos. Só RH, Escritório e Dono veem.'] },
  { id: 'importarRh', area: 'admin', titulo: 'Importar as planilhas do RH', palavras: 'importar planilha rh excel carga', perm: 'importar', rota: '#/admin?aba=importar', corpo: [
    { passos: ['Em *Administração → Importar planilha*, na parte *Importar as planilhas do RH*, toque em *Escolher o arquivo da carga*.', 'Escolha *JAF - carga do RH.json* (pasta “Sobre JAF”).', 'Confira o resumo e os pontos para conferir.', 'Toque em *Importar agora*.'] },
    'Depois de importar, corrija no cadastro o que aparecer em “pontos para conferir” (datas e CPF digitados errados na planilha).'] },
  { id: 'perfilRh', area: 'rh', titulo: 'Quem vê o RH', palavras: 'acesso perfil rh gerente lgpd salário confidencial', perm: 'rh_ver', corpo: [
    '*RH*, *Escritório* e *Dono* veem e mudam tudo do RH. O *Gerente de fábrica* só consulta (sem salário, documentos, conta bancária e CID). Os outros perfis veem só nome e função. A regra está no banco de dados.'] },
  // ---------------- financeiro
  { id: 'parcelar', area: 'financeiro', titulo: 'Conta parcelada ou que repete todo mês', palavras: 'parcela parcelado repetir fixa aluguel boleto', perm: 'financeiro', corpo: [
    '*Nova conta* → valor total e 1º vencimento → em “Repetir / parcelar” escolha o número de vezes. Conta fixa (aluguel): “Todo mês”.'] },
  { id: 'fluxo', area: 'financeiro', titulo: 'O que é o fluxo de caixa', palavras: 'fluxo caixa saldo previsão', perm: 'financeiro', rota: '#/financeiro/fluxo', corpo: [
    'Mostra mês a mês o que entrou, saiu e vai entrar/sair. Informe o saldo uma vez (*Informar saldo*) e o sistema calcula quanto vai ter em 7, 30 e 90 dias.'] },
  // ---------------- sistema
  { id: 'acessos', area: 'admin', titulo: 'Criar o acesso de alguém', palavras: 'acesso login senha usuário criar perfil', perm: 'acessos', rota: '#/admin', corpo: [
    'Em *Administração → Acessos → Novo acesso*: nome, usuário, senha provisória e o perfil (Dono, Escritório, Almoxarifado, Produção, RH ou Gerente de fábrica). Na primeira entrada a pessoa cria a própria senha.'] },
  { id: 'copia', area: 'admin', titulo: 'Cópia de segurança dos dados', palavras: 'backup cópia segurança baixar', perm: 'config', rota: '#/admin?aba=copia', corpo: [
    '*Administração → Cópia dos dados* → *Baixar cópia completa*. Faça uma vez por semana e guarde no Drive.'] },
  { id: 'internet', area: 'ajuda', titulo: 'Ficou sem internet. Perco alguma coisa?', palavras: 'internet offline sem rede', perm: 'todos', corpo: [
    'Sem internet dá para consultar o que já estava carregado, mas *nada é salvo* — o sistema avisa na hora. Quando a internet voltar, é só tocar de novo. Mesmo tocando duas vezes, nada é lançado em dobro.'] },
  { id: 'instalar', area: 'ajuda', titulo: 'Usar como aplicativo no celular', palavras: 'instalar aplicativo celular tela inicial ícone', perm: 'todos', rota: '#/conta', corpo: [
    'Veja em *Minha conta → Usar como aplicativo* (toque no seu nome, no menu).'] },
  { id: 'quemVe', area: 'ajuda', titulo: 'Quem vê o quê', palavras: 'perfil permissão acesso quem vê dono escritório', perm: 'todos', corpo: [
    '*Dono*: tudo. *Escritório*: tudo do dia a dia, sem criar acessos. *Almoxarifado*: estoque, compras, máquinas e produção. *Produção*: retirar peça, estoque (sem preços), ordens e chamados. *RH*: só o RH. *Gerente de fábrica*: fábrica + consulta do RH sem dados pessoais.'] },
]

// ------------------------------------------------------------------ texto com *negrito* e destaque da busca
function marcar(t: string, termo: string): ReactNode {
  const ps = U.sem(termo).split(' ').filter(p => p.length > 2)
  if (!ps.length) return t
  const s = U.sem(t), r: ReactNode[] = []
  let i = 0, k = 0
  while (i < t.length) {
    let ach = -1, tam = 0
    for (const p of ps) { const j = s.indexOf(p, i); if (j >= 0 && (ach < 0 || j < ach)) { ach = j; tam = p.length } }
    if (ach < 0) { r.push(t.slice(i)); break }
    if (ach > i) r.push(t.slice(i, ach))
    r.push(<mark key={k++}>{t.slice(ach, ach + tam)}</mark>); i = ach + tam
  }
  return r
}
function Rico({ t, q }: { t: string; q: string }) {
  return <>{t.split('*').map((x, i) => i % 2 ? <b key={i}>{marcar(x, q)}</b> : <Fragment key={i}>{marcar(x, q)}</Fragment>)}</>
}
const textoDe = (a: Artigo) => a.corpo.map(b => typeof b === 'string' ? b : b.passos.join(' ')).join(' ').replace(/\*/g, '')

// ------------------------------------------------------------------ tela
export function TelaAjuda({ r }: { r: Rota }) {
  const [q, setQ] = useState(r.q.get('q') || '')
  const [area, setArea] = useState('')
  useEffect(() => { setQ(r.q.get('q') || '') }, [r.hash, r.q])
  const areas = areasVisiveis()
  const meus = ARTIGOS.filter(a => Perm.pode(a.perm))
  const nomeArea = (id: string) => areas.find(x => x.id === id)?.rot || 'Geral'
  let l = area ? meus.filter(a => a.area === area) : meus
  if (q.trim()) l = U.buscar(l, q, a => [a.titulo, nomeArea(a.area), a.palavras, textoDe(a)])
  const chips = [{ v: '', t: 'Tudo', n: meus.length }, ...areas.filter(x => meus.some(a => a.area === x.id)).map(x => ({ v: x.id, t: x.rot, n: meus.filter(a => a.area === x.id).length }))]
  return <>
    <Cab titulo="Ajuda" sub="Digite o que quer fazer. Ex.: férias, retirar peça, ponto, advertência.">
      <Btn txt="Manual em PDF" icone="baixar" data-a="manual" onClick={() => manualPdf()} />
      <Btn txt="Boas-vindas" icone="ajuda" data-a="tour" onClick={() => boasVindas()} />
    </Cab>
    <div className="ajuda-busca"><Ic n="busca" /><input type="search" id="buscaAjuda" placeholder="O que você quer fazer?" value={q} autoComplete="off" onChange={(e) => setQ(e.target.value)} aria-label="Buscar na ajuda" /></div>
    <Chips atual={area} aoEscolher={setArea} nome="aa" opcoes={chips} />
    {!q.trim() && !area && <section className="card mt"><h2>Começo rápido</h2><div className="mt"><PassosPerfil /></div></section>}
    <div className="mt" id="artigos">{l.length ? l.map((a, i) => <details key={a.id} className="artigo" data-artigo={a.id} open={!!q.trim() && i === 0}>
      <summary><Ic n="ajuda" /><span>{marcar(a.titulo, q)}<small>{nomeArea(a.area)}</small></span><Ic n="seta" /></summary>
      <div className="artigo-corpo">{a.corpo.map((b, n) => typeof b === 'string' ? <p key={n}><Rico t={b} q={q} /></p>
        : <ol key={n} className="passos">{b.passos.map((p, m) => <li key={m}><span><Rico t={p} q={q} /></span></li>)}</ol>)}
        {(a.rota || a.tour) && <div className="grupo-btn">{a.tour && <button type="button" className="btn pri mini" data-mostrar={a.id} onClick={() => mostrar(a.tour!)}><Ic n="olho" /><span>Me mostre na tela</span></button>}
          {a.rota && <a className="btn sec mini" href={a.rota}><Ic n="seta" /><span>Abrir a tela</span></a>}</div>}</div></details>)
      : <Vazio icone="busca" titulo="Nada encontrado" texto={`Não achei nada com “${q}”. Tente outra palavra (ex.: férias, ponto, peça, pedido).`} />}</div>
    <p className="sub mt2">Não achou? Fale com quem cuida do sistema e conte o que estava tentando fazer e em que tela.</p>
  </>
}

function PassosPerfil() {
  const L: Record<string, ReactNode[]> = {
    producao: [<>Para pegar uma peça: <b>Retirar</b> (botão do meio).</>, <>Suas ordens aparecem no <b>Início</b>; toque nelas para atualizar.</>, <>Máquina parou? <b>Máquina com problema</b>.</>],
    almoxarife: [<>Peça saiu: <b>Retirar</b>. Peça chegou: abra o pedido e <b>Receber</b>.</>, <>Todo dia, olhe o <b>Início</b>: o que está faltando e o que vai chegar.</>, <>Para comprar: <b>Compras → O que comprar → Gerar pedido</b>.</>],
    escritorio: [<>O <b>Início</b> mostra o que precisa de atenção (contas vencendo, pedidos atrasados…).</>, <>Contas: <b>Financeiro</b>. Pessoas, ponto e férias: <b>RH</b>.</>, <>Toda semana: <a href="#/admin?aba=copia">baixar a cópia dos dados</a>.</>],
    dono: [<>O <b>Início</b> resume o que precisa de atenção — e dá para <b>Personalizar</b>.</>, <>Crie os acessos da equipe em <a href="#/admin">Administração → Acessos</a> (há perfil <b>RH</b> e <b>Gerente de fábrica</b>).</>, <>Veja <a href="#/relatorios">Relatórios</a>, o <a href="#/financeiro/fluxo">Fluxo de caixa</a> e os <a href="#/rh/relatorios">Relatórios do RH</a>.</>],
    rh: [<><b>Pessoas</b>: cadastro e ficha completa de cada um (toque no nome).</>, <><b>Ponto</b>: lance as horas extras e faltas do mês e exporte para a contabilidade.</>, <><b>Férias</b>: quem está vencendo e o aviso de férias em PDF. O sininho avisa o resto (exames, treinamentos, experiência).</>],
    gerente: [<>Para pegar uma peça: <b>Retirar</b>. Ordens e máquinas em <b>Fábrica</b>.</>, <>Na <b>Equipe</b> você consulta quem está de férias, afastado, os treinamentos e o ponto da sua turma.</>, <>Dúvida? Digite aqui em cima o que quer fazer.</>],
  }
  return <ol className="passos">{(L[API.sessao?.perfil || ''] || []).map((x, n) => <li key={n}><span>{x}</span></li>)}</ol>
}

export function boasVindas(): void {
  void modal({
    titulo: 'Bem-vindo ao sistema da JAF Metal',
    corpo: <><p>Olá, <b>{(API.sessao?.nome || '').split(' ')[0]}</b>! Este é o jeito novo de cuidar {API.sessao?.perfil === 'rh' ? 'do RH: pessoas, ponto, férias, treinamentos, exames e advertências' : 'do almoxarifado, das compras, da produção' + (Perm.pode('rh_ver') ? ', do RH' : '') + (Perm.pode('financeiro') ? ' e do financeiro' : '')} — no lugar das planilhas.</p>
      <PassosPerfil /><p className="sub mt">A qualquer hora: <b>Ajuda</b> no menu — digite o que quer fazer.</p></>,
    fecharTxt: 'Começar',
  }).then(() => App.gravarPref('boasVindas', true))
}

// ------------------------------------------------------------------ "Me mostre na tela": destaca o botão e explica
let tourAtivo: (() => void) | null = null
export function mostrar(passos: Passo[], i = 0): void {
  tourAtivo?.()
  fecharTodas()
  const p = passos[i]
  if (!p) return
  if (p.rota && location.hash !== p.rota) location.hash = p.rota
  document.body.classList.remove('menu-aberto')
  let tent = 0
  const achar = () => p.alvo.split(',').map(s => document.querySelector<HTMLElement>(s.trim())).find(el => el && el.offsetParent !== null && el.getBoundingClientRect().width > 0) || null
  const montar = () => {
    const el = achar()
    if (!el && tent++ < 25) { setTimeout(montar, 80); return }
    const luz = document.createElement('div'); luz.className = 'tour-luz'
    const balao = document.createElement('div'); balao.className = 'tour-balao'; balao.setAttribute('role', 'dialog')
    const txt = document.createElement('p'); txt.textContent = el ? p.texto : p.texto + ' (Abra o menu se não estiver vendo.)'
    const pe = document.createElement('div'); pe.className = 'tour-pe'
    const cont = document.createElement('small'); cont.textContent = `${i + 1} de ${passos.length}`
    const bts = document.createElement('div'); bts.className = 'grupo-btn'
    const fim = () => { luz.remove(); balao.remove(); window.removeEventListener('resize', pos); window.removeEventListener('scroll', pos, true); document.removeEventListener('keydown', tecla); tourAtivo = null }
    const bt = (t: string, cls: string, fn: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn mini ' + cls; b.textContent = t; b.onclick = fn; bts.appendChild(b) }
    if (i > 0) bt('Voltar', 'fantasma', () => { fim(); mostrar(passos, i - 1) })
    bt(i < passos.length - 1 ? 'Próximo' : 'Entendi', 'pri', () => { fim(); if (i < passos.length - 1) mostrar(passos, i + 1) })
    pe.append(cont, bts); balao.append(txt, pe)
    document.body.append(luz, balao)
    const pos = () => {
      const r = el?.getBoundingClientRect()
      if (!r) { luz.style.display = 'none'; balao.style.left = '50%'; balao.style.top = '40%'; balao.style.transform = 'translate(-50%, -50%)'; return }
      Object.assign(luz.style, { left: r.left - 6 + 'px', top: r.top - 6 + 'px', width: r.width + 12 + 'px', height: r.height + 12 + 'px' })
      const bw = Math.min(340, innerWidth - 24), abaixo = r.bottom + 14 + 150 < innerHeight
      balao.style.left = Math.max(12, Math.min(innerWidth - bw - 12, r.left + r.width / 2 - bw / 2)) + 'px'
      balao.style.top = (abaixo ? r.bottom + 14 : Math.max(12, r.top - 14 - balao.offsetHeight)) + 'px'
    }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') fim() }
    el?.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
    pos(); requestAnimationFrame(pos)
    window.addEventListener('resize', pos); window.addEventListener('scroll', pos, true); document.addEventListener('keydown', tecla)
    tourAtivo = fim
  }
  setTimeout(montar, p.rota ? 150 : 0)
}

// ------------------------------------------------------------------ manual em PDF (só o que o perfil usa)
async function manualPdf() {
  const areas = areasVisiveis()
  const meus = ARTIGOS.filter(a => Perm.pode(a.perm))
  const blob = await pdfDocumento('Manual do sistema', `JAF Metal · perfil ${Perm.nome(API.sessao!.perfil)} · ${U.data(U.hoje())}`, (c) => {
    let y = c.y + 2
    for (const ar of [...areas.map(x => ({ id: x.id, rot: x.rot })), { id: 'ajuda', rot: 'Geral' }]) {
      const l = meus.filter(a => a.area === ar.id)
      if (!l.length) continue
      if (y > c.H - 40) { c.doc.addPage(); y = 20 }
      y = c.texto(ar.rot.toUpperCase(), y + 2, { tam: 12, negrito: true, cor: 40 }) + 1
      for (const a of l) {
        if (y > c.H - 30) { c.doc.addPage(); y = 20 }
        y = c.texto(a.titulo, y + 1, { tam: 10.5, negrito: true })
        for (const b of a.corpo) {
          if (typeof b === 'string') y = c.texto(b.replace(/\*/g, ''), y, { tam: 9.5 })
          else b.passos.forEach((p, n) => { y = c.texto(`${n + 1}. ${p.replace(/\*/g, '')}`, y, { tam: 9.5, x: 18, largura: c.W - 32 }) })
        }
        y += 2
      }
    }
  })
  await entregar(blob, 'Manual JAF Metal.pdf')
}
