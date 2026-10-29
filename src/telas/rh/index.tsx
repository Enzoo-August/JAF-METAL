/* RH — qual tela abrir para cada endereço #/rh/... */
import { Perm } from '../../lib/perm.ts'
import { Vazio } from '../../ui/base.tsx'
import type { Rota } from '../../ui/ganchos.ts'
import { TelaAjustesRH } from './Ajustes.tsx'
import { TelaDisciplina } from './Disciplina.tsx'
import { TelaFerias } from './Ferias.tsx'
import { TelaIndicadores } from './Indicadores.tsx'
import { TelaOrganograma } from './Organograma.tsx'
import { TelaFicha, TelaPessoas, tituloPessoa } from './Pessoas.tsx'
import { TelaPonto } from './Ponto.tsx'
import { TelaProcessos } from './Processos.tsx'
import { TelaRelatoriosRH } from './RelatoriosRH.tsx'
import { TelaSeguranca } from './Seguranca.tsx'
import { TelaTreinamentos } from './Treinamentos.tsx'

const TITULOS: Record<string, string> = { ponto: 'Ponto e horas extras', ferias: 'Férias e ausências', treinamentos: 'Treinamentos', seguranca: 'EPI e exames',
  disciplina: 'Advertências', processos: 'Processos trabalhistas', organograma: 'Organograma', relatorios: 'Relatórios do RH', indicadores: 'Indicadores de RH', ajustes: 'Ajustes do RH' }

export function TelaRH({ r }: { r: Rota }) {
  if (r.nome === 'funcionario') return <TelaFicha r={r} />
  switch (r.nome === 'rh' ? r.sub : null) {
    case 'ponto': return <TelaPonto r={r} />
    case 'ferias': return <TelaFerias r={r} />
    case 'treinamentos': return <TelaTreinamentos r={r} />
    case 'seguranca': return <TelaSeguranca r={r} />
    case 'disciplina': return <TelaDisciplina />
    case 'organograma': return <TelaOrganograma />
    case 'processos': return Perm.pode('rh_sensivel') ? <TelaProcessos /> : <Vazio icone="cadeado" titulo="Sem acesso" texto="Seu perfil não abre esta tela." />
    case 'relatorios': return <TelaRelatoriosRH />
    case 'indicadores': return Perm.pode('rh_sensivel') ? <TelaIndicadores /> : <Vazio icone="cadeado" titulo="Sem acesso" texto="Seu perfil não abre esta tela." />
    case 'ajustes': return Perm.pode('rh_editar') ? <TelaAjustesRH r={r} /> : <Vazio icone="cadeado" titulo="Sem acesso" texto="Seu perfil não abre esta tela." />
    default: return <TelaPessoas r={r} />
  }
}
export const tituloRH = (r: Rota): string => r.nome === 'funcionario' ? tituloPessoa(r) : (r.nome === 'rh' && r.sub && TITULOS[r.sub]) || (r.nome === 'equipe' ? 'Equipe' : 'Pessoas')
