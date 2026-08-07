'use strict';

const path = require('node:path');
const { access, readFile, writeFile } = require('node:fs/promises');
const { constants } = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { ensureGitIgnore } = require('./gitignore');

const executeFile = promisify(execFile);
const REWRITE_PLUGIN_VERSION = '6.19.0';
const DEFAULT_RECIPE_DEPENDENCY = 'org.openrewrite.recipe:rewrite-spring:6.0.1';
const REWRITER_RECIPE_PATH = path.join(__dirname, '../../rewriter-util/rewrite.yml');
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
  dryRun = false,
  output = console.log,
  fileSystem = { access, readFile, writeFile },
  execute = executeFile,
  gitIgnore = ensureGitIgnore
} = {}) {
  const buildPath = await findGradleBuildFile(projectDirectory, fileSystem);
  const rewritePath = path.join(projectDirectory, 'rewrite.yml');
  const recipeContent = await readRecipe(fileSystem);
  const originalBuild = await fileSystem.readFile(buildPath, 'utf8');
  const recipeDependency = environment.REWRITE_RECIPE_DEPENDENCY ||
    DEFAULT_RECIPE_DEPENDENCY;
  const temporaryBuild = injectRewriteConfiguration(originalBuild, {
    recipeDependency
  });
  const task = dryRun ? 'rewriteDryRun' : 'rewriteRun';
  const gitIgnoreResult = await gitIgnore(projectDirectory);

  await fileSystem.writeFile(rewritePath, recipeContent, 'utf8');
  await fileSystem.writeFile(buildPath, temporaryBuild, 'utf8');

  const command = platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const commandPath = platform === 'win32'
    ? path.join(projectDirectory, command)
    : command;

  output(`Ejecutando OpenRewrite: ${command} ${task}`);

  try {
    const result = await execute(commandPath, [task], {
      cwd: projectDirectory,
      windowsHide: true
    });

    output('OpenRewrite completado. Continúa con la actualización a Java 17 y la fase post-migración.');
    return {
      buildPath,
      rewritePath,
      rewriterPath: rewritePath,
      rewriterCreated: true,
      gitIgnore: gitIgnoreResult,
      command: `${command} ${task}`,
      dryRun,
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

async function readRecipe(fileSystem) {
  try {
    return await fileSystem.readFile(REWRITER_RECIPE_PATH, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new RewriteError(
        `No se encontró la receta distribuida en ${REWRITER_RECIPE_PATH}.`,
        { cause: error }
      );
    }
    throw new RewriteError('No se pudo leer la receta OpenRewrite distribuida.', {
      cause: error
    });
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

function injectRewriteConfiguration(buildContent, {
  recipeDependency = DEFAULT_RECIPE_DEPENDENCY
} = {}) {
  const plugin = `id("org.openrewrite.rewrite") version("${REWRITE_PLUGIN_VERSION}")`;
  const markerStart = '// migration-cli:openrewrite:start';
  const markerEnd = '// migration-cli:openrewrite:end';
  const configuration = `${markerStart}
dependencies {
  rewrite("${recipeDependency}")
}

rewrite {
  activeRecipe("upgrade.zordon.carre4")
  setExportDatatables(false)
}
${markerEnd}
`;

  const pluginsMatch = buildContent.match(/plugins\s*\{/);
  const withPlugin = pluginsMatch
    ? `${buildContent.slice(0, pluginsMatch.index + pluginsMatch[0].length)}
  ${plugin}${buildContent.slice(pluginsMatch.index + pluginsMatch[0].length)}`
    : `plugins {
  ${plugin}
}

${buildContent}`;

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
  REWRITER_RECIPE_PATH,
  REWRITER_TEMPLATE,
  RewriteError,
  ensureRewriterConfig,
  findGradleBuildFile,
  injectRewriteConfiguration,
  runOpenRewrite
};
