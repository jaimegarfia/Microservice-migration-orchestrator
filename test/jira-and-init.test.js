'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runInitCommand } = require('../src/commands/init');
const { JiraClient, JiraRequestError } = require('../src/services/jira');
const { STANDARD_SUBTASKS } = require('../src/utils/checklist');

function jsonResponse(body, status = 201) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('init writes and returns the local checklist when Jira is not configured', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'migration-cli-'));
  const output = [];

  try {
    const result = await runInitCommand('payments service', {
      environment: {},
      currentDirectory: directory,
      output: (message) => output.push(message)
    });

    const savedChecklist = await readFile(result.historyPath, 'utf8');
    const environmentTemplate = await readFile(
      path.join(directory, '.env.example'),
      'utf8'
    );
    const environmentFile = await readFile(path.join(directory, '.env'), 'utf8');
    const gitIgnore = await readFile(path.join(directory, '.gitignore'), 'utf8');

    assert.equal(result.mode, 'local');
    assert.equal(result.gitIgnore.created, true);
    assert.equal(result.gitIgnore.updated, true);
    assert.match(gitIgnore, /\.axetrules\//);
    assert.match(gitIgnore, /\.axet\//);
    assert.match(gitIgnore, /micro-migration\.md/);
    assert.equal(result.environmentFiles.created, true);
    assert.equal(environmentFile, environmentTemplate);
    assert.match(environmentTemplate, /JIRA_PROJECT_KEY=EVOLCRE4/);
    assert.match(environmentTemplate, /AUTH_PROVIDER=ATLAS/);
    assert.match(result.historyPath, /jira-tasks-payments-service\.md$/);
    assert.equal(savedChecklist, result.checklist);
    assert.match(savedChecklist, /Migración Microservicio: payments service/);
    assert.equal(
      STANDARD_SUBTASKS.filter((title) => savedChecklist.includes(title)).length,
      8
    );
    assert.ok(output.some((message) => message.includes('checklist local')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Jira client validates the configured project without creating issues', async () => {
  const requests = [];
  const client = new JiraClient({
    host: 'https://jira.example.com/',
    projectKey: 'MYPROJ',
    authBasic: 'encoded-credentials',
    fetchImplementation: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({ key: 'MYPROJ', name: 'Migration Project' }, 200);
    }
  });

  const project = await client.validateConnection();

  assert.deepEqual(project, { key: 'MYPROJ', name: 'Migration Project' });
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    'https://jira.example.com/rest/api/2/project/MYPROJ'
  );
  assert.equal(requests[0].options.method, undefined);
  assert.equal(requests[0].options.headers.Authorization, 'Basic encoded-credentials');
});

test('Jira client exposes a useful error when project validation is rejected', async () => {
  const client = new JiraClient({
    host: 'https://jira.example.com',
    projectKey: 'MYPROJ',
    apiToken: 'token',
    fetchImplementation: async () =>
      jsonResponse(
        {
          errorMessages: ['Permission denied']
        },
        403
      )
  });

  await assert.rejects(
    () => client.validateConnection(),
    (error) => {
      assert.ok(error instanceof JiraRequestError);
      assert.equal(error.status, 403);
      assert.match(error.message, /Permission denied/);
      return true;
    }
  );
});
