---
name: blockbench-model
description: Cria ou ajusta modelos, UVs, texturas e animações Minecraft via Blockbench ou MCP já configurado.
tags: [minecraft, minecraft-modding]
---

# Modelos Blockbench

Descubra formato de destino (Java, Bedrock, OptiFine, GeckoLib), versão, escala, pivots,
animações e estado dos arquivos. Se Blockbench MCP estiver configurado, use apenas as
ferramentas reais expostas e valide o modelo antes de exportar. Sem integração, produza ou
edite arquivos do projeto com cuidado; não presuma que o MCP está instalado.

Não use risky_eval ou execução arbitrária para tarefas de modelo quando tools declarativas
forem suficientes. Preserve cópia de modelos existentes e confirme mudanças destrutivas.
Crie textura original ou com licença apropriada, nunca copie assets vanilla nem texturas
de jogos comerciais. Depois confira hierarquia, UV, atlas e export format; preview não prova
render no jogo.

## Armaduras: guia visual e de textura

Antes de pintar, abra a textura e o modelo juntos e descubra a resolução, o layout UV,
quais regiões usam layer 1/layer 2 e onde ficam frente, costas, braços, pernas e botas.
Não aplique um desenho de referência sobre coordenadas UV presumidas. Preserve transparência
e pixels vazios que o jogo usa para revelar a roupa de baixo.

Planeje primeiro a silhueta em uma vista frontal. A leitura deve ser imediata mesmo em escala
pequena:

    elmo
    ombreiras
    peitoral / gola
    braços          braços
        cinto
    coxas / joelheiras
        grevas
        botas

Use este mapa de materiais como ponto de partida para uma armadura original de fantasia
heroica, com azul real, tecido azul-esverdeado e detalhes dourados. Ajuste os tons à
referência do usuário, sem copiar sprites ou texturas oficiais:

| Material | Sombra | Base | Luz |
| --- | --- | --- | --- |
| Aço azulado | #182638 | #315778 | #8BB8CA |
| Tecido azul | #183C55 | #286B83 | #71B9B2 |
| Ouro | #59401F | #C49A42 | #F1D77A |
| Couro | #35241E | #76503A | #B27A4D |

Mantenha aproximadamente 70% de material principal, 20% de material secundário e 10% de
acentos. Use contornos de sombra para separar peças que se encostam. Faça luz consistente
vindo do alto à esquerda: pixels de luz nas bordas superiores/esquerdas, sombra nas
inferiores/direitas e oclusão curta sob gola, placas, cinto e joelheiras.

Trabalhe em clusters de pixels deliberados: contorno, sombra, base, luz e um ou dois acentos
por material. Sem blur, gradientes longos, ruído aleatório ou linhas de um pixel repetidas
em toda a armadura. Em resolução baixa, aumente massas de cor antes de acrescentar costuras
e ornamentos. Ouro é filete ou rebite de destaque, não uma área grande competindo com o azul.

Distribua identidade entre peças: gola e emblema pequeno no peitoral; borda metálica nas
ombreiras; cinto separando tronco e pernas; joelheiras e botas com silhueta própria. Repita
a paleta e a espessura das bordas, não o mesmo emblema em todos os membros. Compare frente
e costas, braço esquerdo/direito e perna esquerda/direita; corrija espelhamento acidental,
costuras visíveis e detalhes que atravessam uma junta.

Depois de editar, verifique o PNG ampliado sem suavização e também no tamanho real do jogo.
Inspecione todas as faces no preview 3D e valide a textura no Minecraft quando o ambiente
permitir. Se não houver preview/render disponível, diga que a textura passou por revisão
estática e peça uma captura do jogo para o último ajuste visual.
