'use strict';

const path = require('node:path');
const { access, mkdir, readFile, writeFile } = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getHistoryDirectory } = require('../utils/history');

const execFileAsync = promisify(execFile);
const COVERAGE_THRESHOLD = 60;
const SONAR_THRESHOLDS = {
  codeSmells: 30,
  bugs: 0,
  securityHotspots: 0
};

class QualityAnalysisError extends Error {
  constructor(message, { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'QualityAnalysisError';
  }
}

async function detectBuildTool(projectDirectory = process.cwd(), {
  fileSystem = { access }
} = {}) {
  const candidates = [
    { tool: 'maven', files: ['mvnw', 'pom.xml'] },
    { tool: 'gradle', files: ['gradlew', 'build.gradle', 'build.gradle.kts'] }
  ];

  for (const candidate of candidates) {
    for (const fileName of candidate.files) {
      try {
        await fileSystem.access(path.join(projectDirectory, fileName));
        return candidate.tool;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw new QualityAnalysisError(
            `No se pudo acceder a ${fileName}.`,
            { cause: error }
          );
        }
      }
    }
  }

  throw new QualityAnalysisError(
    'No se detectó Maven ni Gradle. Se requiere pom.xml, mvnw, build.gradle o gradlew.'
  );
}

function getCoverageCommand(buildTool, platform = process.platform) {
  const isWindows = platform === 'win32';

  if (buildTool === 'maven') {
    return isWindows
      ? { command: 'mvn.cmd', args: ['test', 'jacoco:report'] }
      : { command: './mvnw', args: ['test', 'jacoco:report'], fallback: 'mvn' };
  }

  if (buildTool === 'gradle') {
    return isWindows
      ? { command: 'gradle.bat', args: ['test', 'jacocoTestReport'] }
      : {
          command: './gradlew',
          args: ['test', 'jacocoTestReport'],
          fallback: 'gradle'
        };
  }

  throw new QualityAnalysisError(`Herramienta de build no soportada: ${buildTool}.`);
}

async function runCoverageBuild(projectDirectory, buildTool, {
  execute = execFileAsync,
  platform = process.platform
} = {}) {
  const definition = getCoverageCommand(buildTool, platform);

  try {
    await execute(definition.command, definition.args, {
      cwd: projectDirectory,
      windowsHide: true
    });
  } catch (error) {
    if (!definition.fallback || error.code !== 'ENOENT') {
      throw new QualityAnalysisError(
        `Falló la generación de cobertura con ${definition.command}: ${error.message}`,
        { cause: error }
      );
    }

    try {
      await execute(definition.fallback, definition.args, {
        cwd: projectDirectory,
        windowsHide: true
      });
    } catch (fallbackError) {
      throw new QualityAnalysisError(
        `Falló la generación de cobertura con ${definition.fallback}: ${fallbackError.message}`,
        { cause: fallbackError }
      );
    }
  }
}

async function findJacocoReport(projectDirectory, buildTool, {
  fileSystem = { access }
} = {}) {
  const relativePaths = buildTool === 'maven'
    ? ['target/site/jacoco/jacoco.xml', 'target/site/jacoco-ut/jacoco.xml']
    : [
        'build/reports/jacoco/test/jacocoTestReport.xml',
        'build/reports/jacoco/jacocoTestReport.xml'
      ];

  for (const relativePath of relativePaths) {
    const reportPath = path.join(projectDirectory, relativePath);
    try {
      await fileSystem.access(reportPath);
      return reportPath;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new QualityAnalysisError(
          `No se pudo acceder al informe JaCoCo: ${reportPath}.`,
          { cause: error }
        );
      }
    }
  }

  throw new QualityAnalysisError(
    `No se encontró un informe JaCoCo para ${buildTool}.`
  );
}

function parseJacocoReport(xml) {
  if (typeof xml !== 'string' || !xml.includes('<report')) {
    throw new QualityAnalysisError('El informe JaCoCo XML no es válido.');
  }

  const classes = [];
  const packagePattern = /<package\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/package>/g;
  for (const packageMatch of xml.matchAll(packagePattern)) {
    const packageName = packageMatch[1].replace(/\//g, '.');
    const packageContent = packageMatch[2];
    const classPattern = /<class\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/class>/g;

    for (const classMatch of packageContent.matchAll(classPattern)) {
      const counters = parseCounters(classMatch[2]);
      classes.push({
        package: packageName,
        name: classMatch[1].replace(/\//g, '.'),
        line: counters.LINE || emptyCounter(),
        branch: counters.BRANCH || emptyCounter(),
        complexity: counters.COMPLEXITY || emptyCounter()
      });
    }
  }

  const line = aggregateCounters(classes, 'line');
  const branch = aggregateCounters(classes, 'branch');

  return {
    line: toCoverageMetric(line),
    branch: toCoverageMetric(branch),
    classes: classes.map((item) => ({
      ...item,
      line: toCoverageMetric(item.line),
      branch: toCoverageMetric(item.branch),
      complexity: toComplexityMetric(item.complexity)
    }))
  };
}

function parseCounters(content) {
  const counters = {};

  for (const match of content.matchAll(
    /<counter\b[^>]*type="([^"]+)"[^>]*missed="(\d+)"[^>]*covered="(\d+)"[^/]*\/>/g
  )) {
    counters[match[1]] = {
      missed: Number(match[2]),
      covered: Number(match[3])
    };
  }

  return counters;
}

function emptyCounter() {
  return { missed: 0, covered: 0 };
}

function aggregateCounters(classes, field) {
  return classes.reduce(
    (total, item) => ({
      missed: total.missed + item[field].missed,
      covered: total.covered + item[field].covered
    }),
    emptyCounter()
  );
}

function toCoverageMetric(counter) {
  const total = counter.missed + counter.covered;
  return {
    missed: counter.missed,
    covered: counter.covered,
    total,
    percentage: total === 0 ? 100 : roundPercentage(counter.covered, total)
  };
}

function toComplexityMetric(counter) {
  return {
    missed: counter.missed,
    covered: counter.covered,
    total: counter.missed + counter.covered
  };
}

function roundPercentage(numerator, denominator) {
  return Math.round((numerator / denominator) * 10000) / 100;
}

function calculateCoverageGate(coverage, threshold = COVERAGE_THRESHOLD) {
  return {
    threshold,
    passed: coverage.line.percentage >= threshold,
    linePercentage: coverage.line.percentage,
    branchPercentage: coverage.branch.percentage
  };
}

function rankCoveragePriorities(classes, limit = 5) {
  return [...classes]
    .map((item) => {
      const uncoveredLines = item.line.missed;
      const complexity = item.complexity.total;
      const coverageGap = Math.max(0, 100 - item.line.percentage);
      const roiScore = Math.round(
        (uncoveredLines * 2 + complexity) * (1 + coverageGap / 100)
      );

      return {
        name: item.name,
        package: item.package,
        lineCoverage: item.line.percentage,
        branchCoverage: item.branch.percentage,
        complexity,
        uncoveredLines,
        roiScore
      };
    })
    .sort(
      (first, second) =>
        second.roiScore - first.roiScore ||
        first.lineCoverage - second.lineCoverage ||
        second.complexity - first.complexity
    )
    .slice(0, limit);
}

async function analyzeCoverage(projectDirectory = process.cwd(), {
  runBuild = true,
  fileSystem = { readFile, access },
  execute = execFileAsync,
  platform = process.platform,
  onBuildStart = () => {}
} = {}) {
  const directory = path.resolve(projectDirectory);
  const buildTool = await detectBuildTool(directory, { fileSystem });

  if (runBuild) {
    onBuildStart({ buildTool });
    await runCoverageBuild(directory, buildTool, { execute, platform });
  }

  const reportPath = await findJacocoReport(directory, buildTool, { fileSystem });
  const coverage = parseJacocoReport(
    await fileSystem.readFile(reportPath, 'utf8')
  );

  return {
    buildTool,
    reportPath,
    coverage,
    qualityGate: calculateCoverageGate(coverage),
    priorities: rankCoveragePriorities(coverage.classes)
  };
}

async function readSonarProjectKey(projectDirectory, {
  fileSystem = { readFile }
} = {}) {
  const configurationPath = path.join(projectDirectory, 'sonar-project.properties');

  try {
    const content = await fileSystem.readFile(configurationPath, 'utf8');
    return /^sonar\.projectKey\s*=\s*([^\s#]+)\s*$/m.exec(content)?.[1];
  } catch (error) {
    if (error.code === 'ENOENT') {
      return undefined;
    }
    throw new QualityAnalysisError(
      `No se pudo leer sonar-project.properties.`,
      { cause: error }
    );
  }
}

async function fetchSonarMetrics({
  hostUrl = process.env.SONAR_HOST_URL,
  token = process.env.SONAR_TOKEN,
  projectKey,
  fetchImplementation = globalThis.fetch
} = {}) {
  if (!hostUrl || !token || !projectKey) {
    return {
      status: 'not-configured',
      projectKey,
      message: 'Configura SONAR_HOST_URL, SONAR_TOKEN y sonar.projectKey para consultar SonarQube.'
    };
  }

  if (typeof fetchImplementation !== 'function') {
    throw new QualityAnalysisError('No hay fetch disponible para consultar SonarQube.');
  }

  let url;
  try {
    url = new URL('/api/measures/component', hostUrl);
    url.searchParams.set('component', projectKey);
    url.searchParams.set(
      'metricKeys',
      'code_smells,bugs,security_hotspots,sqale_index'
    );
  } catch (error) {
    throw new QualityAnalysisError(
      'SONAR_HOST_URL debe ser una URL HTTP(S) válida.',
      { cause: error }
    );
  }

  const response = await fetchImplementation(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new QualityAnalysisError(
      `SonarQube respondió con HTTP ${response.status}.`
    );
  }

  const payload = await response.json();
  const values = Object.fromEntries(
    (payload.component?.measures || []).map((measure) => [
      measure.metric,
      Number(measure.value || 0)
    ])
  );

  return {
    status: 'available',
    projectKey,
    codeSmells: values.code_smells || 0,
    bugs: values.bugs || 0,
    securityHotspots: values.security_hotspots || 0,
    technicalDebtMinutes: values.sqale_index || 0
  };
}

function evaluateSonarQualityGate(metrics, thresholds = SONAR_THRESHOLDS) {
  if (metrics.status !== 'available') {
    return {
      status: metrics.status,
      passed: false,
      thresholds,
      checks: []
    };
  }

  const checks = [
    {
      name: 'Code Smells',
      value: metrics.codeSmells,
      threshold: thresholds.codeSmells,
      passed: metrics.codeSmells < thresholds.codeSmells
    },
    {
      name: 'Bugs',
      value: metrics.bugs,
      threshold: thresholds.bugs,
      passed: metrics.bugs <= thresholds.bugs
    },
    {
      name: 'Hotspots de seguridad',
      value: metrics.securityHotspots,
      threshold: thresholds.securityHotspots,
      passed: metrics.securityHotspots <= thresholds.securityHotspots
    }
  ];

  return {
    status: 'available',
    passed: checks.every((check) => check.passed),
    thresholds,
    checks
  };
}

function createStation2Evidence(projectDirectory, coverage, sonar, timestamp = new Date()) {
  return {
    timestamp: timestamp.toISOString(),
    phase: 'STATION_2',
    projectDirectory: path.resolve(projectDirectory),
    coverage,
    sonar
  };
}

async function writeStation2Evidence(evidence, {
  currentDirectory = process.cwd(),
  fileSystem = { mkdir, writeFile }
} = {}) {
  const historyDirectory = getHistoryDirectory(
    currentDirectory,
    2,
    'JacocoSonar',
    evidence.timestamp
  );
  const evidencePath = path.join(historyDirectory, 'station2-quality.json');
  const markdownPath = path.join(historyDirectory, 'station2-quality.md');

  await fileSystem.mkdir(historyDirectory, { recursive: true });
  await fileSystem.writeFile(
    evidencePath,
    `${JSON.stringify(evidence, null, 2)}\n`,
    'utf8'
  );
  await fileSystem.writeFile(
    markdownPath,
    renderStation2Markdown(evidence),
    'utf8'
  );

  return evidencePath;
}

function renderStation2Markdown(evidence) {
  const coverageGate = evidence.coverage?.qualityGate;
  const sonarGate = evidence.sonar?.qualityGate;
  const priorityRows = evidence.coverage?.priorities?.map((priority) =>
    `| ${priority.name} | ${priority.lineCoverage}% | ${priority.complexity} | ${priority.roiScore} |`
  ) || [];

  return [
    '# Evidencia de calidad — Estación 2',
    '',
    `- **Proyecto:** \`${evidence.projectDirectory}\``,
    `- **Timestamp:** ${evidence.timestamp}`,
    '',
    '## JaCoCo',
    '',
    `- **Estado:** ${coverageGate ? (coverageGate.passed ? 'PASSED' : 'FAILED') : 'No ejecutado'}`,
    `- **Cobertura de líneas:** ${coverageGate?.linePercentage ?? '-'}%`,
    `- **Umbral:** ${coverageGate?.threshold ?? '-'}%`,
    '',
    '## SonarQube',
    '',
    `- **Estado:** ${sonarGate?.passed ? 'PASSED' : sonarGate?.status || 'No configurado'}`,
    `- **Code Smells:** ${sonarGate?.checks?.find((check) => check.name === 'Code Smells')?.value ?? '-'}`,
    `- **Bugs:** ${sonarGate?.checks?.find((check) => check.name === 'Bugs')?.value ?? '-'}`,
    `- **Hotspots de seguridad:** ${sonarGate?.checks?.find((check) => check.name === 'Hotspots de seguridad')?.value ?? '-'}`,
    '',
    '## Prioridades de cobertura',
    '',
    '| Clase | Cobertura de líneas | Complejidad | ROI |',
    '| --- | ---: | ---: | ---: |',
    ...priorityRows,
    ''
  ].join('\n');
}

module.exports = {
  COVERAGE_THRESHOLD,
  SONAR_THRESHOLDS,
  QualityAnalysisError,
  analyzeCoverage,
  calculateCoverageGate,
  createStation2Evidence,
  detectBuildTool,
  evaluateSonarQualityGate,
  fetchSonarMetrics,
  findJacocoReport,
  getCoverageCommand,
  parseJacocoReport,
  rankCoveragePriorities,
  readSonarProjectKey,
  runCoverageBuild,
  renderStation2Markdown,
  writeStation2Evidence
};
