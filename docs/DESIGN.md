# Visual do Sektor

Tema verde em duas variações, Escuro (padrão) e Claro, escolhidas em Ajustes › Aparência. As cores
ficam em `apps/desktop/src/renderer/ui/theme.css`, as peças em `ui/index.tsx`, e a escolha em
`lib/theme.ts`, no `localStorage`. Toda cor vem de token, então um tema novo é só outro bloco
`:root[data-theme='…']`, com o `--cover-from` e o `--cover-to` da capa do Início.

- Dock flutuante embaixo, topo sem barra, conteúdo em até 1180 px.
- Início com capa de pixels, saudação e caixa de captura; seções com rótulo pequeno e maiúsculo.
- Cartões com borda fina, raio de 16 px, cabeçalho com ícone e link discreto.
- Botão principal verde com brilho; secundário em contorno.
- Modais com cabeçalho separado do conteúdo, que repete o ícone do módulo aberto.
- Troca de tela por View Transition, na direção em que o dock andou; o dock fica parado e o modal
  anima ao abrir e ao fechar. Tudo respeita o movimento reduzido do sistema.
