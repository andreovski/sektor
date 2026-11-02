# Como escrever um módulo do Sektor

Português do Brasil em toda tela e comentário. Comentário só quando a regra não é óbvia.

## Regras

- Dinheiro em centavos inteiros. Datas sem hora são texto `AAAA-MM-DD`. "Hoje" vem de `todayIn(ctx)`.
- Toda tabela tem `id` (UUID v7, `stamp()`), `created_at`, `updated_at`, `deleted_at`. Apagar é marcar
  `deleted_at`, e toda consulta filtra `isNull(deletedAt)`. Índice único precisa aguentar a linha apagada.
- Sem `userId`: o app é de uma pessoa só.
- Nada de rede sem ser opcional e com a chave da pessoa. Nenhuma regra depende de IA.

## Núcleo: `packages/core/src/modules/<módulo>/`

- `schema.ts`: tabelas Drizzle. `index.ts`: exporta `handlers(ctx)` e `jobs`.
- Métodos do RPC com nome `area.acao` (`tasks.list`), recebem um objeto e devolvem JSON. Erro de regra é
  `throw new AppError(status, 'mensagem para a pessoa')` (`services/context.ts`).
- Valide a entrada com Zod e `parse` de `modules/finance`.
- Migração: SQL à mão em `packages/core/src/db/migrations/NNNN_nome.sql`, com o número reservado para o
  módulo. Não edite migrações existentes. O carregamento é automático.
- Testes: `<módulo>.spec.ts` ao lado, no molde de `services/finance.spec.ts` (banco real temporário).
  Rode com `pnpm --filter @sektor/core test`.

## Tela: `apps/desktop/src/renderer/modules/<módulo>/`

- `index.tsx` exporta `routes`. Dados por `useRpc('metodo', entrada)` e `useRpcMutation('metodo')` de
  `lib/rpc.ts`.
- Use as peças de `ui/index.tsx` e as cores de `ui/theme.css`. Sem cor fixa no código. Valores em
  `money()` de `lib/format.ts`. Telas em português, com estado vazio e de carregamento.
- Referência visual: o NEXO. Cabeçalho com `PageHeader`, abas com `Segmented`, cartões com `Card`,
  rótulos de seção com `SectionLabel`, botão principal `variant="primary"`.

## Conferir

```bash
pnpm --filter @sektor/core exec tsc -p .
pnpm --filter @sektor/core test
cd apps/desktop && pnpm exec tsc -p . && ../../node_modules/.bin/electron-vite build
perl -e 'alarm 60; exec @ARGV' node e2e/shot.mjs /tmp/tela.png /rota
```

O `shot.mjs` abre o app num banco vazio e temporário e fotografa a rota; um terceiro argumento aponta um
script que recebe a `page` do Playwright. Leia a imagem para conferir a tela.

## Limites

Mexa só nas pastas do seu módulo e no arquivo de migração reservado. Não faça commit, não rode
`pnpm add` e não toque em `app.ts`, `main.tsx`, `ui/` ou nos outros módulos. Precisa disso? Escreva no
relatório final.
