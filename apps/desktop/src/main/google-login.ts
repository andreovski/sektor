import { loopbackLogin } from '@sektor/core/src/modules/google/oauth';
import { shell } from 'electron';

import type { GoogleLoginResult } from '../preload/api';

import { ask } from './core-process';

let running: AbortController | null = null;

export const cancelGoogleLogin = () => running?.abort();

/** Um login por vez: pedir de novo substitui o que estava esperando o navegador. */
export async function googleLogin(
  core: Electron.UtilityProcess,
  hint?: string
): Promise<GoogleLoginResult> {
  if (!__GOOGLE_CLIENT_ID__) return { status: 'not-configured' };
  running?.abort();
  const controller = new AbortController();
  running = controller;
  try {
    const result = await loopbackLogin({
      clientId: __GOOGLE_CLIENT_ID__,
      hint,
      signal: controller.signal,
      open: (url) => shell.openExternal(url),
    });
    if (result.status === 'failed') {
      return { status: 'error', message: 'Não deu para abrir o navegador.' };
    }
    if (result.status !== 'ok') return { status: result.status };
    const { code, verifier, redirectUri } = result;
    const { email } = await ask<{ email: string }>(core, {
      type: 'google-connect',
      code,
      verifier,
      redirectUri,
    });
    return { status: 'ok', email };
  } catch (error) {
    return { status: 'error', message: (error as Error).message };
  } finally {
    if (running === controller) running = null;
  }
}
