---
name: bedrock-test
description: Planeja e executa testes de add-ons Bedrock com GameTest, BDS e content log.
tags: [minecraft, minecraft-modding]
---

# Testar add-ons Bedrock

Identifique versão, packs, dependências, experiments e ambiente. Prefira validação barata
primeiro: JSON/schema, UUIDs, paths e referências. Para comportamento, use GameTest ou BDS
somente se estiver instalado e configurado; não baixe/instale servidor nem aceite EULA sem
pedido explícito.

Separe testes de BP, RP, Script API, UI e multiplayer. Ative apenas os experiments
necessários em mundo descartável. Colete exit code, relatório e content log, distinguindo
warning de erro fatal. Se não houver runtime, entregue checklist e seja explícito que só
houve análise estática/build.

Docs: https://learn.microsoft.com/minecraft/creator/documents/gametestgettingstarted
