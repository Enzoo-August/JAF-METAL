-- =====================================================================
-- v3.3b — resultado da pesquisa só para quem está na lista de leitores
--   * ninguém lê a tabela avaliacoes direto (nem o Dono);
--   * o resultado sai só pela função resultado_pesquisa(), para quem está em pesquisa_leitores;
--   * a lista de leitores é preenchida direto no banco (o aplicativo não tem como mexer nela).
-- =====================================================================
create table if not exists public.pesquisa_leitores (
  user_id uuid primary key,
  criado_em timestamptz not null default now()
);
alter table public.pesquisa_leitores enable row level security;
revoke all on public.pesquisa_leitores from anon, authenticated;

drop policy if exists ler on public.avaliacoes;
revoke all on public.avaliacoes from anon, authenticated;

create or replace function public.ve_pesquisa() returns boolean
language sql stable security definer set search_path = public as
$$ select auth.uid() is not null and exists (select 1 from public.pesquisa_leitores where user_id = auth.uid()) $$;

create or replace function public.resultado_pesquisa() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.ve_pesquisa() then raise exception 'Seu perfil não pode ver o resultado da pesquisa.'; end if;
  select jsonb_build_object(
    'total', (select count(*) from public.avaliacoes),
    'hoje', (select count(*) from public.avaliacoes where (criado_em at time zone 'America/Sao_Paulo')::date = public.hoje()),
    'ultima', (select max(criado_em) from public.avaliacoes),
    'medias', (select jsonb_build_object('melhorou', round(avg(melhorou), 1), 'tarefa', round(avg(tarefa), 1), 'futuro', round(avg(futuro), 1)) from public.avaliacoes),
    'tempo', coalesce((select jsonb_object_agg(tempo, n) from (select tempo, count(*) n from public.avaliacoes group by tempo) t), '{}'::jsonb),
    'setores', coalesce((select jsonb_agg(s order by s->>'n' desc, s->>'setor') from (
        select jsonb_build_object('setor', setor, 'n', count(*), 'melhorou', round(avg(melhorou), 1), 'tarefa', round(avg(tarefa), 1), 'futuro', round(avg(futuro), 1)) s
        from public.avaliacoes group by setor) x), '[]'::jsonb),
    'comentarios', coalesce((select jsonb_agg(jsonb_build_object('setor', setor, 'texto', comentario, 'em', criado_em) order by criado_em desc)
        from public.avaliacoes where comentario is not null), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke all on function public.ve_pesquisa(), public.resultado_pesquisa() from public, anon;
grant execute on function public.ve_pesquisa(), public.resultado_pesquisa() to authenticated;
