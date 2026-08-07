'use strict';

const path = require('node:path');
const { readdir, readFile, mkdir, writeFile } = require('node:fs/promises');
const { getHistoryDirectory } = require('../utils/history');

const PARITY_STATUS = {
  MATCH: 'MATCH',
  WARNING: 'WARNING',
  BREAKING_CHANGE: 'BREAKING CHANGE'
};

class ParityError extends Error {
  constructor(message, { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ParityError';
  }
}

async function findLatestPreReport(microserviceName, {
  currentDirectory = process.cwd(),
  fileSystem = { readdir, readFile }
} = {}) {
  const historyDirectory = path.join(currentDirectory, '.axetrules', 'history');
  let entries;

  try {
    entries = await fileSystem.readdir(historyDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new ParityError(
        `No existe historial PRE para ${microserviceName}. Ejecuta endpoints --pre primero.`
      );
    }
    throw new ParityError('No se pudo leer el historial de migración.', { cause: error });
  }

  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const directoryName of directories) {
    const reportPath = path.join(
      historyDirectory,
      directoryName,
      'endpoints-pre.json'
    );

    try {
      const report = JSON.parse(await fileSystem.readFile(reportPath, 'utf8'));
      if (report.phase === 'PRE' && report.microservice === microserviceName) {
        return { report, reportPath };
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.name !== 'SyntaxError') {
        throw new ParityError(
          `No se pudo leer el baseline PRE: ${reportPath}.`,
          { cause: error }
        );
      }
    }
  }

  throw new ParityError(
    `No se encontró un baseline PRE para el microservicio ${microserviceName}.`
  );
}

function compareEndpointResults(preResults, postResults) {
  const preByEndpoint = new Map(preResults.map((result) => [result.endpoint, result]));
  const postByEndpoint = new Map(postResults.map((result) => [result.endpoint, result]));
  const endpoints = [...new Set([...preByEndpoint.keys(), ...postByEndpoint.keys()])].sort();

  return endpoints.map((endpoint) =>
    compareEndpoint(preByEndpoint.get(endpoint), postByEndpoint.get(endpoint), endpoint)
  );
}

function compareEndpoint(pre, post, endpoint) {
  if (!post || post.status === null) {
    return {
      endpoint,
      status: PARITY_STATUS.BREAKING_CHANGE,
      reason: 'Endpoint no disponible en POST',
      pre,
      post
    };
  }

  if (!pre) {
    return {
      endpoint,
      status: PARITY_STATUS.WARNING,
      reason: 'Endpoint nuevo en POST',
      pre,
      post
    };
  }

  if (pre.status !== post.status) {
    return {
      endpoint,
      status: PARITY_STATUS.BREAKING_CHANGE,
      reason: `Status cambió de ${formatStatus(pre.status)} a ${formatStatus(post.status)}`,
      pre,
      post
    };
  }

  if (pre.responseHash !== post.responseHash) {
    return {
      endpoint,
      status: PARITY_STATUS.WARNING,
      reason: 'Payload diferente',
      pre,
      post
    };
  }

  if (hasSignificantLatencyVariation(pre.responseTimeMs, post.responseTimeMs)) {
    return {
      endpoint,
      status: PARITY_STATUS.WARNING,
      reason: `Tiempo de respuesta varió más del 50% (${pre.responseTimeMs} ms → ${post.responseTimeMs} ms)`,
      pre,
      post
    };
  }

  return {
    endpoint,
    status: PARITY_STATUS.MATCH,
    reason: 'Status y contrato idénticos',
    pre,
    post
  };
}

function hasSignificantLatencyVariation(preTime, postTime) {
  if (
    typeof preTime !== 'number' ||
    typeof postTime !== 'number' ||
    preTime <= 0
  ) {
    return false;
  }

  return Math.abs(postTime - preTime) / preTime > 0.5;
}

function formatStatus(status) {
  return status === null || status === undefined ? 'ERROR' : status;
}

function summarizeParity(comparisons) {
  const summary = {
    total: comparisons.length,
    matches: 0,
    warnings: 0,
    breakingChanges: 0
  };

  for (const comparison of comparisons) {
    if (comparison.status === PARITY_STATUS.MATCH) {
      summary.matches += 1;
    } else if (comparison.status === PARITY_STATUS.WARNING) {
      summary.warnings += 1;
    } else {
      summary.breakingChanges += 1;
    }
  }

  summary.status = summary.breakingChanges
    ? 'FAILED'
    : summary.warnings
      ? 'WARNING'
      : 'PASSED';

  return summary;
}

function createParityReport({ microservice, preReport, postReport, comparisons }) {
  return {
    timestamp: postReport.timestamp,
    microservice,
    preReportTimestamp: preReport.timestamp,
    postReportTimestamp: postReport.timestamp,
    summary: summarizeParity(comparisons),
    comparisons
  };
}

function renderParityMarkdown(report) {
  const rows = report.comparisons.map((comparison) => [
    `| \`${comparison.endpoint}\``,
    parityBadge(comparison.status),
    formatStatus(comparison.pre?.status),
    formatStatus(comparison.post?.status),
    `${comparison.pre?.responseTimeMs ?? '-'} ms`,
    `${comparison.post?.responseTimeMs ?? '-'} ms`,
    comparison.reason.replace(/\|/g, '\\|'),
    '|'
  ].join(' '));

  return [
    `# Reporte de Paridad API: ${report.microservice}`,
    '',
    `- **Estado global:** ${report.summary.status}`,
    `- **Baseline PRE:** ${report.preReportTimestamp}`,
    `- **Ejecución POST:** ${report.postReportTimestamp}`,
    '',
    '## Resumen',
    '',
    `- MATCH: ${report.summary.matches}`,
    `- WARNING: ${report.summary.warnings}`,
    `- BREAKING CHANGE: ${report.summary.breakingChanges}`,
    '',
    '## Comparativa',
    '',
    '| Endpoint | Resultado | Status PRE | Status POST | Tiempo PRE | Tiempo POST | Motivo |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    ''
  ].join('\n');
}

function parityBadge(status) {
  if (status === PARITY_STATUS.MATCH) {
    return '🟢 MATCH';
  }
  if (status === PARITY_STATUS.WARNING) {
    return '🟡 WARNING';
  }
  return '🔴 BREAKING CHANGE';
}

async function writeParityReport(report, {
  currentDirectory = process.cwd(),
  fileSystem = { mkdir, writeFile }
} = {}) {
  const historyDirectory = getHistoryDirectory(
    currentDirectory,
    3,
    'POST-Endpoints',
    report.timestamp
  );
  const reportPath = path.join(historyDirectory, 'parity-report.md');

  await fileSystem.mkdir(historyDirectory, { recursive: true });
  await fileSystem.writeFile(reportPath, renderParityMarkdown(report), 'utf8');
  return reportPath;
}

module.exports = {
  PARITY_STATUS,
  ParityError,
  compareEndpointResults,
  createParityReport,
  findLatestPreReport,
  hasSignificantLatencyVariation,
  renderParityMarkdown,
  summarizeParity,
  writeParityReport
};
