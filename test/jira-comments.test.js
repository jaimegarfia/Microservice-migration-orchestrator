'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, readFile, readdir, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildStationComment,
  runCommentCommand
} = require('../src/commands/comment');

test('builds the manual Station 0 Jira text with the required instructions', async () => {
  const comment = await buildStationComment('0');

  assert.match(comment, /^ESTACIÓN 0 SUPERADA/);
  assert.match(comment, /Rama migración: <URL_DE_LA_RAMA_BITBUCKET>/);
  assert.match(comment, /Para ATLAS:/);
  assert.match(comment, /Para AGORA:/);
  assert.match(comment, /Adjuntar capturas de pantalla de los endpoints PRE/);
  assert.doesNotMatch(comment, /JIRA_API_TOKEN|JIRA_AUTH_BASIC|JIRA_HOST/);
});

test('comment command prints and saves manual evidence without Jira configuration', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'manual-comment-'));
  const output = [];

  try {
    const result = await runCommentCommand('1', {
      currentDirectory: directory,
      environment: {
        JIRA_HOST: 'https://should-not-be-used.example.com',
        JIRA_API_TOKEN: 'should-not-be-used'
      },
      output: (message) => output.push(message)
    });

    const savedComment = await readFile(result.commentPath, 'utf8');
    const historyDirectories = await readdir(
      path.join(directory, '.axetrules', 'history')
    );

    assert.equal(result.station, '1');
    assert.equal(savedComment, `${result.commentMarkdown}\n`);
    assert.match(result.commentPath, /jira-comment-station-1\.md$/);
    assert.ok(historyDirectories.length > 0);
    assert.ok(output.some((message) => message.includes('ESTACIÓN 1 SUPERADA')));
    assert.ok(
      output.some((message) =>
        message.includes('Copia el contenido y pégalo manualmente')
      )
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('comment command does not require JIRA_ISSUE_KEY for Station 4', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'manual-comment-station4-'));

  try {
    const result = await runCommentCommand('4', {
      currentDirectory: directory,
      environment: {},
      output: () => {}
    });

    assert.equal(result.station, '4');
    assert.match(result.commentMarkdown, /ESTACIÓN 4 SUPERADA/);
    assert.match(result.commentMarkdown, /Resumen maestro/);
    assert.match(result.commentMarkdown, /Evidencia CAB/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
