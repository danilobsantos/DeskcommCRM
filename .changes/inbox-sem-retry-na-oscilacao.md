---
impacto: nada_mudou
secao: corrigido
titulo: Inbox para de multiplicar requests quando o banco oscila
---

Com o banco lento por alguns segundos, a tela do inbox entrava em tempestade de requests idênticos (milhares medidos) até parar de carregar: cada poll de contadores e cada recarga da lista tentava de novo 3 vezes por padrão, e o ciclo recomeçava a cada 30 segundos e a cada evento do Realtime. Os dois hooks agora não retentam (`retry: false`, na convenção dos demais hooks da tela): um ciclo falho mostra o aviso uma vez e a tela se recupera no ciclo seguinte, em vez de realimentar a lentidão. Nada muda em dia normal — poll de 30 segundos, Realtime e recarga ao voltar para a aba continuam iguais.
