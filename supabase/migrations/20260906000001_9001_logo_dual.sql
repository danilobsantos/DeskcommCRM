-- ============================================================================
-- 9001 — LOGO DUAL: LIGHT E DARK.
--
-- O problema: um único `logo_path` por camada. Um logo escuro com fundo
-- transparente some no tema claro, e vice-versa. Esta migration adiciona
-- `logo_path_dark` — o logo para o tema escuro — em ambas as camadas
-- (instalação e organização).
--
-- ─── Decisões de design ─────────────────────────────────────────────────────
--
-- Dois campos, e não CSS filter / mix-blend-mode:
--   - `filter: invert(1)` funciona só para logos monocromáticos;
--   - `mix-blend-mode: difference` exige controle do fundo e não funciona em
--     `<img>` isolado;
--   - O preview já prova visualmente que a inversão não é confiável.
--
-- `<picture>` com `prefers-color-scheme` não serve porque:
--   - Não funciona em e-mail/PDF (que usam `saida.ts` e sempre pegam light);
--   - Não funciona quando o tema é forçado pelo usuário (data-theme).
--
-- A resolução é por JS no cliente (Sidebar lê `data-theme` e escolhe o `<img>`).
--
-- ─── Backward compat ────────────────────────────────────────────────────────
--
-- `logo_path_dark` é NULLABLE. Instalações sem ele funcionam normalmente:
-- o fallback é sempre `logo_path_dark ?? logo_path ?? null`.
--
-- ─── Ordem no baseline ──────────────────────────────────────────────────────
--
-- As FUNÇÕES ficam antes da varredura anon (mesmo motivo da 0158).
-- A COLUNA fica no fim do arquivo, ao lado da de `logo_path`.
-- ============================================================================

-- ── A função da ORGANIZAÇÃO (com p_path_dark) ─────────────────────────────

create or replace function public.fn_definir_logo_da_organizacao(
  p_org       uuid,
  p_actor     uuid,
  p_path      text,
  p_path_dark text default null
) returns integer
    language plpgsql
    volatile
    security definer
    set search_path to 'public', 'pg_temp'
as $$
declare
  v_linhas    integer;
  v_path      text;
  v_path_dark text;
begin
  if p_org is null or p_actor is null then
    raise exception 'logo_da_organizacao_argumento_nulo'
      using errcode = '22023';
  end if;

  v_path := nullif(btrim(coalesce(p_path, '')), '');
  v_path_dark := nullif(btrim(coalesce(p_path_dark, '')), '');

  -- PREFIXO ASSEVERADO DENTRO DO BANCO — mesmo gate da versão anterior.
  if v_path is not null
     and v_path !~ ('^' || p_org::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$')
  then
    raise exception 'logo_da_organizacao_caminho_fora_do_escopo'
      using errcode = '22023';
  end if;

  if v_path_dark is not null
     and v_path_dark !~ ('^' || p_org::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$')
  then
    raise exception 'logo_da_organizacao_caminho_dark_fora_do_escopo'
      using errcode = '22023';
  end if;

  if not exists (
       select 1 from public.user_organizations uo
        where uo.user_id = p_actor
          and uo.organization_id = p_org
          and uo.role = 'admin'
          and uo.revoked_at is null
     )
     and not exists (
       select 1 from public.platform_admins pa
        where pa.user_id = p_actor
          and pa.revoked_at is null
     )
  then
    raise exception 'logo_da_organizacao_sem_permissao'
      using errcode = '42501';
  end if;

  -- Merge no CAMPO — mantém `logo_path` preservado se `p_path` for null,
  -- e faz o mesmo para `logo_path_dark`.
  update public.organizations o
     set settings = case
           when v_path is null and v_path_dark is null
             then jsonb_set(
                    coalesce(o.settings, '{}'::jsonb), '{branding}',
                    coalesce(o.settings -> 'branding', '{}'::jsonb) - 'logo_path' - 'logo_path_dark', true)
           when v_path is null
             then jsonb_set(
                    coalesce(o.settings, '{}'::jsonb), '{branding}',
                    coalesce(o.settings -> 'branding', '{}'::jsonb) - 'logo_path'
                      || jsonb_build_object('logo_path_dark', v_path_dark), true)
           when v_path_dark is null
             then jsonb_set(
                    coalesce(o.settings, '{}'::jsonb), '{branding}',
                    coalesce(o.settings -> 'branding', '{}'::jsonb) - 'logo_path_dark'
                      || jsonb_build_object('logo_path', v_path), true)
           else jsonb_set(
                    coalesce(o.settings, '{}'::jsonb), '{branding}',
                    coalesce(o.settings -> 'branding', '{}'::jsonb)
                      || jsonb_build_object('logo_path', v_path, 'logo_path_dark', v_path_dark), true)
         end
   where o.id = p_org;

  get diagnostics v_linhas = row_count;
  return v_linhas;
end;
$$;

comment on function public.fn_definir_logo_da_organizacao(uuid, uuid, text, text) is
  'Grava (ou apaga) organizations.settings.branding.logo_path e logo_path_dark com merge no CAMPO. Assevera prefixo por organization_id. Papel insuficiente levanta 42501. Devolve linhas afetadas: 0 = a organização não existe. Chamador: app/api/v1/marca/logo/route.ts.';

-- ── O FORWARD-FIX DA 0157 (+ preservação de logo_path_dark) ────────────────

create or replace function public.fn_definir_marca_da_organizacao(
  p_org   uuid,
  p_actor uuid,
  p_marca jsonb
) returns integer
    language plpgsql
    volatile
    security definer
    set search_path to 'public', 'pg_temp'
as $$
declare
  v_linhas integer;
  v_hex    text;
  v_limpar boolean;
begin
  if p_org is null or p_actor is null then
    raise exception 'marca_da_organizacao_argumento_nulo'
      using errcode = '22023';
  end if;

  v_limpar := p_marca is null or jsonb_typeof(p_marca) = 'null';

  if not v_limpar and jsonb_typeof(p_marca) <> 'object' then
    raise exception 'marca_da_organizacao_forma_invalida: %', jsonb_typeof(p_marca)
      using errcode = '22023';
  end if;

  v_hex := nullif(p_marca ->> 'accent_hex', '');
  if v_hex is not null and v_hex !~ '^#[0-9a-f]{6}$' then
    raise exception 'marca_da_organizacao_accent_hex_invalido'
      using errcode = '22023';
  end if;

  if not exists (
       select 1 from public.user_organizations uo
        where uo.user_id = p_actor
          and uo.organization_id = p_org
          and uo.role = 'admin'
          and uo.revoked_at is null
     )
     and not exists (
       select 1 from public.platform_admins pa
        where pa.user_id = p_actor
          and pa.revoked_at is null
     )
  then
    raise exception 'marca_da_organizacao_sem_permissao'
      using errcode = '42501';
  end if;

  update public.organizations o
     set settings = case
           when v_limpar and coalesce(o.settings #>> '{branding,logo_path}', '') = ''
                and coalesce(o.settings #>> '{branding,logo_path_dark}', '') = ''
             then coalesce(o.settings, '{}'::jsonb) - 'branding'
           when v_limpar
             then jsonb_set(
                    coalesce(o.settings, '{}'::jsonb), '{branding}',
                    jsonb_build_object(
                      'logo_path', o.settings #> '{branding,logo_path}',
                      'logo_path_dark', o.settings #> '{branding,logo_path_dark}'
                    ), true)
           else jsonb_set(
                    coalesce(o.settings, '{}'::jsonb), '{branding}',
                    p_marca || jsonb_strip_nulls(
                      jsonb_build_object(
                        'logo_path', o.settings #> '{branding,logo_path}',
                        'logo_path_dark', o.settings #> '{branding,logo_path_dark}'
                      )), true)
         end
   where o.id = p_org;

  get diagnostics v_linhas = row_count;
  return v_linhas;
end;
$$;

comment on function public.fn_definir_marca_da_organizacao(uuid, uuid, jsonb) is
  'Grava organizations.settings.branding com merge ATÔMICO, PRESERVANDO branding.logo_path e branding.logo_path_dark (escritores próprios). Devolve linhas afetadas: 0 = a organização não existe. Chamador: app/actions/settings/updateMarcaDaOrganizacao.ts.';

-- ── REVOKES ───────────────────────────────────────────────────────────────

revoke execute on function public.fn_definir_logo_da_organizacao(uuid, uuid, text, text)
  from public, anon, authenticated;
grant  execute on function public.fn_definir_logo_da_organizacao(uuid, uuid, text, text)
  to service_role;

revoke execute on function public.fn_definir_marca_da_organizacao(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant  execute on function public.fn_definir_marca_da_organizacao(uuid, uuid, jsonb)
  to service_role;

notify pgrst, 'reload schema';


-- ── A coluna da INSTALAÇÃO ─────────────────────────────────────────────────

alter table public.platform_branding
  add column if not exists logo_path_dark text;

comment on column public.platform_branding.logo_path_dark is
  'Caminho do arquivo de logo para o tema ESCURO em storage/brand-logos, sempre platform/<uuid>.<png|jpg>. NULL = usa logo_path (light) nos dois temas. Escrito por app/api/v1/marca/logo/route.ts com variant=dark.';

update public.platform_branding
   set logo_path_dark = null
 where logo_path_dark is not null
   and logo_path_dark !~ '^platform/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$';

alter table public.platform_branding
  drop constraint if exists platform_branding_logo_path_dark;
alter table public.platform_branding
  add constraint platform_branding_logo_path_dark check (
    logo_path_dark is null
    or logo_path_dark ~ '^platform/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$'
  );

notify pgrst, 'reload schema';
