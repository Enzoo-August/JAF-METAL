/* JAF Metal — conversa com o banco.
 * Dois modos com o MESMO banco (schema.sql):
 *  - nuvem: Supabase de verdade (config.js com url e chave)
 *  - teste: Postgres rodando dentro do navegador (PGlite), com dados inventados.
 * Gravação: só por funções do banco (API.rpc). Leitura: API.ler(tabela).
 */
'use strict';

const API = (() => {
  const CFG = window.JAF_CONFIG || {};
  const PGLITE = 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.8/dist/';
  const DOMINIO = '@jafmetal.local';
  const params = new URLSearchParams(location.search);

  // modo teste (dados inventados) só existe no computador de desenvolvimento, nunca no endereço publicado
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const A = {
    modo: (local && (params.get('modo') === 'teste' || !CFG.url || !CFG.chave)) ? 'teste' : 'nuvem',
    sessao: null,       // { uid, login, nome, perfil, funcionario_id }
    online: navigator.onLine,
  };
  let sb = null;        // cliente Supabase
  let pg = null;        // PGlite (modo teste)

  // ------------------------------------------------------------------ erros
  class ErroApp extends Error { constructor(msg, extra = {}) { super(msg); Object.assign(this, extra); } }
  A.ErroApp = ErroApp;

  function traduzir(e) {
    if (e instanceof ErroApp) return e;
    const msg = String(e?.message || e || 'Erro desconhecido');
    const code = e?.code || '';
    if (/Failed to fetch|NetworkError|Load failed|network|ERR_INTERNET|fetch failed/i.test(msg))
      return new ErroApp('Sem conexão com o servidor. Confira a internet e tente de novo.', { rede: true });
    if (/JWT expired|invalid JWT|jwt|not authenticated|401/i.test(msg) || code === 'PGRST301')
      return new ErroApp('Sua sessão expirou. Entre de novo.', { sessao: true });
    if (/Invalid login credentials/i.test(msg)) return new ErroApp('Usuário ou senha incorretos.');
    if (/Email not confirmed/i.test(msg)) return new ErroApp('Acesso ainda não liberado. Fale com o responsável.');
    if (/rate limit|too many/i.test(msg)) return new ErroApp('Muitas tentativas seguidas. Espere um minuto e tente de novo.');
    if (/canceling statement due to statement timeout/i.test(msg)) return new ErroApp('O servidor demorou demais para responder. Tente de novo.');
    if (code === '23505' || /duplicate key/i.test(msg)) return new ErroApp('Já existe um registro igual a esse.');
    if (code === '23503' || /foreign key/i.test(msg)) return new ErroApp('Esse registro está ligado a outro e não pode ser apagado.');
    if (code === '23514' || /violates check constraint/i.test(msg)) return new ErroApp('Algum valor não é aceito (confira números negativos ou campos obrigatórios).');
    if (code === '42501' || /permission denied/i.test(msg)) return new ErroApp('Seu perfil não pode fazer isso.');
    // mensagens das nossas funções já vêm em português
    return new ErroApp(msg.replace(/^ERROR:\s*/i, ''));
  }
  A.traduzir = traduzir;

  // ------------------------------------------------------------------ início
  A.iniciar = async () => {
    window.addEventListener('online', () => { A.online = true; document.dispatchEvent(new Event('jaf:rede')); });
    window.addEventListener('offline', () => { A.online = false; document.dispatchEvent(new Event('jaf:rede')); });
    if (A.modo === 'nuvem') {
      if (!window.supabase) throw new ErroApp('Não deu para carregar o sistema. Confira a internet e recarregue a página.');
      sb = window.supabase.createClient(CFG.url, CFG.chave, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'jaf.sessao', detectSessionInUrl: false },
      });
      sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && A.sessao) document.dispatchEvent(new Event('jaf:sessaocaiu')); });
      const { data } = await sb.auth.getSession();
      if (data?.session) await carregarPerfil(data.session.user.id).catch(() => null);
    } else {
      await iniciarTeste();
      const salvo = lerLocal('jaf.teste.sessao');
      if (salvo?.uid) await carregarPerfil(salvo.uid).catch(() => null);
    }
    return A.sessao;
  };

  function lerLocal(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function gravarLocal(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  async function carregarPerfil(uid) {
    const linhas = await lerBruto('perfis', (q) => q.eq('user_id', uid), `where user_id = '${uid}'`, uid);
    const p = linhas[0];
    if (!p || !p.ativo) { A.sessao = null; return null; }
    A.sessao = { uid, login: p.login, nome: p.nome, perfil: p.perfil, funcionario_id: p.funcionario_id, trocar_senha: !!p.trocar_senha };
    return A.sessao;
  }

  // ------------------------------------------------------------------ login
  A.entrar = async (login, senha) => {
    login = String(login || '').trim().toLowerCase();
    if (!login || !senha) throw new ErroApp('Informe usuário e senha.');
    const email = login.includes('@') ? login : login + DOMINIO;
    let uid;
    if (A.modo === 'nuvem') {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
      if (error) throw traduzir(error);
      uid = data.user.id;
    } else {
      const r = await pg.query(`select auth.entrar_teste($1, $2) as uid`, [email, senha]);
      uid = r.rows[0]?.uid;
      if (!uid) throw new ErroApp('Usuário ou senha incorretos.');
      gravarLocal('jaf.teste.sessao', { uid });
    }
    const s = await carregarPerfil(uid);
    if (!s) { await A.sair(); throw new ErroApp('Esse acesso está desativado. Fale com o Dono.'); }
    return s;
  };

  A.sair = async () => {
    A.sessao = null;
    if (A.modo === 'nuvem') { try { await sb.auth.signOut(); } catch (e) {} }
    else gravarLocal('jaf.teste.sessao', null);
  };

  // confere se a sessão do servidor ainda vale (depois de muito tempo parado)
  A.conferirSessao = async () => {
    if (A.modo !== 'nuvem') return !!A.sessao;
    const { data } = await sb.auth.getSession();
    if (!data?.session) return false;
    const exp = (data.session.expires_at || 0) * 1000;
    if (exp - Date.now() < 60000) { const r = await sb.auth.refreshSession(); return !r.error; }
    return true;
  };

  // ------------------------------------------------------------------ chamadas
  // nome: função do banco; args: { nome_do_parametro: valor }
  A.rpc = async (nome, args = {}) => {
    if (A.modo === 'nuvem') {
      if (!navigator.onLine) throw new ErroApp('Sem internet. Nada foi salvo — tente de novo quando a conexão voltar.', { rede: true });
      let { data, error } = await sb.rpc(nome, args);
      if (error && /JWT expired/i.test(error.message || '')) {
        const r = await sb.auth.refreshSession();
        if (!r.error) ({ data, error } = await sb.rpc(nome, args));
      }
      if (error) throw traduzir(error);
      return data;
    }
    const nomes = Object.keys(args);
    const sql = `select public.${nome}(${nomes.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
    const vals = nomes.map(k => { const v = args[k]; return (v !== null && typeof v === 'object') ? JSON.stringify(v) : (v === undefined ? null : v); });
    try {
      return await comoUsuario(async (tx) => (await tx.query(sql, vals)).rows[0]?.r ?? null);
    } catch (e) { throw traduzir(e); }
  };

  // lê uma tabela inteira (ou só o que mudou). Sem limite de 1000 linhas.
  A.ler = async (tabela, opt = {}) => {
    try {
      return await lerBruto(tabela, (q) => {
        if (opt.desde && opt.campo) q = q.gt(opt.campo, opt.desde);
        return q;
      }, opt.desde && opt.campo ? `where ${opt.campo} > '${String(opt.desde).replace(/'/g, "''")}'` : '', undefined, opt.ordem);
    } catch (e) { throw traduzir(e); }
  };

  // as N linhas mais recentes (pelo id) — usado no histórico de alterações
  A.ultimos = async (tabela, n) => {
    try {
      if (A.modo === 'nuvem') {
        const { data, error } = await sb.from(tabela).select('*').order('id', { ascending: false }).limit(n);
        if (error) throw error;
        return normalizar(data);
      }
      return await comoUsuario(async (tx) => normalizar((await tx.query(`select * from public.${tabela} order by id desc limit ${Number(n) | 0}`)).rows));
    } catch (e) { throw traduzir(e); }
  };

  A.chamarTabela = async (fn) => { // funções que devolvem tabela (ex.: nomes_usuarios)
    if (A.modo === 'nuvem') {
      const { data, error } = await sb.rpc(fn);
      if (error) throw traduzir(error);
      return data || [];
    }
    return comoUsuario(async (tx) => (await tx.query(`select * from public.${fn}()`)).rows);
  };

  async function lerBruto(tabela, filtrar, whereSql, uidForcado, ordem) {
    const ord = ordem || (tabela === 'movimentos' ? 'seq' : tabela === 'historico' ? 'id' : (tabela === 'perfis' ? 'criado_em' : (tabela === 'config' ? 'chave' : (tabela === 'funcionarios_privado' ? 'funcionario_id' : 'id'))));
    if (A.modo === 'nuvem') {
      const todos = [];
      const passo = 1000;
      for (let de = 0; ; de += passo) {
        let q = sb.from(tabela).select('*').order(ord, { ascending: true }).range(de, de + passo - 1);
        q = filtrar ? filtrar(q) : q;
        const { data, error } = await q;
        if (error) throw error;
        todos.push(...data);
        if (data.length < passo) break;
      }
      return normalizar(todos);
    }
    return comoUsuario(async (tx) => normalizar((await tx.query(`select * from public.${tabela} ${whereSql || ''} order by ${ord}`)).rows), uidForcado);
  }

  // números do banco chegam como texto em alguns casos: converte; datas viram 'AAAA-MM-DD'
  function normalizar(linhas) {
    for (const l of linhas) {
      for (const k in l) {
        const v = l[k];
        if (v instanceof Date) l[k] = HORARIOS.has(k) ? v.toISOString() : U.iso(new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
        else if (typeof v === 'string' && NUMERICOS.has(k) && v !== '') l[k] = Number(v);
        else if (typeof v === 'bigint') l[k] = Number(v);
      }
    }
    return linhas;
  }
  const HORARIOS = new Set(['criado_em', 'atualizado_em', 'iniciada_em', 'pronta_em', 'em', 'last_sign_in_at']); // o resto é data (AAAA-MM-DD)
  const NUMERICOS = new Set(['est_min', 'est_max', 'estoque', 'qtd', 'preco_unit', 'valor', 'recebido', 'frete', 'custo_servico', 'horas_parada',
    'produzido', 'valor_pago', 'salario', 'seq', 'numero', 'ano', 'preventiva_dias', 'prioridade', 'ordem', 'resta']);

  // ------------------------------------------------------------------ modo teste (PGlite)
  async function iniciarTeste() {
    const { PGlite } = await import(PGLITE + 'index.js');
    const { pgcrypto } = await import(PGLITE + 'contrib/pgcrypto.js');
    const nomeBanco = params.get('banco') === 'memoria' ? undefined : 'idb://jaf-teste';
    pg = await PGlite.create(nomeBanco, { extensions: { pgcrypto } });
    A._pg = pg;
    const [auth, schema] = await Promise.all([
      fetch('supabase/auth-simulado.sql', { cache: 'no-store' }).then(r => r.text()),
      fetch('supabase/schema.sql', { cache: 'no-store' }).then(r => r.text()),
    ]);
    const marca = schema.length + ':' + hash(schema);
    const jaTem = (await pg.query(`select to_regclass('public.pecas') is not null as ok`)).rows[0].ok;
    if (!jaTem || lerLocal('jaf.teste.schema') !== marca) {
      await pg.exec(auth);
      await pg.exec(schema);
      gravarLocal('jaf.teste.schema', marca);
    }
    if (!jaTem) A.precisaDemo = true;
  }
  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

  async function comoUsuario(fn, uidForcado) {
    const uid = uidForcado || A.sessao?.uid || '';
    return pg.transaction(async (tx) => {
      if (uid) {
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
        await tx.exec('set local role authenticated');
      } else {
        await tx.query(`select set_config('request.jwt.claims', '', true)`);
        await tx.exec('set local role anon');
      }
      return fn(tx);
    });
  }

  // apaga o banco de teste (recomeçar a demonstração)
  A.zerarTeste = async () => {
    if (A.modo !== 'teste') return;
    gravarLocal('jaf.teste.sessao', null); gravarLocal('jaf.teste.schema', null);
    try { await pg.close(); } catch (e) {}
    await new Promise((ok) => { const r = indexedDB.deleteDatabase('/pglite/jaf-teste'); r.onsuccess = r.onerror = r.onblocked = () => ok(); });
  };

  return A;
})();
