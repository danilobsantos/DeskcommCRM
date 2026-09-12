-- 9007 — catálogo Gemini: remove mortos da 2.x, adiciona os lite da 3.x.
--
-- VERDADE MEDIDA em 2026-09-12 (docs oficiais do Google + página de
-- deprecações + 3 agregadores de preço concordando, salvo nota abaixo):
--   - `gemini-2.0-flash` — SHUT DOWN em 01/06/2026. Morto há 3 meses; quem
--     ainda o oferece entrega 404 ao cliente.
--   - `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.5-pro` — vivos,
--     aposentadoria anunciada para 20/10/2026 (5 semanas); o fórum do Google
--     já relata 404 precoce no 2.5-flash. Substitutos oficiais: 3.5-flash
--     (pro), 3.5-flash-lite ou 3.1-flash-lite (flash), 3.1-flash-lite (lite).
--   - `gemini-3.5-flash` (o default) e `gemini-3.1-pro-preview` — sem shutdown
--     anunciado. Default intocado.
--
-- Deprecar, NUNCA apagar: a linha continua referenciada pelo histórico de
-- custo (`ai_pricing` + `llm_calls`). `deprecated_at` some da tela e preserva
-- a contabilidade — a mesma regra do sincronizador OpenRouter.
--
-- Preços em CENTAVOS por milhão (unidade das duas tabelas):
--   - `gemini-3.1-flash-lite`: $0,25/$1,50 — unânime nas fontes.
--   - `gemini-3.5-flash-lite`: $0,15/$1,25 em duas tabelas, $0,30/$2,50 em
--     outras duas. Assumido o MENOR, declarado aqui e em `ai_pricing.notes`:
--     preço subestimado estoura o teto de orçamento CEDO (fail-safe); preço
--     superestimado deixa passar gasto. Rever quando o Google estabilizar.
--
-- Idempotente: updates condicionados + `on conflict do update`.
update public.ai_models set deprecated_at = now()
 where provider = 'google'
   and model_id in ('gemini-2.0-flash',
                    'gemini-2.5-flash',
                    'gemini-2.5-flash-lite',
                    'gemini-2.5-pro')
   and deprecated_at is null;

insert into public.ai_models
  (provider, model_id, display_name, description, context_window,
   input_price_per_million_cents, output_price_per_million_cents,
   supports_tools, supports_vision, released_at)
values
  ('google', 'gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite',
   'Substituto oficial do 2.0-flash; o piso de custo da geração 3 para alto volume.',
   1000000, 25, 150, true, true, '2026-05-07'),
  ('google', 'gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite',
   'Alto volume e baixa latência na geração 3.',
   1000000, 15, 125, true, true, '2026-07-21')
on conflict (provider, model_id) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  context_window = excluded.context_window,
  input_price_per_million_cents = excluded.input_price_per_million_cents,
  output_price_per_million_cents = excluded.output_price_per_million_cents,
  supports_tools = excluded.supports_tools,
  supports_vision = excluded.supports_vision,
  released_at = excluded.released_at,
  deprecated_at = null;

insert into public.ai_pricing
  (model, prompt_cents_per_million_tokens, completion_cents_per_million_tokens, notes)
values
  ('gemini-3.1-flash-lite', 25, 150, 'catálogo 9007'),
  ('gemini-3.5-flash-lite', 15, 125, 'catálogo 9007 — $0,15/$1,25 assumido, fontes divergem ($0,30/$2,50 em outras); rever')
on conflict (model) do update set
  prompt_cents_per_million_tokens = excluded.prompt_cents_per_million_tokens,
  completion_cents_per_million_tokens = excluded.completion_cents_per_million_tokens,
  notes = excluded.notes,
  superseded_at = null;
