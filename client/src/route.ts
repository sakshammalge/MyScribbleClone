import { useCallback, useEffect, useState } from 'react';
import { isValidCode, normalizeCode } from '@inkling/shared';

/** Room code from an invite path like /r/K7M2Q, or null on any other path. */
export function codeFromPath(path: string): string | null {
  const match = /^\/r\/([^/]+)\/?$/i.exec(path);
  if (!match) return null;
  const code = normalizeCode(decodeURIComponent(match[1]!));
  return isValidCode(code) ? code : null;
}

export const invitePath = (code: string) => `/r/${code}`;
export const inviteUrl = (code: string) => `${window.location.origin}${invitePath(code)}`;

/** Tiny pathname router: enough for / and /r/:code without a dependency. */
export function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = useCallback((to: string) => {
    if (to !== window.location.pathname) window.history.pushState(null, '', to);
    setPath(to);
  }, []);
  return { path, go };
}
