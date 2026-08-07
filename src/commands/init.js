'use strict';

const path = require('node:path');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { extractJiraIssueKey } = require('../services/jira');
const { ensureGitIgnore } = require('../services/gitignore');
const { generateMigrationWorkflow } = require('../services/workflow');
const { getHistoryDirectory } = require('../utils/history');
const {
  buildMigrationChecklist,
  toHistoryFileName,
  validateMicroserviceName
} = require('../utils/checklist');

async function runInitCommand(microserviceName, {
  environment = process.env,
  currentDirectory = process.cwd(),
  output = console.log,
  fileSystem = { mkdir, readFile, writeFile },
  ensureGitignore = ensureGitIgnore,
  generateWorkflow = generateMigrationWorkflow,
  jiraIssueKey,
  mode = 'auto',
  progress = {}
} = {}) {
  const serviceName = validateMicroserviceName(
    microserviceName === '.'
      ? path.basename(path.resolve(currentDirectory))
      : microserviceName
  );
  const gitIgnore = await ensureGitignore(currentDirectory);
  if (gitIgnore.updated) {
    output(`Reglas de seguridad actualizadas en: ${gitIgnore.gitIgnorePath}`);
  }

  if (mode !== 'auto' && mode !== 'local') {
    throw new Error('El modo de inicialización debe ser "auto" o "local".');
  }

  const issueInput = jiraIssueKey || environment.JIRA_ISSUE_KEY;
  const result = issueInput && mode !== 'local'
    ? await linkExistingJiraIssue(issueInput, {
      currentDirectory,
      output
    })
    : await createLocalChecklist(serviceName, {
      currentDirectory,
      output,
      fileSystem,
      progress
    });

  const workflow = await generateWorkflow(currentDirectory, serviceName);
  output(`Workflow para IDE generado en: ${workflow.workflowPath}`);

  return { ...result, gitIgnore, workflow };
}

async function linkExistingJiraIssue(issueInput, {
  output
}) {
  const issueKey = extractJiraIssueKey(issueInput);

  output(`Migración vinculada a la tarea Jira existente: ${issueKey}`);

  return {
    mode: 'jira-linked',
    issueKey
  };
}

async function createLocalChecklist(
  microserviceName,
  { currentDirectory, output, fileSystem, progress = {} }
) {
  progress.onLocalStart?.({ microserviceName });
  const checklist = buildMigrationChecklist(microserviceName);
  const historyDirectory = getHistoryDirectory(
    currentDirectory,
    0,
    'Preparacion',
    new Date()
  );
  const historyPath = path.join(
    historyDirectory,
    toHistoryFileName(microserviceName)
  );

  await fileSystem.mkdir(historyDirectory, { recursive: true });
  await fileSystem.writeFile(historyPath, checklist, 'utf8');
  progress.onLocalCreated?.({ historyPath });

  output('');
  output('Configuración de Jira incompleta: se generó el checklist local.');
  output('');
  output(checklist);
  output(`Copia guardada en: ${historyPath}`);

  return {
    mode: 'local',
    checklist,
    historyPath
  };
}

module.exports = {
  runInitCommand,
  linkExistingJiraIssue,
  createLocalChecklist
};
