-- =====================================================================
--  JAF Metal — banco de dados (Supabase / PostgreSQL)
--  Pode ser rodado de novo sem perder dados (tudo é "if not exists" /
--  "create or replace").
--
--  Regras gerais:
--  * O site NUNCA grava direto nas tabelas: toda gravação passa por uma
--    função deste arquivo, que confere o perfil de quem está logado e os
--    dados antes de gravar (as tabelas só têm regra de LEITURA).
--  * Estoque = soma das movimentações. A coluna pecas.estoque é mantida
--    por gatilho na mesma transação; movimentação não se apaga nem se
--    edita: corrige-se com um estorno (fica no histórico).
--  * Datas "de hoje" usam o fuso de São Paulo (o servidor roda em UTC).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Apoio
-- ---------------------------------------------------------------------
create or replace function public.hoje() returns date
language sql stable set search_path = public as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- texto limpo: tira espaços das pontas; vazio vira nulo
create or replace function public.nz(p text) returns text
language sql immutable set search_path = public as $$ select nullif(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')), '') $$;

-- texto longo (observações): só tira os espaços das pontas; mantém as quebras de linha
create or replace function public.nzt(p text) returns text
language sql immutable set search_path = public as $$ select nullif(btrim(coalesce(p, ''), E' \t\r\n'), '') $$;

create or replace function public.num(p jsonb, k text, padrao numeric default null) returns numeric
language plpgsql immutable set search_path = public as $$
declare t text := nullif(btrim(coalesce(p ->> k, '')), '');
begin
  if t is null then return padrao; end if;
  -- aceita 1234.5 (o site manda o número já convertido) e também 1.234,50 / 1234,5.
  -- Sem vírgula, o ponto é decimal ("5.000" vindo do próprio banco = cinco): quem digita "3.200" é o site que converte.
  if position(',' in t) > 0 then t := replace(replace(t, '.', ''), ',', '.'); end if;
  return t::numeric;
exception when others then
  raise exception 'Número inválido em "%": %', k, t;
end $$;

create or replace function public.dt(p jsonb, k text, padrao date default null) returns date
language plpgsql immutable set search_path = public as $$
declare t text := nullif(btrim(coalesce(p ->> k, '')), '');
begin
  if t is null then return padrao; end if;
  return t::date;
exception when others then
  raise exception 'Data inválida em "%": %', k, t;
end $$;

create or replace function public.uid_de(p jsonb, k text) returns uuid
language plpgsql immutable set search_path = public as $$
declare t text := nullif(btrim(coalesce(p ->> k, '')), '');
begin
  if t is null then return null; end if;
  return t::uuid;
exception when others then
  raise exception 'Identificador inválido em "%"', k;
end $$;

-- ---------------------------------------------------------------------
-- Perfis de acesso
--   dono       : tudo, inclusive acessos e importação
--   escritorio : tudo menos acessos/importação
--   almoxarife : almoxarifado (peças, movimentações, máquinas e manutenção), compras, fornecedores
--   pcp        : planejamento e controle da produção — ordens de produção; consulta estoque e clientes
--   producao   : retirar peça, ver estoque, atualizar ordens de produção, manutenção
--   rh         : só o RH (pessoas, ponto, férias, treinamentos, EPI/ASO, disciplina)
--   gerente    : gerente de fábrica — consulta o RH (sem dados pessoais), o almoxarifado e o PCP
-- ---------------------------------------------------------------------
create table if not exists public.perfis (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  nome           text not null,
  login          text not null unique,
  perfil         text not null,
  funcionario_id uuid,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now()
);
-- senha provisória (criada pelo Dono): o sistema obriga a trocar no primeiro acesso
alter table public.perfis add column if not exists trocar_senha boolean not null default false;
alter table public.perfis drop constraint if exists perfis_perfil_check;
alter table public.perfis add constraint perfis_perfil_check check (perfil in ('dono','escritorio','almoxarife','pcp','producao','rh','gerente','tecnico','manutencao','comercial'));

create or replace function public.meu_perfil() returns text
language sql stable security definer set search_path = public as
$$ select perfil from public.perfis where user_id = auth.uid() and ativo $$;

create or replace function public.eh(variadic p text[]) returns boolean
language sql stable set search_path = public as $$ select coalesce(public.meu_perfil() = any(p), false) $$;

create or replace function public.exigir(variadic p text[]) returns void
language plpgsql stable set search_path = public as $$
begin
  if public.meu_perfil() is null then raise exception 'Sua sessão não tem acesso. Entre de novo.'; end if;
  if not public.eh(variadic p) then raise exception 'Seu perfil não pode fazer isso.'; end if;
end $$;

create or replace function public.meu_nome() returns text
language sql stable security definer set search_path = public as
$$ select nome from public.perfis where user_id = auth.uid() $$;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table if not exists public.config (
  chave         text primary key,
  valor         jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.fornecedores (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  razao           text,
  tipo            text not null default 'Peças' check (tipo in ('Peças','Serviço','Peças e serviço')),
  contato         text,
  contato2        text,
  telefone        text,
  celular         text,
  email           text,
  site            text,
  endereco        text,
  bairro          text,
  cidade          text,
  uf              text,
  cep             text,
  cnpj            text,
  ie              text,
  qualificacao    text check (qualificacao in ('Aprovado','Em avaliação','Reprovado')),
  qualif_metodo   text,
  qualif_validade date,
  obs             text,
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create unique index if not exists fornecedores_nome_un on public.fornecedores (lower(nome));

create table if not exists public.funcionarios (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  funcao        text,
  setor         text,
  telefone      text,
  admissao      date,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- dados pessoais e salário: só Dono e Escritório
create table if not exists public.funcionarios_privado (
  funcionario_id uuid primary key references public.funcionarios(id) on delete cascade,
  salario        numeric(12,2) check (salario is null or salario >= 0),
  cpf            text,
  rg             text,
  nascimento     date,
  endereco       text,
  pix            text,
  ferias         jsonb not null default '[]'::jsonb,   -- [{inicio, fim, obs}]
  obs            text,
  atualizado_em  timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'perfis_funcionario_fk') then
    alter table public.perfis add constraint perfis_funcionario_fk foreign key (funcionario_id) references public.funcionarios(id) on delete set null;
  end if;
end $$;

create table if not exists public.maquinas (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  tipo            text,
  fabricante      text,
  modelo          text,
  numero_serie    text,
  setor           text,
  ano             int,
  preventiva_dias int check (preventiva_dias is null or preventiva_dias > 0),
  obs             text,
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
-- (a partir da v2.5 a máquina tem código e o nome pode repetir: este índice só vale para bancos antigos)
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maquinas' and column_name = 'codigo') then
    create unique index if not exists maquinas_nome_un on public.maquinas (lower(nome));
  end if;
end $$;

create table if not exists public.pecas (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null,
  descricao     text not null,
  utilizacao    text,
  fornecedor_id uuid references public.fornecedores(id) on delete set null,
  unidade       text not null default 'un',
  est_min       numeric(12,3) not null default 0 check (est_min >= 0),
  est_max       numeric(12,3) not null default 0 check (est_max >= 0),
  local         text,
  obs           text,
  ativo         boolean not null default true,
  estoque       numeric(12,3) not null default 0,   -- mantido pelo gatilho das movimentações
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists pecas_codigo_un on public.pecas (lower(codigo));

create table if not exists public.clientes (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  razao         text,
  cnpj          text,
  contato       text,
  telefone      text,
  email         text,
  cidade        text,
  uf            text,
  obs           text,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists clientes_nome_un on public.clientes (lower(nome));

create sequence if not exists public.pedidos_numero_seq;
create table if not exists public.pedidos_compra (
  id            uuid primary key default gen_random_uuid(),
  numero        int not null unique default nextval('public.pedidos_numero_seq'),
  data          date not null default public.hoje(),
  fornecedor_id uuid not null references public.fornecedores(id),
  documento     text,
  prazo         date,
  status        text not null default 'aguardando' check (status in ('aguardando','recebido','cancelado')),
  frete         numeric(12,2) not null default 0 check (frete >= 0),
  obs           text,
  recebido_em   date,
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.pedido_itens (
  id        uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos_compra(id) on delete cascade,
  peca_id   uuid not null references public.pecas(id),
  qtd       numeric(12,3) not null check (qtd > 0),
  valor     numeric(12,2) not null default 0 check (valor >= 0),   -- valor TOTAL da linha (como na planilha)
  recebido  numeric(12,3) not null default 0 check (recebido >= 0),
  ordem     int not null default 0
);
create index if not exists pedido_itens_pedido on public.pedido_itens (pedido_id);
create index if not exists pedido_itens_peca on public.pedido_itens (peca_id);

create table if not exists public.manutencoes (
  id             uuid primary key default gen_random_uuid(),
  maquina_id     uuid not null references public.maquinas(id),
  data           date not null default public.hoje(),
  tipo           text not null default 'corretiva' check (tipo in ('preventiva','corretiva','melhoria')),
  status         text not null default 'aberta' check (status in ('aberta','andamento','concluida')),
  problema       text not null,
  solucao        text,
  fornecedor_id  uuid references public.fornecedores(id) on delete set null,
  funcionario_id uuid references public.funcionarios(id) on delete set null,
  custo_servico  numeric(12,2) not null default 0 check (custo_servico >= 0),
  horas_parada   numeric(8,2) check (horas_parada is null or horas_parada >= 0),
  concluida_em   date,
  criado_por     uuid default auth.uid(),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists manutencoes_maquina on public.manutencoes (maquina_id);

create table if not exists public.movimentos (
  id             uuid primary key default gen_random_uuid(),
  seq            bigserial,
  data           date not null default public.hoje(),
  peca_id        uuid not null references public.pecas(id),
  tipo           text not null check (tipo in ('entrada','saida')),
  qtd            numeric(12,3) not null check (qtd > 0),
  preco_unit     numeric(14,4) not null default 0 check (preco_unit >= 0),
  fornecedor_id  uuid references public.fornecedores(id) on delete set null,
  documento      text,
  motivo         text not null check (motivo in ('compra','retirada','ajuste','devolucao','importado','estorno')),
  funcionario_id uuid references public.funcionarios(id) on delete set null,
  maquina_id     uuid references public.maquinas(id) on delete set null,
  destino        text,
  pedido_item_id uuid references public.pedido_itens(id) on delete set null,
  manutencao_id  uuid references public.manutencoes(id) on delete set null,
  estorno_de     uuid unique references public.movimentos(id),
  chave          uuid,          -- identifica um envio (recebimento de pedido) para não lançar duas vezes
  obs            text,
  criado_por     uuid default auth.uid(),
  criado_em      timestamptz not null default now()
);
create index if not exists movimentos_peca on public.movimentos (peca_id, data, seq);
create index if not exists movimentos_data on public.movimentos (data);
create index if not exists movimentos_chave on public.movimentos (chave) where chave is not null;

create sequence if not exists public.ordens_numero_seq;
create table if not exists public.ordens (
  id              uuid primary key default gen_random_uuid(),
  numero          int not null unique default nextval('public.ordens_numero_seq'),
  cliente_id      uuid references public.clientes(id) on delete set null,
  cliente_nome    text,
  pedido_cliente  text,
  produto         text not null,
  codigo          text,
  qtd             numeric(12,3) not null check (qtd > 0),
  unidade         text not null default 'pç',
  produzido       numeric(12,3) not null default 0 check (produzido >= 0),
  prazo           date,
  maquina_id      uuid references public.maquinas(id) on delete set null,
  responsavel_id  uuid references public.funcionarios(id) on delete set null,
  prioridade      int not null default 0 check (prioridade in (0,1)),
  status          text not null default 'fila' check (status in ('fila','producao','pronta','entregue','cancelada')),
  obs             text,
  iniciada_em     timestamptz,
  pronta_em       timestamptz,
  entregue_em     date,
  criado_por      uuid default auth.uid(),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

create table if not exists public.lancamentos (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null check (tipo in ('pagar','receber')),
  descricao     text not null,
  categoria     text,
  valor         numeric(12,2) not null check (valor > 0),
  vencimento    date not null,
  pago_em       date,
  valor_pago    numeric(12,2) check (valor_pago is null or valor_pago >= 0),
  forma         text,
  fornecedor_id uuid references public.fornecedores(id) on delete set null,
  cliente_id    uuid references public.clientes(id) on delete set null,
  funcionario_id uuid references public.funcionarios(id) on delete set null,
  pedido_id     uuid references public.pedidos_compra(id) on delete set null,
  ordem_id      uuid references public.ordens(id) on delete set null,
  documento     text,
  parcela       text,
  grupo         uuid,
  obs           text,
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists lancamentos_venc on public.lancamentos (vencimento);

create table if not exists public.historico (
  id        bigserial primary key,
  em        timestamptz not null default now(),
  user_id   uuid,
  quem      text,
  tabela    text not null,
  registro  text,
  acao      text not null,
  antes     jsonb,
  depois    jsonb
);
create index if not exists historico_em on public.historico (em desc);
alter table public.historico add column if not exists ip text;

-- ---------------------------------------------------------------------
-- Gatilhos
-- ---------------------------------------------------------------------
create or replace function public.tg_atualizado() returns trigger
language plpgsql set search_path = public as $$
begin new.atualizado_em := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['config','fornecedores','funcionarios','funcionarios_privado','maquinas','pecas','clientes',
                           'pedidos_compra','manutencoes','ordens','lancamentos'] loop
    execute format('drop trigger if exists tg_atualizado on public.%I', t);
    execute format('create trigger tg_atualizado before update on public.%I for each row execute function public.tg_atualizado()', t);
  end loop;
end $$;

-- histórico de alterações (quem mudou o quê)
create or replace function public.tg_historico() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_reg text; v_antes jsonb; v_depois jsonb;
begin
  if current_setting('jaf.importando', true) = '1' then return null; end if;
  if tg_op <> 'INSERT' then v_antes := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_depois := to_jsonb(new); end if;
  v_reg := coalesce(v_depois, v_antes) ->> (case when tg_table_name = 'config' then 'chave'
                                                 when tg_table_name = 'funcionarios_privado' then 'funcionario_id'
                                                 else 'id' end);
  if tg_op = 'UPDATE' then
    if (v_antes - 'atualizado_em') = (v_depois - 'atualizado_em') then return null; end if;
    if tg_table_name = 'pecas' and (v_antes - 'atualizado_em' - 'estoque') = (v_depois - 'atualizado_em' - 'estoque') then return null; end if;
  end if;
  insert into public.historico (user_id, quem, tabela, registro, acao, antes, depois, ip)
  values (auth.uid(), public.meu_nome(), tg_table_name, v_reg, lower(tg_op), v_antes, v_depois,
          nullif(split_part(coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for', ''), ',', 1), ''));
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['config','fornecedores','funcionarios','funcionarios_privado','maquinas','pecas','clientes',
                           'pedidos_compra','pedido_itens','manutencoes','movimentos','ordens','lancamentos','perfis'] loop
    execute format('drop trigger if exists tg_historico on public.%I', t);
    execute format('create trigger tg_historico after insert or update or delete on public.%I for each row execute function public.tg_historico()', t);
  end loop;
end $$;

-- estoque da peça acompanha cada movimentação (na mesma transação)
create or replace function public.tg_mov_estoque() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.pecas set estoque = estoque + case when new.tipo = 'entrada' then new.qtd else -new.qtd end
     where id = new.peca_id;
    return null;
  end if;
  if current_setting('jaf.importando', true) = '1' and tg_op = 'DELETE' then
    update public.pecas set estoque = estoque - case when old.tipo = 'entrada' then old.qtd else -old.qtd end
     where id = old.peca_id;
    return null;
  end if;
  raise exception 'Movimentação não pode ser alterada nem apagada. Use "Desfazer" (estorno).';
end $$;
drop trigger if exists tg_mov_estoque on public.movimentos;
create trigger tg_mov_estoque after insert or update or delete on public.movimentos
  for each row execute function public.tg_mov_estoque();

-- ---------------------------------------------------------------------
-- Segurança de leitura (RLS). Gravação só pelas funções.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['perfis','config','fornecedores','funcionarios','funcionarios_privado','maquinas','pecas','clientes',
                           'pedidos_compra','pedido_itens','manutencoes','movimentos','ordens','lancamentos','historico'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
revoke all on sequence public.pedidos_numero_seq, public.ordens_numero_seq from anon, authenticated;

drop policy if exists ler on public.perfis;
create policy ler on public.perfis for select to authenticated using (user_id = auth.uid() or public.eh('dono'));
drop policy if exists ler on public.config;
create policy ler on public.config for select to authenticated using (public.meu_perfil() is not null);
drop policy if exists ler on public.fornecedores;
create policy ler on public.fornecedores for select to authenticated using (public.eh('dono','escritorio','almoxarife'));
drop policy if exists ler on public.funcionarios;
create policy ler on public.funcionarios for select to authenticated using (public.meu_perfil() is not null);
drop policy if exists ler on public.funcionarios_privado;
create policy ler on public.funcionarios_privado for select to authenticated using (public.eh('dono','escritorio','rh'));
drop policy if exists ler on public.maquinas;
create policy ler on public.maquinas for select to authenticated using (public.eh('dono','escritorio','almoxarife','pcp','producao','gerente'));
drop policy if exists ler on public.pecas;
create policy ler on public.pecas for select to authenticated using (public.eh('dono','escritorio','almoxarife','pcp','producao','gerente'));
drop policy if exists ler on public.clientes;
create policy ler on public.clientes for select to authenticated using (public.eh('dono','escritorio','pcp'));
drop policy if exists ler on public.pedidos_compra;
create policy ler on public.pedidos_compra for select to authenticated using (public.eh('dono','escritorio','almoxarife'));
drop policy if exists ler on public.pedido_itens;
create policy ler on public.pedido_itens for select to authenticated using (public.eh('dono','escritorio','almoxarife'));
drop policy if exists ler on public.manutencoes;
create policy ler on public.manutencoes for select to authenticated using (public.eh('dono','escritorio','almoxarife','producao','gerente'));
drop policy if exists ler on public.movimentos;
create policy ler on public.movimentos for select to authenticated
  using (public.eh('dono','escritorio','almoxarife') or (public.eh('producao','gerente') and criado_por = auth.uid()));
drop policy if exists ler on public.ordens;
create policy ler on public.ordens for select to authenticated using (public.eh('dono','escritorio','almoxarife','pcp','producao','gerente'));
drop policy if exists ler on public.lancamentos;
create policy ler on public.lancamentos for select to authenticated using (public.eh('dono','escritorio'));
drop policy if exists ler on public.historico;
create policy ler on public.historico for select to authenticated
  using (public.eh('dono') or (public.eh('escritorio','rh') and (tabela like 'rh\_%' or tabela in ('funcionarios','funcionarios_privado'))));

-- nomes de quem tem acesso (para mostrar "quem lançou" sem abrir a tabela de acessos)
create or replace function public.nomes_usuarios() returns table (user_id uuid, nome text)
language sql stable security definer set search_path = public as
$$ select p.user_id, p.nome from public.perfis p where public.meu_perfil() is not null $$;

-- ---------------------------------------------------------------------
-- Configurações
-- ---------------------------------------------------------------------
create or replace function public.salvar_config(p_chave text, p_valor jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir('dono','escritorio','rh');
  if p_chave <> 'rh' then perform public.exigir('dono','escritorio'); end if;
  if p_chave not in ('empresa','categorias','saldo_inicial','preferencias','rh') then raise exception 'Configuração desconhecida'; end if;
  if p_chave = 'rh' then perform public.exigir('dono','escritorio','rh'); end if;
  insert into public.config (chave, valor) values (p_chave, coalesce(p_valor, '{}'::jsonb))
  on conflict (chave) do update set valor = excluded.valor;
end $$;

-- ---------------------------------------------------------------------
-- Cadastros
-- ---------------------------------------------------------------------
create or replace function public.salvar_fornecedor(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_nome text := public.nz(p ->> 'nome');
begin
  perform public.exigir('dono','escritorio','almoxarife');
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

create or replace function public.salvar_peca(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_cod text := public.nz(p ->> 'codigo');
        v_min numeric := coalesce(public.num(p, 'est_min'), 0); v_max numeric := coalesce(public.num(p, 'est_max'), 0);
begin
  perform public.exigir('dono','escritorio','almoxarife');
  if v_cod is null then raise exception 'Informe o código da peça'; end if;
  if public.nz(p->>'descricao') is null then raise exception 'Informe a descrição da peça'; end if;
  if v_min < 0 or v_max < 0 then raise exception 'Estoque mínimo e máximo não podem ser negativos'; end if;
  if v_max > 0 and v_max < v_min then raise exception 'O estoque máximo (%) é menor que o mínimo (%)', v_max, v_min; end if;
  if exists (select 1 from public.pecas where lower(codigo) = lower(v_cod) and id <> v_id) then
    raise exception 'Já existe uma peça com o código "%"', v_cod;
  end if;
  insert into public.pecas (id, codigo, descricao, utilizacao, fornecedor_id, unidade, est_min, est_max, local, obs, ativo)
  values (v_id, v_cod, public.nz(p->>'descricao'), public.nz(p->>'utilizacao'), public.uid_de(p, 'fornecedor_id'),
          coalesce(public.nz(p->>'unidade'), 'un'), v_min, v_max, public.nz(p->>'local'), public.nzt(p->>'obs'),
          coalesce((p->>'ativo')::boolean, true))
  on conflict (id) do update set codigo = excluded.codigo, descricao = excluded.descricao, utilizacao = excluded.utilizacao,
          fornecedor_id = excluded.fornecedor_id, unidade = excluded.unidade, est_min = excluded.est_min, est_max = excluded.est_max,
          local = excluded.local, obs = excluded.obs, ativo = excluded.ativo;
  return v_id;
end $$;

create or replace function public.salvar_maquina(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_nome text := public.nz(p ->> 'nome');
begin
  perform public.exigir('dono','escritorio','almoxarife');
  if v_nome is null then raise exception 'Informe o nome da máquina'; end if;
  if exists (select 1 from public.maquinas where lower(nome) = lower(v_nome) and id <> v_id) then
    raise exception 'Já existe uma máquina chamada "%"', v_nome;
  end if;
  insert into public.maquinas (id, nome, tipo, fabricante, modelo, numero_serie, setor, ano, preventiva_dias, obs, ativo)
  values (v_id, v_nome, public.nz(p->>'tipo'), public.nz(p->>'fabricante'), public.nz(p->>'modelo'), public.nz(p->>'numero_serie'),
          public.nz(p->>'setor'), public.num(p, 'ano')::int, nullif(public.num(p, 'preventiva_dias')::int, 0), public.nzt(p->>'obs'),
          coalesce((p->>'ativo')::boolean, true))
  on conflict (id) do update set nome = excluded.nome, tipo = excluded.tipo, fabricante = excluded.fabricante, modelo = excluded.modelo,
          numero_serie = excluded.numero_serie, setor = excluded.setor, ano = excluded.ano, preventiva_dias = excluded.preventiva_dias,
          obs = excluded.obs, ativo = excluded.ativo;
  return v_id;
end $$;

create or replace function public.salvar_cliente(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_nome text := public.nz(p ->> 'nome');
begin
  perform public.exigir('dono','escritorio');
  if v_nome is null then raise exception 'Informe o nome do cliente'; end if;
  if exists (select 1 from public.clientes where lower(nome) = lower(v_nome) and id <> v_id) then
    raise exception 'Já existe um cliente chamado "%"', v_nome;
  end if;
  insert into public.clientes (id, nome, razao, cnpj, contato, telefone, email, cidade, uf, obs, ativo)
  values (v_id, v_nome, public.nz(p->>'razao'), public.nz(p->>'cnpj'), public.nz(p->>'contato'), public.nz(p->>'telefone'),
          lower(public.nz(p->>'email')), public.nz(p->>'cidade'), upper(public.nz(p->>'uf')), public.nzt(p->>'obs'),
          coalesce((p->>'ativo')::boolean, true))
  on conflict (id) do update set nome = excluded.nome, razao = excluded.razao, cnpj = excluded.cnpj, contato = excluded.contato,
          telefone = excluded.telefone, email = excluded.email, cidade = excluded.cidade, uf = excluded.uf, obs = excluded.obs,
          ativo = excluded.ativo;
  update public.ordens set cliente_nome = v_nome where cliente_id = v_id and cliente_nome is distinct from v_nome;
  return v_id;
end $$;


-- ---------------------------------------------------------------------
-- Estoque: lotes (PEPS — o que entrou primeiro sai primeiro)
--   Os lotes que ainda estão na prateleira são as entradas mais recentes
--   que somam o estoque atual. A saída consome do lote mais antigo.
-- ---------------------------------------------------------------------
-- uso interno (sem conferir perfil): do lote mais antigo para o mais novo
create or replace function public._lotes(p_peca uuid)
returns table (mov_id uuid, data date, seq bigint, documento text, fornecedor_id uuid, preco_unit numeric, resta numeric)
language sql stable security definer set search_path = public as $$
  with est as (select greatest(estoque, 0) as e from public.pecas where id = p_peca),
       ent as (select m.id, m.data, m.seq, m.documento, m.fornecedor_id, m.preco_unit, m.qtd,
                      sum(m.qtd) over (order by m.data desc, m.seq desc rows between unbounded preceding and current row) as acum
                 from public.movimentos m where m.peca_id = p_peca and m.tipo = 'entrada')
  select ent.id, ent.data, ent.seq, ent.documento, ent.fornecedor_id, ent.preco_unit,
         least(ent.qtd, est.e - (ent.acum - ent.qtd))
    from ent, est
   where ent.acum - ent.qtd < est.e
   order by ent.data, ent.seq
$$;

-- lotes que estão na prateleira (com preço): só quem vê preços
create or replace function public.lotes(p_peca uuid)
returns table (mov_id uuid, data date, seq bigint, documento text, fornecedor_id uuid, preco_unit numeric, resta numeric)
language sql stable security definer set search_path = public as $$
  select * from public._lotes(p_peca) where public.eh('dono','escritorio','almoxarife')
$$;

-- preço da última entrada com preço (para ajustes)
create or replace function public.ultimo_preco(p_peca uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select preco_unit from public.movimentos where peca_id = p_peca and tipo = 'entrada' and preco_unit > 0
                    order by data desc, seq desc limit 1), 0)
$$;

-- Lança uma movimentação.
--   tipo 'saida'  : motivo 'retirada' (qualquer perfil) ou 'ajuste'; preço pelo PEPS (pode dividir em 2+ linhas)
--   tipo 'entrada': motivo 'compra', 'devolucao' ou 'ajuste' (perfis do almoxarifado)
-- Devolve {ids:[...], custo: total, partes:[{qtd, preco_unit, documento}]}
create or replace function public.movimentar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid());
  v_tipo text := p ->> 'tipo';
  v_motivo text := coalesce(public.nz(p ->> 'motivo'), case when p ->> 'tipo' = 'saida' then 'retirada' else 'compra' end);
  v_peca public.pecas;
  v_qtd numeric := public.num(p, 'qtd');
  v_data date := public.dt(p, 'data', public.hoje());
  v_ids jsonb := '[]'::jsonb; v_partes jsonb := '[]'::jsonb; v_custo numeric := 0;
  v_resta numeric; v_n int := 0; v_take numeric; v_novo uuid; l record; v_preco numeric;
begin
  if v_tipo not in ('entrada','saida') then raise exception 'Tipo de movimentação inválido'; end if;
  if v_tipo = 'saida' and v_motivo not in ('retirada','ajuste') then raise exception 'Motivo de saída inválido'; end if;
  if v_tipo = 'entrada' and v_motivo not in ('compra','devolucao','ajuste') then raise exception 'Motivo de entrada inválido'; end if;
  if v_tipo = 'saida' and v_motivo = 'retirada' then perform public.exigir('dono','escritorio','almoxarife','producao','gerente');
  else perform public.exigir('dono','escritorio','almoxarife'); end if;
  if v_qtd is null or v_qtd <= 0 then raise exception 'Informe a quantidade (maior que zero)'; end if;
  if v_data > public.hoje() then raise exception 'A data não pode ser no futuro'; end if;
  if v_data < public.hoje() - 366 and not public.eh('dono','escritorio') then raise exception 'Data muito antiga'; end if;

  -- envio repetido (toque duplo / internet que caiu) não lança de novo
  if exists (select 1 from public.movimentos where id = v_id) then
    return jsonb_build_object('ids', (select jsonb_agg(id) from public.movimentos where id = v_id), 'repetido', true,
                              'custo', (select sum(qtd * preco_unit) from public.movimentos where id = v_id));
  end if;

  select * into v_peca from public.pecas where id = public.uid_de(p, 'peca_id') for update;
  if v_peca.id is null then raise exception 'Peça não encontrada'; end if;
  if not v_peca.ativo then raise exception 'A peça % está desativada', v_peca.codigo; end if;

  if v_tipo = 'entrada' then
    v_preco := public.num(p, 'preco_unit');
    if v_preco is null then v_preco := public.ultimo_preco(v_peca.id); end if;
    if v_preco < 0 then raise exception 'Preço não pode ser negativo'; end if;
    insert into public.movimentos (id, data, peca_id, tipo, qtd, preco_unit, fornecedor_id, documento, motivo,
                                   funcionario_id, destino, obs)
    values (v_id, v_data, v_peca.id, 'entrada', v_qtd, v_preco, coalesce(public.uid_de(p, 'fornecedor_id'), v_peca.fornecedor_id),
            public.nz(p->>'documento'), v_motivo, public.uid_de(p, 'funcionario_id'), public.nz(p->>'destino'), public.nzt(p->>'obs'));
    return jsonb_build_object('ids', jsonb_build_array(v_id), 'custo', round(v_qtd * v_preco, 2),
                              'partes', jsonb_build_array(jsonb_build_object('qtd', v_qtd, 'preco_unit', v_preco, 'documento', public.nz(p->>'documento'))));
  end if;

  -- saída
  if v_peca.estoque < v_qtd then
    raise exception 'Só tem % no estoque de % (você pediu %). Se tem mais na prateleira, faça a contagem do estoque.',
      trim(to_char(v_peca.estoque, 'FM999999990.###')), v_peca.codigo, trim(to_char(v_qtd, 'FM999999990.###'));
  end if;
  v_resta := v_qtd;
  -- consome do lote mais antigo para o mais novo
  for l in select * from public._lotes(v_peca.id) order by data, seq loop
    exit when v_resta <= 0;
    v_take := least(v_resta, l.resta);
    v_novo := case when v_n = 0 then v_id else gen_random_uuid() end;
    insert into public.movimentos (id, data, peca_id, tipo, qtd, preco_unit, fornecedor_id, documento, motivo,
                                   funcionario_id, maquina_id, destino, manutencao_id, obs)
    values (v_novo, v_data, v_peca.id, 'saida', v_take, l.preco_unit, l.fornecedor_id, l.documento, v_motivo,
            public.uid_de(p, 'funcionario_id'), public.uid_de(p, 'maquina_id'), public.nz(p->>'destino'),
            public.uid_de(p, 'manutencao_id'), public.nzt(p->>'obs'));
    v_ids := v_ids || to_jsonb(v_novo);
    v_partes := v_partes || jsonb_build_object('qtd', v_take, 'preco_unit', l.preco_unit, 'documento', l.documento);
    v_custo := v_custo + v_take * l.preco_unit;
    v_resta := v_resta - v_take; v_n := v_n + 1;
  end loop;
  if v_resta > 0 then
    -- estoque sem entrada correspondente (não deveria acontecer): sai pelo último preço
    v_novo := case when v_n = 0 then v_id else gen_random_uuid() end;
    v_preco := public.ultimo_preco(v_peca.id);
    insert into public.movimentos (id, data, peca_id, tipo, qtd, preco_unit, motivo, funcionario_id, maquina_id, destino, manutencao_id, obs)
    values (v_novo, v_data, v_peca.id, 'saida', v_resta, v_preco, v_motivo, public.uid_de(p, 'funcionario_id'),
            public.uid_de(p, 'maquina_id'), public.nz(p->>'destino'), public.uid_de(p, 'manutencao_id'), public.nzt(p->>'obs'));
    v_ids := v_ids || to_jsonb(v_novo);
    v_partes := v_partes || jsonb_build_object('qtd', v_resta, 'preco_unit', v_preco, 'documento', null);
    v_custo := v_custo + v_resta * v_preco;
  end if;
  return jsonb_build_object('ids', v_ids, 'custo', round(v_custo, 2), 'partes', v_partes);
end $$;

-- Desfaz uma movimentação lançando a contrária (fica no histórico).
-- Produção só desfaz a própria retirada, até 2 horas depois.
create or replace function public.estornar(p_id uuid, p_obs text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.movimentos; v_peca public.pecas; v_novo uuid := gen_random_uuid();
begin
  if public.meu_perfil() is null then raise exception 'Sua sessão não tem acesso. Entre de novo.'; end if;
  select * into m from public.movimentos where id = p_id;
  if m.id is null then raise exception 'Movimentação não encontrada'; end if;
  if not (public.eh('dono','escritorio','almoxarife')
          or (public.eh('producao','gerente') and m.criado_por = auth.uid() and m.motivo = 'retirada' and m.criado_em > now() - interval '2 hours')) then
    raise exception 'Seu perfil não pode desfazer essa movimentação. Peça ao almoxarifado.';
  end if;
  if m.motivo = 'estorno' then raise exception 'Essa linha já é um estorno'; end if;
  if exists (select 1 from public.movimentos where estorno_de = p_id) then raise exception 'Essa movimentação já foi desfeita'; end if;
  select * into v_peca from public.pecas where id = m.peca_id for update;
  if m.tipo = 'entrada' and v_peca.estoque < m.qtd then
    raise exception 'Não dá para desfazer: das % que entraram, só restam % no estoque (o resto já foi retirado).',
      trim(to_char(m.qtd, 'FM999999990.###')), trim(to_char(v_peca.estoque, 'FM999999990.###'));
  end if;
  insert into public.movimentos (id, data, peca_id, tipo, qtd, preco_unit, fornecedor_id, documento, motivo, funcionario_id,
                                 maquina_id, destino, pedido_item_id, manutencao_id, estorno_de, obs)
  values (v_novo, public.hoje(), m.peca_id, case when m.tipo = 'entrada' then 'saida' else 'entrada' end, m.qtd, m.preco_unit,
          m.fornecedor_id, m.documento, 'estorno', m.funcionario_id, m.maquina_id, m.destino, m.pedido_item_id, m.manutencao_id,
          p_id, coalesce(public.nz(p_obs), 'Desfeito'));
  -- entrada de pedido desfeita: o item volta a ficar pendente
  if m.pedido_item_id is not null and m.tipo = 'entrada' then
    update public.pedido_itens set recebido = greatest(recebido - m.qtd, 0) where id = m.pedido_item_id;
    update public.pedidos_compra pc set status = 'aguardando', recebido_em = null
     where pc.id = (select pedido_id from public.pedido_itens where id = m.pedido_item_id) and pc.status = 'recebido';
  end if;
  return v_novo;
end $$;

-- Contagem: informa quanto tem de verdade na prateleira; lança o ajuste da diferença
create or replace function public.contar_estoque(p_peca uuid, p_contado numeric, p_obs text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_peca public.pecas; v_dif numeric;
begin
  perform public.exigir('dono','escritorio','almoxarife');
  if p_contado is null or p_contado < 0 then raise exception 'Informe quanto tem na prateleira (zero ou mais)'; end if;
  select * into v_peca from public.pecas where id = p_peca;
  if v_peca.id is null then raise exception 'Peça não encontrada'; end if;
  v_dif := p_contado - v_peca.estoque;
  if v_dif = 0 then return jsonb_build_object('diferenca', 0); end if;
  return public.movimentar(jsonb_build_object('tipo', case when v_dif > 0 then 'entrada' else 'saida' end, 'motivo', 'ajuste',
           'peca_id', p_peca, 'qtd', abs(v_dif), 'obs', coalesce(public.nz(p_obs), 'Contagem de estoque: ' || p_contado)))
         || jsonb_build_object('diferenca', v_dif);
end $$;

-- ---------------------------------------------------------------------
-- Pedidos de compra
-- ---------------------------------------------------------------------
-- p: {id?, data, fornecedor_id, documento, prazo, frete, obs, itens:[{id?, peca_id, qtd, valor}]}
create or replace function public.salvar_pedido(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_ped public.pedidos_compra; i jsonb; n int := 0;
        v_qtd numeric; v_val numeric; v_item uuid; v_manter uuid[] := '{}';
begin
  perform public.exigir('dono','escritorio','almoxarife');
  if public.uid_de(p, 'fornecedor_id') is null then raise exception 'Escolha o fornecedor'; end if;
  if jsonb_typeof(p -> 'itens') <> 'array' or jsonb_array_length(p -> 'itens') = 0 then raise exception 'Coloque pelo menos uma peça no pedido'; end if;
  select * into v_ped from public.pedidos_compra where id = v_id for update;
  if v_ped.id is not null and v_ped.status <> 'aguardando' then raise exception 'Pedido % já foi % e não pode ser alterado', v_ped.numero, v_ped.status; end if;
  if v_ped.id is null then
    insert into public.pedidos_compra (id, data, fornecedor_id, documento, prazo, frete, obs)
    values (v_id, public.dt(p, 'data', public.hoje()), public.uid_de(p, 'fornecedor_id'), public.nz(p->>'documento'),
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
    if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade inválida na linha %', n; end if;
    if v_val < 0 then raise exception 'Valor inválido na linha %', n; end if;
    if not exists (select 1 from public.pecas where id = public.uid_de(i, 'peca_id')) then raise exception 'Peça não encontrada na linha %', n; end if;
    v_item := public.uid_de(i, 'id');
    if v_item is not null and exists (select 1 from public.pedido_itens where id = v_item and pedido_id = v_id) then
      update public.pedido_itens set peca_id = public.uid_de(i, 'peca_id'), qtd = v_qtd, valor = round(v_val, 2), ordem = n
       where id = v_item;
      if (select recebido from public.pedido_itens where id = v_item) > v_qtd then
        raise exception 'Na linha % já chegaram mais peças do que a nova quantidade', n;
      end if;
    else
      v_item := coalesce(v_item, gen_random_uuid());
      insert into public.pedido_itens (id, pedido_id, peca_id, qtd, valor, ordem) values (v_item, v_id, public.uid_de(i, 'peca_id'), v_qtd, round(v_val, 2), n);
    end if;
    v_manter := v_manter || v_item;
  end loop;
  if exists (select 1 from public.pedido_itens where pedido_id = v_id and not (id = any(v_manter)) and recebido > 0) then
    raise exception 'Não dá para tirar do pedido uma peça que já chegou';
  end if;
  delete from public.pedido_itens where pedido_id = v_id and not (id = any(v_manter));
  return jsonb_build_object('id', v_id, 'numero', (select numero from public.pedidos_compra where id = v_id));
end $$;

-- Recebe (total ou parcial): dá entrada no estoque e, se pedir, lança a conta a pagar.
-- p: {pedido_id, data, documento, itens:[{item_id, qtd}], encerrar:boolean, conta:{vencimento, valor, parcelas}}
create or replace function public.receber_pedido(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ped public.pedidos_compra; i jsonb; it public.pedido_itens; v_qtd numeric; v_total numeric := 0; v_n int := 0;
        v_doc text; v_data date := public.dt(p, 'data', public.hoje()); v_conta jsonb := p -> 'conta';
        v_chave uuid := public.uid_de(p, 'chave');
begin
  perform public.exigir('dono','escritorio','almoxarife');
  -- envio repetido (internet caiu e o site mandou de novo): não recebe duas vezes
  if v_chave is not null and exists (select 1 from public.movimentos where chave = v_chave) then
    return jsonb_build_object('repetido', true, 'status', (select status from public.pedidos_compra where id = public.uid_de(p, 'pedido_id')));
  end if;
  select * into v_ped from public.pedidos_compra where id = public.uid_de(p, 'pedido_id') for update;
  if v_ped.id is null then raise exception 'Pedido não encontrado'; end if;
  if v_ped.status <> 'aguardando' then raise exception 'Pedido % já está %', v_ped.numero, v_ped.status; end if;
  if v_data > public.hoje() then raise exception 'A data não pode ser no futuro'; end if;
  if v_conta is not null and jsonb_typeof(v_conta) = 'object' and not public.eh('dono','escritorio') then
    raise exception 'Só o Dono ou o Escritório lançam a conta a pagar. Receba sem a conta; o escritório lança depois.';
  end if;
  v_doc := coalesce(public.nz(p->>'documento'), v_ped.documento, 'Pedido ' || v_ped.numero);
  for i in select * from jsonb_array_elements(coalesce(p -> 'itens', '[]'::jsonb)) loop
    v_qtd := coalesce(public.num(i, 'qtd'), 0);
    continue when v_qtd = 0;
    if v_qtd < 0 then raise exception 'Quantidade recebida não pode ser negativa'; end if;
    select * into it from public.pedido_itens where id = public.uid_de(i, 'item_id') and pedido_id = v_ped.id for update;
    if it.id is null then raise exception 'Item não pertence a este pedido'; end if;
    insert into public.movimentos (data, peca_id, tipo, qtd, preco_unit, fornecedor_id, documento, motivo, pedido_item_id, obs, chave)
    values (v_data, it.peca_id, 'entrada', v_qtd, round(it.valor / it.qtd, 4), v_ped.fornecedor_id, v_doc, 'compra', it.id,
            'Pedido de compra nº ' || v_ped.numero, v_chave);
    update public.pedido_itens set recebido = recebido + v_qtd where id = it.id;
    v_total := v_total + round(v_qtd * it.valor / it.qtd, 2); v_n := v_n + 1;
  end loop;
  if v_n = 0 and not coalesce((p->>'encerrar')::boolean, false) then raise exception 'Informe quanto chegou de pelo menos uma peça'; end if;
  if coalesce((p->>'encerrar')::boolean, false)
     or not exists (select 1 from public.pedido_itens where pedido_id = v_ped.id and recebido < qtd) then
    update public.pedidos_compra set status = 'recebido', recebido_em = v_data where id = v_ped.id;
  else
    update public.pedidos_compra set atualizado_em = now() where id = v_ped.id;   -- avisa os outros aparelhos
  end if;
  if v_conta is not null and jsonb_typeof(v_conta) = 'object' and coalesce(public.num(v_conta, 'valor'), 0) > 0 then
    perform public.salvar_lancamento(jsonb_build_object('tipo', 'pagar', 'descricao', 'Compra - pedido nº ' || v_ped.numero,
      'categoria', 'Compras / almoxarifado', 'valor', public.num(v_conta, 'valor'), 'vencimento', coalesce(v_conta->>'vencimento', v_data::text),
      'parcelas', coalesce(v_conta->>'parcelas', '1'), 'intervalo', coalesce(v_conta->>'intervalo', '30'),
      'fornecedor_id', v_ped.fornecedor_id, 'pedido_id', v_ped.id, 'documento', v_doc));
  end if;
  return jsonb_build_object('entradas', v_n, 'valor', v_total,
                            'status', (select status from public.pedidos_compra where id = v_ped.id));
end $$;

create or replace function public.cancelar_pedido(p_id uuid, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_ped public.pedidos_compra;
begin
  perform public.exigir('dono','escritorio','almoxarife');
  select * into v_ped from public.pedidos_compra where id = p_id for update;
  if v_ped.id is null then raise exception 'Pedido não encontrado'; end if;
  if v_ped.status <> 'aguardando' then raise exception 'Só dá para cancelar pedido que está aguardando'; end if;
  if exists (select 1 from public.pedido_itens where pedido_id = p_id and recebido > 0) then
    -- parte já chegou: encerra com o que chegou
    update public.pedidos_compra set status = 'recebido', recebido_em = public.hoje(),
           obs = concat_ws(E'\n', obs, 'Encerrado sem receber o resto' || coalesce(': ' || public.nz(p_motivo), '')) where id = p_id;
  else
    update public.pedidos_compra set status = 'cancelado',
           obs = concat_ws(E'\n', obs, 'Cancelado' || coalesce(': ' || public.nz(p_motivo), '')) where id = p_id;
  end if;
end $$;

create or replace function public.reabrir_pedido(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir('dono','escritorio','almoxarife');
  update public.pedidos_compra set status = 'aguardando', recebido_em = null
   where id = p_id and status in ('cancelado','recebido')
     and exists (select 1 from public.pedido_itens where pedido_id = p_id and recebido < qtd);
  if not found then raise exception 'Esse pedido não tem nada pendente para reabrir'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Máquinas: manutenção
-- ---------------------------------------------------------------------
create or replace function public.salvar_manutencao(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_st text := coalesce(public.nz(p->>'status'), 'aberta');
        v_old public.manutencoes;
begin
  perform public.exigir('dono','escritorio','almoxarife','producao','gerente');
  if public.uid_de(p, 'maquina_id') is null then raise exception 'Escolha a máquina'; end if;
  if public.nzt(p->>'problema') is null then raise exception 'Descreva o problema ou o serviço'; end if;
  select * into v_old from public.manutencoes where id = v_id;
  if public.eh('producao','gerente') and v_old.id is not null and v_old.criado_por is distinct from auth.uid() and v_old.status = 'concluida' then
    raise exception 'Manutenção concluída só pode ser alterada pelo escritório ou almoxarifado';
  end if;
  insert into public.manutencoes (id, maquina_id, data, tipo, status, problema, solucao, fornecedor_id, funcionario_id,
                                  custo_servico, horas_parada, concluida_em)
  values (v_id, public.uid_de(p, 'maquina_id'), public.dt(p, 'data', public.hoje()), coalesce(public.nz(p->>'tipo'), 'corretiva'), v_st,
          public.nzt(p->>'problema'), public.nzt(p->>'solucao'), public.uid_de(p, 'fornecedor_id'), public.uid_de(p, 'funcionario_id'),
          coalesce(public.num(p, 'custo_servico'), 0), public.num(p, 'horas_parada'),
          case when v_st = 'concluida' then public.dt(p, 'concluida_em', public.hoje()) end)
  on conflict (id) do update set maquina_id = excluded.maquina_id, data = excluded.data, tipo = excluded.tipo, status = excluded.status,
          problema = excluded.problema, solucao = excluded.solucao, fornecedor_id = excluded.fornecedor_id,
          funcionario_id = excluded.funcionario_id, custo_servico = excluded.custo_servico, horas_parada = excluded.horas_parada,
          concluida_em = excluded.concluida_em;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Produção: ordens
-- ---------------------------------------------------------------------
create or replace function public.salvar_ordem(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_cli uuid := public.uid_de(p, 'cliente_id');
        v_old public.ordens; v_qtd numeric := public.num(p, 'qtd');
begin
  perform public.exigir('dono','escritorio','pcp');
  if public.nz(p->>'produto') is null then raise exception 'Informe o produto'; end if;
  if v_qtd is null or v_qtd <= 0 then raise exception 'Informe a quantidade'; end if;
  select * into v_old from public.ordens where id = v_id;
  if v_old.status in ('entregue','cancelada') then raise exception 'Ordem % já está % e não pode ser alterada', v_old.numero, v_old.status; end if;
  insert into public.ordens (id, cliente_id, cliente_nome, pedido_cliente, produto, codigo, qtd, unidade, prazo, maquina_id,
                             responsavel_id, prioridade, obs)
  values (v_id, v_cli, coalesce((select nome from public.clientes where id = v_cli), public.nz(p->>'cliente_nome')),
          public.nz(p->>'pedido_cliente'), public.nz(p->>'produto'), public.nz(p->>'codigo'), v_qtd,
          coalesce(public.nz(p->>'unidade'), 'pç'), public.dt(p, 'prazo'), public.uid_de(p, 'maquina_id'),
          public.uid_de(p, 'responsavel_id'), case when coalesce((p->>'prioridade')::int, 0) = 1 then 1 else 0 end, public.nzt(p->>'obs'))
  on conflict (id) do update set cliente_id = excluded.cliente_id, cliente_nome = excluded.cliente_nome,
          pedido_cliente = excluded.pedido_cliente, produto = excluded.produto, codigo = excluded.codigo, qtd = excluded.qtd,
          unidade = excluded.unidade, prazo = excluded.prazo, maquina_id = excluded.maquina_id,
          responsavel_id = excluded.responsavel_id, prioridade = excluded.prioridade, obs = excluded.obs;
  return jsonb_build_object('id', v_id, 'numero', (select numero from public.ordens where id = v_id));
end $$;

-- muda a situação / aponta quantidade produzida (qualquer perfil)
create or replace function public.ordem_status(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare o public.ordens; v_st text := public.nz(p->>'status'); v_prod numeric := public.num(p, 'produzido');
begin
  perform public.exigir('dono','escritorio','pcp','producao','gerente');
  select * into o from public.ordens where id = public.uid_de(p, 'id') for update;
  if o.id is null then raise exception 'Ordem não encontrada'; end if;
  if v_st is null then v_st := o.status; end if;
  if v_st not in ('fila','producao','pronta','entregue','cancelada') then raise exception 'Situação inválida'; end if;
  if v_st in ('entregue','cancelada') and public.eh('producao','gerente') then raise exception 'Entrega e cancelamento são feitos pelo PCP ou pelo escritório'; end if;
  if o.status in ('entregue','cancelada') and not public.eh('dono','escritorio','pcp') then raise exception 'Ordem já encerrada'; end if;
  if v_prod is not null and v_prod < 0 then raise exception 'Quantidade produzida não pode ser negativa'; end if;
  update public.ordens set status = v_st,
         produzido = coalesce(v_prod, case when v_st = 'pronta' and produzido < qtd then qtd else produzido end),
         iniciada_em = case when v_st in ('producao','pronta','entregue') then coalesce(iniciada_em, now()) else iniciada_em end,
         pronta_em = case when v_st in ('pronta','entregue') then coalesce(pronta_em, now()) when v_st in ('fila','producao') then null else pronta_em end,
         entregue_em = case when v_st = 'entregue' then public.dt(p, 'entregue_em', public.hoje()) else null end,
         obs = case when public.nzt(p->>'obs') is not null then concat_ws(E'\n', obs, public.nzt(p->>'obs')) else obs end
   where id = o.id;
end $$;

-- ---------------------------------------------------------------------
-- Financeiro
-- ---------------------------------------------------------------------
-- p: {id?, tipo, descricao, categoria, valor, vencimento, parcelas, intervalo('30'|'mensal'|dias), pago_em, valor_pago, forma,
--     fornecedor_id, cliente_id, funcionario_id, pedido_id, ordem_id, documento, obs}
-- Com parcelas > 1 cria várias contas (valor dividido; centavos na última). Devolve o id da 1ª.
create or replace function public.salvar_lancamento(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_n int := coalesce(public.num(p, 'parcelas'), 1)::int;
        v_val numeric := public.num(p, 'valor'); v_venc date := public.dt(p, 'vencimento'); v_parc numeric; v_grupo uuid;
        v_int text := coalesce(public.nz(p->>'intervalo'), 'mensal'); k int; v_d date; v_desc text := public.nz(p->>'descricao');
begin
  perform public.exigir('dono','escritorio');
  if p->>'tipo' not in ('pagar','receber') then raise exception 'Escolha se é conta a pagar ou a receber'; end if;
  if v_desc is null then raise exception 'Informe a descrição'; end if;
  if v_val is null or v_val <= 0 then raise exception 'Informe o valor'; end if;
  if v_venc is null then raise exception 'Informe o vencimento'; end if;
  if v_n < 1 or v_n > 120 then raise exception 'Número de parcelas inválido'; end if;
  if exists (select 1 from public.lancamentos where id = v_id) then
    update public.lancamentos set tipo = p->>'tipo', descricao = v_desc, categoria = public.nz(p->>'categoria'), valor = round(v_val, 2),
           vencimento = v_venc, forma = public.nz(p->>'forma'), fornecedor_id = public.uid_de(p, 'fornecedor_id'),
           cliente_id = public.uid_de(p, 'cliente_id'), funcionario_id = public.uid_de(p, 'funcionario_id'),
           documento = public.nz(p->>'documento'), obs = public.nzt(p->>'obs'),
           pago_em = public.dt(p, 'pago_em'), valor_pago = case when public.dt(p, 'pago_em') is not null then round(coalesce(public.num(p, 'valor_pago'), v_val), 2) end
     where id = v_id;
    return v_id;
  end if;
  v_grupo := case when v_n > 1 then gen_random_uuid() end;
  v_parc := trunc(v_val / v_n, 2);
  for k in 1..v_n loop
    v_d := case when v_int = 'mensal' then (v_venc + make_interval(months => k - 1))::date
                else v_venc + (k - 1) * v_int::int end;
    insert into public.lancamentos (id, tipo, descricao, categoria, valor, vencimento, pago_em, valor_pago, forma, fornecedor_id,
                                    cliente_id, funcionario_id, pedido_id, ordem_id, documento, parcela, grupo, obs)
    values (case when k = 1 then v_id else gen_random_uuid() end, p->>'tipo', v_desc, public.nz(p->>'categoria'),
            case when k = v_n then round(v_val - v_parc * (v_n - 1), 2) else v_parc end, v_d,
            case when k = 1 then public.dt(p, 'pago_em') end,
            case when k = 1 and public.dt(p, 'pago_em') is not null then round(coalesce(public.num(p, 'valor_pago'), v_parc), 2) end,
            public.nz(p->>'forma'), public.uid_de(p, 'fornecedor_id'), public.uid_de(p, 'cliente_id'), public.uid_de(p, 'funcionario_id'),
            public.uid_de(p, 'pedido_id'), public.uid_de(p, 'ordem_id'), public.nz(p->>'documento'),
            case when v_n > 1 then k || '/' || v_n end, v_grupo, public.nzt(p->>'obs'));
  end loop;
  return v_id;
end $$;

-- marca como pago/recebido (p_data nulo = desfaz o pagamento)
create or replace function public.baixar_lancamento(p_id uuid, p_data date, p_valor numeric default null, p_forma text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir('dono','escritorio');
  if p_data is not null and p_data > public.hoje() + 1 then raise exception 'A data do pagamento não pode ser no futuro'; end if;
  if p_valor is not null and p_valor < 0 then raise exception 'Valor inválido'; end if;
  update public.lancamentos set pago_em = p_data,
         valor_pago = case when p_data is null then null else round(coalesce(p_valor, valor), 2) end,
         forma = coalesce(public.nz(p_forma), forma)
   where id = p_id;
  if not found then raise exception 'Conta não encontrada'; end if;
end $$;

create or replace function public.excluir_lancamento(p_id uuid, p_grupo boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare v_g uuid; n int;
begin
  perform public.exigir('dono','escritorio');
  select grupo into v_g from public.lancamentos where id = p_id;
  if p_grupo and v_g is not null then
    delete from public.lancamentos where grupo = v_g and pago_em is null;
  else
    delete from public.lancamentos where id = p_id;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Acessos (login = usuário + senha; e-mail interno usuario@jafmetal.local)
-- ---------------------------------------------------------------------
create or replace function public.login_limpo(p_login text) returns text
language sql immutable set search_path = public as $$ select lower(btrim(coalesce(p_login, ''))) $$;

drop function if exists public.novo_usuario(text, text, text, text, uuid);
create or replace function public.novo_usuario(p_login text, p_senha text, p_nome text, p_perfil text, p_func uuid, p_trocar boolean default false) returns uuid
language plpgsql security definer set search_path = public, extensions, auth as $$
declare uid uuid := gen_random_uuid(); v_login text := public.login_limpo(p_login); v_email text;
begin
  perform set_config('jaf.criando_usuario', '1', true);   -- libera o gatilho que bloqueia cadastro por fora
  if v_login !~ '^[a-z0-9._-]{3,30}$' then raise exception 'O usuário deve ter de 3 a 30 letras ou números, sem espaço nem acento'; end if;
  perform public.conferir_senha(v_login, p_senha);
  if public.nz(p_nome) is null or length(public.nz(p_nome)) < 2 then raise exception 'Informe o nome'; end if;
  if p_perfil not in ('dono','escritorio','almoxarife','pcp','producao','rh','gerente') then raise exception 'Perfil inválido'; end if;
  v_email := v_login || '@jafmetal.local';
  if exists (select 1 from public.perfis where login = v_login) then raise exception 'Esse usuário já existe. Escolha outro.'; end if;
  delete from auth.users u where lower(u.email) = v_email and not exists (select 1 from public.perfis p where p.user_id = u.id);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', v_email,
          extensions.crypt(p_senha, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('nome', public.nz(p_nome)), now(), now(),
          '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
  insert into public.perfis (user_id, nome, login, perfil, funcionario_id, trocar_senha)
  values (uid, public.nz(p_nome), v_login, p_perfil, p_func, coalesce(p_trocar, false));
  perform set_config('jaf.criando_usuario', '0', true);
  return uid;
end $$;

-- Ninguém cria conta por fora do sistema (cadastro aberto do Supabase fica bloqueado):
-- só as funções acima inserem em auth.users.
create or replace function public.tg_bloqueia_cadastro() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('jaf.criando_usuario', true), '') <> '1' then
    raise exception 'Cadastro desativado: os acessos são criados pelo Dono dentro do sistema.';
  end if;
  return new;
end $$;
drop trigger if exists jaf_bloqueia_cadastro on auth.users;
create trigger jaf_bloqueia_cadastro before insert on auth.users for each row execute function public.tg_bloqueia_cadastro();

create or replace function public.ha_dono() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.perfis where perfil = 'dono') $$;

-- primeiro acesso: cria o dono (só funciona enquanto não existir nenhum)
create or replace function public.primeiro_dono(p_login text, p_senha text, p_nome text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(4242);
  if public.ha_dono() then raise exception 'O primeiro acesso já foi feito. Entre com usuário e senha.'; end if;
  return public.novo_usuario(p_login, p_senha, p_nome, 'dono', null);
end $$;

create or replace function public.criar_acesso(p_login text, p_senha text, p_nome text, p_perfil text, p_func uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir('dono');
  -- a senha que o Dono escolheu é provisória: a pessoa troca no primeiro acesso
  return public.novo_usuario(p_login, p_senha, p_nome, p_perfil, p_func, true);
end $$;

create or replace function public.editar_acesso(p_user uuid, p_nome text, p_perfil text, p_ativo boolean, p_func uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.perfis;
begin
  perform public.exigir('dono');
  select * into v from public.perfis where user_id = p_user;
  if v.user_id is null then raise exception 'Acesso não encontrado'; end if;
  if p_perfil not in ('dono','escritorio','almoxarife','pcp','producao','rh','gerente') then raise exception 'Perfil inválido'; end if;
  if v.perfil = 'dono' and v.ativo and (p_perfil <> 'dono' or not p_ativo)
     and (select count(*) from public.perfis where perfil = 'dono' and ativo) < 2 then
    raise exception 'Precisa existir pelo menos um Dono ativo';
  end if;
  update public.perfis set nome = coalesce(public.nz(p_nome), nome), perfil = p_perfil, ativo = coalesce(p_ativo, ativo),
         funcionario_id = p_func where user_id = p_user;
end $$;

create or replace function public.trocar_senha(p_user uuid, p_senha text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if public.meu_perfil() is null then raise exception 'Sua sessão não tem acesso. Entre de novo.'; end if;
  if not (p_user = auth.uid() or public.eh('dono')) then raise exception 'Só o Dono troca a senha de outra pessoa'; end if;
  perform public.conferir_senha((select login from public.perfis where user_id = p_user), p_senha);
  update auth.users set encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')), updated_at = now() where id = p_user;
  if not found then raise exception 'Acesso não encontrado'; end if;
  -- trocou a própria: deixa de ser provisória. O Dono trocou a de outra pessoa: vira provisória.
  update public.perfis set trocar_senha = coalesce(p_user <> auth.uid(), true) where user_id = p_user;
end $$;

-- ---------------------------------------------------------------------
-- Importação da planilha Almoxarifado (só o Dono)
-- p: {fornecedores:[{nome, razao, ...}], pecas:[{codigo, descricao, utilizacao, fornecedor, est_min, est_max}],
--     maquinas:[{nome}], movimentos:[{data, codigo, tipo, qtd, preco_unit, fornecedor, documento}],
--     pedidos:[{data, fornecedor, documento, prazo, status, itens:[{codigo, qtd, valor}]}]}
-- p_substituir = true apaga ANTES todo o almoxarifado (peças, movimentações, pedidos e fornecedores sem uso no financeiro).
-- ---------------------------------------------------------------------
create or replace function public.importar_planilha(p jsonb, p_substituir boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; i jsonb; v_id uuid; v_ped uuid; n_f int := 0; n_p int := 0; n_m int := 0; n_pc int := 0; n_maq int := 0;
        v_forn uuid; v_peca uuid; v_falta text[] := '{}';
begin
  perform public.exigir('dono');
  perform set_config('jaf.importando', '1', true);
  if p_substituir then
    delete from public.movimentos;
    delete from public.pedido_itens;
    update public.lancamentos set pedido_id = null where pedido_id is not null;
    delete from public.pedidos_compra;
    perform setval('public.pedidos_numero_seq', 1, false);   -- pedidos importados voltam a ser 1, 2, 3...
    delete from public.pecas;
    delete from public.fornecedores f where not exists (select 1 from public.lancamentos l where l.fornecedor_id = f.id)
                                        and not exists (select 1 from public.manutencoes m where m.fornecedor_id = f.id);
  elsif exists (select 1 from public.pecas) then
    raise exception 'Já existem peças cadastradas. Para importar de novo, escolha "substituir".';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p -> 'fornecedores', '[]')) loop
    if public.nz(r->>'nome') is null then continue; end if;
    select id into v_id from public.fornecedores where lower(nome) = lower(public.nz(r->>'nome'));
    if v_id is null then
      insert into public.fornecedores (nome, razao, tipo, contato, contato2, telefone, celular, email, site, endereco, bairro,
             cidade, uf, cep, cnpj, ie, qualificacao, qualif_metodo, qualif_validade, obs, ativo)
      values (public.nz(r->>'nome'), public.nz(r->>'razao'), coalesce(public.nz(r->>'tipo'), 'Peças'), public.nz(r->>'contato'),
              public.nz(r->>'contato2'), public.nz(r->>'telefone'), public.nz(r->>'celular'), lower(public.nz(r->>'email')),
              public.nz(r->>'site'), public.nz(r->>'endereco'), public.nz(r->>'bairro'), public.nz(r->>'cidade'),
              upper(public.nz(r->>'uf')), public.nz(r->>'cep'), public.nz(r->>'cnpj'), public.nz(r->>'ie'),
              public.nz(r->>'qualificacao'), public.nz(r->>'qualif_metodo'), public.dt(r, 'qualif_validade'), public.nzt(r->>'obs'),
              coalesce((r->>'ativo')::boolean, true));
      n_f := n_f + 1;
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p -> 'maquinas', '[]')) loop
    if public.nz(r->>'nome') is null then continue; end if;
    if not exists (select 1 from public.maquinas where lower(nome) = lower(public.nz(r->>'nome'))) then
      insert into public.maquinas (nome, tipo) values (public.nz(r->>'nome'), public.nz(r->>'tipo'));
      n_maq := n_maq + 1;
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p -> 'pecas', '[]')) loop
    if public.nz(r->>'codigo') is null then continue; end if;
    select id into v_forn from public.fornecedores where lower(nome) = lower(public.nz(r->>'fornecedor'));
    insert into public.pecas (codigo, descricao, utilizacao, fornecedor_id, est_min, est_max, unidade, obs)
    values (public.nz(r->>'codigo'), coalesce(public.nz(r->>'descricao'), public.nz(r->>'codigo')), public.nz(r->>'utilizacao'), v_forn,
            coalesce(public.num(r, 'est_min'), 0), coalesce(public.num(r, 'est_max'), 0), coalesce(public.nz(r->>'unidade'), 'un'),
            public.nzt(r->>'obs'))
    on conflict (lower(codigo)) do nothing;
    if found then n_p := n_p + 1; end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p -> 'movimentos', '[]')) loop
    select id into v_peca from public.pecas where lower(codigo) = lower(public.nz(r->>'codigo'));
    if v_peca is null then
      v_falta := v_falta || public.nz(r->>'codigo');
      continue;
    end if;
    select id into v_forn from public.fornecedores where lower(nome) = lower(public.nz(r->>'fornecedor'));
    insert into public.movimentos (data, peca_id, tipo, qtd, preco_unit, fornecedor_id, documento, motivo, obs)
    values (public.dt(r, 'data'), v_peca, r->>'tipo', public.num(r, 'qtd'), coalesce(public.num(r, 'preco_unit'), 0), v_forn,
            public.nz(r->>'documento'), 'importado', 'Importado da planilha');
    n_m := n_m + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p -> 'pedidos', '[]')) loop
    select id into v_forn from public.fornecedores where lower(nome) = lower(public.nz(r->>'fornecedor'));
    if v_forn is null then
      insert into public.fornecedores (nome) values (coalesce(public.nz(r->>'fornecedor'), 'Sem fornecedor')) returning id into v_forn;
      n_f := n_f + 1;
    end if;
    insert into public.pedidos_compra (data, fornecedor_id, documento, prazo, status, recebido_em, obs)
    values (public.dt(r, 'data'), v_forn, public.nz(r->>'documento'), public.dt(r, 'prazo'),
            case when r->>'status' = 'recebido' then 'recebido' else 'aguardando' end,
            case when r->>'status' = 'recebido' then coalesce(public.dt(r, 'prazo'), public.dt(r, 'data')) end, 'Importado da planilha')
    returning id into v_ped;
    for i in select * from jsonb_array_elements(coalesce(r -> 'itens', '[]')) loop
      select id into v_peca from public.pecas where lower(codigo) = lower(public.nz(i->>'codigo'));
      if v_peca is null then
        -- código que só existe no pedido: cria a peça para não perder a linha
        insert into public.pecas (codigo, descricao, fornecedor_id, obs, ativo)
        values (public.nz(i->>'codigo'), coalesce(public.nz(i->>'descricao'), public.nz(i->>'codigo')), v_forn,
                'Criada na importação: o código só aparecia no Controle de Pedidos', false)
        returning id into v_peca;
        n_p := n_p + 1;
      end if;
      insert into public.pedido_itens (pedido_id, peca_id, qtd, valor, recebido, ordem)
      values (v_ped, v_peca, public.num(i, 'qtd'), round(coalesce(public.num(i, 'valor'), 0), 2),
              case when r->>'status' = 'recebido' then public.num(i, 'qtd') else 0 end, coalesce((i->>'ordem')::int, 0));
    end loop;
    n_pc := n_pc + 1;
  end loop;
  perform setval('public.pedidos_numero_seq', greatest((select max(numero) from public.pedidos_compra), 1),
                 (select max(numero) from public.pedidos_compra) is not null);

  insert into public.historico (user_id, quem, tabela, acao, depois)
  values (auth.uid(), public.meu_nome(), 'importacao', 'importar',
          jsonb_build_object('fornecedores', n_f, 'pecas', n_p, 'movimentos', n_m, 'pedidos', n_pc, 'maquinas', n_maq, 'substituir', p_substituir));
  perform set_config('jaf.importando', '0', true);
  return jsonb_build_object('fornecedores', n_f, 'pecas', n_p, 'movimentos', n_m, 'pedidos', n_pc, 'maquinas', n_maq,
                            'sem_peca', to_jsonb(v_falta));
end $$;

-- =====================================================================
-- RH (Recursos Humanos)
--   Perfis: dono, escritorio e rh fazem tudo do RH; gerente (de fábrica) só consulta,
--   sem salário, documentos pessoais, dados bancários nem CID.
--   Dados sensíveis (LGPD) ficam em funcionarios_privado, rh_historico, rh_ausencias, rh_anexos_conteudo.
-- =====================================================================
create or replace function public.pode_rh() returns boolean
language sql stable set search_path = public as $$ select public.eh('dono','escritorio','rh') $$;
create or replace function public.ve_rh() returns boolean
language sql stable set search_path = public as $$ select public.eh('dono','escritorio','rh','gerente') $$;

-- CPF: só números, 11 dígitos e dígitos verificadores certos
create or replace function public.cpf_valido(p text) returns boolean
language plpgsql immutable set search_path = public as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g'); s int; r int; i int;
begin
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then return false; end if;
  s := 0; for i in 1..9 loop s := s + substr(d, i, 1)::int * (11 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  if r <> substr(d, 10, 1)::int then return false; end if;
  s := 0; for i in 1..10 loop s := s + substr(d, i, 1)::int * (12 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  return r = substr(d, 11, 1)::int;
end $$;
create or replace function public.cpf_fmt(p text) returns text
language sql immutable set search_path = public as $$
  select case when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) = 11
    then regexp_replace(regexp_replace(p, '\D', '', 'g'), '^(\d{3})(\d{3})(\d{3})(\d{2})$', '\1.\2.\3-\4') else public.nz(p) end $$;

-- ---------------------------------------------------------------------
-- Tabelas do RH
-- ---------------------------------------------------------------------
create table if not exists public.rh_setores (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  gestor_id     uuid references public.funcionarios(id) on delete set null,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists rh_setores_nome_un on public.rh_setores (lower(nome));

create table if not exists public.rh_cargos (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  cbo           text,
  setor         text,
  superior_id   uuid references public.rh_cargos(id) on delete set null,   -- organograma: a quem este cargo responde
  descricao     text,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists rh_cargos_nome_un on public.rh_cargos (lower(nome));

-- funcionário: dados de trabalho (todo perfil lê o nome; o resto do RH só quem pode)
alter table public.funcionarios add column if not exists matricula text;              -- código interno (ex.: JAFII99)
alter table public.funcionarios add column if not exists matricula_esocial text;
alter table public.funcionarios add column if not exists registro text;               -- Matriz / Filial / Upgrade / Sem registro
alter table public.funcionarios add column if not exists cargo_id uuid;
alter table public.funcionarios add column if not exists superior_id uuid;            -- a quem responde (pessoa)
alter table public.funcionarios add column if not exists horario text;                -- ex.: 07:00 às 17:00
alter table public.funcionarios add column if not exists descanso text;               -- ex.: Sábado e domingo
alter table public.funcionarios add column if not exists situacao text not null default 'ativo';
alter table public.funcionarios add column if not exists demissao date;
alter table public.funcionarios add column if not exists ferias_base date;            -- início do período aquisitivo em aberto (acerto do RH)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'funcionarios_registro_ck') then
    alter table public.funcionarios add constraint funcionarios_registro_ck check (registro is null or registro in ('Matriz','Filial','Upgrade','Sem registro'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'funcionarios_situacao_ck') then
    alter table public.funcionarios add constraint funcionarios_situacao_ck check (situacao in ('ativo','afastado','desligado'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'funcionarios_cargo_fk') then
    alter table public.funcionarios add constraint funcionarios_cargo_fk foreign key (cargo_id) references public.rh_cargos(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'funcionarios_superior_fk') then
    alter table public.funcionarios add constraint funcionarios_superior_fk foreign key (superior_id) references public.funcionarios(id) on delete set null;
  end if;
end $$;
create index if not exists funcionarios_matricula on public.funcionarios (lower(matricula));

-- dados pessoais (LGPD): só Dono, Escritório e RH
alter table public.funcionarios_privado add column if not exists pis text;
alter table public.funcionarios_privado add column if not exists titulo_eleitor text;
alter table public.funcionarios_privado add column if not exists reservista text;
alter table public.funcionarios_privado add column if not exists cnh text;
alter table public.funcionarios_privado add column if not exists sexo text;
alter table public.funcionarios_privado add column if not exists estado_civil text;
alter table public.funcionarios_privado add column if not exists nacionalidade text;
alter table public.funcionarios_privado add column if not exists naturalidade text;
alter table public.funcionarios_privado add column if not exists uf_nascimento text;
alter table public.funcionarios_privado add column if not exists mae text;
alter table public.funcionarios_privado add column if not exists pai text;
alter table public.funcionarios_privado add column if not exists instrucao text;
alter table public.funcionarios_privado add column if not exists email text;
alter table public.funcionarios_privado add column if not exists celular text;
alter table public.funcionarios_privado add column if not exists numero text;
alter table public.funcionarios_privado add column if not exists complemento text;
alter table public.funcionarios_privado add column if not exists bairro text;
alter table public.funcionarios_privado add column if not exists cep text;
alter table public.funcionarios_privado add column if not exists cidade text;
alter table public.funcionarios_privado add column if not exists banco text;           -- dados bancários (texto livre)
alter table public.funcionarios_privado add column if not exists emergencia_nome text;
alter table public.funcionarios_privado add column if not exists emergencia_fone text;
alter table public.funcionarios_privado add column if not exists telefone_corp text;
alter table public.funcionarios_privado add column if not exists uniforme text;
alter table public.funcionarios_privado add column if not exists calcado text;
alter table public.funcionarios_privado add column if not exists chave_celular text;
alter table public.funcionarios_privado add column if not exists chave_vestiario text;
alter table public.funcionarios_privado add column if not exists indicacao text;
alter table public.funcionarios_privado add column if not exists salario_he numeric(12,2);   -- salário que a planilha de horas extras usa
alter table public.funcionarios_privado add column if not exists obs_desligamento text;
alter table public.funcionarios_privado add column if not exists ctps text;              -- número / série / UF
alter table public.funcionarios_privado add column if not exists raca_cor text;
alter table public.funcionarios_privado add column if not exists pais_origem text;
alter table public.funcionarios_privado add column if not exists telefone_fixo text;
alter table public.funcionarios_privado add column if not exists rg_orgao text;
alter table public.funcionarios_privado add column if not exists rg_uf text;
alter table public.funcionarios_privado add column if not exists rg_emissao date;
alter table public.funcionarios_privado add column if not exists cnh_categoria text;
alter table public.funcionarios_privado add column if not exists cnh_validade date;
alter table public.funcionarios_privado add column if not exists categoria_militar text;
create unique index if not exists funcionarios_privado_cpf_un on public.funcionarios_privado ((regexp_replace(cpf, '\D', '', 'g')))
  where cpf is not null and length(regexp_replace(cpf, '\D', '', 'g')) = 11;

-- histórico de cargo e salário (linha do tempo)
create table if not exists public.rh_historico (
  id             uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  vigencia       date not null,
  cargo          text,
  salario        numeric(12,2) check (salario is null or salario >= 0),
  motivo         text not null default 'Admissão' check (motivo in ('Admissão','Promoção','Dissídio','Espontâneo','Mérito','Correção','Mudança de setor','Reajuste do cargo')),
  setor          text,
  obs            text,
  criado_por     uuid default auth.uid(),
  criado_em      timestamptz not null default now()
);
create index if not exists rh_historico_func on public.rh_historico (funcionario_id, vigencia);

-- férias, atestados, afastamentos, licenças, suspensões, folgas e faltas
create table if not exists public.rh_ausencias (
  id                uuid primary key default gen_random_uuid(),
  funcionario_id    uuid not null references public.funcionarios(id) on delete cascade,
  tipo              text not null check (tipo in ('ferias','atestado','afastamento','licenca','suspensao','folga','falta','declaracao')),
  inicio            date not null,
  fim               date,                         -- vazio = indeterminado
  aquisitivo_inicio date,                         -- férias: de qual período aquisitivo
  motivo            text,
  cid               text,
  abona             boolean not null default true, -- conta como dia pago no ponto (falta e suspensão não abonam)
  obs               text,
  ocorrencia_id     uuid,
  criado_por        uuid default auth.uid(),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  check (fim is null or fim >= inicio)
);
create index if not exists rh_ausencias_func on public.rh_ausencias (funcionario_id, inicio);

-- ponto (espelho digitado do cartão de papel)
create table if not exists public.rh_ponto (
  id             uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  data           date not null,
  e1             time,
  s1             time,
  e2             time,
  s2             time,
  justificativa  text check (justificativa is null or justificativa in ('atestado','declaracao','licenca','folga','falta','abonado','compensado','bh_pos','bh_neg')),
  obs            text,
  atualizado_em  timestamptz not null default now(),
  unique (funcionario_id, data)
);
create index if not exists rh_ponto_data on public.rh_ponto (data);

-- mês conferido: dia útil em branco passa a contar como falta
create table if not exists public.rh_ponto_meses (
  id             uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  competencia    date not null,                   -- dia 1 do mês
  fechado_por    uuid default auth.uid(),
  fechado_em     timestamptz not null default now(),
  unique (funcionario_id, competencia)
);

create table if not exists public.rh_feriados (
  id    uuid primary key default gen_random_uuid(),
  data  date not null unique,
  nome  text not null
);

-- matrizes: treinamentos, procedimentos (SGQ) e versatilidade (habilidades por setor)
create table if not exists public.rh_matrizes (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  tipo          text not null check (tipo in ('treinamento','procedimento','versatilidade')),
  setor         text,
  gestor        text,
  legenda       jsonb not null default '[]'::jsonb,   -- [{nivel, txt}]
  objetivo      text,
  aprovado_por  text,
  aprovado_em   date,
  ordem         int not null default 0,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create table if not exists public.rh_matriz_itens (
  id             uuid primary key default gen_random_uuid(),
  matriz_id      uuid not null references public.rh_matrizes(id) on delete cascade,
  nome           text not null,
  ordem          int not null default 0,
  carga_horaria  numeric(6,1),
  validade_meses int check (validade_meses is null or validade_meses > 0),   -- reciclagem
  obrigatorio    boolean not null default false,                             -- obrigatório por lei (NR)
  ativo          boolean not null default true,
  atualizado_em  timestamptz not null default now()
);
create table if not exists public.rh_matriz_niveis (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references public.rh_matriz_itens(id) on delete cascade,
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  nivel          smallint not null check (nivel between 0 and 4),
  data           date,                 -- realização (vale para reciclagem)
  obs            text,
  atualizado_em  timestamptz not null default now(),
  unique (item_id, funcionario_id)
);
-- calendário de treinamentos do ano
create table if not exists public.rh_plano_treinos (
  id            uuid primary key default gen_random_uuid(),
  matriz_id     uuid references public.rh_matrizes(id) on delete set null,
  treinamento   text not null,
  data          date,
  instituicao   text,
  modalidade    text,
  status        text not null default 'planejado' check (status in ('planejado','realizado','cancelado')),
  obs           text,
  atualizado_em timestamptz not null default now()
);
-- plano de desenvolvimento por pessoa (objetivo, ação, prazo)
create table if not exists public.rh_metas (
  id             uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  objetivo       text not null,
  acao           text,
  prazo          date,
  status         text not null default 'andamento' check (status in ('andamento','concluido','cancelado')),
  obs            text,
  atualizado_em  timestamptz not null default now()
);

-- segurança do trabalho
create table if not exists public.rh_epis (
  id               uuid primary key default gen_random_uuid(),
  funcionario_id   uuid not null references public.funcionarios(id) on delete cascade,
  epi              text not null,
  ca               text,
  entrega          date not null,
  validade_ca      date,
  vida_util_meses  int check (vida_util_meses is null or vida_util_meses > 0),
  quantidade       numeric(8,1) not null default 1 check (quantidade > 0),
  motivo           text check (motivo is null or motivo in ('Admissional','Troca por desgaste','Danificado/Perdido','Alteração de função')),
  obs              text,
  atualizado_em    timestamptz not null default now()
);
create table if not exists public.rh_asos (
  id                  uuid primary key default gen_random_uuid(),
  funcionario_id      uuid not null references public.funcionarios(id) on delete cascade,
  tipo                text not null check (tipo in ('Admissional','Periódico','Retorno ao trabalho','Mudança de risco','Demissional')),
  data_exame          date not null,
  periodicidade_meses int check (periodicidade_meses is null or periodicidade_meses > 0),
  resultado           text check (resultado is null or resultado in ('Apto','Inapto','Apto com restrição')),
  medico              text,
  crm                 text,
  obs                 text,
  atualizado_em       timestamptz not null default now()
);

-- medidas disciplinares
create sequence if not exists public.rh_ocorrencias_seq;
create table if not exists public.rh_ocorrencias (
  id               uuid primary key default gen_random_uuid(),
  numero           int not null unique default nextval('public.rh_ocorrencias_seq'),
  funcionario_id   uuid not null references public.funcionarios(id) on delete cascade,
  tipo             text not null check (tipo in ('verbal','escrita','suspensao')),
  data_ocorrencia  date not null,
  data_aplicacao   date,
  status           text not null default 'pendente' check (status in ('rascunho','pendente','assinado','recusado','cancelado')),
  categoria        text,
  assunto          text,
  descricao        text,
  dias             int check (dias is null or dias between 1 and 30),
  inicio           date,
  retorno          date,
  recusou          boolean not null default false,
  testemunha1      text,
  testemunha1_cpf  text,
  testemunha2      text,
  testemunha2_cpf  text,
  aplicador        text,
  aplicador_cargo  text,
  obs              text,
  criado_por       uuid default auth.uid(),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

-- processos trabalhistas (aba "PROCESSOS" da relação de funcionários) — confidencial: só RH, Escritório e Dono
create table if not exists public.rh_processos (
  id             uuid primary key default gen_random_uuid(),
  funcionario_id uuid references public.funcionarios(id) on delete set null,
  autor          text not null,
  numero         text,
  data_autuacao  date,
  advogado       text,
  cnpj_advogado  text,
  situacao       text not null default 'andamento' check (situacao in ('andamento','acordo','ganho','perdido','arquivado')),
  valor          numeric(12,2),
  obs            text,
  atualizado_em  timestamptz not null default now()
);

-- anexos (PDF/foto): certificados, ASO, documentos assinados, provas. O conteúdo fica separado (só é buscado ao abrir).
create table if not exists public.rh_anexos (
  id          uuid primary key default gen_random_uuid(),
  tabela      text not null,
  registro_id uuid not null,
  nome        text not null,
  tipo        text not null,
  tamanho     int not null,
  criado_por  uuid default auth.uid(),
  criado_em   timestamptz not null default now()
);
create index if not exists rh_anexos_reg on public.rh_anexos (registro_id);
do $$ begin
  alter table public.rh_anexos drop constraint if exists rh_anexos_tabela_check;
  alter table public.rh_anexos add constraint rh_anexos_tabela_check check (tabela in ('funcionarios','rh_matriz_niveis','rh_asos','rh_epis','rh_ocorrencias','rh_ausencias','rh_processos','rh_epi_catalogo'));
end $$;
create table if not exists public.rh_anexos_conteudo (
  anexo_id uuid primary key references public.rh_anexos(id) on delete cascade,
  conteudo text not null           -- base64
);

-- preferências de cada pessoa (ex.: atalhos do Início)
alter table public.perfis add column if not exists preferencias jsonb not null default '{}'::jsonb;

-- histórico: guarda também o IP de quem fez
alter table public.historico add column if not exists ip text;

-- ---------------------------------------------------------------------
-- Gatilhos (data de alteração e histórico) e segurança de leitura
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['rh_setores','rh_cargos','rh_ausencias','rh_ponto','rh_matrizes','rh_matriz_itens','rh_matriz_niveis',
                           'rh_plano_treinos','rh_metas','rh_epis','rh_asos','rh_ocorrencias','rh_processos'] loop
    execute format('drop trigger if exists tg_atualizado on public.%I', t);
    execute format('create trigger tg_atualizado before update on public.%I for each row execute function public.tg_atualizado()', t);
  end loop;
  foreach t in array array['rh_setores','rh_cargos','rh_historico','rh_ausencias','rh_ponto','rh_ponto_meses','rh_feriados','rh_matrizes',
                           'rh_matriz_itens','rh_matriz_niveis','rh_plano_treinos','rh_metas','rh_epis','rh_asos','rh_ocorrencias','rh_anexos','rh_processos'] loop
    execute format('drop trigger if exists tg_historico on public.%I', t);
    execute format('create trigger tg_historico after insert or update or delete on public.%I for each row execute function public.tg_historico()', t);
  end loop;
  foreach t in array array['rh_setores','rh_cargos','rh_historico','rh_ausencias','rh_ponto','rh_ponto_meses','rh_feriados','rh_matrizes',
                           'rh_matriz_itens','rh_matriz_niveis','rh_plano_treinos','rh_metas','rh_epis','rh_asos','rh_ocorrencias','rh_processos',
                           'rh_anexos','rh_anexos_conteudo'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('drop policy if exists ler on public.%I', t);
  end loop;
end $$;
grant select on public.rh_setores, public.rh_cargos, public.rh_historico, public.rh_ausencias, public.rh_ponto, public.rh_ponto_meses,
  public.rh_feriados, public.rh_matrizes, public.rh_matriz_itens, public.rh_matriz_niveis, public.rh_plano_treinos, public.rh_metas,
  public.rh_epis, public.rh_asos, public.rh_ocorrencias, public.rh_anexos, public.rh_processos to authenticated;
revoke all on sequence public.rh_ocorrencias_seq from anon, authenticated;

-- quem vê: RH completo (dono, escritório, rh); gerente consulta o que não é dado pessoal sensível
create policy ler on public.rh_setores        for select to authenticated using (public.ve_rh());
create policy ler on public.rh_cargos         for select to authenticated using (public.ve_rh());
create policy ler on public.rh_historico      for select to authenticated using (public.pode_rh());
create policy ler on public.rh_ausencias      for select to authenticated using (public.pode_rh());
create policy ler on public.rh_ponto          for select to authenticated using (public.ve_rh());
create policy ler on public.rh_ponto_meses    for select to authenticated using (public.ve_rh());
create policy ler on public.rh_feriados       for select to authenticated using (public.meu_perfil() is not null);
create policy ler on public.rh_matrizes       for select to authenticated using (public.ve_rh());
create policy ler on public.rh_matriz_itens   for select to authenticated using (public.ve_rh());
create policy ler on public.rh_matriz_niveis  for select to authenticated using (public.ve_rh());
create policy ler on public.rh_plano_treinos  for select to authenticated using (public.ve_rh());
create policy ler on public.rh_metas          for select to authenticated using (public.ve_rh());
create policy ler on public.rh_epis           for select to authenticated using (public.ve_rh());
create policy ler on public.rh_asos           for select to authenticated using (public.ve_rh());
create policy ler on public.rh_ocorrencias    for select to authenticated using (public.ve_rh());
create policy ler on public.rh_anexos         for select to authenticated using (public.pode_rh());
create policy ler on public.rh_processos      for select to authenticated using (public.pode_rh());
-- rh_anexos_conteudo: ninguém lê direto (só pela função rh_baixar_anexo)

-- gerente: quem está fora (férias, afastado…) sem CID nem observação
create or replace function public.rh_ausencias_resumo() returns table (id uuid, funcionario_id uuid, tipo text, inicio date, fim date, abona boolean)
language sql stable security definer set search_path = public as $$
  select a.id, a.funcionario_id, a.tipo, a.inicio, a.fim, a.abona from public.rh_ausencias a where public.ve_rh() $$;

-- ---------------------------------------------------------------------
-- Funcionário (cadastro) e linha do tempo de cargo/salário
-- ---------------------------------------------------------------------
drop function if exists public.salvar_funcionario(jsonb);
create or replace function public.salvar_funcionario(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_nome text := public.nz(p ->> 'nome'); pr jsonb := p -> 'privado';
        v_novo boolean; v_cpf text; v_cargo uuid := public.uid_de(p, 'cargo_id'); v_funcao text := public.nz(p->>'funcao');
        v_sit text := coalesce(public.nz(p->>'situacao'), case when coalesce((p->>'ativo')::boolean, true) then 'ativo' else 'desligado' end);
        v_reg text := public.nz(p->>'registro'); v_sal numeric;
begin
  perform public.exigir('dono','escritorio','rh');
  if v_nome is null then raise exception 'Informe o nome do funcionário'; end if;
  if v_sit not in ('ativo','afastado','desligado') then raise exception 'Situação inválida'; end if;
  if v_reg is not null and v_reg not in ('Matriz','Filial','Upgrade','Sem registro') then raise exception 'Registro inválido (Matriz, Filial, Upgrade ou Sem registro)'; end if;
  if v_cargo is not null then select nome into v_funcao from public.rh_cargos where id = v_cargo; end if;
  if public.uid_de(p, 'superior_id') = v_id then raise exception 'A pessoa não pode ser chefe dela mesma'; end if;
  v_novo := not exists (select 1 from public.funcionarios where id = v_id);
  if v_sit = 'desligado' and public.dt(p, 'demissao') is null and not v_novo
     and (select situacao from public.funcionarios where id = v_id) <> 'desligado' then
    raise exception 'Informe a data de desligamento';
  end if;
  insert into public.funcionarios (id, nome, funcao, setor, telefone, admissao, ativo, matricula, matricula_esocial, registro, cargo_id,
                                   superior_id, horario, descanso, situacao, demissao, ferias_base)
  values (v_id, v_nome, v_funcao, public.nz(p->>'setor'), public.nz(p->>'telefone'), public.dt(p, 'admissao'), v_sit <> 'desligado',
          public.nz(p->>'matricula'), public.nz(p->>'matricula_esocial'), v_reg, v_cargo, public.uid_de(p, 'superior_id'),
          public.nz(p->>'horario'), public.nz(p->>'descanso'), v_sit, public.dt(p, 'demissao'),
          public.dt(p, 'ferias_base'))
  on conflict (id) do update set nome = excluded.nome, funcao = excluded.funcao, setor = excluded.setor, telefone = excluded.telefone,
          admissao = excluded.admissao, ativo = excluded.ativo, matricula = excluded.matricula, matricula_esocial = excluded.matricula_esocial,
          registro = excluded.registro, cargo_id = excluded.cargo_id, superior_id = excluded.superior_id, horario = excluded.horario,
          descanso = excluded.descanso, situacao = excluded.situacao, demissao = excluded.demissao,
          ferias_base = excluded.ferias_base;
  if pr is not null and jsonb_typeof(pr) = 'object' then
    v_cpf := public.cpf_fmt(pr->>'cpf');
    if v_cpf is not null and not public.cpf_valido(v_cpf) then raise exception 'CPF inválido: confira os números (%)', v_cpf; end if;
    if v_cpf is not null and exists (select 1 from public.funcionarios_privado x join public.funcionarios f on f.id = x.funcionario_id
                                      where regexp_replace(x.cpf, '\D', '', 'g') = regexp_replace(v_cpf, '\D', '', 'g') and x.funcionario_id <> v_id) then
      raise exception 'Já existe um funcionário com o CPF % (%)', v_cpf,
        (select f.nome from public.funcionarios_privado x join public.funcionarios f on f.id = x.funcionario_id
          where regexp_replace(x.cpf, '\D', '', 'g') = regexp_replace(v_cpf, '\D', '', 'g') and x.funcionario_id <> v_id limit 1);
    end if;
    -- salário de quem já existe só muda pela "Alteração de cargo/salário" (fica na linha do tempo)
    v_sal := case when v_novo or not exists (select 1 from public.funcionarios_privado where funcionario_id = v_id) or (pr ? 'salario_forcar')
                  then public.num(pr, 'salario') else (select salario from public.funcionarios_privado where funcionario_id = v_id) end;
    insert into public.funcionarios_privado (funcionario_id, salario, salario_he, cpf, rg, pis, titulo_eleitor, reservista, cnh, nascimento, sexo,
           estado_civil, nacionalidade, naturalidade, uf_nascimento, mae, pai, instrucao, email, celular, endereco, numero, complemento,
           bairro, cep, cidade, banco, pix, emergencia_nome, emergencia_fone, telefone_corp, uniforme, calcado, chave_celular,
           chave_vestiario, indicacao, ferias, obs, obs_desligamento, ctps, raca_cor, pais_origem, telefone_fixo, rg_orgao, rg_uf, rg_emissao,
           cnh_categoria, cnh_validade, categoria_militar, motivo_demissao)
    values (v_id, v_sal, public.num(pr, 'salario_he'), v_cpf, public.nz(pr->>'rg'), public.nz(pr->>'pis'), public.nz(pr->>'titulo_eleitor'),
            public.nz(pr->>'reservista'), public.nz(pr->>'cnh'), public.dt(pr, 'nascimento'), public.nz(pr->>'sexo'), public.nz(pr->>'estado_civil'),
            public.nz(pr->>'nacionalidade'), public.nz(pr->>'naturalidade'), upper(public.nz(pr->>'uf_nascimento')), public.nz(pr->>'mae'),
            public.nz(pr->>'pai'), public.nz(pr->>'instrucao'), lower(public.nz(pr->>'email')), public.nz(pr->>'celular'), public.nz(pr->>'endereco'),
            public.nz(pr->>'numero'), public.nz(pr->>'complemento'), public.nz(pr->>'bairro'), public.nz(pr->>'cep'), public.nz(pr->>'cidade'),
            public.nz(pr->>'banco'), public.nz(pr->>'pix'), public.nz(pr->>'emergencia_nome'), public.nz(pr->>'emergencia_fone'),
            public.nz(pr->>'telefone_corp'), upper(public.nz(pr->>'uniforme')), public.nz(pr->>'calcado'), public.nz(pr->>'chave_celular'),
            public.nz(pr->>'chave_vestiario'), public.nz(pr->>'indicacao'),
            case when jsonb_typeof(pr->'ferias') = 'array' then pr->'ferias' else '[]'::jsonb end, public.nzt(pr->>'obs'), public.nzt(pr->>'obs_desligamento'),
            public.nz(pr->>'ctps'), public.nz(pr->>'raca_cor'), public.nz(pr->>'pais_origem'), public.nz(pr->>'telefone_fixo'), public.nz(pr->>'rg_orgao'),
            upper(public.nz(pr->>'rg_uf')), public.dt(pr, 'rg_emissao'), upper(public.nz(pr->>'cnh_categoria')), public.dt(pr, 'cnh_validade'), public.nz(pr->>'categoria_militar'), public.nz(pr->>'motivo_demissao'))
    on conflict (funcionario_id) do update set salario = excluded.salario, salario_he = excluded.salario_he, cpf = excluded.cpf, rg = excluded.rg,
            pis = excluded.pis, titulo_eleitor = excluded.titulo_eleitor, reservista = excluded.reservista, cnh = excluded.cnh,
            nascimento = excluded.nascimento, sexo = excluded.sexo, estado_civil = excluded.estado_civil, nacionalidade = excluded.nacionalidade,
            naturalidade = excluded.naturalidade, uf_nascimento = excluded.uf_nascimento, mae = excluded.mae, pai = excluded.pai,
            instrucao = excluded.instrucao, email = excluded.email, celular = excluded.celular, endereco = excluded.endereco,
            numero = excluded.numero, complemento = excluded.complemento, bairro = excluded.bairro, cep = excluded.cep, cidade = excluded.cidade,
            banco = excluded.banco, pix = excluded.pix, emergencia_nome = excluded.emergencia_nome, emergencia_fone = excluded.emergencia_fone,
            telefone_corp = excluded.telefone_corp, uniforme = excluded.uniforme, calcado = excluded.calcado,
            chave_celular = excluded.chave_celular, chave_vestiario = excluded.chave_vestiario, indicacao = excluded.indicacao,
            ferias = excluded.ferias, obs = excluded.obs, obs_desligamento = excluded.obs_desligamento, ctps = excluded.ctps, raca_cor = excluded.raca_cor,
            pais_origem = excluded.pais_origem, telefone_fixo = excluded.telefone_fixo, rg_orgao = excluded.rg_orgao, rg_uf = excluded.rg_uf,
            rg_emissao = excluded.rg_emissao, cnh_categoria = excluded.cnh_categoria, cnh_validade = excluded.cnh_validade, categoria_militar = excluded.categoria_militar,
            motivo_demissao = excluded.motivo_demissao;
  end if;
  -- admissão abre a linha do tempo
  if v_novo and public.dt(p, 'admissao') is not null then
    insert into public.rh_historico (funcionario_id, vigencia, cargo, salario, motivo, setor)
    values (v_id, public.dt(p, 'admissao'), v_funcao, v_sal, 'Admissão', public.nz(p->>'setor'));
  end if;
  return v_id;
end $$;

-- promoção, dissídio, aumento… (pergunta motivo e vigência; vira linha na linha do tempo)
create or replace function public.rh_alterar_cargo_salario(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_f uuid := public.uid_de(p, 'funcionario_id'); v_id uuid := gen_random_uuid(); v_vig date := public.dt(p, 'vigencia');
        v_sal numeric := public.num(p, 'salario'); v_cargo uuid := public.uid_de(p, 'cargo_id'); v_nome text := public.nz(p->>'cargo');
        v_motivo text := coalesce(public.nz(p->>'motivo'), 'Espontâneo'); v_setor text := public.nz(p->>'setor');
begin
  perform public.exigir('dono','escritorio','rh');
  if not exists (select 1 from public.funcionarios where id = v_f) then raise exception 'Funcionário não encontrado'; end if;
  if v_vig is null then raise exception 'Informe a data de vigência'; end if;
  if v_sal is not null and v_sal <= 0 then raise exception 'Salário inválido'; end if;
  if v_cargo is not null then select nome into v_nome from public.rh_cargos where id = v_cargo; end if;
  if v_nome is null and v_sal is null and v_setor is null then raise exception 'Informe o novo cargo, setor ou salário'; end if;
  insert into public.rh_historico (id, funcionario_id, vigencia, cargo, salario, motivo, setor, obs)
  values (v_id, v_f, v_vig, v_nome, v_sal, v_motivo, v_setor, public.nzt(p->>'obs'));
  -- vale a partir da vigência: se já está valendo, atualiza o cadastro atual
  if v_vig <= public.hoje() and not exists (select 1 from public.rh_historico where funcionario_id = v_f and vigencia > v_vig and vigencia <= public.hoje()) then
    update public.funcionarios set funcao = coalesce(v_nome, funcao), cargo_id = case when v_nome is not null then v_cargo else cargo_id end,
           setor = coalesce(v_setor, setor) where id = v_f;
    if v_sal is not null then
      insert into public.funcionarios_privado (funcionario_id, salario) values (v_f, v_sal)
      on conflict (funcionario_id) do update set salario = excluded.salario;
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.rh_excluir_historico(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir('dono','rh','escritorio');
  if (select motivo from public.rh_historico where id = p_id) = 'Admissão' then raise exception 'A linha da admissão não pode ser apagada (corrija o cadastro)'; end if;
  delete from public.rh_historico where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Setores e cargos (organograma)
-- ---------------------------------------------------------------------
create or replace function public.rh_salvar_setor(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_nome text := public.nz(p->>'nome'); v_velho text;
begin
  perform public.exigir('dono','escritorio','rh');
  if v_nome is null then raise exception 'Informe o nome do setor'; end if;
  if exists (select 1 from public.rh_setores where lower(nome) = lower(v_nome) and id <> v_id) then raise exception 'Já existe o setor "%"', v_nome; end if;
  select nome into v_velho from public.rh_setores where id = v_id;
  insert into public.rh_setores (id, nome, gestor_id, ativo) values (v_id, v_nome, public.uid_de(p, 'gestor_id'), coalesce((p->>'ativo')::boolean, true))
  on conflict (id) do update set nome = excluded.nome, gestor_id = excluded.gestor_id, ativo = excluded.ativo;
  -- renomeou: leva junto quem estava no setor
  if v_velho is not null and v_velho <> v_nome then
    update public.funcionarios set setor = v_nome where setor = v_velho;
    update public.rh_cargos set setor = v_nome where setor = v_velho;
  end if;
  return v_id;
end $$;


-- ---------------------------------------------------------------------
-- Férias, atestados e afastamentos
-- Férias (CLT art. 134): até 3 partes no mesmo período aquisitivo; uma com 14 dias ou mais e nenhuma com menos de 5; total até 30.
-- ---------------------------------------------------------------------
create or replace function public.rh_salvar_ausencia(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_f uuid := public.uid_de(p, 'funcionario_id');
        v_tipo text := public.nz(p->>'tipo'); v_ini date := public.dt(p, 'inicio'); v_fim date := public.dt(p, 'fim');
        v_aq date := public.dt(p, 'aquisitivo_inicio'); v_dias int; v_partes int; v_total int; v_maior int; v_menor int;
begin
  perform public.exigir('dono','escritorio','rh');
  if not exists (select 1 from public.funcionarios where id = v_f) then raise exception 'Escolha o funcionário'; end if;
  if v_tipo is null or v_tipo not in ('ferias','atestado','afastamento','licenca','suspensao','folga','falta','declaracao') then raise exception 'Tipo inválido'; end if;
  if v_ini is null then raise exception 'Informe a data de início'; end if;
  if v_fim is not null and v_fim < v_ini then raise exception 'A data final é antes do início'; end if;
  if v_tipo in ('ferias','suspensao','folga','falta','declaracao') and v_fim is null then raise exception 'Informe a data final'; end if;
  if exists (select 1 from public.rh_ausencias a where a.funcionario_id = v_f and a.id <> v_id
             and a.inicio <= coalesce(v_fim, '9999-12-31') and coalesce(a.fim, '9999-12-31') >= v_ini) then
    raise exception 'Já existe férias/afastamento lançado nesses dias para esta pessoa';
  end if;
  if v_tipo = 'ferias' then
    v_dias := v_fim - v_ini + 1;
    if v_dias < 5 then raise exception 'Férias não podem ter menos de 5 dias (CLT art. 134)'; end if;
    if v_aq is null then raise exception 'Informe o período aquisitivo das férias'; end if;
    select count(*) + 1, coalesce(sum(fim - inicio + 1), 0) + v_dias, greatest(coalesce(max(fim - inicio + 1), 0), v_dias)
      into v_partes, v_total, v_maior
      from public.rh_ausencias where funcionario_id = v_f and tipo = 'ferias' and aquisitivo_inicio = v_aq and id <> v_id;
    if v_partes > 3 then raise exception 'As férias de um período podem ser divididas em no máximo 3 partes'; end if;
    if v_total > 30 then raise exception 'Passou de 30 dias de férias nesse período aquisitivo (ficaria com % dias)', v_total; end if;
    -- quando o período fecha (30 dias) uma das partes tem de ter 14 dias ou mais
    if v_total = 30 and v_maior < 14 then raise exception 'Uma das partes das férias precisa ter 14 dias ou mais (CLT art. 134)'; end if;
    if v_partes = 3 and v_total < 30 then raise exception 'Com 3 partes, as férias precisam somar os 30 dias'; end if;
  end if;
  insert into public.rh_ausencias (id, funcionario_id, tipo, inicio, fim, aquisitivo_inicio, motivo, cid, abona, obs, ocorrencia_id)
  values (v_id, v_f, v_tipo, v_ini, v_fim, case when v_tipo = 'ferias' then v_aq end, public.nz(p->>'motivo'), upper(public.nz(p->>'cid')),
          coalesce((p->>'abona')::boolean, v_tipo not in ('falta','suspensao')), public.nzt(p->>'obs'), public.uid_de(p, 'ocorrencia_id'))
  on conflict (id) do update set tipo = excluded.tipo, inicio = excluded.inicio, fim = excluded.fim, aquisitivo_inicio = excluded.aquisitivo_inicio,
          motivo = excluded.motivo, cid = excluded.cid, abona = excluded.abona, obs = excluded.obs, ocorrencia_id = excluded.ocorrencia_id;
  -- afastado hoje: situação "afastado" (volta para "ativo" quando acabar)
  if v_tipo in ('afastamento','licenca') and v_ini <= public.hoje() and coalesce(v_fim, '9999-12-31') >= public.hoje() then
    update public.funcionarios set situacao = 'afastado' where id = v_f and situacao = 'ativo';
  end if;
  return v_id;
end $$;

create or replace function public.rh_excluir_ausencia(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir('dono','escritorio','rh');
  delete from public.rh_ausencias where id = p_id;
  if not found then raise exception 'Lançamento não encontrado'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Ponto: grava vários dias de uma vez (uma pessoa, um mês)
-- dias: [{data, e1, s1, e2, s2, justificativa, obs}] — dia sem nada é apagado.
-- Dia de férias/afastamento/suspensão fica travado (não aceita horário).
-- ---------------------------------------------------------------------
create or replace function public.rh_salvar_ponto(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_f uuid := public.uid_de(p, 'funcionario_id'); d jsonb; v_data date; n int := 0;
        v_e1 time; v_s1 time; v_e2 time; v_s2 time; v_j text; v_o text;
begin
  perform public.exigir('dono','escritorio','rh');
  if not exists (select 1 from public.funcionarios where id = v_f) then raise exception 'Funcionário não encontrado'; end if;
  if jsonb_typeof(p->'dias') <> 'array' then raise exception 'Nada para gravar'; end if;
  for d in select * from jsonb_array_elements(p->'dias') loop
    v_data := public.dt(d, 'data');
    if v_data is null then raise exception 'Dia sem data'; end if;
    if exists (select 1 from public.rh_ponto_meses where funcionario_id = v_f and competencia = date_trunc('month', v_data)::date) then
      raise exception 'O mês de % já foi fechado. Reabra o mês para mudar o ponto.', to_char(v_data, 'MM/YYYY');
    end if;
    begin
      v_e1 := nullif(btrim(coalesce(d->>'e1', '')), '')::time; v_s1 := nullif(btrim(coalesce(d->>'s1', '')), '')::time;
      v_e2 := nullif(btrim(coalesce(d->>'e2', '')), '')::time; v_s2 := nullif(btrim(coalesce(d->>'s2', '')), '')::time;
    exception when others then raise exception 'Horário inválido no dia % (use 07:00)', to_char(v_data, 'DD/MM');
    end;
    v_j := public.nz(d->>'justificativa'); v_o := public.nzt(d->>'obs');
    if v_j is not null and v_j not in ('atestado','declaracao','licenca','folga','falta','abonado','compensado','bh_pos','bh_neg') then raise exception 'Justificativa inválida'; end if;
    if (v_e1 is null) <> (v_s1 is null) or (v_e2 is null) <> (v_s2 is null) then
      raise exception 'Dia %: cada entrada precisa da sua saída', to_char(v_data, 'DD/MM');
    end if;
    if (v_e1 is not null and v_s1 <= v_e1) or (v_e2 is not null and v_s2 <= v_e2) or (v_s1 is not null and v_e2 is not null and v_e2 < v_s1) then
      raise exception 'Dia %: os horários estão fora de ordem', to_char(v_data, 'DD/MM');
    end if;
    if (v_e1 is not null or v_e2 is not null) and exists (select 1 from public.rh_ausencias a where a.funcionario_id = v_f and a.tipo in ('ferias','afastamento','licenca','suspensao')
               and a.inicio <= v_data and coalesce(a.fim, '9999-12-31') >= v_data) then
      raise exception 'Dia %: a pessoa está de férias/afastada/suspensa (o dia fica travado)', to_char(v_data, 'DD/MM');
    end if;
    if v_e1 is null and v_e2 is null and v_j is null and v_o is null then
      delete from public.rh_ponto where funcionario_id = v_f and data = v_data;
    else
      insert into public.rh_ponto (funcionario_id, data, e1, s1, e2, s2, justificativa, obs)
      values (v_f, v_data, v_e1, v_s1, v_e2, v_s2, v_j, v_o)
      on conflict (funcionario_id, data) do update set e1 = excluded.e1, s1 = excluded.s1, e2 = excluded.e2, s2 = excluded.s2,
              justificativa = excluded.justificativa, obs = excluded.obs;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.rh_fechar_mes(p_func uuid, p_competencia date, p_fechar boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_c date := date_trunc('month', p_competencia)::date;
begin
  perform public.exigir('dono','escritorio','rh');
  if p_fechar then
    insert into public.rh_ponto_meses (funcionario_id, competencia) values (p_func, v_c) on conflict do nothing;
  else
    delete from public.rh_ponto_meses where funcionario_id = p_func and competencia = v_c;
  end if;
end $$;

create or replace function public.rh_salvar_feriado(p_data date, p_nome text, p_excluir boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir('dono','escritorio','rh');
  if p_data is null then raise exception 'Informe a data'; end if;
  if p_excluir then delete from public.rh_feriados where data = p_data; return; end if;
  if public.nz(p_nome) is null then raise exception 'Informe o nome do feriado'; end if;
  insert into public.rh_feriados (data, nome) values (p_data, public.nz(p_nome)) on conflict (data) do update set nome = excluded.nome;
end $$;

-- ---------------------------------------------------------------------
-- Treinamentos, procedimentos e versatilidade
-- ---------------------------------------------------------------------
create or replace function public.rh_salvar_matriz(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); i jsonb; n int := 0; v_item uuid; v_manter uuid[] := '{}';
begin
  perform public.exigir('dono','escritorio','rh');
  if public.nz(p->>'nome') is null then raise exception 'Informe o nome da matriz'; end if;
  if coalesce(p->>'tipo', '') not in ('treinamento','procedimento','versatilidade') then raise exception 'Tipo de matriz inválido'; end if;
  insert into public.rh_matrizes (id, nome, tipo, setor, gestor, legenda, objetivo, aprovado_por, aprovado_em, ordem, ativo)
  values (v_id, public.nz(p->>'nome'), p->>'tipo', public.nz(p->>'setor'), public.nz(p->>'gestor'),
          case when jsonb_typeof(p->'legenda') = 'array' then p->'legenda' else '[]'::jsonb end, public.nzt(p->>'objetivo'),
          public.nz(p->>'aprovado_por'), public.dt(p, 'aprovado_em'), coalesce(public.num(p, 'ordem'), 0)::int, coalesce((p->>'ativo')::boolean, true))
  on conflict (id) do update set nome = excluded.nome, tipo = excluded.tipo, setor = excluded.setor, gestor = excluded.gestor,
          legenda = excluded.legenda, objetivo = excluded.objetivo, aprovado_por = excluded.aprovado_por, aprovado_em = excluded.aprovado_em,
          ordem = excluded.ordem, ativo = excluded.ativo;
  if jsonb_typeof(p->'itens') = 'array' then
    for i in select * from jsonb_array_elements(p->'itens') loop
      n := n + 1;
      if public.nz(i->>'nome') is null then raise exception 'Coluna % sem nome', n; end if;
      v_item := coalesce(public.uid_de(i, 'id'), gen_random_uuid());
      insert into public.rh_matriz_itens (id, matriz_id, nome, ordem, carga_horaria, validade_meses, obrigatorio, ativo)
      values (v_item, v_id, public.nz(i->>'nome'), n, public.num(i, 'carga_horaria'), nullif(public.num(i, 'validade_meses')::int, 0),
              coalesce((i->>'obrigatorio')::boolean, false), true)
      on conflict (id) do update set nome = excluded.nome, ordem = excluded.ordem, carga_horaria = excluded.carga_horaria,
              validade_meses = excluded.validade_meses, obrigatorio = excluded.obrigatorio, ativo = true;
      v_manter := v_manter || v_item;
    end loop;
    -- coluna tirada da matriz: some da tela, mas o que já foi marcado fica guardado
    update public.rh_matriz_itens set ativo = false where matriz_id = v_id and not (id = any(v_manter));
  end if;
  return v_id;
end $$;

create or replace function public.rh_definir_nivel(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_item uuid := public.uid_de(p, 'item_id'); v_f uuid := public.uid_de(p, 'funcionario_id'); v_n int := public.num(p, 'nivel')::int;
begin
  perform public.exigir('dono','escritorio','rh');
  if not exists (select 1 from public.rh_matriz_itens where id = v_item) then raise exception 'Treinamento não encontrado'; end if;
  if not exists (select 1 from public.funcionarios where id = v_f) then raise exception 'Funcionário não encontrado'; end if;
  if v_n is null then
    delete from public.rh_matriz_niveis where item_id = v_item and funcionario_id = v_f;
    return;
  end if;
  if v_n < 0 or v_n > 4 then raise exception 'Nível inválido'; end if;
  insert into public.rh_matriz_niveis (item_id, funcionario_id, nivel, data, obs)
  values (v_item, v_f, v_n, public.dt(p, 'data'), public.nzt(p->>'obs'))
  on conflict (item_id, funcionario_id) do update set nivel = excluded.nivel,
          data = case when p ? 'data' then excluded.data else public.rh_matriz_niveis.data end,
          obs = case when p ? 'obs' then excluded.obs else public.rh_matriz_niveis.obs end;
end $$;

create or replace function public.rh_salvar_plano(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid());
begin
  perform public.exigir('dono','escritorio','rh');
  if (p->>'excluir')::boolean then delete from public.rh_plano_treinos where id = v_id; return v_id; end if;
  if public.nz(p->>'treinamento') is null then raise exception 'Informe o treinamento'; end if;
  insert into public.rh_plano_treinos (id, matriz_id, treinamento, data, instituicao, modalidade, status, obs)
  values (v_id, public.uid_de(p, 'matriz_id'), public.nz(p->>'treinamento'), public.dt(p, 'data'), public.nz(p->>'instituicao'),
          public.nz(p->>'modalidade'), coalesce(public.nz(p->>'status'), 'planejado'), public.nzt(p->>'obs'))
  on conflict (id) do update set matriz_id = excluded.matriz_id, treinamento = excluded.treinamento, data = excluded.data,
          instituicao = excluded.instituicao, modalidade = excluded.modalidade, status = excluded.status, obs = excluded.obs;
  return v_id;
end $$;

create or replace function public.rh_salvar_meta(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid());
begin
  perform public.exigir('dono','escritorio','rh');
  if (p->>'excluir')::boolean then delete from public.rh_metas where id = v_id; return v_id; end if;
  if not exists (select 1 from public.funcionarios where id = public.uid_de(p, 'funcionario_id')) then raise exception 'Funcionário não encontrado'; end if;
  if public.nz(p->>'objetivo') is null then raise exception 'Informe o objetivo'; end if;
  insert into public.rh_metas (id, funcionario_id, objetivo, acao, prazo, status, obs)
  values (v_id, public.uid_de(p, 'funcionario_id'), public.nz(p->>'objetivo'), public.nzt(p->>'acao'), public.dt(p, 'prazo'),
          coalesce(public.nz(p->>'status'), 'andamento'), public.nzt(p->>'obs'))
  on conflict (id) do update set objetivo = excluded.objetivo, acao = excluded.acao, prazo = excluded.prazo, status = excluded.status, obs = excluded.obs;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- EPI e ASO
-- ---------------------------------------------------------------------

create or replace function public.rh_salvar_aso(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid());
begin
  perform public.exigir('dono','escritorio','rh');
  if (p->>'excluir')::boolean then delete from public.rh_asos where id = v_id; return v_id; end if;
  if not exists (select 1 from public.funcionarios where id = public.uid_de(p, 'funcionario_id')) then raise exception 'Escolha o funcionário'; end if;
  if public.dt(p, 'data_exame') is null then raise exception 'Informe a data do exame'; end if;
  insert into public.rh_asos (id, funcionario_id, tipo, data_exame, periodicidade_meses, resultado, medico, crm, obs)
  values (v_id, public.uid_de(p, 'funcionario_id'), coalesce(public.nz(p->>'tipo'), 'Periódico'), public.dt(p, 'data_exame'),
          nullif(public.num(p, 'periodicidade_meses')::int, 0), public.nz(p->>'resultado'), public.nz(p->>'medico'), public.nz(p->>'crm'), public.nzt(p->>'obs'))
  on conflict (id) do update set tipo = excluded.tipo, data_exame = excluded.data_exame, periodicidade_meses = excluded.periodicidade_meses,
          resultado = excluded.resultado, medico = excluded.medico, crm = excluded.crm, obs = excluded.obs;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Medidas disciplinares (advertência verbal/escrita, suspensão)
-- A suspensão também trava os dias no ponto (sem pagamento).
-- ---------------------------------------------------------------------
create or replace function public.rh_salvar_ocorrencia(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_tipo text := p->>'tipo'; v_f uuid := public.uid_de(p, 'funcionario_id');
        v_dias int := public.num(p, 'dias')::int; v_ini date := public.dt(p, 'inicio'); v_ret date; v_aus uuid; v_status text := coalesce(public.nz(p->>'status'), 'pendente');
begin
  perform public.exigir('dono','escritorio','rh');
  if not exists (select 1 from public.funcionarios where id = v_f) then raise exception 'Escolha o funcionário'; end if;
  if v_tipo is null or v_tipo not in ('verbal','escrita','suspensao') then raise exception 'Escolha o tipo da medida'; end if;
  if public.dt(p, 'data_ocorrencia') is null then raise exception 'Informe a data em que o fato aconteceu'; end if;
  if public.nzt(p->>'descricao') is null then raise exception 'Descreva o que aconteceu'; end if;
  if v_status not in ('rascunho','pendente','assinado','recusado','cancelado') then raise exception 'Situação inválida'; end if;
  if (p->>'recusou')::boolean and (public.nz(p->>'testemunha1') is null or public.nz(p->>'testemunha2') is null) then
    raise exception 'Quando a pessoa se recusa a assinar, são obrigatórias 2 testemunhas';
  end if;
  if v_tipo = 'suspensao' then
    if v_dias is null or v_dias < 1 or v_dias > 30 then raise exception 'Suspensão: de 1 a 30 dias (CLT art. 474)'; end if;
    if v_ini is null then raise exception 'Informe o primeiro dia da suspensão'; end if;
    v_ret := v_ini + v_dias;
  else v_dias := null; v_ini := null;
  end if;
  insert into public.rh_ocorrencias (id, funcionario_id, tipo, data_ocorrencia, data_aplicacao, status, categoria, assunto, descricao, dias, inicio, retorno,
         recusou, testemunha1, testemunha1_cpf, testemunha2, testemunha2_cpf, aplicador, aplicador_cargo, obs)
  values (v_id, v_f, v_tipo, public.dt(p, 'data_ocorrencia'), coalesce(public.dt(p, 'data_aplicacao'), public.hoje()), v_status,
          public.nz(p->>'categoria'), public.nz(p->>'assunto'), public.nzt(p->>'descricao'), v_dias, v_ini, v_ret,
          coalesce((p->>'recusou')::boolean, false), public.nz(p->>'testemunha1'), public.cpf_fmt(p->>'testemunha1_cpf'), public.nz(p->>'testemunha2'),
          public.cpf_fmt(p->>'testemunha2_cpf'), public.nz(p->>'aplicador'), public.nz(p->>'aplicador_cargo'), public.nzt(p->>'obs'))
  on conflict (id) do update set tipo = excluded.tipo, data_ocorrencia = excluded.data_ocorrencia, data_aplicacao = excluded.data_aplicacao,
          status = excluded.status, categoria = excluded.categoria, assunto = excluded.assunto, descricao = excluded.descricao, dias = excluded.dias,
          inicio = excluded.inicio, retorno = excluded.retorno, recusou = excluded.recusou, testemunha1 = excluded.testemunha1,
          testemunha1_cpf = excluded.testemunha1_cpf, testemunha2 = excluded.testemunha2, testemunha2_cpf = excluded.testemunha2_cpf,
          aplicador = excluded.aplicador, aplicador_cargo = excluded.aplicador_cargo, obs = excluded.obs;
  -- suspensão (não cancelada) = dias travados no ponto, sem pagamento
  delete from public.rh_ausencias where ocorrencia_id = v_id;
  if v_tipo = 'suspensao' and v_status <> 'cancelado' then
    if exists (select 1 from public.rh_ausencias a where a.funcionario_id = v_f and a.inicio <= v_ret - 1 and coalesce(a.fim, '9999-12-31') >= v_ini) then
      raise exception 'Há férias/afastamento lançado nos dias da suspensão';
    end if;
    insert into public.rh_ausencias (funcionario_id, tipo, inicio, fim, motivo, abona, ocorrencia_id)
    values (v_f, 'suspensao', v_ini, v_ret - 1, 'Suspensão disciplinar nº ' || (select numero from public.rh_ocorrencias where id = v_id), false, v_id)
    returning id into v_aus;
  end if;
  return jsonb_build_object('id', v_id, 'numero', (select numero from public.rh_ocorrencias where id = v_id));
end $$;

-- ---------------------------------------------------------------------
-- Anexos (PDF, JPG, PNG — até 4 MB)
-- ---------------------------------------------------------------------

create or replace function public.rh_baixar_anexo(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform public.exigir('dono','escritorio','rh');
  select jsonb_build_object('nome', a.nome, 'tipo', a.tipo, 'conteudo', c.conteudo) into r
    from public.rh_anexos a join public.rh_anexos_conteudo c on c.anexo_id = a.id where a.id = p_id;
  if r is null then raise exception 'Arquivo não encontrado'; end if;
  return r;
end $$;

create or replace function public.rh_excluir_anexo(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir('dono','escritorio','rh');
  delete from public.rh_anexos where id = p_id;
end $$;

create or replace function public.rh_salvar_processo(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid());
begin
  perform public.exigir('dono','escritorio','rh');
  if (p->>'excluir')::boolean then delete from public.rh_processos where id = v_id; return v_id; end if;
  if public.nz(p->>'autor') is null then raise exception 'Informe quem abriu o processo (autor)'; end if;
  if coalesce(public.nz(p->>'situacao'), 'andamento') not in ('andamento','acordo','ganho','perdido','arquivado') then raise exception 'Situação inválida'; end if;
  insert into public.rh_processos (id, funcionario_id, autor, numero, data_autuacao, advogado, cnpj_advogado, situacao, valor, obs)
  values (v_id, public.uid_de(p, 'funcionario_id'), public.nz(p->>'autor'), public.nz(p->>'numero'), public.dt(p, 'data_autuacao'), public.nz(p->>'advogado'),
          public.nz(p->>'cnpj_advogado'), coalesce(public.nz(p->>'situacao'), 'andamento'), public.num(p, 'valor'), public.nzt(p->>'obs'))
  on conflict (id) do update set funcionario_id = excluded.funcionario_id, autor = excluded.autor, numero = excluded.numero, data_autuacao = excluded.data_autuacao,
          advogado = excluded.advogado, cnpj_advogado = excluded.cnpj_advogado, situacao = excluded.situacao, valor = excluded.valor, obs = excluded.obs;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Importação das planilhas do RH (feita uma vez, pelo Dono). O arquivo é montado fora (testes/rh/ler-planilhas.py)
-- e cada pessoa vem com uma "chave"; as outras listas apontam para a chave.
-- ---------------------------------------------------------------------
create or replace function public.importar_rh(p jsonb, p_substituir boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; i jsonb; v_id uuid; v_m uuid; n_p int := 0; n_pt int; n_f int; n_n int := 0; n_a int; n_o int; n_h int; n_pr int; n_pl int; k int;
begin
  perform public.exigir('dono');
  perform set_config('jaf.importando', '1', true);   -- sem uma linha de histórico para cada dia de ponto (fica um resumo no fim)
  if exists (select 1 from public.funcionarios) then
    if not p_substituir then raise exception 'Já existem funcionários cadastrados. Para importar de novo, marque substituir.'; end if;
    if exists (select 1 from public.movimentos where funcionario_id is not null) or exists (select 1 from public.ordens where responsavel_id is not null)
       or exists (select 1 from public.manutencoes where funcionario_id is not null) or exists (select 1 from public.perfis where funcionario_id is not null) then
      raise exception 'Há funcionários ligados a retiradas, ordens, manutenções ou acessos: não dá para substituir.';
    end if;
    delete from public.rh_processos; delete from public.rh_plano_treinos; delete from public.rh_matrizes; delete from public.rh_feriados;
    delete from public.rh_cargos; delete from public.rh_setores; delete from public.funcionarios;
  end if;
  create temp table _mapa (chave text primary key, id uuid not null) on commit drop;

  for x in select * from jsonb_array_elements(coalesce(p->'setores', '[]')) loop
    insert into public.rh_setores (nome) values (x->>'nome') on conflict do nothing;
  end loop;
  -- cargos: primeiro todos, depois a quem cada um responde
  for x in select * from jsonb_array_elements(coalesce(p->'cargos', '[]')) loop
    insert into public.rh_cargos (nome, cbo, setor) values (x->>'nome', public.nz(x->>'cbo'), public.nz(x->>'setor')) on conflict do nothing;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p->'cargos', '[]')) loop
    update public.rh_cargos c set superior_id = (select id from public.rh_cargos where lower(nome) = lower(x->>'superior'))
     where lower(c.nome) = lower(x->>'nome') and public.nz(x->>'superior') is not null;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p->'pessoas', '[]')) loop
    v_id := gen_random_uuid();
    insert into public.funcionarios (id, nome, funcao, setor, telefone, admissao, ativo, matricula, matricula_esocial, registro, cargo_id, horario, descanso,
                                     situacao, demissao, ferias_base)
    values (v_id, x->>'nome', public.nz(x->>'funcao'), public.nz(x->>'setor'), public.nz(x->>'telefone'), public.dt(x, 'admissao'),
            coalesce(x->>'situacao', 'ativo') <> 'desligado', public.nz(x->>'matricula'), public.nz(x->>'matricula_esocial'), public.nz(x->>'registro'),
            (select id from public.rh_cargos where lower(nome) = lower(x->>'cargo')), public.nz(x->>'horario'), public.nz(x->>'descanso'),
            coalesce(public.nz(x->>'situacao'), 'ativo'), public.dt(x, 'demissao'), public.dt(x, 'ferias_base'));
    insert into _mapa values (x->>'chave', v_id);
    if jsonb_typeof(x->'privado') = 'object' then
      insert into public.funcionarios_privado
      select * from jsonb_populate_record(null::public.funcionarios_privado,
        (x->'privado') || jsonb_build_object('funcionario_id', v_id, 'ferias', '[]'::jsonb, 'atualizado_em', now()));
    end if;
    if public.nz(x->>'motivo_demissao') is not null then
      insert into public.funcionarios_privado (funcionario_id, motivo_demissao) values (v_id, public.nz(x->>'motivo_demissao'))
      on conflict (funcionario_id) do update set motivo_demissao = excluded.motivo_demissao;
    end if;
    n_p := n_p + 1;
  end loop;
  -- chefe direto (pessoa) e gestor do setor
  for x in select * from jsonb_array_elements(coalesce(p->'pessoas', '[]')) loop
    if public.nz(x->>'superior') is not null then
      update public.funcionarios set superior_id = (select id from _mapa where chave = x->>'superior') where id = (select id from _mapa where chave = x->>'chave');
    end if;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p->'setores', '[]')) loop
    if public.nz(x->>'gestor') is not null then update public.rh_setores set gestor_id = (select id from _mapa where chave = x->>'gestor') where nome = x->>'nome'; end if;
  end loop;

  insert into public.rh_historico (funcionario_id, vigencia, cargo, salario, motivo, setor, obs)
  select m.id, (h->>'vigencia')::date, public.nz(h->>'cargo'), (h->>'salario')::numeric, coalesce(h->>'motivo', 'Admissão'), public.nz(h->>'setor'), public.nz(h->>'obs')
    from jsonb_array_elements(coalesce(p->'historico', '[]')) h join _mapa m on m.chave = h->>'chave';
  get diagnostics n_h = row_count;

  -- ponto em lista curta (o arquivo fica menor): [chave, data, entrada, saída almoço, volta, saída]
  insert into public.rh_ponto (funcionario_id, data, e1, s1, e2, s2)
  select m.id, (t->>1)::date, (t->>2)::time, (t->>3)::time, (t->>4)::time, (t->>5)::time
    from jsonb_array_elements(coalesce(p->'ponto', '[]')) t join _mapa m on m.chave = t->>0
  on conflict (funcionario_id, data) do nothing;
  get diagnostics n_pt = row_count;

  insert into public.rh_feriados (data, nome) select (f->>'data')::date, f->>'nome' from jsonb_array_elements(coalesce(p->'feriados', '[]')) f on conflict (data) do nothing;
  get diagnostics n_f = row_count;

  for x in select * from jsonb_array_elements(coalesce(p->'matrizes', '[]')) loop
    insert into public.rh_matrizes (nome, tipo, setor, gestor, legenda, objetivo, aprovado_por, aprovado_em, ordem)
    values (x->>'nome', x->>'tipo', public.nz(x->>'setor'), public.nz(x->>'gestor'), coalesce(x->'legenda', '[]'), public.nz(x->>'objetivo'),
            public.nz(x->>'aprovado_por'), public.dt(x, 'aprovado_em'), coalesce((x->>'ordem')::int, 0)) returning id into v_m;
    k := 0;
    for i in select * from jsonb_array_elements(x->'itens') loop
      k := k + 1;
      insert into public.rh_matriz_itens (matriz_id, nome, ordem, carga_horaria, validade_meses, obrigatorio)
      values (v_m, i->>'nome', k, (i->>'carga_horaria')::numeric, (i->>'validade_meses')::int, coalesce((i->>'obrigatorio')::boolean, false));
    end loop;
    insert into public.rh_matriz_niveis (item_id, funcionario_id, nivel)
    select it.id, m.id, (n->>'nivel')::int
      from jsonb_array_elements(coalesce(x->'niveis', '[]')) n join _mapa m on m.chave = n->>'chave'
      join public.rh_matriz_itens it on it.matriz_id = v_m and it.ordem = (n->>'item')::int
    on conflict (item_id, funcionario_id) do update set nivel = excluded.nivel;
    get diagnostics k = row_count; n_n := n_n + k;
  end loop;

  insert into public.rh_plano_treinos (matriz_id, treinamento, data, instituicao, modalidade, status)
  select (select id from public.rh_matrizes where nome = t->>'matriz'), t->>'treinamento', public.dt(t, 'data'), public.nz(t->>'instituicao'), public.nz(t->>'modalidade'),
         coalesce(public.nz(t->>'status'), 'planejado')
    from jsonb_array_elements(coalesce(p->'plano', '[]')) t;
  get diagnostics n_pl = row_count;

  insert into public.rh_asos (funcionario_id, tipo, data_exame, periodicidade_meses, resultado, obs)
  select m.id, coalesce(a->>'tipo', 'Periódico'), (a->>'data_exame')::date, coalesce((a->>'periodicidade_meses')::int, 12), public.nz(a->>'resultado'), public.nz(a->>'obs')
    from jsonb_array_elements(coalesce(p->'asos', '[]')) a join _mapa m on m.chave = a->>'chave';
  get diagnostics n_a = row_count;

  insert into public.rh_ocorrencias (funcionario_id, tipo, data_ocorrencia, data_aplicacao, status, assunto, descricao, obs)
  select m.id, o->>'tipo', (o->>'data_ocorrencia')::date, (o->>'data_ocorrencia')::date, coalesce(o->>'status', 'assinado'), public.nz(o->>'assunto'),
         coalesce(public.nz(o->>'descricao'), public.nz(o->>'assunto'), 'Importado da planilha'), 'Importado da planilha'
    from jsonb_array_elements(coalesce(p->'ocorrencias', '[]')) o join _mapa m on m.chave = o->>'chave';
  get diagnostics n_o = row_count;

  insert into public.rh_processos (funcionario_id, autor, numero, data_autuacao, advogado, cnpj_advogado, obs)
  select (select id from _mapa where chave = r->>'chave'), r->>'autor', public.nz(r->>'numero'), public.dt(r, 'data_autuacao'), public.nz(r->>'advogado'), public.nz(r->>'cnpj_advogado'), public.nz(r->>'obs')
    from jsonb_array_elements(coalesce(p->'processos', '[]')) r;
  get diagnostics n_pr = row_count;

  if jsonb_typeof(p->'config') = 'object' then
    insert into public.config (chave, valor) values ('rh', p->'config') on conflict (chave) do update set valor = public.config.valor || excluded.valor;
  end if;
  perform set_config('jaf.importando', '0', true);
  insert into public.historico (user_id, quem, tabela, acao, depois) values (auth.uid(), public.meu_nome(), 'importacao', 'importar',
    jsonb_build_object('rh', true, 'pessoas', n_p, 'ponto', n_pt, 'feriados', n_f, 'niveis', n_n, 'asos', n_a, 'ocorrencias', n_o, 'historico', n_h, 'processos', n_pr, 'plano', n_pl));
  return jsonb_build_object('pessoas', n_p, 'ponto', n_pt, 'feriados', n_f, 'niveis', n_n, 'asos', n_a, 'ocorrencias', n_o, 'historico', n_h, 'processos', n_pr, 'plano', n_pl,
    'setores', (select count(*) from public.rh_setores), 'cargos', (select count(*) from public.rh_cargos), 'matrizes', (select count(*) from public.rh_matrizes));
end $$;

-- ---------------------------------------------------------------------
-- Preferências da própria pessoa (atalhos e blocos do Início)
-- ---------------------------------------------------------------------
create or replace function public.salvar_preferencias(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.meu_perfil() is null then raise exception 'Sua sessão não tem acesso. Entre de novo.'; end if;
  if jsonb_typeof(p) <> 'object' or length(p::text) > 20000 then raise exception 'Preferências inválidas'; end if;
  update public.perfis set preferencias = p where user_id = auth.uid();
end $$;

-- =====================================================================
-- v2.2 — pedidos do RH: banco de horas, salário por cargo, catálogo de EPI com CA,
--        termo de EPI assinado (foto do rosto ou na tela) e indicadores de RH
-- =====================================================================
-- banco de horas no ponto: BH_POS (crédito +) e BH_NEG (débito −)
do $$ begin
  alter table public.rh_ponto drop constraint if exists rh_ponto_justificativa_check;
  alter table public.rh_ponto add constraint rh_ponto_justificativa_check
    check (justificativa is null or justificativa in ('atestado','declaracao','licenca','folga','falta','abonado','compensado','bh_pos','bh_neg'));
  alter table public.rh_historico drop constraint if exists rh_historico_motivo_check;
  alter table public.rh_historico add constraint rh_historico_motivo_check
    check (motivo in ('Admissão','Promoção','Dissídio','Espontâneo','Mérito','Correção','Mudança de setor','Reajuste do cargo'));
end $$;

-- cargos: tipo (como na planilha "Cargo e salário") e salário do cargo (sensível: só RH, Escritório e Dono)
alter table public.rh_cargos add column if not exists tipo text;
create table if not exists public.rh_cargos_salarios (
  id            uuid primary key references public.rh_cargos(id) on delete cascade,   -- o próprio cargo
  salario       numeric(12,2) not null check (salario > 0),
  atualizado_em timestamptz not null default now()
);

-- catálogo de EPI (planilha "CA - Certificado de Aprovação dos EPIs"); o PDF do CA vai em rh_anexos
create table if not exists public.rh_epi_catalogo (
  id            uuid primary key default gen_random_uuid(),
  descricao     text not null,
  onde_utiliza  text,
  fabricante    text,
  ca            text,
  validade_ca   date,
  tamanhos      text,
  vida_util_meses int check (vida_util_meses is null or vida_util_meses > 0),
  obs           text,
  ativo         boolean not null default true,
  atualizado_em timestamptz not null default now()
);
create index if not exists rh_epi_catalogo_ca on public.rh_epi_catalogo (ca);
alter table public.rh_epis add column if not exists catalogo_id uuid references public.rh_epi_catalogo(id) on delete set null;
alter table public.rh_epis add column if not exists fabricante text;
alter table public.rh_epis add column if not exists tamanho text;
alter table public.rh_epis add column if not exists assinatura text check (assinatura is null or assinatura in ('facial','tela','papel'));
alter table public.rh_epis add column if not exists assinado_em timestamptz;

-- indicadores de RH: o que o sistema não sabe sozinho (receita bruta e custos do mês)
create table if not exists public.rh_indicadores (
  id            uuid primary key default gen_random_uuid(),
  competencia   date not null unique check (extract(day from competencia) = 1),
  receita       numeric(14,2) check (receita is null or receita >= 0),
  beneficios    numeric(14,2) check (beneficios is null or beneficios >= 0),
  encargos      numeric(14,2) check (encargos is null or encargos >= 0),
  outros        numeric(14,2) check (outros is null or outros >= 0),
  atualizado_em timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['rh_cargos_salarios','rh_epi_catalogo','rh_indicadores'] loop
    execute format('drop trigger if exists tg_atualizado on public.%I', t);
    execute format('create trigger tg_atualizado before update on public.%I for each row execute function public.tg_atualizado()', t);
    execute format('drop trigger if exists tg_historico on public.%I', t);
    execute format('create trigger tg_historico after insert or update or delete on public.%I for each row execute function public.tg_historico()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('drop policy if exists ler on public.%I', t);
  end loop;
end $$;
grant select on public.rh_cargos_salarios, public.rh_epi_catalogo, public.rh_indicadores to authenticated;
create policy ler on public.rh_cargos_salarios for select to authenticated using (public.pode_rh());
create policy ler on public.rh_epi_catalogo    for select to authenticated using (public.ve_rh());
create policy ler on public.rh_indicadores     for select to authenticated using (public.pode_rh());

create or replace function public.rh_salvar_cargo(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_nome text := public.nz(p->>'nome'); v_sup uuid := public.uid_de(p, 'superior_id');
        x uuid; n int := 0;
begin
  perform public.exigir('dono','escritorio','rh');
  if v_nome is null then raise exception 'Informe o nome do cargo'; end if;
  if exists (select 1 from public.rh_cargos where lower(nome) = lower(v_nome) and id <> v_id) then raise exception 'Já existe o cargo "%"', v_nome; end if;
  -- não deixa fazer um círculo no organograma (A responde a B que responde a A)
  x := v_sup;
  while x is not null and n < 50 loop
    if x = v_id then raise exception 'Esse superior criaria um círculo no organograma'; end if;
    select superior_id into x from public.rh_cargos where id = x; n := n + 1;
  end loop;
  insert into public.rh_cargos (id, nome, cbo, setor, superior_id, descricao, ativo, tipo)
  values (v_id, v_nome, public.nz(p->>'cbo'), public.nz(p->>'setor'), v_sup, public.nzt(p->>'descricao'), coalesce((p->>'ativo')::boolean, true), public.nz(p->>'tipo'))
  on conflict (id) do update set nome = excluded.nome, cbo = excluded.cbo, setor = excluded.setor, superior_id = excluded.superior_id,
          descricao = excluded.descricao, ativo = excluded.ativo, tipo = excluded.tipo;
  update public.funcionarios set funcao = v_nome where cargo_id = v_id and funcao is distinct from v_nome;
  return v_id;
end $$;

-- salário do cargo. Com aplicar = true, todas as pessoas ativas do cargo passam a ganhar esse salário
-- (entra na linha do tempo de cada uma, com a vigência escolhida). Devolve quantas pessoas mudaram.
create or replace function public.rh_salario_cargo(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_c uuid := public.uid_de(p, 'cargo_id'); v_sal numeric := public.num(p, 'salario'); v_vig date := coalesce(public.dt(p, 'vigencia'), public.hoje());
        v_motivo text := coalesce(public.nz(p->>'motivo'), 'Reajuste do cargo'); v_nome text; f record; n int := 0;
begin
  perform public.exigir('dono','escritorio','rh');
  select nome into v_nome from public.rh_cargos where id = v_c;
  if v_nome is null then raise exception 'Cargo não encontrado'; end if;
  if v_sal is null then delete from public.rh_cargos_salarios where id = v_c; return 0; end if;
  if v_sal <= 0 then raise exception 'Salário inválido'; end if;
  insert into public.rh_cargos_salarios (id, salario) values (v_c, v_sal) on conflict (id) do update set salario = excluded.salario;
  if coalesce((p->>'aplicar')::boolean, false) then
    for f in select x.id from public.funcionarios x left join public.funcionarios_privado pr on pr.funcionario_id = x.id
              where x.cargo_id = v_c and x.ativo and x.situacao <> 'desligado' and pr.salario is distinct from v_sal loop
      perform public.rh_alterar_cargo_salario(jsonb_build_object('funcionario_id', f.id, 'vigencia', v_vig, 'salario', v_sal, 'motivo', v_motivo,
                                                                 'obs', 'Salário do cargo ' || v_nome || ' atualizado para todos'));
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;

create or replace function public.rh_salvar_epi_catalogo(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid());
begin
  perform public.exigir('dono','escritorio','rh');
  if (p->>'excluir')::boolean then delete from public.rh_epi_catalogo where id = v_id; return v_id; end if;
  if public.nz(p->>'descricao') is null then raise exception 'Informe a descrição do EPI'; end if;
  insert into public.rh_epi_catalogo (id, descricao, onde_utiliza, fabricante, ca, validade_ca, tamanhos, vida_util_meses, obs, ativo)
  values (v_id, public.nz(p->>'descricao'), public.nz(p->>'onde_utiliza'), public.nz(p->>'fabricante'), regexp_replace(coalesce(public.nz(p->>'ca'), ''), '\s', '', 'g'),
          public.dt(p, 'validade_ca'), public.nz(p->>'tamanhos'), nullif(public.num(p, 'vida_util_meses')::int, 0), public.nzt(p->>'obs'), coalesce((p->>'ativo')::boolean, true))
  on conflict (id) do update set descricao = excluded.descricao, onde_utiliza = excluded.onde_utiliza, fabricante = excluded.fabricante, ca = excluded.ca,
          validade_ca = excluded.validade_ca, tamanhos = excluded.tamanhos, vida_util_meses = excluded.vida_util_meses, obs = excluded.obs, ativo = excluded.ativo;
  update public.rh_epi_catalogo set ca = null where id = v_id and ca = '';
  return v_id;
end $$;

create or replace function public.rh_salvar_epi(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); c public.rh_epi_catalogo;
begin
  perform public.exigir('dono','escritorio','rh');
  if (p->>'excluir')::boolean then delete from public.rh_epis where id = v_id; return v_id; end if;
  if not exists (select 1 from public.funcionarios where id = public.uid_de(p, 'funcionario_id')) then raise exception 'Escolha o funcionário'; end if;
  select * into c from public.rh_epi_catalogo where id = public.uid_de(p, 'catalogo_id');
  if coalesce(public.nz(p->>'epi'), c.descricao) is null then raise exception 'Informe o equipamento (EPI)'; end if;
  if public.dt(p, 'entrega') is null then raise exception 'Informe a data de entrega'; end if;
  insert into public.rh_epis (id, funcionario_id, epi, ca, entrega, validade_ca, vida_util_meses, quantidade, motivo, obs, catalogo_id, fabricante, tamanho)
  values (v_id, public.uid_de(p, 'funcionario_id'), coalesce(public.nz(p->>'epi'), c.descricao), coalesce(public.nz(p->>'ca'), c.ca), public.dt(p, 'entrega'),
          coalesce(public.dt(p, 'validade_ca'), c.validade_ca), coalesce(nullif(public.num(p, 'vida_util_meses')::int, 0), c.vida_util_meses),
          coalesce(public.num(p, 'quantidade'), 1), public.nz(p->>'motivo'), public.nzt(p->>'obs'), c.id, coalesce(public.nz(p->>'fabricante'), c.fabricante), public.nz(p->>'tamanho'))
  on conflict (id) do update set epi = excluded.epi, ca = excluded.ca, entrega = excluded.entrega, validade_ca = excluded.validade_ca,
          vida_util_meses = excluded.vida_util_meses, quantidade = excluded.quantidade, motivo = excluded.motivo, obs = excluded.obs,
          catalogo_id = excluded.catalogo_id, fabricante = excluded.fabricante, tamanho = excluded.tamanho;
  return v_id;
end $$;

-- assinatura do termo de EPI: foto do rosto (facial), assinatura na tela ou no papel (impresso)
-- p: {ids: [entregas], modo, conteudo?: base64 da foto/assinatura, tipo?: image/jpeg|image/png}
create or replace function public.rh_assinar_epis(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_modo text := public.nz(p->>'modo'); v_id uuid; n int := 0; v_f uuid;
begin
  perform public.exigir('dono','escritorio','rh');
  if v_modo is null or v_modo not in ('facial','tela','papel') then raise exception 'Escolha como vai assinar'; end if;
  if jsonb_typeof(p->'ids') <> 'array' or jsonb_array_length(p->'ids') = 0 then raise exception 'Escolha os EPIs do termo'; end if;
  if v_modo <> 'papel' and public.nz(p->>'conteudo') is null then raise exception 'Falta a foto ou a assinatura'; end if;
  for v_id in select (x #>> '{}')::uuid from jsonb_array_elements(p->'ids') x loop
    select funcionario_id into v_f from public.rh_epis where id = v_id;
    if v_f is null then raise exception 'Entrega de EPI não encontrada'; end if;
    update public.rh_epis set assinatura = v_modo, assinado_em = now() where id = v_id;
    if v_modo <> 'papel' then
      perform public.rh_anexar(jsonb_build_object('tabela', 'rh_epis', 'registro_id', v_id, 'tipo', coalesce(public.nz(p->>'tipo'), 'image/jpeg'),
        'nome', case when v_modo = 'facial' then 'Assinatura facial ' else 'Assinatura na tela ' end || to_char(now() at time zone 'America/Sao_Paulo', 'DD-MM-YYYY HH24hMI')
                || case when coalesce(public.nz(p->>'tipo'), 'image/jpeg') = 'image/png' then '.png' else '.jpg' end,
        'conteudo', p->>'conteudo'));
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.rh_anexar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := gen_random_uuid(); v_c text := p->>'conteudo'; v_tam int;
begin
  perform public.exigir('dono','escritorio','rh');
  if coalesce(p->>'tabela', '') not in ('funcionarios','rh_matriz_niveis','rh_asos','rh_epis','rh_ocorrencias','rh_ausencias','rh_processos','rh_epi_catalogo') then raise exception 'Anexo sem destino'; end if;
  if public.uid_de(p, 'registro_id') is null then raise exception 'Anexo sem destino'; end if;
  if coalesce(p->>'tipo', '') not in ('application/pdf','image/jpeg','image/png') then raise exception 'Só PDF, JPG ou PNG'; end if;
  if v_c is null or length(v_c) < 10 then raise exception 'Arquivo vazio'; end if;
  v_tam := (length(v_c) * 3) / 4;
  if v_tam > 4 * 1024 * 1024 then raise exception 'Arquivo grande demais (máximo 4 MB)'; end if;
  insert into public.rh_anexos (id, tabela, registro_id, nome, tipo, tamanho)
  values (v_id, p->>'tabela', public.uid_de(p, 'registro_id'), coalesce(public.nz(p->>'nome'), 'arquivo'), p->>'tipo', v_tam);
  insert into public.rh_anexos_conteudo (anexo_id, conteudo) values (v_id, v_c);
  return v_id;
end $$;

-- p: {ano, meses: [{mes 1..12, receita, beneficios, encargos, outros}]} — campo vazio apaga o valor
create or replace function public.rh_salvar_indicadores(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_ano int := (p->>'ano')::int; m jsonb; v_comp date; n int := 0;
begin
  perform public.exigir('dono','escritorio','rh');
  if v_ano is null or v_ano < 2000 or v_ano > 2100 then raise exception 'Ano inválido'; end if;
  if jsonb_typeof(p->'meses') <> 'array' then raise exception 'Nada para gravar'; end if;
  for m in select * from jsonb_array_elements(p->'meses') loop
    if (m->>'mes')::int not between 1 and 12 then raise exception 'Mês inválido'; end if;
    v_comp := make_date(v_ano, (m->>'mes')::int, 1);
    if public.num(m, 'receita') < 0 or public.num(m, 'beneficios') < 0 or public.num(m, 'encargos') < 0 or public.num(m, 'outros') < 0 then raise exception 'Valor negativo não vale'; end if;
    if public.num(m, 'receita') is null and public.num(m, 'beneficios') is null and public.num(m, 'encargos') is null and public.num(m, 'outros') is null then
      delete from public.rh_indicadores where competencia = v_comp;
    else
      insert into public.rh_indicadores (competencia, receita, beneficios, encargos, outros)
      values (v_comp, public.num(m, 'receita'), public.num(m, 'beneficios'), public.num(m, 'encargos'), public.num(m, 'outros'))
      on conflict (competencia) do update set receita = excluded.receita, beneficios = excluded.beneficios, encargos = excluded.encargos, outros = excluded.outros;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Quem pode chamar cada função (o Supabase libera para todos por padrão)
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- usadas pelas regras de leitura e pelo site
grant execute on function public.meu_perfil(), public.eh(text[]), public.hoje(), public.nomes_usuarios(), public.lotes(uuid)
  to authenticated;
grant execute on function public.ha_dono(), public.primeiro_dono(text, text, text) to anon, authenticated;
grant execute on function
  public.salvar_config(text, jsonb), public.salvar_fornecedor(jsonb), public.salvar_peca(jsonb), public.salvar_maquina(jsonb),
  public.salvar_cliente(jsonb), public.salvar_funcionario(jsonb), public.movimentar(jsonb), public.estornar(uuid, text),
  public.contar_estoque(uuid, numeric, text), public.salvar_pedido(jsonb), public.receber_pedido(jsonb),
  public.cancelar_pedido(uuid, text), public.reabrir_pedido(uuid), public.salvar_manutencao(jsonb), public.salvar_ordem(jsonb),
  public.ordem_status(jsonb), public.salvar_lancamento(jsonb), public.baixar_lancamento(uuid, date, numeric, text),
  public.excluir_lancamento(uuid, boolean), public.criar_acesso(text, text, text, text, uuid),
  public.editar_acesso(uuid, text, text, boolean, uuid), public.trocar_senha(uuid, text), public.importar_planilha(jsonb, boolean),
  public.salvar_preferencias(jsonb), public.pode_rh(), public.ve_rh(), public.rh_ausencias_resumo(), public.rh_alterar_cargo_salario(jsonb),
  public.rh_excluir_historico(uuid), public.rh_salvar_setor(jsonb), public.rh_salvar_cargo(jsonb), public.rh_salvar_ausencia(jsonb),
  public.rh_excluir_ausencia(uuid), public.rh_salvar_ponto(jsonb), public.rh_fechar_mes(uuid, date, boolean),
  public.rh_salvar_feriado(date, text, boolean), public.rh_salvar_matriz(jsonb), public.rh_definir_nivel(jsonb), public.rh_salvar_plano(jsonb),
  public.rh_salvar_meta(jsonb), public.rh_salvar_epi(jsonb), public.rh_salvar_aso(jsonb), public.rh_salvar_ocorrencia(jsonb),
  public.rh_anexar(jsonb), public.rh_baixar_anexo(uuid), public.rh_excluir_anexo(uuid), public.cpf_valido(text),
  public.rh_salvar_processo(jsonb), public.importar_rh(jsonb, boolean), public.rh_salario_cargo(jsonb), public.rh_salvar_epi_catalogo(jsonb),
  public.rh_assinar_epis(jsonb), public.rh_salvar_indicadores(jsonb)
  to authenticated;

-- depois que existe um Dono, o "primeiro acesso" deixa de existir para quem não entrou
do $$ begin
  if public.ha_dono() then
    revoke execute on function public.primeiro_dono(text, text, text) from anon, authenticated;
    revoke execute on function public.ha_dono() from anon;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- v2.4 — segurança: motivo de demissão só para quem vê dados sensíveis; senhas fáceis recusadas
-- ---------------------------------------------------------------------
alter table public.funcionarios_privado add column if not exists motivo_demissao text;
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'funcionarios' and column_name = 'motivo_demissao') then
    insert into public.funcionarios_privado (funcionario_id, motivo_demissao)
    select id, motivo_demissao from public.funcionarios where motivo_demissao is not null
    on conflict (funcionario_id) do update set motivo_demissao = excluded.motivo_demissao;
    alter table public.funcionarios drop column motivo_demissao;
  end if;
end $$;

create or replace function public.conferir_senha(p_login text, p_senha text) returns void
language plpgsql immutable set search_path = public as $$
declare v text := lower(coalesce(p_senha, ''));
begin
  if length(v) < 8 then raise exception 'A senha precisa ter 8 caracteres ou mais'; end if;
  if v = lower(coalesce(p_login, '')) or v ~ '^(.)\1+$'
     or v in ('12345678','123456789','1234567890','87654321','abc12345','abcd1234','qwerty123','password','password1',
              'senha123','senha1234','mudar123','jafmetal','jafmetal1','jafmetal123','jaf12345') then
    raise exception 'Essa senha é fácil de adivinhar. Escolha outra.';
  end if;
end $$;
revoke execute on function public.conferir_senha(text, text) from public, anon, authenticated;

-- =====================================================================
-- v2.5 — a fábrica inteira: PCP (ordens de fabricação, matéria-prima por R.I., necessidade),
--        Comercial (pedidos de clientes), Departamento Técnico (produtos, estrutura, desenvolvimento,
--        alterações, desenhos…) e Manutenção (ordens de serviço, check-lists de preventiva, gastos).
--        Substitui as planilhas PCP 2026, Controle de Pedidos, Departamento Técnico,
--        Módulo Manutenção e Preventiva Máquinas.
-- =====================================================================

-- dois perfis novos: técnico (Depto. Técnico / Qualidade) e manutenção
alter table public.perfis drop constraint if exists perfis_perfil_check;
alter table public.perfis add constraint perfis_perfil_check
  check (perfil in ('dono','escritorio','almoxarife','pcp','producao','rh','gerente','tecnico','manutencao','comercial'));

-- a Manutenção faz no almoxarifado o mesmo que a Produção (retirar peça, ver estoque, abrir chamado)
create or replace function public.eh(variadic p text[]) returns boolean
language sql stable set search_path = public as
$$ select coalesce(public.meu_perfil() = any(p) or (public.meu_perfil() = 'manutencao' and 'producao' = any(p)), false) $$;

create or replace function public.perfil_valido(p text) returns boolean
language sql immutable set search_path = public as $$ select coalesce(p in ('dono','escritorio','almoxarife','pcp','producao','rh','gerente','tecnico','manutencao'), false) $$;

create or replace function public.novo_usuario(p_login text, p_senha text, p_nome text, p_perfil text, p_func uuid, p_trocar boolean default false) returns uuid
language plpgsql security definer set search_path = public, extensions, auth as $$
declare uid uuid := gen_random_uuid(); v_login text := public.login_limpo(p_login); v_email text;
begin
  perform set_config('jaf.criando_usuario', '1', true);   -- libera o gatilho que bloqueia cadastro por fora
  if v_login !~ '^[a-z0-9._-]{3,30}$' then raise exception 'O usuário deve ter de 3 a 30 letras ou números, sem espaço nem acento'; end if;
  perform public.conferir_senha(v_login, p_senha);
  if public.nz(p_nome) is null or length(public.nz(p_nome)) < 2 then raise exception 'Informe o nome'; end if;
  if not public.perfil_valido(p_perfil) then raise exception 'Perfil inválido'; end if;
  v_email := v_login || '@jafmetal.local';
  if exists (select 1 from public.perfis where login = v_login) then raise exception 'Esse usuário já existe. Escolha outro.'; end if;
  delete from auth.users u where lower(u.email) = v_email and not exists (select 1 from public.perfis p where p.user_id = u.id);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', v_email,
          extensions.crypt(p_senha, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('nome', public.nz(p_nome)), now(), now(),
          '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
  insert into public.perfis (user_id, nome, login, perfil, funcionario_id, trocar_senha)
  values (uid, public.nz(p_nome), v_login, p_perfil, p_func, coalesce(p_trocar, false));
  perform set_config('jaf.criando_usuario', '0', true);
  return uid;
end $$;

create or replace function public.editar_acesso(p_user uuid, p_nome text, p_perfil text, p_ativo boolean, p_func uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v public.perfis;
begin
  perform public.exigir('dono');
  select * into v from public.perfis where user_id = p_user;
  if v.user_id is null then raise exception 'Acesso não encontrado'; end if;
  if not public.perfil_valido(p_perfil) then raise exception 'Perfil inválido'; end if;
  if v.perfil = 'dono' and v.ativo and (p_perfil <> 'dono' or not p_ativo)
     and (select count(*) from public.perfis where perfil = 'dono' and ativo) < 2 then
    raise exception 'Precisa existir pelo menos um Dono ativo';
  end if;
  update public.perfis set nome = coalesce(public.nz(p_nome), nome), perfil = p_perfil, ativo = coalesce(p_ativo, ativo),
         funcionario_id = p_func where user_id = p_user;
end $$;

-- ---------------------------------------------------------------------
-- Cadastros que ganham campos (como nas planilhas)
-- ---------------------------------------------------------------------
-- clientes: sigla do código inteligente (as letras do cliente no código: XX 01.0001) e endereço completo (Cad. Clientes)
alter table public.clientes add column if not exists sigla text;
alter table public.clientes add column if not exists contato2 text;
alter table public.clientes add column if not exists telefone2 text;
alter table public.clientes add column if not exists endereco text;
alter table public.clientes add column if not exists bairro text;
alter table public.clientes add column if not exists cep text;
alter table public.clientes add column if not exists ie text;
alter table public.clientes add column if not exists site text;

-- máquinas: código da fábrica (TA 01, FD 03…), grupo (máquina, dispositivo, ferramenta, predial),
-- onde fica, os itens do check-list da preventiva e, para dispositivos, onde são usados
alter table public.maquinas add column if not exists codigo text;
alter table public.maquinas add column if not exists grupo text not null default 'Máquina';
alter table public.maquinas add column if not exists local text;
alter table public.maquinas add column if not exists checklist jsonb not null default '[]';
alter table public.maquinas add column if not exists aplicacao text;
do $$ begin
  alter table public.maquinas drop constraint if exists maquinas_grupo_check;
  alter table public.maquinas add constraint maquinas_grupo_check check (grupo in ('Máquina','Dispositivo','Ferramenta','Predial','Outro'));
end $$;
-- várias máquinas com o mesmo nome (Furadeira de bancada FD 01…FD 08): o que não pode repetir é o código
drop index if exists public.maquinas_nome_un;
create unique index if not exists maquinas_codigo_un on public.maquinas (lower(codigo)) where codigo is not null;
create unique index if not exists maquinas_nome_sem_codigo_un on public.maquinas (lower(nome)) where codigo is null;

-- manutenção = Ordem de Serviço (OS) da planilha: número, quem pediu, responsável, prazo, peças, aprovação
alter table public.manutencoes add column if not exists numero int;
alter table public.manutencoes add column if not exists solicitante text;
alter table public.manutencoes add column if not exists responsavel text;
alter table public.manutencoes add column if not exists prazo date;
alter table public.manutencoes add column if not exists pecas text;
alter table public.manutencoes add column if not exists aprovacao text;
alter table public.manutencoes add column if not exists equipamento text;   -- como estava escrito na planilha (ex.: "CR 01 e 02")
create unique index if not exists manutencoes_numero_un on public.manutencoes (numero) where numero is not null;
do $$ begin
  alter table public.manutencoes drop constraint if exists manutencoes_tipo_check;
  alter table public.manutencoes add constraint manutencoes_tipo_check check (tipo in ('preventiva','corretiva','preditiva','melhoria'));
end $$;

-- ---------------------------------------------------------------------
-- Produtos (Cadastro de Material Produtivo + Componentes + Conjuntos + Cadastro Técnico)
--   classe 'mp'   = matéria-prima (barra, chapa, tubo… pelo código inteligente)
--   classe 'peca' = componente, sub-conjunto ou conjunto: fabricado, comprado ou fornecido pelo cliente
-- ---------------------------------------------------------------------
create table if not exists public.produtos (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null,
  descricao       text not null,
  classe          text not null default 'peca' check (classe in ('mp','peca')),
  mp_codigo       text,                       -- matéria-prima de que é feito
  mp_qtd          numeric(16,6),              -- quanto de matéria-prima por peça
  mp_unidade      text,                       -- Kg, Pç, Mts…
  operacao        text,
  cliente_id      uuid references public.clientes(id) on delete set null,
  codigo_cliente  text,
  desenho_cliente text,
  revisao         text,
  data_revisao    date,
  data_entrada    date,
  pecas_mes       numeric(14,2),
  situacao        text not null default 'ativo' check (situacao in ('ativo','inativo','bloqueado')),
  checks          jsonb not null default '{}',  -- solic_desenv, rf_pc, desenhos, planos_montagem
  obs             text,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create unique index if not exists produtos_codigo_un on public.produtos (lower(codigo));
create index if not exists produtos_cliente on public.produtos (cliente_id);

-- estrutura (árvore do produto): o conjunto (pai) leva N de cada componente (filho)
create table if not exists public.produto_estrutura (
  id        uuid primary key default gen_random_uuid(),
  pai_id    uuid not null references public.produtos(id) on delete cascade,
  filho_id  uuid not null references public.produtos(id) on delete cascade,
  qtd       numeric(16,6) not null check (qtd > 0),
  unidade   text not null default 'Pç',
  ordem     int not null default 0,
  atualizado_em timestamptz not null default now(),
  check (pai_id <> filho_id)
);
create index if not exists produto_estrutura_pai on public.produto_estrutura (pai_id);
create index if not exists produto_estrutura_filho on public.produto_estrutura (filho_id);

-- Entrada de matéria-prima (E.S.M.): cada recebimento é um lote com número de R.I.
create table if not exists public.mp_lotes (
  id              uuid primary key default gen_random_uuid(),
  ri              int not null unique,
  produto_id      uuid not null references public.produtos(id),
  qtd             numeric(14,3) not null check (qtd > 0),
  data            date not null default public.hoje(),
  nota            text,
  fornecedor_id   uuid references public.fornecedores(id) on delete set null,
  fornecedor_nome text,
  pedido          text,
  status          text not null default 'Aprovado' check (status in ('Aprovado','Reprovado','Aguardando')),
  baixa           numeric(14,3) not null default 0,   -- acerto de inventário (o que foi contado ficou diferente)
  obs             text,
  criado_por      uuid default auth.uid(),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create index if not exists mp_lotes_produto on public.mp_lotes (produto_id);

-- Pedidos de clientes (Controle de Pedidos): uma linha por item do pedido
create table if not exists public.vendas (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid references public.clientes(id) on delete set null,
  cliente_nome    text,
  produto_id      uuid references public.produtos(id) on delete set null,
  codigo          text,               -- código JAF
  codigo_cliente  text,
  descricao       text,
  pedido          text,               -- número do pedido do cliente
  prazo           date,
  qtd             numeric(14,3) not null,
  valor           numeric(14,4) not null default 0 check (valor >= 0),   -- preço unitário
  entregue        numeric(14,3) not null default 0 check (entregue >= 0),
  entregue_em     date,
  cancelado       boolean not null default false,
  obs             text,
  criado_por      uuid default auth.uid(),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create index if not exists vendas_prazo on public.vendas (prazo);
create index if not exists vendas_produto on public.vendas (produto_id);
-- quantidade zero só em item cancelado (a planilha tem itens zerados pelo cliente)
alter table public.vendas drop constraint if exists vendas_qtd_check;
alter table public.vendas add constraint vendas_qtd_check check (qtd > 0 or (qtd = 0 and cancelado));

create table if not exists public.vendas_entregas (
  id         uuid primary key default gen_random_uuid(),
  venda_id   uuid not null references public.vendas(id) on delete cascade,
  data       date not null default public.hoje(),
  qtd        numeric(14,3) not null check (qtd > 0),
  nf         text,
  obs        text,
  criado_por uuid default auth.uid(),
  criado_em  timestamptz not null default now()
);
create index if not exists vendas_entregas_venda on public.vendas_entregas (venda_id);

-- Ordens de fabricação (OF) — componente (nº AA0001) e conjunto (nº AA00001), como no PCP
create table if not exists public.ofs (
  id            uuid primary key default gen_random_uuid(),
  numero        int not null unique,
  tipo          text not null check (tipo in ('componente','conjunto')),
  produto_id    uuid not null references public.produtos(id),
  qtd           numeric(14,3) not null check (qtd > 0),
  produzido     numeric(14,3) check (produzido is null or produzido >= 0),
  ri            int,                 -- lote de matéria-prima usado (R.I.)
  kg            numeric(14,3),       -- matéria-prima consumida (sai do saldo do lote)
  emitido_por   text,
  emitida_em    date not null default public.hoje(),
  realizado_por text,
  realizada_em  date,
  status        text not null default 'aberta' check (status in ('aberta','encerrada','cancelada')),
  pai_id        uuid references public.ofs(id) on delete set null,     -- OF do conjunto que pediu este componente
  venda_id      uuid references public.vendas(id) on delete set null,
  prazo         date,
  maquina_id    uuid references public.maquinas(id) on delete set null,
  componentes   jsonb not null default '[]',   -- conjunto: [{codigo, qtd, ref}] (ref = OF ou R.I. de cada componente)
  obs           text,
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists ofs_produto on public.ofs (produto_id);
create index if not exists ofs_ri on public.ofs (ri) where ri is not null;
create index if not exists ofs_status on public.ofs (status);

-- Check-lists de preventiva feitos (Preventiva Máquinas e Manutenção Predial)
create table if not exists public.preventivas (
  id           uuid primary key default gen_random_uuid(),
  maquina_id   uuid not null references public.maquinas(id) on delete cascade,
  data         date not null default public.hoje(),
  responsavel  text,
  resultados   jsonb not null default '[]',   -- [{item, situacao}] situacao: OK, NOK, NA ou texto
  obs          text,
  os           text,
  criado_por   uuid default auth.uid(),
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists preventivas_maquina on public.preventivas (maquina_id, data);

-- Registros das outras abas (um formato só; o que muda de uma aba para outra fica em "dados")
create table if not exists public.registros (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null check (tipo in (
                  'desenvolvimento','projeto','melhoria','alteracao','desvio','desenho','copia','imds','ata','setup',   -- Depto. Técnico
                  'servico_externo','requisicao',                                                                       -- PCP
                  'servico_manut','gasto_manut','peca_critica','pendencia','ferramentaria')),                           -- Manutenção
  numero        int,
  data          date,
  codigo        text,
  titulo        text,
  status        text,
  prazo         date,
  concluido_em  date,
  responsavel   text,
  valor         numeric(14,2),
  maquina_id    uuid references public.maquinas(id) on delete set null,
  cliente_id    uuid references public.clientes(id) on delete set null,
  fornecedor_id uuid references public.fornecedores(id) on delete set null,
  dados         jsonb not null default '{}',
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists registros_numero_un on public.registros (tipo, numero) where numero is not null;
create index if not exists registros_tipo on public.registros (tipo, data);

-- de que área é cada tipo de registro (quem vê e quem mexe)
create or replace function public.reg_area(p_tipo text) returns text
language sql immutable set search_path = public as $$
  select case when p_tipo in ('desenvolvimento','projeto','melhoria','alteracao','desvio','desenho','copia','imds','ata','setup') then 'tecnico'
              when p_tipo in ('servico_externo','requisicao') then 'pcp'
              when p_tipo in ('servico_manut','gasto_manut','peca_critica','pendencia','ferramentaria') then 'manut' end $$;
create or replace function public.reg_ver(p_tipo text) returns boolean
language sql stable set search_path = public as $$
  select coalesce(case public.reg_area(p_tipo)
    when 'tecnico' then public.meu_perfil() is not null and not public.eh('rh')
    when 'pcp' then public.eh('dono','escritorio','pcp','gerente','tecnico','producao')
    when 'manut' then public.eh('dono','escritorio','almoxarife','manutencao','gerente') end, false) $$;
create or replace function public.reg_editar(p_tipo text) returns boolean
language sql stable set search_path = public as $$
  select coalesce(case public.reg_area(p_tipo)
    when 'tecnico' then public.eh('dono','escritorio','tecnico')
    when 'pcp' then public.eh('dono','escritorio','pcp')
    when 'manut' then public.eh('dono','escritorio','almoxarife','manutencao') end, false) $$;

-- ---------------------------------------------------------------------
-- gatilhos, histórico e leitura das tabelas novas
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['produtos','produto_estrutura','mp_lotes','vendas','ofs','preventivas','registros'] loop
    execute format('drop trigger if exists tg_atualizado on public.%I', t);
    execute format('create trigger tg_atualizado before update on public.%I for each row execute function public.tg_atualizado()', t);
  end loop;
  foreach t in array array['produtos','produto_estrutura','mp_lotes','vendas','vendas_entregas','ofs','preventivas','registros'] loop
    execute format('drop trigger if exists tg_historico on public.%I', t);
    execute format('create trigger tg_historico after insert or update or delete on public.%I for each row execute function public.tg_historico()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

drop policy if exists ler on public.produtos;
create policy ler on public.produtos for select to authenticated using (public.meu_perfil() is not null and not public.eh('rh'));
drop policy if exists ler on public.produto_estrutura;
create policy ler on public.produto_estrutura for select to authenticated using (public.meu_perfil() is not null and not public.eh('rh'));
drop policy if exists ler on public.mp_lotes;
create policy ler on public.mp_lotes for select to authenticated using (public.eh('dono','escritorio','pcp','almoxarife','gerente','producao','tecnico'));
drop policy if exists ler on public.ofs;
create policy ler on public.ofs for select to authenticated using (public.eh('dono','escritorio','pcp','almoxarife','gerente','producao','tecnico'));
drop policy if exists ler on public.vendas;
create policy ler on public.vendas for select to authenticated using (public.eh('dono','escritorio','pcp','gerente'));
drop policy if exists ler on public.vendas_entregas;
create policy ler on public.vendas_entregas for select to authenticated using (public.eh('dono','escritorio','pcp','gerente'));
drop policy if exists ler on public.preventivas;
create policy ler on public.preventivas for select to authenticated using (public.eh('dono','escritorio','almoxarife','producao','gerente'));
drop policy if exists ler on public.registros;
create policy ler on public.registros for select to authenticated using (public.reg_ver(tipo));

-- o Técnico consulta máquinas, clientes e fornecedores; PCP e Manutenção veem fornecedores
drop policy if exists ler on public.maquinas;
create policy ler on public.maquinas for select to authenticated using (public.eh('dono','escritorio','almoxarife','pcp','producao','gerente','tecnico'));
drop policy if exists ler on public.clientes;
create policy ler on public.clientes for select to authenticated using (public.eh('dono','escritorio','pcp','tecnico','gerente'));
drop policy if exists ler on public.fornecedores;
create policy ler on public.fornecedores for select to authenticated using (public.eh('dono','escritorio','almoxarife','pcp','tecnico','manutencao'));

-- ---------------------------------------------------------------------
-- Cadastros: cliente, máquina, configuração
-- ---------------------------------------------------------------------
create or replace function public.salvar_cliente(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_nome text := public.nz(p ->> 'nome');
begin
  perform public.exigir('dono','escritorio','pcp');
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

create or replace function public.salvar_maquina(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_nome text := public.nz(p ->> 'nome');
        v_cod text := upper(public.nz(p->>'codigo')); v_lista jsonb := coalesce(p->'checklist', '[]');
begin
  perform public.exigir('dono','escritorio','almoxarife','manutencao');
  if v_nome is null then raise exception 'Informe o nome da máquina'; end if;
  if v_cod is not null and exists (select 1 from public.maquinas where lower(codigo) = lower(v_cod) and id <> v_id) then
    raise exception 'Já existe uma máquina com o código "%"', v_cod;
  end if;
  if v_cod is null and exists (select 1 from public.maquinas where lower(nome) = lower(v_nome) and codigo is null and id <> v_id) then
    raise exception 'Já existe uma máquina chamada "%". Dê um código para diferenciar (ex.: FD 02).', v_nome;
  end if;
  if jsonb_typeof(v_lista) <> 'array' or jsonb_array_length(v_lista) > 60 then raise exception 'Check-list inválido'; end if;
  insert into public.maquinas (id, nome, tipo, fabricante, modelo, numero_serie, setor, ano, preventiva_dias, obs, ativo, codigo, grupo, local, checklist, aplicacao)
  values (v_id, v_nome, public.nz(p->>'tipo'), public.nz(p->>'fabricante'), public.nz(p->>'modelo'), public.nz(p->>'numero_serie'),
          public.nz(p->>'setor'), public.num(p, 'ano')::int, nullif(public.num(p, 'preventiva_dias')::int, 0), public.nzt(p->>'obs'),
          coalesce((p->>'ativo')::boolean, true), v_cod, coalesce(public.nz(p->>'grupo'), 'Máquina'), public.nz(p->>'local'),
          (select coalesce(jsonb_agg(to_jsonb(btrim(x))), '[]') from jsonb_array_elements_text(v_lista) x where btrim(x) <> ''), public.nz(p->>'aplicacao'))
  on conflict (id) do update set nome = excluded.nome, tipo = excluded.tipo, fabricante = excluded.fabricante, modelo = excluded.modelo,
          numero_serie = excluded.numero_serie, setor = excluded.setor, ano = excluded.ano, preventiva_dias = excluded.preventiva_dias,
          obs = excluded.obs, ativo = excluded.ativo, codigo = excluded.codigo, grupo = excluded.grupo, local = excluded.local,
          checklist = excluded.checklist, aplicacao = excluded.aplicacao;
  return v_id;
end $$;

create or replace function public.salvar_config(p_chave text, p_valor jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_chave not in ('empresa','categorias','saldo_inicial','preferencias','rh','fabrica') then raise exception 'Configuração desconhecida'; end if;
  if p_chave = 'rh' then perform public.exigir('dono','escritorio','rh');
  elsif p_chave = 'fabrica' then perform public.exigir('dono','escritorio','tecnico','pcp');
  else perform public.exigir('dono','escritorio'); end if;
  insert into public.config (chave, valor) values (p_chave, coalesce(p_valor, '{}'::jsonb))
  on conflict (chave) do update set valor = excluded.valor;
end $$;

-- ---------------------------------------------------------------------
-- Manutenção: ordem de serviço (OS) e check-list de preventiva
-- ---------------------------------------------------------------------
create or replace function public.salvar_manutencao(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_st text := coalesce(public.nz(p->>'status'), 'aberta');
        v_old public.manutencoes; v_tipo text := coalesce(public.nz(p->>'tipo'), 'corretiva');
begin
  perform public.exigir('dono','escritorio','almoxarife','producao','gerente');   -- produção e manutenção
  if public.uid_de(p, 'maquina_id') is null then raise exception 'Escolha a máquina'; end if;
  if public.nzt(p->>'problema') is null then raise exception 'Descreva o problema ou o serviço'; end if;
  if v_st not in ('aberta','andamento','concluida') then raise exception 'Situação inválida'; end if;
  if v_tipo not in ('preventiva','corretiva','preditiva','melhoria') then raise exception 'Tipo inválido'; end if;
  select * into v_old from public.manutencoes where id = v_id;
  if public.meu_perfil() in ('producao','gerente') and v_old.id is not null and v_old.criado_por is distinct from auth.uid() and v_old.status = 'concluida' then
    raise exception 'Manutenção concluída só pode ser alterada pela manutenção, almoxarifado ou escritório';
  end if;
  perform pg_advisory_xact_lock(4243);
  insert into public.manutencoes (id, numero, maquina_id, data, tipo, status, problema, solucao, fornecedor_id, funcionario_id,
                                  custo_servico, horas_parada, concluida_em, solicitante, responsavel, prazo, pecas, aprovacao)
  values (v_id, coalesce((select max(numero) from public.manutencoes), 0) + 1, public.uid_de(p, 'maquina_id'), public.dt(p, 'data', public.hoje()),
          v_tipo, v_st, public.nzt(p->>'problema'), public.nzt(p->>'solucao'), public.uid_de(p, 'fornecedor_id'), public.uid_de(p, 'funcionario_id'),
          coalesce(public.num(p, 'custo_servico'), 0), public.num(p, 'horas_parada'),
          case when v_st = 'concluida' then public.dt(p, 'concluida_em', public.hoje()) end,
          coalesce(public.nz(p->>'solicitante'), case when v_old.id is null then public.meu_nome() end), public.nz(p->>'responsavel'),
          public.dt(p, 'prazo'), public.nzt(p->>'pecas'), public.nzt(p->>'aprovacao'))
  on conflict (id) do update set maquina_id = excluded.maquina_id, data = excluded.data, tipo = excluded.tipo, status = excluded.status,
          problema = excluded.problema, solucao = excluded.solucao, fornecedor_id = excluded.fornecedor_id,
          funcionario_id = excluded.funcionario_id, custo_servico = excluded.custo_servico, horas_parada = excluded.horas_parada,
          concluida_em = excluded.concluida_em, solicitante = excluded.solicitante, responsavel = excluded.responsavel,
          prazo = excluded.prazo, pecas = excluded.pecas, aprovacao = excluded.aprovacao;
  return v_id;
end $$;
-- as manutenções que já existiam ganham número de OS
update public.manutencoes m set numero = x.n
  from (select id, row_number() over (order by data, criado_em) + coalesce((select max(numero) from public.manutencoes), 0) as n
          from public.manutencoes where numero is null) x
 where m.id = x.id;

create or replace function public.salvar_preventiva(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_res jsonb := coalesce(p->'resultados', '[]');
begin
  perform public.exigir('dono','escritorio','almoxarife','manutencao');
  if public.uid_de(p, 'maquina_id') is null then raise exception 'Escolha a máquina'; end if;
  if jsonb_typeof(v_res) <> 'array' or jsonb_array_length(v_res) > 80 or length(v_res::text) > 20000 then raise exception 'Check-list inválido'; end if;
  insert into public.preventivas (id, maquina_id, data, responsavel, resultados, obs, os)
  values (v_id, public.uid_de(p, 'maquina_id'), public.dt(p, 'data', public.hoje()), coalesce(public.nz(p->>'responsavel'), public.meu_nome()), v_res,
          public.nzt(p->>'obs'), public.nz(p->>'os'))
  on conflict (id) do update set maquina_id = excluded.maquina_id, data = excluded.data, responsavel = excluded.responsavel,
          resultados = excluded.resultados, obs = excluded.obs, os = excluded.os;
  return v_id;
end $$;

create or replace function public.excluir_preventiva(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir('dono','escritorio','almoxarife','manutencao');
  delete from public.preventivas where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Produtos e estrutura
-- ---------------------------------------------------------------------
create or replace function public.salvar_produto(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_cod text := public.nz(p->>'codigo'); x jsonb; v_f uuid; k int := 0;
begin
  perform public.exigir('dono','escritorio','tecnico','pcp');
  if v_cod is null then raise exception 'Informe o código'; end if;
  if public.nz(p->>'descricao') is null then raise exception 'Informe a descrição'; end if;
  if exists (select 1 from public.produtos where lower(codigo) = lower(v_cod) and id <> v_id) then raise exception 'Já existe o código "%"', v_cod; end if;
  insert into public.produtos (id, codigo, descricao, classe, mp_codigo, mp_qtd, mp_unidade, operacao, cliente_id, codigo_cliente, desenho_cliente,
                               revisao, data_revisao, data_entrada, pecas_mes, situacao, checks, obs)
  values (v_id, v_cod, public.nz(p->>'descricao'), coalesce(public.nz(p->>'classe'), 'peca'), public.nz(p->>'mp_codigo'), public.num(p, 'mp_qtd'),
          public.nz(p->>'mp_unidade'), public.nz(p->>'operacao'), public.uid_de(p, 'cliente_id'), public.nz(p->>'codigo_cliente'),
          public.nz(p->>'desenho_cliente'), public.nz(p->>'revisao'), public.dt(p, 'data_revisao'), public.dt(p, 'data_entrada'),
          public.num(p, 'pecas_mes'), coalesce(public.nz(p->>'situacao'), 'ativo'),
          case when jsonb_typeof(p->'checks') = 'object' then p->'checks' else '{}' end, public.nzt(p->>'obs'))
  on conflict (id) do update set codigo = excluded.codigo, descricao = excluded.descricao, classe = excluded.classe, mp_codigo = excluded.mp_codigo,
          mp_qtd = excluded.mp_qtd, mp_unidade = excluded.mp_unidade, operacao = excluded.operacao, cliente_id = excluded.cliente_id,
          codigo_cliente = excluded.codigo_cliente, desenho_cliente = excluded.desenho_cliente, revisao = excluded.revisao,
          data_revisao = excluded.data_revisao, data_entrada = excluded.data_entrada, pecas_mes = excluded.pecas_mes,
          situacao = excluded.situacao, checks = excluded.checks, obs = excluded.obs;
  -- estrutura: só mexe se veio a lista (lista vazia = sem componentes)
  if jsonb_typeof(p->'estrutura') = 'array' then
    delete from public.produto_estrutura where pai_id = v_id;
    for x in select * from jsonb_array_elements(p->'estrutura') loop
      v_f := coalesce(public.uid_de(x, 'filho_id'), (select id from public.produtos where lower(codigo) = lower(x->>'codigo')));
      if v_f is null then raise exception 'Componente "%" não está cadastrado', x->>'codigo'; end if;
      if v_f = v_id then raise exception 'O produto não pode ser componente dele mesmo'; end if;
      -- não deixa fazer volta (A leva B que leva A)
      if exists (with recursive abaixo(id) as (select v_f union select e.filho_id from public.produto_estrutura e join abaixo a on e.pai_id = a.id)
                 select 1 from abaixo where id = v_id) then
        raise exception 'O componente "%" já leva este produto na estrutura dele', x->>'codigo';
      end if;
      if coalesce(public.num(x, 'qtd'), 0) <= 0 then raise exception 'Informe a quantidade de "%"', x->>'codigo'; end if;
      k := k + 1;
      insert into public.produto_estrutura (pai_id, filho_id, qtd, unidade, ordem) values (v_id, v_f, public.num(x, 'qtd'), coalesce(public.nz(x->>'unidade'), 'Pç'), k);
    end loop;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Matéria-prima: entrada (R.I.) e acerto de inventário
-- ---------------------------------------------------------------------
create or replace function public.salvar_lote(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_ri int := public.num(p, 'ri')::int; v_old public.mp_lotes;
        v_q numeric := public.num(p, 'qtd'); v_f uuid := public.uid_de(p, 'fornecedor_id');
begin
  perform public.exigir('dono','escritorio','pcp','almoxarife');
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

-- quanto do lote já foi para as OFs
create or replace function public.consumo_lote(p_ri int) returns numeric
language sql stable set search_path = public as
$$ select coalesce(sum(kg), 0) from public.ofs where ri = p_ri and status <> 'cancelada' $$;

-- inventário: diz quanto tem de verdade no lote; a diferença vira "acerto"
create or replace function public.ajustar_lote(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare l public.mp_lotes; v_cont numeric := public.num(p, 'contado');
begin
  perform public.exigir('dono','escritorio','pcp','almoxarife');
  select * into l from public.mp_lotes where id = public.uid_de(p, 'id') for update;
  if l.id is null then raise exception 'Lote não encontrado'; end if;
  if v_cont is null or v_cont < 0 then raise exception 'Informe quanto tem no lote (zero se acabou)'; end if;
  update public.mp_lotes set baixa = l.qtd - public.consumo_lote(l.ri) - v_cont,
         obs = concat_ws(E'\n', obs, format('Inventário %s: contado %s (%s)', to_char(public.hoje(), 'DD/MM/YYYY'), v_cont,
                                            coalesce(public.nzt(p->>'obs'), public.meu_nome())))
   where id = l.id;
end $$;

-- ---------------------------------------------------------------------
-- Ordens de fabricação
-- ---------------------------------------------------------------------
-- próximo número: componente AA0001 (ex.: 260001), conjunto AA00001 (ex.: 2600001)
create or replace function public.proximo_numero_of(p_tipo text, p_data date default null) returns int
language sql stable set search_path = public as $$
  with b as (select (extract(year from coalesce(p_data, public.hoje()))::int % 100) * m as base, m
               from (select case when p_tipo = 'conjunto' then 100000 else 10000 end as m) z)
  select (coalesce((select max(o.numero) from public.ofs o where o.tipo = p_tipo and o.numero > b.base and o.numero < b.base + b.m), b.base) + 1)::int from b $$;

create or replace function public.emitir_of(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_old public.ofs; pr public.produtos; v_tipo text; v_qtd numeric := public.num(p, 'qtd');
        v_ri int := public.num(p, 'ri')::int; v_kg numeric := public.num(p, 'kg'); v_num int; v_comps jsonb := '[]'; e record; v_filho uuid; n_filhos int := 0;
        v_lote public.mp_lotes; v_data date := public.dt(p, 'emitida_em', public.hoje()); v_ft text;
begin
  perform public.exigir('dono','escritorio','pcp');
  select * into v_old from public.ofs where id = v_id;
  if v_old.id is not null and v_old.status <> 'aberta' then raise exception 'A OF % está %: reabra para alterar', v_old.numero, v_old.status; end if;
  select * into pr from public.produtos where id = public.uid_de(p, 'produto_id');
  if pr.id is null then raise exception 'Escolha o código do produto'; end if;
  if pr.situacao = 'bloqueado' then raise exception 'O código % está bloqueado para fabricação', pr.codigo; end if;
  if v_qtd is null or v_qtd <= 0 then raise exception 'Informe a quantidade'; end if;
  v_tipo := coalesce(v_old.tipo, public.nz(p->>'tipo'), case when exists (select 1 from public.produto_estrutura where pai_id = pr.id) then 'conjunto' else 'componente' end);
  if v_tipo not in ('componente','conjunto') then raise exception 'Tipo de OF inválido'; end if;
  if v_ri is not null then
    select * into v_lote from public.mp_lotes where ri = v_ri;
    if v_lote.id is null then raise exception 'O R.I. % não existe na entrada de matéria-prima', v_ri; end if;
    if v_lote.status = 'Reprovado' then raise exception 'O R.I. % foi reprovado: não pode ir para a produção', v_ri; end if;
  end if;
  -- matéria-prima prevista = quantidade × consumo por peça (como a coluna Kg da planilha)
  if v_tipo = 'componente' and v_kg is null and pr.mp_qtd is not null and lower(coalesce(pr.mp_unidade, 'kg')) like 'kg%' then v_kg := round(v_qtd * pr.mp_qtd, 3); end if;
  if v_tipo = 'conjunto' then
    if jsonb_typeof(p->'componentes') = 'array' then v_comps := p->'componentes';
    else
      select coalesce(jsonb_agg(jsonb_build_object('codigo', f.codigo, 'qtd', round(e2.qtd * v_qtd, 4), 'ref', null) order by e2.ordem), '[]') into v_comps
        from public.produto_estrutura e2 join public.produtos f on f.id = e2.filho_id where e2.pai_id = pr.id;
    end if;
  end if;
  perform pg_advisory_xact_lock(4245);
  v_num := coalesce(v_old.numero, public.num(p, 'numero')::int, public.proximo_numero_of(v_tipo, v_data));
  if exists (select 1 from public.ofs where numero = v_num and id <> v_id) then raise exception 'Já existe a OF %', v_num; end if;
  insert into public.ofs (id, numero, tipo, produto_id, qtd, ri, kg, emitido_por, emitida_em, prazo, maquina_id, venda_id, pai_id, componentes, obs)
  values (v_id, v_num, v_tipo, pr.id, v_qtd, v_ri, v_kg, coalesce(public.nz(p->>'emitido_por'), public.meu_nome()), v_data,
          public.dt(p, 'prazo'), public.uid_de(p, 'maquina_id'), public.uid_de(p, 'venda_id'), public.uid_de(p, 'pai_id'), v_comps, public.nzt(p->>'obs'))
  on conflict (id) do update set produto_id = excluded.produto_id, qtd = excluded.qtd, ri = excluded.ri, kg = excluded.kg, emitido_por = excluded.emitido_por,
          emitida_em = excluded.emitida_em, prazo = excluded.prazo, maquina_id = excluded.maquina_id, venda_id = excluded.venda_id,
          componentes = excluded.componentes, obs = excluded.obs;
  -- conjunto novo: já emite a OF de cada componente fabricado aqui (e anota o número na OF do conjunto)
  if v_tipo = 'conjunto' and v_old.id is null and coalesce((p->>'gerar_componentes')::boolean, false) then
    for e in select e2.qtd as q, e2.ordem, f.id, f.codigo, f.mp_qtd, f.mp_unidade from public.produto_estrutura e2 join public.produtos f on f.id = e2.filho_id
              where e2.pai_id = pr.id and f.classe = 'peca' and f.situacao <> 'bloqueado'
                and (f.mp_codigo is not null or exists (select 1 from public.produto_estrutura x where x.pai_id = f.id))
              order by e2.ordem loop
      v_filho := gen_random_uuid();
      v_ft := case when exists (select 1 from public.produto_estrutura x where x.pai_id = e.id) then 'conjunto' else 'componente' end;
      insert into public.ofs (id, numero, tipo, produto_id, qtd, kg, emitido_por, emitida_em, prazo, pai_id, venda_id, componentes)
      values (v_filho, public.proximo_numero_of(v_ft, v_data), v_ft, e.id, round(e.q * v_qtd, 3),
              case when v_ft = 'componente' and e.mp_qtd is not null and lower(coalesce(e.mp_unidade, 'kg')) like 'kg%' then round(e.q * v_qtd * e.mp_qtd, 3) end,
              coalesce(public.nz(p->>'emitido_por'), public.meu_nome()), v_data, public.dt(p, 'prazo'), v_id, public.uid_de(p, 'venda_id'),
              case when v_ft = 'conjunto' then (select coalesce(jsonb_agg(jsonb_build_object('codigo', f2.codigo, 'qtd', round(x2.qtd * e.q * v_qtd, 4), 'ref', null) order by x2.ordem), '[]')
                                                  from public.produto_estrutura x2 join public.produtos f2 on f2.id = x2.filho_id where x2.pai_id = e.id) else '[]' end);
      update public.ofs set componentes = (select jsonb_agg(case when c->>'codigo' = e.codigo and c->>'ref' is null
                                                                 then c || jsonb_build_object('ref', (select numero::text from public.ofs where id = v_filho)) else c end)
                                             from jsonb_array_elements(componentes) c)
       where id = v_id;
      n_filhos := n_filhos + 1;
    end loop;
  end if;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'componentes', n_filhos);
end $$;

-- apontar produção / encerrar / cancelar / reabrir
create or replace function public.apontar_of(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare o public.ofs; v_st text := public.nz(p->>'status'); v_ri int; v_lote public.mp_lotes;
begin
  perform public.exigir('dono','escritorio','pcp','producao','gerente');
  select * into o from public.ofs where id = public.uid_de(p, 'id') for update;
  if o.id is null then raise exception 'OF não encontrada'; end if;
  v_st := coalesce(v_st, o.status);
  if v_st not in ('aberta','encerrada','cancelada') then raise exception 'Situação inválida'; end if;
  if (v_st = 'cancelada' or (o.status <> 'aberta' and v_st = 'aberta')) and not public.eh('dono','escritorio','pcp') then
    raise exception 'Cancelar ou reabrir OF é com o PCP';
  end if;
  if o.status <> 'aberta' and v_st <> 'aberta' then raise exception 'A OF % já está %', o.numero, o.status; end if;
  v_ri := case when p ? 'ri' then public.num(p, 'ri')::int else o.ri end;
  if v_ri is not null and v_ri is distinct from o.ri then
    select * into v_lote from public.mp_lotes where ri = v_ri;
    if v_lote.id is null then raise exception 'O R.I. % não existe na entrada de matéria-prima', v_ri; end if;
    if v_lote.status = 'Reprovado' then raise exception 'O R.I. % foi reprovado', v_ri; end if;
  end if;
  if public.num(p, 'produzido') < 0 then raise exception 'Quantidade produzida não pode ser negativa'; end if;
  update public.ofs set status = v_st, ri = v_ri,
         produzido = coalesce(public.num(p, 'produzido'), produzido),
         kg = case when p ? 'kg' then public.num(p, 'kg') else kg end,
         realizado_por = coalesce(public.nz(p->>'realizado_por'), case when v_st = 'encerrada' then coalesce(realizado_por, public.meu_nome()) else realizado_por end),
         realizada_em = case when v_st = 'encerrada' then public.dt(p, 'realizada_em', coalesce(realizada_em, public.hoje())) when v_st = 'aberta' then null else realizada_em end,
         obs = case when public.nzt(p->>'obs') is not null then concat_ws(E'\n', obs, public.nzt(p->>'obs')) else obs end
   where id = o.id;
end $$;

-- ---------------------------------------------------------------------
-- Pedidos de clientes e entregas
-- ---------------------------------------------------------------------
create or replace function public.salvar_venda(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_cli uuid := public.uid_de(p, 'cliente_id'); v_prod uuid := public.uid_de(p, 'produto_id');
        v_q numeric := public.num(p, 'qtd'); pr public.produtos;
begin
  perform public.exigir('dono','escritorio','pcp');
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
  perform public.exigir('dono','escritorio','pcp');
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
  perform public.exigir('dono','escritorio','pcp');
  select * into e from public.vendas_entregas where id = p_id;
  if e.id is null then raise exception 'Entrega não encontrada'; end if;
  delete from public.vendas_entregas where id = p_id;
  update public.vendas set entregue = greatest(0, entregue - e.qtd),
         entregue_em = coalesce((select max(data) from public.vendas_entregas where venda_id = e.venda_id), case when entregue - e.qtd > 0 then entregue_em end)
   where id = e.venda_id;
end $$;

-- ---------------------------------------------------------------------
-- Registros (todas as outras abas)
-- ---------------------------------------------------------------------
create or replace function public.salvar_registro(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_old public.registros; v_tipo text; v_num int; v_dados jsonb := coalesce(p->'dados', '{}');
begin
  if public.meu_perfil() is null then raise exception 'Sua sessão não tem acesso. Entre de novo.'; end if;
  select * into v_old from public.registros where id = v_id;
  v_tipo := coalesce(v_old.tipo, public.nz(p->>'tipo'));
  if v_tipo is null or public.reg_area(v_tipo) is null then raise exception 'Tipo de registro inválido'; end if;
  -- pedido de alteração e sugestão de melhoria: qualquer setor abre; o Técnico analisa
  if not public.reg_editar(v_tipo) and not (v_old.id is null and v_tipo in ('alteracao','melhoria') and not public.eh('rh')) then
    raise exception 'Seu perfil não pode fazer isso.';
  end if;
  if jsonb_typeof(v_dados) <> 'object' or length(v_dados::text) > 40000 then raise exception 'Dados demais neste registro'; end if;
  if public.nz(p->>'titulo') is null and public.nz(p->>'codigo') is null then raise exception 'Preencha a descrição'; end if;
  perform pg_advisory_xact_lock(4246);
  v_num := coalesce(v_old.numero, public.num(p, 'numero')::int);
  if v_num is null and v_tipo in ('desenvolvimento','projeto','melhoria','alteracao','desvio','copia','ata','servico_externo') then
    v_num := coalesce((select max(numero) from public.registros where tipo = v_tipo), 0) + 1;
  end if;
  if v_num is not null and exists (select 1 from public.registros where tipo = v_tipo and numero = v_num and id <> v_id) then raise exception 'Já existe o número %', v_num; end if;
  insert into public.registros (id, tipo, numero, data, codigo, titulo, status, prazo, concluido_em, responsavel, valor, maquina_id, cliente_id, fornecedor_id, dados)
  values (v_id, v_tipo, v_num, public.dt(p, 'data', public.hoje()), public.nz(p->>'codigo'), public.nzt(p->>'titulo'), public.nz(p->>'status'), public.dt(p, 'prazo'),
          public.dt(p, 'concluido_em'), public.nz(p->>'responsavel'), public.num(p, 'valor'), public.uid_de(p, 'maquina_id'), public.uid_de(p, 'cliente_id'),
          public.uid_de(p, 'fornecedor_id'), v_dados)
  on conflict (id) do update set data = excluded.data, codigo = excluded.codigo, titulo = excluded.titulo, status = excluded.status, prazo = excluded.prazo,
          concluido_em = excluded.concluido_em, responsavel = excluded.responsavel, valor = excluded.valor, maquina_id = excluded.maquina_id,
          cliente_id = excluded.cliente_id, fornecedor_id = excluded.fornecedor_id, dados = excluded.dados;
  return jsonb_build_object('id', v_id, 'numero', v_num);
end $$;

create or replace function public.excluir_registro(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.registros;
begin
  select * into r from public.registros where id = p_id;
  if r.id is null then raise exception 'Registro não encontrado'; end if;
  if not public.reg_editar(r.tipo) then raise exception 'Seu perfil não pode fazer isso.'; end if;
  delete from public.registros where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Importação das planilhas da fábrica (feita uma vez, pelo Dono, em partes pequenas).
-- O arquivo é montado fora (testes/fabrica-ler-planilhas.py). Ordem: inicio, clientes, fornecedores,
-- config, produtos, estrutura, lotes, vendas, ofs, maquinas, preventivas, manutencoes, registros, pecas, fim.
-- ---------------------------------------------------------------------
-- cliente pelo nome curto da planilha ("Upgrade" acha "Upgrade Barras de Apoio")
create or replace function public._cliente_por_nome(p text) returns uuid
language sql stable set search_path = public as $$
  select c.id from public.clientes c
   where public.nz(p) is not null and (lower(c.nome) = lower(p) or lower(c.nome) like lower(p) || ' %')
   order by (lower(c.nome) = lower(p)) desc, c.criado_em limit 1 $$;

create or replace function public.importar_fabrica(p_parte text, p jsonb, p_substituir boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare x jsonb; v_id uuid; n int := 0;
begin
  perform public.exigir('dono');
  perform set_config('jaf.importando', '1', true);   -- sem uma linha de histórico para cada linha importada (fica um resumo no fim)
  if jsonb_typeof(p) = 'array' and jsonb_array_length(p) > 5000 then raise exception 'Parte grande demais'; end if;

  if p_parte = 'inicio' then
    if exists (select 1 from public.produtos) or exists (select 1 from public.ofs) or exists (select 1 from public.vendas) then
      if not coalesce(p_substituir, false) then raise exception 'As planilhas da fábrica já foram importadas. Para importar de novo, marque substituir.'; end if;
      delete from public.vendas_entregas; delete from public.ofs; delete from public.vendas; delete from public.mp_lotes;
      delete from public.produto_estrutura; delete from public.produtos;
      delete from public.registros where criado_por is null;
      delete from public.preventivas where criado_por is null;
      delete from public.manutencoes m where m.criado_por is null and m.equipamento is not null
         and not exists (select 1 from public.movimentos mv where mv.manutencao_id = m.id);
    end if;
    return '{}';
  end if;

  if p_parte = 'clientes' then
    for x in select * from jsonb_array_elements(p) loop
      v_id := public._cliente_por_nome(x->>'nome');
      if v_id is null then
        insert into public.clientes (nome, ativo) values (x->>'nome', true) returning id into v_id; n := n + 1;
      end if;
      update public.clientes c set sigla = coalesce(c.sigla, public.nz(x->>'sigla')), razao = coalesce(c.razao, public.nz(x->>'razao')),
             cnpj = coalesce(c.cnpj, public.nz(x->>'cnpj')), contato = coalesce(c.contato, public.nz(x->>'contato')), contato2 = coalesce(c.contato2, public.nz(x->>'contato2')),
             telefone = coalesce(c.telefone, public.nz(x->>'telefone')), telefone2 = coalesce(c.telefone2, public.nz(x->>'telefone2')),
             email = coalesce(c.email, lower(public.nz(x->>'email'))), endereco = coalesce(c.endereco, public.nz(x->>'endereco')),
             bairro = coalesce(c.bairro, public.nz(x->>'bairro')), cidade = coalesce(c.cidade, public.nz(x->>'cidade')), uf = coalesce(c.uf, upper(public.nz(x->>'uf'))),
             cep = coalesce(c.cep, public.nz(x->>'cep')), ie = coalesce(c.ie, public.nz(x->>'ie')), site = coalesce(c.site, public.nz(x->>'site'))
       where c.id = v_id;
    end loop;
    return jsonb_build_object('novos', n);
  end if;

  if p_parte = 'fornecedores' then
    for x in select * from jsonb_array_elements(p) loop
      select id into v_id from public.fornecedores f
       where lower(f.nome) = lower(x->>'nome')
          or (length(regexp_replace(coalesce(x->>'cnpj', ''), '\D', '', 'g')) >= 11
              and regexp_replace(coalesce(f.cnpj, ''), '\D', '', 'g') = regexp_replace(x->>'cnpj', '\D', '', 'g'))
       limit 1;
      if v_id is null then
        insert into public.fornecedores (nome, razao, tipo, contato, contato2, telefone, celular, email, site, endereco, bairro, cidade, uf, cep, cnpj, ie,
                                         qualificacao, qualif_metodo, qualif_validade, obs)
        values (x->>'nome', public.nz(x->>'razao'), 'Peças', public.nz(x->>'contato'), public.nz(x->>'contato2'), public.nz(x->>'telefone'), public.nz(x->>'celular'),
                lower(public.nz(x->>'email')), public.nz(x->>'site'), public.nz(x->>'endereco'), public.nz(x->>'bairro'), public.nz(x->>'cidade'), upper(public.nz(x->>'uf')),
                public.nz(x->>'cep'), public.nz(x->>'cnpj'), public.nz(x->>'ie'),
                case when x->>'qualificacao' in ('Aprovado','Em avaliação','Reprovado') then x->>'qualificacao' end, public.nz(x->>'qualif_metodo'),
                public.dt(x, 'qualif_validade'), public.nz(x->>'obs'));
        n := n + 1;
      else
        update public.fornecedores f set contato = coalesce(f.contato, public.nz(x->>'contato')), contato2 = coalesce(f.contato2, public.nz(x->>'contato2')),
               telefone = coalesce(f.telefone, public.nz(x->>'telefone')), celular = coalesce(f.celular, public.nz(x->>'celular')),
               email = coalesce(f.email, lower(public.nz(x->>'email'))), site = coalesce(f.site, public.nz(x->>'site')), endereco = coalesce(f.endereco, public.nz(x->>'endereco')),
               bairro = coalesce(f.bairro, public.nz(x->>'bairro')), cidade = coalesce(f.cidade, public.nz(x->>'cidade')), uf = coalesce(f.uf, upper(public.nz(x->>'uf'))),
               cep = coalesce(f.cep, public.nz(x->>'cep')), cnpj = coalesce(f.cnpj, public.nz(x->>'cnpj')), ie = coalesce(f.ie, public.nz(x->>'ie')),
               qualificacao = coalesce(f.qualificacao, case when x->>'qualificacao' in ('Aprovado','Em avaliação','Reprovado') then x->>'qualificacao' end),
               qualif_metodo = coalesce(f.qualif_metodo, public.nz(x->>'qualif_metodo')), qualif_validade = coalesce(f.qualif_validade, public.dt(x, 'qualif_validade'))
         where f.id = v_id;
      end if;
    end loop;
    return jsonb_build_object('novos', n);
  end if;

  if p_parte = 'config' then
    insert into public.config (chave, valor) values ('fabrica', p) on conflict (chave) do update set valor = public.config.valor || excluded.valor;
    return '{}';
  end if;

  if p_parte = 'produtos' then
    insert into public.produtos (codigo, descricao, classe, mp_codigo, mp_qtd, mp_unidade, operacao, cliente_id, codigo_cliente, desenho_cliente, revisao,
                                 data_revisao, data_entrada, pecas_mes, situacao, checks, obs)
    select x->>'codigo', coalesce(public.nz(x->>'descricao'), x->>'codigo'), case when x->>'classe' = 'mp' then 'mp' else 'peca' end, public.nz(x->>'mp_codigo'),
           public.num(x, 'mp_qtd'), public.nz(x->>'mp_unidade'), public.nz(x->>'operacao'), public._cliente_por_nome(x->>'cliente'), public.nz(x->>'codigo_cliente'),
           public.nz(x->>'desenho_cliente'), public.nz(x->>'revisao'), public.dt(x, 'data_revisao'), public.dt(x, 'data_entrada'), public.num(x, 'pecas_mes'),
           case when x->>'situacao' in ('inativo','bloqueado') then x->>'situacao' else 'ativo' end,
           case when jsonb_typeof(x->'checks') = 'object' then x->'checks' else '{}' end, public.nz(x->>'obs')
      from jsonb_array_elements(p) x
     where public.nz(x->>'codigo') is not null
    on conflict ((lower(codigo))) do nothing;
    get diagnostics n = row_count;
    return jsonb_build_object('n', n);
  end if;

  if p_parte = 'estrutura' then
    insert into public.produto_estrutura (pai_id, filho_id, qtd, unidade, ordem)
    select a.id, b.id, public.num(x, 'qtd'), coalesce(public.nz(x->>'unidade'), 'Pç'), coalesce((x->>'ordem')::int, 0)
      from jsonb_array_elements(p) x
      join public.produtos a on lower(a.codigo) = lower(x->>'pai')
      join public.produtos b on lower(b.codigo) = lower(x->>'filho')
     where a.id <> b.id and public.num(x, 'qtd') > 0;
    get diagnostics n = row_count;
    return jsonb_build_object('n', n);
  end if;

  if p_parte = 'lotes' then
    insert into public.mp_lotes (ri, produto_id, qtd, data, nota, fornecedor_id, fornecedor_nome, pedido, status, baixa, obs, criado_por)
    select (x->>'ri')::int, pr.id, public.num(x, 'qtd'), coalesce(public.dt(x, 'data'), '2000-01-01'), public.nz(x->>'nota'),
           (select id from public.fornecedores f where lower(f.nome) = lower(x->>'fornecedor') limit 1), public.nz(x->>'fornecedor'), public.nz(x->>'pedido'),
           case when x->>'status' in ('Aprovado','Reprovado','Aguardando') then x->>'status' else 'Aprovado' end, coalesce(public.num(x, 'baixa'), 0),
           concat_ws(E'\n', public.nz(x->>'obs'), case when public.dt(x, 'data') is null then 'Data em branco ou errada na planilha' end), null
      from jsonb_array_elements(p) x join public.produtos pr on lower(pr.codigo) = lower(x->>'codigo')
     where public.num(x, 'qtd') > 0
    on conflict (ri) do nothing;
    get diagnostics n = row_count;
    return jsonb_build_object('n', n);
  end if;

  if p_parte = 'vendas' then
    insert into public.vendas (cliente_id, cliente_nome, produto_id, codigo, codigo_cliente, descricao, pedido, prazo, qtd, valor, entregue, entregue_em, cancelado, obs, criado_por)
    select public._cliente_por_nome(x->>'cliente'), x->>'cliente', pr.id, public.nz(x->>'codigo'), public.nz(x->>'codigo_cliente'), public.nz(x->>'descricao'),
           public.nz(x->>'pedido'), public.dt(x, 'prazo'), greatest(coalesce(public.num(x, 'qtd'), 0), 0), greatest(coalesce(public.num(x, 'valor'), 0), 0),
           greatest(coalesce(public.num(x, 'entregue'), 0), 0), public.dt(x, 'entregue_em'), coalesce(public.num(x, 'qtd'), 0) <= 0,
           nullif(concat_ws('; ', public.nz(x->>'obs'), case when coalesce(public.num(x, 'qtd'), 0) <= 0 then 'Quantidade zerada na planilha' end), ''), null
      from jsonb_array_elements(p) x left join public.produtos pr on lower(pr.codigo) = lower(x->>'codigo');
    get diagnostics n = row_count;
    -- a planilha guarda o cliente com o nome curto: fica o nome do cadastro
    update public.vendas v set cliente_nome = c.nome from public.clientes c where c.id = v.cliente_id and v.cliente_nome is distinct from c.nome;
    return jsonb_build_object('n', n);
  end if;

  if p_parte = 'ofs' then
    insert into public.ofs (numero, tipo, produto_id, qtd, produzido, ri, kg, emitido_por, emitida_em, realizado_por, realizada_em, status, componentes, obs, criado_por)
    select (x->>'numero')::int, x->>'tipo', pr.id, case when public.num(x, 'qtd') > 0 then public.num(x, 'qtd') else 1 end,
           case when public.num(x, 'produzido') >= 0 then public.num(x, 'produzido') end, (x->>'ri')::int, public.num(x, 'kg'),
           public.nz(x->>'emitido_por'), coalesce(public.dt(x, 'emitida_em'), public.dt(x, 'realizada_em'), public.hoje()), public.nz(x->>'realizado_por'),
           public.dt(x, 'realizada_em'), case when x->>'status' = 'encerrada' then 'encerrada' else 'aberta' end, coalesce(x->'componentes', '[]'),
           nullif(concat_ws('; ', public.nz(x->>'obs'), case when coalesce(public.num(x, 'qtd'), 0) <= 0 then 'Quantidade em branco na planilha (ficou 1)' end), ''), null
      from jsonb_array_elements(p) x join public.produtos pr on lower(pr.codigo) = lower(x->>'codigo')
    on conflict (numero) do nothing;
    get diagnostics n = row_count;
    -- a OF de componente aponta para a do conjunto que a citou
    update public.ofs f set pai_id = c.id
      from public.ofs c, jsonb_array_elements(c.componentes) e
     where c.tipo = 'conjunto' and f.pai_id is null and f.numero::text = e->>'ref' and f.id <> c.id;
    return jsonb_build_object('n', n);
  end if;

  if p_parte = 'maquinas' then
    for x in select * from jsonb_array_elements(p) loop
      select id into v_id from public.maquinas m
       where lower(m.codigo) = lower(x->>'codigo')
          or upper(replace(m.nome, ' ', '')) = upper(replace(x->>'codigo', ' ', ''))
          or exists (select 1 from jsonb_array_elements_text(coalesce(x->'apelidos', '[]')) a where lower(a) = lower(m.nome))
       order by (lower(m.codigo) = lower(x->>'codigo')) desc nulls last limit 1;
      if v_id is null then
        insert into public.maquinas (nome, codigo, grupo, tipo, preventiva_dias, checklist, aplicacao, ativo, obs)
        values (coalesce(public.nz(x->>'nome'), x->>'codigo'), upper(x->>'codigo'),
                case when x->>'grupo' in ('Máquina','Dispositivo','Ferramenta','Predial','Outro') then x->>'grupo' else 'Máquina' end, public.nz(x->>'tipo'),
                nullif((x->>'preventiva_dias')::int, 0), coalesce(x->'checklist', '[]'), public.nz(x->>'aplicacao'), coalesce((x->>'ativo')::boolean, true),
                case when (x->>'oculta')::boolean then 'Aba escondida na planilha de preventiva' end);
        n := n + 1;
      else
        update public.maquinas m set codigo = coalesce(m.codigo, upper(x->>'codigo')),
               grupo = case when x->>'grupo' in ('Máquina','Dispositivo','Ferramenta','Predial','Outro') then x->>'grupo' else m.grupo end,
               nome = case when upper(replace(m.nome, ' ', '')) = upper(replace(x->>'codigo', ' ', '')) and public.nz(x->>'nome') is not null then x->>'nome' else m.nome end,
               tipo = coalesce(m.tipo, public.nz(x->>'tipo')), preventiva_dias = coalesce(m.preventiva_dias, nullif((x->>'preventiva_dias')::int, 0)),
               checklist = case when jsonb_array_length(m.checklist) = 0 then coalesce(x->'checklist', '[]') else m.checklist end,
               aplicacao = coalesce(m.aplicacao, public.nz(x->>'aplicacao'))
         where m.id = v_id;
      end if;
    end loop;
    return jsonb_build_object('novas', n);
  end if;

  if p_parte = 'preventivas' then
    insert into public.preventivas (maquina_id, data, responsavel, resultados, os, criado_por)
    select m.id, public.dt(x, 'data'), public.nz(x->>'responsavel'), coalesce(x->'resultados', '[]'), public.nz(x->>'os'), null
      from jsonb_array_elements(p) x join public.maquinas m on lower(m.codigo) = lower(x->>'maquina')
     where public.dt(x, 'data') is not null;
    get diagnostics n = row_count;
    return jsonb_build_object('n', n);
  end if;

  if p_parte = 'manutencoes' then
    -- chamados abertos no sistema antes da importação cedem o número para a OS da planilha (e ganham um número novo no fim)
    update public.manutencoes o set numero = null
     where o.criado_por is not null and o.numero in (select (x->>'numero')::int from jsonb_array_elements(p) x);
    insert into public.manutencoes (numero, maquina_id, data, tipo, status, problema, solucao, custo_servico, horas_parada, concluida_em, solicitante, responsavel,
                                    prazo, pecas, aprovacao, equipamento, criado_por)
    select (x->>'numero')::int, m.id, coalesce(public.dt(x, 'data'), public.dt(x, 'concluida_em'), public.dt(x, 'prazo'), '2006-01-01'),
           case when x->>'tipo' in ('preventiva','corretiva','preditiva','melhoria') then x->>'tipo' else 'corretiva' end,
           case when x->>'status' = 'concluida' then 'concluida' else 'aberta' end, x->>'problema', public.nz(x->>'solucao'),
           greatest(coalesce(public.num(x, 'custo'), 0), 0), case when public.num(x, 'horas_parada') >= 0 then public.num(x, 'horas_parada') end,
           case when x->>'status' = 'concluida' then coalesce(public.dt(x, 'concluida_em'), public.dt(x, 'data')) end,
           public.nz(x->>'solicitante'), public.nz(x->>'responsavel'), public.dt(x, 'prazo'), public.nz(x->>'pecas'), public.nz(x->>'aprovacao'),
           coalesce(public.nz(x->>'equipamento'), 'planilha'), null
      from jsonb_array_elements(p) x join public.maquinas m on lower(m.codigo) = lower(x->>'maquina')
     where public.nz(x->>'problema') is not null and not exists (select 1 from public.manutencoes o where o.numero = (x->>'numero')::int);
    get diagnostics n = row_count;
    update public.manutencoes m set numero = x.n
      from (select id, row_number() over (order by data, criado_em) + coalesce((select max(numero) from public.manutencoes), 0) as n
              from public.manutencoes where numero is null) x
     where m.id = x.id;
    return jsonb_build_object('n', n);
  end if;

  if p_parte = 'registros' then
    insert into public.registros (tipo, numero, data, codigo, titulo, status, prazo, concluido_em, responsavel, valor, maquina_id, cliente_id, fornecedor_id, dados, criado_por)
    select x->>'tipo', (x->>'numero')::int, public.dt(x, 'data'), public.nz(x->>'codigo'), public.nz(x->>'titulo'), public.nz(x->>'status'), public.dt(x, 'prazo'),
           public.dt(x, 'concluido_em'), public.nz(x->>'responsavel'), public.num(x, 'valor'),
           (select id from public.maquinas m where lower(m.codigo) = lower(x->>'maquina')),
           public._cliente_por_nome(x->'dados'->>'cliente'),
           (select id from public.fornecedores f where lower(f.nome) = lower(coalesce(x->'dados'->>'fornecedor', x->'dados'->>'prestador')) limit 1),
           case when jsonb_typeof(x->'dados') = 'object' then x->'dados' else '{}' end, null
      from jsonb_array_elements(p) x
     where public.reg_area(x->>'tipo') is not null
    on conflict do nothing;
    get diagnostics n = row_count;
    return jsonb_build_object('n', n);
  end if;

  if p_parte = 'pecas' then
    for x in select * from jsonb_array_elements(p) loop
      continue when public.nz(x->>'codigo') is null or public.nz(x->>'descricao') is null;
      select id into v_id from public.pecas where lower(codigo) = lower(x->>'codigo');
      if v_id is null then
        insert into public.pecas (codigo, descricao, utilizacao, fornecedor_id, unidade, obs)
        values (x->>'codigo', x->>'descricao', public.nz(x->>'utilizacao'),
                (select id from public.fornecedores f where lower(f.nome) = lower(x->>'fornecedor') limit 1), 'un',
                concat_ws(E'\n', 'Da lista de peças da manutenção',
                          case when public.num(x, 'preco') > 0 then 'Último preço na planilha: R$ ' || replace(to_char(public.num(x, 'preco'), 'FM999999990.00'), '.', ',') end,
                          case when public.dt(x, 'ultima_compra') is not null then 'Última compra: ' || to_char(public.dt(x, 'ultima_compra'), 'DD/MM/YYYY') end,
                          case when public.nz(x->>'lote_minimo') is not null then 'Lote mínimo: ' || (x->>'lote_minimo') end));
        n := n + 1;
      else
        update public.pecas set utilizacao = coalesce(utilizacao, public.nz(x->>'utilizacao')),
               fornecedor_id = coalesce(fornecedor_id, (select id from public.fornecedores f where lower(f.nome) = lower(x->>'fornecedor') limit 1))
         where id = v_id;
      end if;
    end loop;
    return jsonb_build_object('novas', n);
  end if;

  if p_parte = 'fim' then
    perform set_config('jaf.importando', '0', true);
    insert into public.historico (user_id, quem, tabela, acao, depois) values (auth.uid(), public.meu_nome(), 'importacao', 'importar', jsonb_build_object('fabrica', p));
    return jsonb_build_object('produtos', (select count(*) from public.produtos), 'estrutura', (select count(*) from public.produto_estrutura),
      'lotes', (select count(*) from public.mp_lotes), 'ofs', (select count(*) from public.ofs), 'vendas', (select count(*) from public.vendas),
      'maquinas', (select count(*) from public.maquinas), 'preventivas', (select count(*) from public.preventivas),
      'manutencoes', (select count(*) from public.manutencoes), 'registros', (select count(*) from public.registros),
      'clientes', (select count(*) from public.clientes), 'fornecedores', (select count(*) from public.fornecedores), 'pecas', (select count(*) from public.pecas));
  end if;
  raise exception 'Parte desconhecida: %', p_parte;
end $$;

-- quem pode chamar as funções novas
do $$
declare f text;
begin
  foreach f in array array['public.perfil_valido(text)','public.reg_area(text)','public.reg_ver(text)','public.reg_editar(text)',
    'public.salvar_preventiva(jsonb)','public.excluir_preventiva(uuid)','public.salvar_produto(jsonb)','public.salvar_lote(jsonb)','public.consumo_lote(integer)',
    'public.ajustar_lote(jsonb)','public.proximo_numero_of(text, date)','public.emitir_of(jsonb)','public.apontar_of(jsonb)','public.salvar_venda(jsonb)',
    'public.entregar_venda(jsonb)','public.excluir_entrega(uuid)','public.salvar_registro(jsonb)','public.excluir_registro(uuid)',
    'public._cliente_por_nome(text)','public.importar_fabrica(text, jsonb, boolean)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.reg_ver(text), public.reg_area(text), public.reg_editar(text), public.salvar_preventiva(jsonb), public.excluir_preventiva(uuid),
  public.salvar_produto(jsonb), public.salvar_lote(jsonb), public.ajustar_lote(jsonb), public.proximo_numero_of(text, date), public.emitir_of(jsonb),
  public.apontar_of(jsonb), public.salvar_venda(jsonb), public.entregar_venda(jsonb), public.excluir_entrega(uuid), public.salvar_registro(jsonb),
  public.excluir_registro(uuid), public.importar_fabrica(text, jsonb, boolean)
  to authenticated;

-- =====================================================================
-- v2.6 — Nota fiscal pelo arquivo XML (NF-e)
-- O site lê o XML que o fornecedor manda por e-mail (no aparelho da pessoa) e manda só os dados:
-- uma nota só entra uma vez (chave de 44 números), cada item vai para o estoque de peças
-- (ou baixa o pedido de compra) ou vira um R.I. de matéria-prima, e as parcelas da nota viram contas a pagar.
-- O sistema guarda qual código do fornecedor é qual peça/material: da próxima vez já vem escolhido.
-- =====================================================================
create table if not exists public.notas_fiscais (
  id              uuid primary key default gen_random_uuid(),
  chave           text not null unique check (chave ~ '^[0-9]{44}$'),
  numero          text,
  serie           text,
  emissao         date,
  data            date not null default public.hoje(),   -- data da entrada
  fornecedor_id   uuid references public.fornecedores(id) on delete set null,
  fornecedor_nome text,
  valor           numeric(14,2),
  itens           jsonb not null default '[]',             -- resumo: o que foi feito com cada item
  obs             text,
  criado_por      uuid default auth.uid(),
  criado_em       timestamptz not null default now()
);

create table if not exists public.nota_vinculos (
  fornecedor_id   uuid not null references public.fornecedores(id) on delete cascade,
  codigo          text not null,                            -- código do item na nota do fornecedor
  peca_id         uuid references public.pecas(id) on delete cascade,
  produto_id      uuid references public.produtos(id) on delete cascade,
  atualizado_em   timestamptz not null default now(),
  primary key (fornecedor_id, codigo),
  check ((peca_id is null) <> (produto_id is null))
);

do $$
declare t text;
begin
  foreach t in array array['notas_fiscais','nota_vinculos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);   -- o site consulta só pelas funções abaixo
  end loop;
end $$;
drop trigger if exists tg_historico on public.notas_fiscais;
create trigger tg_historico after insert or update or delete on public.notas_fiscais for each row execute function public.tg_historico();

-- antes de lançar: a nota já entrou? o fornecedor já é cadastrado? o que cada código virou da última vez?
create or replace function public.conferir_nota(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_chave text := regexp_replace(coalesce(p->>'chave', ''), '\D', '', 'g');
        v_cnpj text := regexp_replace(coalesce(p->>'cnpj', ''), '\D', '', 'g');
        n public.notas_fiscais; v_f uuid;
begin
  perform public.exigir('dono','escritorio','almoxarife','pcp');
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

-- lança a nota inteira de uma vez (tudo ou nada)
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
  v_pecas int := 0; v_ris jsonb := '[]'; v_resumo jsonb := '[]'; v_n int; v_k int := 0; v_grupo uuid; v_val numeric; v_venc date;
begin
  perform public.exigir('dono','escritorio','almoxarife','pcp');
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
      r := public.salvar_lote(jsonb_build_object('produto_id', i->>'produto_id', 'qtd', v_q, 'data', v_data, 'nota', v_num, 'fornecedor_id', v_f,
        'pedido', public.nz(i->>'pedido'), 'status', coalesce(public.nz(i->>'status'), 'Aprovado'),
        'obs', 'Nota fiscal ' || v_num || coalesce(' · ' || public.nz(i->>'descricao'), '')));
      v_ris := v_ris || jsonb_build_array(r->'ri');
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
    perform public.receber_pedido(jsonb_build_object('pedido_id', v_pid, 'chave', gen_random_uuid(), 'data', v_data, 'documento', v_doc, 'itens', v_ped->v_pid));
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
  if v_pecas = 0 and jsonb_array_length(v_ris) = 0 and v_k = 0 then raise exception 'Escolha onde lançar pelo menos um item da nota'; end if;

  insert into public.notas_fiscais (id, chave, numero, serie, emissao, data, fornecedor_id, fornecedor_nome, valor, itens, obs)
  values (v_id, v_chave, v_num, public.nz(p->>'serie'), public.dt(p, 'emissao'), v_data, v_f, v_fnome, round(public.num(p, 'valor'), 2), v_resumo, public.nzt(p->>'obs'));
  return jsonb_build_object('id', v_id, 'fornecedor_id', v_f, 'documento', v_doc, 'pecas', v_pecas, 'ris', v_ris, 'contas', v_k);
end $$;

revoke all on function public.conferir_nota(jsonb), public.lancar_nota(jsonb) from public, anon, authenticated;
grant execute on function public.conferir_nota(jsonb), public.lancar_nota(jsonb) to authenticated;

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

-- o mesmo passo em OFs diferentes: mesma peça (vazia = a peça da própria OF) e mesma operação
create or replace function public._chave_passo(x jsonb, p_desc text) returns text
language sql immutable set search_path = public as $$
  select lower(coalesce(public.nz(x->>'peca'), public.nz(p_desc), '')) || '|' || lower(coalesce(public.nz(x->>'operacao'), '')) $$;

-- marca (ou desmarca) numa OF aberta o passo com a mesma chave; devolve true se mudou alguma coisa.
-- Marcar pega o primeiro ainda não feito; desmarcar pega o último feito (passo repetido conta certo).
create or replace function public._sinc_passo_of(p_of uuid, p_chave text, p_f boolean, p_por text, p_em text) returns boolean
language plpgsql set search_path = public as $$
declare o public.ofs; v_desc text; v_n int;
begin
  select * into o from public.ofs where id = p_of;
  if o.id is null or o.status <> 'aberta' then return false; end if;
  select descricao into v_desc from public.produtos where id = o.produto_id;
  select (x->>'n')::int into v_n from jsonb_array_elements(o.passos) with ordinality t(x, k)
   where public._chave_passo(x, v_desc) = p_chave and coalesce((x->>'feito')::boolean, false) <> p_f
   order by case when p_f then k else -k end limit 1;
  if v_n is null then return false; end if;
  update public.ofs set passos = (
           select jsonb_agg(case when (x->>'n')::int = v_n then x || jsonb_build_object('feito', p_f, 'feito_por', p_por, 'feito_em', p_em) else x end order by k)
             from jsonb_array_elements(o.passos) with ordinality t(x, k))
   where id = o.id;
  return true;
end $$;

-- desce para as OFs dos componentes (as que o conjunto gerou): marca na primeira que tem o passo e segue para os componentes dela
create or replace function public._sinc_passo_desce(p_of uuid, p_chave text, p_f boolean, p_por text, p_em text, p_nivel int default 0) returns boolean
language plpgsql set search_path = public as $$
declare c record;
begin
  if p_nivel > 10 then return false; end if;
  for c in select id from public.ofs where pai_id = p_of and status = 'aberta' order by numero loop
    if public._sinc_passo_of(c.id, p_chave, p_f, p_por, p_em) then
      perform public._sinc_passo_desce(c.id, p_chave, p_f, p_por, p_em, p_nivel + 1);
      return true;
    end if;
  end loop;
  -- nenhuma OF filha tinha o passo: procura um nível abaixo
  for c in select id from public.ofs where pai_id = p_of and status = 'aberta' order by numero loop
    if public._sinc_passo_desce(c.id, p_chave, p_f, p_por, p_em, p_nivel + 1) then return true; end if;
  end loop;
  return false;
end $$;

-- marcar (ou desmarcar) um passo feito na OF. O mesmo passo também fica marcado na OF do conjunto
-- (quando a OF é de um componente) e na OF do componente (quando a OF é do conjunto).
create or replace function public.marcar_passo_of(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.ofs; v_id uuid := public.uid_de(p, 'id'); v_raiz uuid; v_n int := public.num(p, 'n')::int; v_f boolean := coalesce((p->>'feito')::boolean, true);
        x0 jsonb; v_por text; v_em text; v_chave text; v_up uuid; k int := 0;
begin
  perform public.exigir('dono','escritorio','pcp','producao','gerente');
  -- trava a família toda (do conjunto de cima até os componentes de baixo), sempre na mesma ordem
  with recursive acima(id, pai, d) as (
    select f.id, f.pai_id, 0 from public.ofs f where f.id = v_id
    union all select f.id, f.pai_id, a.d + 1 from public.ofs f join acima a on f.id = a.pai where a.d < 10)
  select id into v_raiz from acima order by d desc limit 1;
  perform 1 from public.ofs where id in (
    with recursive abaixo(id, d) as (select v_raiz, 0 union all select f.id, a.d + 1 from public.ofs f join abaixo a on f.pai_id = a.id where a.d < 10)
    select id from abaixo) order by id for update;
  select * into o from public.ofs where id = v_id;
  if o.id is null then raise exception 'OF não encontrada'; end if;
  if o.status <> 'aberta' then raise exception 'A OF % está %: reabra para marcar', o.numero, o.status; end if;
  select x into x0 from jsonb_array_elements(o.passos) x where (x->>'n')::int = v_n limit 1;
  if x0 is null then raise exception 'Passo não encontrado'; end if;
  v_por := case when v_f then public.meu_nome() end;
  v_em := case when v_f then to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') end;
  update public.ofs set passos = (
           select jsonb_agg(case when (x->>'n')::int = v_n then x || jsonb_build_object('feito', v_f, 'feito_por', v_por, 'feito_em', v_em) else x end order by o2)
             from jsonb_array_elements(o.passos) with ordinality t(x, o2))
   where id = o.id
  returning passos into o.passos;
  if coalesce((x0->>'feito')::boolean, false) <> v_f then
    v_chave := public._chave_passo(x0, (select descricao from public.produtos where id = o.produto_id));
    v_up := o.pai_id;
    while v_up is not null and k < 10 loop          -- sobe: OF do conjunto (e a do conjunto dele)
      perform public._sinc_passo_of(v_up, v_chave, v_f, v_por, v_em);
      select pai_id into v_up from public.ofs where id = v_up;
      k := k + 1;
    end loop;
    perform public._sinc_passo_desce(o.id, v_chave, v_f, v_por, v_em);   -- desce: OFs dos componentes
  end if;
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
revoke all on function public._passos_de(uuid, int), public._passos_of(uuid), public._chave_passo(jsonb, text),
                       public._sinc_passo_of(uuid, text, boolean, text, text), public._sinc_passo_desce(uuid, text, boolean, text, text, int) from public, anon, authenticated;
revoke all on function public.processo_sugerido(uuid), public.salvar_processo(jsonb), public.marcar_passo_of(jsonb), public.refazer_passos_of(uuid),
                       public.salvar_pedido(jsonb), public.receber_pedido(jsonb), public.cancelar_pedido(uuid, text),
                       public.salvar_necessidade(jsonb), public.cancelar_necessidade(uuid, text) from public, anon;
grant execute on function public.processo_sugerido(uuid), public.salvar_processo(jsonb), public.marcar_passo_of(jsonb), public.refazer_passos_of(uuid),
                          public.salvar_pedido(jsonb), public.receber_pedido(jsonb), public.cancelar_pedido(uuid, text),
                          public.salvar_necessidade(jsonb), public.cancelar_necessidade(uuid, text) to authenticated;

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
