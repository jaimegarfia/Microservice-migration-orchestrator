'use strict';

const path = require('node:path');
const pc = require('picocolors');
const { generateProjectReadme } = require('../services/readme');
const { bumpProjectVersion } = require('../services/versioning');

async function runVersionCommand(projectDirectory, type, {
  output = console.log,
  bump = bumpProjectVersion
} = {}) {
  const result = await bump(projectDirectory, type);

  output(pc.bold(pc.green('Version actualizada correctamente')));
  output(`${pc.dim('Anterior:')} ${result.previousVersion}`);
  output(`${pc.bold('Nueva:')} ${pc.cyan(result.nextVersion)}`);
  output(
    `${pc.dim('Archivos:')} ${result.updatedFiles
      .map((filePath) => path.basename(filePath))
      .join(', ')}`
  );

  return result;
}

async function runReadmeCommand(projectDirectory, {
  output = console.log,
  generate = generateProjectReadme
} = {}) {
  const result = await generate(projectDirectory);

  output(pc.bold(pc.green('README técnico generado correctamente')));
  output(`${pc.dim('Archivo:')} ${result.readmePath}`);
  output(
    `${pc.dim('Detectado:')} ${formatDetectedStack(result.analysis.stack)}`
  );

  return result;
}

function formatDetectedStack(stack) {
  return [
    stack.language,
    stack.springBoot ? 'Spring Boot' : null,
    stack.buildTool,
    stack.database !== 'No detectada' ? stack.database : null,
    ...stack.messaging
  ]
    .filter(Boolean)
    .join(', ') || 'Sin componentes detectados';
}

async function runStation1Preparation(projectDirectory, type, options = {}) {
  const version = await runVersionCommand(projectDirectory, type, options);
  const readme = await runReadmeCommand(projectDirectory, options);

  return { version, readme };
}

module.exports = {
  formatDetectedStack,
  runReadmeCommand,
  runStation1Preparation,
  runVersionCommand
};
