---
name: recipe-datagen
description: Cria ou corrige recipes, loot tables, advancements e tags Java compatíveis com o loader e a versão.
tags: [minecraft, minecraft-modding]
---

# Data generation

Descubra loader e versão no projeto. Verifique se ele usa Fabric Data Generation, NeoForge
datagen ou JSON manual; preserve a abordagem existente. Consulte schemas e exemplos da
mesma versão. Para cada recipe, loot, advancement ou tag, confira namespace, IDs referidos,
conditions e paths esperados pelo jogo.

Prefira generators tipados quando o projeto já os usa. Execute a tarefa de geração existente
e revise o diff dos arquivos produzidos; não apague customizações sem comparar. Valide JSON
e referências cruzadas. Se o repo tiver dados vanilla pinados, use-os como referência de
versão, não como conteúdo para redistribuir.

Reporte separadamente validação de arquivo, build e verificação dentro do jogo.
