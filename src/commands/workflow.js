'use strict';

const path = require('node:path');
const pc = require('picocolors');
const { generateMigrationWorkflow } = require('../services/workflow');

async function runWorkflowCommand(projectDirectory = process.cwd(), {
  microserviceName,
  output = console.log,
  generate = generateMigrationWorkflow
} = {}) {
  const directory = path.resolve(projectDirectory);
  const result = await generate(directory, microserviceName);

  output(pc.bold(pc.green('Workflow para IA de IDE generado correctamente.')));
  output(`${pc.dim('Microservicio:')} ${result.microserviceName}`);
  output(`${pc.dim('Archivo:')} ${result.workflowPath}`);

  return result;
}

module.exports = {
  runWorkflowCommand
};
