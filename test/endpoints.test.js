'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBaselineReport,
  executeGetEndpoints,
  extractGetEndpoints,
  parseDefinition,
  summarizeResults,
  writeBaselineReport
} = require('../src/services/endpoints');

test('parses an OpenAPI YAML definition and extracts only executable GET endpoints', () => {
  const definition = parseDefinition(`
openapi: 3.0.0
servers:
  - url: https://api.example.com/v1
paths:
  /health:
    get:
      summary: Health
  /users:
    post:
      summary: Create user
  /users/{id}:
    get:
      summary: User by id
`, 'openapi.yaml');

  const endpoints = extractGetEndpoints(definition);

  assert.deepEqual(endpoints, [
    {
      endpoint: '/health',
      url: 'https://api.example.com/v1/health',
      source: 'openapi'
    }
  ]);
});

test('extracts nested GET requests from a Postman collection', () => {
  const collection = {
    info: { name: 'Example collection' },
    item: [
      {
        name: 'Folder',
        item: [
          {
            name: 'List users',
            request: { method: 'GET', url: 'https://api.example.com/users' }
          },
          {
            name: 'Create user',
            request: { method: 'POST', url: 'https://api.example.com/users' }
          }
        ]
      }
    ]
  };

  assert.deepEqual(extractGetEndpoints(collection), [
    {
      endpoint: '/users',
      url: 'https://api.example.com/users',
      source: 'postman',
      name: 'List users'
    }
  ]);
});

test('executes GET endpoints, sets the optional bearer token, and records evidence fields', async () => {
  const requests = [];
  const results = await executeGetEndpoints(
    [{ endpoint: '/health', url: 'https://api.example.com/health' }],
    {
      authToken: 'secret-token',
      fetchImplementation: async (url, options) => {
        requests.push({ url, options });
        return new Response('{"status":"ok"}', { status: 200 });
      }
    }
  );

  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer secret-token');
  assert.equal(results[0].endpoint, '/health');
  assert.equal(results[0].status, 200);
  assert.match(results[0].responseHash, /^[a-f0-9]{64}$/);
  assert.equal(results[0].payloadSnippet, '{"status":"ok"}');
});

test('writes a PRE baseline JSON artifact with the required schema', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'migration-baseline-'));
  const report = createBaselineReport(
    'auth-service',
    [
      {
        endpoint: '/health',
        status: 200,
        responseTimeMs: 12,
        responseHash: 'hash',
        payloadSnippet: '{"status":"ok"}'
      }
    ],
    new Date('2026-07-24T10:00:00.000Z')
  );

  try {
    const reportPath = await writeBaselineReport(report, {
      currentDirectory: directory
    });
    const savedReport = JSON.parse(await readFile(reportPath, 'utf8'));

    assert.match(
      reportPath,
      /[\\/]\.axetrules[\\/]history[\\/]\d{4}-\d{2}-\d{2}_Estacion0_PRE-Endpoints[\\/]endpoints-pre\.json$/
    );
    assert.equal(savedReport.microservice, 'auth-service');
    assert.deepEqual(savedReport, report);
    assert.deepEqual(summarizeResults(report.results), {
      total: 1,
      ok: 1,
      errors: 0
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
