'use strict';

const assert = require('node:assert/strict');
const { access, mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runInitCommand } = require('../src/commands/init');
const {
  extractJiraIssueKey,
  JiraConfigurationError
} = require('../src/services/jira');
const { STANDARD_SUBTASKS } = require('../src/utils/checklist');

test('init writes and returns the local checklist without Jira configuration', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'migration-cli-'));
  const output = [];

  try {
    const result = await runInitCommand('payments service', {
      environment: {},
      currentDirectory: directory,
      output: (message) => output.push(message)
    });

    const savedChecklist = await readFile(result.historyPath, 'utf8');
    const gitIgnore = await readFile(path.join(directory, '.gitignore'), 'utf8');

    assert.equal(result.mode, 'local');
    assert.equal(result.gitIgnore.created, true);
    assert.equal(result.gitIgnore.updated, true);
    assert.match(gitIgnore, /\.axetrules\//);
    assert.match(gitIgnore, /\.axet\//);
    assert.match(gitIgnore, /micro-migration\.md/);
    await assert.rejects(
      access(path.join(directory, '.env')),
      { code: 'ENOENT' }
    );
    await assert.rejects(
      access(path.join(directory, '.env.local')),
      { code: 'ENOENT' }
    );
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

test('extracts Jira issue references locally without making HTTP requests', () => {
  assert.equal(extractJiraIssueKey('evolcre4-1234'), 'EVOLCRE4-1234');
  assert.equal(
    extractJiraIssueKey(
      'https://jira.example.com/browse/EVOLCRE4-9876?focusedCommentId=42'
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
