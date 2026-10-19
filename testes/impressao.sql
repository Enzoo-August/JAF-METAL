-- "Impressão digital" do banco: compara o Supabase de verdade com o schema.sql testado
select 'f:' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as item,
       md5(p.prosrc || '|' || p.prosecdef || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' ||
           has_function_privilege('anon', p.oid, 'execute') || has_function_privilege('authenticated', p.oid, 'execute')) as h
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
union all
select 't:' || c.relname, md5(string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull || ' ' ||
       coalesce(pg_get_expr(d.adbin, d.adrelid), ''), ',' order by a.attnum) || c.relrowsecurity ||
       has_table_privilege('authenticated', c.oid, 'select') || has_table_privilege('authenticated', c.oid, 'insert') ||
       has_table_privilege('anon', c.oid, 'select'))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
 where n.nspname = 'public' and c.relkind = 'r' group by c.relname, c.relrowsecurity, c.oid
union all
select 'p:' || tablename || '.' || policyname, md5(coalesce(qual, '') || cmd || array_to_string(roles, ',')) from pg_policies where schemaname = 'public'
union all
select 'g:' || event_object_table || '.' || trigger_name || '.' || event_manipulation, md5(action_statement || action_timing) from information_schema.triggers where trigger_schema = 'public'
union all
select 'i:' || indexname, md5(indexdef) from pg_indexes where schemaname = 'public'
order by 1;
