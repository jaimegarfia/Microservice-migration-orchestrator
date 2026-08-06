'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  resolveEndpointAuthToken
} = require('../src/services/authentication');
const {
  injectRewriteConfiguration,
  runOpenRewrite
} = require('../src/services/rewrite');

test('uses an explicit endpoint token without requesting OAuth2', async () => {
  let calls = 0;
  const token = await resolveEndpointAuthToken({
    authToken: 'explicit-token',
    environment: { AUTH_PROVIDER: 'ATLAS' },
    fetchImplementation: async () => {
      calls += 1;
      throw new Error('OAuth2 must not be called');
    }
  });

  assert.equal(token, 'explicit-token');
  assert.equal(calls, 0);
});

test('obtains an ATLAS OAuth2 token with the configured default endpoint', async () => {
  const requests = [];
  const token = await resolveEndpointAuthToken({
    environment: { AUTH_PROVIDER: 'ATLAS' },
    fetchImplementation: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ access_token: 'atlas-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  assert.equal(token, 'atlas-token');
  assert.equal(
    requests[0].url,
    'https://security-dev.npapps.ocp.es.wcorp.carrefour.com/service-auth-server-v1/oauth/token?grant_type=client_credentials'
  );
  assert.equal(
    requests[0].options.headers.Authorization,
    'Basic QVBMSUFQT0w6NFAwTDBDNFJSM0YwVVI='
  );
});

test('injects and then restores the temporary OpenRewrite Gradle configuration', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'migration-rewrite-'));
  const buildPath = path.join(directory, 'build.gradle');
  const originalBuild = `plugins {
  id 'java'
}
`;

  try {
    await writeFile(buildPath, originalBuild, 'utf8');
    let temporaryBuild;

    const result = await runOpenRewrite(directory, {
      platform: 'linux',
      output: () => {},
      execute: async (_command, argumentsList, options) => {
        temporaryBuild = await readFile(buildPath, 'utf8');
        assert.equal(argumentsList[0], 'rewriteRun');
        assert.equal(options.cwd, directory);
        return { stdout: 'done', stderr: '' };
      }
    });

    assert.match(temporaryBuild, /org\.openrewrite\.rewrite.*6\.19\.0/);
    assert.match(temporaryBuild, /activeRecipe\("upgrade\.zordon\.carre4"\)/);
    assert.match(temporaryBuild, /rewrite\("org\.openrewrite\.recipe:rewrite-migrate-java:2\.31\.0"\)/);
    assert.equal(await readFile(buildPath, 'utf8'), originalBuild);
    assert.equal(result.rewriterCreated, true);
    assert.match(await readFile(result.rewriterPath, 'utf8'), /upgrade\.zordon\.carre4/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('injectRewriteConfiguration supports builds without an existing plugins block', () => {
  const build = injectRewriteConfiguration('repositories { mavenCentral() }\n', {
    recipeDependency: 'example:recipe:1.0.0'
  });

  assert.match(build, /^plugins \{/);
  assert.match(build, /rewrite\("example:recipe:1\.0\.0"\)/);
});
