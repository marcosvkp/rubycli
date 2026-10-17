---
name: molang-eval
description: Escreve e depura expressões Molang sem confundir a linguagem com JavaScript.
tags: [minecraft, minecraft-modding]
---

# Molang

Descubra em qual arquivo e contexto a expressão roda (entidade, animation, render
controller, partículas ou bloco) e quais queries estão disponíveis ali. Consulte a
documentação oficial de sintaxe e versão. Molang não é JavaScript: respeite regras de
expressões, escopo, nomes de query e necessidade de `return` em blocos multi-statement.

Use `temp` para temporários e `variable` somente quando persistência daquele contexto for
intencional. Confira divisão por zero, valores inválidos, casing de strings e tipos. Faça
uma alteração mínima e valide JSON/schema; depois confira content log/runtime. Preview
estático não valida que a query exista no contexto do jogo.

Docs: https://learn.microsoft.com/minecraft/creator/documents/molang/syntax-guide
