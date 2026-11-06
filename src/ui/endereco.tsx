/* Preenchimento automático de cadastro (cliente, fornecedor): o mesmo jeito do painel da Upgrade, com as lições de lá.
 *  - CNPJ: põe os pontos sozinho e, com 14 números, busca razão social e endereço na Receita (BrasilAPI). Só completa o que está vazio.
 *  - CEP: põe o traço e, com 8 números, busca rua, bairro, cidade e estado (ViaCEP; se falhar, BrasilAPI).
 *    CEP de cidade inteira (sem rua) avisa para escrever a rua; depois de achar, o cursor vai para o endereço ("falta só o número").
 *  - Telefone: (11) 91234-5678 enquanto digita.
 *  - Avisa se o CNPJ já está cadastrado; sem internet, nada trava (preenche à mão). CPF nunca é consultado. */
import { useEffect } from 'react'
import { S } from '../lib/dados.ts'
import { useJanela } from './janelas.tsx'

export const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO']
export const opcoesUF = (atual?: string | null) => [{ v: '', t: '—' }, ...UFS.map(u => ({ v: u, t: u })), ...(atual && !UFS.includes(atual) ? [{ v: atual, t: atual }] : [])]

const so = (t: string) => t.replace(/\D/g, '')
export const mascaraCNPJ = (t: string): string => {
  const d = so(t).slice(0, 14)
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2')
}
export const mascaraCEP = (t: string): string => { const d = so(t).slice(0, 8); return d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d }
export const mascaraTel = (t: string): string => {
  const d = so(t).replace(/^0+/, '').slice(0, 11)
  if (d.length < 3) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

const pegaJSON = async (url: string, ms = 7000): Promise<Record<string, unknown> | 'nao' | null> => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctl.signal })
    if (r.status === 404 || r.status === 400) return 'nao'
    if (!r.ok) return null
    return await r.json() as Record<string, unknown>
  } catch { return null } finally { clearTimeout(t) }
}
const titulo = (s: unknown) => String(s || '').toLowerCase().replace(/(^|[\s\-/(])([a-zà-ú])/g, (_m, a: string, b: string) => a + b.toUpperCase()).replace(/\b(De|Da|Do|Das|Dos|E)\b/g, (m) => m.toLowerCase())

// { rua, bairro, cidade, uf } | 'nao' (não existe) | null (não deu para consultar)
export async function buscaCEP(cep: string): Promise<{ rua: string; bairro: string; cidade: string; uf: string } | 'nao' | null> {
  const d = so(cep); if (d.length !== 8) return null
  let falhou = 0
  const a = await pegaJSON(`https://viacep.com.br/ws/${d}/json/`)
  if (a && a !== 'nao' && !a.erro && a.localidade) return { rua: String(a.logradouro || ''), bairro: String(a.bairro || ''), cidade: String(a.localidade || ''), uf: String(a.uf || '').toUpperCase() }
  if (a === null) falhou++
  const b = await pegaJSON(`https://brasilapi.com.br/api/cep/v1/${d}`)
  if (b && b !== 'nao' && b.city) return { rua: String(b.street || ''), bairro: String(b.neighborhood || ''), cidade: String(b.city || ''), uf: String(b.state || '').toUpperCase() }
  if (b === null) falhou++
  return falhou === 2 ? null : 'nao'
}
export async function buscaCNPJ(cnpj: string) {
  const d = so(cnpj); if (d.length !== 14) return null
  const j = await pegaJSON(`https://brasilapi.com.br/api/cnpj/v1/${d}`, 9000)
  if (j === null) return null
  if (j === 'nao' || !j.razao_social) return 'nao' as const
  const cep = so(String(j.cep || ''))
  return {
    razao: String(j.razao_social || ''), fantasia: titulo(j.nome_fantasia), cep: cep.length === 8 ? cep.slice(0, 5) + '-' + cep.slice(5) : '',
    endereco: [[titulo(j.descricao_tipo_de_logradouro), titulo(j.logradouro)].filter(Boolean).join(' '), j.numero && !/^s\/?n$/i.test(String(j.numero).trim()) ? String(j.numero) : '', titulo(j.complemento)].filter(Boolean).join(', '),
    bairro: titulo(j.bairro), cidade: titulo(j.municipio), uf: String(j.uf || '').toUpperCase(),
    telefone: String(j.ddd_telefone_1 || '').trim(), email: String(j.email || '').toLowerCase(),
  }
}

// linha de aviso do CEP / CNPJ (fica logo abaixo dos campos)
export const StatusEndereco = () => <small className="cep-st" data-cep-st aria-live="polite" />

// liga tudo no formulário da janela. tabela/id: para avisar CNPJ repetido
export function AutoPreencher({ tabela, id }: { tabela?: 'clientes' | 'fornecedores'; id?: string | null }) {
  const j = useJanela()
  useEffect(() => {
    const form = j.form; if (!form) return
    const campo = (n: string) => form.querySelector<HTMLInputElement | HTMLSelectElement>(`[name=${n}]`)
    const diz = (txt: string, cls = '') => { const el = form.querySelector<HTMLElement>('[data-cep-st]'); if (el) { el.textContent = txt; el.className = 'cep-st ' + cls } }
    // grava o valor (só se estiver vazio, a não ser que "trocar") e avisa o formulário
    const poe = (n: string, v: string | null | undefined, trocar = false) => {
      const el = campo(n); if (!el || !v) return
      if (!trocar && el.value.trim()) return
      if (el instanceof HTMLSelectElement && ![...el.options].some(o => o.value === v)) el.add(new Option(v, v))
      el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    let ultCep = '', ultDoc = ''
    const aoDigitar = async (e: Event) => {
      const t = e.target as HTMLInputElement
      if (!t?.name || !(t instanceof HTMLInputElement)) return
      if (/^(telefone|telefone2|celular|whatsapp)$/.test(t.name)) {
        const v = mascaraTel(t.value); if (v !== t.value && !(e as InputEvent).inputType?.startsWith('delete')) t.value = v
        return
      }
      if (t.name === 'cep') {
        const v = mascaraCEP(t.value); if (v !== t.value) t.value = v
        const d = so(v)
        if (d.length < 8) { ultCep = ''; diz(''); return }
        if (d === ultCep) return
        ultCep = d
        if (!navigator.onLine) { diz('Sem internet para buscar o CEP. Preencha o endereço à mão.', 'warn'); return }
        diz('Buscando o endereço…')
        const r = await buscaCEP(d)
        if (so(t.value) !== d) return // mudou o CEP enquanto buscava
        if (!r) { diz('Não consegui consultar o CEP agora. Preencha o endereço à mão.', 'warn'); return }
        if (r === 'nao') { diz('CEP não encontrado. Confira o número ou preencha à mão.', 'warn'); return }
        poe('uf', r.uf, true); poe('cidade', r.cidade, true); poe('bairro', r.bairro, true)
        const end = campo('endereco') as HTMLInputElement | null
        if (end && r.rua && !end.value.toLowerCase().includes(r.rua.toLowerCase())) poe('endereco', r.rua, true)
        diz(r.rua ? `${r.rua}, ${r.cidade}/${r.uf}. Falta só o número.` : `${r.cidade}/${r.uf}. Este CEP vale para a cidade toda: escreva a rua e o número.`, 'ok')
        if (end && matchMedia('(pointer: fine)').matches) { end.focus(); const n = end.value.length; try { end.setSelectionRange(n, n) } catch { /* */ } }
        return
      }
      if (t.name === 'cnpj') {
        if (!(e as InputEvent).inputType?.startsWith('delete')) { const v = mascaraCNPJ(t.value); if (v !== t.value) t.value = v }
        const d = so(t.value)
        if (d.length !== 14) { ultDoc = ''; return }
        if (d === ultDoc) return
        ultDoc = d
        if (tabela) {
          const igual = S.lista(tabela).find(x => x.id !== id && so(String((x as { cnpj?: string | null }).cnpj || '')) === d)
          if (igual) diz(`Atenção: este CNPJ já está cadastrado em “${(igual as { nome: string }).nome}”.`, 'warn')
        }
        if (!navigator.onLine) return
        const vazio = !(campo('cep')?.value.trim()) && !(campo('endereco')?.value.trim())
        if (!vazio && campo('razao')?.value.trim() && campo('nome')?.value.trim()) return
        diz('Buscando os dados do CNPJ na Receita…')
        const r = await buscaCNPJ(d)
        if (so(t.value) !== d) return
        if (!r || r === 'nao') { diz(r ? 'CNPJ não encontrado na Receita. Confira o número.' : '', r ? 'warn' : ''); return }
        const pegouRazao = !campo('razao')?.value.trim()
        poe('razao', r.razao); poe('nome', r.fantasia || r.razao)
        if (r.telefone) poe('telefone', mascaraTel(r.telefone))
        if (r.email) poe('email', r.email)
        if (vazio && r.cidade) {
          if (r.cep) { ultCep = so(r.cep); poe('cep', r.cep, true) } // não consulta o CEP de novo: o endereço já veio
          poe('uf', r.uf, true); poe('cidade', r.cidade, true); poe('bairro', r.bairro, true); poe('endereco', r.endereco, true)
          diz(`${pegouRazao ? 'Razão social e endereço preenchidos' : 'Endereço preenchido'} pelo CNPJ (cadastro da Receita). Confira antes de salvar.`, 'ok')
        } else diz(pegouRazao ? 'Razão social preenchida pelo CNPJ (cadastro da Receita).' : '', pegouRazao ? 'ok' : '')
      }
    }
    form.addEventListener('input', aoDigitar)
    return () => form.removeEventListener('input', aoDigitar)
  }, [j, tabela, id])
  return null
}
