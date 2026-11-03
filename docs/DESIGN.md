# Visual do Sektor

Dois modos, Escuro (padrão) e Claro, combinados com seis paletas: Floresta (padrão), Papel, Oceano,
Ameixa, Rosé e Grafite. Tudo se escolhe em Ajustes › Aparência e fica em `lib/theme.ts`, no
`localStorage`. As cores estão em `apps/desktop/src/renderer/ui/theme.css` e as peças em
`ui/index.tsx`.

Uma paleta é um bloco `[data-palette='…']` só com matizes e intensidades (fundo, primária e
secundária); quanto de luz cada token tem é do modo. Paleta nova entra nesse arquivo, em `PALETTES`
e em `e2e/theme-contrast.mjs`, que mede o contraste WCAG de cada combinação.

- Dock flutuante embaixo, topo sem barra, conteúdo em até 1180 px.
- Início com capa de pixels, saudação e caixa de captura; seções com rótulo pequeno e maiúsculo.
- Cartões com borda fina, raio de 16 px, cabeçalho com ícone e link discreto.
- Botão principal verde com brilho; secundário em contorno.
- Modais com cabeçalho separado do conteúdo, que repete o ícone do módulo aberto.
- Troca de tela por View Transition, na direção em que o dock andou; o dock fica parado e o modal
  anima ao abrir e ao fechar. Tudo respeita o movimento reduzido do sistema.
