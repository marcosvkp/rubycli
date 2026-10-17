---
name: mcbe-json-ui
description: Desenha ou implementa telas JSON UI em resource packs Bedrock seguindo arquivos e versão reais do projeto.
tags: [minecraft, minecraft-modding]
---

# Bedrock JSON UI

Confirme a versão Bedrock, pack de destino, tela/fluxo desejado e se o usuário controla o
resource pack. Inspecione `manifest.json`, `_ui_defs.json`, arquivos `ui/`, namespaces,
bindings e controles existentes antes de editar. Preserve arquivos-base e faça mudanças em
cópia de trabalho do pack.

Consulte referências/schema oficiais e exemplos compatíveis com a versão. Respeite
`namespace`, herança `@`, controles, variáveis/bindings e paths. Alterar UI vanilla pode
ser frágil entre versões; prefira novos elementos namespaced e sobrescritas pequenas.
Valide JSON e inclusão em `_ui_defs.json`; procure IDs duplicados e referências inexistentes.

Use vanilla packs só como leitura de referência, sem copiar assets para redistribuir. Diga
“preview/validação estática” quando ainda não foi testado no runtime do Bedrock.

Refs: https://learn.microsoft.com/minecraft/creator/reference/content/jsonuireference/examples/jsonuilist
· https://learn.microsoft.com/minecraft/creator/reference/content/jsonuireference/examples/jsonuicomponents/ui_screen
