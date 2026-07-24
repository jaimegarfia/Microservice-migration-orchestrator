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

    assert.equal(result.mode, 'local');
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

test('Jira client creates a parent task followed by all standard subtasks', async () => {
  const requests = [];
  let issueNumber = 100;

  const client = new JiraClient({
    host: 'https://jira.example.com/',
    projectKey: 'MYPROJ',
    authBasic: 'encoded-credentials',
    fetchImplementation: async (url, options) => {
      requests.push({ url, options });
      issueNumber += 1;

      return jsonResponse({
        id: String(issueNumber),
        key: `MYPROJ-${issueNumber}`,
        self: `https://jira.example.com/rest/api/2/issue/${issueNumber}`
      });
    }
  });

  const parent = await client.createMigrationEpicOrTask('catalog');
  const subtasks = await client.createSubtasks(parent.key);

  assert.equal(parent.key, 'MYPROJ-101');
  assert.equal(subtasks.length, 8);
  assert.equal(requests.length, 9);
  assert.equal(requests[0].url, 'https://jira.example.com/rest/api/2/issue');
  assert.equal(requests[0].options.headers.Authorization, 'Basic encoded-credentials');

  const parentPayload = JSON.parse(requests[0].options.body);
  assert.deepEqual(parentPayload, {
    fields: {
      project: { key: 'MYPROJ' },
      summary: 'Migración Microservicio: catalog',
      issuetype: { name: 'Task' }
    }
  });

  const firstSubtaskPayload = JSON.parse(requests[1].options.body);
  assert.deepEqual(firstSubtaskPayload, {
    fields: {
      project: { key: 'MYPROJ' },
      summary: STANDARD_SUBTASKS[0],
      issuetype: { name: 'Sub-task' },
      parent: { key: 'MYPROJ-101' }
    }
  });
  assert.equal(subtasks[7].url, 'https://jira.example.com/browse/MYPROJ-109');
});

test('Jira client exposes a useful error when Jira rejects an issue', async () => {
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
    () => client.createMigrationEpicOrTask('catalog'),
    (error) => {
      assert.ok(error instanceof JiraRequestError);
      assert.equal(error.status, 403);
      assert.match(error.message, /Permission denied/);
      return true;
    }
  );
});
