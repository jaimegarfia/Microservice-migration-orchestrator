'use strict';

const path = require('node:path');
const { readdir, readFile, writeFile } = require('node:fs/promises');

const MANAGED_START = '<!-- migration-cli:readme:start -->';
const MANAGED_END = '<!-- migration-cli:readme:end -->';

const INTEGRATION_PATTERNS = [
  ['Kudu', /\bkudu\b/i],
  ['Kerberos', /\bkerberos\b|krb5/i],
  ['Kafka', /\bkafka\b|spring-cloud-stream.*kafka|spring-kafka/i],
  ['PubSub', /\bpub[\s-]?sub\b|google-cloud-pubsub|spring-cloud-gcp.*pubsub/i],
  ['RabbitMQ', /\brabbitmq\b|spring-rabbit|amqp/i],
  ['OAuth2', /\boauth2\b|service-auth-server|security-cua|security-dev/i]
];

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
  const application = findApplicationDocument(documents);
  const dockerfile = documents.find(({ filePath }) =>
    /^dockerfile$/i.test(path.basename(filePath))
  );
  const sourceDocuments = documents.filter(({ filePath }) =>
    /\.(java|kt)$/i.test(filePath)
  );
  const configurationDocuments = documents.filter(({ filePath }) =>
    /\.(properties|ya?ml)$/i.test(filePath)
  );
  const allContent = documents.map(({ content }) => content).join('\n');
  const applicationContent = application?.content || '';

  const name = path.basename(directory);
  const contextPath = extractYamlValue(
    applicationContent,
    'server.servlet.context-path'
  ) || `/${name}`;
  const port = extractYamlValue(applicationContent, 'server.port') || '8080';

  return {
    projectDirectory: directory,
    name,
    contextPath: normalizeContextPath(contextPath),
    port: String(port),
    dockerfile: {
      present: Boolean(dockerfile),
      baseImage: extractDockerBaseImage(dockerfile?.content || '')
    },
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
      messaging: detectMessaging(allContent),
      integrations: detectIntegrations(allContent)
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
    /^dockerfile$/i.test(fileName) ||
    /\.(java|kt|properties|ya?ml)$/i.test(fileName)
  );
}

function findDocument(documents, fileName) {
  return documents.find(
    ({ filePath }) => path.basename(filePath).toLowerCase() === fileName.toLowerCase()
  );
}

function findApplicationDocument(documents) {
  return documents.find(({ filePath }) =>
    /^application(?:-[^/\\]+)?\.ya?ml$/i.test(path.basename(filePath))
  ) || documents.find(({ filePath }) =>
    /^application(?:-[^/\\]+)?\.properties$/i.test(path.basename(filePath))
  );
}

function extractYamlValue(content, dottedKey) {
  const propertyKey = dottedKey.replace(/\./g, '\\.');
  const propertyMatch = new RegExp(
    `^\\s*${propertyKey}\\s*[:=]\\s*([^#\\r\\n]+)`,
    'mi'
  ).exec(content);
  if (propertyMatch) {
    return cleanConfigValue(propertyMatch[1]);
  }

  const keyParts = dottedKey.split('.');
  const finalKey = keyParts.pop();
  const finalKeyMatch = new RegExp(
    `^\\s*${finalKey}\\s*:\\s*([^#\\r\\n]+)`,
    'mi'
  ).exec(content);
  return finalKeyMatch ? cleanConfigValue(finalKeyMatch[1]) : undefined;
}

function cleanConfigValue(value) {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function normalizeContextPath(value) {
  const contextPath = String(value || '/').trim();
  if (contextPath === '/') {
    return '/';
  }
  return `/${contextPath.replace(/^\/+|\/+$/g, '')}`;
}

function extractDockerBaseImage(content) {
  return /^FROM\s+([^\s]+)/mi.exec(content)?.[1];
}

function detectIntegrations(content) {
  return INTEGRATION_PATTERNS
    .filter(([, pattern]) => pattern.test(content))
    .map(([name]) => name);
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
  if (/spring-(?:boot-starter-)?data-jpa|jakarta\.persistence|javax\.persistence|hibernate/i.test(content)) {
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
  const name = analysis.name;
  const contextPath = analysis.contextPath || `/${name}`;
  const port = analysis.port || '8080';
  const integrations = analysis.stack.integrations || [];
  const integrationStatus = (nameToFind, fallback = 'No detectado') =>
    integrations.includes(nameToFind) ? 'Detectado' : fallback;

  return [
    MANAGED_START,
    `# ${name}`,
    '',
    '## Descripción del proyecto',
    `${name} es un microservicio corporativo Java 17, Gradle 7 y Spring Boot 2 perteneciente al dominio ${name}-v1, encargado de exponer capacidades REST y de integración dentro del ecosistema corporativo.`,
    'El servicio permite la consulta, agregación y enriquecimiento de información de negocio, así como la integración con sistemas externos definidos por su configuración Spring.',
    'Además, puede participar en la publicación y consumo de eventos, garantizando trazabilidad, seguridad y cumplimiento normativo interno.',
    'El microservicio se despliega en OpenShift (OCP) bajo arquitectura de microservicios y forma parte del entorno gestionado mediante Jenkins + ArgoCD (modelo GitOps).',
    '',
    '## Instalación',
    'Antes de comenzar, asegúrate de contar con los siguientes requisitos:',
    '',
    '### 1. Entorno local',
    '- Java 17',
    '- Gradle 7.x o Gradle Wrapper',
    '- Acceso a red corporativa para descargar dependencias',
    '- Cliente Kubernetes configurado (opcional para pruebas en cluster)',
    '',
    'Verificar Java:',
    '```bash',
    'java -version',
    '```',
    '',
    '### 2. Infraestructura',
    '- Cluster OpenShift (OCP)',
    '- Namespace configurado',
    '- Jenkins configurado con pipeline de build',
    '- ArgoCD para despliegue continuo',
    `- Cluster Kudu: ${integrationStatus('Kudu', 'No detectado')}`,
    '- Servicio OAuth corporativo: https://security-cua.npapps.ocp.es.wcorp.carrefour.com/service-auth-server-v1',
    '',
    '### 3. Credenciales y accesos',
    '- Acceso a repositorio Bitbucket corporativo',
    '- Acceso a Docker Registry',
    '- Credenciales OAuth',
    '',
    '### Instalación en el Entorno Local',
    'Clonar el repositorio:',
    '',
    '```bash',
    'git clone http://bitbucket.es.wcorp.carrefour.com/scm/<PROJECT>/' +
      `${name}.git`,
    `cd ${name}`,
    '```',
    'Configurar el entorno:',
    'El archivo application.yaml contiene configuración por defecto para entorno local:',
    '',
    '```yaml',
    'spring:',
    '  application:',
    `    name: ${name}`,
    `    moduleid: ${name}-v1`,
    'server:',
    `  port: ${port}`,
    '  servlet:',
    `    context-path: ${contextPath}`,
    '```',
    'Compilar el proyecto:',
    '',
    '```bash',
    './gradlew clean build',
    '```',
    'Ejecutar el microservicio:',
    '',
    '```bash',
    `java -jar build/libs/${name}.jar`,
    '```',
    `El servicio quedará disponible en: http://localhost:${port}${contextPath}`,
    '',
    '### Propiedades básicas Spring',
    'Perfiles de Spring',
    '',
    '```yaml',
    'spring:',
    '  profiles:',
    '    active: ${ENVIRONMENT:local}',
    '```',
    'Permite configurar distintos entornos: local, dev, qa, prod.',
    '',
    '### Metadatos de la Aplicación',
    '',
    '```yaml',
    'spring:',
    '  application:',
    `    name: ${name}`,
    `    moduleid: ${name}-v1`,
    '```',
    '',
    '### Configuración del Servidor',
    '',
    '```yaml',
    'server:',
    `  port: ${port}`,
    '  servlet:',
    `    context-path: ${contextPath}`,
    '```',
    '',
    '### Configuración de Seguridad',
    '',
    '```yaml',
    'security:',
    '  strategy: MODE_INHERITABLETHREADLOCAL',
    '  oauth2:',
    '    resource:',
    '      c4:',
    '        jwt:',
    '          keyUri: https://security-cua.npapps.ocp.es.wcorp.carrefour.com/service-auth-server-v1/keystore/public',
    '```',
    '',
    '### Seguridad Arquitectura Carrefour',
    '',
    '```yaml',
    'carrefour:',
    '  arch:',
    '    security:',
    '      enabled: true',
    '      client-scopes-url: https://security-cua.npapps.ocp.es.wcorp.carrefour.com/service-auth-server-v1/scopesApps?scopeApp={scopeApp}',
    '```',
    '',
    '### Integraciones y Dependencias',
    `- Kafka: ${integrationStatus('Kafka')}`,
    `- PubSub: ${integrationStatus('PubSub')}`,
    `- Configuración de Kudu: ${integrationStatus('Kudu')}`,
    `- Configuración Kerberos: ${integrationStatus('Kerberos')}`,
    `- RabbitMQ: ${integrationStatus('RabbitMQ')}`,
    `- OAuth2 corporativo: ${integrationStatus('OAuth2', 'Configuración estándar')}`,
    `- Modelo de Datos: ${renderModelData(analysis.entities)}`,
    '',
    '## Servicios expuestos',
    `Catálogo de operaciones REST expuestas bajo el contexto ${contextPath}:`,
    '',
    renderExposedServices(analysis.controllers),
    '',
    '## Endpoints de monitorización',
    `GET ${contextPath}/actuator/health`,
    '',
    `GET ${contextPath}/actuator/info`,
    '',
    'Exponen el estado operativo del microservicio y metadatos técnicos.',
    '',
    '## API',
    'La API está documentada mediante Swagger OpenAPI 3.',
    '',
    'URL Swagger: <DOMINIO_DEV>' + `${contextPath}/swagger-ui.html`,
    '',
    'URL base del servicio: <DOMINIO_DEV>',
    '',
    '## Recursos estimados',
    'Configuración recomendada del contenedor:',
    '',
    'CPU: Límite máximo: 100m | Mínimo solicitado: 100m',
    '',
    'Memoria: Límite máximo: 256Mi | Mínimo solicitado: 256Mi',
    '',
    'Documento de uso interno corporativo.',
    '',
    MANAGED_END,
    ''
  ].join('\n');
}

function renderExposedServices(controllers) {
  if (!controllers.length) {
    return 'No se detectaron controladores REST.';
  }

  const rows = controllers.flatMap((controller) => {
    if (!controller.endpoints.length) {
      return [`- ${controller.name} (sin mappings detectados)`];
    }
    return controller.endpoints.map((endpoint) =>
      `- ${endpoint.method} ${endpoint.path} (${controller.name})`
    );
  });

  return rows.join('\n');
}

function renderModelData(entities) {
  if (!entities.length) {
    return 'No se detectan entidades locales; puede residir en librerías compartidas.';
  }
  return entities.map(({ name, table }) => `${name} (${table})`).join(', ');
}

function renderEndpoints(controllers) {
  return renderExposedServices(controllers);
}

function renderEntities(entities) {
  return renderModelData(entities);
}

function renderEnvironmentVariables(variables) {
  if (!variables.length) {
    return 'No se detectaron variables de entorno en los archivos de configuración.';
  }

  return variables.map((variable) => `- \`${variable}\``).join('\n');
}

function renderBuildInstructions(buildTool) {
  return buildTool === 'Gradle'
    ? ['```bash', './gradlew clean build', '```'].join('\n')
    : ['```bash', './gradlew clean build', '```'].join('\n');
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
  detectIntegrations,
  extractControllers,
  extractEntities,
  extractEnvironmentVariables,
  generateProjectReadme,
  generateTechnicalReadme,
  mergeManagedReadme,
  writeTechnicalReadme
};
