---
impacto: capacidade_nova
secao: corrigido
titulo: Avisos deixam de falhar com or= + RETURNING em PostgREST ≤14.3
---

Em Supabase com PostgREST ≤14.3 (pin v12.2.x do self-host), uma mutação que combinava filtro `or=` com retorno de linhas (`select=`) na mesma requisição devolvia `42703 column does not exist` para coluna que existe (corrigido upstream só no 14.4). Isso dava **500 ao marcar resolvido na Central de avisos** e travava em silêncio: o "marcar todos", o fechamento do aviso de orçamento, a reivindicação do export LGPD, a reivindicação do follow-up e o compare-and-set da leitura de assinatura e do checkout. As cadeias agora mandam o recorte em requisições disjuntas (`.is`/`.eq`/`.lt`) ou sem retorno, e a leitura de volta é um GET separado — funciona em qualquer versão do PostgREST. Sem migração e sem ação de quem opera; quem atualizar volta a marcar avisos como resolvido imediatamente.
