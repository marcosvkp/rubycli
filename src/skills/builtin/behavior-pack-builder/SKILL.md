---
name: behavior-pack-builder
description: Cria behavior/resource packs Bedrock com manifests, entidades, blocos, itens e receitas versionados.
tags: [minecraft, minecraft-modding]
---

# Bedrock behavior/resource packs

Confirme plataforma Bedrock, versão mínima do engine e o que pertence ao Behavior Pack ou
Resource Pack. Inspecione o projeto antes de criar estrutura. Gere UUIDs novos para cada
header/module e mantenha as dependências entre packs consistentes; não reutilize UUIDs de
outro projeto.

Consulte os schemas e exemplos oficiais atuais para entidades, blocos, itens, recipes,
loot/spawn rules e manifest. Preserve `min_engine_version`, namespaces e identificadores.
Valide JSON, caminhos de assets e UUIDs; empacote `.mcaddon`/`.mcpack` apenas quando pedido.
Não copie nem distribua assets vanilla ou arquivos de packs de terceiros. Separe validação
estática de teste em um mundo real e registre experiments/requisitos quando aplicável.

Docs: https://learn.microsoft.com/minecraft/creator/ · schemas oficiais e vanilla reference.
