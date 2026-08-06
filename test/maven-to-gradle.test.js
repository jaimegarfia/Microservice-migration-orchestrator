'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  convertMavenToGradle,
  generateGradleArtifacts,
  parsePom
} = require('../src/services/maven-to-gradle');

const POM = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.carrefour.platform</groupId>
  <artifactId>catalog-service</artifactId>
  <version>1.2.3-SNAPSHOT</version>
  <name>Catalog Service</name>
  <description>Catalog API</description>
  <properties>
    <java.version>17</java.version>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <spring.boot.version>3.3.5</spring.boot.version>
  </properties>
  <repositories>
    <repository>
      <id>gar</id>
      <url>artifactregistry://europe-west1-maven.pkg.dev/carrefour/catalog</url>
    </repository>
  </repositories>
  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-dependencies</artifactId>
        <version>\${spring.boot.version}</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
      <groupId>org.projectlombok</groupId>
      <artifactId>lombok</artifactId>
      <version>1.18.34</version>
      <scope>provided</scope>
    </dependency>
    <dependency>
      <groupId>com.example</groupId>
      <artifactId>runtime-lib</artifactId>
      <version>2.0.0</version>
      <scope>runtime</scope>
      <exclusions>
        <exclusion>
          <groupId>org.bad</groupId>
          <artifactId>bad-lib</artifactId>
        </exclusion>
      </exclusions>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.11.0</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin><artifactId>spring-boot-maven-plugin</artifactId></plugin>
      <plugin><artifactId>jacoco-maven-plugin</artifactId></plugin>
      <plugin><artifactId>maven-failsafe-plugin</artifactId></plugin>
      <plugin><artifactId>sonar-maven-plugin</artifactId></plugin>
    </plugins>
  </build>
</project>`;

test('parses Maven coordinates, properties, dependencies, repositories and plugins', () => {
  const model = parsePom(POM);

  assert.deepEqual(model.coordinates, {
    groupId: 'com.carrefour.platform',
    artifactId: 'catalog-service',
    version: '1.2.3-SNAPSHOT',
    name: 'Catalog Service',
    description: 'Catalog API'
  });
  assert.equal(model.properties.javaVersion, '17');
  assert.equal(model.properties.encoding, 'UTF-8');
  assert.equal(model.dependencies[1].scope, 'provided');
  assert.deepEqual(model.dependencies[2].exclusions, [
    { groupId: 'org.bad', artifactId: 'bad-lib' }
  ]);
  assert.equal(
    model.features.googleRepository,
    'artifactregistry://europe-west1-maven.pkg.dev/carrefour/catalog'
  );
  assert.equal(model.features.springBoot, true);
  assert.equal(model.features.jacoco, true);
  assert.equal(model.features.failsafe, true);
  assert.equal(model.features.sonar, true);
});

test('generates a Carrefour-compatible Groovy Gradle build and auxiliary scripts', () => {
  const artifacts = generateGradleArtifacts(parsePom(POM));
  const build = artifacts['build.gradle'];

  assert.match(build, /id 'org\.springframework\.boot'/);
  assert.match(build, /id 'io\.spring\.dependency-management'/);
  assert.match(build, /id 'jacoco'/);
  assert.match(build, /id 'org\.sonarqube'/);
  assert.match(build, /id 'maven-publish'/);
  assert.match(build, /mavenBom 'org\.springframework\.boot:spring-boot-dependencies:3\.3\.5'/);
  assert.match(build, /compileOnly 'org\.projectlombok:lombok:1\.18\.34'/);
  assert.match(build, /annotationProcessor 'org\.projectlombok:lombok:1\.18\.34'/);
  assert.match(build, /runtimeOnly 'com\.example:runtime-lib:2\.0\.0'/);
  assert.match(build, /exclude group: 'org\.bad', module: 'bad-lib'/);
  assert.match(build, /testImplementation 'org\.junit\.jupiter:junit-jupiter:5\.11\.0'/);
  assert.match(build, /tasks\.register\('integrationTest', Test\)/);
  assert.match(build, /jacocoTestReport/);
  assert.match(artifacts['gradle.properties'], /googleRepositoryUrl=artifactregistry:\/\//);
  assert.equal(artifacts['settings.gradle'], "rootProject.name = 'catalog-service'\n");
  assert.ok(artifacts['gradle/sonar.gradle']);
  assert.ok(artifacts['gradle/googleArtifactory.gradle']);
});

test('writes Gradle artifacts and wrapper, preserves Maven by default, and removes it only at cutover', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'maven-to-gradle-'));
  const wrapperSource = path.join(directory, 'wrapper-source.jar');

  try {
    await writeFile(path.join(directory, 'pom.xml'), POM, 'utf8');
    await writeFile(path.join(directory, '.gitignore'), 'node_modules/\n', 'utf8');
    await mkdir(path.join(directory, '.mvn'), { recursive: true });
    await mkdir(path.join(directory, 'target'), { recursive: true });
    await writeFile(wrapperSource, 'wrapper-jar', 'utf8');

    const executed = [];
    const result = await convertMavenToGradle(directory, {
      platform: 'win32',
      wrapperJarSource: wrapperSource,
      output: () => {},
      execute: async (command, args, options) => {
        executed.push({ command, args, options });
        return { stdout: 'BUILD SUCCESSFUL', stderr: '' };
      }
    });

    assert.equal(result.cutover, false);
    assert.equal(executed[0].command, path.join(directory, 'gradlew.bat'));
    assert.deepEqual(executed[0].args, ['compileJava']);
    assert.match(await readFile(path.join(directory, 'build.gradle'), 'utf8'), /springframework/);
    assert.equal(await readFile(path.join(directory, 'gradle/wrapper/gradle-wrapper.jar'), 'utf8'), 'wrapper-jar');
    assert.match(await readFile(path.join(directory, '.gitignore'), 'utf8'), /\.gradle\/\nbuild\/\n!gradle\/wrapper\/gradle-wrapper\.jar/);
    assert.match(await readFile(path.join(directory, 'pom.xml'), 'utf8'), /catalog-service/);

    await rm(path.join(directory, 'build.gradle'));
    await rm(path.join(directory, 'gradle.properties'));
    await rm(path.join(directory, 'settings.gradle'));
    await rm(path.join(directory, 'gradle'), { recursive: true });
    await rm(path.join(directory, 'gradlew'));
    await rm(path.join(directory, 'gradlew.bat'));

    await convertMavenToGradle(directory, {
      cutover: true,
      platform: 'win32',
      wrapperJarSource: wrapperSource,
      output: () => {},
      execute: async () => ({ stdout: 'BUILD SUCCESSFUL', stderr: '' })
    });

    await assert.rejects(readFile(path.join(directory, 'pom.xml'), 'utf8'));
    await assert.rejects(readFile(path.join(directory, '.mvn'), 'utf8'));
    await assert.rejects(readFile(path.join(directory, 'target'), 'utf8'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
