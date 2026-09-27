-- 9009 — LOGO ESCURO UNIFICA O NOME (`logo_path_dark` → `logo_dark_path`).
--
-- A dev guardava a arte do tema escuro em `logo_path_dark` (9001, instalação +
-- organização); a main criou `logo_dark_path` (0406) para o mesmo propósito, com
-- o molde melhor (tema como parâmetro, permissão e guarda de escopo no banco).
-- O merge adota os nomes da main em todo o código — então quem já subiu arte
-- escura na dev a perderia em silêncio (leitura nova não enxerga coluna velha).
--
-- Cópia UMA vez, só onde o destino está vazio: instalação que nunca usou o
-- escuro não tem nada para mover (zero linhas tocadas); quem usou mantém a
-- arte. A coluna/fonte antiga NÃO é removida: rollback de imagem precisa dela
-- (o `agent.sh` reverte só a imagem, e código antigo lê o nome antigo).
-- Idempotente: reaplicar não muda nada (os WHEREs só casam o que falta).

-- Instalação: `platform_branding.logo_path_dark` → `logo_dark_path`.
-- O formato já é o mesmo (os dois CHECKs exigem `platform/<uuid>.(png|jpg)`),
-- então a cópia nunca viola a constraint da 0406.
update public.platform_branding
   set logo_dark_path = logo_path_dark
 where logo_dark_path is null
   and logo_path_dark is not null;

-- Organização: `settings.branding.logo_path_dark` → `logo_dark_path`.
-- Só onde o destino falta; `null` explícito no destino conta como presente
-- (foi escolha, não ausência).
update public.organizations o
   set settings = jsonb_set(
     coalesce(o.settings, '{}'::jsonb),
     '{branding,logo_dark_path}',
     to_jsonb(o.settings #>> '{branding,logo_path_dark}'),
     true
   )
 where o.settings #>> '{branding,logo_path_dark}' is not null
   and o.settings #>> '{branding,logo_dark_path}' is null;

notify pgrst, 'reload schema';
