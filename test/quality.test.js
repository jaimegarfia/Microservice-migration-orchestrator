'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  COVERAGE_THRESHOLD,
  calculateCoverageGate,
  evaluateSonarQualityGate,
  fetchSonarMetrics,
  parseJacocoReport,
  rankCoveragePriorities
} = require('../src/services/quality');

const JACOCO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<report name="demo">
  <package name="com/example/api">
    <class name="com/example/api/UserController">
      <counter type="LINE" missed="8" covered="2"/>
      <counter type="BRANCH" missed="4" covered="0"/>
      <counter type="COMPLEXITY" missed="5" covered="1"/>
    </class>
    <class name="com/example/api/HealthController">
      <counter type="LINE" missed="0" covered="10"/>
      <counter type="BRANCH" missed="0" covered="2"/>
      <counter type="COMPLEXITY" missed="0" covered="2"/>
    </class>
  </package>
  <package name="com/example/service">
    <class name="com/example/service/UserService">
      <counter type="LINE" missed="12" covered="8"/>
      <counter type="BRANCH" missed="6" covered="2"/>
      <counter type="COMPLEXITY" missed="8" covered="2"/>
    </class>
  </package>
</report>`;

test('parses JaCoCo XML into global and per-class coverage', () => {
  const coverage = parseJacocoReport(JACOCO_XML);

  assert.deepEqual(coverage.line, {
    missed: 20,
    covered: 20,
    total: 40,
    percentage: 50
  });
  assert.deepEqual(coverage.branch, {
    missed: 10,
    covered: 4,
    total: 14,
    percentage: 28.57
  });
  assert.equal(coverage.classes.length, 3);
  assert.deepEqual(coverage.classes[0].line, {
    missed: 8,
    covered: 2,
    total: 10,
    percentage: 20
  });
  assert.equal(coverage.classes[0].name, 'com.example.api.UserController');
});

test('calculates JaCoCo quality gate at the 60 percent threshold', () => {
  const coverage = parseJacocoReport(JACOCO_XML);
  const failedGate = calculateCoverageGate(coverage);

  assert.equal(failedGate.threshold, COVERAGE_THRESHOLD);
  assert.equal(failedGate.passed, false);

  const passedGate = calculateCoverageGate(
    { line: { percentage: 60 }, branch: { percentage: 20 } }
  );
  assert.equal(passedGate.passed, true);
});

test('ranks lower coverage and more complex classes as test priorities', () => {
  const priorities = rankCoveragePriorities(parseJacocoReport(JACOCO_XML).classes);

  assert.equal(priorities.length, 3);
  assert.equal(priorities[0].name, 'com.example.service.UserService');
  assert.equal(priorities[0].lineCoverage, 40);
  assert.equal(priorities[0].complexity, 10);
  assert.ok(priorities[0].roiScore > priorities[1].roiScore);
});

test('evaluates Sonar quality gates for production thresholds', () => {
  const passed = evaluateSonarQualityGate({
    status: 'available',
    codeSmells: 29,
    bugs: 0,
    securityHotspots: 0
  });
  const failed = evaluateSonarQualityGate({
    status: 'available',
    codeSmells: 30,
    bugs: 1,
    securityHotspots: 1
  });

  assert.equal(passed.passed, true);
  assert.equal(failed.passed, false);
  assert.deepEqual(
    failed.checks.map((check) => check.passed),
    [false, false, false]
  );
});

test('queries Sonar with a bearer token without persisting it', async () => {
  let requestedUrl;
  let requestOptions;

  const metrics = await fetchSonarMetrics({
    hostUrl: 'https://sonar.example.com/base',
    token: 'secret-token',
    projectKey: 'sample-service',
    fetchImplementation: async (url, options) => {
      requestedUrl = url;
      requestOptions = options;
      return {
        ok: true,
        json: async () => ({
          component: {
            measures: [
              { metric: 'code_smells', value: '12' },
              { metric: 'bugs', value: '0' },
              { metric: 'security_hotspots', value: '0' },
              { metric: 'sqale_index', value: '42' }
            ]
          }
        })
      };
    }
  });

  assert.equal(requestedUrl.pathname, '/api/measures/component');
  assert.equal(requestedUrl.searchParams.get('component'), 'sample-service');
  assert.equal(requestOptions.headers.Authorization, 'Bearer secret-token');
  assert.deepEqual(metrics, {
    status: 'available',
    projectKey: 'sample-service',
    codeSmells: 12,
    bugs: 0,
    securityHotspots: 0,
    technicalDebtMinutes: 42
  });
});

test('reports Sonar as not configured without credentials or project key', async () => {
  const metrics = await fetchSonarMetrics({
    hostUrl: undefined,
    token: undefined,
    projectKey: undefined
  });

  assert.equal(metrics.status, 'not-configured');
  assert.equal(metrics.projectKey, undefined);
});
