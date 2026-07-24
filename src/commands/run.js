'use strict';

const path = require('node:path');
const pc = require('picocolors');
const { runInitCommand } = require('./init');
const {
  runPreMigrationEndpoints,
  runPostMigrationEndpoints
} = require('./endpoints');
const {
  runReadmeCommand,
  runVersionCommand
} = require('./station1');
const {
  runCoverageCommand,
  runSonarCommand
} = require('./quality');
const { runMigrationSummary } = require('./summary');
const { discoverEndpointSources } = require('../services/endpoints');
const { validateMicroserviceName } = require('../utils/checklist');

const DEFAULT_BUMP_TYPE = 'patch';

async function runMigrationPipeline(microservicePath = process.cwd(), {
  currentDirectory = microservicePath,
  environment = process.env,
  output = console.log,
  source,
  baseUrl,
  postBaseUrl,
  authToken = environment.AUTH_TOKEN,
  bumpType = DEFAULT_BUMP_TYPE,
  timeoutMs,
  runInit = runInitCommand,
  runPre = runPreMigrationEndpoints,
  runPost = runPostMigrationEndpoints,
  runVersion = runVersionCommand,
  runReadme = runReadmeCommand,
  runCoverage = runCoverageCommand,
  runSonar = runSonarCommand,
  runSummary = runMigrationSummary,
  discoverSources = discoverEndpointSources
} = {}) {
  const projectDirectory = path.resolve(microservicePath);
  const microserviceName = validateMicroserviceName(path.basename(projectDirectory));
  const result = {
    microserviceName,
    projectDirectory,
    source: undefined,
    stations: {},
    warnings: []
  };

  output(pc.bold(pc.cyan(`🚀 Pipeline de migración: ${microserviceName}`)));

  result.stations.station0 = await runOptionalStep(
    'Estación 0 — tareas de migración',
    () => runInit(microserviceName, {
      environment,
      currentDirectory,
      output,
      mode: 'auto'
    }),
    result,
    output
  );

  const resolvedSource = await resolvePipelineSource(source, projectDirectory, {
    discoverSources,
    result,
    output
  });
  result.source = resolvedSource;

  if (resolvedSource) {
    result.stations.pre = await runOptionalStep(
      'Estación 0 — baseline PRE de endpoints',
      () => runPre(microserviceName, {
        source: resolvedSource,
        baseUrl,
        authToken,
        currentDirectory,
        output,
        timeoutMs
      }),
      result,
      output
    );
  }

  result.stations.version = await runOptionalStep(
    'Estación 1 — versionado',
    () => runVersion(projectDirectory, bumpType, { output }),
    result,
    output
  );
  result.stations.readme = await runOptionalStep(
    'Estación 1 — README técnico',
    () => runReadme(projectDirectory, { output }),
    result,
    output
  );

  result.stations.coverage = await runOptionalStep(
    'Estación 2 — cobertura JaCoCo',
    () => runCoverage(projectDirectory, {
      currentDirectory,
      output
    }),
    result,
    output
  );
  result.stations.sonar = await runOptionalStep(
    'Estación 2 — SonarQube',
    () => runSonar(projectDirectory, {
      currentDirectory,
      environment,
      output
    }),
    result,
    output
  );

  if (postBaseUrl && resolvedSource) {
    result.stations.post = await runOptionalStep(
      'Estación 3 — endpoints POST y paridad',
      () => runPost(microserviceName, {
        source: resolvedSource,
        baseUrl: postBaseUrl,
        authToken,
        currentDirectory,
        output,
        timeoutMs
      }),
      result,
      output
    );
  } else if (!postBaseUrl) {
    addWarning(
      result,
      output,
      'Estación 3 — endpoints POST omitida: indica --post-base-url para ejecutar la paridad.'
    );
  }

  result.stations.summary = await runOptionalStep(
    'Estación 3 — resumen maestro',
    () => runSummary(microserviceName, {
      currentDirectory,
      microservicePath: projectDirectory,
      output
    }),
    result,
    output
  );

  printPipelineSummary(result, output);
  return result;
}

async function resolvePipelineSource(source, projectDirectory, {
  discoverSources,
  result,
  output
}) {
  if (source?.trim()) {
    return source.trim();
  }

  try {
    const sources = await discoverSources(projectDirectory);
    if (sources.length) {
      output(`Definición API detectada automáticamente: ${sources[0].path}`);
      if (sources.length > 1) {
        addWarning(
          result,
          output,
          `Se detectaron ${sources.length} definiciones API; se usa la primera: ${sources[0].path}`
        );
      }
      return sources[0].path;
    }
  } catch (error) {
    addWarning(result, output, `No se pudo descubrir la definición API: ${error.message}`);
    return undefined;
  }

  addWarning(
    result,
    output,
    'No se encontró OpenAPI/Swagger/Postman; se omiten las pruebas de endpoints.'
  );
  return undefined;
}

async function runOptionalStep(label, operation, result, output) {
  try {
    output(pc.dim(`→ ${label}`));
    return await operation();
  } catch (error) {
    addWarning(result, output, `${label}: ${error.message}`);
    return { status: 'warning', error: error.message };
  }
}

function addWarning(result, output, message) {
  result.warnings.push(message);
  output(pc.yellow(`[WARNING] ${message}`));
}

function printPipelineSummary(result, output) {
  const completed = Object.values(result.stations)
    .filter((station) => station && station.status !== 'warning')
    .length;

  output('');
  output(
    result.warnings.length
      ? pc.bold(pc.yellow(`Pipeline finalizado con ${result.warnings.length} advertencia(s).`))
      : pc.bold(pc.green('Pipeline finalizado correctamente.'))
  );
  output(`Pasos completados: ${completed}.`);
  if (result.stations.summary?.reportPath) {
    output(`Resumen maestro: ${result.stations.summary.reportPath}`);
  }
}

module.exports = {
  DEFAULT_BUMP_TYPE,
  addWarning,
  printPipelineSummary,
  resolvePipelineSource,
  runMigrationPipeline,
  runOptionalStep
};
