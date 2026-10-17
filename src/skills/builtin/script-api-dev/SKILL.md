---
name: script-api-dev
description: Desenvolve scripts TypeScript/JavaScript de add-ons Bedrock usando módulos Script API compatíveis.
tags: [minecraft, minecraft-modding]
---

# Bedrock Script API

Leia manifest, versão mínima do jogo, bundler e dependências. Confirme módulos e versões
disponíveis na documentação oficial atual; não fixe uma versão de `@minecraft/server` por
memória. Distinga pacote estável de beta/experimental e confira se o alvo é client, mundo
local ou Bedrock Dedicated Server.

Preserve UUIDs e campos de script module/entry point. Use tipos instalados que correspondem
ao manifest, compile TypeScript com a configuração existente e importe APIs suportadas no
contexto correto. Não use `@minecraft/server-net` ou APIs de admin sem confirmar ambiente,
estabilidade e disponibilidade.

Teste em runtime Bedrock quando houver ambiente; build TypeScript não prova que a API existe
no jogo. Relate dependências, experiments e limitações.

Refs: https://learn.microsoft.com/minecraft/creator/scriptapi/ e a seção oficial de TypeScript.
