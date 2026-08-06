'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runCommentCommand } = require('../src/commands/comment');
const { runInitCommand } = require('../src/commands/init');
const {
  extractJiraIssueKey,
  JiraClient,
  JiraConfigurationError
} = require('../src/services/jira');

function jsonResponse(body, status = 201) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('extracts Jira issue keys from direct keys and complex Jira URLs', () => {
  assert.equal(extractJiraIssueKey('evolcre4-1234'), 'EVOLCRE4-1234');
  assert.equal(
    extractJiraIssueKey(
      'https://umane.emeal.nttdata.com/jiraito/browse/EVOLCRE4-9876?focusedCommentId=42'
    ),
    'EVOLCRE4-9876'
  );
  assert.equal(
    extractJiraIssueKey(
      'https://jira.example.com/secure/ViewIssue.jspa?id=123&issue=CARRE_4-7'
    ),
    'CARRE_4-7'
  );
  assert.throws(
    () => extractJiraIssueKey('https://jira.example.com/browse/not-an-issue'),
    JiraConfigurationError
  );
});

test('posts a Markdown comment to the existing Jira issue', async () => {
  const requests = [];
  const client = new JiraClient({
    host: 'https://jira.example.com/',
    projectKey: 'EVOLCRE4',
    apiToken: 'secret-token',
    fetchImplementation: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({
        id: '30001',
        self: 'https://jira.example.com/rest/api/2/issue/EVOLCRE4-1234/comment/30001'
      });
    }
  });

  const comment = await client.postJiraComment(
    'https://jira.example.com/browse/EVOLCRE4-1234',
    '## Evidencia de migración — Estación 2'
  );

  assert.deepEqual(comment, {
    id: '30001',
    issueKey: 'EVOLCRE4-1234',
    body: '## Evidencia de migración — Estación 2',
    self: 'https://jira.example.com/rest/api/2/issue/EVOLCRE4-1234/comment/30001'
  });
  assert.equal(
    requests[0].url,
    'https://jira.example.com/rest/api/2/issue/EVOLCRE4-1234/comment'
  );
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer secret-token');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    body: '## Evidencia de migración — Estación 2'
  });
});

test('init links an existing Jira issue and persists only JIRA_ISSUE_KEY', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jira-link-'));

  try {
    await writeFile(
      path.join(directory, '.env'),
      'JIRA_HOST=https://jira.example.com\nJIRA_API_TOKEN=kept-secret\nOTHER_VALUE=kept\n',
      'utf8'
    );

    const result = await runInitCommand('catalog', {
      currentDirectory: directory,
      environment: {},
      output: () => {},
      ensureGitignore: async () => ({ updated: false }),
      ensureEnvironment: async () => ({ created: false }),
      generateWorkflow: async () => ({ workflowPath: 'micro-migration.md' }),
      jiraIssueKey: 'https://jira.example.com/browse/EVOLCRE4-222'
    });
    const environmentFile = await readFile(path.join(directory, '.env'), 'utf8');

    assert.equal(result.mode, 'jira-linked');
    assert.equal(result.issueKey, 'EVOLCRE4-222');
    assert.match(environmentFile, /^JIRA_ISSUE_KEY=EVOLCRE4-222$/m);
    assert.match(environmentFile, /^JIRA_API_TOKEN=kept-secret$/m);
    assert.match(environmentFile, /^OTHER_VALUE=kept$/m);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('comment command loads the linked Jira issue from .env and publishes station evidence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jira-comment-command-'));
  const output = [];
  const posted = [];

  try {
    await writeFile(
      path.join(directory, '.env'),
      [
        'JIRA_HOST=https://jira.example.com',
        'JIRA_PROJECT_KEY=EVOLCRE4',
        'JIRA_API_TOKEN=file-token',
        'JIRA_ISSUE_KEY=EVOLCRE4-333',
        ''
      ].join('\n'),
      'utf8'
    );

    const result = await runCommentCommand('1', {
      currentDirectory: directory,
      environment: {},
      output: (message) => output.push(message),
      jiraClientFactory: () => ({
        postJiraComment: async (issueKey, markdown) => {
          posted.push({ issueKey, markdown });
          return { id: '1', issueKey };
        }
      })
    });

    assert.equal(result.station, '1');
    assert.equal(posted[0].issueKey, 'EVOLCRE4-333');
    assert.match(posted[0].markdown, /Estación 1/);
    assert.ok(output.some((message) => message.includes('EVOLCRE4-333')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('comment command publishes CAB closure evidence for station 4', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jira-comment-station4-'));
  const posted = [];

  try {
    await writeFile(
      path.join(directory, '.env'),
      [
        'JIRA_HOST=https://jira.example.com',
        'JIRA_PROJECT_KEY=EVOLCRE4',
        'JIRA_API_TOKEN=file-token',
        'JIRA_ISSUE_KEY=EVOLCRE4-444',
        ''
      ].join('\n'),
      'utf8'
    );

    const result = await runCommentCommand('4', {
      currentDirectory: directory,
      environment: {},
      output: () => {},
      jiraClientFactory: () => ({
        postJiraComment: async (issueKey, markdown) => {
          posted.push({ issueKey, markdown });
          return { id: '4', issueKey };
        }
      })
    });

    assert.equal(result.station, '4');
    assert.equal(posted[0].issueKey, 'EVOLCRE4-444');
    assert.match(posted[0].markdown, /Estación 4/);
    assert.match(posted[0].markdown, /Resumen maestro/);
    assert.match(posted[0].markdown, /Evidencia CAB/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
