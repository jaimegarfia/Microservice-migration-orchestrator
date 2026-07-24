'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildExecutionSummary,
  createProgressHandlers,
  runEndpointsBaselineWizard,
  runInteractiveWizard,
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
  const textValues = toQueue(text);
  const selectValues = toQueue(select);
  const confirmValues = toQueue(confirm);
  const passwordValues = toQueue(password);

  return {
    events,
    spinnerEvents,
    intro: (message) => events.push(['intro', message]),
    text: async () => textValues.shift(),
    select: async () => selectValues.shift(),
    confirm: async () => confirmValues.shift(),
    password: async () => passwordValues.shift(),
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

test('wizard confirms and executes the local Markdown workflow', async () => {
  const promptApi = createPromptApi({
    text: 'auth-service',
    select: 'local',
    confirm: [true, false]
  });
  const calls = [];

  const result = await runInteractiveWizard({
    environment: {},
    promptApi,
    runInit: async (name, options) => {
      calls.push({ name, options });
      options.progress.onLocalStart({ microserviceName: name });
      options.progress.onLocalCreated({
        historyPath: '/tmp/jira-tasks-auth-service.md'
      });

      return {
        mode: 'local',
        historyPath: '/tmp/jira-tasks-auth-service.md'
      };
    }
  });

  assert.equal(result.mode, 'local');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'auth-service');
  assert.equal(calls[0].options.mode, 'local');
  assert.deepEqual(promptApi.spinnerEvents, [
    ['start', 'Generando checklist Markdown local...'],
    ['stop', 'Checklist guardado en /tmp/jira-tasks-auth-service.md']
  ]);
  assert.ok(
    promptApi.events.some(
      ([type, title]) => type === 'note' && title === 'Inicializacion completada'
    )
  );
});

test('wizard stops safely if Jira is selected without a Jira configuration', async () => {
  const promptApi = createPromptApi({
    text: 'auth-service',
    select: 'jira'
  });
  let executed = false;

  const result = await runInteractiveWizard({
    environment: {},
    promptApi,
    runInit: async () => {
      executed = true;
    }
  });

  assert.equal(result.mode, 'cancelled');
  assert.equal(executed, false);
  assert.ok(
    promptApi.events.some(
      ([type, title]) => type === 'note' && title === 'Jira necesita configuracion'
    )
  );
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
  assert.equal(calls[0].name, 'auth-service');
  assert.equal(calls[0].options.source, '/workspace/docs/openapi.yaml');
  assert.equal(calls[0].options.baseUrl, 'https://api.example.com');
  assert.equal(calls[0].options.authToken, 'temporary-token');
  assert.deepEqual(promptApi.spinnerEvents, [
    ['start', 'Preparando 1 endpoints GET...'],
    ['start', 'Probando endpoint 1/1: /health'],
    ['stop', 'Endpoint 1/1: 200 (12 ms)']
  ]);
});

test('progress handlers communicate parent and subtask progress', () => {
  const events = [];
  const handlers = createProgressHandlers({
    start: (message) => events.push(['start', message]),
    stop: (message) => events.push(['stop', message])
  });

  handlers.onParentStart();
  handlers.onParentCreated({ parent: { key: 'MYPROJ-1' } });
  handlers.onSubtaskStart({ index: 3, total: 8 });
  handlers.onSubtaskCreated({
    index: 3,
    total: 8,
    subtask: { key: 'MYPROJ-4' }
  });

  assert.deepEqual(events, [
    ['start', 'Conectando con Jira y creando tarea padre...'],
    ['stop', 'Tarea padre creada: MYPROJ-1'],
    ['start', 'Creando subtarea 3/8...'],
    ['stop', 'Subtarea 3/8 creada: MYPROJ-4']
  ]);
});

test('execution summary states the operation destination', () => {
  assert.match(buildExecutionSummary('auth-service', 'jira'), /en Jira/);
  assert.match(
    buildExecutionSummary('auth-service', 'local'),
    /Markdown local/
  );
});
