'use strict';

const prompts = require('@clack/prompts');
const pc = require('picocolors');
const { runInitCommand } = require('./init');
const {
  runPreMigrationEndpoints,
  runPostMigrationEndpoints
} = require('./endpoints');
const { runStation1Preparation } = require('./station1');
const { runStation2Quality } = require('./quality');
const { runMigrationSummary } = require('./summary');
const { runMigrationPipeline } = require('./run');
const { discoverEndpointSources } = require('../services/endpoints');

const MICROSERVICE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateMicroserviceSlug(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return 'Indica el nombre del microservicio.';
  }

  if (!MICROSERVICE_SLUG_PATTERN.test(value.trim())) {
    return 'Usa un slug en minusculas: letras, numeros y guiones (ej. auth-service).';
  }

  return undefined;
}

function buildExecutionSummary(microserviceName, mode) {
  const destination = mode === 'jira-linked'
    ? 'en una tarea Jira existente'
    : 'en un archivo Markdown local';
  return [
    `Microservicio: ${microserviceName}`,
    `Destino: ${destination}`,
    'No se crearán tareas ni subtareas de Jira.'
  ].join('\n');
}

function buildSuccessPanel(result) {
  if (result.mode === 'jira-linked') {
    return [
      pc.bold(pc.green('Tarea Jira vinculada correctamente')),
      '',
      `Incidencia: ${result.issueKey}`,
      `Configuración: ${result.envPath}`
    ].join('\n');
  }

  return [
    pc.bold(pc.green('Checklist de migracion generado correctamente')),
    '',
    `Archivo: ${result.historyPath}`
  ].join('\n');
}

async function runInteractiveWizard({
  environment = process.env,
  currentDirectory = process.cwd(),
  promptApi = prompts,
  output = () => {},
  runPipeline = runMigrationPipeline,
  runInit = runInitCommand
} = {}) {
  promptApi.intro(pc.bgCyan(pc.black(' Microservice Migration Orchestrator ')));

  const action = await promptApi.select({
    message: '¿Qué deseas hacer?',
    options: [
      { value: 'run', label: '🚀 Ejecutar Migración Completa', hint: 'Auto-pipeline run' },
      { value: 'tasks', label: '📋 Gestionar Tareas', hint: 'Estación 0' },
      { value: 'endpoints', label: '🔍 Analizar Endpoints y Paridad', hint: 'Estaciones 0 y 3' },
      { value: 'station1', label: '🛠️ Versionado y Documentación', hint: 'Estación 1' },
      { value: 'station2', label: '🧪 Cobertura y Calidad', hint: 'Estación 2' },
      { value: 'exit', label: '❌ Salir' }
    ]
  });

  if (isCancelled(action, promptApi) || action === 'exit') {
    return cancelWizard(promptApi, 'Hasta pronto.');
  }

  if (action === 'run') {
    const projectDirectory = await askProjectDirectory(currentDirectory, promptApi);
    if (!projectDirectory) {
      return cancelWizard(promptApi);
    }

    const postBaseUrl = await promptApi.text({
      message: 'URL base de la API migrada para paridad POST (opcional):',
      placeholder: 'https://api-migrada.example.com'
    });
    if (isCancelled(postBaseUrl, promptApi)) {
      return cancelWizard(promptApi);
    }

    const result = await runPipeline(projectDirectory, {
      currentDirectory,
      environment,
      output,
      postBaseUrl: postBaseUrl || undefined
    });
    promptApi.outro(pc.green('Pipeline finalizado.'));
    return result;
  }

  const microserviceName = await askMicroserviceName(promptApi);
  if (!microserviceName) {
    return cancelWizard(promptApi);
  }

  if (action === 'tasks') {
    const result = await runTasksWizard({
      microserviceName,
      environment,
      currentDirectory,
      promptApi,
      output,
      runInit
    });
    promptApi.outro(pc.green('Gestión de tareas finalizada.'));
    return result;
  }

  if (action === 'endpoints') {
    const phase = await promptApi.select({
      message: 'Fase de endpoints:',
      options: [
        { value: 'pre', label: 'PRE', hint: 'baseline antes de migrar' },
        { value: 'post', label: 'POST', hint: 'comparar contra baseline PRE' }
      ]
    });
    if (isCancelled(phase, promptApi)) {
      return cancelWizard(promptApi);
    }

    const result = phase === 'pre'
      ? await runEndpointsBaselineWizard({
        microserviceName, environment, currentDirectory, promptApi, output
      })
      : await runStation3Wizard({
        microserviceName, environment, currentDirectory, promptApi, output,
        skipConfirmation: true
      });
    promptApi.outro(pc.green('Análisis de endpoints finalizado.'));
    return result;
  }

  const projectDirectory = await askProjectDirectory(currentDirectory, promptApi);
  if (!projectDirectory) {
    return cancelWizard(promptApi);
  }

  const result = action === 'station1'
    ? await runStation1PreparationWizard({
      currentDirectory: projectDirectory, promptApi, output, skipQuestion: true
    })
    : await runStation2QualityWizard({
      currentDirectory: projectDirectory, environment, promptApi, output, skipQuestion: true
    });

  promptApi.outro(pc.green('Proceso finalizado.'));
  return result;
}

async function runTasksWizard({
  microserviceName,
  environment,
  currentDirectory,
  promptApi,
  output,
  runInit = runInitCommand
}) {
  const jiraIssueKey = await promptApi.text({
    message: 'Clave o URL de la tarea Jira existente (opcional):',
    placeholder: 'EVOLCRE4-1234 o https://jira.example.com/browse/EVOLCRE4-1234'
  });
  if (isCancelled(jiraIssueKey, promptApi)) {
    return { mode: 'cancelled' };
  }

  const mode = jiraIssueKey?.trim() || environment.JIRA_ISSUE_KEY
    ? 'jira-linked'
    : 'local';
  promptApi.note(buildExecutionSummary(microserviceName, mode), 'Resumen');

  const confirmed = await promptApi.confirm({
    message: '¿Confirmas la ejecución?',
    initialValue: true
  });
  if (isCancelled(confirmed, promptApi) || !confirmed) {
    return { mode: 'cancelled' };
  }

  const spinner = promptApi.spinner();
  const result = await runInit(microserviceName, {
    environment,
    currentDirectory,
    jiraIssueKey: jiraIssueKey?.trim() || undefined,
    mode: mode === 'local' ? 'local' : 'auto',
    output,
    progress: createProgressHandlers(spinner)
  });
  promptApi.note(buildSuccessPanel(result), 'Inicialización completada');
  return result;
}

async function runEndpointsBaselineWizard({
  microserviceName,
  environment,
  currentDirectory,
  promptApi,
  output,
  runBaseline = runPreMigrationEndpoints,
  discoverSources = discoverEndpointSources,
  discoverSource
}) {
  const source = await selectEndpointSource({
    currentDirectory,
    promptApi,
    discoverSources: discoverSource
      ? async (directory) => {
        const discovered = await discoverSource(directory);
        return discovered ? [discovered] : [];
      }
      : discoverSources
  });
  if (!source) {
    return { mode: 'cancelled' };
  }

  const baseUrl = await promptApi.text({
    message: 'URL base de la API (opcional):',
    placeholder: 'https://api.example.com'
  });
  const authToken = await askAuthToken(environment, promptApi);
  if (isCancelled(baseUrl, promptApi) || authToken === null) {
    return { mode: 'cancelled' };
  }

  return runBaseline(microserviceName, {
    source,
    baseUrl: baseUrl || undefined,
    authToken: authToken || undefined,
    currentDirectory,
    output,
    progress: createEndpointProgressHandlers(promptApi.spinner())
  });
}

async function selectEndpointSource({ currentDirectory, promptApi, discoverSources }) {
  const sources = await discoverSources(currentDirectory);
  if (sources.length === 1) {
    promptApi.note(`Definición detectada: ${sources[0].path}`, 'Endpoints');
    return sources[0].path;
  }

  if (sources.length > 1) {
    const selected = await promptApi.select({
      message: 'Se detectaron varias definiciones. Selecciona una:',
      options: sources.map((source) => ({
        value: source.path,
        label: source.path,
        hint: source.type
      }))
    });
    return isCancelled(selected, promptApi) ? undefined : selected;
  }

  const source = await promptApi.text({
    message: 'No se detectó OpenAPI/Swagger/Postman. Indica ruta o URL:',
    placeholder: 'docs/openapi.yaml o https://api.example.com/openapi.json',
    validate: (value) => value?.trim() ? undefined : 'Indica una ruta o URL de definición.'
  });
  return isCancelled(source, promptApi) ? undefined : source.trim();
}

async function runStation1PreparationWizard({
  currentDirectory,
  promptApi,
  output,
  runPreparation = runStation1Preparation,
  skipQuestion = false
}) {
  if (!skipQuestion) {
    const shouldPrepare = await promptApi.confirm({
      message: '¿Deseas preparar la Estación 1 (versionado y README técnico)?',
      initialValue: false
    });
    if (isCancelled(shouldPrepare, promptApi) || !shouldPrepare) {
      return undefined;
    }
  }

  const bumpType = await promptApi.select({
    message: 'Tipo de incremento de versión:',
    options: [
      { value: 'patch', label: 'Patch', hint: '1.0.0 → 1.0.1' },
      { value: 'minor', label: 'Minor', hint: '1.0.0 → 1.1.0' },
      { value: 'snapshot', label: 'Snapshot', hint: '1.0.0 → 1.0.1-SNAPSHOT' }
    ]
  });
  if (isCancelled(bumpType, promptApi)) {
    return { mode: 'cancelled' };
  }

  return runPreparation(currentDirectory, bumpType, { output });
}

async function runStation2QualityWizard({
  currentDirectory,
  environment,
  promptApi,
  output,
  runQuality = runStation2Quality,
  skipQuestion = false
}) {
  if (!skipQuestion) {
    const shouldAnalyze = await promptApi.confirm({
      message: '¿Deseas ejecutar el análisis de calidad de la Estación 2?',
      initialValue: false
    });
    if (isCancelled(shouldAnalyze, promptApi) || !shouldAnalyze) {
      return undefined;
    }
  }

  return runQuality(currentDirectory, {
    currentDirectory,
    environment,
    output
  });
}

async function runStation3Wizard({
  microserviceName,
  currentDirectory,
  environment,
  promptApi,
  output,
  runPost = runPostMigrationEndpoints,
  runSummary = runMigrationSummary,
  discoverSources = discoverEndpointSources,
  skipConfirmation = false
}) {
  if (!skipConfirmation) {
    const shouldRunPost = await promptApi.confirm({
      message: '¿Deseas ejecutar validación POST y paridad de Estación 3?',
      initialValue: false
    });
    if (isCancelled(shouldRunPost, promptApi) || !shouldRunPost) {
      return undefined;
    }
  }

  const source = await selectEndpointSource({
    currentDirectory, promptApi, discoverSources
  });
  if (!source) {
    return { mode: 'cancelled' };
  }

  const baseUrl = await promptApi.text({
    message: 'URL base de la API migrada:',
    placeholder: 'https://api-migrada.example.com',
    validate: (value) => value?.trim() ? undefined : 'La URL base es obligatoria para POST.'
  });
  const authToken = await askAuthToken(environment, promptApi);
  if (isCancelled(baseUrl, promptApi) || authToken === null) {
    return { mode: 'cancelled' };
  }

  const post = await runPost(microserviceName, {
    source,
    baseUrl,
    authToken: authToken || undefined,
    currentDirectory,
    output
  });
  const summary = await runSummary(microserviceName, {
    currentDirectory,
    output
  });
  return { post, summary };
}

async function askMicroserviceName(promptApi) {
  const value = await promptApi.text({
    message: 'Nombre del microservicio:',
    placeholder: 'auth-service',
    validate: validateMicroserviceSlug
  });
  return isCancelled(value, promptApi) ? undefined : value.trim();
}

async function askProjectDirectory(currentDirectory, promptApi) {
  const value = await promptApi.text({
    message: 'Ruta del microservicio:',
    initialValue: currentDirectory,
    validate: (input) => input?.trim() ? undefined : 'Indica una ruta de proyecto.'
  });
  return isCancelled(value, promptApi) ? undefined : value.trim();
}

async function askAuthToken(environment, promptApi) {
  if (environment.AUTH_TOKEN) {
    return environment.AUTH_TOKEN;
  }

  const token = await promptApi.password({
    message: 'Bearer token OAuth2 (opcional):'
  });
  return isCancelled(token, promptApi) ? null : token;
}

function createEndpointProgressHandlers(spinner) {
  return {
    onDiscovery: ({ total }) => spinner.start(`Preparando ${total} endpoints GET...`),
    onEndpointStart: ({ index, total, endpoint }) =>
      spinner.start(`Probando endpoint ${index}/${total}: ${endpoint.endpoint}`),
    onEndpointComplete: ({ index, total, result }) =>
      spinner.stop(`Endpoint ${index}/${total}: ${result.status ?? 'error'} (${result.responseTimeMs} ms)`)
  };
}

function createProgressHandlers(spinner) {
  return {
    onLocalStart: () => spinner.start('Generando checklist Markdown local...'),
    onLocalCreated: ({ historyPath }) => spinner.stop(`Checklist guardado en ${historyPath}`)
  };
}

function cancelWizard(promptApi, message = 'Operación cancelada.') {
  promptApi.cancel(message);
  return { mode: 'cancelled' };
}

function isCancelled(value, promptApi) {
  return promptApi.isCancel(value);
}

module.exports = {
  MICROSERVICE_SLUG_PATTERN,
  buildExecutionSummary,
  buildSuccessPanel,
  createEndpointProgressHandlers,
  createProgressHandlers,
  runEndpointsBaselineWizard,
  runInteractiveWizard,
  runStation1PreparationWizard,
  runStation2QualityWizard,
  runStation3Wizard,
  runTasksWizard,
  selectEndpointSource,
  validateMicroserviceSlug
};
