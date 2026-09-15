---
impacto: capacidade_nova
secao: adicionado
titulo: Sync 1.24.0–1.27.2 do upstream — cadastro por convite, App da Meta na tela, agenda e voz
---

Sincronização com o upstream até a release 1.27.2 (lotes de triagem 6–10).
O que muda para quem opera a instalação:

- **Cadastro por convite (opcional):** em Admin › Cadastro dá para fechar a
  instalação (`so_convite`) — sem convite válido, o `/signup` recusa com tela.
  O padrão continua `aberto`, então quem não mexer não sente nada. A escolha
  vive no banco (`platform_settings`); o `.env` (`SIGNUP_MODE`) é só o piso
  para instalação que nunca abriu a tela.
- **App da Meta sai do `.env`:** App Secret e verify token do webhook agora se
  configuram em Admin › API Oficial (migration 0257), com verify token gerado
  no servidor e exibido uma vez. O `.env` segue como piso de rollback.
- **Agenda:** encaixe "Outro horário" no painel, ocupação do Google do dono
  visível para qualquer papel, lembretes em degraus, aniversário de contato e
  correções de trilha do seed de demonstração.
- **Voz:** número discável perguntado pela porta do canal, tela relê estado no
  409 e na queda.
- **Auditoria:** `api_audit_log` agora é append-only no schema (sem UPDATE,
  DELETE nem TRUNCATE pelos papéis do PostgREST) — quem lia a tabela para
  relatório não sente nada.

Nada exige ação manual: `update.sh` aplica baseline e migrations sozinho, e
nenhuma variável de ambiente nova é obrigatória (`SIGNUP_MODE` e
`CRON_SECRET` têm default e o segundo só serve ao cron da Vercel).
