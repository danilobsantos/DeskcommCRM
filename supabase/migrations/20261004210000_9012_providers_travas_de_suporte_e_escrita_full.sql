-- manifest: providers entra nas travas de suporte e na escrita _full (pós-0533)
-- A 9003 nasceu antes das travas de suporte (0274) e da fatia 2 (0533): a
-- `providers_write` aceitava a função pura `fn_is_platform_admin()` e a tabela
-- nunca recebeu as `support_write_*`. Sem isso, suporte em modo somente-leitura
-- escreve em `providers`, e o invariante global da #2115 acusa qualquer policy
-- de escrita que cite a pura. Idempotente: `drop if exists` + a função de
-- travas (ela mesma idempotente). Leitura mantém a pura (o par não restringe
-- leitura, como nas demais tabelas).
drop policy if exists providers_write on public.providers;
create policy providers_write on public.providers
  using (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;
