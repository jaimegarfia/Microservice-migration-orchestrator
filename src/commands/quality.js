'use strict';

const path = require('node:path');
const pc = require('picocolors');
const {
  analyzeCoverage,
  createStation2Evidence,
  evaluateSonarQualityGate,
  fetchSonarMetrics,
  readSonarProjectKey,
  writeStation2Evidence
} = require('../services/quality');

async function runCoverageCommand(projectDirectory = process.cwd(), {
  currentDirectory = process.cwd(),
  output = console.log,
  progress = {},
  runAnalysis = analyzeCoverage,
  writeEvidence = writeStation2Evidence
} = {}) {
  const directory = path.resolve(projectDirectory);
  progress.onStart?.({ type: 'coverage' });

  const coverage = await runAnalysis(directory, {
    onBuildStart: progress.onBuildStart
  });
  const evidence = createStation2Evidence(directory, coverage, {
    status: 'not-run',
    message: 'SonarQube no se ejecutó en este comando.'
  });
  const evidencePath = await writeEvidence(evidence, { currentDirectory });

  printCoverageSummary(coverage, evidencePath, output);

  return { coverage, evidence, evidencePath };
}

async function runSonarCommand(projectDirectory = process.cwd(), {
  currentDirectory = process.cwd(),
  environment = process.env,
  output = console.log,
  fetchImplementation = globalThis.fetch,
  readProjectKey = readSonarProjectKey,
  fetchMetrics = fetchSonarMetrics,
  writeEvidence = writeStation2Evidence
} = {}) {
  const directory = path.resolve(projectDirectory);
  const projectKey = await readProjectKey(directory);
  const metrics = await fetchMetrics({
    hostUrl: environment.SONAR_HOST_URL,
    token: environment.SONAR_TOKEN,
    projectKey,
    fetchImplementation
  });
  const gate = evaluateSonarQualityGate(metrics);
  const sonar = { metrics, qualityGate: gate };
  const evidence = createStation2Evidence(directory, null, sonar);
  const evidencePath = await writeEvidence(evidence, { currentDirectory });

  printSonarSummary(sonar, evidencePath, output);

  return { sonar, evidence, evidencePath };
}

async function runStation2Quality(projectDirectory = process.cwd(), {
  currentDirectory = process.cwd(),
  environment = process.env,
  output = console.log,
  fetchImplementation = globalThis.fetch,
  progress = {},
  runCoverage = analyzeCoverage,
  readProjectKey = readSonarProjectKey,
  fetchMetrics = fetchSonarMetrics,
  writeEvidence = writeStation2Evidence
} = {}) {
  const directory = path.resolve(projectDirectory);
  progress.onCoverageStart?.();

  const coverage = await runCoverage(directory, {
    onBuildStart: progress.onBuildStart
  });
  progress.onSonarStart?.();

  const projectKey = await readProjectKey(directory);
  const metrics = await fetchMetrics({
    hostUrl: environment.SONAR_HOST_URL,
    token: environment.SONAR_TOKEN,
    projectKey,
    fetchImplementation
  });
  const sonar = {
    metrics,
    qualityGate: evaluateSonarQualityGate(metrics)
  };
  const evidence = createStation2Evidence(directory, coverage, sonar);
  const evidencePath = await writeEvidence(evidence, { currentDirectory });

  printCoverageSummary(coverage, evidencePath, output);
  printSonarSummary(sonar, evidencePath, output);

  return { coverage, sonar, evidence, evidencePath };
}

function printCoverageSummary(coverage, evidencePath, output) {
  const gate = coverage.qualityGate;
  output('');
  output(
    pc.bold(
      gate.passed
        ? pc.green('JaCoCo Quality Gate superado')
        : pc.red('JaCoCo Quality Gate no superado')
    )
  );
  output(
    `Líneas: ${formatGateValue(gate.linePercentage, gate.passed)} (mínimo ${gate.threshold}%)`
  );
  output(`Ramas: ${coverage.coverage.branch.percentage}%`);

  if (coverage.priorities.length) {
    output(pc.bold('Top clases prioritarias por ROI:'));
    for (const priority of coverage.priorities) {
      output(
        `- ${priority.name}: ${priority.lineCoverage}% líneas, complejidad ${priority.complexity}, ROI ${priority.roiScore}`
      );
    }
  }

  output(`Evidencia: ${evidencePath}`);
}

function printSonarSummary(sonar, evidencePath, output) {
  output('');
  if (sonar.metrics.status !== 'available') {
    output(pc.yellow('SonarQube no configurado'));
    output(sonar.metrics.message);
    output(`Evidencia: ${evidencePath}`);
    return;
  }

  output(
    pc.bold(
      sonar.qualityGate.passed
        ? pc.green('SonarQube Quality Gate superado')
        : pc.red('SonarQube Quality Gate no superado')
    )
  );

  for (const check of sonar.qualityGate.checks) {
    const value = `${check.name}: ${check.value} (objetivo ${
      check.name === 'Code Smells' ? '<' : '≤'
    } ${check.threshold})`;
    output(check.passed ? pc.green(value) : pc.red(value));
  }

  output(`Deuda técnica: ${sonar.metrics.technicalDebtMinutes} min`);
  output(`Evidencia: ${evidencePath}`);
}

function formatGateValue(value, passed) {
  const text = `${value}%`;
  return passed ? pc.green(text) : pc.red(text);
}

module.exports = {
  printCoverageSummary,
  printSonarSummary,
  runCoverageCommand,
  runSonarCommand,
  runStation2Quality
};
