import net from 'node:net';
import path from 'node:path';
import session from 'express-session';
import sessionFileStore from 'session-file-store';
import * as oidc from 'openid-client';

export const IDLE_SESSION_MS = 24 * 60 * 60 * 1000;
export const ABSOLUTE_SESSION_MS = 7 * 24 * 60 * 60 * 1000;
export const OIDC_TRANSACTION_MS = 10 * 60 * 1000;

const FileStore = sessionFileStore(session);

function requireEnvironmentValue(environment, name) {
  const value = environment[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function isLoopbackHostname(hostname) {
  const normalizedHostname = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1).toLowerCase()
    : hostname.toLowerCase();

  if (normalizedHostname === 'localhost') {
    return true;
  }

  if (net.isIP(normalizedHostname) === 4) {
    return normalizedHostname.split('.')[0] === '127';
  }

  return normalizedHostname === '::1';
}

function parseUrl(value, name, { expectedPath, originOnly = false } = {}) {
  if (value.includes('\\')) {
    throw new Error(`${name} must not contain backslashes`);
  }

  if (value.includes('?') || value.includes('#')) {
    throw new Error(`${name} must not include a query or fragment`);
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }

  if (!value.toLowerCase().startsWith(`${parsedUrl.protocol}//`)) {
    throw new Error(`${name} must be an absolute URL`);
  }

  const authority = value.slice(value.indexOf('//') + 2).split('/')[0];

  if (authority.includes('@') || parsedUrl.username || parsedUrl.password) {
    throw new Error(`${name} must not include credentials`);
  }

  if (parsedUrl.protocol !== 'https:' && !isLoopbackHostname(parsedUrl.hostname)) {
    throw new Error(`${name} must use HTTPS unless it targets a loopback host`);
  }

  if (originOnly && parsedUrl.pathname !== '/') {
    throw new Error(`${name} must be an origin-only URL`);
  }

  if (expectedPath && parsedUrl.pathname !== expectedPath) {
    throw new Error(`${name} must use the ${expectedPath} path`);
  }

  return parsedUrl;
}

export function loadAuthConfig(environment = process.env) {
  const production = environment.NODE_ENV === 'production';
  const issuerUrl = parseUrl(
    requireEnvironmentValue(environment, 'OIDC_ISSUER_URL'),
    'OIDC_ISSUER_URL'
  ).toString();
  const callbackUrl = parseUrl(
    requireEnvironmentValue(environment, 'OIDC_CALLBACK_URL'),
    'OIDC_CALLBACK_URL',
    { expectedPath: '/auth/callback' }
  ).toString();
  const postLogoutUrl = parseUrl(
    requireEnvironmentValue(environment, 'OIDC_POST_LOGOUT_URL'),
    'OIDC_POST_LOGOUT_URL',
    { originOnly: true }
  ).toString();
  const sessionSecret = requireEnvironmentValue(environment, 'SESSION_SECRET');
  const cookieDomain = environment.SESSION_COOKIE_DOMAIN?.trim() || undefined;

  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters long');
  }

  if (production && !cookieDomain) {
    throw new Error('SESSION_COOKIE_DOMAIN is required in production');
  }

  if (production) {
    if (cookieDomain !== '.kaufmann.dev') {
      throw new Error('SESSION_COOKIE_DOMAIN must be .kaufmann.dev in production');
    }

    if (callbackUrl !== 'https://resume.kaufmann.dev/auth/callback') {
      throw new Error('OIDC_CALLBACK_URL must use the registered production callback URL');
    }

    if (postLogoutUrl !== 'https://resume.kaufmann.dev/') {
      throw new Error('OIDC_POST_LOGOUT_URL must use the registered production logout URL');
    }
  }

  return {
    issuerUrl,
    clientId: requireEnvironmentValue(environment, 'OIDC_CLIENT_ID'),
    clientSecret: requireEnvironmentValue(environment, 'OIDC_CLIENT_SECRET'),
    callbackUrl,
    postLogoutUrl,
    sessionSecret,
    cookieDomain,
    sessionStorePath: environment.SESSION_STORE_PATH?.trim() || '.sessions'
  };
}

export async function createOidcService(config, oidcClient = oidc) {
  const issuerUrl = parseUrl(String(config.issuerUrl), 'OIDC_ISSUER_URL');
  const discoveryOptions = issuerUrl.protocol === 'http:'
    ? { execute: [oidcClient.allowInsecureRequests] }
    : undefined;
  const clientConfig = await oidcClient.discovery(
    issuerUrl,
    config.clientId,
    undefined,
    oidcClient.ClientSecretBasic(config.clientSecret),
    discoveryOptions
  );
  const metadata = clientConfig.serverMetadata();

  if (!metadata.end_session_endpoint) {
    throw new Error('OIDC provider metadata must include end_session_endpoint');
  }

  if (
    Array.isArray(metadata.code_challenge_methods_supported)
    && !metadata.code_challenge_methods_supported.includes('S256')
  ) {
    throw new Error('OIDC provider must support PKCE S256');
  }

  return {
    async createAuthorizationRequest() {
      const codeVerifier = oidcClient.randomPKCECodeVerifier();
      const codeChallenge = await oidcClient.calculatePKCECodeChallenge(codeVerifier);
      const state = oidcClient.randomState();
      const nonce = oidcClient.randomNonce();
      const authorizationUrl = oidcClient.buildAuthorizationUrl(clientConfig, {
        redirect_uri: config.callbackUrl,
        scope: 'openid',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        nonce
      });

      return {
        authorizationUrl,
        codeVerifier,
        state,
        nonce
      };
    },

    async exchangeCallback(currentUrl, transaction) {
      const tokens = await oidcClient.authorizationCodeGrant(clientConfig, currentUrl, {
        pkceCodeVerifier: transaction.codeVerifier,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
        idTokenExpected: true
      });

      if (typeof tokens.id_token !== 'string' || !tokens.id_token) {
        throw new Error('OIDC callback did not return an ID token');
      }

      return { idTokenHint: tokens.id_token };
    },

    createLogoutUrl(idTokenHint) {
      return oidcClient.buildEndSessionUrl(clientConfig, {
        id_token_hint: idTokenHint,
        post_logout_redirect_uri: config.postLogoutUrl
      });
    }
  };
}

export function createFileSessionStore(config, baseDirectory) {
  const store = new FileStore({
    path: path.resolve(baseDirectory, config.sessionStorePath),
    ttl: Math.ceil(ABSOLUTE_SESSION_MS / 1000),
    reapInterval: 60 * 60,
    secret: config.sessionSecret,
    logFn(message) {
      if (!String(message).includes('ENOENT')) {
        console.error(message);
      }
    }
  });

  // express-session touches an unchanged session automatically. Idle renewal is
  // instead performed explicitly only by authenticated user-driven routes.
  store.touch = (_sessionId, _storedSession, callback) => callback?.();

  return store;
}

export function createSessionMiddleware(config, store) {
  return session({
    name: 'cv_resume_session',
    secret: config.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie: {
      domain: config.cookieDomain,
      httpOnly: true,
      maxAge: IDLE_SESSION_MS,
      sameSite: 'lax',
      secure: 'auto',
      path: '/'
    }
  });
}

export function regenerateSession(request) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

export function saveSession(request) {
  return new Promise((resolve, reject) => {
    request.session.save((error) => error ? reject(error) : resolve());
  });
}

export function destroySession(request) {
  return new Promise((resolve, reject) => {
    request.session.destroy((error) => error ? reject(error) : resolve());
  });
}
