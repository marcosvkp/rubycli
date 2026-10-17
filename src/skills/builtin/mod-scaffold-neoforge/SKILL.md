---
name: mod-scaffold-neoforge
description: Cria ou adapta um mod NeoForge com MDK e APIs compatíveis com a versão-alvo.
tags: [minecraft, minecraft-modding]
---

# Scaffold NeoForge

Confirme Java Edition, versão exata do Minecraft, JDK, `mod id`, package e se há projeto
existente. Consulte o MDK e os guias NeoForge atuais para decidir entre ModDevGradle e
NeoGradle; não copie configuração de Forge legado nem assuma que a API permaneceu igual
entre versões.

Em projeto novo, prefira o template/MDK oficial e trabalhe em diretório vazio. Em projeto
existente, preserve propriedades, mappings, plugins e source sets que já funcionam. Ajuste
`gradle.properties`, `settings.gradle`, `build.gradle`, metadados do mod e classe `@Mod`
usando registries e eventos suportados pela versão. Evite editar a estrutura do Gradle sem
necessidade.

Execute o wrapper local para validar configuração e compile; só execute cliente/servidor
se isso fizer parte do pedido e o ambiente permitir. Mostre os erros relevantes e não diga
que o mod funciona no jogo após apenas compilar.

Referência: https://docs.neoforged.net/ e o MDK oficial vinculado pela documentação.
