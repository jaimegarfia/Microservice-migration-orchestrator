'use strict';

const AUTH_PROVIDERS = {
  ATLAS: {
    tokenUrl: 'https://security-dev.npapps.ocp.es.wcorp.carrefour.com/service-auth-server-v1/oauth/token?grant_type=client_credentials',
    authorization: 'Basic QVBMSUFQT0w6NFAwTDBDNFJSM0YwVVI='
  },
  AGORA: {
    tokenUrl: 'https://security-cua.npapps.ocp.es.wcorp.carrefour.com/service-auth-server-v1/oauth/token',
    authorization: 'Basic QVBMSUFHT1I6SHI0RjluN0g='
  }
};

class AuthenticationError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AuthenticationError';
    this.status = status;
  }
}

async function resolveEndpointAuthToken({
  authToken,
  environment = process.env,
  fetchImplementation = globalThis.fetch
} = {}) {
  if (typeof authToken === 'string' && authToken.trim()) {
    return authToken.trim();
  }

  if (typeof environment.AUTH_TOKEN === 'string' && environment.AUTH_TOKEN.trim()) {
    return environment.AUTH_TOKEN.trim();
  }

  const providerName = environment.AUTH_PROVIDER?.trim().toUpperCase();
  if (!providerName || providerName === 'CUSTOM') {
    return undefined;
  }

  const provider = AUTH_PROVIDERS[providerName];
  if (!provider) {
    throw new AuthenticationError(
      `AUTH_PROVIDER no compatible: ${providerName}. Usa ATLAS, AGORA o CUSTOM.`
    );
  }

  if (typeof fetchImplementation !== 'function') {
    throw new AuthenticationError(
      'No hay una implementación de fetch disponible para obtener el token OAuth2.'
    );
  }

  const authorization = environment[`${providerName}_AUTH_BASIC`]?.trim() ||
    provider.authorization;
  const tokenUrl = environment[`${providerName}_TOKEN_URL`]?.trim() ||
    provider.tokenUrl;

  let response;
  try {
    response = await fetchImplementation(tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: authorization,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
  } catch (cause) {
    throw new AuthenticationError(
      `No se pudo obtener el token OAuth2 de ${providerName}.`,
      { cause }
    );
  }

  const responseBody = await parseResponseBody(response);
  if (!response.ok) {
    throw new AuthenticationError(
      `El proveedor OAuth2 ${providerName} rechazó la autenticación (${response.status}).`,
      { status: response.status }
    );
  }

  const token = responseBody?.access_token;
  if (typeof token !== 'string' || !token.trim()) {
    throw new AuthenticationError(
      `El proveedor OAuth2 ${providerName} no devolvió access_token.`
    );
  }

  return token.trim();
}

async function parseResponseBody(response) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  try {
    return JSON.parse(await response.text());
  } catch {
    return null;
  }
}

module.exports = {
  AUTH_PROVIDERS,
  AuthenticationError,
  resolveEndpointAuthToken
};
