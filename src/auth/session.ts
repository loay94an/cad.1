/**
 * Who is logged in. The server tells us how (GET api/config):
 * - no server reachable: local-only mode (plans stay on this device);
 * - auth enabled: OpenID Connect, Authorization Code + PKCE, with the
 *   provider from the server's settings (no secrets in the app);
 * - auth disabled (development only): pick a dev user, sent as X-Dev-User.
 */
import { reactive } from 'vue';
import { UserManager, WebStorageStateStore } from 'oidc-client-ts';

export interface ServerConfig {
  authEnabled: boolean;
  authority: string | null;
  clientId: string | null;
  scopes: string;
  devUsers?: string[];
}

export interface Me {
  id: string;
  name: string;
  email: string;
}

export const apiUrl = (path: string) => new URL(`api/${path}`, document.baseURI).toString();

const DEV_KEY = 'fp.devUser';

export const auth = reactive({
  /** False until init() has finished. */
  ready: false,
  /** A server answered api/config. */
  server: false,
  config: null as ServerConfig | null,
  me: null as Me | null,
  devUser: null as string | null,
  error: '',
});

let manager: UserManager | null = null;
let token: string | null = null;

/** The address the provider sends you back to: the app itself. */
const redirectUri = () => new URL('./', document.baseURI).toString();

/**
 * Silent renew without a refresh token runs the sign-in in a hidden iframe (prompt=none) that comes
 * back to the app's own address, so no extra redirect URI has to be registered. main.ts sees that it
 * is that iframe and only hands the answer to the parent page.
 */
export function isSilentRenewFrame(): boolean {
  if (window.parent === window) return false;
  const q = new URLSearchParams(location.search);
  if (!q.has('state') || !(q.has('code') || q.has('error'))) return false;
  try {
    // Only our own page starts it. A page that embeds the app (another origin) is not that.
    return (window.parent as unknown as Record<string, unknown>)[PARENT_MARK] === true;
  } catch {
    return false;
  }
}

export async function finishSilentRenew(): Promise<void> {
  // The callback only posts the URL to the parent; these settings are not used.
  await new UserManager({ authority: location.origin, client_id: 'silent', redirect_uri: location.href }).signinSilentCallback();
}

const PARENT_MARK = 'fpSilentRenewParent';

let renewing: Promise<boolean> | null = null;

/**
 * Get a fresh access token without leaving the page: with the refresh token, or else through the
 * provider's session in a hidden iframe. Returns false if you have to log in again.
 */
export function renewToken(): Promise<boolean> {
  if (!manager) return Promise.resolve(false);
  renewing ??= (async () => {
    const m = manager!;
    try {
      const u = await m.signinSilent();
      token = u?.access_token ?? null;
    } catch (e) {
      // A refused refresh token (expired, revoked, already used): try the provider's session once more.
      const u = await m.getUser().catch(() => null);
      if (u?.refresh_token) {
        try {
          u.refresh_token = undefined;
          await m.storeUser(u);
          token = (await m.signinSilent())?.access_token ?? null;
        } catch {
          token = null;
        }
      } else token = null;
      if (!token) console.warn('Silent renew failed', e);
    }
    if (!token) {
      await m.removeUser().catch(() => undefined);
      auth.me = null;
    }
    return !!token;
  })().finally(() => (renewing = null));
  return renewing;
}

/** Renew when the access token is about to expire. Timers sleep in a background tab or a closed PWA. */
async function renewIfExpiring() {
  if (!manager || renewing) return;
  const u = await manager.getUser().catch(() => null);
  if (u && (u.expires_in ?? 0) < 120) await renewToken();
}

/** Headers for an API call as the current user. */
export function authHeaders(): Record<string, string> {
  if (token) return { Authorization: `Bearer ${token}` };
  if (auth.devUser) return { 'X-Dev-User': auth.devUser };
  return {};
}

async function loadMe() {
  let res = await fetch(apiUrl('me'), { headers: authHeaders() });
  if (res.status === 401 && manager && (await renewToken())) res = await fetch(apiUrl('me'), { headers: authHeaders() });
  auth.me = res.ok ? ((await res.json()) as Me) : null;
}

export async function initAuth(): Promise<void> {
  try {
    const res = await fetch(apiUrl('config'));
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) throw new Error(`HTTP ${res.status}`);
    auth.config = (await res.json()) as ServerConfig;
    auth.server = true;
  } catch {
    auth.server = false; // no backend: local-only
    auth.ready = true;
    return;
  }

  const cfg = auth.config!;
  try {
    if (!cfg.authEnabled) {
      try {
        auth.devUser = localStorage.getItem(DEV_KEY);
      } catch {
        // storage unavailable
      }
      if (auth.devUser) await loadMe();
    } else if (cfg.authority && cfg.clientId) {
      manager = new UserManager({
        authority: cfg.authority,
        client_id: cfg.clientId,
        redirect_uri: redirectUri(),
        post_logout_redirect_uri: redirectUri(),
        silent_redirect_uri: redirectUri(),
        response_type: 'code',
        scope: cfg.scopes || 'openid profile email',
        automaticSilentRenew: true,
        silentRequestTimeoutInSeconds: 15,
        userStore: new WebStorageStateStore({ store: window.localStorage }),
      });
      (window as unknown as Record<string, unknown>)[PARENT_MARK] = true;
      manager.events.addUserLoaded((u) => {
        token = u.access_token;
      });
      manager.events.addUserUnloaded(() => {
        token = null;
        auth.me = null;
      });
      // The automatic renew failed or came too late: try once more before giving up.
      manager.events.addAccessTokenExpired(() => void renewToken());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void renewIfExpiring();
      });
      addEventListener('online', () => void renewIfExpiring());
      const q = new URLSearchParams(location.search);
      if (q.has('code') && q.has('state')) {
        // Back from the provider: finish signing in and clean the address bar.
        const u = await manager.signinRedirectCallback();
        token = u.access_token;
        const back = (u.state as string | undefined) ?? '';
        history.replaceState(null, '', redirectUri() + back);
      } else {
        const u = await manager.getUser();
        if (u && !u.expired) token = u.access_token;
        // Back after the access token expired (the app was closed): renew instead of logging out.
        else if (u) await renewToken();
      }
      if (token) await loadMe();
    }
  } catch (e) {
    auth.error = `Sign-in failed: ${e instanceof Error ? e.message : e}`;
  }
  auth.ready = true;
}

export async function login(devUser?: string) {
  if (auth.config && !auth.config.authEnabled) {
    auth.devUser = devUser ?? auth.config.devUsers?.[0] ?? 'dev';
    try {
      localStorage.setItem(DEV_KEY, auth.devUser);
    } catch {
      // storage unavailable
    }
    await loadMe();
    return;
  }
  await manager?.signinRedirect({ state: location.hash });
}

export async function logout() {
  if (auth.config && !auth.config.authEnabled) {
    auth.devUser = null;
    auth.me = null;
    try {
      localStorage.removeItem(DEV_KEY);
    } catch {
      // storage unavailable
    }
    return;
  }
  token = null;
  auth.me = null;
  await manager?.signoutRedirect().catch(() => manager?.removeUser());
}
