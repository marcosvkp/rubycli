---
name: mcbe-json-ui-debug
description: Diagnostica JSON UI Bedrock, bindings, nomes de controles e erros no content log.
tags: [minecraft, minecraft-modding]
---

# Depurar JSON UI Bedrock

Reproduza o caminho da tela desde `_ui_defs.json` até o arquivo, namespace, elemento
herdado, `controls`, bindings e callbacks. Confirme que o identificador existe e que
referências respeitam namespace e versão. Verifique JSON/schema primeiro; depois compare
o fluxo e variáveis com exemplos oficiais/vanilla da mesma versão, sem copiar assets.

Se houver erro do content log, preserve a mensagem original e ligue-a ao arquivo/campo.
Teste uma alteração mínima de cada vez. Um renderizador estático ou schema não executa
bindings e callbacks do jogo; classifique como estático, preview ou runtime e nunca afirme
que resolveu um bug in-game sem reproduzi-lo no Minecraft.

Refs: JSON UI docs em https://learn.microsoft.com/minecraft/creator/reference/content/jsonuireference/examples/jsonuilist
