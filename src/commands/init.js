'use strict';

const path = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');
const { JiraClient } = require('../services/jira');
const {
  buildMigrationChecklist,
  toHistoryFileName,
  validateMicroserviceName
} = require('../utils/checklist');

async function runInitCommand(microserviceName, {
  environment = process.env,
  currentDirectory = process.cwd(),
  output = console.log,
  jiraClientFactory = JiraClient.fromEnvironment,
  fileSystem = { mkdir, writeFile },
  mode = 'auto',
  progress = {}
} = {}) {
  const serviceName = validateMicroserviceName(microserviceName);
  const shouldUseJira =
    mode === 'jira' || (mode === 'auto' && JiraClient.isConfigured(environment));

  if (mode !== 'auto' && mode !== 'jira' && mode !== 'local') {
    throw new Error('El modo de inicialización debe ser "auto", "jira" o "local".');
  }

  if (shouldUseJira) {
    return createJiraIssues(serviceName, {
      environment,
      output,
      jiraClientFactory,
      progress
    });
  }

  return createLocalChecklist(serviceName, {
    currentDirectory,
    output,
    fileSystem,
    progress
  });
}

async function createJiraIssues(
  microserviceName,
  { environment, output, jiraClientFactory, progress = {} }
) {
  const jiraClient = jiraClientFactory(environment);

  progress.onParentStart?.({ microserviceName });
  output(`Creando tarea de migración para "${microserviceName}" en Jira...`);
  const parent = await jiraClient.createMigrationEpicOrTask(microserviceName);
  progress.onParentCreated?.({ parent });

  const subtasks = await jiraClient.createSubtasks(parent.key, {
    onSubtaskStart: progress.onSubtaskStart,
    onSubtaskCreated: progress.onSubtaskCreated
  });

  output('');
  output('Tarea y subtareas creadas en Jira:');
  output(`- Padre: ${parent.key} — ${parent.url}`);
  subtasks.forEach((subtask) => {
    output(`- Subtarea: ${subtask.key} — ${subtask.url}`);
  });

  return {
    mode: 'jira',
    parent,
    subtasks
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
  createJiraIssues,
  createLocalChecklist
};
