
-- =====================================================================
-- v2.9.1 — o passo marcado na OF do componente também fica marcado na OF do conjunto (e o contrário)
--   * "mesmo passo" = mesma peça e mesma operação (na OF do componente, passo sem peça = a peça dela);
--   * sobe pela OF do conjunto (pai_id) e desce pelas OFs dos componentes que o conjunto gerou;
--   * só mexe em OF aberta; quem marcou e quando vão iguais nas duas.
-- =====================================================================

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

revoke all on function public._chave_passo(jsonb, text), public._sinc_passo_of(uuid, text, boolean, text, text),
                       public._sinc_passo_desce(uuid, text, boolean, text, text, int) from public, anon, authenticated;
revoke all on function public.marcar_passo_of(jsonb) from public, anon;
grant execute on function public.marcar_passo_of(jsonb) to authenticated;
