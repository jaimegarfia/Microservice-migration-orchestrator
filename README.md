# Microservice Migration Orchestrator

CLI autonomo para orquestar tareas de migracion de microservicios, pruebas de endpoints y controles de calidad.

## Requisitos

- Node.js 18 o superior.
- Acceso a Jira, solo para crear incidencias remotas.

## Instalacion

```bash
npm install
```

Para ejecutar el binario desde este repositorio:

```bash
npm start
```

Despues de publicar o enlazar el paquete con npm, el ejecutable es:

```bash
migration-cli
```

## Asistente interactivo (Estacion 1)

El comando sin argumentos inicia un wizard guiado:

```bash
migration-cli
```

Tambien se inicia si se omite el nombre en `init`:

```bash
migration-cli init
```

El asistente:

1. Solicita un nombre de microservicio en formato slug, por ejemplo `auth-service`.
2. Detecta si Jira esta configurado.
3. Si Jira no esta configurado, permite seleccionar `Jira` o `Local Markdown`.
4. Muestra un resumen y solicita confirmacion.
5. Muestra spinners durante la creacion y un panel final con enlaces o la ruta del archivo generado.

Si se selecciona Jira sin configuracion completa, el wizard no realiza cambios y muestra las variables que deben configurarse.

## Ejecucion no interactiva

La forma no interactiva se conserva para scripts y CI/CD:

```bash
migration-cli init auth-service
```

Con Jira configurado, crea una tarea padre y ocho subtareas mediante `POST /rest/api/2/issue`. Sin Jira, genera e imprime el checklist Markdown y guarda una copia en:

```text
.axetrules/history/jira-tasks-auth-service.md
```

## Baseline PRE de endpoints

El comando no interactivo ejecuta exclusivamente operaciones `GET`, registra una evidencia previa a la migracion y no modifica datos remotos:

```bash
migration-cli endpoints --pre auth-service
```

La fuente se detecta automaticamente, en este orden:

1. `swagger.*` u `openapi.*` en la raiz.
2. `docs/swagger.*` o `docs/openapi.*`.
3. El primer archivo JSON de `postman/`.

Tambien puedes proporcionar una definicion manual local o remota:

```bash
migration-cli endpoints --pre auth-service --source docs/openapi.yaml
migration-cli endpoints --pre auth-service --source https://api.example.com/openapi.json
```

Para documentos sin servidor definido o URLs relativas de Postman, indica la URL base:

```bash
migration-cli endpoints --pre auth-service --source postman/collection.json --base-url https://api.example.com
```

El token opcional se toma de `AUTH_TOKEN` o de `--auth-token`. En el asistente se solicita como campo oculto cuando no existe `AUTH_TOKEN`.

```bash
AUTH_TOKEN=<token> migration-cli endpoints --pre auth-service
```

Cada ejecucion guarda la evidencia en:

```text
.axetrules/history/<timestamp>/endpoints-pre.json
```

El informe contiene el timestamp, microservicio, fase `PRE`, estado HTTP, tiempo de respuesta, hash SHA-256 y un snippet limitado de cada respuesta. Los tokens nunca se escriben en este archivo. `.axetrules/history/` esta ignorado por Git para evitar publicar evidencia local.

Tras inicializar tareas desde el wizard, se ofrece automaticamente ejecutar esta baseline como siguiente paso.

## Configuracion de Jira

Copia `.env.example` a un archivo de entorno seguro o exporta las variables:

```bash
JIRA_HOST=https://jira.example.com
JIRA_PROJECT_KEY=MYPROJ
JIRA_AUTH_BASIC=Basic <credenciales-en-base64>
```

Como alternativa, si la instancia acepta autenticacion Bearer:

```bash
JIRA_API_TOKEN=<token>
```

Para ejecutar en modo Jira se requieren `JIRA_HOST`, `JIRA_PROJECT_KEY` y una de las dos opciones de autenticacion. Los tipos de incidencia pueden personalizarse:

```bash
JIRA_ISSUE_TYPE=Task
JIRA_SUBTASK_ISSUE_TYPE=Sub-task
```

## Validacion

```bash
npm run lint
npm test
```

Los comandos validan sintaxis y ejecutan las pruebas automatizadas de Jira, la generacion local y el wizard.
