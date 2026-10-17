---
name: mcbe-ui-flow-audit
description: Mapeia navegação entre telas JSON UI Bedrock e relações entre botões, mappings e formulários.
tags: [minecraft, minecraft-modding]
---

# Auditoria de fluxo JSON UI

Leia arquivos `ui/` e `_ui_defs.json`. Rastreie cada tela pelo namespace, elementos visíveis,
`button_mappings`, callbacks, `push_screen`/`pop_screen`, forms e dados de rota presentes
no projeto. Não infira destino só pelo nome do botão; siga a referência até a definição.

Entregue um mapa compacto em Mermaid com nós de tela e arestas rotuladas por ação, mais uma
lista de referências órfãs, rotas sem destino e ciclos suspeitos. Inclua o arquivo e a chave
que justificam cada aresta. Se o projeto só tiver amostras parciais, marque partes como
inferidas. Este mapa é análise estática; callbacks condicionais precisam de teste no jogo.
