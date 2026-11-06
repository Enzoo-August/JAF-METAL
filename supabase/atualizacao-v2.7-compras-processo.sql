
-- =====================================================================
-- v2.7 — processo da peça na OF, perfil Comercial, compra de matéria-prima e necessidade
--   * cada produto tem o seu passo a passo (processo): a OF já sai com os passos e quadradinhos
--     para marcar no papel e no aplicativo;
--   * perfil novo "comercial": pedidos de clientes, necessidade, pedido de compra de
--     matéria-prima, fornecedores e clientes — sem financeiro e sem RH;
--   * pedido de compra também de matéria-prima: ao receber, o R.I. nasce sozinho (entrada no
--     estoque de matéria-prima) e o pedido é baixado;
--   * necessidade lançada pelo PCP vai para o Comercial comprar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- perfil Comercial
-- ---------------------------------------------------------------------
alter table public.perfis drop constraint if exists perfis_perfil_check;
alter table public.perfis add constraint perfis_perfil_check
  check (perfil in ('dono','escritorio','almoxarife','pcp','producao','rh','gerente','tecnico','manutencao','comercial'));

create or replace function public.perfil_valido(p text) returns boolean
language sql immutable set search_path = public as $$ select coalesce(p in ('dono','escritorio','almoxarife','pcp','producao','rh','gerente','tecnico','manutencao','comercial'), false) $$;

-- ---------------------------------------------------------------------
-- processo (passo a passo) do produto e passos da OF
-- ---------------------------------------------------------------------
alter table public.produtos add column if not exists processo jsonb;            -- [{operacao, peca, maquina_id}] (vazio = montado sozinho pela estrutura)
alter table public.ofs add column if not exists passos jsonb not null default '[]';  -- [{n, operacao, peca, maquina_id, maquina, feito, feito_por, feito_em}]

-- passo a passo montado pela estrutura: primeiro as peças fabricadas aqui (cada uma com a sua operação
-- ou com o processo dela), depois a operação do próprio produto. Peça comprada (só conferir) fica fora.
create or replace function public._passos_de(p_prod uuid, p_nivel int default 0) returns jsonb
language plpgsql stable set search_path = public as $$
declare pr public.produtos; e record; v jsonb := '[]';
begin
  select * into pr from public.produtos where id = p_prod;
  if pr.id is null then return '[]'; end if;
  if p_nivel > 0 and jsonb_typeof(pr.processo) = 'array' and jsonb_array_length(pr.processo) > 0 then
    return (select coalesce(jsonb_agg(jsonb_build_object('operacao', x->>'operacao', 'peca', coalesce(public.nz(x->>'peca'), pr.descricao),
                                                         'maquina_id', public.nz(x->>'maquina_id')) order by o), '[]')
              from jsonb_array_elements(pr.processo) with ordinality t(x, o));
  end if;
  if p_nivel < 4 then
    for e in select f.id from public.produto_estrutura e2 join public.produtos f on f.id = e2.filho_id
              where e2.pai_id = pr.id and f.classe = 'peca'
                and coalesce(f.operacao, '') !~* '^\s*controlar\s+recebimento'
                and (f.mp_codigo is not null or exists (select 1 from public.produto_estrutura x where x.pai_id = f.id))
              order by e2.ordem, f.codigo loop
      v := v || public._passos_de(e.id, p_nivel + 1);
    end loop;
  end if;
  if public.nz(pr.operacao) is not null then
    v := v || jsonb_build_array(jsonb_build_object('operacao', pr.operacao, 'peca', case when p_nivel > 0 then pr.descricao end, 'maquina_id', null));
  end if;
  return v;
end $$;

-- o processo que vai para a OF: o salvo no produto ou, se não tiver, o montado pela estrutura
create or replace function public._passos_of(p_prod uuid) returns jsonb
language sql stable set search_path = public as $$
  with base as (
    select case when jsonb_typeof(p.processo) = 'array' and jsonb_array_length(p.processo) > 0 then p.processo else public._passos_de(p.id, 0) end as passos
      from public.produtos p where p.id = p_prod)
  select coalesce((select jsonb_agg(jsonb_build_object('n', o, 'operacao', x->>'operacao', 'peca', public.nz(x->>'peca'),
                                                        'maquina_id', public.nz(x->>'maquina_id'),
                                                        'maquina', (select m.nome from public.maquinas m where m.id::text = x->>'maquina_id'),
                                                        'feito', false) order by o)
                     from base, jsonb_array_elements(base.passos) with ordinality t(x, o)), '[]'::jsonb) $$;

-- a OF nasce com o passo a passo do produto (também as OFs dos componentes que o conjunto gera)
create or replace function public.tg_of_passos() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.passos is null or new.passos = '[]'::jsonb then new.passos := public._passos_of(new.produto_id); end if;
  elsif new.produto_id is distinct from old.produto_id
        and not exists (select 1 from jsonb_array_elements(old.passos) x where (x->>'feito')::boolean) then
    new.passos := public._passos_of(new.produto_id);   -- trocou o produto antes de começar: troca o passo a passo
  end if;
  return new;
end $$;
drop trigger if exists tg_of_passos on public.ofs;
create trigger tg_of_passos before insert or update of produto_id on public.ofs for each row execute function public.tg_of_passos();

-- OFs ainda abertas ganham o passo a passo agora
update public.ofs set passos = public._passos_of(produto_id) where status = 'aberta' and passos = '[]'::jsonb;

-- ---------------------------------------------------------------------
-- pedido de compra também de matéria-prima
-- ---------------------------------------------------------------------
alter table public.pedidos_compra add column if not exists tipo text not null default 'pecas';
alter table public.pedidos_compra drop constraint if exists pedidos_compra_tipo_check;
alter table public.pedidos_compra add constraint pedidos_compra_tipo_check check (tipo in ('pecas','mp'));
alter table public.pedido_itens alter column peca_id drop not null;
alter table public.pedido_itens add column if not exists produto_id uuid references public.produtos(id);
alter table public.pedido_itens drop constraint if exists pedido_itens_um_item;
alter table public.pedido_itens add constraint pedido_itens_um_item check ((peca_id is null) <> (produto_id is null));
create index if not exists pedido_itens_produto on public.pedido_itens (produto_id) where produto_id is not null;
alter table public.mp_lotes add column if not exists pedido_item_id uuid references public.pedido_itens(id) on delete set null;

-- recebimento já feito (toque duplo / internet que caiu): a mesma chave não recebe duas vezes
create table if not exists public.recebimentos (
  chave      uuid primary key,
  pedido_id  uuid references public.pedidos_compra(id) on delete cascade,
  em         timestamptz not null default now()
);
alter table public.recebimentos enable row level security;
revoke all on public.recebimentos from anon, authenticated;

-- ---------------------------------------------------------------------
-- necessidade de compra (o PCP pede, o Comercial compra)
-- ---------------------------------------------------------------------
create table if not exists public.necessidades (
  id            uuid primary key default gen_random_uuid(),
  produto_id    uuid not null references public.produtos(id),
  qtd           numeric(14,3) not null check (qtd > 0),
  prazo         date,
  motivo        text,
  status        text not null default 'aberta' check (status in ('aberta','pedido','cancelada')),
  pedido_id     uuid references public.pedidos_compra(id) on delete set null,
  criado_por    uuid default auth.uid(),
  criado_nome   text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists necessidades_status on public.necessidades (status);
drop trigger if exists tg_atualizado on public.necessidades;
create trigger tg_atualizado before update on public.necessidades for each row execute function public.tg_atualizado();
drop trigger if exists tg_historico on public.necessidades;
create trigger tg_historico after insert or update or delete on public.necessidades for each row execute function public.tg_historico();
alter table public.necessidades enable row level security;
revoke all on public.necessidades from anon, authenticated;
grant select on public.necessidades to authenticated;

-- ---------------------------------------------------------------------
-- quem lê o quê (o Comercial entra nas listas)
-- ---------------------------------------------------------------------
drop policy if exists ler on public.necessidades;
create policy ler on public.necessidades for select to authenticated using (public.eh('dono','escritorio','pcp','comercial','gerente','almoxarife'));
drop policy if exists ler on public.fornecedores;
create policy ler on public.fornecedores for select to authenticated using (public.eh('dono','escritorio','almoxarife','pcp','tecnico','manutencao','comercial'));
drop policy if exists ler on public.clientes;
create policy ler on public.clientes for select to authenticated using (public.eh('dono','escritorio','pcp','tecnico','gerente','comercial'));
drop policy if exists ler on public.vendas;
create policy ler on public.vendas for select to authenticated using (public.eh('dono','escritorio','pcp','gerente','comercial'));
drop policy if exists ler on public.vendas_entregas;
create policy ler on public.vendas_entregas for select to authenticated using (public.eh('dono','escritorio','pcp','gerente','comercial'));
drop policy if exists ler on public.mp_lotes;
create policy ler on public.mp_lotes for select to authenticated using (public.eh('dono','escritorio','pcp','almoxarife','gerente','producao','tecnico','comercial'));
drop policy if exists ler on public.ofs;
create policy ler on public.ofs for select to authenticated using (public.eh('dono','escritorio','pcp','almoxarife','gerente','producao','tecnico','comercial'));
drop policy if exists ler on public.pedidos_compra;
create policy ler on public.pedidos_compra for select to authenticated using (public.eh('dono','escritorio','almoxarife','comercial'));
drop policy if exists ler on public.pedido_itens;
create policy ler on public.pedido_itens for select to authenticated using (public.eh('dono','escritorio','almoxarife','comercial'));
drop policy if exists ler on public.pecas;
create policy ler on public.pecas for select to authenticated using (public.eh('dono','escritorio','almoxarife','pcp','producao','gerente','comercial'));

-- ---------------------------------------------------------------------
-- o Comercial também cadastra fornecedor e cliente, cuida dos pedidos de clientes
-- e recebe matéria-prima (funções iguais às anteriores, só com o perfil novo)
-- ---------------------------------------------------------------------
create or replace function public.salvar_fornecedor(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_nome text := public.nz(p ->> 'nome');
begin
  perform public.exigir('dono','escritorio','almoxarife','comercial');
  if v_nome is null then raise exception 'Informe o nome do fornecedor'; end if;
  if exists (select 1 from public.fornecedores where lower(nome) = lower(v_nome) and id <> v_id) then
    raise exception 'Já existe um fornecedor chamado "%"', v_nome;
  end if;
  insert into public.fornecedores as f (id, nome, razao, tipo, contato, contato2, telefone, celular, email, site, endereco, bairro,
         cidade, uf, cep, cnpj, ie, qualificacao, qualif_metodo, qualif_validade, obs, ativo)
  values (v_id, v_nome, public.nz(p->>'razao'), coalesce(public.nz(p->>'tipo'), 'Peças'), public.nz(p->>'contato'), public.nz(p->>'contato2'),
          public.nz(p->>'telefone'), public.nz(p->>'celular'), lower(public.nz(p->>'email')), public.nz(p->>'site'), public.nz(p->>'endereco'),
          public.nz(p->>'bairro'), public.nz(p->>'cidade'), upper(public.nz(p->>'uf')), public.nz(p->>'cep'), public.nz(p->>'cnpj'),
          public.nz(p->>'ie'), public.nz(p->>'qualificacao'), public.nz(p->>'qualif_metodo'), public.dt(p, 'qualif_validade'),
          public.nzt(p->>'obs'), coalesce((p->>'ativo')::boolean, true))
  on conflict (id) do update set nome = excluded.nome, razao = excluded.razao, tipo = excluded.tipo, contato = excluded.contato,
          contato2 = excluded.contato2, telefone = excluded.telefone, celular = excluded.celular, email = excluded.email,
          site = excluded.site, endereco = excluded.endereco, bairro = excluded.bairro, cidade = excluded.cidade, uf = excluded.uf,
          cep = excluded.cep, cnpj = excluded.cnpj, ie = excluded.ie, qualificacao = excluded.qualificacao,
          qualif_metodo = excluded.qualif_metodo, qualif_validade = excluded.qualif_validade, obs = excluded.obs, ativo = excluded.ativo;
  return v_id;
end $$;
create or replace function public.salvar_cliente(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_nome text := public.nz(p ->> 'nome');
begin
  perform public.exigir('dono','escritorio','pcp','comercial');
  if v_nome is null then raise exception 'Informe o nome do cliente'; end if;
  if exists (select 1 from public.clientes where lower(nome) = lower(v_nome) and id <> v_id) then
    raise exception 'Já existe um cliente chamado "%"', v_nome;
  end if;
  insert into public.clientes (id, nome, razao, cnpj, contato, telefone, email, cidade, uf, obs, ativo, sigla, contato2, telefone2, endereco, bairro, cep, ie, site)
  values (v_id, v_nome, public.nz(p->>'razao'), public.nz(p->>'cnpj'), public.nz(p->>'contato'), public.nz(p->>'telefone'),
          lower(public.nz(p->>'email')), public.nz(p->>'cidade'), upper(public.nz(p->>'uf')), public.nzt(p->>'obs'),
          coalesce((p->>'ativo')::boolean, true), upper(public.nz(p->>'sigla')), public.nz(p->>'contato2'), public.nz(p->>'telefone2'),
          public.nz(p->>'endereco'), public.nz(p->>'bairro'), public.nz(p->>'cep'), public.nz(p->>'ie'), public.nz(p->>'site'))
  on conflict (id) do update set nome = excluded.nome, razao = excluded.razao, cnpj = excluded.cnpj, contato = excluded.contato,
          telefone = excluded.telefone, email = excluded.email, cidade = excluded.cidade, uf = excluded.uf, obs = excluded.obs,
          ativo = excluded.ativo, sigla = excluded.sigla, contato2 = excluded.contato2, telefone2 = excluded.telefone2,
          endereco = excluded.endereco, bairro = excluded.bairro, cep = excluded.cep, ie = excluded.ie, site = excluded.site;
  update public.ordens set cliente_nome = v_nome where cliente_id = v_id and cliente_nome is distinct from v_nome;
  update public.vendas set cliente_nome = v_nome where cliente_id = v_id and cliente_nome is distinct from v_nome;
  return v_id;
end $$;
create or replace function public.salvar_venda(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_cli uuid := public.uid_de(p, 'cliente_id'); v_prod uuid := public.uid_de(p, 'produto_id');
        v_q numeric := public.num(p, 'qtd'); pr public.produtos;
begin
  perform public.exigir('dono','escritorio','pcp','comercial');
  if v_cli is null and public.nz(p->>'cliente_nome') is null then raise exception 'Escolha o cliente'; end if;
  if v_q is null or v_q < 0 or (v_q = 0 and not coalesce((p->>'cancelado')::boolean, false)) then raise exception 'Informe a quantidade'; end if;
  if v_prod is null and public.nz(p->>'codigo') is not null then select id into v_prod from public.produtos where lower(codigo) = lower(p->>'codigo'); end if;
  select * into pr from public.produtos where id = v_prod;
  if pr.id is null and public.nz(p->>'codigo') is null and public.nz(p->>'descricao') is null then raise exception 'Informe o código ou a descrição do item'; end if;
  insert into public.vendas (id, cliente_id, cliente_nome, produto_id, codigo, codigo_cliente, descricao, pedido, prazo, qtd, valor, cancelado, obs)
  values (v_id, v_cli, coalesce((select nome from public.clientes where id = v_cli), public.nz(p->>'cliente_nome')), v_prod,
          coalesce(pr.codigo, public.nz(p->>'codigo')), coalesce(public.nz(p->>'codigo_cliente'), pr.codigo_cliente), coalesce(public.nz(p->>'descricao'), pr.descricao),
          public.nz(p->>'pedido'), public.dt(p, 'prazo'), v_q, coalesce(public.num(p, 'valor'), 0), coalesce((p->>'cancelado')::boolean, false), public.nzt(p->>'obs'))
  on conflict (id) do update set cliente_id = excluded.cliente_id, cliente_nome = excluded.cliente_nome, produto_id = excluded.produto_id, codigo = excluded.codigo,
          codigo_cliente = excluded.codigo_cliente, descricao = excluded.descricao, pedido = excluded.pedido, prazo = excluded.prazo, qtd = excluded.qtd,
          valor = excluded.valor, cancelado = excluded.cancelado, obs = excluded.obs;
  return v_id;
end $$;
create or replace function public.entregar_venda(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v public.vendas; v_q numeric := public.num(p, 'qtd'); v_id uuid := gen_random_uuid(); v_d date := public.dt(p, 'data', public.hoje());
begin
  perform public.exigir('dono','escritorio','pcp','comercial');
  select * into v from public.vendas where id = public.uid_de(p, 'venda_id') for update;
  if v.id is null then raise exception 'Pedido não encontrado'; end if;
  if v.cancelado then raise exception 'Este item está cancelado'; end if;
  if v_q is null or v_q <= 0 then raise exception 'Informe a quantidade entregue'; end if;
  insert into public.vendas_entregas (id, venda_id, data, qtd, nf, obs) values (v_id, v.id, v_d, v_q, public.nz(p->>'nf'), public.nzt(p->>'obs'));
  update public.vendas set entregue = entregue + v_q, entregue_em = greatest(coalesce(entregue_em, v_d), v_d) where id = v.id;
  return v_id;
end $$;
create or replace function public.excluir_entrega(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e public.vendas_entregas;
begin
  perform public.exigir('dono','escritorio','pcp','comercial');
  select * into e from public.vendas_entregas where id = p_id;
  if e.id is null then raise exception 'Entrega não encontrada'; end if;
  delete from public.vendas_entregas where id = p_id;
  update public.vendas set entregue = greatest(0, entregue - e.qtd),
         entregue_em = coalesce((select max(data) from public.vendas_entregas where venda_id = e.venda_id), case when entregue - e.qtd > 0 then entregue_em end)
   where id = e.venda_id;
end $$;
create or replace function public.reabrir_pedido(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir('dono','escritorio','almoxarife','comercial');
  if exists (select 1 from public.pedidos_compra where id = p_id and tipo = 'pecas') and not public.eh('dono','escritorio','almoxarife') then
    raise exception 'Pedido de peças é com o almoxarifado';
  end if;
  update public.pedidos_compra set status = 'aguardando', recebido_em = null
   where id = p_id and status in ('cancelado','recebido')
     and exists (select 1 from public.pedido_itens where pedido_id = p_id and recebido < qtd);
  if not found then raise exception 'Esse pedido não tem nada pendente para reabrir'; end if;
end $$;
create or replace function public.salvar_lote(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_ri int := public.num(p, 'ri')::int; v_old public.mp_lotes;
        v_q numeric := public.num(p, 'qtd'); v_f uuid := public.uid_de(p, 'fornecedor_id');
begin
  perform public.exigir('dono','escritorio','pcp','almoxarife','comercial');
  if public.uid_de(p, 'produto_id') is null then raise exception 'Escolha o material'; end if;
  if v_q is null or v_q <= 0 then raise exception 'Informe a quantidade recebida'; end if;
  select * into v_old from public.mp_lotes where id = v_id;
  perform pg_advisory_xact_lock(4244);
  -- próximo R.I.: depois do maior já usado (na entrada ou numa OF)
  v_ri := coalesce(v_ri, v_old.ri, greatest((select max(ri) from public.mp_lotes), (select max(ri) from public.ofs where ri < 10000000)) + 1, 1);
  if exists (select 1 from public.mp_lotes where ri = v_ri and id <> v_id) then raise exception 'O R.I. % já existe', v_ri; end if;
  insert into public.mp_lotes (id, ri, produto_id, qtd, data, nota, fornecedor_id, fornecedor_nome, pedido, status, obs)
  values (v_id, v_ri, public.uid_de(p, 'produto_id'), v_q, public.dt(p, 'data', public.hoje()), public.nz(p->>'nota'), v_f,
          coalesce((select nome from public.fornecedores where id = v_f), public.nz(p->>'fornecedor_nome')), public.nz(p->>'pedido'),
          coalesce(public.nz(p->>'status'), 'Aprovado'), public.nzt(p->>'obs'))
  on conflict (id) do update set ri = excluded.ri, produto_id = excluded.produto_id, qtd = excluded.qtd, data = excluded.data, nota = excluded.nota,
          fornecedor_id = excluded.fornecedor_id, fornecedor_nome = excluded.fornecedor_nome, pedido = excluded.pedido, status = excluded.status, obs = excluded.obs;
  return jsonb_build_object('id', v_id, 'ri', v_ri);
end $$;
create or replace function public.conferir_nota(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_chave text := regexp_replace(coalesce(p->>'chave', ''), '\D', '', 'g');
        v_cnpj text := regexp_replace(coalesce(p->>'cnpj', ''), '\D', '', 'g');
        n public.notas_fiscais; v_f uuid;
begin
  perform public.exigir('dono','escritorio','almoxarife','pcp','comercial');
  select * into n from public.notas_fiscais where chave = v_chave;
  if length(v_cnpj) >= 11 then
    select id into v_f from public.fornecedores where regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') = v_cnpj order by ativo desc, criado_em limit 1;
  end if;
  return jsonb_build_object(
    'lancada', case when n.id is not null then jsonb_build_object('data', n.data, 'em', n.criado_em,
                 'quem', coalesce((select nome from public.perfis where user_id = n.criado_por), '')) end,
    'fornecedor_id', v_f,
    'vinculos', coalesce((select jsonb_agg(jsonb_build_object('codigo', codigo, 'peca_id', peca_id, 'produto_id', produto_id))
                            from public.nota_vinculos where fornecedor_id = v_f), '[]'::jsonb));
end $$;
create or replace function public.lancar_nota(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid());
  v_chave text := regexp_replace(coalesce(p->>'chave', ''), '\D', '', 'g');
  v_data date := public.dt(p, 'data', public.hoje());
  v_num text := coalesce(public.nz(p->>'numero'), ltrim(substr(regexp_replace(coalesce(p->>'chave', ''), '\D', '', 'g'), 26, 9), '0'));
  v_doc text; v_f uuid := public.uid_de(p, 'fornecedor_id'); fo jsonb := coalesce(p->'fornecedor', '{}'::jsonb);
  v_cnpj text := regexp_replace(coalesce(p->'fornecedor'->>'cnpj', ''), '\D', '', 'g'); v_fnome text;
  i jsonb; c jsonb; v_dest text; v_q numeric; v_cod text; v_ped jsonb := '{}'; v_pid text; r jsonb;
  v_pecas int := 0; v_ris jsonb := '[]'; v_resumo jsonb := '[]'; v_n int; v_k int := 0; v_grupo uuid; v_val numeric; v_venc date; v_rec boolean := false;
begin
  perform public.exigir('dono','escritorio','almoxarife','pcp','comercial');
  -- envio repetido (toque duplo / internet que caiu): não lança de novo
  if exists (select 1 from public.notas_fiscais where id = v_id) then
    return (select jsonb_build_object('id', id, 'repetido', true) from public.notas_fiscais where id = v_id);
  end if;
  if length(v_chave) <> 44 then raise exception 'Chave da nota inválida (precisa ter 44 números)'; end if;
  if exists (select 1 from public.notas_fiscais where chave = v_chave) then
    raise exception 'Esta nota já foi lançada em %', (select to_char(data, 'DD/MM/YYYY') from public.notas_fiscais where chave = v_chave);
  end if;
  if v_data > public.hoje() then raise exception 'A data não pode ser no futuro'; end if;
  v_doc := 'NF ' || v_num;

  -- fornecedor: o escolhido, o do mesmo CNPJ, o do mesmo nome ou um novo com os dados da nota
  if v_f is null and length(v_cnpj) >= 11 then
    select id into v_f from public.fornecedores where regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') = v_cnpj order by ativo desc, criado_em limit 1;
  end if;
  if v_f is null and public.nz(fo->>'nome') is not null then
    select id into v_f from public.fornecedores where lower(nome) = lower(fo->>'nome');
    if v_f is null then
      insert into public.fornecedores (nome, razao, tipo, telefone, email, endereco, bairro, cidade, uf, cep, cnpj, ie, obs)
      values (fo->>'nome', public.nz(fo->>'razao'), 'Peças', public.nz(fo->>'telefone'), lower(public.nz(fo->>'email')), public.nz(fo->>'endereco'),
              public.nz(fo->>'bairro'), public.nz(fo->>'cidade'), upper(public.nz(fo->>'uf')), public.nz(fo->>'cep'), public.nz(fo->>'cnpj'),
              public.nz(fo->>'ie'), 'Cadastrado pela nota fiscal ' || v_num)
      returning id into v_f;
    end if;
  end if;
  if v_f is null then raise exception 'Escolha o fornecedor'; end if;
  select nome into v_fnome from public.fornecedores where id = v_f;
  -- fornecedor da planilha sem CNPJ: completa com os dados da nota (assim a próxima nota já acha sozinha)
  if length(v_cnpj) >= 11 then
    update public.fornecedores set cnpj = public.nz(fo->>'cnpj'), razao = coalesce(razao, public.nz(fo->>'razao')), ie = coalesce(ie, public.nz(fo->>'ie')),
           endereco = coalesce(endereco, public.nz(fo->>'endereco')), bairro = coalesce(bairro, public.nz(fo->>'bairro')),
           cidade = coalesce(cidade, public.nz(fo->>'cidade')), uf = coalesce(uf, upper(public.nz(fo->>'uf'))), cep = coalesce(cep, public.nz(fo->>'cep')),
           telefone = coalesce(telefone, public.nz(fo->>'telefone'))
     where id = v_f and public.nz(cnpj) is null;
  end if;

  for i in select * from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb)) loop
    v_dest := coalesce(public.nz(i->>'destino'), 'ignorar'); v_q := public.num(i, 'qtd'); v_cod := public.nz(i->>'codigo');
    if v_dest not in ('peca','mp','ignorar') then raise exception 'Destino inválido'; end if;
    if v_dest <> 'ignorar' and (v_q is null or v_q <= 0) then
      raise exception 'Informe a quantidade do item % (%)', coalesce(i->>'n', '?'), coalesce(i->>'descricao', '');
    end if;
    r := null;
    if v_dest = 'peca' then
      if not public.eh('dono','escritorio','almoxarife') then raise exception 'Seu perfil não pode dar entrada de peças: lance só a matéria-prima'; end if;
      if public.uid_de(i, 'peca_id') is null then raise exception 'Escolha a peça do item % (%)', coalesce(i->>'n', '?'), coalesce(i->>'descricao', ''); end if;
      if public.uid_de(i, 'pedido_item_id') is not null then
        -- chegou de um pedido de compra: recebe por ele (o pedido é baixado)
        select pedido_id::text into v_pid from public.pedido_itens where id = public.uid_de(i, 'pedido_item_id') and peca_id = public.uid_de(i, 'peca_id');
        v_rec := true;
        if v_pid is null then raise exception 'O item % não é deste pedido de compra', coalesce(i->>'n', '?'); end if;
        v_ped := jsonb_set(v_ped, array[v_pid], coalesce(v_ped->v_pid, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('item_id', i->>'pedido_item_id', 'qtd', v_q)));
      else
        perform public.movimentar(jsonb_build_object('tipo', 'entrada', 'motivo', 'compra', 'peca_id', i->>'peca_id', 'qtd', v_q,
          'preco_unit', public.num(i, 'preco_unit'), 'fornecedor_id', v_f, 'documento', v_doc, 'data', v_data,
          'obs', 'Nota fiscal ' || v_num || coalesce(' · item ' || public.nz(i->>'n'), '')));
      end if;
      v_pecas := v_pecas + 1;
      if v_cod is not null then
        insert into public.nota_vinculos (fornecedor_id, codigo, peca_id, produto_id) values (v_f, v_cod, public.uid_de(i, 'peca_id'), null)
        on conflict (fornecedor_id, codigo) do update set peca_id = excluded.peca_id, produto_id = null, atualizado_em = now();
      end if;
    elsif v_dest = 'mp' then
      if public.uid_de(i, 'produto_id') is null then raise exception 'Escolha o material do item % (%)', coalesce(i->>'n', '?'), coalesce(i->>'descricao', ''); end if;
      if public.uid_de(i, 'pedido_item_id') is not null then
        -- chegou de um pedido de compra de matéria-prima: recebe por ele (o R.I. nasce no recebimento e o pedido é baixado)
        select pedido_id::text into v_pid from public.pedido_itens where id = public.uid_de(i, 'pedido_item_id') and produto_id = public.uid_de(i, 'produto_id');
        if v_pid is null then raise exception 'O item % não é deste pedido de compra', coalesce(i->>'n', '?'); end if;
        v_ped := jsonb_set(v_ped, array[v_pid], coalesce(v_ped->v_pid, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('item_id', i->>'pedido_item_id', 'qtd', v_q,
                   'status', coalesce(public.nz(i->>'status'), 'Aprovado'), 'obs', public.nz(i->>'descricao'))));
      else
        r := public.salvar_lote(jsonb_build_object('produto_id', i->>'produto_id', 'qtd', v_q, 'data', v_data, 'nota', v_num, 'fornecedor_id', v_f,
          'pedido', public.nz(i->>'pedido'), 'status', coalesce(public.nz(i->>'status'), 'Aprovado'),
          'obs', 'Nota fiscal ' || v_num || coalesce(' · ' || public.nz(i->>'descricao'), '')));
        v_ris := v_ris || jsonb_build_array(r->'ri');
      end if;
      if v_cod is not null then
        insert into public.nota_vinculos (fornecedor_id, codigo, peca_id, produto_id) values (v_f, v_cod, null, public.uid_de(i, 'produto_id'))
        on conflict (fornecedor_id, codigo) do update set produto_id = excluded.produto_id, peca_id = null, atualizado_em = now();
      end if;
    end if;
    v_resumo := v_resumo || jsonb_build_array(jsonb_build_object('n', i->'n', 'codigo', v_cod, 'descricao', public.nz(i->>'descricao'), 'destino', v_dest,
      'qtd', v_q, 'unidade', public.nz(i->>'unidade'), 'valor', public.num(i, 'valor'), 'peca_id', public.uid_de(i, 'peca_id'),
      'produto_id', public.uid_de(i, 'produto_id'), 'ri', r->'ri'));
  end loop;
  for v_pid in select jsonb_object_keys(v_ped) loop
    r := public.receber_pedido(jsonb_build_object('pedido_id', v_pid, 'chave', gen_random_uuid(), 'data', v_data, 'documento', v_doc, 'nota', v_num, 'itens', v_ped->v_pid));
    v_ris := v_ris || coalesce(r->'ris', '[]'::jsonb);
  end loop;

  -- parcelas da nota (duplicatas) viram contas a pagar
  v_n := case when jsonb_typeof(p->'contas') = 'array' then jsonb_array_length(p->'contas') else 0 end;
  if v_n > 0 then
    if not public.eh('dono','escritorio') then raise exception 'Só o Dono ou o Escritório lançam a conta a pagar. Lance sem a conta; o escritório lança depois.'; end if;
    if v_n > 120 then raise exception 'Parcelas demais'; end if;
    v_grupo := case when v_n > 1 then gen_random_uuid() end;
    for c in select * from jsonb_array_elements(p->'contas') loop
      v_k := v_k + 1; v_val := public.num(c, 'valor'); v_venc := public.dt(c, 'vencimento');
      if v_val is null or v_val <= 0 or v_venc is null then raise exception 'A parcela % está sem valor ou sem vencimento', v_k; end if;
      insert into public.lancamentos (tipo, descricao, categoria, valor, vencimento, fornecedor_id, documento, parcela, grupo, obs)
      values ('pagar', 'Compra - ' || v_doc || ' - ' || v_fnome, coalesce(public.nz(p->>'categoria'), 'Compras / almoxarifado'), round(v_val, 2), v_venc,
              v_f, v_doc, case when v_n > 1 then v_k || '/' || v_n end, v_grupo, 'Lançada pela nota fiscal (arquivo XML)');
    end loop;
  end if;
  if v_pecas = 0 and jsonb_array_length(v_ris) = 0 and v_k = 0 and v_ped = '{}'::jsonb then raise exception 'Escolha onde lançar pelo menos um item da nota'; end if;

  insert into public.notas_fiscais (id, chave, numero, serie, emissao, data, fornecedor_id, fornecedor_nome, valor, itens, obs)
  values (v_id, v_chave, v_num, public.nz(p->>'serie'), public.dt(p, 'emissao'), v_data, v_f, v_fnome, round(public.num(p, 'valor'), 2), v_resumo, public.nzt(p->>'obs'));
  return jsonb_build_object('id', v_id, 'fornecedor_id', v_f, 'documento', v_doc, 'pecas', v_pecas, 'ris', v_ris, 'contas', v_k);
end $$;

-- ---------------------------------------------------------------------
-- processo do produto: sugerir, salvar; passos da OF: marcar e refazer
-- ---------------------------------------------------------------------
create or replace function public.processo_sugerido(p_prod uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir('dono','escritorio','tecnico','pcp');
  return public._passos_de(p_prod, 0);
end $$;

-- p: {produto_id, passos:[{operacao, peca, maquina_id}]} (lista vazia = volta a montar pela estrutura)
create or replace function public.salvar_processo(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_prod uuid := public.uid_de(p, 'produto_id'); x jsonb; n int := 0; v jsonb := '[]'; v_m uuid;
begin
  perform public.exigir('dono','escritorio','tecnico','pcp');
  if not exists (select 1 from public.produtos where id = v_prod) then raise exception 'Produto não encontrado'; end if;
  if jsonb_typeof(p->'passos') <> 'array' then raise exception 'Passo a passo inválido'; end if;
  if jsonb_array_length(p->'passos') > 60 then raise exception 'Passos demais (máximo 60)'; end if;
  for x in select * from jsonb_array_elements(p->'passos') loop
    n := n + 1;
    if public.nz(x->>'operacao') is null then raise exception 'Escreva o que se faz no passo %', n; end if;
    if length(x->>'operacao') > 200 then raise exception 'O passo % ficou comprido demais', n; end if;
    v_m := public.uid_de(x, 'maquina_id');
    if v_m is not null and not exists (select 1 from public.maquinas where id = v_m) then raise exception 'Máquina do passo % não encontrada', n; end if;
    v := v || jsonb_build_array(jsonb_build_object('operacao', public.nz(x->>'operacao'), 'peca', public.nz(x->>'peca'), 'maquina_id', v_m));
  end loop;
  update public.produtos set processo = case when n = 0 then null else v end where id = v_prod;
end $$;

-- marcar (ou desmarcar) um passo feito na OF
create or replace function public.marcar_passo_of(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.ofs; v_n int := public.num(p, 'n')::int; v_f boolean := coalesce((p->>'feito')::boolean, true);
begin
  perform public.exigir('dono','escritorio','pcp','producao','gerente');
  select * into o from public.ofs where id = public.uid_de(p, 'id') for update;
  if o.id is null then raise exception 'OF não encontrada'; end if;
  if o.status <> 'aberta' then raise exception 'A OF % está %: reabra para marcar', o.numero, o.status; end if;
  if not exists (select 1 from jsonb_array_elements(o.passos) x where (x->>'n')::int = v_n) then raise exception 'Passo não encontrado'; end if;
  update public.ofs set passos = (
           select jsonb_agg(case when (x->>'n')::int = v_n
                                 then x || jsonb_build_object('feito', v_f, 'feito_por', case when v_f then public.meu_nome() end,
                                                              'feito_em', case when v_f then to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') end)
                                 else x end order by o2)
             from jsonb_array_elements(o.passos) with ordinality t(x, o2))
   where id = o.id
  returning passos into o.passos;
  return o.passos;
end $$;

-- trocar o passo a passo da OF pelo atual do produto (antes de começar)
create or replace function public.refazer_passos_of(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.ofs;
begin
  perform public.exigir('dono','escritorio','pcp');
  select * into o from public.ofs where id = p_id for update;
  if o.id is null then raise exception 'OF não encontrada'; end if;
  if o.status <> 'aberta' then raise exception 'A OF % está %', o.numero, o.status; end if;
  if exists (select 1 from jsonb_array_elements(o.passos) x where (x->>'feito')::boolean) then
    raise exception 'Esta OF já tem passo marcado como feito: não dá para trocar o passo a passo';
  end if;
  update public.ofs set passos = public._passos_of(o.produto_id) where id = o.id returning passos into o.passos;
  return o.passos;
end $$;

-- ---------------------------------------------------------------------
-- pedido de compra (peças do almoxarifado OU matéria-prima)
-- p: {id, tipo:'pecas'|'mp', fornecedor_id, data, prazo, documento, frete, obs,
--     itens:[{id, peca_id | produto_id, qtd, valor (total da linha)}], necessidades:[id]}
-- ---------------------------------------------------------------------
create or replace function public.salvar_pedido(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_ped public.pedidos_compra; i jsonb; n int := 0;
        v_qtd numeric; v_val numeric; v_item uuid; v_manter uuid[] := '{}'; v_tipo text; v_peca uuid; v_prod uuid;
begin
  perform public.exigir('dono','escritorio','almoxarife','comercial');
  select * into v_ped from public.pedidos_compra where id = v_id for update;
  v_tipo := coalesce(v_ped.tipo, public.nz(p->>'tipo'), 'pecas');
  if v_tipo not in ('pecas','mp') then raise exception 'Tipo de pedido inválido'; end if;
  if v_tipo = 'pecas' and not public.eh('dono','escritorio','almoxarife') then raise exception 'Seu perfil faz pedido de compra de matéria-prima'; end if;
  if public.uid_de(p, 'fornecedor_id') is null then raise exception 'Escolha o fornecedor'; end if;
  if jsonb_typeof(p -> 'itens') <> 'array' or jsonb_array_length(p -> 'itens') = 0 then
    raise exception '%', case when v_tipo = 'mp' then 'Coloque pelo menos um material no pedido' else 'Coloque pelo menos uma peça no pedido' end;
  end if;
  if v_ped.id is not null and v_ped.status <> 'aguardando' then raise exception 'Pedido % já foi % e não pode ser alterado', v_ped.numero, v_ped.status; end if;
  if v_ped.id is null then
    insert into public.pedidos_compra (id, tipo, data, fornecedor_id, documento, prazo, frete, obs)
    values (v_id, v_tipo, public.dt(p, 'data', public.hoje()), public.uid_de(p, 'fornecedor_id'), public.nz(p->>'documento'),
            public.dt(p, 'prazo'), coalesce(public.num(p, 'frete'), 0), public.nzt(p->>'obs'));
  else
    update public.pedidos_compra set data = public.dt(p, 'data', data), fornecedor_id = public.uid_de(p, 'fornecedor_id'),
           documento = public.nz(p->>'documento'), prazo = public.dt(p, 'prazo'), frete = coalesce(public.num(p, 'frete'), 0),
           obs = public.nzt(p->>'obs')
     where id = v_id;
  end if;
  for i in select * from jsonb_array_elements(p -> 'itens') loop
    n := n + 1;
    v_qtd := public.num(i, 'qtd'); v_val := coalesce(public.num(i, 'valor'), 0);
    v_peca := public.uid_de(i, 'peca_id'); v_prod := public.uid_de(i, 'produto_id');
    if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade inválida na linha %', n; end if;
    if v_val < 0 then raise exception 'Valor inválido na linha %', n; end if;
    if v_tipo = 'pecas' then
      v_prod := null;
      if not exists (select 1 from public.pecas where id = v_peca) then raise exception 'Peça não encontrada na linha %', n; end if;
    else
      v_peca := null;
      if not exists (select 1 from public.produtos where id = v_prod) then raise exception 'Material não encontrado na linha %', n; end if;
    end if;
    v_item := public.uid_de(i, 'id');
    if v_item is not null and exists (select 1 from public.pedido_itens where id = v_item and pedido_id = v_id) then
      update public.pedido_itens set peca_id = v_peca, produto_id = v_prod, qtd = v_qtd, valor = round(v_val, 2), ordem = n
       where id = v_item;
      if (select recebido from public.pedido_itens where id = v_item) > v_qtd then
        raise exception 'Na linha % já chegou mais do que a nova quantidade', n;
      end if;
    else
      v_item := coalesce(v_item, gen_random_uuid());
      insert into public.pedido_itens (id, pedido_id, peca_id, produto_id, qtd, valor, ordem) values (v_item, v_id, v_peca, v_prod, v_qtd, round(v_val, 2), n);
    end if;
    v_manter := v_manter || v_item;
  end loop;
  if exists (select 1 from public.pedido_itens where pedido_id = v_id and not (id = any(v_manter)) and recebido > 0) then
    raise exception 'Não dá para tirar do pedido um item que já chegou';
  end if;
  delete from public.pedido_itens where pedido_id = v_id and not (id = any(v_manter));
  -- necessidades atendidas por este pedido
  if jsonb_typeof(p->'necessidades') = 'array' then
    update public.necessidades set status = 'pedido', pedido_id = v_id
     where status = 'aberta' and id in (select (x #>> '{}')::uuid from jsonb_array_elements(p->'necessidades') x);
  end if;
  return jsonb_build_object('id', v_id, 'numero', (select numero from public.pedidos_compra where id = v_id));
end $$;

-- Recebe (total ou parcial). Peça: entra no estoque do almoxarifado. Matéria-prima: nasce o R.I.
-- (entrada de matéria-prima) com o número do pedido. Se pedir, lança a conta a pagar.
-- p: {pedido_id, chave, data, documento, nota, itens:[{item_id, qtd, status, obs}], encerrar, conta:{vencimento, valor, parcelas}}
create or replace function public.receber_pedido(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ped public.pedidos_compra; i jsonb; it public.pedido_itens; v_qtd numeric; v_total numeric := 0; v_n int := 0;
        v_doc text; v_data date := public.dt(p, 'data', public.hoje()); v_conta jsonb := p -> 'conta';
        v_chave uuid := public.uid_de(p, 'chave'); r jsonb; v_ris jsonb := '[]';
begin
  perform public.exigir('dono','escritorio','almoxarife','comercial');
  -- envio repetido (internet caiu e o site mandou de novo): não recebe duas vezes
  if v_chave is not null and (exists (select 1 from public.recebimentos where chave = v_chave)
                              or exists (select 1 from public.movimentos where chave = v_chave)) then
    return jsonb_build_object('repetido', true, 'status', (select status from public.pedidos_compra where id = public.uid_de(p, 'pedido_id')));
  end if;
  select * into v_ped from public.pedidos_compra where id = public.uid_de(p, 'pedido_id') for update;
  if v_ped.id is null then raise exception 'Pedido não encontrado'; end if;
  if v_ped.status <> 'aguardando' then raise exception 'Pedido % já está %', v_ped.numero, v_ped.status; end if;
  if v_data > public.hoje() then raise exception 'A data não pode ser no futuro'; end if;
  if v_conta is not null and jsonb_typeof(v_conta) = 'object' and not public.eh('dono','escritorio') then
    raise exception 'Só o Dono ou o Escritório lançam a conta a pagar. Receba sem a conta; o escritório lança depois.';
  end if;
  if v_ped.tipo = 'pecas' and not public.eh('dono','escritorio','almoxarife') then raise exception 'Peças do almoxarifado são recebidas pelo almoxarifado'; end if;
  if v_chave is not null then insert into public.recebimentos (chave, pedido_id) values (v_chave, v_ped.id); end if;
  v_doc := coalesce(public.nz(p->>'documento'), v_ped.documento, 'Pedido ' || v_ped.numero);
  for i in select * from jsonb_array_elements(coalesce(p -> 'itens', '[]'::jsonb)) loop
    v_qtd := coalesce(public.num(i, 'qtd'), 0);
    continue when v_qtd = 0;
    if v_qtd < 0 then raise exception 'Quantidade recebida não pode ser negativa'; end if;
    select * into it from public.pedido_itens where id = public.uid_de(i, 'item_id') and pedido_id = v_ped.id for update;
    if it.id is null then raise exception 'Item não pertence a este pedido'; end if;
    if it.peca_id is not null then
      insert into public.movimentos (data, peca_id, tipo, qtd, preco_unit, fornecedor_id, documento, motivo, pedido_item_id, obs, chave)
      values (v_data, it.peca_id, 'entrada', v_qtd, round(it.valor / it.qtd, 4), v_ped.fornecedor_id, v_doc, 'compra', it.id,
              'Pedido de compra nº ' || v_ped.numero, v_chave);
    else
      r := public.salvar_lote(jsonb_build_object('produto_id', it.produto_id, 'qtd', v_qtd, 'data', v_data,
             'nota', coalesce(public.nz(p->>'nota'), public.nz(p->>'documento')), 'fornecedor_id', v_ped.fornecedor_id,
             'pedido', v_ped.numero::text, 'status', coalesce(public.nz(i->>'status'), 'Aguardando'),
             'obs', concat_ws(' · ', 'Pedido de compra nº ' || v_ped.numero, public.nz(i->>'obs'))));
      update public.mp_lotes set pedido_item_id = it.id where id = (r->>'id')::uuid;
      v_ris := v_ris || jsonb_build_array(r->'ri');
    end if;
    update public.pedido_itens set recebido = recebido + v_qtd where id = it.id;
    v_total := v_total + round(v_qtd * it.valor / it.qtd, 2); v_n := v_n + 1;
  end loop;
  if v_n = 0 and not coalesce((p->>'encerrar')::boolean, false) then raise exception 'Informe quanto chegou de pelo menos um item'; end if;
  if coalesce((p->>'encerrar')::boolean, false)
     or not exists (select 1 from public.pedido_itens where pedido_id = v_ped.id and recebido < qtd) then
    update public.pedidos_compra set status = 'recebido', recebido_em = v_data where id = v_ped.id;
  else
    update public.pedidos_compra set atualizado_em = now() where id = v_ped.id;   -- avisa os outros aparelhos
  end if;
  if v_conta is not null and jsonb_typeof(v_conta) = 'object' and coalesce(public.num(v_conta, 'valor'), 0) > 0 then
    perform public.salvar_lancamento(jsonb_build_object('tipo', 'pagar', 'descricao', 'Compra - pedido nº ' || v_ped.numero,
      'categoria', case when v_ped.tipo = 'mp' then 'Compras / matéria-prima' else 'Compras / almoxarifado' end,
      'valor', public.num(v_conta, 'valor'), 'vencimento', coalesce(v_conta->>'vencimento', v_data::text),
      'parcelas', coalesce(v_conta->>'parcelas', '1'), 'intervalo', coalesce(v_conta->>'intervalo', '30'),
      'fornecedor_id', v_ped.fornecedor_id, 'pedido_id', v_ped.id, 'documento', v_doc));
  end if;
  return jsonb_build_object('entradas', v_n, 'valor', v_total, 'ris', v_ris,
                            'status', (select status from public.pedidos_compra where id = v_ped.id));
end $$;

create or replace function public.cancelar_pedido(p_id uuid, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_ped public.pedidos_compra;
begin
  perform public.exigir('dono','escritorio','almoxarife','comercial');
  select * into v_ped from public.pedidos_compra where id = p_id for update;
  if v_ped.id is null then raise exception 'Pedido não encontrado'; end if;
  if v_ped.status <> 'aguardando' then raise exception 'Só dá para cancelar pedido que está aguardando'; end if;
  if v_ped.tipo = 'pecas' and not public.eh('dono','escritorio','almoxarife') then raise exception 'Pedido de peças é com o almoxarifado'; end if;
  if exists (select 1 from public.pedido_itens where pedido_id = p_id and recebido > 0) then
    -- parte já chegou: encerra com o que chegou
    update public.pedidos_compra set status = 'recebido', recebido_em = public.hoje(),
           obs = concat_ws(E'\n', obs, 'Encerrado sem receber o resto' || coalesce(': ' || public.nz(p_motivo), '')) where id = p_id;
  else
    update public.pedidos_compra set status = 'cancelado',
           obs = concat_ws(E'\n', obs, 'Cancelado' || coalesce(': ' || public.nz(p_motivo), '')) where id = p_id;
    -- o que este pedido ia atender volta para a lista de compra (não se perde)
    update public.necessidades set status = 'aberta', pedido_id = null where pedido_id = p_id and status = 'pedido';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- necessidade de compra
-- p: {id, produto_id, qtd, prazo, motivo}
-- ---------------------------------------------------------------------
create or replace function public.salvar_necessidade(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_old public.necessidades; v_q numeric := public.num(p, 'qtd');
begin
  perform public.exigir('dono','escritorio','pcp','comercial');
  select * into v_old from public.necessidades where id = v_id for update;
  if v_old.id is not null and v_old.status <> 'aberta' then raise exception 'Esta necessidade já virou pedido ou foi cancelada'; end if;
  if not exists (select 1 from public.produtos where id = public.uid_de(p, 'produto_id')) then raise exception 'Escolha o material'; end if;
  if v_q is null or v_q <= 0 then raise exception 'Informe a quantidade'; end if;
  insert into public.necessidades (id, produto_id, qtd, prazo, motivo, criado_nome)
  values (v_id, public.uid_de(p, 'produto_id'), v_q, public.dt(p, 'prazo'), public.nzt(p->>'motivo'), public.meu_nome())
  on conflict (id) do update set produto_id = excluded.produto_id, qtd = excluded.qtd, prazo = excluded.prazo, motivo = excluded.motivo;
  return v_id;
end $$;

create or replace function public.cancelar_necessidade(p_id uuid, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir('dono','escritorio','pcp','comercial');
  update public.necessidades set status = 'cancelada', motivo = concat_ws(E'\n', motivo, 'Cancelada' || coalesce(': ' || public.nz(p_motivo), ''))
   where id = p_id and status = 'aberta';
  if not found then raise exception 'Só dá para cancelar necessidade que ainda está aberta'; end if;
end $$;

-- ---------------------------------------------------------------------
-- permissões das funções novas e das refeitas
-- ---------------------------------------------------------------------
revoke all on function public._passos_de(uuid, int), public._passos_of(uuid) from public, anon, authenticated;
revoke all on function public.processo_sugerido(uuid), public.salvar_processo(jsonb), public.marcar_passo_of(jsonb), public.refazer_passos_of(uuid),
                       public.salvar_pedido(jsonb), public.receber_pedido(jsonb), public.cancelar_pedido(uuid, text),
                       public.salvar_necessidade(jsonb), public.cancelar_necessidade(uuid, text) from public, anon;
grant execute on function public.processo_sugerido(uuid), public.salvar_processo(jsonb), public.marcar_passo_of(jsonb), public.refazer_passos_of(uuid),
                          public.salvar_pedido(jsonb), public.receber_pedido(jsonb), public.cancelar_pedido(uuid, text),
                          public.salvar_necessidade(jsonb), public.cancelar_necessidade(uuid, text) to authenticated;
