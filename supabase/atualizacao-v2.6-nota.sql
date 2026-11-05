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
