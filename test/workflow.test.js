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

test('generates a workflow in the project root and replaces every microservice placeholder', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'migration-workflow-'));

  try {
    const result = await generateMigrationWorkflow(directory, 'catalog-service');
    const workflow = await readFile(path.join(directory, WORKFLOW_FILE_NAME), 'utf8');

    assert.equal(result.workflowPath, path.join(directory, WORKFLOW_FILE_NAME));
    assert.equal(result.microserviceName, 'catalog-service');
    assert.match(workflow, /# Workflow de migración: catalog-service/);
    assert.match(workflow, /migration-cli init catalog-service/);
    assert.match(workflow, /migration-cli maven-to-gradle \./);
    assert.match(workflow, /migration-cli rewrite \./);
    assert.match(workflow, /Java 17/);
    assert.match(workflow, /ms-commons-logging-springboot:1\.0\.4/);
    assert.match(workflow, /Code Smells < 30/);
    assert.match(workflow, /migration-cli summary catalog-service \./);
    assert.doesNotMatch(workflow, /\{\{MICROSERVICE_NAME\}\}/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('writes the workflow under .axet/skills when the project has an Axet directory', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'axet-workflow-'));

  try {
    await mkdir(path.join(directory, '.axet'), { recursive: true });

    const result = await generateMigrationWorkflow(directory, 'billing-service');

    assert.equal(
      result.workflowPath,
      path.join(directory, '.axet', 'skills', WORKFLOW_FILE_NAME)
    );
    assert.match(await readFile(result.workflowPath, 'utf8'), /billing-service/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('workflow command service regenerates an existing managed workflow', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workflow-refresh-'));

  try {
    const workflowPath = path.join(directory, WORKFLOW_FILE_NAME);
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
          workflowPath: path.join(projectDirectory, WORKFLOW_FILE_NAME),
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

test('rejects templates that do not contain the microservice marker', () => {
  assert.throws(
    () => renderMigrationWorkflow('# Workflow', 'orders-service'),
    /MICROSERVICE_NAME/
  );
});
