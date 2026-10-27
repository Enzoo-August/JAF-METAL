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
alter table public.perfis add constraint perfis_perfil_check check (perfil in ('dono','escritorio','almoxarife','pcp','producao','rh','gerente'));

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
create unique index if not exists maquinas_nome_un on public.maquinas (lower(nome));

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
  if length(coalesce(p_senha, '')) < 8 then raise exception 'A senha precisa ter 8 caracteres ou mais'; end if;
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
  if length(coalesce(p_senha, '')) < 8 then raise exception 'A senha precisa ter 8 caracteres ou mais'; end if;
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
alter table public.funcionarios add column if not exists motivo_demissao text;
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
  motivo         text not null default 'Admissão' check (motivo in ('Admissão','Promoção','Dissídio','Espontâneo','Mérito','Correção','Mudança de setor')),
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
  justificativa  text check (justificativa is null or justificativa in ('atestado','declaracao','licenca','folga','falta','abonado','compensado')),
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
  alter table public.rh_anexos add constraint rh_anexos_tabela_check check (tabela in ('funcionarios','rh_matriz_niveis','rh_asos','rh_epis','rh_ocorrencias','rh_ausencias','rh_processos'));
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
                                   superior_id, horario, descanso, situacao, demissao, motivo_demissao, ferias_base)
  values (v_id, v_nome, v_funcao, public.nz(p->>'setor'), public.nz(p->>'telefone'), public.dt(p, 'admissao'), v_sit <> 'desligado',
          public.nz(p->>'matricula'), public.nz(p->>'matricula_esocial'), v_reg, v_cargo, public.uid_de(p, 'superior_id'),
          public.nz(p->>'horario'), public.nz(p->>'descanso'), v_sit, public.dt(p, 'demissao'), public.nz(p->>'motivo_demissao'),
          public.dt(p, 'ferias_base'))
  on conflict (id) do update set nome = excluded.nome, funcao = excluded.funcao, setor = excluded.setor, telefone = excluded.telefone,
          admissao = excluded.admissao, ativo = excluded.ativo, matricula = excluded.matricula, matricula_esocial = excluded.matricula_esocial,
          registro = excluded.registro, cargo_id = excluded.cargo_id, superior_id = excluded.superior_id, horario = excluded.horario,
          descanso = excluded.descanso, situacao = excluded.situacao, demissao = excluded.demissao, motivo_demissao = excluded.motivo_demissao,
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
           cnh_categoria, cnh_validade, categoria_militar)
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
            upper(public.nz(pr->>'rg_uf')), public.dt(pr, 'rg_emissao'), upper(public.nz(pr->>'cnh_categoria')), public.dt(pr, 'cnh_validade'), public.nz(pr->>'categoria_militar'))
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
            rg_emissao = excluded.rg_emissao, cnh_categoria = excluded.cnh_categoria, cnh_validade = excluded.cnh_validade, categoria_militar = excluded.categoria_militar;
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
  insert into public.rh_cargos (id, nome, cbo, setor, superior_id, descricao, ativo)
  values (v_id, v_nome, public.nz(p->>'cbo'), public.nz(p->>'setor'), v_sup, public.nzt(p->>'descricao'), coalesce((p->>'ativo')::boolean, true))
  on conflict (id) do update set nome = excluded.nome, cbo = excluded.cbo, setor = excluded.setor, superior_id = excluded.superior_id,
          descricao = excluded.descricao, ativo = excluded.ativo;
  update public.funcionarios set funcao = v_nome where cargo_id = v_id and funcao is distinct from v_nome;
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
    if v_j is not null and v_j not in ('atestado','declaracao','licenca','folga','falta','abonado','compensado') then raise exception 'Justificativa inválida'; end if;
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
create or replace function public.rh_salvar_epi(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid());
begin
  perform public.exigir('dono','escritorio','rh');
  if (p->>'excluir')::boolean then delete from public.rh_epis where id = v_id; return v_id; end if;
  if not exists (select 1 from public.funcionarios where id = public.uid_de(p, 'funcionario_id')) then raise exception 'Escolha o funcionário'; end if;
  if public.nz(p->>'epi') is null then raise exception 'Informe o equipamento (EPI)'; end if;
  if public.dt(p, 'entrega') is null then raise exception 'Informe a data de entrega'; end if;
  insert into public.rh_epis (id, funcionario_id, epi, ca, entrega, validade_ca, vida_util_meses, quantidade, motivo, obs)
  values (v_id, public.uid_de(p, 'funcionario_id'), public.nz(p->>'epi'), public.nz(p->>'ca'), public.dt(p, 'entrega'), public.dt(p, 'validade_ca'),
          nullif(public.num(p, 'vida_util_meses')::int, 0), coalesce(public.num(p, 'quantidade'), 1), public.nz(p->>'motivo'), public.nzt(p->>'obs'))
  on conflict (id) do update set epi = excluded.epi, ca = excluded.ca, entrega = excluded.entrega, validade_ca = excluded.validade_ca,
          vida_util_meses = excluded.vida_util_meses, quantidade = excluded.quantidade, motivo = excluded.motivo, obs = excluded.obs;
  return v_id;
end $$;

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
create or replace function public.rh_anexar(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := gen_random_uuid(); v_c text := p->>'conteudo'; v_tam int;
begin
  perform public.exigir('dono','escritorio','rh');
  if coalesce(p->>'tabela', '') not in ('funcionarios','rh_matriz_niveis','rh_asos','rh_epis','rh_ocorrencias','rh_ausencias','rh_processos') then raise exception 'Anexo sem destino'; end if;
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
                                     situacao, demissao, motivo_demissao, ferias_base)
    values (v_id, x->>'nome', public.nz(x->>'funcao'), public.nz(x->>'setor'), public.nz(x->>'telefone'), public.dt(x, 'admissao'),
            coalesce(x->>'situacao', 'ativo') <> 'desligado', public.nz(x->>'matricula'), public.nz(x->>'matricula_esocial'), public.nz(x->>'registro'),
            (select id from public.rh_cargos where lower(nome) = lower(x->>'cargo')), public.nz(x->>'horario'), public.nz(x->>'descanso'),
            coalesce(public.nz(x->>'situacao'), 'ativo'), public.dt(x, 'demissao'), public.nz(x->>'motivo_demissao'), public.dt(x, 'ferias_base'));
    insert into _mapa values (x->>'chave', v_id);
    if jsonb_typeof(x->'privado') = 'object' then
      insert into public.funcionarios_privado
      select * from jsonb_populate_record(null::public.funcionarios_privado,
        (x->'privado') || jsonb_build_object('funcionario_id', v_id, 'ferias', '[]'::jsonb, 'atualizado_em', now()));
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
  public.rh_salvar_processo(jsonb), public.importar_rh(jsonb, boolean)
  to authenticated;

-- depois que existe um Dono, o "primeiro acesso" deixa de existir para quem não entrou
do $$ begin
  if public.ha_dono() then
    revoke execute on function public.primeiro_dono(text, text, text) from anon, authenticated;
    revoke execute on function public.ha_dono() from anon;
  end if;
end $$;
