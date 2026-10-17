---
name: mod-multi-version
description: Organiza suporte de um mod a múltiplas versões sem misturar APIs incompatíveis.
tags: [minecraft, minecraft-modding]
---

# Mod multi-versão

Liste as versões e loaders que o usuário quer suportar; não amplie o alvo por conta própria.
Inspecione branches, Gradle, mappings, dependências e CI. Procure Stonecutter ou estratégia
existente antes de introduzir ferramenta nova.

Defina uma matriz explícita de versão × loader × JDK. Isole código divergente em source sets,
patches ou módulos da ferramenta existente, mantendo pequena a lógica compartilhada. Não
suponha compatibilidade de registries, mappings, rendering, Java ou data formats entre
1.21.x e 26.x. Use hooks oficiais e mantenha cada configuração reproduzível.

Valide cada célula da matriz com sua tarefa de build/teste e relate as que não foram
executadas. Uma versão aprovada não prova suporte às demais.
