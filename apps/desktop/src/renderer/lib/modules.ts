import type { Rpc } from '@sektor/core';

import { useRpc } from './rpc';

export type ModuleId = ReturnType<Rpc['modules.get']>['disabled'][number];

/** Enquanto a lista não chega, tudo conta como ligado: o dock não pisca vazio na abertura. */
export function useModules() {
  const disabled = useRpc('modules.get').data?.disabled ?? [];
  return { disabled, isOn: (id: ModuleId | undefined) => !id || !disabled.includes(id) };
}
