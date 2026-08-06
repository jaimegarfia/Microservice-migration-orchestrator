'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  resolvePipelineSource,
  runMigrationPipeline
} = require('../src/commands/run');

test('pipeline continues after optional step failures and still writes the master summary', async () => {
  const output = [];
  const result = await runMigrationPipeline('/workspace/auth-service', {
    currentDirectory: '/workspace',
    output: (message) => output.push(message),
    discoverSources: async () => [
      { type: 'file', path: '/workspace/auth-service/docs/openapi.yaml' }
    ],
    runInit: async () => ({ mode: 'local' }),
    runPre: async () => ({ reportPath: 'pre.json' }),
    runRewrite: async () => ({ rewriterPath: 'rewriter.yml' }),
    runVersion: async () => {
      throw new Error('No se encontró un archivo de versión.');
    },
    runReadme: async () => ({ readmePath: 'README.md' }),
    runCoverage: async () => ({ evidencePath: 'quality.json' }),
    runSonar: async () => {
      throw new Error('SonarQube no configurado.');
    },
    runSummary: async () => ({ reportPath: 'migration-summary.md' })
  });

  assert.equal(result.source, '/workspace/auth-service/docs/openapi.yaml');
  assert.equal(result.stations.summary.reportPath, 'migration-summary.md');
  assert.equal(result.warnings.length, 3);
  assert.match(result.warnings[0], /Estación 1 — versionado/);
  assert.match(result.warnings[1], /Estación 2 — SonarQube/);
  assert.match(result.warnings[2], /POST omitida/);
  assert.ok(output.some((message) => String(message).includes('[WARNING]')));
});

test('pipeline source discovery warns when no OpenAPI or Postman definition exists', async () => {
  const result = { warnings: [] };
  const output = [];
  const source = await resolvePipelineSource(undefined, '/workspace/auth-service', {
    discoverSources: async () => [],
    result,
    output: (message) => output.push(message)
  });

  assert.equal(source, undefined);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /No se encontró OpenAPI/);
});
