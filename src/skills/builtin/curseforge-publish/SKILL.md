---
name: curseforge-publish
description: Prepara uma publicação CurseForge e valida requisitos sem expor credenciais.
tags: [minecraft, minecraft-modding]
---

# Publicar no CurseForge

Confirme se o destino é CurseForge e se o usuário quer apenas preparar ou realmente
publicar. Reúna ID do projeto, versão, game version, loader, changelog, dependências,
licença e artefato. Verifique a API/documentação e o fluxo vigentes; plugins antigos podem
estar arquivados ou incompatíveis.

Não procure credenciais em arquivos aleatórios. Use apenas `x-api-key` fornecida por canal
seguro e aprovada para esta tarefa; nunca a mostre, persista em JSONL ou commite. Faça
preflight de metadados/arquivo e solicite confirmação explícita antes do upload. Sem
credencial ou ferramenta configurada, deixe os artefatos prontos e informe o passo manual.

Registre separadamente build validado e publicação confirmada.

Docs: https://docs.curseforge.com/rest-api/
