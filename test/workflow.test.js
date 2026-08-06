'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { runInitCommand } = require('../src/commands/init');
const {
  WORKFLOW_FILE_NAME,
  generateMigrationWorkflow,
  renderMigrationWorkflow
} = require('../src/services/workflow');

test('generates a workflow under .axetrules/workflows and replaces every microservice placeholder', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'migration-workflow-'));

  try {
    const result = await generateMigrationWorkflow(directory, 'catalog-service');
    const workflow = await readFile(
      path.join(directory, '.axetrules', 'workflows', WORKFLOW_FILE_NAME),
      'utf8'
    );

    assert.equal(
      result.workflowPath,
      path.join(directory, '.axetrules', 'workflows', WORKFLOW_FILE_NAME)
    );
    assert.equal(result.microserviceName, 'catalog-service');
    assert.match(workflow, /# Workflow de Migración para Asistente de IA \(Axet \/ IDE\)/);
    assert.match(workflow, /migration-cli endpoints --pre catalog-service/);
    assert.match(workflow, /migration-cli rewrite \./);
    assert.match(workflow, /JavaVersion\.VERSION_17/);
    assert.match(workflow, /ms-commons-logging-springboot:1\.0\.4/);
    assert.match(workflow, /migration-cli coverage \./);
    assert.match(workflow, /migration-cli sonar \./);
    assert.match(workflow, /migration-cli summary catalog-service \./);
    assert.match(workflow, /migration-cli comment 4 \./);
    assert.match(workflow, /\.axetrules\/history\/migration-summary\.md/);
    assert.doesNotMatch(workflow, /\{\{MICROSERVICE_NAME\}\}/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('writes the workflow under .axetrules/workflows even when an Axet directory exists', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'axet-workflow-'));

  try {
    await mkdir(path.join(directory, '.axet'), { recursive: true });

    const result = await generateMigrationWorkflow(directory, 'billing-service');

    assert.equal(
      result.workflowPath,
      path.join(directory, '.axetrules', 'workflows', WORKFLOW_FILE_NAME)
    );
    assert.match(await readFile(result.workflowPath, 'utf8'), /billing-service/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('workflow command service regenerates an existing managed workflow', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workflow-refresh-'));

  try {
    const workflowPath = path.join(
      directory,
      '.axetrules',
      'workflows',
      WORKFLOW_FILE_NAME
    );
    await mkdir(path.dirname(workflowPath), { recursive: true });
    await writeFile(workflowPath, 'stale workflow', 'utf8');

    await generateMigrationWorkflow(directory, 'orders-service');

    const workflow = await readFile(workflowPath, 'utf8');
    assert.doesNotMatch(workflow, /stale workflow/);
    assert.match(workflow, /orders-service/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('init generates the workflow together with the local checklist and derives init dot from the directory name', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'init-workflow-'));
  const directory = path.join(root, 'orders-service');
  await mkdir(directory, { recursive: true });

  try {
    const generated = [];
    const result = await runInitCommand('.', {
      currentDirectory: directory,
      environment: {},
      mode: 'local',
      output: () => {},
      ensureEnvironment: async () => ({
        created: false,
        envPath: path.join(directory, '.env')
      }),
      generateWorkflow: async (projectDirectory, microserviceName) => {
        generated.push({ projectDirectory, microserviceName });
        return {
          workflowPath: path.join(
            projectDirectory,
            '.axetrules',
            'workflows',
            WORKFLOW_FILE_NAME
          ),
          microserviceName
        };
      }
    });

    assert.equal(result.mode, 'local');
    assert.deepEqual(generated, [{
      projectDirectory: directory,
      microserviceName: 'orders-service'
    }]);
    assert.equal(result.workflow.microserviceName, 'orders-service');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('interpolates the optional microservice path marker', () => {
  const workflow = renderMigrationWorkflow(
    'Servicio: {{MICROSERVICE_NAME}}\nRuta: {{MICROSERVICE_PATH}}',
    'orders-service',
    'C:\\workspace\\orders-service'
  );

  assert.equal(
    workflow,
    'Servicio: orders-service\nRuta: C:\\workspace\\orders-service'
  );
});

test('rejects templates that do not contain the microservice marker', () => {
  assert.throws(
    () => renderMigrationWorkflow('# Workflow', 'orders-service'),
    /MICROSERVICE_NAME/
  );
});
