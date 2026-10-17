---
name: mcbe-attachables-geoui
description: Constrói e depura attachables, geometria, render controllers e animações de resource packs Bedrock.
tags: [minecraft, minecraft-modding]
---

# Attachables e GeoUI/geometry

Confirme se a tarefa é um attachable de item, geometria de entidade ou interface GeoUI de
terceiro; não trate os conceitos como intercambiáveis. Inspecione geometry identifiers,
bone hierarchy, material/texture, render controllers, animations e referências do pack.
Use schemas oficiais da versão e confira os identifiers em cadeia.

Prefira ferramentas Blockbench já configuradas para modelagem; valide export e paths antes
de editar manifest/attachable. Texturas devem ser próprias ou licenciadas. Use o content log
e runtime para confirmar render; um `.geo.json` válido pode ainda apontar para controller,
material ou atlas inexistente.

Docs e schemas: https://learn.microsoft.com/minecraft/creator/.
