'use strict';

const path = require('node:path');
const { mkdir, readFile, writeFile } = require('node:fs/promises');

const WORKFLOW_FILE_NAME = 'micro-migration.md';
const TEMPLATE_PATH = path.resolve(
  __dirname,
  '..',
  'templates',
  WORKFLOW_FILE_NAME
);

class WorkflowError extends Error {
  constructor(message, { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'WorkflowError';
  }
}

async function generateMigrationWorkflow(projectDirectory, microserviceName, {
  fileSystem = { mkdir, readFile, writeFile },
  templatePath = TEMPLATE_PATH
} = {}) {
  const directory = path.resolve(projectDirectory || process.cwd());
  const serviceName = normalizeMicroserviceName(microserviceName, directory);
  const workflowPath = await resolveWorkflowPath(directory, fileSystem);
  let template;

  try {
    template = await fileSystem.readFile(templatePath, 'utf8');
  } catch (cause) {
    throw new WorkflowError(
      `No se pudo leer la plantilla de workflow: ${templatePath}.`,
      { cause }
    );
  }

  const content = renderMigrationWorkflow(template, serviceName, directory);
  await fileSystem.mkdir(path.dirname(workflowPath), { recursive: true });
  await fileSystem.writeFile(workflowPath, content, 'utf8');

  return {
    microserviceName: serviceName,
    workflowPath,
    content,
    location: path.relative(directory, workflowPath) || WORKFLOW_FILE_NAME
  };
}

function renderMigrationWorkflow(template, microserviceName, microservicePath = process.cwd()) {
  if (!template.includes('{{MICROSERVICE_NAME}}')) {
    throw new WorkflowError(
      'La plantilla del workflow no contiene el marcador {{MICROSERVICE_NAME}}.'
    );
  }

  return template
    .replaceAll('{{MICROSERVICE_NAME}}', microserviceName)
    .replaceAll('{{MICROSERVICE_PATH}}', path.resolve(microservicePath));
}

async function resolveWorkflowPath(projectDirectory) {
  return path.join(
    projectDirectory,
    '.axetrules',
    'workflows',
    WORKFLOW_FILE_NAME
  );
}

function normalizeMicroserviceName(microserviceName, projectDirectory) {
  const candidate = String(microserviceName || path.basename(projectDirectory)).trim();
  if (!candidate || candidate === '.') {
    throw new WorkflowError(
      'No se pudo determinar el nombre del microservicio para generar el workflow.'
    );
  }

  return candidate;
}

module.exports = {
  TEMPLATE_PATH,
  WORKFLOW_FILE_NAME,
  WorkflowError,
  generateMigrationWorkflow,
  normalizeMicroserviceName,
  renderMigrationWorkflow,
  resolveWorkflowPath
};
