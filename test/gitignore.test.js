'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  BLOCK_END,
  BLOCK_START,
  DEFAULT_IGNORED_ENTRIES,
  ensureGitIgnore,
  updateGitIgnoreContent
} = require('../src/services/gitignore');

test('creates a managed .gitignore block with every default protected entry', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gitignore-create-'));

  try {
    const result = await ensureGitIgnore(directory);
    const content = await readFile(result.gitIgnorePath, 'utf8');

    assert.equal(result.created, true);
    assert.equal(result.updated, true);
    assert.match(content, new RegExp(escapeRegExp(BLOCK_START)));
    assert.match(content, new RegExp(escapeRegExp(BLOCK_END)));
    for (const entry of DEFAULT_IGNORED_ENTRIES) {
      assert.match(content, new RegExp(`^${escapeRegExp(entry)}$`, 'm'));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('preserves existing repository rules while appending the managed block', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gitignore-preserve-'));
  const gitIgnorePath = path.join(directory, '.gitignore');

  try {
    await writeFile(gitIgnorePath, 'node_modules/\ndist/\n', 'utf8');

    await ensureGitIgnore(directory);

    const content = await readFile(gitIgnorePath, 'utf8');
    assert.match(content, /^node_modules\/\ndist\/\n/m);
    assert.match(content, new RegExp(escapeRegExp(BLOCK_START)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('is idempotent and does not rewrite an already managed .gitignore', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gitignore-idempotent-'));

  try {
    const first = await ensureGitIgnore(directory);
    const firstContent = await readFile(first.gitIgnorePath, 'utf8');
    const second = await ensureGitIgnore(directory);
    const secondContent = await readFile(second.gitIgnorePath, 'utf8');

    assert.equal(second.created, false);
    assert.equal(second.updated, false);
    assert.equal(secondContent, firstContent);
    assert.equal(countOccurrences(secondContent, BLOCK_START), 1);
    assert.equal(countOccurrences(secondContent, BLOCK_END), 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('replaces an outdated managed block without duplicating it', () => {
  const previous = [
    'coverage/',
    BLOCK_START,
    '# old managed entries',
    '.env',
    BLOCK_END,
    ''
  ].join('\n');

  const updated = updateGitIgnoreContent(previous);

  assert.match(updated, /^coverage\/$/m);
  assert.equal(countOccurrences(updated, BLOCK_START), 1);
  assert.equal(countOccurrences(updated, BLOCK_END), 1);
  assert.match(updated, /^\.axet\/$/m);
  assert.match(updated, /^micro-migration\.md$/m);
});

function countOccurrences(content, value) {
  return content.split(value).length - 1;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
