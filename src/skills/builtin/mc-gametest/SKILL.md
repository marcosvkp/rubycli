---
name: mc-gametest
description: Escreve e executa GameTests para mods Java e organiza evidências do resultado.
tags: [minecraft, minecraft-modding]
---

# GameTest Java

Leia o loader, a versão e a configuração de testes do projeto antes de escrever. Use APIs
e annotations da versão-alvo; encontre exemplos no MDK/documentação oficial ou no próprio
projeto. Faça o teste determinístico, com setup mínimo, assertions sobre efeitos no mundo
e limpeza dos recursos que criou.

Execute a tarefa headless existente (por exemplo `runGameTestServer` se o loader oferecer),
usando o wrapper e argumentos já configurados. Não invente uma tarefa caso ela não exista.
O primeiro build pode baixar artefatos do jogo e levar tempo. Inspecione relatório e exit
code, não apenas a mensagem de “started”. Se não houver runtime compatível, entregue o
teste e identifique que ele não foi executado.

GameTest passado cobre só o cenário escrito. Não o apresente como validação de multiplayer,
renderização ou compatibilidade geral.
