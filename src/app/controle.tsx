/* JAF Metal — o que o aplicativo está mostrando (carregando, login, troca de senha, sistema) e as ações gerais */
import { VERSAO } from '../config.ts'
import { API, ErroApp, traduzir } from '../lib/api.ts'
import { S } from '../lib/dados.ts'
import type { NomeTabela } from '../lib/tipos.ts'
import { gravarLocal, lerLocal } from '../lib/util.ts'
import { aviso, erro } from '../ui/avisos.ts'
import { Campo } from '../ui/base.tsx'
import { esquecerLembrados } from '../ui/ganchos.ts'
import { boasVindas } from '../telas/Ajuda.tsx'
import { fecharTodas, janelaAberta, lerForm, modal } from '../ui/janelas.tsx'

export type Fase =
  | { t: 'carregando'; msg: string }
  | { t: 'erro'; msg: string; sair?: boolean }
  | { t: 'login'; msg: string; primeiro: boolean }
  | { t: 'trocar' }
  | { t: 'sistema'; n: number }

let fase: Fase = { t: 'carregando', msg: 'Carregando…' }
let nSistema = 0
const ouvintes = new Set<() => void>()
const mudar = (f: Fase) => { fase = f; for (const o of ouvintes) o() }

interface PedidoInstalar extends Event { prompt(): Promise<void> }

export const App = {
  versao: VERSAO,
  pedidoInstalar: null as PedidoInstalar | null,
  fase: () => fase,
  ouvir(f: () => void) { ouvintes.add(f); return () => { ouvintes.delete(f) } },

  // ------------------------------------------------------------------ tema
  aplicarTema(): void {
    let t = 'auto'; try { t = localStorage.getItem('jaf.tema') || 'auto' } catch { /* modo privado */ }
    const escuro = t === 'escuro' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.tema = escuro ? 'escuro' : 'claro'
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', escuro ? '#0f1621' : '#1c2a3d')
  },

  // ------------------------------------------------------------------ início
  async iniciar(): Promise<void> {
    App.aplicarTema()
    mudar({ t: 'carregando', msg: API.modo === 'teste' ? 'Preparando o modo teste…' : 'Carregando…' })
    try {
      await API.iniciar()
      if ((import.meta.env.DEV || import.meta.env.MODE === 'teste') && API.modo === 'teste' && API.precisaDemo) {
        const { criarDemo } = await import('../lib/demo.ts')
        await criarDemo()
      }
    } catch (e) {
      console.error(e)
      mudar({ t: 'erro', msg: traduzir(e).message })
      return
    }
    if (API.sessao) await App.entrarNoSistema()
    else await App.telaLogin()
  },

  async telaLogin(msg = ''): Promise<void> {
    let primeiro = false
    try { primeiro = !(await API.rpc<boolean>('ha_dono')) } catch { /* sem rede (ou o primeiro acesso já foi fechado): mostra o login normal */ }
    mudar({ t: 'login', msg, primeiro })
  },

  // senha provisória (criada pelo Dono): só entra depois de criar a própria senha
  async entrarNoSistema(): Promise<void> {
    fecharTodas()
    if (API.sessao?.trocar_senha) { mudar({ t: 'trocar' }); return }
    mudar({ t: 'carregando', msg: 'Carregando os dados…' })
    try { await S.carregar() }
    catch (e) {
      const err = traduzir(e)
      if (err.sessao) { await API.sair(); await App.telaLogin('Sua sessão expirou. Entre de novo.'); return }
      mudar({ t: 'erro', msg: err.message, sair: true })
      return
    }
    esquecerLembrados()
    mudar({ t: 'sistema', n: ++nSistema })
    if (!App.lerPref('boasVindas')) setTimeout(() => { if (fase.t === 'sistema') boasVindas() }, 600)
  },

  async sair(): Promise<void> {
    fecharTodas()
    await API.sair()
    location.hash = ''
    await App.telaLogin()
  },

  // sessão caiu no meio do uso: pede a senha numa janela, sem perder a tela
  pedindoLogin: false,
  async sessaoCaiu(): Promise<void> {
    if (App.pedindoLogin || !API.sessao) return
    App.pedindoLogin = true
    const login = API.sessao.login
    const ok = await modal({
      titulo: 'Entre de novo',
      corpo: <><p className="sub">Sua sessão expirou (é normal depois de muito tempo parado). O que estava na tela continua aqui.</p>
        <Campo nome="login" rotulo="Usuário" valor={login} req />
        <Campo nome="senha" rotulo="Senha" tipo="password" req foco /></>,
      botoes: [{ txt: 'Entrar', acao: async (f) => { const d = lerForm(f); await API.entrar(d.login, d.senha); aviso('Pronto, pode continuar.') } }],
      fecharTxt: 'Sair do sistema',
    })
    App.pedindoLogin = false
    if (!ok) await App.sair()
  },

  // ------------------------------------------------------------------ dados
  // depois de gravar: busca o que mudou nas tabelas afetadas
  async gravou(tabelas: NomeTabela[], opt?: { inteira?: NomeTabela[] }): Promise<void> {
    try { await S.atualizar(tabelas, opt) } catch (e) { erro(e) }
  },
  // busca no servidor o que mudou (de tempos em tempos e ao voltar para o app)
  buscando: false,
  async tick(voltou?: boolean): Promise<void> {
    if (!API.sessao || App.buscando || document.visibilityState !== 'visible' || !navigator.onLine) return
    App.buscando = true
    try {
      if (voltou && Date.now() - S.ultimaBusca > 20 * 60000) {
        if (!(await API.conferirSessao())) { void App.sessaoCaiu(); return }
      }
      // recarga completa de tempos em tempos; com janela aberta, só o que mudou (nada some da frente da pessoa)
      if (Date.now() - S.carregadoEm > 15 * 60000 && !janelaAberta()) await S.carregar()
      else await S.atualizar()
    } catch (e) {
      if (traduzir(e).sessao) void App.sessaoCaiu()
    } finally { App.buscando = false }
  },
  // redesenha a tela (os campos digitados continuam)
  redesenhar(): void { mudar({ ...fase }) },

  // ------------------------------------------------------------------ preferências por pessoa neste aparelho
  lerPref<T = unknown>(k: string): T | null { return API.sessao ? lerLocal<T | null>('jaf.pref.' + API.sessao.uid + '.' + k, null) : null },
  gravarPref(k: string, v: unknown): void { if (API.sessao) gravarLocal('jaf.pref.' + API.sessao.uid + '.' + k, v) },
}

export { ErroApp }
document.addEventListener('jaf:sessaocaiu', () => { void App.sessaoCaiu() })
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', App.aplicarTema)
