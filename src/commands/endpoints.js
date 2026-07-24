'use strict';

const pc = require('picocolors');
const {
  EndpointSourceError,
  createBaselineReport,
  discoverEndpointSource,
  executeGetEndpoints,
  extractGetEndpoints,
  loadEndpointDefinition,
  summarizeResults,
  writeBaselineReport
} = require('../services/endpoints');
const { validateMicroserviceName } = require('../utils/checklist');

async function runPreMigrationEndpoints(microserviceName, {
  source,
  baseUrl,
  authToken = process.env.AUTH_TOKEN,
  currentDirectory = process.cwd(),
  output = console.log,
  fetchImplementation = globalThis.fetch,
  progress = {},
  timeoutMs
} = {}) {
  const serviceName = validateMicroserviceName(microserviceName);
  const resolvedSource = await resolveEndpointSource(source, currentDirectory);
  const { definition } = await loadEndpointDefinition(resolvedSource, {
    fetchImplementation
  });
  const endpoints = extractGetEndpoints(definition, { baseUrl });

  if (!endpoints.length) {
    throw new EndpointSourceError(
      'No se encontraron endpoints GET ejecutables en la definicion indicada.'
    );
  }

  progress.onDiscovery?.({
    source: resolvedSource,
    total: endpoints.length
  });

  const results = await executeGetEndpoints(endpoints, {
    authToken,
    fetchImplementation,
    timeoutMs,
    onEndpointStart: progress.onEndpointStart,
    onEndpointComplete: progress.onEndpointComplete
  });
  const report = createBaselineReport(serviceName, results);
  const reportPath = await writeBaselineReport(report, { currentDirectory });
  const summary = summarizeResults(results);

  printBaselineSummary(summary, reportPath, output);

  return {
    source: resolvedSource,
    endpoints,
    report,
    reportPath,
    summary
  };
}

async function resolveEndpointSource(source, currentDirectory) {
  if (source?.trim()) {
    return source.trim();
  }

  const discoveredSource = await discoverEndpointSource(currentDirectory);
  if (!discoveredSource) {
    throw new EndpointSourceError(
      'No se encontro swagger/openapi ni una coleccion Postman. Usa --source <ruta-o-url>.'
    );
  }

  return discoveredSource.path;
}

function printBaselineSummary(summary, reportPath, output) {
  const title =
    summary.errors === 0
      ? pc.green('Baseline PRE completada')
      : pc.yellow('Baseline PRE completada con incidencias');

  output('');
  output(pc.bold(title));
  output(
    `${pc.green(`${summary.ok} OK (200)`)} de ${summary.total} endpoints GET`
  );

  if (summary.errors) {
    output(pc.red(`${summary.errors} endpoints con estado distinto de 200 o error de red`));
  }

  output(`Evidencia: ${reportPath}`);
}

module.exports = {
  printBaselineSummary,
  resolveEndpointSource,
  runPreMigrationEndpoints
};
