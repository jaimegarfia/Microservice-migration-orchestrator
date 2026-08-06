#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const packageInfo = require('../package.json');
const { runInitCommand } = require('../src/commands/init');
const { runCommentCommand } = require('../src/commands/comment');
const {
  runPreMigrationEndpoints,
  runPostMigrationEndpoints
} = require('../src/commands/endpoints');
const {
  runMavenToGradleCommand,
  runReadmeCommand,
  runRewriteCommand,
  runVersionCommand
} = require('../src/commands/station1');
const {
  runCoverageCommand,
  runSonarCommand
} = require('../src/commands/quality');
const { runMigrationSummary } = require('../src/commands/summary');
const { runMigrationPipeline } = require('../src/commands/run');
const { runWorkflowCommand } = require('../src/commands/workflow');
const { runInteractiveWizard } = require('../src/commands/wizard');
const { JiraRequestError } = require('../src/services/jira');

const program = new Command();

program
  .name('migration-cli')
  .description(
    'Orquesta la línea de producción para migrar microservicios por estaciones.'
  )
  .version(packageInfo.version, '-V, --version', 'Muestra la versión instalada.')
  .configureHelp({
    sortSubcommands: true,
    sortOptions: true,
    showGlobalOptions: true
  })
  .addHelpText('after', `
Ejemplos:
  $ migration-cli
  $ migration-cli init auth-service
  $ migration-cli endpoints --pre auth-service --source docs/openapi.yaml
  $ migration-cli endpoints --post auth-service --base-url https://api-migrada.example.com
  $ migration-cli rewrite ./auth-service
  $ migration-cli summary auth-service ./auth-service

Consulta "migration-cli <comando> --help" para ver flags, ejemplos y variables de entorno.
`)
  .action(runWizard);

program
  .command('init [microserviceName]')
  .description(
    'Estación 0: vincula una tarea Jira existente o genera el checklist local.'
  )
  .option('--jira-issue <claveOUrl>', 'Clave o URL de la tarea Jira existente que se debe vincular.')
  .addHelpText('after', `
Ejemplos:
  $ migration-cli init auth-service
  $ migration-cli init

Variables de entorno Jira:
  JIRA_HOST, JIRA_PROJECT_KEY y JIRA_AUTH_BASIC o JIRA_API_TOKEN.
  Opcionales: JIRA_ISSUE_TYPE y JIRA_SUBTASK_ISSUE_TYPE.

Sin configuración Jira se genera:
  .axetrules/history/jira-tasks-<microservicio>.md
`)
  .action(async (microserviceName, options) => {
    if (!microserviceName) {
      await runWizard();
      return;
    }

    await runInitCommand(microserviceName, {
      jiraIssueKey: options.jiraIssue
    });
  });

program
  .command('comment <stationNumber> [microservicePath]')
  .description('Publica la evidencia de una estación en la tarea Jira vinculada.')
  .addHelpText('after', `
Ejemplos:
  $ migration-cli comment 0 ./auth-service
  $ migration-cli comment 2 .

Lee JIRA_ISSUE_KEY desde .env o el entorno, genera un comentario Markdown con la
evidencia disponible de la estación y lo publica en Jira.
`)
  .action(async (stationNumber, microservicePath) => {
    await runCommentCommand(stationNumber, {
      currentDirectory: microservicePath || process.cwd(),
      environment: process.env
    });
  });

program
  .command('run [microservicePath]')
  .description('Ejecuta el pipeline Zero-Config de Estaciones 0 a 3 con tolerancia a fallos.')
  .option('--source <rutaOUrl>', 'Definición OpenAPI, Swagger o Postman; se detecta automáticamente si se omite.')
  .option('--base-url <url>', 'URL base para ejecutar la baseline PRE cuando la definición no tiene servidor.')
  .option('--post-base-url <url>', 'URL base migrada para ejecutar POST y el motor de paridad.')
  .option('--auth-token <token>', 'Token Bearer opcional para endpoints; prevalece sobre AUTH_TOKEN.')
  .option('--bump <tipo>', 'Incremento de versión: patch, minor o snapshot.', 'patch')
  .option('--timeout <milisegundos>', 'Tiempo máximo por endpoint en milisegundos.', Number)
  .addHelpText('after', `
Ejemplos:
  $ migration-cli run ./auth-service
  $ migration-cli run ./auth-service --post-base-url https://api-migrada.example.com
  $ migration-cli run ./auth-service --source docs/openapi.yaml --bump minor

El pipeline detecta definición API, genera tareas Jira o checklist local, ejecuta
PRE, versionado, README, cobertura, SonarQube, POST opcional y resumen maestro.
Los fallos no críticos se registran como [WARNING] y no detienen el flujo.
`)
  .action(async (microservicePath, options) => {
    await runMigrationPipeline(microservicePath || process.cwd(), {
      currentDirectory: process.cwd(),
      source: options.source,
      baseUrl: options.baseUrl,
      postBaseUrl: options.postBaseUrl,
      authToken: options.authToken || process.env.AUTH_TOKEN,
      bumpType: options.bump,
      timeoutMs: options.timeout
    });
  });

program
  .command('endpoints [microserviceName]')
  .description(
    'Estaciones 0 y 3: ejecuta GET de endpoints y genera baseline PRE o paridad POST.'
  )
  .option('--pre', 'Genera la baseline previa a la migración.')
  .option('--post', 'Ejecuta POST y compara automáticamente contra el último PRE.')
  .option('--source <rutaOUrl>', 'Ruta o URL de la definición OpenAPI, Swagger o Postman.')
  .option('--base-url <url>', 'URL base para OpenAPI sin servidor o URLs relativas de Postman.')
  .option('--auth-token <token>', 'Token Bearer para los GET; prevalece sobre AUTH_TOKEN.')
  .option('--timeout <milisegundos>', 'Tiempo máximo por endpoint en milisegundos.', Number)
  .addHelpText('after', `
Ejemplos:
  $ migration-cli endpoints --pre auth-service
  $ migration-cli endpoints --pre auth-service --source docs/openapi.yaml
  $ migration-cli endpoints --post auth-service --base-url https://api-migrada.example.com
  $ migration-cli endpoints --post auth-service --timeout 15000

Usa exactamente una fase: --pre o --post.
Autenticación: --auth-token tiene prioridad. Si no se indica token, AUTH_TOKEN se usa
primero; con AUTH_PROVIDER=ATLAS o AUTH_PROVIDER=AGORA se solicita un token OAuth2.
El token no se persiste.

Artefactos:
  PRE:  .axetrules/history/<timestamp>/endpoints-pre.json
  POST: .axetrules/history/<timestamp>/endpoints-post.json
        .axetrules/history/<timestamp>/parity-report.md
`)
  .action(async (microserviceName, options) => {
    if (!microserviceName || (!options.pre && !options.post) || (options.pre && options.post)) {
      throw new Error(
        'Uso: migration-cli endpoints --pre|--post <microserviceName>.'
      );
    }

    const runEndpoints = options.post
      ? runPostMigrationEndpoints
      : runPreMigrationEndpoints;
    await runEndpoints(microserviceName, {
      source: options.source,
      baseUrl: options.baseUrl,
      authToken: options.authToken || process.env.AUTH_TOKEN,
      timeoutMs: options.timeout
    });
  });

program
  .command('version [microservicePath]')
  .description('Estación 1: actualiza versiones de Maven, Gradle y/o Sonar.')
  .requiredOption('--bump <tipo>', 'Tipo: patch, minor o snapshot.')
  .addHelpText('after', `
Ejemplos:
  $ migration-cli version --bump patch ./auth-service
  $ migration-cli version --bump minor ./auth-service
  $ migration-cli version --bump snapshot

La ruta es opcional; por defecto se utiliza el directorio actual.
`)
  .action(async (microservicePath, options) => {
    await runVersionCommand(microservicePath || process.cwd(), options.bump);
  });

program
  .command('workflow [microservicePath]')
  .description('Genera o actualiza el workflow Markdown para Axet y otros IDEs asistidos por IA.')
  .option('--name <microserviceName>', 'Nombre del microservicio para incluir en el workflow.')
  .addHelpText('after', `
Ejemplos:
  $ migration-cli workflow ./auth-service
  $ migration-cli workflow . --name auth-service

Escribe micro-migration.md en la raíz del proyecto, o en
.axet/skills/micro-migration.md cuando existe la carpeta .axet.
`)
  .action(async (microservicePath, options) => {
    await runWorkflowCommand(microservicePath || process.cwd(), {
      microserviceName: options.name
    });
  });

program
  .command('maven-to-gradle [microservicePath]')
  .description('Estación 1: convierte un proyecto Maven a Gradle conservando Maven durante la transición.')
  .option('--cutover', 'Tras validar Gradle, elimina pom.xml, .mvn/ y target/.')
  .addHelpText('after', `
Ejemplos:
  $ migration-cli maven-to-gradle ./auth-service
  $ migration-cli maven-to-gradle ./auth-service --cutover

Genera build.gradle, gradle.properties, settings.gradle, configuración Sonar/Artifact
Registry cuando aplica y el Gradle Wrapper. Valida con gradlew compileJava.
Por defecto pom.xml y .mvn/ se conservan para permitir convivencia temporal.
`)
  .action(async (microservicePath, options) => {
    await runMavenToGradleCommand(microservicePath || process.cwd(), {
      cutover: options.cutover
    });
  });

program
  .command('rewrite [microservicePath]')
  .description('Estación 1: ejecuta la receta OpenRewrite upgrade.zordon.carre4 en un proyecto Gradle.')
  .addHelpText('after', `
Ejemplos:
  $ migration-cli rewrite ./auth-service
  $ migration-cli rewrite

Crea rewriter.yml si no existe, inyecta temporalmente el plugin OpenRewrite 6.19.0,
ejecuta gradlew rewriteRun y restaura la configuración temporal de build.
Variable opcional: REWRITE_RECIPE_DEPENDENCY.
`)
  .action(async (microservicePath) => {
    await runRewriteCommand(microservicePath || process.cwd(), {
      environment: process.env
    });
  });

program
  .command('readme [microservicePath]')
  .description('Estación 1: genera o actualiza el README técnico del microservicio.')
  .addHelpText('after', `
Ejemplos:
  $ migration-cli readme ./auth-service
  $ migration-cli readme

La ruta es opcional; por defecto se utiliza el directorio actual.
El contenido gestionado se delimita con marcadores para preservar texto manual.
`)
  .action(async (microservicePath) => {
    await runReadmeCommand(microservicePath || process.cwd());
  });

program
  .command('coverage [microservicePath]')
  .description('Estación 2: ejecuta JaCoCo, evalúa cobertura y guarda evidencia.')
  .addHelpText('after', `
Ejemplos:
  $ migration-cli coverage ./auth-service
  $ migration-cli coverage

Detecta Maven o Gradle, ejecuta tests y evalúa el mínimo de 60% de líneas.
Genera .axetrules/history/<timestamp>/station2-quality.json.
`)
  .action(async (microservicePath) => {
    await runCoverageCommand(microservicePath || process.cwd());
  });

program
  .command('sonar [microservicePath]')
  .description('Estación 2: consulta SonarQube y evalúa su Quality Gate.')
  .addHelpText('after', `
Ejemplos:
  $ SONAR_HOST_URL=https://sonar.example.com SONAR_TOKEN=<token> migration-cli sonar ./auth-service
  $ migration-cli sonar

Variables requeridas para consultar SonarQube:
  SONAR_HOST_URL, SONAR_TOKEN y sonar.projectKey en sonar-project.properties.

Sin configuración, genera evidencia con estado "not-configured" sin realizar llamadas remotas.
`)
  .action(async (microservicePath) => {
    await runSonarCommand(microservicePath || process.cwd());
  });

program
  .command('summary <microserviceName> [microservicePath]')
  .description('Estación 3: consolida evidencia y genera el reporte maestro.')
  .addHelpText('after', `
Ejemplos:
  $ migration-cli summary auth-service
  $ migration-cli summary auth-service ./auth-service

Busca las evidencias PRE, POST, paridad y calidad más recientes del microservicio,
aunque pertenezcan a timestamps diferentes, y escribe migration-summary.md.
`)
  .action(async (microserviceName, microservicePath) => {
    await runMigrationSummary(microserviceName, {
      microservicePath: microservicePath || process.cwd()
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
