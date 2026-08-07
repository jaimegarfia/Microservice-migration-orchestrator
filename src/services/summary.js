'use strict';

const path = require('node:path');
const { access, readdir, mkdir, readFile, writeFile } = require('node:fs/promises');
const { getHistoryDirectory } = require('../utils/history');
const { toHistoryFileName } = require('../utils/checklist');

class SummaryError extends Error {
  constructor(message, { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SummaryError';
  }
}

async function findLatestEvidenceDirectory({
  currentDirectory = process.cwd(),
  fileSystem = { readdir, access }
} = {}) {
  const historyDirectory = path.join(currentDirectory, '.axetrules', 'history');
  let entries;

  try {
    entries = await fileSystem.readdir(historyDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new SummaryError('No existe historial de migración para generar el resumen.');
    }
    throw new SummaryError('No se pudo leer el historial de migración.', { cause: error });
  }

  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const directory of directories) {
    for (const artifact of [
      'parity-report.md',
      'endpoints-post.json',
      'station2-quality.json',
      'endpoints-pre.json'
    ]) {
      try {
        await fileSystem.access(path.join(historyDirectory, directory, artifact));
        return path.join(historyDirectory, directory);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw new SummaryError('No se pudo inspeccionar la evidencia.', { cause: error });
        }
      }
    }
  }

  throw new SummaryError('No se encontró evidencia con timestamp para generar el resumen.');
}

async function findLatestArtifact(artifactName, {
  currentDirectory = process.cwd(),
  microserviceName,
  fileSystem = { readdir, readFile }
} = {}) {
  const historyDirectory = path.join(currentDirectory, '.axetrules', 'history');
  let entries;

  try {
    entries = await fileSystem.readdir(historyDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return undefined;
    }
    throw new SummaryError('No se pudo leer el historial de migración.', { cause: error });
  }

  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const directory of directories) {
    const artifactPath = path.join(historyDirectory, directory, artifactName);
    try {
      const content = await fileSystem.readFile(artifactPath, 'utf8');
      if (!artifactName.endsWith('.json')) {
        const belongsToMicroservice = artifactName !== 'parity-report.md' ||
          !microserviceName ||
          content.includes(`# Reporte de Paridad API: ${microserviceName}`);
        if (belongsToMicroservice) {
          return { path: artifactPath, content, directory };
        }
        continue;
      }

      const data = JSON.parse(content);
      if (!microserviceName || data.microservice === microserviceName) {
        return { path: artifactPath, data, directory };
      }
    } catch (error) {
      if (error.code !== 'ENOENT' && error.name !== 'SyntaxError') {
        throw new SummaryError(`No se pudo leer: ${artifactPath}.`, { cause: error });
      }
    }
  }

  return undefined;
}

async function readJsonIfExists(filePath, {
  fileSystem = { readFile }
} = {}) {
  try {
    return JSON.parse(await fileSystem.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return undefined;
    }
    if (error.name === 'SyntaxError') {
      throw new SummaryError(`El artefacto JSON no es válido: ${filePath}.`, { cause: error });
    }
    throw new SummaryError(`No se pudo leer: ${filePath}.`, { cause: error });
  }
}

async function exists(filePath, {
  fileSystem = { access }
} = {}) {
  try {
    await fileSystem.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw new SummaryError(`No se pudo acceder a ${filePath}.`, { cause: error });
  }
}

async function collectMigrationEvidence(microserviceName, {
  currentDirectory = process.cwd(),
  microservicePath = currentDirectory,
  fileSystem = { readdir, readFile, access }
} = {}) {
  const [
    preArtifact,
    postArtifact,
    qualityArtifact,
    parityArtifact,
    localChecklist,
    readmePresent,
    versionFiles
  ] = await Promise.all([
    findLatestArtifact('endpoints-pre.json', {
      currentDirectory,
      microserviceName,
      fileSystem
    }),
    findLatestArtifact('endpoints-post.json', {
      currentDirectory,
      microserviceName,
      fileSystem
    }),
    findLatestArtifact('station2-quality.json', {
      currentDirectory,
      fileSystem
    }),
    findLatestArtifact('parity-report.md', {
      currentDirectory,
      fileSystem
    }),
    findLatestArtifact(toHistoryFileName(microserviceName), {
      currentDirectory,
      fileSystem
    }),
    exists(path.join(microservicePath, 'README.md'), { fileSystem }),
    findVersionFiles(microservicePath, { fileSystem })
  ]);

  const evidenceDirectory = postArtifact?.path
    ? path.dirname(postArtifact.path)
    : qualityArtifact?.path
      ? path.dirname(qualityArtifact.path)
      : preArtifact?.path
        ? path.dirname(preArtifact.path)
        : await findLatestEvidenceDirectory({ currentDirectory, fileSystem });

  return {
    evidenceDirectory,
    timestamp: path.basename(evidenceDirectory),
    station0: {
      localChecklist: Boolean(localChecklist?.content),
      jira: false
    },
    station1: {
      readmePresent,
      versionFiles
    },
    endpoints: {
      pre: preArtifact?.data,
      post: postArtifact?.data,
      parityMarkdown: parityArtifact?.content
    },
    quality: qualityArtifact?.data
  };
}

async function readTextIfExists(filePath, {
  fileSystem = { readFile }
} = {}) {
  try {
    return await fileSystem.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return undefined;
    }
    throw new SummaryError(`No se pudo leer: ${filePath}.`, { cause: error });
  }
}

async function findVersionFiles(projectDirectory, {
  fileSystem = { access }
} = {}) {
  const candidates = [
    'pom.xml',
    'gradle.properties',
    'build.gradle',
    'build.gradle.kts',
    'sonar-project.properties'
  ];
  const results = await Promise.all(
    candidates.map(async (name) =>
      (await exists(path.join(projectDirectory, name), { fileSystem })) ? name : undefined
    )
  );
  return results.filter(Boolean);
}

function assessMigration(evidence) {
  const parityStatus = parseParityStatus(evidence.endpoints.parityMarkdown);
  const coverageGate = evidence.quality?.coverage?.qualityGate;
  const sonarGate = evidence.quality?.sonar?.qualityGate;
  const stations = [
    {
      name: 'Estación 0 — Tareas',
      status: evidence.station0.localChecklist || evidence.station0.jira ? 'PASSED' : 'WARNING',
      detail: evidence.station0.localChecklist
        ? 'Checklist local encontrado.'
        : 'No se encontró checklist local en el historial.'
    },
    {
      name: 'Estación 1 — Versionado y README',
      status: evidence.station1.readmePresent && evidence.station1.versionFiles.length
        ? 'PASSED'
        : 'WARNING',
      detail: evidence.station1.readmePresent
        ? `README presente; archivos de versión detectados: ${evidence.station1.versionFiles.join(', ') || 'ninguno'}.`
        : 'No se encontró README.md en la ruta del microservicio.'
    },
    {
      name: 'Estación 2 — Cobertura',
      status: !coverageGate
        ? 'WARNING'
        : coverageGate.passed
          ? 'PASSED'
          : 'FAILED',
      detail: coverageGate
        ? `${coverageGate.linePercentage}% líneas (mínimo ${coverageGate.threshold}%).`
        : 'No hay evidencia de cobertura JaCoCo en el timestamp seleccionado.'
    },
    {
      name: 'Estación 2 — SonarQube',
      status: !sonarGate || sonarGate.status !== 'available'
        ? 'WARNING'
        : sonarGate.passed
          ? 'PASSED'
          : 'FAILED',
      detail: sonarGate?.status === 'available'
        ? `Quality Gate Sonar: ${sonarGate.passed ? 'superado' : 'no superado'}.`
        : 'SonarQube no está disponible o no fue configurado.'
    },
    {
      name: 'Estación 3 — Paridad API',
      status: parityStatus || 'WARNING',
      detail: parityStatus
        ? `Reporte de paridad: ${parityStatus}.`
        : 'No se encontró reporte de paridad PRE/POST.'
    }
  ];

  const status = stations.some((station) => station.status === 'FAILED')
    ? 'FAILED'
    : stations.some((station) => station.status === 'WARNING')
      ? 'WARNING'
      : 'PASSED';

  return { status, stations };
}

function parseParityStatus(markdown) {
  const match = /Estado global:\*\*\s+(PASSED|WARNING|FAILED)/.exec(markdown || '');
  return match?.[1];
}

function renderMigrationSummary({ microserviceName, evidence, assessment }) {
  const endpoints = evidence.endpoints;
  const endpointDetail = endpoints.pre && endpoints.post
    ? `PRE: ${endpoints.pre.results.length} endpoints; POST: ${endpoints.post.results.length} endpoints.`
    : 'No están disponibles ambos artefactos de endpoints.';

  return [
    `# Resumen Maestro de Migración: ${microserviceName}`,
    '',
    `- **Timestamp de evidencia:** ${evidence.timestamp}`,
    `- **Estado global:** ${assessment.status}`,
    '',
    '## Panel de estaciones',
    '',
    '| Estación | Estado | Detalle |',
    '| --- | --- | --- |',
    ...assessment.stations.map(
      (station) => `| ${station.name} | ${statusBadge(station.status)} | ${station.detail} |`
    ),
    '',
    '## Evidencia consolidada',
    '',
    `- Endpoints: ${endpointDetail}`,
    `- Directorio de evidencia: \`${evidence.evidenceDirectory}\``,
    `- Checklist Estación 0: ${evidence.station0.localChecklist ? 'localizado' : 'no localizado'}.`,
    `- README técnico: ${evidence.station1.readmePresent ? 'localizado' : 'no localizado'}.`,
    ''
  ].join('\n');
}

function statusBadge(status) {
  return status === 'PASSED'
    ? '🟢 PASSED'
    : status === 'WARNING'
      ? '🟡 WARNING'
      : '🔴 FAILED';
}

async function writeMigrationSummary(content, evidenceDirectory, {
  currentDirectory = inferProjectDirectory(evidenceDirectory),
  timestamp = new Date(),
  fileSystem = { mkdir, writeFile }
} = {}) {
  const historyDirectory = getHistoryDirectory(
    currentDirectory,
    3,
    'Resumen-Maestro',
    timestamp
  );
  const reportPath = path.join(historyDirectory, 'migration-summary.md');

  await fileSystem.mkdir(historyDirectory, { recursive: true });
  await fileSystem.writeFile(reportPath, content, 'utf8');
  return reportPath;
}

function inferProjectDirectory(evidenceDirectory) {
  const historyMarker = `${path.sep}.axetrules${path.sep}history`;
  const markerIndex = evidenceDirectory.lastIndexOf(historyMarker);

  return markerIndex >= 0
    ? evidenceDirectory.slice(0, markerIndex)
    : path.resolve(evidenceDirectory);
}

module.exports = {
  SummaryError,
  assessMigration,
  collectMigrationEvidence,
  findLatestArtifact,
  findLatestEvidenceDirectory,
  parseParityStatus,
  renderMigrationSummary,
  writeMigrationSummary
};
