'use strict';

const path = require('node:path');
const { access, readFile, writeFile } = require('node:fs/promises');

const VERSION_FILE_NAMES = [
  'pom.xml',
  'gradle.properties',
  'build.gradle',
  'build.gradle.kts',
  'sonar-project.properties'
];

class VersioningError extends Error {
  constructor(message, { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'VersioningError';
  }
}

function parseSemanticVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-SNAPSHOT)?$/.exec(version?.trim());

  if (!match) {
    throw new VersioningError(
      `La version "${version}" no tiene formato semver compatible (ej. 1.0.0 o 1.0.1-SNAPSHOT).`
    );
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function bumpVersion(version, type) {
  const parsed = parseSemanticVersion(version);

  switch (type) {
    case 'patch':
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
    case 'minor':
      return `${parsed.major}.${parsed.minor + 1}.0`;
    case 'snapshot':
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}-SNAPSHOT`;
    default:
      throw new VersioningError(
        `Tipo de bump invalido: "${type}". Usa patch, minor o snapshot.`
      );
  }
}

async function discoverVersionFiles(projectDirectory = process.cwd()) {
  const files = [];

  for (const fileName of VERSION_FILE_NAMES) {
    const filePath = path.join(projectDirectory, fileName);
    try {
      await access(filePath);
      files.push(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new VersioningError(
          `No se pudo acceder a ${filePath}.`,
          { cause: error }
        );
      }
    }
  }

  return files;
}

function extractVersion(filePath, content) {
  const fileName = path.basename(filePath);

  if (fileName === 'pom.xml') {
    const projectVersion = /<artifactId>[\s\S]*?<\/artifactId>\s*<version>\s*([^<\s]+)\s*<\/version>/.exec(
      content
    );
    return projectVersion?.[1];
  }

  if (fileName === 'gradle.properties') {
    return /^version\s*=\s*([^\s#]+)\s*$/m.exec(content)?.[1];
  }

  if (fileName === 'build.gradle' || fileName === 'build.gradle.kts') {
    return /^\s*version\s*=?\s*['"]([^'"]+)['"]/m.exec(content)?.[1];
  }

  if (fileName === 'sonar-project.properties') {
    return /^sonar\.projectVersion\s*=\s*([^\s#]+)\s*$/m.exec(content)?.[1];
  }

  return undefined;
}

function replaceVersion(filePath, content, previousVersion, nextVersion) {
  const fileName = path.basename(filePath);
  const escapedPrevious = escapeRegExp(previousVersion);

  if (fileName === 'pom.xml') {
    return replaceSingle(
      content,
      new RegExp(
        `(<artifactId>[\\s\\S]*?<\\/artifactId>\\s*<version>\\s*)${escapedPrevious}(\\s*<\\/version>)`
      ),
      `$1${nextVersion}$2`,
      filePath
    );
  }

  if (fileName === 'gradle.properties') {
    return replaceSingle(
      content,
      new RegExp(`(^version\\s*=\\s*)${escapedPrevious}(\\s*$)`, 'm'),
      `$1${nextVersion}$2`,
      filePath
    );
  }

  if (fileName === 'build.gradle' || fileName === 'build.gradle.kts') {
    return replaceSingle(
      content,
      new RegExp(
        `(^\\s*version\\s*=?\\s*['"])${escapedPrevious}(['"])`,
        'm'
      ),
      `$1${nextVersion}$2`,
      filePath
    );
  }

  if (fileName === 'sonar-project.properties') {
    return replaceSingle(
      content,
      new RegExp(
        `(^sonar\\.projectVersion\\s*=\\s*)${escapedPrevious}(\\s*$)`,
        'm'
      ),
      `$1${nextVersion}$2`,
      filePath
    );
  }

  throw new VersioningError(`Formato de version no soportado: ${fileName}.`);
}

function replaceSingle(content, pattern, replacement, filePath) {
  if (!pattern.test(content)) {
    throw new VersioningError(
      `No se encontro la version esperada en ${path.basename(filePath)}.`
    );
  }

  return content.replace(pattern, replacement);
}

async function bumpProjectVersion(projectDirectory, type, {
  fileSystem = { readFile, writeFile },
  discoverFiles = discoverVersionFiles
} = {}) {
  const directory = path.resolve(projectDirectory || process.cwd());
  const files = await discoverFiles(directory);

  if (!files.length) {
    throw new VersioningError(
      'No se encontro pom.xml, gradle.properties, build.gradle ni sonar-project.properties.'
    );
  }

  const documents = await Promise.all(
    files.map(async (filePath) => ({
      filePath,
      content: await fileSystem.readFile(filePath, 'utf8')
    }))
  );
  const versions = documents
    .map(({ filePath, content }) => ({
      filePath,
      version: extractVersion(filePath, content)
    }))
    .filter(({ version }) => version);

  if (!versions.length) {
    throw new VersioningError('No se encontro una declaracion de version actualizable.');
  }

  const currentVersion = versions[0].version;
  const inconsistentVersion = versions.find(
    ({ version }) => version !== currentVersion
  );

  if (inconsistentVersion) {
    throw new VersioningError(
      `Las versiones no coinciden: ${path.basename(versions[0].filePath)} usa ${currentVersion} y ${path.basename(inconsistentVersion.filePath)} usa ${inconsistentVersion.version}.`
    );
  }

  const nextVersion = bumpVersion(currentVersion, type);
  const updates = versions.map(({ filePath }) => {
    const document = documents.find((item) => item.filePath === filePath);
    return {
      filePath,
      content: replaceVersion(
        filePath,
        document.content,
        currentVersion,
        nextVersion
      )
    };
  });

  await Promise.all(
    updates.map(({ filePath, content }) =>
      fileSystem.writeFile(filePath, content, 'utf8')
    )
  );

  return {
    projectDirectory: directory,
    previousVersion: currentVersion,
    nextVersion,
    updatedFiles: updates.map(({ filePath }) => filePath)
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  VERSION_FILE_NAMES,
  VersioningError,
  bumpProjectVersion,
  bumpVersion,
  discoverVersionFiles,
  extractVersion,
  parseSemanticVersion,
  replaceVersion
};
