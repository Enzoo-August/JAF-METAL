
-- =====================================================================
-- v3.0 — programação de entregas do cliente (release)
--   * o cliente manda um arquivo com tudo o que ainda quer receber (peça, contrato, data, quantidade)
--     e manda de novo quando muda; cada arquivo vira uma "atualização" da programação;
--   * o sistema compara com os pedidos em aberto do cliente: entrega nova entra, quantidade que mudou
--     é acertada, o que saiu do arquivo é fechado — e fica guardado o que cada atualização mudou;
--   * dá para ver antes (simular) e para desfazer a última atualização.
-- =====================================================================
create table if not exists public.vendas_releases (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid references public.clientes(id) on delete set null,
  cliente_nome  text,
  arquivo       text,
  data_ref      date,                          -- data da programação (a do arquivo)
  ate           date,                          -- entregas consideradas até esta data (vazio = todas)
  linhas        int not null default 0,        -- entregas lidas (dentro do período)
  novos         int not null default 0,
  alterados     int not null default 0,
  sairam        int not null default 0,
  iguais        int not null default 0,
  sem_cadastro  jsonb not null default '[]',   -- códigos do cliente sem produto cadastrado
  ultimas_nf    jsonb not null default '[]',   -- [{codigo, nf, data, qtd}] última nota que o cliente diz ter recebido
  layout        jsonb,                         -- como o arquivo foi lido (a próxima vez já vem pronta)
  desfeito_em   timestamptz,
  desfeito_por  text,
  criado_por    uuid default auth.uid(),
  criado_nome   text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists vendas_releases_cliente on public.vendas_releases (cliente_id, criado_em desc);

-- o que cada atualização mudou (para mostrar e para desfazer)
create table if not exists public.vendas_release_itens (
  id              uuid primary key default gen_random_uuid(),
  release_id      uuid not null references public.vendas_releases(id) on delete cascade,
  venda_id        uuid references public.vendas(id) on delete set null,
  tipo            text not null check (tipo in ('novo','alterado','saiu')),
  codigo          text,
  codigo_cliente  text,
  descricao       text,
  pedido          text,
  prazo           date,
  saldo_antes     numeric(14,3),
  saldo_depois    numeric(14,3),
  qtd_antes       numeric(14,3),
  cancelado_antes boolean,
  obs_antes       text
);
create index if not exists vendas_release_itens_release on public.vendas_release_itens (release_id);
create index if not exists vendas_release_itens_venda on public.vendas_release_itens (venda_id);

-- no pedido: a última atualização que mexeu nele e quanto era o saldo antes (vazio = entrou novo)
alter table public.vendas add column if not exists release_id uuid references public.vendas_releases(id) on delete set null;
alter table public.vendas add column if not exists release_de numeric(14,3);
create index if not exists vendas_cliente on public.vendas (cliente_id);
create index if not exists produtos_cod_cliente on public.produtos (lower(codigo_cliente));

drop trigger if exists tg_atualizado on public.vendas_releases;
create trigger tg_atualizado before update on public.vendas_releases for each row execute function public.tg_atualizado();
alter table public.vendas_releases enable row level security;
alter table public.vendas_release_itens enable row level security;
revoke all on public.vendas_releases, public.vendas_release_itens from anon, authenticated;
grant select on public.vendas_releases, public.vendas_release_itens to authenticated;
drop policy if exists ler on public.vendas_releases;
create policy ler on public.vendas_releases for select to authenticated using (public.eh('dono','escritorio','pcp','gerente','comercial'));
drop policy if exists ler on public.vendas_release_itens;
create policy ler on public.vendas_release_itens for select to authenticated using (public.eh('dono','escritorio','pcp','gerente','comercial'));

-- a "chave" de uma entrega: a peça (ou o código do cliente, se não tem cadastro) + o pedido/contrato + a data
create or replace function public._chave_venda(p_prod uuid, p_cod text, p_pedido text, p_prazo date) returns text
language sql immutable set search_path = public as $$
  select coalesce(p_prod::text, lower(public.nz(p_cod)), '?') || '|' || lower(coalesce(public.nz(p_pedido), '')) || '|' || coalesce(p_prazo::text, '') $$;

-- ---------------------------------------------------------------------
-- p: {id, cliente_id, arquivo, data_ref, ate, simular, qtd_saldo, manter:[venda_id], layout, ultimas_nf,
--     linhas:[{codigo, pedido, prazo, qtd, descricao}]}
--   qtd_saldo (padrão sim): a quantidade do arquivo é o que FALTA entregar; não = é o total do pedido
--   manter: pedidos que saíram do arquivo mas devem continuar em aberto
--   simular: só devolve o que mudaria, sem gravar
-- ---------------------------------------------------------------------
create or replace function public.importar_release(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cli uuid := public.uid_de(p, 'cliente_id'); c public.clientes;
  v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid());
  v_ate date := public.dt(p, 'ate'); v_ref date := public.dt(p, 'data_ref', public.hoje());
  v_sim boolean := coalesce((p->>'simular')::boolean, false);
  v_saldo boolean := coalesce((p->>'qtd_saldo')::boolean, true);
  v_manter jsonb := case when jsonb_typeof(p->'manter') = 'array' then p->'manter' else '[]'::jsonb end;
  l record; w public.vendas; ex public.vendas_releases;
  v_arq jsonb; v_idx jsonb; v_cmp jsonb; v_ruim text; v_dif numeric; v_corte numeric; v_sw numeric; v_novo numeric; v_fica boolean;
  r_novos jsonb := '[]'; r_alt jsonb := '[]'; r_sai jsonb := '[]'; v_sem jsonb := '[]';
  n_linhas int := 0; n_fora int := 0; n_iguais int := 0; n_fechados int := 0;
begin
  perform public.exigir('dono','escritorio','pcp','comercial');
  if jsonb_typeof(p->'linhas') is distinct from 'array' or jsonb_array_length(p->'linhas') = 0 then raise exception 'O arquivo não tem nenhuma entrega para ler'; end if;
  if jsonb_array_length(p->'linhas') > 30000 then raise exception 'Arquivo grande demais (mais de 30 mil linhas)'; end if;
  select * into c from public.clientes where id = v_cli;
  if c.id is null then raise exception 'Escolha o cliente da programação'; end if;
  perform pg_advisory_xact_lock(4247);
  if not v_sim then
    select * into ex from public.vendas_releases where id = v_id;       -- o mesmo envio de novo (toque duplo, internet caiu): não repete
    if ex.id is not null then
      return jsonb_build_object('id', ex.id, 'simulado', false, 'repetido', true, 'linhas', ex.linhas, 'iguais', ex.iguais,
                                'n_novos', ex.novos, 'n_alterados', ex.alterados, 'n_sairam', ex.sairam, 'sem_cadastro', ex.sem_cadastro);
    end if;
  end if;

  -- 1) as entregas do arquivo, somadas por peça + pedido + data, já com o produto do cadastro
  with bruto as (
    select lower(public.nz(x->>'codigo')) as cod, left(public.nz(x->>'codigo'), 80) as cod_txt, left(coalesce(public.nz(x->>'pedido'), ''), 60) as ped,
           public.dt(x, 'prazo') as prazo, public.num(x, 'qtd') as q, left(public.nz(x->>'descricao'), 200) as descr
      from jsonb_array_elements(p->'linhas') x),
  cods as (select distinct cod from bruto where cod is not null),
  res as (
    select cd.cod, (select pr2.id from public.produtos pr2
                     where pr2.classe = 'peca' and (lower(pr2.codigo_cliente) = cd.cod or lower(pr2.codigo) = cd.cod)
                     order by (lower(pr2.codigo_cliente) = cd.cod) desc nulls last, (pr2.cliente_id = v_cli) desc nulls last, (pr2.situacao = 'ativo') desc, pr2.codigo
                     limit 1) as pid
      from cods cd),
  somado as (
    select r.pid, max(b.cod_txt) as cod, max(b.ped) as ped, b.prazo, sum(b.q) as q, max(b.descr) as descr,
           bool_or(b.cod is null or b.prazo is null or b.q is null or b.q < 0) as ruim
      from bruto b left join res r on r.cod = b.cod
     group by r.pid, case when r.pid is null then b.cod end, lower(b.ped), b.prazo)
  select jsonb_agg(jsonb_build_object('ch', public._chave_venda(t.pid, t.cod, t.ped, t.prazo), 'pid', t.pid, 'cod', t.cod, 'ped', t.ped, 'prazo', t.prazo, 'q', t.q, 'descr', t.descr))
           filter (where not t.ruim and t.q > 0 and (v_ate is null or t.prazo <= v_ate)),
         count(*) filter (where not t.ruim and v_ate is not null and t.prazo > v_ate),
         min(coalesce(t.cod, '?')) filter (where t.ruim)
    into v_arq, n_fora, v_ruim
    from somado t;
  if v_ruim is not null then raise exception 'O arquivo tem linha sem código, sem data de entrega ou com quantidade inválida (%)', v_ruim; end if;
  n_linhas := coalesce(jsonb_array_length(v_arq), 0);
  if n_linhas = 0 then raise exception 'Nenhuma entrega do arquivo cai no período escolhido'; end if;
  select jsonb_object_agg(x->>'ch', true), coalesce(jsonb_agg(distinct x->'cod') filter (where x->>'pid' is null), '[]')
    into v_idx, v_sem from jsonb_array_elements(v_arq) x;

  -- 2) cada entrega do arquivo ao lado do que há em aberto no sistema (e o último preço da peça neste cliente)
  with arq as (select * from jsonb_to_recordset(v_arq) as t(ch text, pid uuid, cod text, ped text, prazo date, q numeric, descr text)),
  sis as (
    select public._chave_venda(v.produto_id, v.codigo_cliente, v.pedido, v.prazo) as ch, sum(v.entregue) as e, sum(greatest(v.qtd - v.entregue, 0)) as s,
           count(*) filter (where v.qtd > v.entregue) as n
      from public.vendas v
     where not v.cancelado and v.prazo is not null and (v.cliente_id = c.id or (v.cliente_id is null and lower(v.cliente_nome) = lower(c.nome)))
     group by 1),
  preco as (
    select distinct on (z.k) z.k, z.valor
      from (select coalesce(v.produto_id::text, lower(public.nz(v.codigo_cliente))) as k, v.valor, v.prazo, v.criado_em from public.vendas v
             where v.valor > 0 and (v.cliente_id = c.id or (v.cliente_id is null and lower(v.cliente_nome) = lower(c.nome)))) z
     order by z.k, z.prazo desc nulls last, z.criado_em desc)
  select coalesce(jsonb_agg(jsonb_build_object('ch', a.ch, 'pid', a.pid, 'cod', a.cod, 'ped', a.ped, 'prazo', a.prazo, 'descr', a.descr,
           's', coalesce(s.s, 0), 'n', coalesce(s.n, 0), 'val', coalesce(pc.valor, 0),
           'alvo', case when v_saldo then a.q else greatest(a.q - coalesce(s.e, 0), 0) end)), '[]')
    into v_cmp
    from arq a left join sis s on s.ch = a.ch left join preco pc on pc.k = coalesce(a.pid::text, lower(a.cod));

  select count(*) into n_iguais from jsonb_to_recordset(v_cmp) as t(alvo numeric, s numeric) where t.alvo = t.s and t.alvo > 0;

  -- 3) entregas novas (não havia nada em aberto para a peça + pedido + data)
  select coalesce(jsonb_agg(jsonb_build_object('venda_id', gen_random_uuid(), 'pid', t.pid, 'codigo', pr.codigo,
           'codigo_cliente', coalesce(pr.codigo_cliente, case when t.pid is null then t.cod end), 'descricao', coalesce(pr.descricao, t.descr),
           'pedido', nullif(t.ped, ''), 'prazo', t.prazo, 'de', 0, 'para', t.alvo, 'valor', t.val) order by t.prazo, t.cod, t.ped), '[]')
    into r_novos
    from jsonb_to_recordset(v_cmp) as t(pid uuid, cod text, ped text, prazo date, descr text, s numeric, n int, val numeric, alvo numeric)
    left join public.produtos pr on pr.id = t.pid
   where t.alvo <> t.s and t.n = 0;

  if not v_sim then
    perform set_config('jaf.importando', '1', true);   -- o que mudou fica em vendas_release_itens (não repete no histórico geral)
    insert into public.vendas_releases (id, cliente_id, cliente_nome, arquivo, data_ref, ate, layout, ultimas_nf, criado_nome)
    values (v_id, c.id, c.nome, left(public.nz(p->>'arquivo'), 200), v_ref, v_ate,
            case when jsonb_typeof(p->'layout') = 'object' and length((p->'layout')::text) < 4000 then p->'layout' end,
            case when jsonb_typeof(p->'ultimas_nf') = 'array' and length((p->'ultimas_nf')::text) < 400000 then p->'ultimas_nf' else '[]'::jsonb end,
            public.meu_nome());
    insert into public.vendas (id, cliente_id, cliente_nome, produto_id, codigo, codigo_cliente, descricao, pedido, prazo, qtd, valor, release_id, release_de)
    select t.venda_id, c.id, c.nome, t.pid, t.codigo, t.codigo_cliente, t.descricao, t.pedido, t.prazo, t.para, t.valor, v_id, null
      from jsonb_to_recordset(r_novos) as t(venda_id uuid, pid uuid, codigo text, codigo_cliente text, descricao text, pedido text, prazo date, para numeric, valor numeric);
    insert into public.vendas_release_itens (release_id, venda_id, tipo, codigo, codigo_cliente, descricao, pedido, prazo, saldo_antes, saldo_depois)
    select v_id, t.venda_id, 'novo', t.codigo, t.codigo_cliente, t.descricao, t.pedido, t.prazo, 0, t.para
      from jsonb_to_recordset(r_novos) as t(venda_id uuid, codigo text, codigo_cliente text, descricao text, pedido text, prazo date, para numeric);
  end if;

  -- 4) a quantidade mudou: acerta nos pedidos em aberto daquela entrega (do mais novo para o mais antigo)
  for l in select t.* from jsonb_to_recordset(v_cmp) as t(ch text, prazo date, cod text, ped text, s numeric, n int, alvo numeric)
            where t.alvo <> t.s and t.n > 0 order by t.prazo, t.cod, t.ped loop
    v_dif := l.alvo - l.s;
    for w in select v.* from public.vendas v
              where v.prazo = l.prazo and not v.cancelado and v.qtd > v.entregue and v.release_id is distinct from v_id
                and (v.cliente_id = c.id or (v.cliente_id is null and lower(v.cliente_nome) = lower(c.nome)))
                and public._chave_venda(v.produto_id, v.codigo_cliente, v.pedido, v.prazo) = l.ch
              order by v.criado_em desc, v.id loop
      exit when v_dif = 0;
      v_sw := w.qtd - w.entregue;
      if v_dif > 0 then v_novo := v_sw + v_dif; v_dif := 0;
      else v_corte := least(-v_dif, v_sw); v_novo := v_sw - v_corte; v_dif := v_dif + v_corte; end if;
      r_alt := r_alt || jsonb_build_object('venda_id', w.id, 'codigo', w.codigo, 'codigo_cliente', w.codigo_cliente, 'descricao', w.descricao, 'pedido', w.pedido,
                                           'prazo', w.prazo, 'de', v_sw, 'para', v_novo);
      if not v_sim then
        insert into public.vendas_release_itens (release_id, venda_id, tipo, codigo, codigo_cliente, descricao, pedido, prazo, saldo_antes, saldo_depois, qtd_antes, cancelado_antes, obs_antes)
        values (v_id, w.id, 'alterado', w.codigo, w.codigo_cliente, w.descricao, w.pedido, w.prazo, v_sw, v_novo, w.qtd, w.cancelado, w.obs);
        update public.vendas set qtd = case when v_novo = 0 and w.entregue = 0 then qtd else w.entregue + v_novo end,
               cancelado = (v_novo = 0 and w.entregue = 0), release_id = v_id, release_de = v_sw
         where id = w.id;
      end if;
    end loop;
  end loop;

  -- 5) o que estava em aberto e não veio no arquivo: saiu da programação
  for w in select v.* from public.vendas v
            where not v.cancelado and v.qtd > v.entregue and v.prazo is not null and (v_ate is null or v.prazo <= v_ate)
              and v.release_id is distinct from v_id
              and (v.cliente_id = c.id or (v.cliente_id is null and lower(v.cliente_nome) = lower(c.nome)))
              and not (v_idx ? public._chave_venda(v.produto_id, v.codigo_cliente, v.pedido, v.prazo))
            order by v.prazo, v.codigo loop
    v_fica := v_manter @> to_jsonb(w.id::text);
    r_sai := r_sai || jsonb_build_object('venda_id', w.id, 'codigo', w.codigo, 'codigo_cliente', w.codigo_cliente, 'descricao', w.descricao, 'pedido', w.pedido,
                                         'prazo', w.prazo, 'de', w.qtd - w.entregue, 'para', 0, 'entregue', w.entregue, 'manter', v_fica);
    if not v_sim and not v_fica then
      n_fechados := n_fechados + 1;
      insert into public.vendas_release_itens (release_id, venda_id, tipo, codigo, codigo_cliente, descricao, pedido, prazo, saldo_antes, saldo_depois, qtd_antes, cancelado_antes, obs_antes)
      values (v_id, w.id, 'saiu', w.codigo, w.codigo_cliente, w.descricao, w.pedido, w.prazo, w.qtd - w.entregue, 0, w.qtd, w.cancelado, w.obs);
      update public.vendas set qtd = case when w.entregue > 0 then w.entregue else qtd end, cancelado = (w.entregue = 0),
             obs = concat_ws(E'\n', w.obs, 'Saiu da programação do cliente em ' || to_char(v_ref, 'DD/MM/YYYY') || '.'),
             release_id = v_id, release_de = w.qtd - w.entregue
       where id = w.id;
    end if;
  end loop;

  if not v_sim then
    update public.vendas_releases set linhas = n_linhas, novos = jsonb_array_length(r_novos), alterados = jsonb_array_length(r_alt), sairam = n_fechados,
           iguais = n_iguais, sem_cadastro = v_sem where id = v_id;
    perform set_config('jaf.importando', '0', true);
  end if;
  return jsonb_build_object('id', v_id, 'simulado', v_sim, 'linhas', n_linhas, 'fora', n_fora, 'iguais', n_iguais,
                            'n_novos', jsonb_array_length(r_novos), 'n_alterados', jsonb_array_length(r_alt),
                            'n_sairam', case when v_sim then jsonb_array_length(r_sai) else n_fechados end,
                            'novos', r_novos, 'alterados', r_alt, 'sairam', r_sai, 'sem_cadastro', v_sem);
end $$;

-- desfazer a última atualização da programação de um cliente (volta as quantidades e tira o que entrou novo)
create or replace function public.desfazer_release(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.vendas_releases; i public.vendas_release_itens; n_ok int := 0; n_ficou int := 0;
begin
  perform public.exigir('dono','escritorio','pcp','comercial');
  perform pg_advisory_xact_lock(4247);
  select * into r from public.vendas_releases where id = p_id;
  if r.id is null then raise exception 'Atualização não encontrada'; end if;
  if r.desfeito_em is not null then raise exception 'Esta atualização já foi desfeita'; end if;
  if exists (select 1 from public.vendas_releases x where x.cliente_id is not distinct from r.cliente_id and x.desfeito_em is null and x.criado_em > r.criado_em) then
    raise exception 'Só dá para desfazer a última atualização deste cliente';
  end if;
  perform set_config('jaf.importando', '1', true);
  for i in select * from public.vendas_release_itens where release_id = r.id loop
    if i.tipo = 'novo' then
      -- o que entrou novo sai, a não ser que já tenha entrega ou OF
      delete from public.vendas v where v.id = i.venda_id and v.entregue = 0 and not exists (select 1 from public.ofs o where o.venda_id = v.id);
      if found then n_ok := n_ok + 1; elsif i.venda_id is not null then n_ficou := n_ficou + 1; end if;
    else
      update public.vendas v set qtd = greatest(i.qtd_antes, v.entregue), cancelado = coalesce(i.cancelado_antes, false), obs = i.obs_antes, release_id = null, release_de = null
       where v.id = i.venda_id;
      if found then n_ok := n_ok + 1; end if;
    end if;
  end loop;
  update public.vendas set release_id = null, release_de = null where release_id = r.id;
  update public.vendas_releases set desfeito_em = now(), desfeito_por = public.meu_nome() where id = r.id;
  perform set_config('jaf.importando', '0', true);
  return jsonb_build_object('desfeitos', n_ok, 'ficaram', n_ficou);
end $$;

revoke all on function public._chave_venda(uuid, text, text, date) from public, anon, authenticated;
revoke all on function public.importar_release(jsonb), public.desfazer_release(uuid) from public, anon;
grant execute on function public.importar_release(jsonb), public.desfazer_release(uuid) to authenticated;

-- funções de gatilho não são para chamar de fora (só o banco usa)
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prorettype = 'trigger'::regtype loop
    execute format('revoke all on function %s from public, anon, authenticated', f.assinatura);
  end loop;
end $$;

-- saúde do banco (para o Dono acompanhar o espaço usado e o que mais cresce)
create or replace function public.saude_banco() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir('dono');
  return jsonb_build_object(
    'bytes', pg_database_size(current_database()),
    'anexos', coalesce((select pg_total_relation_size('public.rh_anexos_conteudo'::regclass)), 0),
    'historico', (select count(*) from public.historico),
    'tabelas', (select coalesce(jsonb_agg(jsonb_build_object('nome', t.relname, 'bytes', t.b, 'linhas', t.n) order by t.b desc), '[]')
                  from (select c.relname, pg_total_relation_size(c.oid) as b, greatest(c.reltuples, 0)::bigint as n
                          from pg_class c join pg_namespace n on n.oid = c.relnamespace
                         where n.nspname = 'public' and c.relkind = 'r' order by 2 desc limit 8) t));
end $$;
revoke all on function public.saude_banco() from public, anon;
grant execute on function public.saude_banco() to authenticated;
