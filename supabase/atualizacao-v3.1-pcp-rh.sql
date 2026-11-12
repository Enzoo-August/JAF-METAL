-- =====================================================================
-- v3.1 — pedidos do PCP e do RH (novembro/2026)
--   PCP
--   * estoque de peça pronta: a OF apontada soma, o conjunto produzido consome os componentes,
--     a entrega ao cliente tira; contagem (inventário) e estoque mínimo por código;
--   * baixa da entrega pela nota fiscal emitida (XML de saída): acha o cliente e os pedidos em aberto;
--   * pedido do cliente lido do PDF (ordem de compra): lança os itens de uma vez, sem repetir;
--   RH
--   * eventos da folha (códigos da contabilidade): cadastro sem mexer nos códigos que já existem;
--   * benefícios (VA, VR, VT, Wellhub…) e quem recebe cada um, com o desconto e o custo da empresa;
--   * indicadores: turnover e absenteísmo com os números de cada mês (planilha antiga ou digitados).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Estoque de peça pronta
-- ---------------------------------------------------------------------
create table if not exists public.produto_saldos (
  produto_id    uuid primary key references public.produtos(id) on delete cascade,
  saldo         numeric(14,3) not null default 0,
  minimo        numeric(14,3) not null default 0 check (minimo >= 0),
  contado_em    timestamptz,                 -- última contagem (vazio = nunca contado)
  contado_por   text,
  atualizado_em timestamptz not null default now()
);
create table if not exists public.produto_movs (
  id          uuid primary key default gen_random_uuid(),
  produto_id  uuid not null references public.produtos(id) on delete cascade,
  data        date not null default public.hoje(),
  tipo        text not null check (tipo in ('of','consumo','entrega','contagem')),
  qtd         numeric(14,3) not null,        -- + entra / − sai
  saldo       numeric(14,3),                 -- saldo depois deste movimento
  of_id       uuid references public.ofs(id) on delete set null,
  entrega_id  uuid,                          -- entrega ao cliente (some se a entrega for desfeita)
  obs         text,
  criado_por  uuid default auth.uid(),
  criado_nome text,
  criado_em   timestamptz not null default now()
);
create index if not exists produto_movs_produto on public.produto_movs (produto_id, criado_em desc);
create index if not exists produto_movs_entrega on public.produto_movs (entrega_id) where entrega_id is not null;

drop trigger if exists tg_atualizado on public.produto_saldos;
create trigger tg_atualizado before update on public.produto_saldos for each row execute function public.tg_atualizado();
alter table public.produto_saldos enable row level security;
alter table public.produto_movs enable row level security;
revoke all on public.produto_saldos, public.produto_movs from anon, authenticated;
grant select on public.produto_saldos, public.produto_movs to authenticated;
drop policy if exists ler on public.produto_saldos;
create policy ler on public.produto_saldos for select to authenticated using (public.eh('dono','escritorio','pcp','almoxarife','gerente','producao','tecnico','comercial'));
drop policy if exists ler on public.produto_movs;
create policy ler on public.produto_movs for select to authenticated using (public.eh('dono','escritorio','pcp','almoxarife','gerente','producao','tecnico','comercial'));

-- um movimento: grava e acerta o saldo (na mesma transação)
create or replace function public._mov_produto(p_prod uuid, p_tipo text, p_qtd numeric, p_of uuid, p_ent uuid, p_obs text, p_data date default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_saldo numeric;
begin
  if p_prod is null or coalesce(p_qtd, 0) = 0 then return; end if;
  insert into public.produto_saldos (produto_id, saldo) values (p_prod, p_qtd)
  on conflict (produto_id) do update set saldo = public.produto_saldos.saldo + excluded.saldo
  returning saldo into v_saldo;
  insert into public.produto_movs (produto_id, data, tipo, qtd, saldo, of_id, entrega_id, obs, criado_nome)
  values (p_prod, coalesce(p_data, public.hoje()), p_tipo, p_qtd, v_saldo, p_of, p_ent, p_obs, public.meu_nome());
end $$;

-- OF apontada: o que foi produzido entra no estoque; conjunto produzido consome os componentes (peças) da estrutura
create or replace function public.tg_ofs_estoque() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_d numeric; e record;
begin
  if current_setting('jaf.importando', true) = '1' then return null; end if;
  v_d := coalesce(new.produzido, 0) - (case when tg_op = 'INSERT' then 0 else coalesce(old.produzido, 0) end);
  if v_d = 0 then return null; end if;
  perform public._mov_produto(new.produto_id, 'of', v_d, new.id, null, 'OF ' || new.numero, null);
  if new.tipo = 'conjunto' then
    for e in select x.filho_id, x.qtd from public.produto_estrutura x join public.produtos f on f.id = x.filho_id
              where x.pai_id = new.produto_id and f.classe = 'peca' loop
      perform public._mov_produto(e.filho_id, 'consumo', -round(v_d * e.qtd, 3), new.id, null, 'Usado na OF ' || new.numero, null);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists tg_estoque on public.ofs;
create trigger tg_estoque after insert or update of produzido on public.ofs for each row execute function public.tg_ofs_estoque();

-- entrega ao cliente tira do estoque; entrega desfeita devolve
create or replace function public.tg_entregas_estoque() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_prod uuid; v public.vendas;
begin
  if current_setting('jaf.importando', true) = '1' then return null; end if;
  if tg_op = 'INSERT' then
    select * into v from public.vendas where id = new.venda_id;
    v_prod := coalesce(v.produto_id, (select id from public.produtos where lower(codigo) = lower(v.codigo) limit 1));
    perform public._mov_produto(v_prod, 'entrega', -new.qtd, null, new.id,
                                concat_ws(' · ', 'Entrega ' || coalesce(v.cliente_nome, ''), case when new.nf is not null then 'NF ' || new.nf end), new.data);
  else
    select produto_id into v_prod from public.produto_movs where entrega_id = old.id and tipo = 'entrega' and qtd < 0 order by criado_em limit 1;
    perform public._mov_produto(v_prod, 'entrega', old.qtd, null, null, 'Entrega desfeita' || coalesce(' · NF ' || old.nf, ''), null);
  end if;
  return null;
end $$;
drop trigger if exists tg_estoque on public.vendas_entregas;
create trigger tg_estoque after insert or delete on public.vendas_entregas for each row execute function public.tg_entregas_estoque();

-- contagem (inventário) e estoque mínimo — p: {produto_id, saldo, minimo, obs}
create or replace function public.contar_produto(p jsonb) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_prod uuid := public.uid_de(p, 'produto_id'); v_novo numeric := public.num(p, 'saldo'); v_min numeric := public.num(p, 'minimo');
        v_atual numeric; pr public.produtos;
begin
  perform public.exigir('dono','escritorio','pcp');
  select * into pr from public.produtos where id = v_prod;
  if pr.id is null then raise exception 'Produto não encontrado'; end if;
  if pr.classe <> 'peca' then raise exception 'Matéria-prima tem o saldo pelos lotes (R.I.)'; end if;
  if v_novo is not null and v_novo < 0 then raise exception 'A contagem não pode ser negativa'; end if;
  if v_min is not null and v_min < 0 then raise exception 'O estoque mínimo não pode ser negativo'; end if;
  insert into public.produto_saldos (produto_id) values (v_prod) on conflict (produto_id) do nothing;
  select saldo into v_atual from public.produto_saldos where produto_id = v_prod for update;
  if v_novo is not null then
    perform public._mov_produto(v_prod, 'contagem', v_novo - v_atual, null, null, coalesce(public.nzt(p->>'obs'), 'Contagem'), null);
    if v_novo = v_atual then   -- contou e bateu: registra a contagem mesmo sem diferença
      insert into public.produto_movs (produto_id, tipo, qtd, saldo, obs, criado_nome) values (v_prod, 'contagem', 0, v_atual, coalesce(public.nzt(p->>'obs'), 'Contagem (bateu)'), public.meu_nome());
    end if;
    update public.produto_saldos set contado_em = now(), contado_por = public.meu_nome() where produto_id = v_prod;
  end if;
  if v_min is not null then update public.produto_saldos set minimo = v_min where produto_id = v_prod; end if;
  return (select saldo from public.produto_saldos where produto_id = v_prod);
end $$;

-- ---------------------------------------------------------------------
-- 2) Nota fiscal de saída (a nota que a JAF emitiu): baixa as entregas dos pedidos
-- ---------------------------------------------------------------------
create table if not exists public.notas_saida (
  id            uuid primary key default gen_random_uuid(),
  chave         text not null check (chave ~ '^[0-9]{44}$'),
  numero        text,
  serie         text,
  emissao       date,
  cliente_id    uuid references public.clientes(id) on delete set null,
  cliente_nome  text,
  cnpj          text,
  valor         numeric(14,2),
  itens         jsonb not null default '[]',   -- [{n, codigo, descricao, qtd, baixado, sobra, baixas:[{venda_id, pedido, prazo, qtd}]}]
  entregas      int not null default 0,
  baixado       numeric(14,3) not null default 0,
  desfeito_em   timestamptz,
  desfeito_por  text,
  criado_por    uuid default auth.uid(),
  criado_nome   text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists notas_saida_chave on public.notas_saida (chave) where desfeito_em is null;
alter table public.vendas_entregas add column if not exists nota_saida_id uuid references public.notas_saida(id) on delete set null;
create index if not exists vendas_entregas_nota on public.vendas_entregas (nota_saida_id) where nota_saida_id is not null;
drop trigger if exists tg_atualizado on public.notas_saida;
create trigger tg_atualizado before update on public.notas_saida for each row execute function public.tg_atualizado();
alter table public.notas_saida enable row level security;
revoke all on public.notas_saida from anon, authenticated;
grant select on public.notas_saida to authenticated;
drop policy if exists ler on public.notas_saida;
create policy ler on public.notas_saida for select to authenticated using (public.eh('dono','escritorio','pcp','gerente','comercial'));

-- p: {id, chave, numero, serie, emissao, cnpj, cliente_id, cliente_nome, valor, simular,
--     itens:[{n, codigo, descricao, qtd, pedido}]}
--   cada item acha a peça (código JAF ou do cliente) e baixa nos pedidos em aberto do cliente:
--   primeiro o pedido com o número que veio na nota (xPed), depois o prazo mais antigo.
create or replace function public.baixar_nota_saida(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_sim boolean := coalesce((p->>'simular')::boolean, false);
  v_chave text := regexp_replace(coalesce(p->>'chave', ''), '\D', '', 'g'); v_cnpj text := regexp_replace(coalesce(p->>'cnpj', ''), '\D', '', 'g');
  c public.clientes; ex public.notas_saida; it jsonb; v record; v_prod uuid; v_cod text; v_q numeric; v_resto numeric; v_b numeric;
  v_baixas jsonb; v_itens jsonb := '[]'; n_ent int := 0; v_tot numeric := 0; v_sobra numeric := 0; v_data date := public.dt(p, 'emissao', public.hoje()); v_ent uuid;
  v_ja jsonb := '{}';   -- quanto já foi usado de cada pedido nesta nota (vale para a simulação também)
begin
  perform public.exigir('dono','escritorio','pcp','comercial');
  if length(v_chave) <> 44 then raise exception 'A chave da nota não veio no arquivo (precisa ser o XML da NF-e)'; end if;
  if jsonb_typeof(p->'itens') is distinct from 'array' or jsonb_array_length(p->'itens') = 0 then raise exception 'A nota não tem itens'; end if;
  perform pg_advisory_xact_lock(4248);
  select * into ex from public.notas_saida where chave = v_chave and desfeito_em is null;
  if ex.id is not null then
    if ex.id = v_id and not v_sim then   -- o mesmo envio de novo (toque duplo): não repete
      return jsonb_build_object('id', ex.id, 'repetido', true, 'entregas', ex.entregas, 'baixado', ex.baixado, 'itens', ex.itens);
    end if;
    raise exception 'A nota % já foi baixada em % por %', coalesce(ex.numero, ''), to_char(ex.criado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), coalesce(ex.criado_nome, '—');
  end if;
  select * into c from public.clientes where id = public.uid_de(p, 'cliente_id');
  if c.id is null and v_cnpj <> '' then
    select * into c from public.clientes where regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') = v_cnpj order by ativo desc limit 1;
  end if;
  if c.id is null then
    raise exception 'O cliente da nota (% · CNPJ %) não está no cadastro de clientes: cadastre o CNPJ dele ou escolha o cliente',
      coalesce(public.nz(p->>'cliente_nome'), '?'), coalesce(nullif(v_cnpj, ''), 'sem CNPJ');
  end if;
  if not v_sim then   -- a nota entra primeiro (as entregas apontam para ela); os totais vêm no fim
    insert into public.notas_saida (id, chave, numero, serie, emissao, cliente_id, cliente_nome, cnpj, valor, criado_nome)
    values (v_id, v_chave, public.nz(p->>'numero'), public.nz(p->>'serie'), public.dt(p, 'emissao'), c.id, c.nome, nullif(v_cnpj, ''), public.num(p, 'valor'), public.meu_nome());
  end if;

  for it in select * from jsonb_array_elements(p->'itens') loop
    v_cod := public.nz(it->>'codigo'); v_q := public.num(it, 'qtd');
    if v_q is null or v_q <= 0 then continue; end if;
    select id into v_prod from public.produtos
     where classe = 'peca' and (lower(codigo) = lower(v_cod) or lower(codigo_cliente) = lower(v_cod))
     order by (lower(codigo) = lower(v_cod)) desc, (cliente_id = c.id) desc nulls last, (situacao = 'ativo') desc limit 1;
    v_resto := v_q; v_baixas := '[]';
    for v in select x.* from public.vendas x
              where not x.cancelado and x.qtd > x.entregue
                and (x.cliente_id = c.id or (x.cliente_id is null and lower(x.cliente_nome) = lower(c.nome)))
                and ((v_prod is not null and x.produto_id = v_prod) or lower(x.codigo_cliente) = lower(v_cod) or lower(x.codigo) = lower(v_cod))
              order by (public.nz(it->>'pedido') is not null and lower(x.pedido) = lower(public.nz(it->>'pedido'))) desc, x.prazo nulls last, x.criado_em
              for update loop
      exit when v_resto <= 0;
      v_b := least(v_resto, v.qtd - v.entregue - coalesce((v_ja->>v.id::text)::numeric, 0));
      if v_b <= 0 then continue; end if;
      v_ja := v_ja || jsonb_build_object(v.id::text, coalesce((v_ja->>v.id::text)::numeric, 0) + v_b);
      v_resto := v_resto - v_b;
      v_baixas := v_baixas || jsonb_build_object('venda_id', v.id, 'pedido', v.pedido, 'prazo', v.prazo, 'saldo', v.qtd - v.entregue, 'qtd', v_b);
      if not v_sim then
        v_ent := gen_random_uuid();
        insert into public.vendas_entregas (id, venda_id, data, qtd, nf, obs, nota_saida_id)
        values (v_ent, v.id, v_data, v_b, public.nz(p->>'numero'), 'Baixa pela NF-e emitida', v_id);
        update public.vendas set entregue = entregue + v_b, entregue_em = greatest(coalesce(entregue_em, v_data), v_data) where id = v.id;
      end if;
      n_ent := n_ent + 1;
    end loop;
    v_sobra := v_sobra + v_resto;
    v_itens := v_itens || jsonb_build_object('n', it->'n', 'codigo', v_cod, 'descricao', left(public.nz(it->>'descricao'), 200), 'qtd', v_q,
                                             'produto_id', v_prod, 'pedido', public.nz(it->>'pedido'), 'baixado', v_q - v_resto, 'sobra', v_resto, 'baixas', v_baixas);
  end loop;
  select coalesce(sum((x->>'baixado')::numeric), 0) into v_tot from jsonb_array_elements(v_itens) x;

  if not v_sim then
    if n_ent = 0 then raise exception 'Nenhum item da nota tem pedido em aberto deste cliente: nada foi baixado'; end if;
    update public.notas_saida set itens = v_itens, entregas = n_ent, baixado = v_tot where id = v_id;
  end if;
  return jsonb_build_object('id', v_id, 'simulado', v_sim, 'cliente_id', c.id, 'cliente', c.nome, 'entregas', n_ent, 'baixado', v_tot, 'sobra', v_sobra, 'itens', v_itens);
end $$;

-- desfaz a baixa de uma nota (apaga as entregas que ela criou)
create or replace function public.desfazer_nota_saida(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare ns public.notas_saida; e record; n int := 0;
begin
  perform public.exigir('dono','escritorio','pcp','comercial');
  select * into ns from public.notas_saida where id = p_id for update;
  if ns.id is null then raise exception 'Nota não encontrada'; end if;
  if ns.desfeito_em is not null then raise exception 'Esta baixa já foi desfeita'; end if;
  for e in select * from public.vendas_entregas where nota_saida_id = ns.id loop
    delete from public.vendas_entregas where id = e.id;
    update public.vendas set entregue = greatest(0, entregue - e.qtd),
           entregue_em = (select max(data) from public.vendas_entregas where venda_id = e.venda_id)
     where id = e.venda_id;
    n := n + 1;
  end loop;
  update public.notas_saida set desfeito_em = now(), desfeito_por = public.meu_nome() where id = ns.id;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 3) Pedido do cliente lido do PDF (ordem de compra): lança os itens de uma vez
-- p: {cliente_id, pedido, simular, itens:[{codigo, descricao, prazo, qtd, valor}]}
--   o item que já está lançado (mesmo cliente, pedido, peça e data) não entra de novo
-- ---------------------------------------------------------------------
create or replace function public.lancar_pedido_cliente(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.clientes; it jsonb; v_cod text; v_prazo date; v_q numeric; v_ped text := left(public.nz(p->>'pedido'), 60); pr public.produtos;
        v_sim boolean := coalesce((p->>'simular')::boolean, false); r jsonb := '[]'; n_novo int := 0; n_igual int := 0; v_st text;
begin
  perform public.exigir('dono','escritorio','pcp','comercial');
  select * into c from public.clientes where id = public.uid_de(p, 'cliente_id');
  if c.id is null then raise exception 'Escolha o cliente do pedido'; end if;
  if jsonb_typeof(p->'itens') is distinct from 'array' or jsonb_array_length(p->'itens') = 0 then raise exception 'Nenhum item para lançar'; end if;
  if jsonb_array_length(p->'itens') > 2000 then raise exception 'Itens demais num pedido só'; end if;
  perform pg_advisory_xact_lock(4247);
  for it in select * from jsonb_array_elements(p->'itens') loop
    v_cod := left(public.nz(it->>'codigo'), 80); v_prazo := public.dt(it, 'prazo'); v_q := public.num(it, 'qtd');
    if v_cod is null and public.nz(it->>'descricao') is null then raise exception 'Item sem código e sem descrição'; end if;
    if v_q is null or v_q <= 0 then raise exception 'Quantidade inválida no item %', coalesce(v_cod, it->>'descricao'); end if;
    if v_prazo is null then raise exception 'O item % está sem data de entrega', coalesce(v_cod, it->>'descricao'); end if;
    pr := null;
    if v_cod is not null then
      select * into pr from public.produtos
       where classe = 'peca' and (lower(codigo_cliente) = lower(v_cod) or lower(codigo) = lower(v_cod))
       order by (lower(codigo_cliente) = lower(v_cod)) desc nulls last, (cliente_id = c.id) desc nulls last, (situacao = 'ativo') desc, codigo limit 1;
    end if;
    if exists (select 1 from public.vendas x
                where not x.cancelado and (x.cliente_id = c.id or (x.cliente_id is null and lower(x.cliente_nome) = lower(c.nome)))
                  and lower(coalesce(x.pedido, '')) = lower(coalesce(v_ped, '')) and x.prazo = v_prazo
                  and ((pr.id is not null and x.produto_id = pr.id) or lower(x.codigo_cliente) = lower(v_cod) or lower(x.codigo) = lower(v_cod)
                       or (v_cod is null and lower(x.descricao) = lower(public.nz(it->>'descricao'))))) then
      v_st := 'ja_lancado'; n_igual := n_igual + 1;
    else
      v_st := case when pr.id is null then 'sem_cadastro' else 'novo' end; n_novo := n_novo + 1;
      if not v_sim then
        insert into public.vendas (cliente_id, cliente_nome, produto_id, codigo, codigo_cliente, descricao, pedido, prazo, qtd, valor, obs)
        values (c.id, c.nome, pr.id, pr.codigo, coalesce(v_cod, pr.codigo_cliente), coalesce(pr.descricao, left(public.nz(it->>'descricao'), 200)),
                v_ped, v_prazo, v_q, coalesce(public.num(it, 'valor'), 0), 'Lido do pedido em PDF');
      end if;
    end if;
    r := r || jsonb_build_object('codigo', v_cod, 'prazo', v_prazo, 'qtd', v_q, 'produto', pr.codigo, 'status', v_st);
  end loop;
  return jsonb_build_object('simulado', v_sim, 'novos', n_novo, 'ja_lancados', n_igual, 'itens', r);
end $$;

-- ---------------------------------------------------------------------
-- 4) RH: benefícios e quem recebe
-- ---------------------------------------------------------------------
create table if not exists public.rh_beneficios (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  categoria     text not null default 'Outros',
  fornecedor    text,
  valor         numeric(14,2) check (valor is null or valor >= 0),        -- valor mensal por pessoa (vazio = ainda não definido)
  desconto_pct  numeric(6,3) not null default 0 check (desconto_pct between 0 and 100),
  desconto_base text not null default 'valor' check (desconto_base in ('valor','salario')),   -- VT: % do salário, limitado ao valor
  ativo         boolean not null default true,
  obs           text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists rh_beneficios_nome on public.rh_beneficios (lower(nome));
create table if not exists public.rh_beneficio_vinculos (
  id             uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  beneficio_id   uuid not null references public.rh_beneficios(id) on delete cascade,
  valor          numeric(14,2) check (valor is null or valor >= 0),       -- vazio = o valor do benefício
  desconto_pct   numeric(6,3) check (desconto_pct is null or desconto_pct between 0 and 100),
  inicio         date,
  fim            date,
  obs            text,
  atualizado_em  timestamptz not null default now(),
  check (fim is null or inicio is null or fim >= inicio)
);
create index if not exists rh_beneficio_vinculos_func on public.rh_beneficio_vinculos (funcionario_id);
create index if not exists rh_beneficio_vinculos_ben on public.rh_beneficio_vinculos (beneficio_id);

-- eventos da folha (códigos da contabilidade) — a origem diz de onde sai o número de cada pessoa
create table if not exists public.rh_eventos_folha (
  id            uuid primary key default gen_random_uuid(),
  codigo        int not null unique check (codigo > 0),
  descricao     text not null,
  origem        text not null default 'manual' check (origem in ('he50','he60','he80','he100','faltas_dias','dsr_dias','atrasos_horas',
                                                                  'beneficio_desconto','beneficio_empresa','manual')),
  beneficio_id  uuid references public.rh_beneficios(id) on delete set null,
  ativo         boolean not null default true,
  ordem         int not null default 0,
  padrao        boolean not null default false,     -- veio da contabilidade (código e nome não mudam)
  atualizado_em timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['rh_beneficios','rh_beneficio_vinculos','rh_eventos_folha'] loop
    execute format('drop trigger if exists tg_atualizado on public.%I', t);
    execute format('create trigger tg_atualizado before update on public.%I for each row execute function public.tg_atualizado()', t);
    execute format('drop trigger if exists tg_historico on public.%I', t);
    execute format('create trigger tg_historico after insert or update or delete on public.%I for each row execute function public.tg_historico()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists ler on public.%I', t);
    execute format('create policy ler on public.%I for select to authenticated using (public.pode_rh())', t);
  end loop;
end $$;

-- os benefícios que a JAF já usa (sem valor: o RH completa)
insert into public.rh_beneficios (nome, categoria, fornecedor, desconto_pct, desconto_base)
select x.nome, x.cat, x.forn, x.pct, x.base
  from (values ('Vale alimentação', 'Cesta básica / Alimentação', null, 0, 'valor'),
               ('VR', 'Alimentação', null, 20, 'valor'),
               ('VT', 'Transporte', null, 6, 'salario'),
               ('Wellhub', 'Saúde / Bem-estar', null, 10, 'valor')) as x(nome, cat, forn, pct, base)
 where not exists (select 1 from public.rh_beneficios b where lower(b.nome) = lower(x.nome));

-- os eventos dos arquivos da contabilidade, na mesma ordem
insert into public.rh_eventos_folha (codigo, descricao, origem, beneficio_id, ordem, padrao)
select x.cod, x.descr, x.orig, (select id from public.rh_beneficios where lower(nome) = lower(x.ben)), x.ord, true
  from (values (17, 'Horas Extras 50%', 'he50', null, 1),
               (39, 'Faltas (Dias)', 'faltas_dias', null, 2),
               (82, 'Hora Extras 100%', 'he100', null, 3),
               (103, 'Faltas DSR (Dias)', 'dsr_dias', null, 4),
               (104, 'Faltas / Atrasos DSR (Horas)', 'atrasos_horas', null, 5),
               (109, 'Desc. Vale Transporte', 'beneficio_desconto', 'VT', 6),
               (150, 'Horas Extras 80%', 'he80', null, 7),
               (194, 'Horas Extras 60%', 'he60', null, 8),
               (969, 'Forn Cesta básica -Vinc PAT', 'manual', null, 9),
               (1126, 'Fornec Vale Transporte Empresa', 'manual', null, 10)) as x(cod, descr, orig, ben, ord)
 where not exists (select 1 from public.rh_eventos_folha e where e.codigo = x.cod);

-- p: {id, nome, categoria, fornecedor, valor, desconto_pct, desconto_base, ativo, obs}
create or replace function public.rh_salvar_beneficio(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_nome text := left(public.nz(p->>'nome'), 80); v_pct numeric := coalesce(public.num(p, 'desconto_pct'), 0);
begin
  perform public.exigir('dono','escritorio','rh');
  if v_nome is null then raise exception 'Informe o nome do benefício'; end if;
  if exists (select 1 from public.rh_beneficios where lower(nome) = lower(v_nome) and id <> v_id) then raise exception 'Já existe o benefício %', v_nome; end if;
  if v_pct < 0 or v_pct > 100 then raise exception 'O desconto vai de 0 a 100%%'; end if;
  if public.num(p, 'valor') < 0 then raise exception 'Valor negativo não vale'; end if;
  insert into public.rh_beneficios (id, nome, categoria, fornecedor, valor, desconto_pct, desconto_base, ativo, obs)
  values (v_id, v_nome, coalesce(left(public.nz(p->>'categoria'), 60), 'Outros'), left(public.nz(p->>'fornecedor'), 80), public.num(p, 'valor'), v_pct,
          case when p->>'desconto_base' = 'salario' then 'salario' else 'valor' end, coalesce((p->>'ativo')::boolean, true), public.nzt(p->>'obs'))
  on conflict (id) do update set nome = excluded.nome, categoria = excluded.categoria, fornecedor = excluded.fornecedor, valor = excluded.valor,
          desconto_pct = excluded.desconto_pct, desconto_base = excluded.desconto_base, ativo = excluded.ativo, obs = excluded.obs;
  return v_id;
end $$;

create or replace function public.rh_excluir_beneficio(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.exigir('dono','escritorio','rh');
  select count(*) into n from public.rh_beneficio_vinculos where beneficio_id = p_id;
  delete from public.rh_beneficios where id = p_id;
  if not found then raise exception 'Benefício não encontrado'; end if;
  return n;
end $$;

-- p: {id, funcionario_id, beneficio_id, valor, desconto_pct, inicio, fim, obs}
create or replace function public.rh_salvar_vinculo(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_f uuid := public.uid_de(p, 'funcionario_id'); v_b uuid := public.uid_de(p, 'beneficio_id');
        v_pct numeric := public.num(p, 'desconto_pct');
begin
  perform public.exigir('dono','escritorio','rh');
  if not exists (select 1 from public.funcionarios where id = v_f) then raise exception 'Escolha a pessoa'; end if;
  if not exists (select 1 from public.rh_beneficios where id = v_b) then raise exception 'Escolha o benefício'; end if;
  if v_pct is not null and (v_pct < 0 or v_pct > 100) then raise exception 'O desconto vai de 0 a 100%%'; end if;
  if public.num(p, 'valor') < 0 then raise exception 'Valor negativo não vale'; end if;
  if public.dt(p, 'fim') < public.dt(p, 'inicio') then raise exception 'O fim não pode ser antes do início'; end if;
  if exists (select 1 from public.rh_beneficio_vinculos where funcionario_id = v_f and beneficio_id = v_b and id <> v_id
               and (fim is null or fim >= public.hoje())) and (public.dt(p, 'fim') is null or public.dt(p, 'fim') >= public.hoje()) then
    raise exception 'Esta pessoa já recebe este benefício (edite o que já existe)';
  end if;
  insert into public.rh_beneficio_vinculos (id, funcionario_id, beneficio_id, valor, desconto_pct, inicio, fim, obs)
  values (v_id, v_f, v_b, public.num(p, 'valor'), v_pct, public.dt(p, 'inicio'), public.dt(p, 'fim'), public.nzt(p->>'obs'))
  on conflict (id) do update set beneficio_id = excluded.beneficio_id, valor = excluded.valor, desconto_pct = excluded.desconto_pct,
          inicio = excluded.inicio, fim = excluded.fim, obs = excluded.obs;
  return v_id;
end $$;

create or replace function public.rh_excluir_vinculo(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir('dono','escritorio','rh');
  delete from public.rh_beneficio_vinculos where id = p_id;
  if not found then raise exception 'Vínculo não encontrado'; end if;
end $$;

-- p: {id, codigo, descricao, origem, beneficio_id, ativo, ordem}
--   código novo não pode repetir; o código de um evento que já existe nunca muda;
--   os eventos que vieram da contabilidade não mudam de nome (só a origem do número e se está ativo)
create or replace function public.rh_salvar_evento(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_old public.rh_eventos_folha; v_cod int; v_desc text := left(public.nz(p->>'descricao'), 80);
        v_orig text := coalesce(public.nz(p->>'origem'), 'manual'); v_dup public.rh_eventos_folha;
begin
  perform public.exigir('dono','escritorio','rh');
  begin v_cod := (p->>'codigo')::int; exception when others then raise exception 'O código do evento é um número'; end;
  if v_orig not in ('he50','he60','he80','he100','faltas_dias','dsr_dias','atrasos_horas','beneficio_desconto','beneficio_empresa','manual') then raise exception 'Origem inválida'; end if;
  if v_orig like 'beneficio%' and public.uid_de(p, 'beneficio_id') is null then raise exception 'Escolha o benefício que dá o valor deste evento'; end if;
  select * into v_old from public.rh_eventos_folha where id = v_id;
  if v_old.id is null then
    if v_cod is null or v_cod <= 0 then raise exception 'Informe o código do evento (o mesmo da contabilidade)'; end if;
    if v_desc is null then raise exception 'Informe a descrição do evento'; end if;
    select * into v_dup from public.rh_eventos_folha where codigo = v_cod;
    if v_dup.id is not null then raise exception 'O código % já existe (%): não dá para cadastrar de novo nem sobrescrever', v_cod, v_dup.descricao; end if;
    insert into public.rh_eventos_folha (id, codigo, descricao, origem, beneficio_id, ativo, ordem)
    values (v_id, v_cod, v_desc, v_orig, case when v_orig like 'beneficio%' then public.uid_de(p, 'beneficio_id') end, coalesce((p->>'ativo')::boolean, true),
            coalesce(public.num(p, 'ordem')::int, (select coalesce(max(ordem), 0) + 1 from public.rh_eventos_folha)));
  else
    if v_cod is not null and v_cod <> v_old.codigo then raise exception 'O código de um evento que já existe não muda (crie um evento novo)'; end if;
    update public.rh_eventos_folha set
      descricao = case when padrao then descricao else coalesce(v_desc, descricao) end,
      origem = v_orig, beneficio_id = case when v_orig like 'beneficio%' then public.uid_de(p, 'beneficio_id') end,
      ativo = coalesce((p->>'ativo')::boolean, ativo), ordem = coalesce(public.num(p, 'ordem')::int, ordem)
     where id = v_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 5) RH: indicadores — os números de cada mês (turnover e absenteísmo)
-- ---------------------------------------------------------------------
alter table public.rh_indicadores add column if not exists ini      int check (ini is null or ini >= 0);         -- ativos no início do mês
alter table public.rh_indicadores add column if not exists fim      int check (fim is null or fim >= 0);         -- ativos no fim do mês
alter table public.rh_indicadores add column if not exists adm      int check (adm is null or adm >= 0);
alter table public.rh_indicadores add column if not exists dem      int check (dem is null or dem >= 0);
alter table public.rh_indicadores add column if not exists prev_h   numeric(12,2) check (prev_h is null or prev_h >= 0);    -- horas previstas
alter table public.rh_indicadores add column if not exists injust_h numeric(12,2) check (injust_h is null or injust_h >= 0); -- faltas e atrasos não justificados
alter table public.rh_indicadores add column if not exists just_h   numeric(12,2) check (just_h is null or just_h >= 0);     -- faltas justificadas
alter table public.rh_indicadores add column if not exists he_h     numeric(12,2) check (he_h is null or he_h >= 0);
alter table public.rh_indicadores add column if not exists trab_h   numeric(12,2) check (trab_h is null or trab_h >= 0);
alter table public.rh_indicadores add column if not exists afast    int check (afast is null or afast >= 0);
alter table public.rh_indicadores add column if not exists origem   text;   -- 'planilha' (histórico) ou 'manual'

-- grava os números do ano; só mexe nos campos que vieram (o que não veio fica como está)
create or replace function public.rh_salvar_indicadores(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_ano int := (p->>'ano')::int; m jsonb; v_comp date; n int := 0; k text; r public.rh_indicadores;
        v_campos text[] := array['receita','beneficios','encargos','outros','ini','fim','adm','dem','prev_h','injust_h','just_h','he_h','trab_h','afast'];
begin
  perform public.exigir('dono','escritorio','rh');
  if v_ano is null or v_ano < 2000 or v_ano > 2100 then raise exception 'Ano inválido'; end if;
  if jsonb_typeof(p->'meses') <> 'array' then raise exception 'Nada para gravar'; end if;
  for m in select * from jsonb_array_elements(p->'meses') loop
    if (m->>'mes')::int not between 1 and 12 then raise exception 'Mês inválido'; end if;
    v_comp := make_date(v_ano, (m->>'mes')::int, 1);
    foreach k in array v_campos loop
      if m ? k and public.num(m, k) < 0 then raise exception 'Valor negativo não vale'; end if;
    end loop;
    if not (m ?| v_campos) then   -- mês sem nenhum número: apaga o lançamento
      delete from public.rh_indicadores where competencia = v_comp; n := n + 1; continue;
    end if;
    insert into public.rh_indicadores (competencia) values (v_comp) on conflict (competencia) do nothing;
    update public.rh_indicadores x set
      receita    = case when m ? 'receita'    then public.num(m, 'receita')    else x.receita end,
      beneficios = case when m ? 'beneficios' then public.num(m, 'beneficios') else x.beneficios end,
      encargos   = case when m ? 'encargos'   then public.num(m, 'encargos')   else x.encargos end,
      outros     = case when m ? 'outros'     then public.num(m, 'outros')     else x.outros end,
      ini        = case when m ? 'ini'        then public.num(m, 'ini')::int   else x.ini end,
      fim        = case when m ? 'fim'        then public.num(m, 'fim')::int   else x.fim end,
      adm        = case when m ? 'adm'        then public.num(m, 'adm')::int   else x.adm end,
      dem        = case when m ? 'dem'        then public.num(m, 'dem')::int   else x.dem end,
      prev_h     = case when m ? 'prev_h'     then public.num(m, 'prev_h')     else x.prev_h end,
      injust_h   = case when m ? 'injust_h'   then public.num(m, 'injust_h')   else x.injust_h end,
      just_h     = case when m ? 'just_h'     then public.num(m, 'just_h')     else x.just_h end,
      he_h       = case when m ? 'he_h'       then public.num(m, 'he_h')       else x.he_h end,
      trab_h     = case when m ? 'trab_h'     then public.num(m, 'trab_h')     else x.trab_h end,
      afast      = case when m ? 'afast'      then public.num(m, 'afast')::int else x.afast end,
      origem     = coalesce(public.nz(m->>'origem'), case when m ?| array['ini','fim','adm','dem','prev_h','injust_h','just_h'] then 'manual' end, x.origem)
     where competencia = v_comp
     returning * into r;
    if r.receita is null and r.beneficios is null and r.encargos is null and r.outros is null and r.ini is null and r.fim is null and r.adm is null
       and r.dem is null and r.prev_h is null and r.injust_h is null and r.just_h is null and r.he_h is null and r.trab_h is null and r.afast is null then
      delete from public.rh_indicadores where competencia = v_comp;
    elsif r.ini is null and r.fim is null and r.adm is null and r.dem is null and r.prev_h is null and r.injust_h is null and r.just_h is null then
      update public.rh_indicadores set origem = null where competencia = v_comp and origem is not null;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- quem pode chamar
-- ---------------------------------------------------------------------
revoke all on function public._mov_produto(uuid, text, numeric, uuid, uuid, text, date) from public, anon, authenticated;
revoke all on function public.contar_produto(jsonb), public.baixar_nota_saida(jsonb), public.desfazer_nota_saida(uuid), public.lancar_pedido_cliente(jsonb),
  public.rh_salvar_beneficio(jsonb), public.rh_excluir_beneficio(uuid), public.rh_salvar_vinculo(jsonb), public.rh_excluir_vinculo(uuid),
  public.rh_salvar_evento(jsonb), public.rh_salvar_indicadores(jsonb) from public, anon;
grant execute on function public.contar_produto(jsonb), public.baixar_nota_saida(jsonb), public.desfazer_nota_saida(uuid), public.lancar_pedido_cliente(jsonb),
  public.rh_salvar_beneficio(jsonb), public.rh_excluir_beneficio(uuid), public.rh_salvar_vinculo(jsonb), public.rh_excluir_vinculo(uuid),
  public.rh_salvar_evento(jsonb), public.rh_salvar_indicadores(jsonb) to authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prorettype = 'trigger'::regtype loop
    execute format('revoke all on function %s from public, anon, authenticated', f.assinatura);
  end loop;
end $$;
