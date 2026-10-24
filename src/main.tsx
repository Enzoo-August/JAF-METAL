/* JAF Metal Gestão — ponto de partida */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/controle.tsx'
import { Raiz } from './app/Raiz.tsx'
import { API } from './lib/api.ts'
import { C, S } from './lib/dados.ts'
import { Perm } from './lib/perm.ts'
import * as U from './lib/util.ts'
import { Telas } from './telas/index.ts'
import { aviso, erro } from './ui/avisos.ts'
import { confirmar, fecharTodas, lerForm, modal } from './ui/janelas.tsx'
import './estilo.css'

createRoot(document.getElementById('app')!).render(<StrictMode><Raiz /></StrictMode>)
void App.iniciar()

// erros não tratados: avisa sem travar
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); if (API.sessao) erro(e.reason) })
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); App.pedidoInstalar = e as typeof App.pedidoInstalar })
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {})

// modo teste: os testes automáticos usam o sistema "por dentro" (no site publicado isto nem existe)
if (import.meta.env.DEV || import.meta.env.MODE === 'teste') {
  Object.assign(window, { API, App, S, C, U, Perm, Telas, UI: { aviso, confirmar, modal, fecharTodas, lerForm } })
}
