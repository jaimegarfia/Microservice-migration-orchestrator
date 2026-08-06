'use strict';

const path = require('node:path');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const pc = require('picocolors');
const { extractJiraIssueKey } = require('../services/jira');
const {
  ensureEnvironmentFiles,
  saveJiraIssueKey
} = require('../services/environment');
const { ensureGitIgnore } = require('../services/gitignore');
const { generateMigrationWorkflow } = require('../services/workflow');
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
  ensureEnvironment = ensureEnvironmentFiles,
  ensureGitignore = ensureGitIgnore,
  saveIssueKey = saveJiraIssueKey,
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
  const environmentFiles = await ensureEnvironment(currentDirectory);
  if (gitIgnore.updated) {
    output(`Reglas de seguridad actualizadas en: ${gitIgnore.gitIgnorePath}`);
  }
  if (environmentFiles.created) {
    output('');
    output(pc.bold(pc.yellow('Configuración de entorno creada.')));
    output(
      pc.yellow(
        `Completa los valores de ${environmentFiles.envPath} antes de capturar endpoints o publicar comentarios en Jira.`
      )
    );
  }

  if (mode !== 'auto' && mode !== 'local') {
    throw new Error('El modo de inicialización debe ser "auto" o "local".');
  }

  const fileEnvironment = await loadProjectEnvironment(currentDirectory, fileSystem);
  const issueInput =
    jiraIssueKey || environment.JIRA_ISSUE_KEY || fileEnvironment.JIRA_ISSUE_KEY;
  const result = issueInput && mode !== 'local'
    ? await linkExistingJiraIssue(issueInput, {
      currentDirectory,
      output,
      saveIssueKey
    })
    : await createLocalChecklist(serviceName, {
      currentDirectory,
      output,
      fileSystem,
      progress
    });

  const workflow = await generateWorkflow(currentDirectory, serviceName);
  output(`Workflow para IDE generado en: ${workflow.workflowPath}`);

  return { ...result, environmentFiles, gitIgnore, workflow };
}

async function loadProjectEnvironment(currentDirectory, fileSystem) {
  if (typeof fileSystem.readFile !== 'function') {
    return {};
  }

  try {
    const content = await fileSystem.readFile(
      path.join(currentDirectory, '.env'),
      'utf8'
    );
    const match = /^JIRA_ISSUE_KEY=(.*)$/m.exec(content);
    return { JIRA_ISSUE_KEY: match?.[1]?.trim() };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw new Error(
      `No se pudo leer el archivo .env para resolver JIRA_ISSUE_KEY.`,
      { cause: error }
    );
  }
}

async function linkExistingJiraIssue(issueInput, {
  currentDirectory,
  output,
  saveIssueKey
}) {
  const issueKey = extractJiraIssueKey(issueInput);
  const savedIssue = await saveIssueKey(issueKey, currentDirectory);

  output(`Migración vinculada a la tarea Jira existente: ${issueKey}`);
  output(`JIRA_ISSUE_KEY guardada en: ${savedIssue.envPath}`);

  return {
    mode: 'jira-linked',
    issueKey,
    envPath: savedIssue.envPath
  };
}

async function createLocalChecklist(
  microserviceName,
  { currentDirectory, output, fileSystem, progress = {} }
) {
  progress.onLocalStart?.({ microserviceName });
  const checklist = buildMigrationChecklist(microserviceName);
  const historyDirectory = path.join(currentDirectory, '.axetrules', 'history');
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
  loadProjectEnvironment,
  linkExistingJiraIssue,
  createLocalChecklist
};
