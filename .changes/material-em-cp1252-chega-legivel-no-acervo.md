---
impacto: nada_mudou
secao: corrigido
titulo: Material .txt e .md salvo no Windows entra na base de conhecimento sem mojibake
---

Arquivo de texto salvo no Bloco de Notas — que grava em cp1252 (ANSI) por padrão, e é assim que quem monta a base de conhecimento no Windows escreve os `.txt` e `.md` — entrava no conhecimento do agente com cada acento virando U+FFFD — "Ação" entrava como "A��o". Não dava erro, não dava aviso: o material aparecia como pronto na tela, o índice era construído, e o agente passava a citar o texto corrompido para o cliente.

Agora a leitura dos bytes usa a mesma decisão de codificação que a importação de planilhas já usava (lê como UTF-8 e só troca para windows-1252 quando o arquivo prova não ser UTF-8), e material que não é texto — um `.xlsx` renomeado para `.md`, ou um `.txt` salvo como "Unicode" (UTF-16) — é recusado no envio com uma frase dizendo o que fazer, em vez de entrar como lixo. Material que já era UTF-8 entra exatamente como antes.
