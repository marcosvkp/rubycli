---
name: mixin-helper
description: Analisa e cria Mixins com targets, mappings e requisitos verificáveis para a versão do projeto.
tags: [minecraft, minecraft-modding]
---

# Mixin helper

Antes de escrever um Mixin, procure um hook oficial do loader/API. Se Mixin for necessário,
confirme Minecraft, loader, mappings e dependências. Localize a assinatura real na fonte
gerada do projeto (`genSources`) ou em referência específica da versão; não adivinhe nome,
descriptor, ordinal ou ponto de injeção.

Use o injector mais estreito que funcione, explique o contrato esperado e configure
`require`/`expect` ou equivalente para falhar visivelmente quando o alvo mudar. Atualize
configuração, refmap e metadados conforme o loader. Considere lado cliente/servidor, ordem
dos Mixins e conflitos com outros mods.

Construa e rode o teste disponível. Informe o target exato e a evidência. Compile não prova
que o injector aplicou no runtime; não marque verificado sem conferir o log do jogo.
