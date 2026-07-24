'use strict';

const assert = require('node:assert/strict');
const {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  analyzeMicroservice,
  generateProjectReadme,
  mergeManagedReadme
} = require('../src/services/readme');
const {
  VersioningError,
  bumpProjectVersion,
  bumpVersion
} = require('../src/services/versioning');

async function createTemporaryProject() {
  return mkdtemp(path.join(os.tmpdir(), 'migration-station1-'));
}

test('bumps Maven and Sonar versions together', async () => {
  const directory = await createTemporaryProject();

  try {
    await writeFile(
      path.join(directory, 'pom.xml'),
      `<project>
  <modelVersion>4.0.0</modelVersion>
  <artifactId>sample-service</artifactId>
  <version>1.0.0</version>
</project>
`
    );
    await writeFile(
      path.join(directory, 'sonar-project.properties'),
      'sonar.projectKey=sample-service\nsonar.projectVersion=1.0.0\n'
    );

    const result = await bumpProjectVersion(directory, 'minor');

    assert.equal(result.previousVersion, '1.0.0');
    assert.equal(result.nextVersion, '1.1.0');
    assert.equal(result.updatedFiles.length, 2);
    assert.match(await readFile(path.join(directory, 'pom.xml'), 'utf8'), /<version>1\.1\.0<\/version>/);
    assert.match(
      await readFile(path.join(directory, 'sonar-project.properties'), 'utf8'),
      /sonar\.projectVersion=1\.1\.0/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('bumps Gradle properties to a snapshot version', async () => {
  const directory = await createTemporaryProject();

  try {
    await writeFile(
      path.join(directory, 'gradle.properties'),
      'group=com.example\nversion=2.4.7\n'
    );

    const result = await bumpProjectVersion(directory, 'snapshot');

    assert.equal(result.nextVersion, '2.4.8-SNAPSHOT');
    assert.match(
      await readFile(path.join(directory, 'gradle.properties'), 'utf8'),
      /^version=2\.4\.8-SNAPSHOT$/m
    );
    assert.equal(bumpVersion('1.0.0-SNAPSHOT', 'patch'), '1.0.1');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects inconsistent version declarations before updating files', async () => {
  const directory = await createTemporaryProject();

  try {
    const pomPath = path.join(directory, 'pom.xml');
    await writeFile(
      pomPath,
      '<project><artifactId>demo</artifactId><version>1.0.0</version></project>'
    );
    await writeFile(
      path.join(directory, 'sonar-project.properties'),
      'sonar.projectVersion=2.0.0\n'
    );

    await assert.rejects(
      () => bumpProjectVersion(directory, 'patch'),
      VersioningError
    );
    assert.match(await readFile(pomPath, 'utf8'), /<version>1\.0\.0<\/version>/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('analyzes a Spring project and generates a managed technical README', async () => {
  const directory = await createTemporaryProject();
  const sourceDirectory = path.join(
    directory,
    'src',
    'main',
    'java',
    'com',
    'example'
  );

  try {
    await mkdir(sourceDirectory, { recursive: true });
    await mkdir(path.join(directory, 'src', 'main', 'resources'), {
      recursive: true
    });
    await writeFile(
      path.join(directory, 'pom.xml'),
      '<project><artifactId>demo</artifactId><version>1.0.0</version><dependency>spring-boot-starter-web spring-data-jpa spring-kafka</dependency></project>'
    );
    await writeFile(
      path.join(sourceDirectory, 'UserController.java'),
      `@RestController
@RequestMapping("/api/users")
public class UserController {
  @GetMapping("/{id}")
  public Object getUser() { return null; }

  @PostMapping
  public Object createUser() { return null; }
}`
    );
    await writeFile(
      path.join(sourceDirectory, 'User.java'),
      `@Entity
@Table(name = "users")
public class User {}`
    );
    await writeFile(
      path.join(directory, 'src', 'main', 'resources', 'application.yml'),
      'spring:\n  datasource:\n    url: ${DATABASE_URL}\napp:\n  token: ${API_TOKEN:}\n'
    );
    await writeFile(path.join(directory, 'README.md'), '# Manual title\n\nManual notes.\n');

    const analysis = await analyzeMicroservice(directory);

    assert.equal(analysis.stack.springBoot, true);
    assert.equal(analysis.stack.buildTool, 'Maven');
    assert.equal(analysis.stack.database, 'JPA / Hibernate');
    assert.deepEqual(analysis.stack.messaging, ['Kafka']);
    assert.deepEqual(analysis.controllers[0].endpoints, [
      { method: 'GET', path: '/api/users/{id}' },
      { method: 'POST', path: '/api/users' }
    ]);
    assert.deepEqual(analysis.entities, [{ name: 'User', table: 'users' }]);
    assert.deepEqual(analysis.environmentVariables, ['API_TOKEN', 'DATABASE_URL']);

    const result = await generateProjectReadme(directory);
    const readme = await readFile(result.readmePath, 'utf8');

    assert.match(readme, /^# Manual title/m);
    assert.match(readme, /migration-cli:readme:start/);
    assert.match(readme, /\| GET \| `\/api\/users\/\{id\}` \| UserController \|/);
    assert.match(readme, /\| User \| users \|/);
    assert.match(readme, /`DATABASE_URL`/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('replaces only the managed README section on subsequent runs', () => {
  const existing = [
    '# Manual heading',
    '',
    '<!-- migration-cli:readme:start -->',
    'old generated content',
    '<!-- migration-cli:readme:end -->',
    '',
    'Manual footer'
  ].join('\n');
  const generated = [
    '<!-- migration-cli:readme:start -->',
    'new generated content',
    '<!-- migration-cli:readme:end -->',
    ''
  ].join('\n');

  const merged = mergeManagedReadme(existing, generated);

  assert.match(merged, /# Manual heading/);
  assert.match(merged, /new generated content/);
  assert.doesNotMatch(merged, /old generated content/);
  assert.match(merged, /Manual footer/);
});
