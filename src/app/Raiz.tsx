/* Raiz do aplicativo: carregando, login, primeiro acesso, troca de senha provisória e o sistema */
import { useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { API, ErroApp, traduzir } from '../lib/api.ts'
import { Perm } from '../lib/perm.ts'
import { aviso } from '../ui/avisos.ts'
import { Campo } from '../ui/base.tsx'
import { Ic } from '../ui/icones.tsx'
import { Janelas, lerForm } from '../ui/janelas.tsx'
import { Casca } from './Casca.tsx'
import { App } from './controle.tsx'

export function Raiz() {
  const f = useSyncExternalStore(App.ouvir, App.fase)
  return <>
    {f.t === 'carregando' && <TelaCarregando msg={f.msg} />}
    {f.t === 'erro' && <div className="carregando-tela"><img src="./assets/logo.png" alt="JAF Metal" /><p className="erro-txt">{f.msg}</p>
      <div className="grupo-btn"><button type="button" className="btn pri" onClick={() => location.reload()}>Tentar de novo</button>
        {f.sair && <button type="button" className="btn fantasma" id="sairErro" onClick={() => void App.sair()}>Sair</button>}</div></div>}
    {f.t === 'login' && <Login key={f.msg + f.primeiro} msg={f.msg} primeiro={f.primeiro} />}
    {f.t === 'trocar' && <TrocarSenha />}
    {f.t === 'sistema' && <Casca key={f.n} />}
    <Janelas />
  </>
}

const TelaCarregando = ({ msg }: { msg: string }) =>
  <div className="carregando-tela"><img src="./assets/logo.png" alt="JAF Metal" /><div className="giro" /><p>{msg}</p></div>

// envio de formulário com botão ocupado e mensagem de erro embaixo
function useEnvio(fn: (d: Record<string, string>) => Promise<void>) {
  const [erro, setErro] = useState('')
  const [ocup, setOcup] = useState(false)
  const trava = useRef(false)
  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (trava.current) return
    trava.current = true; setOcup(true); setErro('')
    try { await fn(lerForm(e.currentTarget) as Record<string, string>) }
    catch (err) { setErro(traduzir(err).message) }
    finally { trava.current = false; setOcup(false) }
  }
  return { erro, ocup, enviar }
}

function Login({ msg, primeiro }: { msg: string; primeiro: boolean }) {
  const form = useRef<HTMLFormElement>(null)
  const [verSenha, setVerSenha] = useState(false)
  // no site publicado isto vira "false" na hora de montar e some do código
  const teste = (import.meta.env.DEV || import.meta.env.MODE === 'teste') && API.modo === 'teste'
  const { erro, ocup, enviar } = useEnvio(async (d) => {
    if (primeiro) {
      if (d.senha !== d.senha2) throw new ErroApp('As duas senhas não são iguais.')
      await API.rpc('primeiro_dono', { p_login: d.login, p_senha: d.senha, p_nome: d.nome })
    }
    await API.entrar(d.login, d.senha)
    await App.entrarNoSistema()
  })
  const demo = (perfil: string) => {
    const f = form.current!
    ;(f.elements.namedItem('login') as HTMLInputElement).value = ({ dono: 'dono', escritorio: 'escritorio', almoxarife: 'almox', producao: 'operador' } as Record<string, string>)[perfil]
    ;(f.elements.namedItem('senha') as HTMLInputElement).value = 'teste1234'
    f.requestSubmit()
  }
  return (
    <main className="login">
      <div className="login-caixa">
        <div className="login-marca"><img src="./assets/logo.png" alt="JAF Metal" /><span>Gestão</span></div>
        {primeiro ? <>
          <h1>Primeiro acesso</h1>
          <p className="sub">Crie o login do <b>Dono</b>. Ele cadastra depois os acessos da equipe.</p>
          <form id="fLogin" ref={form} noValidate onSubmit={enviar}>
            <Campo nome="nome" rotulo="Seu nome" req auto="name" />
            <Campo nome="login" rotulo="Usuário (para entrar)" req auto="username" ajuda="Só letras minúsculas, números, ponto ou traço. Ex.: joao.silva" attrs={{ autoCapitalize: 'none', spellCheck: false }} />
            <Campo nome="senha" rotulo="Senha" tipo="password" req auto="new-password" ajuda="Mínimo 8 caracteres. Não use a mesma senha de outros sites." />
            <Campo nome="senha2" rotulo="Repita a senha" tipo="password" req auto="new-password" />
            <p className="login-erro" role="alert" hidden={!erro}>{erro}</p>
            <button className={`btn pri grande${ocup ? ' carregando' : ''}`} disabled={ocup} type="submit"><span>Criar acesso do Dono</span></button>
          </form>
        </> : <>
          <h1>Entrar</h1>
          {msg && <p className="login-msg">{msg}</p>}
          <form id="fLogin" ref={form} noValidate onSubmit={enviar}>
            <Campo nome="login" rotulo="Usuário" req auto="username" attrs={{ autoCapitalize: 'none', spellCheck: false }} />
            <div className="campo"><label htmlFor="cSenha">Senha</label><div className="senha-caixa">
              <input id="cSenha" name="senha" type={verSenha ? 'text' : 'password'} required autoComplete="current-password" />
              <button type="button" className="icone-btn ver-senha" aria-label={verSenha ? 'Esconder senha' : 'Mostrar senha'} onClick={() => setVerSenha(!verSenha)}><Ic n="olho" /></button></div></div>
            <p className="login-erro" role="alert" hidden={!erro}>{erro}</p>
            <button className={`btn pri grande${ocup ? ' carregando' : ''}`} disabled={ocup} type="submit"><span>Entrar</span></button>
          </form>
          {teste && <div className="login-teste"><b>Modo teste</b> — dados inventados, nada vai para o banco de verdade.
            <div className="login-perfis">{(['dono', 'escritorio', 'almoxarife', 'producao'] as const).map(p =>
              <button key={p} type="button" className="btn sec" data-demo={p} onClick={() => demo(p)}>{Perm.nome(p)}</button>)}</div>
            <small>Senha de todos: <code>teste1234</code></small></div>}
        </>}
        <p className="login-rodape">{teste ? 'Modo teste' : 'Acesso protegido'} · v{App.versao}</p>
      </div>
    </main>)
}

function TrocarSenha() {
  const { erro, ocup, enviar } = useEnvio(async (d) => {
    if (d.senha.length < 8) throw new ErroApp('A senha precisa ter 8 caracteres ou mais.')
    if (d.senha !== d.senha2) throw new ErroApp('As duas senhas não são iguais.')
    if (/^(\d)\1+$|^(0123456789|123456789|12345678|87654321|senha123|password)/i.test(d.senha)) throw new ErroApp('Essa senha é fácil de adivinhar. Escolha outra.')
    await API.rpc('trocar_senha', { p_user: API.sessao!.uid, p_senha: d.senha })
    API.sessao!.trocar_senha = false
    aviso('Senha criada. Bem-vindo!')
    await App.entrarNoSistema()
  })
  return (
    <main className="login"><div className="login-caixa">
      <div className="login-marca"><img src="./assets/logo.png" alt="JAF Metal" /><span>Gestão</span></div>
      <h1>Crie a sua senha</h1>
      <p className="sub">Olá, <b>{(API.sessao?.nome || '').split(' ')[0]}</b>! Você entrou com uma senha provisória. Escolha agora a sua senha — só você vai saber.</p>
      <form id="fSenha" noValidate onSubmit={enviar}>
        <Campo nome="senha" rotulo="Nova senha" tipo="password" req auto="new-password" ajuda="Mínimo 8 caracteres. Evite datas, nomes e sequências como 12345678." />
        <Campo nome="senha2" rotulo="Repita a nova senha" tipo="password" req auto="new-password" />
        <p className="login-erro" role="alert" hidden={!erro}>{erro}</p>
        <button className={`btn pri grande${ocup ? ' carregando' : ''}`} disabled={ocup} type="submit"><span>Salvar e entrar</span></button>
      </form>
      <p className="login-rodape"><a href="#" id="sairTroca" onClick={(e) => { e.preventDefault(); void App.sair() }}>Sair</a></p>
    </div></main>)
}
