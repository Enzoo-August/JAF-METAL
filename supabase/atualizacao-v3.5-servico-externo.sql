-- =====================================================================
-- v3.5 — serviço externo pela nota fiscal (Marcio, PCP, novembro/2026)
--   * a nota de SAÍDA que a JAF emite para o fornecedor (zincagem, tratamento…) lança os serviços externos;
--   * a nota de RETORNO que o fornecedor emite dá a baixa (Qde retornada, data e nº da NF);
--   * a mesma nota não entra duas vezes (chave de 44 números) e dá para desfazer.
--   (a leitura do XML e do PDF da nota é feita no aparelho; aqui só entra o que a pessoa confirmou)
-- =====================================================================

create table if not exists public.notas_servico (
  id            uuid primary key default gen_random_uuid(),
  chave         text not null check (chave ~ '^[0-9]{44}$'),
  tipo          text not null check (tipo in ('saida','retorno')),
  numero        text,
  serie         text,
  emissao       date,
  fornecedor    text,
  cnpj          text,
  origem        text check (origem in ('xml','pdf')),
  itens         jsonb not null default '[]',   -- [{registro_id, numero, codigo, qtd, antes:{status, concluido_em, nf_retorno}}]
  qtd           numeric(14,3) not null default 0,
  desfeito_em   timestamptz,
  desfeito_por  text,
  criado_por    uuid default auth.uid(),
  criado_nome   text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists notas_servico_chave on public.notas_servico (chave) where desfeito_em is null;
drop trigger if exists tg_atualizado on public.notas_servico;
create trigger tg_atualizado before update on public.notas_servico for each row execute function public.tg_atualizado();
alter table public.notas_servico enable row level security;
revoke all on public.notas_servico from anon, authenticated;
grant select on public.notas_servico to authenticated;
drop policy if exists ler on public.notas_servico;
create policy ler on public.notas_servico for select to authenticated using (public.reg_ver('servico_externo'));

-- p: {id, tipo:'saida'|'retorno', chave, numero, serie, emissao, fornecedor, cnpj, origem,
--     itens (saída):   [{codigo, descricao, titulo, qtd, peso, of}]   → um serviço externo novo por item
--     itens (retorno): [{registro_id, qtd}]                            → soma na Qde retornada de cada serviço}
create or replace function public.lancar_nota_servico(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := coalesce(public.uid_de(p, 'id'), gen_random_uuid()); v_tipo text := public.nz(p->>'tipo');
  v_chave text := regexp_replace(coalesce(p->>'chave', ''), '\D', '', 'g'); v_cnpj text := regexp_replace(coalesce(p->>'cnpj', ''), '\D', '', 'g');
  v_data date := public.dt(p, 'emissao', public.hoje()); v_nf text := public.nz(p->>'numero'); v_forn text := left(public.nz(p->>'fornecedor'), 120);
  ex public.notas_servico; it jsonb; r public.registros; v_rid uuid; v_num int; v_q numeric; v_tot numeric; v_ret numeric; v_nfs text;
  v_itens jsonb := '[]'; v_soma numeric := 0; i int := 0;
begin
  if not public.reg_editar('servico_externo') then raise exception 'Seu perfil não pode fazer isso.'; end if;
  if v_tipo is null or v_tipo not in ('saida','retorno') then raise exception 'Tipo de nota inválido'; end if;
  if length(v_chave) <> 44 then raise exception 'A chave da nota (44 números) não veio no arquivo'; end if;
  if jsonb_typeof(p->'itens') is distinct from 'array' or jsonb_array_length(p->'itens') = 0 then raise exception 'Escolha pelo menos um item da nota'; end if;
  if jsonb_array_length(p->'itens') > 300 then raise exception 'Itens demais numa nota só'; end if;
  perform pg_advisory_xact_lock(4246);   -- o mesmo da numeração dos registros
  select * into ex from public.notas_servico where chave = v_chave and desfeito_em is null;
  if ex.id is not null then
    if ex.id = v_id then   -- o mesmo envio de novo (toque duplo): não repete
      return jsonb_build_object('id', ex.id, 'repetido', true, 'registros', jsonb_array_length(ex.itens), 'qtd', ex.qtd, 'itens', ex.itens);
    end if;
    raise exception 'A NF % já foi lançada no serviço externo em % por %', coalesce(ex.numero, ''),
      to_char(ex.criado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), coalesce(ex.criado_nome, '—');
  end if;

  if v_tipo = 'saida' then
    if v_forn is null then raise exception 'Informe o fornecedor do serviço'; end if;
    for it in select * from jsonb_array_elements(p->'itens') loop
      i := i + 1; v_q := public.num(it, 'qtd');
      if public.nz(it->>'codigo') is null then raise exception 'Item %: falta o código da peça', i; end if;
      if public.nz(it->>'titulo') is null then raise exception 'Item % (%): preencha a descrição do serviço', i, it->>'codigo'; end if;
      if v_q is not null and v_q < 0 then raise exception 'Item % (%): quantidade inválida', i, it->>'codigo'; end if;
      if coalesce(v_q, 0) = 0 and public.nz(it->>'peso') is null then raise exception 'Item % (%): informe a quantidade', i, it->>'codigo'; end if;
      v_num := coalesce((select max(numero) from public.registros where tipo = 'servico_externo'), 0) + 1;
      v_rid := gen_random_uuid();
      insert into public.registros (id, tipo, numero, data, codigo, titulo, status, responsavel, dados)
      values (v_rid, 'servico_externo', v_num, v_data, left(public.nz(it->>'codigo'), 60), left(public.nzt(it->>'titulo'), 500), 'Fora (no fornecedor)', public.meu_nome(),
              jsonb_strip_nulls(jsonb_build_object('descricao', left(public.nz(it->>'descricao'), 200), 'qtd', nullif(v_q, 0), 'peso', left(public.nz(it->>'peso'), 30),
                                                   'of', left(public.nz(it->>'of'), 30), 'fornecedor', v_forn, 'saida', v_data, 'nf_saida', v_nf)));
      v_itens := v_itens || jsonb_build_object('registro_id', v_rid, 'numero', v_num, 'codigo', public.nz(it->>'codigo'), 'qtd', nullif(v_q, 0));
      v_soma := v_soma + coalesce(v_q, 0);
    end loop;
  else
    for it in select * from jsonb_array_elements(p->'itens') loop
      v_q := public.num(it, 'qtd');
      if v_q is null or v_q = 0 then continue; end if;
      if v_q < 0 then raise exception 'Quantidade inválida'; end if;
      select * into r from public.registros where id = public.uid_de(it, 'registro_id') and tipo = 'servico_externo' for update;
      if r.id is null then raise exception 'Um dos serviços externos não existe mais (pode ter sido excluído). Leia a nota de novo.'; end if;
      v_tot := public.num(r.dados, 'qtd'); v_ret := coalesce(public.num(r.dados, 'qtd_retorno'), 0);
      if v_tot is not null and v_ret + v_q > v_tot then
        raise exception 'O serviço nº % (%) tem só % em aberto e a nota dá retorno de %', r.numero, coalesce(r.codigo, ''), v_tot - v_ret, v_q;
      end if;
      v_nfs := case when v_nf is null or strpos(', ' || coalesce(r.dados->>'nf_retorno', '') || ',', ', ' || v_nf || ',') > 0 then public.nz(r.dados->>'nf_retorno')
                    else concat_ws(', ', public.nz(r.dados->>'nf_retorno'), v_nf) end;
      update public.registros
         set dados = dados || jsonb_strip_nulls(jsonb_build_object('qtd_retorno', v_ret + v_q, 'nf_retorno', v_nfs)),
             concluido_em = v_data,
             status = case when v_tot is null or v_ret + v_q >= v_tot then 'Retornou' else coalesce(public.nz(status), 'Fora (no fornecedor)') end
       where id = r.id;
      v_itens := v_itens || jsonb_build_object('registro_id', r.id, 'numero', r.numero, 'codigo', r.codigo, 'qtd', v_q,
                                               'antes', jsonb_build_object('status', r.status, 'concluido_em', r.concluido_em, 'nf_retorno', r.dados->'nf_retorno'));
      v_soma := v_soma + v_q;
    end loop;
    if jsonb_array_length(v_itens) = 0 then raise exception 'Nenhum item com quantidade: nada foi lançado'; end if;
  end if;

  insert into public.notas_servico (id, chave, tipo, numero, serie, emissao, fornecedor, cnpj, origem, itens, qtd, criado_nome)
  values (v_id, v_chave, v_tipo, v_nf, public.nz(p->>'serie'), v_data, v_forn, nullif(v_cnpj, ''),
          case when p->>'origem' in ('xml','pdf') then p->>'origem' end, v_itens, v_soma, public.meu_nome());
  return jsonb_build_object('id', v_id, 'registros', jsonb_array_length(v_itens), 'qtd', v_soma, 'itens', v_itens);
end $$;

-- desfaz uma nota: a de saída apaga os serviços que criou (se nenhum já teve retorno); a de retorno tira a quantidade de volta
create or replace function public.desfazer_nota_servico(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare ns public.notas_servico; x record; r public.registros; v_ret numeric; n int := 0;
begin
  if not public.reg_editar('servico_externo') then raise exception 'Seu perfil não pode fazer isso.'; end if;
  select * into ns from public.notas_servico where id = p_id for update;
  if ns.id is null then raise exception 'Nota não encontrada'; end if;
  if ns.desfeito_em is not null then raise exception 'Esta nota já foi desfeita'; end if;
  perform pg_advisory_xact_lock(4246);
  if ns.tipo = 'saida' then
    if exists (select 1 from public.registros g join jsonb_array_elements(ns.itens) e on g.id = public.uid_de(e, 'registro_id')
                where coalesce(public.num(g.dados, 'qtd_retorno'), 0) > 0 or lower(coalesce(g.status, '')) = 'retornou') then
      raise exception 'Algum serviço desta nota já teve retorno lançado: desfaça primeiro a nota de retorno';
    end if;
    delete from public.registros g using jsonb_array_elements(ns.itens) e
     where g.id = public.uid_de(e, 'registro_id') and g.tipo = 'servico_externo';
    get diagnostics n = row_count;
  else
    for x in select e as it from jsonb_array_elements(ns.itens) with ordinality t(e, o) order by o desc loop
      select * into r from public.registros where id = public.uid_de(x.it, 'registro_id') and tipo = 'servico_externo' for update;
      continue when r.id is null;
      v_ret := coalesce(public.num(r.dados, 'qtd_retorno'), 0) - coalesce(public.num(x.it, 'qtd'), 0);
      update public.registros
         set dados = ((case when v_ret > 0 then dados || jsonb_build_object('qtd_retorno', v_ret) else dados - 'qtd_retorno' end) - 'nf_retorno')
                     || coalesce(jsonb_strip_nulls(jsonb_build_object('nf_retorno', x.it->'antes'->'nf_retorno')), '{}'),
             status = x.it->'antes'->>'status',
             concluido_em = public.dt(x.it->'antes', 'concluido_em')
       where id = r.id;
      n := n + 1;
    end loop;
  end if;
  update public.notas_servico set desfeito_em = now(), desfeito_por = public.meu_nome() where id = ns.id;
  return n;
end $$;

-- quem pode chamar
revoke all on function public.lancar_nota_servico(jsonb) from public, anon;
revoke all on function public.desfazer_nota_servico(uuid) from public, anon;
grant execute on function public.lancar_nota_servico(jsonb) to authenticated;
grant execute on function public.desfazer_nota_servico(uuid) to authenticated;
