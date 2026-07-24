'use strict';

const prompts = require('@clack/prompts');
const pc = require('picocolors');
const { runInitCommand } = require('./init');
const { runPreMigrationEndpoints } = require('./endpoints');
const { runStation1Preparation } = require('./station1');
const { runStation2Quality } = require('./quality');
const { discoverEndpointSource } = require('../services/endpoints');
const { JiraClient } = require('../services/jira');

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
  const destination = mode === 'jira' ? 'en Jira' : 'en un archivo Markdown local';

  return [
    `Microservicio: ${microserviceName}`,
    `Destino: ${destination}`,
    'Se creara 1 tarea padre y 8 subtareas estandar.'
  ].join('\n');
}

function buildSuccessPanel(result) {
  if (result.mode === 'jira') {
    const links = [
      `Padre: ${result.parent.key} - ${result.parent.url}`,
      ...result.subtasks.map(
        (subtask) => `Subtarea: ${subtask.key} - ${subtask.url}`
      )
    ];

    return [
      pc.bold(pc.green('Tareas de migracion creadas correctamente')),
      '',
      ...links,
      '',
      pc.dim('Siguiente paso: inicia la Estacion 0 con las pruebas de endpoints.')
    ].join('\n');
  }

  return [
    pc.bold(pc.green('Checklist de migracion generado correctamente')),
    '',
    `Archivo: ${result.historyPath}`,
    '',
    pc.dim('Siguiente paso: completa la Estacion 0 y actualiza el checklist.')
  ].join('\n');
}

async function runInteractiveWizard({
  environment = process.env,
  currentDirectory = process.cwd(),
  promptApi = prompts,
  runInit = runInitCommand,
  output = () => {}
} = {}) {
  promptApi.intro(pc.bgCyan(pc.black(' Microservice Migration Orchestrator ')));

  const microserviceName = await promptApi.text({
    message: 'Nombre del microservicio:',
    placeholder: 'auth-service',
    validate: validateMicroserviceSlug
  });

  if (isCancelled(microserviceName, promptApi)) {
    return cancelWizard(promptApi);
  }

  const jiraConfigured = JiraClient.isConfigured(environment);
  let mode = 'jira';

  if (!jiraConfigured) {
    promptApi.note(
      'No se detecto una configuracion Jira completa. Puedes generar un checklist local o configurar Jira antes de continuar.',
      'Entorno Jira'
    );

    mode = await promptApi.select({
      message: 'Donde deseas crear las tareas?',
      options: [
        {
          value: 'jira',
          label: 'Jira',
          hint: 'requiere configurar JIRA_HOST, JIRA_PROJECT_KEY y autenticacion'
        },
        {
          value: 'local',
          label: 'Local Markdown',
          hint: 'genera .axetrules/history/jira-tasks-<servicio>.md'
        }
      ]
    });

    if (isCancelled(mode, promptApi)) {
      return cancelWizard(promptApi);
    }

    if (mode === 'jira') {
      promptApi.note(
        'Configura JIRA_HOST, JIRA_PROJECT_KEY y JIRA_AUTH_BASIC o JIRA_API_TOKEN. A continuacion vuelve a ejecutar el asistente.',
        'Jira necesita configuracion'
      );
      return cancelWizard(promptApi, 'No se realizaron cambios.');
    }
  }

  promptApi.note(buildExecutionSummary(microserviceName, mode), 'Resumen');
  const confirmed = await promptApi.confirm({
    message: 'Confirmas la ejecucion?',
    initialValue: true
  });

  if (isCancelled(confirmed, promptApi) || !confirmed) {
    return cancelWizard(promptApi, 'Operacion cancelada. No se realizaron cambios.');
  }

  const spinner = promptApi.spinner();
  const result = await runInit(microserviceName, {
    environment,
    currentDirectory,
    mode,
    output,
    progress: createProgressHandlers(spinner)
  });

  promptApi.note(buildSuccessPanel(result), 'Inicializacion completada');

  const shouldRunBaseline = await promptApi.confirm({
    message: 'Deseas ejecutar ahora la baseline PRE de endpoints?',
    initialValue: false
  });

  let baselineResult;
  if (isCancelled(shouldRunBaseline, promptApi)) {
    return cancelWizard(promptApi);
  }

  if (shouldRunBaseline) {
    baselineResult = await runEndpointsBaselineWizard({
      microserviceName,
      environment,
      currentDirectory,
      promptApi,
      output
    });
  }

  const station1Result = await runStation1PreparationWizard({
    currentDirectory,
    promptApi,
    output
  });
  const station2Result = await runStation2QualityWizard({
    currentDirectory,
    environment,
    promptApi,
    output
  });

  promptApi.outro(pc.green('Proceso finalizado.'));

  return {
    ...result,
    ...(baselineResult ? { baseline: baselineResult } : {}),
    ...(station1Result ? { station1: station1Result } : {}),
    ...(station2Result ? { station2: station2Result } : {})
  };
}

async function runEndpointsBaselineWizard({
  microserviceName,
  environment,
  currentDirectory,
  promptApi,
  output,
  runBaseline = runPreMigrationEndpoints,
  discoverSource = discoverEndpointSource
}) {
  const discoveredSource = await discoverSource(currentDirectory);
  let source = discoveredSource?.path;

  if (source) {
    promptApi.note(`Definicion detectada: ${source}`, 'Endpoints');
  } else {
    source = await promptApi.text({
      message: 'Ruta o URL de OpenAPI/Swagger/Postman:',
      placeholder: 'docs/openapi.yaml o https://api.example.com/openapi.json',
      validate: (value) =>
        value?.trim() ? undefined : 'Indica una ruta o URL de definicion.'
    });

    if (isCancelled(source, promptApi)) {
      return { mode: 'cancelled' };
    }
  }

  const baseUrl = await promptApi.text({
    message: 'URL base de la API (opcional):',
    placeholder: 'https://api.example.com'
  });

  if (isCancelled(baseUrl, promptApi)) {
    return { mode: 'cancelled' };
  }

  let authToken = environment.AUTH_TOKEN;
  if (!authToken) {
    authToken = await promptApi.password({
      message: 'Bearer token OAuth2 (opcional):'
    });

    if (isCancelled(authToken, promptApi)) {
      return { mode: 'cancelled' };
    }
  }

  const spinner = promptApi.spinner();
  return runBaseline(microserviceName, {
    source,
    baseUrl: baseUrl || undefined,
    authToken: authToken || undefined,
    currentDirectory,
    output,
    progress: {
      onDiscovery: ({ total }) =>
        spinner.start(`Preparando ${total} endpoints GET...`),
      onEndpointStart: ({ index, total, endpoint }) =>
        spinner.start(`Probando endpoint ${index}/${total}: ${endpoint.endpoint}`),
      onEndpointComplete: ({ index, total, result }) =>
        spinner.stop(
          `Endpoint ${index}/${total}: ${result.status ?? 'ERROR'} (${result.responseTimeMs} ms)`
        )
    }
  });
}

async function runStation1PreparationWizard({
  currentDirectory,
  promptApi,
  output,
  runPreparation = runStation1Preparation
}) {
  const shouldPrepare = await promptApi.confirm({
    message: 'Deseas preparar la Estacion 1 (versionado y README tecnico)?',
    initialValue: false
  });

  if (isCancelled(shouldPrepare, promptApi) || !shouldPrepare) {
    return undefined;
  }

  const projectDirectory = await promptApi.text({
    message: 'Ruta del microservicio:',
    initialValue: currentDirectory,
    validate: (value) => value?.trim() ? undefined : 'Indica una ruta de proyecto.'
  });

  if (isCancelled(projectDirectory, promptApi)) {
    return { mode: 'cancelled' };
  }

  const bumpType = await promptApi.select({
    message: 'Tipo de incremento de version:',
    options: [
      { value: 'patch', label: 'Patch', hint: '1.0.0 → 1.0.1' },
      { value: 'minor', label: 'Minor', hint: '1.0.0 → 1.1.0' },
      { value: 'snapshot', label: 'Snapshot', hint: '1.0.0 → 1.0.1-SNAPSHOT' }
    ]
  });

  if (isCancelled(bumpType, promptApi)) {
    return { mode: 'cancelled' };
  }

  const confirmed = await promptApi.confirm({
    message: `Confirmas actualizar la version (${bumpType}) y generar README?`,
    initialValue: true
  });

  if (isCancelled(confirmed, promptApi) || !confirmed) {
    return { mode: 'cancelled' };
  }

  const spinner = promptApi.spinner();
  spinner.start('Actualizando version y generando README tecnico...');

  try {
    const result = await runPreparation(projectDirectory.trim(), bumpType, {
      output
    });
    spinner.stop(
      `Estacion 1 preparada: ${result.version.previousVersion} → ${result.version.nextVersion}`
    );
    return result;
  } catch (error) {
    spinner.stop('No se pudo preparar la Estacion 1.');
    throw error;
  }
}

async function runStation2QualityWizard({
  currentDirectory,
  environment,
  promptApi,
  output,
  runQuality = runStation2Quality
}) {
  const shouldAnalyze = await promptApi.confirm({
    message: 'Deseas ejecutar el análisis de calidad de la Estacion 2?',
    initialValue: false
  });

  if (isCancelled(shouldAnalyze, promptApi) || !shouldAnalyze) {
    return undefined;
  }

  const projectDirectory = await promptApi.text({
    message: 'Ruta del microservicio:',
    initialValue: currentDirectory,
    validate: (value) => value?.trim() ? undefined : 'Indica una ruta de proyecto.'
  });

  if (isCancelled(projectDirectory, promptApi)) {
    return { mode: 'cancelled' };
  }

  const confirmed = await promptApi.confirm({
    message: 'Confirmas ejecutar tests JaCoCo y consultar SonarQube si está configurado?',
    initialValue: true
  });

  if (isCancelled(confirmed, promptApi) || !confirmed) {
    return { mode: 'cancelled' };
  }

  const spinner = promptApi.spinner();
  spinner.start('Ejecutando cobertura JaCoCo y análisis SonarQube...');

  try {
    const result = await runQuality(projectDirectory.trim(), {
      currentDirectory,
      environment,
      output,
      progress: {
        onBuildStart: ({ buildTool }) =>
          spinner.start(`Ejecutando tests y JaCoCo con ${buildTool}...`),
        onSonarStart: () => spinner.start('Consultando métricas de SonarQube...')
      }
    });
    spinner.stop('Análisis de calidad de Estacion 2 completado.');
    return result;
  } catch (error) {
    spinner.stop('No se pudo completar el análisis de Estacion 2.');
    throw error;
  }
}

function createProgressHandlers(spinner) {
  return {
    onParentStart: () => spinner.start('Conectando con Jira y creando tarea padre...'),
    onParentCreated: ({ parent }) =>
      spinner.stop(`Tarea padre creada: ${parent.key}`),
    onSubtaskStart: ({ index, total }) =>
      spinner.start(`Creando subtarea ${index}/${total}...`),
    onSubtaskCreated: ({ index, total, subtask }) =>
      spinner.stop(`Subtarea ${index}/${total} creada: ${subtask.key}`),
    onLocalStart: () => spinner.start('Generando checklist Markdown local...'),
    onLocalCreated: ({ historyPath }) =>
      spinner.stop(`Checklist guardado en ${historyPath}`)
  };
}

function cancelWizard(promptApi, message = 'Operacion cancelada.') {
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
  createProgressHandlers,
  runEndpointsBaselineWizard,
  runInteractiveWizard,
  runStation1PreparationWizard,
  runStation2QualityWizard,
  validateMicroserviceSlug
};
