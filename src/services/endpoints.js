'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const {
  readdir,
  readFile,
  mkdir,
  writeFile
} = require('node:fs/promises');
const YAML = require('yaml');
const { getHistoryDirectory } = require('../utils/history');

const OPENAPI_FILE_NAMES = new Set([
  'swagger.json',
  'swagger.yaml',
  'swagger.yml',
  'openapi.json',
  'openapi.yaml',
  'openapi.yml'
]);

class EndpointSourceError extends Error {
  constructor(message, { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'EndpointSourceError';
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) {
    return undefined;
  }

  if (!isHttpUrl(baseUrl)) {
    throw new EndpointSourceError(
      'La URL base debe ser una URL absoluta HTTP(S), por ejemplo https://api.example.com.'
    );
  }

  return baseUrl.replace(/\/+$/, '');
}

async function discoverEndpointSource(currentDirectory = process.cwd()) {
  const sources = await discoverEndpointSources(currentDirectory);
  return sources[0] || null;
}

async function discoverEndpointSources(currentDirectory = process.cwd(), {
  fileSystem = { readdir }
} = {}) {
  const directories = [
    currentDirectory,
    path.join(currentDirectory, 'docs'),
    path.join(currentDirectory, 'postman')
  ];
  const discovered = [];

  for (const directory of directories) {
    let entries;
    try {
      entries = await fileSystem.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        continue;
      }

      throw new EndpointSourceError(
        `No se pudo explorar el directorio de endpoints: ${directory}.`,
        { cause: error }
      );
    }

    for (const entry of entries) {
      if (!entry.isFile() || !isEndpointDefinitionFile(entry.name, directory)) {
        continue;
      }

      discovered.push({
        type: 'file',
        path: path.join(directory, entry.name)
      });
    }
  }

  return discovered.sort((left, right) => left.path.localeCompare(right.path));
}

function isEndpointDefinitionFile(fileName, directory) {
  const normalizedName = fileName.toLowerCase();
  const isJsonOrYaml = /\.(json|ya?ml)$/.test(normalizedName);
  const isKnownOpenApi = OPENAPI_FILE_NAMES.has(normalizedName);
  const isNamedOpenApi = /(?:swagger|openapi)/.test(normalizedName) && isJsonOrYaml;
  const isPostmanCollection =
    path.basename(directory).toLowerCase() === 'postman' &&
    normalizedName.endsWith('.json');

  return isKnownOpenApi || isNamedOpenApi || isPostmanCollection;
}

async function loadEndpointDefinition(source, {
  fetchImplementation = globalThis.fetch
} = {}) {
  if (!source) {
    throw new EndpointSourceError(
      'No se encontro una definicion de endpoints. Indica una ruta o URL de OpenAPI/Postman.'
    );
  }

  if (isHttpUrl(source)) {
    if (typeof fetchImplementation !== 'function') {
      throw new EndpointSourceError('No hay fetch disponible para cargar la URL.');
    }

    const response = await fetchImplementation(source, {
      headers: { Accept: 'application/json, application/yaml, text/yaml, */*' }
    });

    if (!response.ok) {
      throw new EndpointSourceError(
        `No se pudo descargar la definicion (${response.status}).`
      );
    }

    return {
      definition: parseDefinition(await response.text(), source),
      source
    };
  }

  try {
    const rawDefinition = await readFile(source, 'utf8');
    return {
      definition: parseDefinition(rawDefinition, source),
      source: path.resolve(source)
    };
  } catch (error) {
    if (error instanceof EndpointSourceError) {
      throw error;
    }

    throw new EndpointSourceError(
      `No se pudo cargar la definicion de endpoints: ${source}.`,
      { cause: error }
    );
  }
}

function parseDefinition(content, sourceName = 'definicion') {
  try {
    return JSON.parse(content);
  } catch {
    try {
      const parsed = YAML.parse(content);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('contenido vacio');
      }

      return parsed;
    } catch (error) {
      throw new EndpointSourceError(
        `El archivo ${sourceName} no contiene JSON o YAML valido.`,
        { cause: error }
      );
    }
  }
}

function extractGetEndpoints(definition, { baseUrl } = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  if (definition?.info && Array.isArray(definition?.item)) {
    return extractPostmanGetEndpoints(definition, normalizedBaseUrl);
  }

  if (definition?.paths && (definition.openapi || definition.swagger)) {
    return extractOpenApiGetEndpoints(definition, normalizedBaseUrl);
  }

  throw new EndpointSourceError(
    'La definicion no parece ser un documento OpenAPI/Swagger ni una coleccion Postman.'
  );
}

function extractOpenApiGetEndpoints(definition, baseUrl) {
  const serverUrl = baseUrl || getOpenApiServerUrl(definition);

  if (!serverUrl) {
    throw new EndpointSourceError(
      'La definicion OpenAPI no tiene servidor. Indica una URL base con --base-url.'
    );
  }

  return Object.entries(definition.paths)
    .filter(([, operations]) => operations?.get)
    .flatMap(([endpoint]) => {
      if (endpoint.includes('{')) {
        return [];
      }

      return [
        {
          endpoint,
          url: new URL(
            endpoint.replace(/^\//, ''),
            `${serverUrl.replace(/\/+$/, '')}/`
          ).toString(),
          source: 'openapi'
        }
      ];
    });
}

function getOpenApiServerUrl(definition) {
  if (definition.openapi && Array.isArray(definition.servers)) {
    const server = definition.servers[0]?.url;
    if (!server || server.includes('{')) {
      return undefined;
    }

    return normalizeBaseUrl(server);
  }

  if (definition.swagger) {
    const scheme = definition.schemes?.[0] || 'https';
    const host = definition.host;
    if (!host) {
      return undefined;
    }

    return normalizeBaseUrl(
      `${scheme}://${host}${definition.basePath || ''}`
    );
  }

  return undefined;
}

function extractPostmanGetEndpoints(definition, baseUrl) {
  const endpoints = [];

  function visit(items) {
    for (const item of items || []) {
      if (Array.isArray(item.item)) {
        visit(item.item);
        continue;
      }

      if (item?.request?.method?.toUpperCase() !== 'GET') {
        continue;
      }

      const rawUrl = getPostmanRawUrl(item.request.url);
      const url = resolvePostmanUrl(rawUrl, baseUrl);
      if (!url || url.includes('{{') || url.includes('{')) {
        continue;
      }

      const parsedUrl = new URL(url);
      endpoints.push({
        endpoint: `${parsedUrl.pathname}${parsedUrl.search}`,
        url,
        source: 'postman',
        name: item.name
      });
    }
  }

  visit(definition.item);
  return endpoints;
}

function getPostmanRawUrl(url) {
  if (typeof url === 'string') {
    return url;
  }

  return url?.raw;
}

function resolvePostmanUrl(rawUrl, baseUrl) {
  if (!rawUrl) {
    return undefined;
  }

  if (isHttpUrl(rawUrl)) {
    return rawUrl;
  }

  if (!baseUrl) {
    return undefined;
  }

  return new URL(rawUrl, `${baseUrl}/`).toString();
}

async function executeGetEndpoints(endpoints, {
  authToken,
  fetchImplementation = globalThis.fetch,
  timeoutMs = 10000,
  onEndpointStart = () => {},
  onEndpointComplete = () => {}
} = {}) {
  if (typeof fetchImplementation !== 'function') {
    throw new EndpointSourceError('No hay fetch disponible para ejecutar endpoints.');
  }

  const headers = {
    Accept: 'application/json, text/plain, */*'
  };

  if (authToken?.trim()) {
    headers.Authorization = `Bearer ${authToken.trim()}`;
  }

  const results = [];
  for (const [index, endpoint] of endpoints.entries()) {
    onEndpointStart({ endpoint, index: index + 1, total: endpoints.length });
    const result = await executeSingleGet(endpoint, {
      headers,
      fetchImplementation,
      timeoutMs
    });
    results.push(result);
    onEndpointComplete({
      endpoint,
      result,
      index: index + 1,
      total: endpoints.length
    });
  }

  return results;
}

async function executeSingleGet(endpoint, {
  headers,
  fetchImplementation,
  timeoutMs
}) {
  const startedAt = performance.now();

  try {
    const response = await fetchImplementation(endpoint.url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    });
    const payload = await response.text();

    return {
      endpoint: endpoint.endpoint,
      status: response.status,
      responseTimeMs: Math.round(performance.now() - startedAt),
      responseHash: hashPayload(payload),
      payloadSnippet: createPayloadSnippet(payload)
    };
  } catch (error) {
    return {
      endpoint: endpoint.endpoint,
      status: null,
      responseTimeMs: Math.round(performance.now() - startedAt),
      responseHash: null,
      payloadSnippet: null,
      error: error.name === 'TimeoutError' ? 'Timeout' : error.message
    };
  }
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function createPayloadSnippet(payload, limit = 500) {
  const compactPayload = payload.replace(/\s+/g, ' ').trim();
  return compactPayload.slice(0, limit);
}

function createBaselineReport(microserviceName, results, timestamp = new Date()) {
  return createEndpointReport('PRE', microserviceName, results, timestamp);
}

function createPostMigrationReport(microserviceName, results, timestamp = new Date()) {
  return createEndpointReport('POST', microserviceName, results, timestamp);
}

function createEndpointReport(phase, microserviceName, results, timestamp = new Date()) {
  return {
    timestamp: timestamp.toISOString(),
    microservice: microserviceName,
    phase,
    results
  };
}

async function writeBaselineReport(report, options = {}) {
  return writeEndpointReport(report, options);
}

async function writePostMigrationReport(report, options = {}) {
  return writeEndpointReport(report, options);
}

async function writeEndpointReport(report, {
  currentDirectory = process.cwd(),
  fileSystem = { mkdir, writeFile }
} = {}) {
  const isPost = report.phase === 'POST';
  const historyDirectory = getHistoryDirectory(
    currentDirectory,
    isPost ? 3 : 0,
    isPost ? 'POST-Endpoints' : 'PRE-Endpoints',
    report.timestamp
  );
  const reportPath = path.join(
    historyDirectory,
    isPost ? 'endpoints-post.json' : 'endpoints-pre.json'
  );
  const markdownPath = path.join(
    historyDirectory,
    isPost ? 'endpoints-post.md' : 'endpoints-pre.md'
  );

  await fileSystem.mkdir(historyDirectory, { recursive: true });
  await fileSystem.writeFile(
    reportPath,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8'
  );
  await fileSystem.writeFile(
    markdownPath,
    renderEndpointMarkdown(report),
    'utf8'
  );

  return reportPath;
}

function renderEndpointMarkdown(report) {
  const rows = report.results.map((result) =>
    `| \`${result.endpoint}\` | ${result.status ?? 'ERROR'} | ${result.responseTimeMs} ms | ${result.error || 'OK'} |`
  );

  return [
    `# Endpoints ${report.phase} — ${report.microservice}`,
    '',
    `- **Timestamp:** ${report.timestamp}`,
    `- **Total:** ${report.results.length}`,
    '',
    '| Endpoint | Status | Tiempo | Resultado |',
    '| --- | ---: | ---: | --- |',
    ...rows,
    ''
  ].join('\n');
}

function summarizeResults(results) {
  const ok = results.filter((result) => result.status === 200).length;
  const errors = results.length - ok;

  return {
    total: results.length,
    ok,
    errors
  };
}

module.exports = {
  EndpointSourceError,
  createBaselineReport,
  createEndpointReport,
  createPayloadSnippet,
  createPostMigrationReport,
  discoverEndpointSource,
  discoverEndpointSources,
  executeGetEndpoints,
  extractGetEndpoints,
  loadEndpointDefinition,
  parseDefinition,
  summarizeResults,
  renderEndpointMarkdown,
  writeBaselineReport,
  writeEndpointReport,
  writePostMigrationReport
};
