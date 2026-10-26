/* Ligação com o banco (Supabase da JAF Metal).
 * A chave aqui é a "publishable" (pública por natureza): quem protege os dados são as regras do banco (RLS + funções).
 * Nunca coloque aqui a chave secreta do projeto (a que dá acesso total ao banco). */
export const CONFIG = {
  url: 'https://chsfffwivmhjrftvylbl.supabase.co',
  chave: 'sb_publishable_FRZXelaTsURBe6CMI6y1HQ_rB7dpQKp',
}

export const VERSAO = '2.1.0'
