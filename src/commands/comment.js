'use strict';

const path = require('node:path');
const { access, readFile, readdir } = require('node:fs/promises');
const { JiraClient } = require('../services/jira');
const {
  collectMigrationEvidence,
  findLatestArtifact,
  SummaryError
} = require('../services/summary');

const STATION_NUMBERS = new Set(['0', '1', '2', '3']);

async function runCommentCommand(stationNumber, {
  currentDirectory = process.cwd(),
  environment = process.env,
  output = console.log,
  jiraClientFactory = JiraClient.fromEnvironment,
  fileSystem = { access, readFile, readdir }
} = {}) {
  const station = validateStationNumber(stationNumber);
  const configuredEnvironment = await loadProjectEnvironment(
    currentDirectory,
    environment,
    fileSystem
  );
  const issueKey = configuredEnvironment.JIRA_ISSUE_KEY;

  if (!issueKey) {
    throw new Error(
      'No se encontró JIRA_ISSUE_KEY. Ejecuta "migration-cli init <microservicio> --jira-issue <KEY o URL>" primero.'
    );
  }

  const commentMarkdown = await buildStationComment(station, {
    currentDirectory,
    fileSystem
  });
  const jiraClient = jiraClientFactory(configuredEnvironment);
  const comment = await jiraClient.postJiraComment(issueKey, commentMarkdown);

  output(`Comentario de Estación ${station} publicado en Jira: ${comment.issueKey}`);
  return { station, comment, commentMarkdown };
}

async function buildStationComment(station, {
  currentDirectory = process.cwd(),
  fileSystem = { access, readFile, readdir }
} = {}) {
  const title = `## Evidencia de migración — Estación ${station}`;
  const generatedAt = new Date().toISOString();

  if (station === '0') {
    const pre = await findLatestArtifact('endpoints-pre.json', {
      currentDirectory,
      fileSystem
    });
    const checklist = await findLatestChecklist(currentDirectory, fileSystem);

    return [
      title,
      '',
      `- **Fecha UTC:** ${generatedAt}`,
      `- Baseline PRE: ${pre ? `disponible (\`${pre.path}\`)` : 'no disponible'}.`,
      `- Checklist local: ${checklist ? `disponible (\`${checklist}\`)` : 'no disponible'}.`,
      '',
      'La estación 0 ha finalizado y sus artefactos quedan registrados en el repositorio.'
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
      : [
        `- Baseline PRE: ${evidence?.endpoints.pre ? 'disponible' : 'no disponible'}.`,
        `- Resultados POST: ${evidence?.endpoints.post ? 'disponibles' : 'no disponibles'}.`,
        `- Reporte de paridad: ${evidence?.endpoints.parityMarkdown ? 'disponible' : 'no disponible'}.`
      ];

  return [
    title,
    '',
    `- **Fecha UTC:** ${generatedAt}`,
    ...details,
    '',
    `La estación ${station} ha finalizado y la evidencia queda registrada en el repositorio.`
  ].join('\n');
}

function validateStationNumber(stationNumber) {
  const station = String(stationNumber || '').trim();
  if (!STATION_NUMBERS.has(station)) {
    throw new Error('La estación debe ser 0, 1, 2 o 3.');
  }
  return station;
}

async function loadProjectEnvironment(currentDirectory, environment, fileSystem) {
  const envPath = path.join(currentDirectory, '.env');
  let fileEnvironment = {};

  try {
    fileEnvironment = parseEnvironmentFile(
      await fileSystem.readFile(envPath, 'utf8')
    );
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`No se pudo leer ${envPath}.`, { cause: error });
    }
  }

  return { ...fileEnvironment, ...environment };
}

function parseEnvironmentFile(content) {
  return Object.fromEntries(
    String(content)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        return separator === -1
          ? [line, '']
          : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      })
  );
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
  loadProjectEnvironment,
  parseEnvironmentFile,
  runCommentCommand,
  validateStationNumber
};
