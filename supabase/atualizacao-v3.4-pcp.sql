-- =====================================================================
-- v3.4 — pedidos do PCP (Marcio, novembro/2026)
--   * OF de conjunto: componente comprado (CC) é tratado como matéria-prima: não ganha OF automática
--     nem entra no passo a passo; só o componente fabricado (CF, sub-conjunto…) ganha a sua OF;
--   * o PCP acompanha os pedidos de compra de matéria-prima em aberto (sem ver preço).
--   (as etiquetas de R.I. 4 por folha e os avisos de novidade são só do aplicativo)
-- =====================================================================

-- componente comprado: código JAF que começa com CC (ex.: CC 03.0333)
create or replace function public.eh_comprado(p_codigo text) returns boolean
language sql immutable set search_path = public as $$ select coalesce(p_codigo, '') ~* '^\s*CC[\s.-]*[0-9]' $$;

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
  -- v3.4: material que é componente comprado (CC, em peças) também baixa do R.I. pela quantidade
  if v_tipo = 'componente' and v_kg is null and pr.mp_qtd is not null and (lower(coalesce(pr.mp_unidade, 'kg')) like 'kg%' or public.eh_comprado(pr.mp_codigo)) then v_kg := round(v_qtd * pr.mp_qtd, 3); end if;
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
  -- conjunto novo: já emite a OF de cada componente fabricado aqui (e anota o número na OF do conjunto);
  -- o componente comprado (CC) não ganha OF: chega do fornecedor por R.I., como a matéria-prima
  if v_tipo = 'conjunto' and v_old.id is null and coalesce((p->>'gerar_componentes')::boolean, false) then
    for e in select e2.qtd as q, e2.ordem, f.id, f.codigo, f.mp_qtd, f.mp_unidade, f.mp_codigo from public.produto_estrutura e2 join public.produtos f on f.id = e2.filho_id
              where e2.pai_id = pr.id and f.classe = 'peca' and f.situacao <> 'bloqueado'
                and not public.eh_comprado(f.codigo)   -- v3.4: componente comprado (CC) entra como matéria-prima, sem OF
                and coalesce(f.operacao, '') !~* '^\s*controlar\s+recebimento'   -- peça comprada (só conferir no recebimento) também não
                and (f.mp_codigo is not null or exists (select 1 from public.produto_estrutura x where x.pai_id = f.id))
              order by e2.ordem loop
      v_filho := gen_random_uuid();
      v_ft := case when exists (select 1 from public.produto_estrutura x where x.pai_id = e.id) then 'conjunto' else 'componente' end;
      insert into public.ofs (id, numero, tipo, produto_id, qtd, kg, emitido_por, emitida_em, prazo, pai_id, venda_id, componentes)
      values (v_filho, public.proximo_numero_of(v_ft, v_data), v_ft, e.id, round(e.q * v_qtd, 3),
              case when v_ft = 'componente' and e.mp_qtd is not null and (lower(coalesce(e.mp_unidade, 'kg')) like 'kg%' or public.eh_comprado(e.mp_codigo)) then round(e.q * v_qtd * e.mp_qtd, 3) end,
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
              where e2.pai_id = pr.id and f.classe = 'peca' and not public.eh_comprado(f.codigo)
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

-- o PCP acompanha os pedidos de compra de matéria-prima em aberto, SEM ver preço
-- (as tabelas de compra continuam fechadas para o PCP: esta função devolve só material, quantidade, prazo e fornecedor)
create or replace function public.compras_mp_abertas() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir('dono','escritorio','almoxarife','comercial','pcp');
  return coalesce((
    select jsonb_agg(jsonb_build_object('pedido_id', pc.id, 'numero', pc.numero, 'data', pc.data, 'prazo', pc.prazo, 'fornecedor', f.nome,
                                        'produto_id', i.produto_id, 'codigo', p.codigo, 'descricao', p.descricao, 'qtd', i.qtd, 'recebido', i.recebido)
                     order by pc.prazo nulls last, pc.numero, i.ordem)
      from public.pedidos_compra pc
      join public.pedido_itens i on i.pedido_id = pc.id
      left join public.fornecedores f on f.id = pc.fornecedor_id
      left join public.produtos p on p.id = i.produto_id
     where pc.tipo = 'mp' and pc.status = 'aguardando' and i.produto_id is not null and i.recebido < i.qtd), '[]'::jsonb);
end $$;

-- quem pode chamar
revoke all on function public.eh_comprado(text) from public, anon, authenticated;
revoke all on function public.compras_mp_abertas() from public, anon;
grant execute on function public.compras_mp_abertas() to authenticated;
