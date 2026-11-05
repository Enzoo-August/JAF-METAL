/* Painel do Departamento Técnico (aba "Indicadores" da planilha): quanto há em aberto e atrasado em cada controle */
import type { Rota } from '../../ui/ganchos.ts'
import { PainelControles } from './Registros.tsx'

export function TelaTecnico(_: { r: Rota }) {
  return <PainelControles area="tecnico" titulo="Engenharia" sub="Departamento técnico: desenvolvimento, alterações, qualidade e documentação" />
}
