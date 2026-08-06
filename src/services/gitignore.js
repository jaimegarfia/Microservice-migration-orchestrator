'use strict';

const path = require('node:path');
const { access, readFile, writeFile } = require('node:fs/promises');
const { constants } = require('node:fs');

const GITIGNORE_FILE_NAME = '.gitignore';
const BLOCK_START = '# >>> Migration Orchestrator & Axet IDE Ignored Files >>>';
const BLOCK_END = '# <<< Migration Orchestrator & Axet IDE Ignored Files <<<';
const DEFAULT_IGNORED_ENTRIES = [
  '.env',
  '.env.local',
  '.env.*.local',
  '.axetrules/',
  '.axet/',
  'micro-migration.md',
  'rewriter.yml',
  'zordon/'
];

class GitIgnoreError extends Error {
  constructor(message, { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'GitIgnoreError';
  }
}

function createManagedBlock(entries = DEFAULT_IGNORED_ENTRIES) {
  return [
    BLOCK_START,
    '# Migration Orchestrator & Axet IDE Ignored Files',
    ...entries,
    BLOCK_END
  ].join('\n');
}

function updateGitIgnoreContent(content = '', entries = DEFAULT_IGNORED_ENTRIES) {
  const normalized = normalizeLineEndings(content).trimEnd();
  const block = createManagedBlock(entries);
  const managedBlockPattern = new RegExp(
    `${escapeRegExp(BLOCK_START)}[\\s\\S]*?${escapeRegExp(BLOCK_END)}`,
    'g'
  );

  if (managedBlockPattern.test(normalized)) {
    return `${normalized.replace(managedBlockPattern, block).trimEnd()}\n`;
  }

  const separator = normalized ? '\n\n' : '';
  return `${normalized}${separator}${block}\n`;
}

async function ensureGitIgnore(currentDirectory = process.cwd(), {
  entries = DEFAULT_IGNORED_ENTRIES,
  fileSystem = { access, readFile, writeFile }
} = {}) {
  const directory = path.resolve(currentDirectory);
  const gitIgnorePath = path.join(directory, GITIGNORE_FILE_NAME);
  const existing = await pathExists(gitIgnorePath, fileSystem);
  let previousContent = '';

  if (existing) {
    try {
      previousContent = await fileSystem.readFile(gitIgnorePath, 'utf8');
    } catch (cause) {
      throw new GitIgnoreError(
        `No se pudo leer ${gitIgnorePath}.`,
        { cause }
      );
    }
  }

  const content = updateGitIgnoreContent(previousContent, entries);
  const updated = content !== previousContent;

  if (updated) {
    try {
      await fileSystem.writeFile(gitIgnorePath, content, 'utf8');
    } catch (cause) {
      throw new GitIgnoreError(
        `No se pudo actualizar ${gitIgnorePath}.`,
        { cause }
      );
    }
  }

  return {
    gitIgnorePath,
    created: !existing,
    updated,
    entries: [...entries]
  };
}

async function pathExists(filePath, fileSystem) {
  try {
    await fileSystem.access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeLineEndings(content) {
  return String(content).replace(/\r\n?/g, '\n');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  BLOCK_END,
  BLOCK_START,
  DEFAULT_IGNORED_ENTRIES,
  GITIGNORE_FILE_NAME,
  GitIgnoreError,
  createManagedBlock,
  ensureGitIgnore,
  updateGitIgnoreContent
};
