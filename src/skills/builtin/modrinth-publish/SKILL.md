---
name: modrinth-publish
description: Prepara ou publica um mod/modpack no Modrinth com metadados e autenticação seguros.
tags: [minecraft, minecraft-modding]
---

# Publicar no Modrinth

Use para pedidos de preparar/publicar. Confirme que o usuário quer publicar agora; nunca
transforme “prepare” em upload. Identifique artefato, projeto, versão, game versions,
loaders, changelog, licença, dependências e hashes. Confira que o arquivo contém o mod real
e não assets de jogo proibidos.

Prefira plugin, CLI ou MCP já configurado no projeto. Para API, consulte a documentação
Labrinth atual, use `User-Agent` identificável e token vindo de armazenamento seguro/env
aprovado. Nunca imprima, persista em sessão, commite ou grave o token em logs. Revise campos
e peça aprovação explícita imediatamente antes de criar/uploadar a versão.

Reporte ID/link e status retornado pela API. Build local não confirma publicação.

Docs: https://docs.modrinth.com/api/
