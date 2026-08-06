'use strict';

const { DEFAULT_JIRA_PROJECT_KEY } = require('./environment');

class JiraConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JiraConfigurationError';
  }
}

class JiraRequestError extends Error {
  constructor(message, { status, responseBody, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'JiraRequestError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

class JiraClient {
  constructor({
    host,
    projectKey,
    authBasic,
    apiToken,
    fetchImplementation = globalThis.fetch
  }) {
    this.host = normalizeHost(host);
    this.projectKey = requiredValue(projectKey, 'JIRA_PROJECT_KEY');
    this.authorization = buildAuthorization({ authBasic, apiToken });
    this.fetch = fetchImplementation;

    if (typeof this.fetch !== 'function') {
      throw new JiraConfigurationError(
        'No hay una implementación de fetch disponible. Usa Node.js 18 o superior.'
      );
    }
  }

  static fromEnvironment(environment = process.env) {
    return new JiraClient({
      host: environment.JIRA_HOST,
      projectKey: environment.JIRA_PROJECT_KEY || DEFAULT_JIRA_PROJECT_KEY,
      authBasic: environment.JIRA_AUTH_BASIC,
      apiToken: environment.JIRA_API_TOKEN
    });
  }

  static isConfigured(environment = process.env) {
    return Boolean(
        environment.JIRA_HOST &&
        (environment.JIRA_PROJECT_KEY || DEFAULT_JIRA_PROJECT_KEY) &&
        (environment.JIRA_AUTH_BASIC || environment.JIRA_API_TOKEN)
    );
  }

  async validateConnection() {
    const response = await this.fetch(
      `${this.host}/rest/api/2/project/${encodeURIComponent(this.projectKey)}`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: this.authorization
        }
      }
    );
    const responseBody = await parseResponseBody(response);

    if (!response.ok) {
      throw new JiraRequestError(
        `No se pudo validar la conexión con Jira (${response.status}): ${getJiraErrorMessage(responseBody)}`,
        {
          status: response.status,
          responseBody
        }
      );
    }

    return {
      key: responseBody?.key || this.projectKey,
      name: responseBody?.name
    };
  }

  async postJiraComment(issueKey, commentMarkdown) {
    const key = extractJiraIssueKey(issueKey);
    if (typeof commentMarkdown !== 'string' || !commentMarkdown.trim()) {
      throw new JiraConfigurationError('El comentario de Jira no puede estar vacío.');
    }

    const response = await this.fetch(
      `${this.host}/rest/api/2/issue/${encodeURIComponent(key)}/comment`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: this.authorization
        },
        body: JSON.stringify({ body: commentMarkdown.trim() })
      }
    );
    const responseBody = await parseResponseBody(response);

    if (!response.ok) {
      throw new JiraRequestError(
        `Jira rechazó la publicación del comentario (${response.status}): ${getJiraErrorMessage(responseBody)}`,
        {
          status: response.status,
          responseBody
        }
      );
    }

    return {
      id: responseBody?.id,
      issueKey: key,
      body: commentMarkdown.trim(),
      self: responseBody?.self
    };
  }

}

function extractJiraIssueKey(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new JiraConfigurationError(
      'Debes indicar una clave o URL de incidencia Jira (por ejemplo EVOLCRE4-1234).'
    );
  }

  const candidate = value.trim();
  const directMatch = /^([A-Za-z][A-Za-z0-9_]*-\d+)$/i.exec(candidate);
  if (directMatch) {
    return directMatch[1].toUpperCase();
  }

  try {
    const url = new URL(candidate);
    const match = /(?:browse|issue|issues)\/([A-Za-z][A-Za-z0-9_]*-\d+)(?:[/?#]|$)/i
      .exec(`${url.pathname}${url.search}${url.hash}`);
    if (match) {
      return match[1].toUpperCase();
    }
  } catch {
    // A non-URL must be a valid Jira key and is handled by the error below.
  }

  const embeddedMatch = /(?:^|[/?#=&])([A-Za-z][A-Za-z0-9_]*-\d+)(?:$|[/?#&])/i
    .exec(candidate);
  if (embeddedMatch) {
    return embeddedMatch[1].toUpperCase();
  }

  throw new JiraConfigurationError(
    `No se pudo extraer JIRA_ISSUE_KEY de "${candidate}".`
  );
}

function normalizeHost(host) {
  const value = requiredValue(host, 'JIRA_HOST').replace(/\/+$/, '');

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('protocolo no compatible');
    }
  } catch {
    throw new JiraConfigurationError(
      'JIRA_HOST debe ser una URL absoluta HTTP(S), por ejemplo https://jira.example.com.'
    );
  }

  return value;
}

function requiredValue(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new JiraConfigurationError(`La variable ${name} es obligatoria.`);
  }

  return value.trim();
}

function buildAuthorization({ authBasic, apiToken }) {
  if (authBasic && authBasic.trim()) {
    const value = authBasic.trim();
    return value.toLowerCase().startsWith('basic ') ? value : `Basic ${value}`;
  }

  if (apiToken && apiToken.trim()) {
    return `Bearer ${apiToken.trim()}`;
  }

  throw new JiraConfigurationError(
    'Debes configurar JIRA_AUTH_BASIC o JIRA_API_TOKEN para autenticarte en Jira.'
  );
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

  const text = await response.text();
  return text || null;
}

function getJiraErrorMessage(responseBody) {
  if (!responseBody) {
    return 'sin detalle adicional';
  }

  if (typeof responseBody === 'string') {
    return responseBody;
  }

  const messages = [
    ...(responseBody.errorMessages || []),
    ...Object.values(responseBody.errors || {})
  ].filter(Boolean);

  return messages.length ? messages.join('; ') : JSON.stringify(responseBody);
}

module.exports = {
  extractJiraIssueKey,
  JiraClient,
  JiraConfigurationError,
  JiraRequestError
};
