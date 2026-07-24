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

## Estación 3: Paridad API y reporte maestro

### Validación POST

Después de desplegar el microservicio migrado, vuelve a ejecutar exclusivamente los endpoints `GET` contra su URL migrada:

```bash
migration-cli endpoints --post auth-service --source docs/openapi.yaml --base-url https://api-migrada.example.com
```

El comando busca automáticamente el `endpoints-pre.json` más reciente del mismo microservicio, guarda:

```text
.axetrules/history/<timestamp>/endpoints-post.json
.axetrules/history/<timestamp>/parity-report.md
```

y clasifica cada endpoint:

| Resultado | Criterio |
| --- | --- |
| 🟢 `MATCH` | Mismo status HTTP y mismo hash de respuesta |
| 🟡 `WARNING` | Mismo status con payload diferente, variación de tiempo superior al 50% o endpoint nuevo |
| 🔴 `BREAKING CHANGE` | Status HTTP distinto o endpoint no disponible tras la migración |

El reporte de paridad incluye la tabla comparativa de status, tiempos y motivo, con estado global `PASSED`, `WARNING` o `FAILED`.

### Resumen maestro

Consolida la evidencia más reciente disponible de las estaciones de migración:

```bash
migration-cli summary auth-service ./auth-service
```

La ruta del microservicio es opcional y se usa para comprobar README y archivos de versión. El comando busca PRE, POST, paridad y calidad incluso si se crearon en timestamps distintos, y escribe:

```text
.axetrules/history/<timestamp>/migration-summary.md
```

El panel global marca `FAILED` si falla cobertura, Sonar o paridad; `WARNING` si falta evidencia o configuración; y `PASSED` cuando todas las estaciones evaluadas cumplen.

El wizard ofrece ejecutar Estación 3 y, tras completar la paridad, generar este resumen maestro en la terminal.

## Estación 1: Versionado y README técnico

### Versionado

Actualiza de forma consistente las versiones declaradas en `pom.xml`, `gradle.properties`, `build.gradle`, `build.gradle.kts` y/o `sonar-project.properties`:

```bash
migration-cli version --bump patch ./auth-service
migration-cli version --bump minor ./auth-service
migration-cli version --bump snapshot ./auth-service
```

Tipos de incremento:

| Tipo | Ejemplo |
| --- | --- |
| `patch` | `1.0.0` → `1.0.1` |
| `minor` | `1.0.0` → `1.1.0` |
| `snapshot` | `1.0.0` → `1.0.1-SNAPSHOT` |

La ruta es opcional y por defecto se usa el directorio actual. El comando rechaza versiones incompatibles o divergentes entre los archivos detectados antes de escribir cambios.

### README técnico

Genera o actualiza un README técnico en la raíz del microservicio:

```bash
migration-cli readme ./auth-service
```

El análisis detecta, cuando existen:

- Java/Kotlin, Spring Boot y Maven/Gradle.
- Controladores REST y mappings HTTP.
- Entidades JPA y tablas.
- Variables de entorno de archivos `.properties`, `.yml` y `.yaml`.
- Persistencia JPA/Hibernate, MongoDB o R2DBC.
- Kafka y RabbitMQ.

El contenido generado incluye descripción, stack, endpoints, entidades, configuración e instrucciones de compilación y despliegue. Se delimita entre marcadores `migration-cli:readme`, por lo que las secciones manuales fuera de esos marcadores se conservan en ejecuciones posteriores.

Tras la inicialización y la baseline opcional, el wizard ofrece preparar la Estación 1. Solicita la ruta, tipo de bump y una confirmación explícita antes de modificar archivos.

## Estación 2: Cobertura y Calidad

### Cobertura JaCoCo

Ejecuta las pruebas y genera el informe JaCoCo mediante Maven o Gradle:

```bash
migration-cli coverage ./auth-service
```

El comando detecta:

- Maven: ejecuta `mvn test jacoco:report` y busca `target/site/jacoco/jacoco.xml`.
- Gradle: ejecuta `gradle test jacocoTestReport` y busca `build/reports/jacoco/test/jacocoTestReport.xml`.

Muestra la cobertura global de líneas y ramas, valida el Quality Gate de líneas (mínimo **60%**) y ordena las cinco clases prioritarias según líneas sin cubrir y complejidad.

### SonarQube

Configura el proyecto en `sonar-project.properties` y, para consultar la API de SonarQube, exporta las credenciales:

```bash
SONAR_HOST_URL=https://sonar.example.com
SONAR_TOKEN=<token>
```

Después ejecuta:

```bash
migration-cli sonar ./auth-service
```

El comando obtiene `sonar.projectKey` y evalúa los umbrales de producción:

| Métrica | Objetivo |
| --- | --- |
| Code Smells | `< 30` |
| Bugs | `0` |
| Hotspots de seguridad | `0` |

Si faltan configuración, token o clave de proyecto, el comando muestra un estado no configurado y genera la evidencia sin realizar llamadas remotas. El token se usa exclusivamente en la cabecera `Authorization` y no se persiste.

### Evidencia consolidada

Cada ejecución de `coverage` o `sonar` guarda un informe en:

```text
.axetrules/history/<timestamp>/station2-quality.json
```

El informe contiene el detalle global y por clase de JaCoCo cuando se ejecuta cobertura, junto con las métricas y Quality Gate de Sonar cuando están disponibles. El wizard también ofrece ejecutar el análisis integrado de Estación 2 después de Estación 1, con confirmación explícita antes de lanzar pruebas o consultar SonarQube.

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

Los comandos validan sintaxis y ejecutan las pruebas automatizadas de Jira, baseline PRE/POST, paridad de API, resumen maestro, versionado, README técnico, JaCoCo, SonarQube y wizard.
