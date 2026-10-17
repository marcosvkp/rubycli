---
name: plugin-scaffold-paper
description: Cria ou adapta um plugin Paper para uma versão de servidor explicitamente selecionada.
tags: [minecraft, minecraft-modding]
---

# Plugin Paper

Confirme que o alvo é um plugin de servidor Paper/Spigot, não um mod Java ou add-on
Bedrock. Leia o build e `plugin.yml`/`paper-plugin.yml` existentes e descubra a versão do
Paper e o JDK. Consulte a documentação Paper atual para API, lifecycle, comandos e
permissões; não importe NMS sem pedido e justificativa.

Em projeto novo, crie estrutura mínima, metadados, classe principal e comportamento
demonstrável. Mantenha lógica fora da classe principal, registre comandos/listeners na API
correta e compile com o wrapper. Teste num servidor descartável somente quando disponível
e aprovado. Não afirme compatibilidade geral sem validar a matriz alvo.

Docs: https://docs.papermc.io/paper/dev/
