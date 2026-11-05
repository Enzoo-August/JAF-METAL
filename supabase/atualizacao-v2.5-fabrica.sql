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
  check (perfil in ('dono','escritorio','almoxarife','pcp','producao','rh','gerente','tecnico','manutencao'));

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
