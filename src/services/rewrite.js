'use strict';

const path = require('node:path');
const { access, readFile, writeFile } = require('node:fs/promises');
const { constants } = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const executeFile = promisify(execFile);
const REWRITE_PLUGIN_VERSION = '6.19.0';
const DEFAULT_RECIPE_DEPENDENCY = 'org.openrewrite.recipe:rewrite-migrate-java:2.31.0';
const REWRITER_TEMPLATE = `type: specs.openrewrite.org/v1beta/recipe
name: upgrade.zordon.carre4
displayName: Upgrade Carrefour Zordon to CARRE4
description: Recipe entry point for the Carrefour CARRE4 migration.
recipeList: []
`;

class RewriteError extends Error {
  constructor(message, { cause, stdout, stderr } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'RewriteError';
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

async function runOpenRewrite(projectDirectory, {
  environment = process.env,
  platform = process.platform,
  output = console.log,
  fileSystem = { access, readFile, writeFile },
  execute = executeFile
} = {}) {
  const buildPath = await findGradleBuildFile(projectDirectory, fileSystem);
  const rewriterPath = path.join(projectDirectory, 'rewriter.yml');
  const rewriterCreated = await ensureRewriterConfig(rewriterPath, fileSystem);
  const originalBuild = await fileSystem.readFile(buildPath, 'utf8');
  const recipeDependency = environment.REWRITE_RECIPE_DEPENDENCY ||
    DEFAULT_RECIPE_DEPENDENCY;
  const temporaryBuild = injectRewriteConfiguration(originalBuild, {
    recipeDependency
  });

  await fileSystem.writeFile(buildPath, temporaryBuild, 'utf8');

  const command = platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const commandPath = platform === 'win32'
    ? path.join(projectDirectory, command)
    : command;

  output(`Ejecutando OpenRewrite: ${command} rewriteRun`);

  try {
    const result = await execute(commandPath, ['rewriteRun'], {
      cwd: projectDirectory,
      windowsHide: true
    });

    output('OpenRewrite completado. Continúa con la actualización a Java 17 y la fase post-migración.');
    return {
      buildPath,
      rewriterPath,
      rewriterCreated,
      command: `${command} rewriteRun`,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    throw new RewriteError(
      'OpenRewrite no pudo completar la receta de migración.',
      {
        cause: error,
        stdout: error.stdout,
        stderr: error.stderr
      }
    );
  } finally {
    await fileSystem.writeFile(buildPath, originalBuild, 'utf8');
  }
}

async function findGradleBuildFile(projectDirectory, fileSystem) {
  const candidates = ['build.gradle', 'build.gradle.kts'];

  for (const fileName of candidates) {
    const filePath = path.join(projectDirectory, fileName);
    if (await exists(filePath, fileSystem)) {
      return filePath;
    }
  }

  throw new RewriteError(
    'No se encontró build.gradle ni build.gradle.kts en el microservicio.'
  );
}

async function ensureRewriterConfig(rewriterPath, fileSystem) {
  if (await exists(rewriterPath, fileSystem)) {
    return false;
  }

  await fileSystem.writeFile(rewriterPath, REWRITER_TEMPLATE, 'utf8');
  return true;
}

function injectRewriteConfiguration(buildContent, { recipeDependency }) {
  const plugin = `id("org.openrewrite.rewrite") version("${REWRITE_PLUGIN_VERSION}")`;
  const markerStart = '// migration-cli:openrewrite:start';
  const markerEnd = '// migration-cli:openrewrite:end';
  const configuration = `${markerStart}
dependencies {
  rewrite("${recipeDependency}")
}

rewrite {
  activeRecipe("upgrade.zordon.carre4")
}
${markerEnd}
`;

  const pluginsMatch = buildContent.match(/plugins\s*\{/);
  const withPlugin = pluginsMatch
    ? `${buildContent.slice(0, pluginsMatch.index + pluginsMatch[0].length)}\n  ${plugin}${buildContent.slice(pluginsMatch.index + pluginsMatch[0].length)}`
    : `plugins {\n  ${plugin}\n}\n\n${buildContent}`;

  return `${withPlugin.trimEnd()}\n\n${configuration}`;
}

async function exists(filePath, fileSystem) {
  try {
    await fileSystem.access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  DEFAULT_RECIPE_DEPENDENCY,
  REWRITE_PLUGIN_VERSION,
  REWRITER_TEMPLATE,
  RewriteError,
  ensureRewriterConfig,
  findGradleBuildFile,
  injectRewriteConfiguration,
  runOpenRewrite
};
