---
name: gradle-build
description: Investiga e executa builds e tarefas Gradle em projetos de mod Minecraft.
tags: [minecraft, minecraft-modding]
---

# Build Gradle para Minecraft

Inspecione `gradlew`/`gradlew.bat`, `settings.gradle`, plugins, `gradle.properties`, JDK
exigido e tarefas já declaradas. Use o wrapper do projeto, não instale nem substitua Gradle
global. Antes de rodar tarefas, explique quando elas baixam dependências grandes ou abrem
cliente/servidor; preserve a confirmação normal para comandos.

Escolha o menor alvo que responde à pergunta: `tasks`, `build`, `test`, `runClient`,
`runServer`, `genSources`, datagen ou GameTest, conforme loader e projeto. Em Windows, use
`gradlew.bat`; em Unix, `./gradlew`. Não presuma que tarefas de um loader existem em outro.
Capture o primeiro erro causal, arquivo/linha e tarefa que falhou.

Depois do build, verifique exit code e artefato em `build/libs`. Build bem-sucedido não
prova carregamento no Minecraft. Não edite o Gradle para esconder warning sem confirmar a
compatibilidade do plugin/JDK.
