---
name: server-rcon-bot
description: Planeja administração/testes de servidor Minecraft via RCON ou bot com limites e aprovação explícita.
tags: [minecraft, minecraft-modding]
---

# RCON e bot de servidor

Use somente quando o usuário especificar servidor, finalidade e comandos/ações. Detecte MCP
de Minecraft/bot já configurado; não instale nem conecte a um servidor descoberto por acaso.
RCON não cifra o tráfego em muitos setups: não envie senha em texto, args persistidos,
conversa ou logs. Use secret store/variável segura já configurada.

Comece com leitura/status. Para comando mutável, mostre o que será executado e peça
aprovação normal do RubyCLI. Restrinja área, duração, entidades e quantidade; não execute
`op`, comandos de console, comandos destrutivos ou ações de economia/permissão sem
confirmação específica. Para bots, respeite limites do servidor e não contorne proteção.

Reporte resposta da ferramenta como evidência da execução, não como validação do mod.
