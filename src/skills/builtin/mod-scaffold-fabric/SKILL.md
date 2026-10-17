---
name: mod-scaffold-fabric
description: Cria ou entende a estrutura inicial de um mod Fabric para uma versão Java Edition definida.
tags: [minecraft, minecraft-modding]
---

# Scaffold Fabric

1. Confirme Minecraft Java Edition, versão-alvo, nome, `mod id`, package Java e se o
   usuário quer um projeto novo ou alterações no existente. Não sobrescreva uma pasta.
2. Consulte o gerador e a documentação oficial do Fabric para aquela versão. Descubra
   versões compatíveis de Loader, Fabric API, Loom e JDK; não reutilize números antigos
   de memória.
3. Prefira o template oficial/generator quando o projeto for novo. Se clonar template,
   clone em diretório vazio e confirme antes de criar outro repositório.
4. Ajuste `gradle.properties`, `settings.gradle`, `build.gradle`, `fabric.mod.json`,
   entrypoints, package e identificadores sem deixar `example-mod` residual.
5. Faça uma alteração mínima demonstrável, construa com o wrapper e reporte o artefato em
   `build/libs` e qualquer requisito de IDE/JDK.

Referências: https://docs.fabricmc.net/develop/getting-started/creating-a-project e
https://docs.fabricmc.net/develop/getting-started/project-structure. A documentação muda
entre versões. Não embuta assets vanilla nem código de mods de terceiros.
