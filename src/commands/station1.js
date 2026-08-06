'use strict';

const path = require('node:path');
const pc = require('picocolors');
const { generateProjectReadme } = require('../services/readme');
const { bumpProjectVersion } = require('../services/versioning');
const { runOpenRewrite } = require('../services/rewrite');
const { convertMavenToGradle } = require('../services/maven-to-gradle');

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

async function runMavenToGradleCommand(projectDirectory, {
  output = console.log,
  convert = convertMavenToGradle,
  ...options
} = {}) {
  const result = await convert(projectDirectory, { output, ...options });

  output(pc.bold(pc.green('Conversión Maven → Gradle validada correctamente')));
  output(
    `${pc.dim('Build Gradle:')} ${result.generatedFiles.find((filePath) => filePath.endsWith('build.gradle'))}`
  );
  if (!result.cutover) {
    output(pc.yellow('pom.xml se conserva hasta completar el cutover explícito.'));
  }

  return result;
}

async function runRewriteCommand(projectDirectory, {
  output = console.log,
  rewrite = runOpenRewrite,
  ...options
} = {}) {
  const result = await rewrite(projectDirectory, { output, ...options });

  output(pc.bold(pc.green('OpenRewrite ejecutado correctamente')));
  output(`${pc.dim('Configuración:')} ${result.rewriterPath}`);
  output(
    pc.yellow(
      'Continúa con la actualización a Java 17 y la fase post-migración.'
    )
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
  runMavenToGradleCommand,
  runReadmeCommand,
  runRewriteCommand,
  runStation1Preparation,
  runVersionCommand
};
