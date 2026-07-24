#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const { runInitCommand } = require('../src/commands/init');
const { runPreMigrationEndpoints } = require('../src/commands/endpoints');
const { runInteractiveWizard } = require('../src/commands/wizard');
const { JiraRequestError } = require('../src/services/jira');

const program = new Command();

program
  .name('migration-cli')
  .description(
    'Orquesta las tareas y controles necesarios para migrar un microservicio.'
  )
  .version('0.1.0')
  .action(runWizard);

program
  .command('init [microserviceName]')
  .description(
    'Crea tareas de migracion o inicia el asistente si no se indica microservicio.'
  )
  .action(async (microserviceName) => {
    if (!microserviceName) {
      await runWizard();
      return;
    }

    await runInitCommand(microserviceName);
  });

program
  .command('endpoints [microserviceName]')
  .description('Ejecuta pruebas de endpoints y guarda una evidencia de baseline.')
  .requiredOption('--pre', 'Ejecuta la baseline previa a la migracion.')
  .option('--source <rutaOUrl>', 'Ruta o URL de una definicion OpenAPI/Postman.')
  .option('--base-url <url>', 'URL base para OpenAPI sin servidor o Postman relativo.')
  .option('--auth-token <token>', 'Bearer token; se recomienda usar AUTH_TOKEN.')
  .option('--timeout <milisegundos>', 'Timeout por endpoint.', Number)
  .action(async (microserviceName, options) => {
    if (!microserviceName) {
      throw new Error(
        'Indica el microservicio: migration-cli endpoints --pre <microserviceName>.'
      );
    }

    await runPreMigrationEndpoints(microserviceName, {
      source: options.source,
      baseUrl: options.baseUrl,
      authToken: options.authToken || process.env.AUTH_TOKEN,
      timeoutMs: options.timeout
    });
  });

program.parseAsync(process.argv).catch((error) => {
  printError(error);
  process.exitCode = 1;
});

async function runWizard() {
  try {
    await runInteractiveWizard();
  } catch (error) {
    printError(error);
    process.exitCode = 1;
  }
}

function printError(error) {
  console.error(`Error: ${error.message}`);

  if (error instanceof JiraRequestError && error.status) {
    console.error(`Respuesta HTTP de Jira: ${error.status}`);
  }
}
