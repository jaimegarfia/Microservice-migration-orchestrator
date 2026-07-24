'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PARITY_STATUS,
  compareEndpointResults,
  createParityReport,
  renderParityMarkdown,
  summarizeParity
} = require('../src/services/parity');
const {
  assessMigration,
  parseParityStatus,
  renderMigrationSummary
} = require('../src/services/summary');

function endpoint(endpoint, {
  status = 200,
  responseHash = 'same',
  responseTimeMs = 100
} = {}) {
  return { endpoint, status, responseHash, responseTimeMs };
}

test('classifies endpoint parity as match, warning, and breaking change', () => {
  const pre = [
    endpoint('/match'),
    endpoint('/payload'),
    endpoint('/slow'),
    endpoint('/broken')
  ];
  const post = [
    endpoint('/match'),
    endpoint('/payload', { responseHash: 'different' }),
    endpoint('/slow', { responseTimeMs: 151 }),
    endpoint('/broken', { status: 500 })
  ];

  const comparisons = compareEndpointResults(pre, post);
  const statuses = Object.fromEntries(
    comparisons.map((comparison) => [comparison.endpoint, comparison.status])
  );

  assert.equal(statuses['/match'], PARITY_STATUS.MATCH);
  assert.equal(statuses['/payload'], PARITY_STATUS.WARNING);
  assert.equal(statuses['/slow'], PARITY_STATUS.WARNING);
  assert.equal(statuses['/broken'], PARITY_STATUS.BREAKING_CHANGE);

  const summary = summarizeParity(comparisons);
  assert.deepEqual(summary, {
    total: 4,
    matches: 1,
    warnings: 2,
    breakingChanges: 1,
    status: 'FAILED'
  });
});

test('marks unavailable endpoints as breaking changes and new endpoints as warnings', () => {
  const comparisons = compareEndpointResults(
    [endpoint('/removed'), endpoint('/same')],
    [endpoint('/same'), endpoint('/new')]
  );

  const byEndpoint = Object.fromEntries(
    comparisons.map((comparison) => [comparison.endpoint, comparison])
  );

  assert.equal(byEndpoint['/removed'].status, PARITY_STATUS.BREAKING_CHANGE);
  assert.equal(byEndpoint['/new'].status, PARITY_STATUS.WARNING);
  assert.equal(byEndpoint['/same'].status, PARITY_STATUS.MATCH);
});

test('renders a markdown parity report with comparison details', () => {
  const report = createParityReport({
    microservice: 'sample-service',
    preReport: {
      timestamp: '2026-07-24T08:00:00.000Z',
      results: [endpoint('/health')]
    },
    postReport: {
      timestamp: '2026-07-24T09:00:00.000Z',
      results: [endpoint('/health')]
    },
    comparisons: compareEndpointResults(
      [endpoint('/health')],
      [endpoint('/health')]
    )
  });
  const markdown = renderParityMarkdown(report);

  assert.equal(report.summary.status, 'PASSED');
  assert.match(markdown, /# Reporte de Paridad API: sample-service/);
  assert.match(markdown, /🟢 MATCH/);
  assert.match(markdown, /\| `\/health`/);
});

test('creates a failed master summary when one quality gate fails', () => {
  const evidence = {
    timestamp: '2026-07-24T09-00-00-000Z',
    evidenceDirectory: 'C:\\history\\2026-07-24T09-00-00-000Z',
    station0: { localChecklist: true, jira: false },
    station1: { readmePresent: true, versionFiles: ['pom.xml'] },
    endpoints: {
      pre: { results: [endpoint('/health')] },
      post: { results: [endpoint('/health')] },
      parityMarkdown: '# Reporte de Paridad API: sample-service\n\n- **Estado global:** PASSED'
    },
    quality: {
      coverage: {
        qualityGate: {
          passed: false,
          linePercentage: 42,
          threshold: 60
        }
      },
      sonar: {
        qualityGate: {
          status: 'available',
          passed: true
        }
      }
    }
  };

  const assessment = assessMigration(evidence);
  const markdown = renderMigrationSummary({
    microserviceName: 'sample-service',
    evidence,
    assessment
  });

  assert.equal(assessment.status, 'FAILED');
  assert.equal(
    assessment.stations.find((station) => station.name.includes('Cobertura')).status,
    'FAILED'
  );
  assert.equal(parseParityStatus(evidence.endpoints.parityMarkdown), 'PASSED');
  assert.match(markdown, /Estado global:\*\* FAILED/);
  assert.match(markdown, /Estación 3 — Paridad API/);
  assert.match(markdown, /🟢 PASSED/);
});

test('returns warning master status when evidence is incomplete but no gate fails', () => {
  const assessment = assessMigration({
    station0: { localChecklist: false, jira: false },
    station1: { readmePresent: false, versionFiles: [] },
    endpoints: {},
    quality: undefined
  });

  assert.equal(assessment.status, 'WARNING');
  assert.ok(assessment.stations.every((station) => station.status === 'WARNING'));
});
