'use strict';

const path = require('node:path');
const { mkdir, readFile, readdir, writeFile } = require('node:fs/promises');
const {
  collectMigrationEvidence,
  findLatestArtifact,
  SummaryError
} = require('../services/summary');
const { getHistoryDirectory } = require('../utils/history');

const STATION_NUMBERS = new Set(['0', '1', '2', '3', '4']);

async function runCommentCommand(stationNumber, {
  currentDirectory = process.cwd(),
  output = console.log,
  fileSystem = { mkdir, readFile, readdir, writeFile }
} = {}) {
  const station = validateStationNumber(stationNumber);
  const commentMarkdown = await buildStationComment(station, {
    currentDirectory,
    fileSystem
  });
  const commentPath = await writeManualComment(station, commentMarkdown, {
    currentDirectory,
    fileSystem
  });

  output('');
  output(commentMarkdown);
  output('');
  output(`Comentario manual de Estación ${station} generado en: ${commentPath}`);
  output('Copia el contenido y pégalo manualmente en la tarea corporativa de Jira.');

  return { station, commentMarkdown, commentPath };
}

async function buildStationComment(station, {
  currentDirectory = process.cwd(),
  fileSystem = { readFile, readdir }
} = {}) {
  if (station === '0') {
    return [
      'ESTACIÓN 0 SUPERADA',
      '',
      'Rama migración: <URL_DE_LA_RAMA_BITBUCKET>',
      '',
      'Para obtener el token:',
      '- Para ATLAS: curl.exe -k -X POST "https://security-dev.npapps.ocp.es.wcorp.carrefour.com/service-auth-server-v1/oauth/token?grant_type=client_credentials" -H "Authorization: Basic QVBMSUFQT0w6NFAwTDBDNFJSM0YwVVI="',
      '- Para AGORA: Hacer login en la aplicación con ADMIN001:ADMIN001 y capturar el token Bearer desde la pestaña RED de las herramientas de desarrollador del navegador.',
      '',
      '[Adjuntar capturas de pantalla de los endpoints PRE]'
    ].join('\n');
  }

  let evidence;
  try {
    evidence = await collectMigrationEvidence('unknown', {
      currentDirectory,
      microservicePath: currentDirectory,
      fileSystem
    });
  } catch (error) {
    if (!(error instanceof SummaryError)) {
      throw error;
    }
    evidence = undefined;
  }

  const details = station === '1'
    ? [
      `- README técnico: ${evidence?.station1.readmePresent ? 'disponible' : 'no disponible'}.`,
      `- Archivos de versión: ${evidence?.station1.versionFiles.join(', ') || 'no detectados'}.`
    ]
    : station === '2'
      ? [
        `- JaCoCo: ${formatQualityGate(evidence?.quality?.coverage?.qualityGate)}.`,
        `- SonarQube: ${formatSonarGate(evidence?.quality?.sonar?.qualityGate)}.`
      ]
      : station === '3'
        ? [
          `- Baseline PRE: ${evidence?.endpoints.pre ? 'disponible' : 'no disponible'}.`,
          `- Resultados POST: ${evidence?.endpoints.post ? 'disponibles' : 'no disponibles'}.`,
          `- Reporte de paridad: ${evidence?.endpoints.parityMarkdown ? 'disponible' : 'no disponible'}.`
        ]
        : [
          `- Resumen maestro: ${evidence?.summary ? 'disponible' : 'no disponible'}.`,
          '- Evidencia CAB: revisar y adjuntar el resumen maestro a la documentación de entrega.'
        ];

  return [
    `ESTACIÓN ${station} SUPERADA`,
    '',
    ...details,
    '',
    `[Adjuntar las evidencias de la Estación ${station}]`
  ].join('\n');
}

async function writeManualComment(station, commentMarkdown, {
  currentDirectory = process.cwd(),
  fileSystem = { mkdir, writeFile }
} = {}) {
  const timestamp = new Date();
  const historyDirectory = getHistoryDirectory(
    currentDirectory,
    station,
    `Jira-Comentario-${station}`,
    timestamp
  );
  const commentPath = path.join(
    historyDirectory,
    `jira-comment-station-${station}.md`
  );

  await fileSystem.mkdir(historyDirectory, { recursive: true });
  await fileSystem.writeFile(commentPath, `${commentMarkdown}\n`, 'utf8');

  return commentPath;
}

function validateStationNumber(stationNumber) {
  const station = String(stationNumber || '').trim();
  if (!STATION_NUMBERS.has(station)) {
    throw new Error('La estación debe ser 0, 1, 2, 3 o 4.');
  }
  return station;
}

async function findLatestChecklist(currentDirectory, fileSystem) {
  try {
    const evidence = await collectMigrationEvidence('unknown', {
      currentDirectory,
      microservicePath: currentDirectory,
      fileSystem
    });
    return evidence.station0.localChecklist
      ? path.join(currentDirectory, '.axetrules', 'history', 'jira-tasks-unknown.md')
      : undefined;
  } catch (error) {
    if (error instanceof SummaryError) {
      return undefined;
    }
    throw error;
  }
}

function formatQualityGate(gate) {
  if (!gate) {
    return 'no disponible';
  }
  return `${gate.passed ? 'superado' : 'no superado'} (${gate.linePercentage}% de líneas; mínimo ${gate.threshold}%)`;
}

function formatSonarGate(gate) {
  if (!gate || gate.status !== 'available') {
    return 'no disponible o no configurado';
  }
  return gate.passed ? 'superado' : 'no superado';
}

module.exports = {
  STATION_NUMBERS,
  buildStationComment,
  findLatestChecklist,
  formatQualityGate,
  formatSonarGate,
  runCommentCommand,
  validateStationNumber,
  writeManualComment
};
