---
name: worldgen-gen
description: Implementa biomas, features e estruturas de world generation para a versão do mod.
tags: [minecraft, minecraft-modding]
---

# World generation

Confirme edição, versão e loader. Leia registries já usados e consulte docs/source da versão
antes de escolher nomes de codec, campos ou ordem de bootstrap. Separe configured/placed
features, biome modifiers e estruturas conforme a API do loader. Gere IDs namespaced e
mantenha parâmetros coerentes (faixas Y, frequência, distribuição, biomas e custo).

Worldgen pode afetar saves existentes e desempenho. Prefira ambiente de teste novo ou backup
antes de gerar mundo. Execute datagen/build disponível e valide referências. Só declare a
geração correta após testar em runtime compatível: JSON válido ainda pode falhar no registry
freeze ou na criação do mundo.
