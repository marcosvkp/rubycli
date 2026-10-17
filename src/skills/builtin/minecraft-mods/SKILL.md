---
name: minecraft-mods
description: Coordena tarefas de mods e add-ons Minecraft escolhendo a skill correta por edição, loader e versão.
tags: [minecraft, minecraft-modding]
---

# Minecraft modding

Use esta skill como roteador para trabalho de Minecraft. Primeiro identifique a edição
(Java ou Bedrock), a versão-alvo, o loader ou plataforma, o objetivo e o estado do projeto.
Leia `gradle.properties`, manifests e arquivos de build antes de propor alterações. Não
assuma que um projeto para 1.21 funciona em 26.x nem que um add-on Bedrock usa Java.

Ative a skill especializada que melhor corresponde ao pedido: scaffold Fabric/NeoForge,
Gradle, GameTest, Mixins, datagen/worldgen, multi-versão, publicação, Bedrock packs,
Script API, Molang, partículas, NBT, JSON UI, Blockbench, Paper ou automação de servidor.
Se faltar uma decisão que altera a arquitetura (edição, versão ou loader), pergunte antes
de criar arquivos. Para tarefas pequenas, siga direto sem entrevista desnecessária.

Use ferramentas já disponíveis no projeto. Um nome de MCP citado numa skill não significa
que esteja instalado: descubra se existe antes de depender dele. Mantenha as aprovações
normais do RubyCLI; esta skill não autoriza comandos, instalações, acesso a servidor,
alterações destrutivas nem publicação.

Use documentação oficial e específica da versão. Separe o que foi validado por leitura,
build, teste headless e execução real no jogo. Nunca diga que o runtime foi verificado se
só houve validação estática.

## Referências

- Fabric: https://docs.fabricmc.net/develop/
- NeoForge: https://docs.neoforged.net/
- Bedrock Creator: https://learn.microsoft.com/minecraft/creator/
