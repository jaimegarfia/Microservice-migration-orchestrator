'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildExecutionSummary,
  createProgressHandlers,
  runEndpointsBaselineWizard,
  runInteractiveWizard,
  runTasksWizard,
  selectEndpointSource,
  validateMicroserviceSlug
} = require('../src/commands/wizard');

function createPromptApi({
  text = [],
  select = [],
  confirm = [],
  password = []
} = {}) {
  const events = [];
  const spinnerEvents = [];
  const values = {
    text: toQueue(text),
    select: toQueue(select),
    confirm: toQueue(confirm),
    password: toQueue(password)
  };

  return {
    events,
    spinnerEvents,
    intro: (message) => events.push(['intro', message]),
    text: async () => values.text.shift(),
    select: async () => values.select.shift(),
    confirm: async () => values.confirm.shift(),
    password: async () => values.password.shift(),
    note: (message, title) => events.push(['note', title, message]),
    outro: (message) => events.push(['outro', message]),
    cancel: (message) => events.push(['cancel', message]),
    isCancel: () => false,
    spinner: () => ({
      start: (message) => spinnerEvents.push(['start', message]),
      stop: (message) => spinnerEvents.push(['stop', message])
    })
  };
}

function toQueue(value) {
  return Array.isArray(value) ? [...value] : [value];
}

test('wizard validates microservice names as lowercase slugs', () => {
  assert.equal(validateMicroserviceSlug('auth-service'), undefined);
  assert.match(validateMicroserviceSlug(''), /Indica el nombre/);
  assert.match(validateMicroserviceSlug('Auth Service'), /slug en minusculas/);
  assert.match(validateMicroserviceSlug('auth_service'), /slug en minusculas/);
});

test('main wizard launches the run pipeline from the zero-config menu', async () => {
  const promptApi = createPromptApi({
    select: 'run',
    text: ['/workspace/auth-service', 'https://api-migrada.example.com']
  });
  const calls = [];

  const result = await runInteractiveWizard({
    environment: {},
    currentDirectory: '/workspace',
    promptApi,
    runPipeline: async (directory, options) => {
      calls.push({ directory, options });
      return { microserviceName: 'auth-service', warnings: [] };
    }
  });

  assert.equal(result.microserviceName, 'auth-service');
  assert.equal(calls[0].directory, '/workspace/auth-service');
  assert.equal(calls[0].options.postBaseUrl, 'https://api-migrada.example.com');
  assert.ok(promptApi.events.some(([type]) => type === 'outro'));
});

test('task wizard falls back to local checklist when no Jira issue is provided', async () => {
  const promptApi = createPromptApi({ text: '', confirm: true });
  const calls = [];

  const result = await runTasksWizard({
    microserviceName: 'auth-service',
    environment: {},
    currentDirectory: '/workspace',
    promptApi,
    output: () => {},
    runInit: async (name, options) => {
      calls.push({ name, options });
      options.progress.onLocalStart();
      options.progress.onLocalCreated({
        historyPath: '/workspace/.axetrules/history/jira-tasks-auth-service.md'
      });
      return {
        mode: 'local',
        historyPath: '/workspace/.axetrules/history/jira-tasks-auth-service.md'
      };
    }
  });

  assert.equal(result.mode, 'local');
  assert.equal(calls[0].options.mode, 'local');
  assert.deepEqual(promptApi.spinnerEvents, [
    ['start', 'Generando checklist Markdown local...'],
    ['stop', 'Checklist guardado en /workspace/.axetrules/history/jira-tasks-auth-service.md']
  ]);
});

test('task wizard passes an existing Jira key to init without requesting credentials', async () => {
  const promptApi = createPromptApi({ text: 'https://jira.example.com/browse/MYPROJ-123', confirm: true });
  const calls = [];

  const result = await runTasksWizard({
    microserviceName: 'auth-service',
    environment: {},
    currentDirectory: '/workspace',
    promptApi,
    output: () => {},
    runInit: async (name, options) => {
      calls.push({ name, options });
      return {
        mode: 'jira-linked',
        issueKey: 'MYPROJ-123',
        envPath: '/workspace/.env'
      };
    }
  });

  assert.equal(result.mode, 'jira-linked');
  assert.equal(calls[0].name, 'auth-service');
  assert.equal(
    calls[0].options.jiraIssueKey,
    'https://jira.example.com/browse/MYPROJ-123'
  );
  assert.equal(calls[0].options.mode, 'auto');
  assert.ok(promptApi.events.some((event) => String(event[2]).includes('No se crearán')));
});

test('endpoint source selector lets users choose among discovered definitions', async () => {
  const promptApi = createPromptApi({ select: '/workspace/postman/service.json' });
  const selected = await selectEndpointSource({
    currentDirectory: '/workspace',
    promptApi,
    discoverSources: async () => [
      { type: 'file', path: '/workspace/docs/openapi.yaml' },
      { type: 'file', path: '/workspace/postman/service.json' }
    ]
  });

  assert.equal(selected, '/workspace/postman/service.json');
});

test('endpoint baseline wizard uses detected definition and password token', async () => {
  const promptApi = createPromptApi({
    text: 'https://api.example.com',
    password: 'temporary-token'
  });
  const calls = [];

  const result = await runEndpointsBaselineWizard({
    microserviceName: 'auth-service',
    environment: {},
    currentDirectory: '/workspace',
    promptApi,
    discoverSource: async () => ({
      path: '/workspace/docs/openapi.yaml'
    }),
    runBaseline: async (name, options) => {
      calls.push({ name, options });
      options.progress.onDiscovery({ total: 1 });
      options.progress.onEndpointStart({
        index: 1,
        total: 1,
        endpoint: { endpoint: '/health' }
      });
      options.progress.onEndpointComplete({
        index: 1,
        total: 1,
        result: { status: 200, responseTimeMs: 12 }
      });

      return { reportPath: '/workspace/.axetrules/history/run/endpoints-pre.json' };
    }
  });

  assert.equal(result.reportPath, '/workspace/.axetrules/history/run/endpoints-pre.json');
  assert.equal(calls[0].options.source, '/workspace/docs/openapi.yaml');
  assert.equal(calls[0].options.authToken, 'temporary-token');
  assert.deepEqual(promptApi.spinnerEvents, [
    ['start', 'Preparando 1 endpoints GET...'],
    ['start', 'Probando endpoint 1/1: /health'],
    ['stop', 'Endpoint 1/1: 200 (12 ms)']
  ]);
});

test('progress handlers communicate local checklist progress', () => {
  const events = [];
  const handlers = createProgressHandlers({
    start: (message) => events.push(['start', message]),
    stop: (message) => events.push(['stop', message])
  });

  handlers.onLocalStart();
  handlers.onLocalCreated({
    historyPath: '/workspace/.axetrules/history/jira-tasks-auth-service.md'
  });

  assert.deepEqual(events, [
    ['start', 'Generando checklist Markdown local...'],
    ['stop', 'Checklist guardado en /workspace/.axetrules/history/jira-tasks-auth-service.md']
  ]);
});

test('execution summary states the operation destination', () => {
  assert.match(buildExecutionSummary('auth-service', 'jira-linked'), /tarea Jira existente/);
  assert.match(buildExecutionSummary('auth-service', 'local'), /Markdown local/);
  assert.match(buildExecutionSummary('auth-service', 'jira-linked'), /No se crearán/);
});
