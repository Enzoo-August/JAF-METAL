-- =====================================================================
-- v3.3 — pesquisa rápida com a equipe ("quanto você acha que o sistema vai ajudar?", fase de teste)
--   * página pública /avaliacao.html: a pessoa escolhe o setor e responde 5 perguntas;
--   * quem responde NÃO lê nada do banco: só grava a própria resposta pela função enviar_avaliacao;
--   * só o Dono lê as respostas; limite de 20 respostas por minuto e 500 no total; fecha em 31/12/2026.
-- =====================================================================
create table if not exists public.avaliacoes (
  id         uuid primary key default gen_random_uuid(),
  setor      text not null check (setor in ('pcp','comercial','rh','almoxarifado','producao','financeiro','engenharia','manutencao','direcao','outro')),
  nome       text check (nome is null or char_length(nome) <= 80),
  melhorou   smallint not null check (melhorou between 0 and 10),
  tarefa     smallint not null check (tarefa between 0 and 10),
  tempo      text not null check (tempo in ('nada','ate1','1a3','3a5','mais5')),
  futuro     smallint not null check (futuro between 0 and 10),
  comentario text check (comentario is null or char_length(comentario) <= 600),
  criado_em  timestamptz not null default now()
);
alter table public.avaliacoes enable row level security;
revoke all on public.avaliacoes from anon, authenticated;
grant select on public.avaliacoes to authenticated;
drop policy if exists ler on public.avaliacoes;
create policy ler on public.avaliacoes for select to authenticated using (public.eh('dono'));

create or replace function public.enviar_avaliacao(p jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if now() > timestamptz '2026-12-31 23:59:59-03' then raise exception 'A pesquisa já foi encerrada.'; end if;
  if (select count(*) from public.avaliacoes) >= 500 then raise exception 'A pesquisa já foi encerrada.'; end if;
  if (select count(*) from public.avaliacoes where criado_em > now() - interval '1 minute') >= 20 then
    raise exception 'Muitas respostas ao mesmo tempo. Tente de novo em 1 minuto.';
  end if;
  insert into public.avaliacoes (setor, nome, melhorou, tarefa, tempo, futuro, comentario)
  values (p->>'setor', nullif(btrim(left(p->>'nome', 80)), ''), (p->>'melhorou')::smallint, (p->>'tarefa')::smallint,
          p->>'tempo', (p->>'futuro')::smallint, nullif(btrim(left(p->>'comentario', 600)), ''));
  return true;
end $$;
revoke all on function public.enviar_avaliacao(jsonb) from public;
grant execute on function public.enviar_avaliacao(jsonb) to anon, authenticated;
