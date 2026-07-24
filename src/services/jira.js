'use strict';

const {
  STANDARD_SUBTASKS,
  validateMicroserviceName
} = require('../utils/checklist');

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
    issueType = 'Task',
    subtaskIssueType = 'Sub-task',
    fetchImplementation = globalThis.fetch
  }) {
    this.host = normalizeHost(host);
    this.projectKey = requiredValue(projectKey, 'JIRA_PROJECT_KEY');
    this.authorization = buildAuthorization({ authBasic, apiToken });
    this.issueType = issueType;
    this.subtaskIssueType = subtaskIssueType;
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
      projectKey: environment.JIRA_PROJECT_KEY,
      authBasic: environment.JIRA_AUTH_BASIC,
      apiToken: environment.JIRA_API_TOKEN,
      issueType: environment.JIRA_ISSUE_TYPE || 'Task',
      subtaskIssueType: environment.JIRA_SUBTASK_ISSUE_TYPE || 'Sub-task'
    });
  }

  static isConfigured(environment = process.env) {
    return Boolean(
      environment.JIRA_HOST &&
        environment.JIRA_PROJECT_KEY &&
        (environment.JIRA_AUTH_BASIC || environment.JIRA_API_TOKEN)
    );
  }

  async createMigrationEpicOrTask(microserviceName) {
    const serviceName = validateMicroserviceName(microserviceName);

    return this.createIssue({
      summary: `Migración Microservicio: ${serviceName}`,
      issueType: this.issueType
    });
  }

  async createSubtasks(
    parentKey,
    { onSubtaskStart = () => {}, onSubtaskCreated = () => {} } = {}
  ) {
    if (typeof parentKey !== 'string' || !parentKey.trim()) {
      throw new Error('La clave de la tarea padre de Jira es obligatoria.');
    }

    const createdSubtasks = [];

    for (const [index, summary] of STANDARD_SUBTASKS.entries()) {
      try {
        onSubtaskStart({
          index: index + 1,
          total: STANDARD_SUBTASKS.length,
          summary
        });

        const subtask = await this.createIssue({
          summary,
          issueType: this.subtaskIssueType,
          parentKey: parentKey.trim()
        });

        createdSubtasks.push(subtask);
        onSubtaskCreated({
          index: index + 1,
          total: STANDARD_SUBTASKS.length,
          summary,
          subtask
        });
      } catch (error) {
        throw new JiraRequestError(
          `No se pudieron crear todas las subtareas. Se crearon ${createdSubtasks.length} de ${STANDARD_SUBTASKS.length}.`,
          {
            cause: error,
            status: error.status,
            responseBody: error.responseBody
          }
        );
      }
    }

    return createdSubtasks;
  }

  async createIssue({ summary, issueType, parentKey }) {
    const fields = {
      project: { key: this.projectKey },
      summary,
      issuetype: { name: issueType }
    };

    if (parentKey) {
      fields.parent = { key: parentKey };
    }

    const response = await this.fetch(`${this.host}/rest/api/2/issue`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: this.authorization
      },
      body: JSON.stringify({ fields })
    });

    const responseBody = await parseResponseBody(response);

    if (!response.ok) {
      throw new JiraRequestError(
        `Jira rechazó la creación de la incidencia (${response.status}): ${getJiraErrorMessage(responseBody)}`,
        {
          status: response.status,
          responseBody
        }
      );
    }

    if (!responseBody || !responseBody.key) {
      throw new JiraRequestError(
        'Jira respondió correctamente, pero no incluyó la clave de la incidencia creada.',
        { status: response.status, responseBody }
      );
    }

    return {
      id: responseBody.id,
      key: responseBody.key,
      self: responseBody.self,
      url: `${this.host}/browse/${encodeURIComponent(responseBody.key)}`
    };
  }
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
  JiraClient,
  JiraConfigurationError,
  JiraRequestError
};
