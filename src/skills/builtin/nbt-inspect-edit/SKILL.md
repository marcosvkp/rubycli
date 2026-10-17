---
name: nbt-inspect-edit
description: Inspeciona ou edita NBT/SNBT com formato e endianess corretos para Java ou Bedrock.
tags: [minecraft, minecraft-modding]
---

# NBT inspect/edit

Determine se a entrada é Java NBT, Bedrock NBT, SNBT, região ou outro container antes de
decodificar. Confira compression, endianess, versão e library/CLI disponível. Preserve uma
cópia antes de qualquer escrita, especialmente em arquivos de mundo/região; não altere
diretamente o save em uso.

Mostre primeiro um resumo/árvore e confirme o alvo exato da mudança. Edite só os tags
solicitados, valide tipos, comprimentos e referências, serialize para arquivo temporário e
reabra para conferir round-trip antes de substituir qualquer original. Não instale pacotes
nem escreva no mundo sem aprovação. Relate limitações da ferramenta para aquela variante.
