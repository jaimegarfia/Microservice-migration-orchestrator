'use strict';

const path = require('node:path');
const { readdir, readFile, writeFile } = require('node:fs/promises');

const MANAGED_START = '<!-- migration-cli:readme:start -->';
const MANAGED_END = '<!-- migration-cli:readme:end -->';

async function analyzeMicroservice(projectDirectory = process.cwd(), {
  fileSystem = { readdir, readFile }
} = {}) {
  const directory = path.resolve(projectDirectory);
  const files = await listProjectFiles(directory, fileSystem);
  const documents = await Promise.all(
    files.map(async (filePath) => ({
      filePath,
      content: await fileSystem.readFile(filePath, 'utf8')
    }))
  );

  const pom = findDocument(documents, 'pom.xml');
  const gradle = findDocument(documents, 'build.gradle') ||
    findDocument(documents, 'build.gradle.kts');
  const sourceDocuments = documents.filter(({ filePath }) =>
    /\.(java|kt)$/i.test(filePath)
  );
  const configurationDocuments = documents.filter(({ filePath }) =>
    /\.(properties|ya?ml)$/i.test(filePath)
  );
  const allContent = documents.map(({ content }) => content).join('\n');

  return {
    projectDirectory: directory,
    name: path.basename(directory),
    stack: {
      language: sourceDocuments.some(({ filePath }) => /\.kt$/i.test(filePath))
        ? 'Kotlin'
        : sourceDocuments.length || pom || gradle
          ? 'Java'
          : 'No detectado',
      springBoot: /spring-boot|org\.springframework|@SpringBootApplication/i.test(
        allContent
      ),
      buildTool: pom ? 'Maven' : gradle ? 'Gradle' : 'No detectado',
      database: detectDatabase(allContent),
      messaging: detectMessaging(allContent)
    },
    controllers: extractControllers(sourceDocuments),
    entities: extractEntities(sourceDocuments),
    environmentVariables: extractEnvironmentVariables(
      configurationDocuments.map(({ content }) => content).join('\n')
    )
  };
}

async function listProjectFiles(directory, fileSystem, relativeDirectory = '') {
  const currentDirectory = path.join(directory, relativeDirectory);
  let entries;

  try {
    entries = await fileSystem.readdir(currentDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    if (shouldIgnore(entry.name)) {
      continue;
    }

    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listProjectFiles(directory, fileSystem, relativePath)));
      continue;
    }

    if (entry.isFile() && isRelevantFile(entry.name)) {
      files.push(path.join(directory, relativePath));
    }
  }

  return files;
}

function shouldIgnore(name) {
  return ['.git', '.gradle', '.idea', 'node_modules', 'target', 'build'].includes(name);
}

function isRelevantFile(fileName) {
  return (
    fileName === 'pom.xml' ||
    fileName === 'build.gradle' ||
    fileName === 'build.gradle.kts' ||
    /\.(java|kt|properties|ya?ml)$/i.test(fileName)
  );
}

function findDocument(documents, fileName) {
  return documents.find(
    ({ filePath }) => path.basename(filePath).toLowerCase() === fileName
  );
}

function extractControllers(documents) {
  const controllers = [];

  for (const { filePath, content } of documents) {
    if (!/@(?:RestController|Controller)\b/.test(content)) {
      continue;
    }

    const className = /(?:public\s+)?class\s+(\w+)/.exec(content)?.[1] ||
      path.basename(filePath, path.extname(filePath));
    const basePath = /@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/.exec(
      content
    )?.[1] || '';
    const mappings = [
      ...content.matchAll(
        /@(?:Get|Post|Put|Delete|Patch)Mapping(?:\s*\(\s*(?:value\s*=\s*)?["']?([^"')\s,]*)[^)]*\))?/g
      )
    ]
      .map((match) => ({
        method: match[0].match(/@(Get|Post|Put|Delete|Patch)Mapping/)?.[1]
          .toUpperCase(),
        path: normalizeEndpointPath(basePath, match[1])
      }))
      .filter(({ path: endpoint }) => endpoint);

    controllers.push({
      name: className,
      endpoints: mappings
    });
  }

  return controllers;
}

function normalizeEndpointPath(basePath, methodPath) {
  const segments = [basePath, methodPath].filter(Boolean);
  if (!segments.length) {
    return '/';
  }

  return `/${segments
    .join('/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/')}`;
}

function extractEntities(documents) {
  const entities = [];

  for (const { filePath, content } of documents) {
    if (!/@Entity\b/.test(content)) {
      continue;
    }

    const name = /(?:public\s+)?class\s+(\w+)/.exec(content)?.[1] ||
      path.basename(filePath, path.extname(filePath));
    const table = /@Table\s*\(\s*name\s*=\s*["']([^"']+)["']/.exec(content)?.[1] ||
      name;

    entities.push({ name, table });
  }

  return entities;
}

function extractEnvironmentVariables(content) {
  const variables = new Set();

  for (const match of content.matchAll(/\$\{([A-Z][A-Z0-9_]*)(?::[^}]*)?\}/g)) {
    variables.add(match[1]);
  }

  return [...variables].sort();
}

function detectDatabase(content) {
  if (/r2dbc/i.test(content)) {
    return 'R2DBC';
  }
  if (/spring-data-jpa|jakarta\.persistence|javax\.persistence|hibernate/i.test(content)) {
    return 'JPA / Hibernate';
  }
  if (/mongodb/i.test(content)) {
    return 'MongoDB';
  }
  return 'No detectada';
}

function detectMessaging(content) {
  const messaging = [];
  if (/spring-kafka|org\.apache\.kafka|KafkaTemplate|@KafkaListener/i.test(content)) {
    messaging.push('Kafka');
  }
  if (/spring-rabbit|RabbitTemplate|@RabbitListener|amqp/i.test(content)) {
    messaging.push('RabbitMQ');
  }

  return messaging;
}

function generateTechnicalReadme(analysis) {
  const stack = [
    analysis.stack.language,
    analysis.stack.springBoot ? 'Spring Boot' : null,
    analysis.stack.buildTool,
    analysis.stack.database !== 'No detectada' ? analysis.stack.database : null,
    ...analysis.stack.messaging
  ].filter(Boolean);

  return [
    MANAGED_START,
    `# ${analysis.name}`,
    '',
    '## 📌 Descripción y Stack Tecnológico',
    '',
    `Microservicio técnico documentado automáticamente por \`migration-cli\`.`,
    '',
    `- **Stack detectado:** ${stack.join(', ') || 'No detectado'}.`,
    '',
    '## 🔌 Endpoints de la API',
    '',
    renderEndpoints(analysis.controllers),
    '',
    '## 🗄️ Modelo de Datos / Entidades Core',
    '',
    renderEntities(analysis.entities),
    '',
    '## ⚙️ Configuración y Variables de Entorno',
    '',
    renderEnvironmentVariables(analysis.environmentVariables),
    '',
    '## 🚀 Instrucciones de Compilación y Despliegue',
    '',
    renderBuildInstructions(analysis.stack.buildTool),
    '',
    MANAGED_END,
    ''
  ].join('\n');
}

function renderEndpoints(controllers) {
  if (!controllers.length) {
    return 'No se detectaron controladores REST.';
  }

  const rows = controllers.flatMap((controller) =>
    controller.endpoints.map((endpoint) =>
      `| ${endpoint.method} | \`${endpoint.path}\` | ${controller.name} |`
    )
  );

  if (!rows.length) {
    return controllers
      .map((controller) => `- ${controller.name} (sin mappings detectados)`)
      .join('\n');
  }

  return [
    '| Método | Ruta | Controlador |',
    '| --- | --- | --- |',
    ...rows
  ].join('\n');
}

function renderEntities(entities) {
  if (!entities.length) {
    return 'No se detectaron entidades JPA.';
  }

  return [
    '| Entidad | Tabla |',
    '| --- | --- |',
    ...entities.map((entity) => `| ${entity.name} | ${entity.table} |`)
  ].join('\n');
}

function renderEnvironmentVariables(variables) {
  if (!variables.length) {
    return 'No se detectaron variables de entorno en los archivos de configuración.';
  }

  return variables.map((variable) => `- \`${variable}\``).join('\n');
}

function renderBuildInstructions(buildTool) {
  if (buildTool === 'Maven') {
    return [
      '```bash',
      './mvnw clean verify',
      '```',
      '',
      'Empaqueta el artefacto y despliega la imagen o JAR conforme a la plataforma destino.'
    ].join('\n');
  }

  if (buildTool === 'Gradle') {
    return [
      '```bash',
      './gradlew clean build',
      '```',
      '',
      'Empaqueta el artefacto y despliega la imagen o JAR conforme a la plataforma destino.'
    ].join('\n');
  }

  return 'Define el comando de compilación y despliegue para este proyecto.';
}

function mergeManagedReadme(existingContent, generatedContent) {
  const managedPattern = new RegExp(
    `${escapeRegExp(MANAGED_START)}[\\s\\S]*?${escapeRegExp(MANAGED_END)}\\n?`
  );

  if (managedPattern.test(existingContent)) {
    return existingContent.replace(managedPattern, generatedContent);
  }

  if (!existingContent.trim()) {
    return generatedContent;
  }

  return `${existingContent.trimEnd()}\n\n${generatedContent}`;
}

async function writeTechnicalReadme(projectDirectory, analysis, {
  fileSystem = { readFile, writeFile }
} = {}) {
  const readmePath = path.join(projectDirectory, 'README.md');
  let existingContent = '';

  try {
    existingContent = await fileSystem.readFile(readmePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const generatedContent = generateTechnicalReadme(analysis);
  const finalContent = mergeManagedReadme(existingContent, generatedContent);
  await fileSystem.writeFile(readmePath, finalContent, 'utf8');

  return { readmePath, content: finalContent };
}

async function generateProjectReadme(projectDirectory = process.cwd(), options = {}) {
  const analysis = await analyzeMicroservice(projectDirectory, options);
  const result = await writeTechnicalReadme(analysis.projectDirectory, analysis, options);

  return {
    ...result,
    analysis
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  MANAGED_END,
  MANAGED_START,
  analyzeMicroservice,
  extractControllers,
  extractEntities,
  extractEnvironmentVariables,
  generateProjectReadme,
  generateTechnicalReadme,
  mergeManagedReadme,
  writeTechnicalReadme
};
