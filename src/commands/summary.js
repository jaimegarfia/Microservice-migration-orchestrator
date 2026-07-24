'use strict';

const path = require('node:path');
const pc = require('picocolors');
const {
  assessMigration,
  collectMigrationEvidence,
  renderMigrationSummary,
  writeMigrationSummary
} = require('../services/summary');

async function runMigrationSummary(microserviceName, {
  currentDirectory = process.cwd(),
  microservicePath = currentDirectory,
  output = console.log,
  collectEvidence = collectMigrationEvidence,
  writeSummary = writeMigrationSummary
} = {}) {
  if (typeof microserviceName !== 'string' || !microserviceName.trim()) {
    throw new Error('Indica el microservicio: migration-cli summary <microserviceName>.');
  }

  const evidence = await collectEvidence(microserviceName.trim(), {
    currentDirectory,
    microservicePath: path.resolve(microservicePath)
  });
  const assessment = assessMigration(evidence);
  const content = renderMigrationSummary({
    microserviceName: microserviceName.trim(),
    evidence,
    assessment
  });
  const reportPath = await writeSummary(content, evidence.evidenceDirectory);

  printMigrationSummary(assessment, reportPath, output);

  return { evidence, assessment, content, reportPath };
}

function printMigrationSummary(assessment, reportPath, output) {
  const title = assessment.status === 'PASSED'
    ? pc.green('Resumen maestro: PASSED')
    : assessment.status === 'WARNING'
      ? pc.yellow('Resumen maestro: WARNING')
      : pc.red('Resumen maestro: FAILED');

  output('');
  output(pc.bold(title));
  for (const station of assessment.stations) {
    const status = station.status === 'PASSED'
      ? pc.green(station.status)
      : station.status === 'WARNING'
        ? pc.yellow(station.status)
        : pc.red(station.status);
    output(`- ${station.name}: ${status}`);
  }
  output(`Reporte maestro: ${reportPath}`);
}

module.exports = {
  printMigrationSummary,
  runMigrationSummary
};
