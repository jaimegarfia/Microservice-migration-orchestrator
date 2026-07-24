# Microservice Migration Orchestrator

[![npm](https://img.shields.io/npm/v/microservice-migration-orchestrator.svg)](https://www.npmjs.com/package/microservice-migration-orchestrator)
[![Node.js](https://img.shields.io/node/v/microservice-migration-orchestrator.svg)](https://nodejs.org/)
[![Licencia MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)

CLI en Node.js para orquestar una migración de microservicio mediante una **línea de producción por estaciones**. Centraliza la creación de tareas, evidencia de endpoints, versionado, documentación técnica, controles de calidad y el reporte final de migración.

> El CLI realiza peticiones HTTP de lectura (`GET`) para validar endpoints. Las operaciones que modifican archivos o crean incidencias de Jira requieren una confirmación explícita en el asistente interactivo.

## Contenido

- [Requisitos e instalación](#requisitos-e-instalación)
- [Inicio rápido](#inicio-rápido)
- [Línea de producción por estaciones](#línea-de-producción-por-estaciones)
- [Comandos CLI](#comandos-cli)
- [Motor de paridad API](#motor-de-paridad-api)
- [Variables de entorno](#variables-de-entorno)
- [Artefactos y evidencia](#artefactos-y-evidencia)
- [Asistente interactivo](#asistente-interactivo)
- [Desarrollo](#desarrollo)
- [Seguridad](#seguridad)

## Requisitos e instalación

- Node.js **18** o superior.
- Acceso al microservicio y a su definición OpenAPI/Swagger o colección Postman para las estaciones de endpoints.
- Acceso a Jira únicamente si se crearán incidencias remotas.
- Maven o Gradle únicamente para ejecutar cobertura JaCoCo.
- Acceso a SonarQube únicamente para consultar métricas de calidad.

### Ejecutar sin instalación

Usa `npx` para ejecutar la última versión publicada:

```bash
npx microservice-migration-orchestrator --help
```

El binario instalado se denomina `migration-cli`, por lo que también puedes invocarlo explícitamente:

```bash
npx --package microservice-migration-orchestrator migration-cli --help
```

### Instalación global

```bash
npm install --global microservice-migration-orchestrator

migration-cli --help
```

### Desarrollo local

```bash
git clone https://github.com/jaimegarfia/Microservice-migration-orchestrator.git
cd Microservice-migration-orchestrator
npm install
npm test
npm start
```

## Inicio rápido

Este ejemplo ejecuta las estaciones principales para `auth-service`:

```bash
# Estación 0: crea tareas en Jira o un checklist Markdown local.
migration-cli init auth-service

# Estación 0: toma la baseline de la API antes de migrar.
migration-cli endpoints --pre auth-service --source docs/openapi.yaml

# Estación 1: incrementa versión y genera documentación técnica.
migration-cli version --bump patch ./auth-service
migration-cli readme ./auth-service

# Estación 2: genera JaCoCo y consulta SonarQube si está configurado.
migration-cli coverage ./auth-service
migration-cli sonar ./auth-service

# Estación 3: prueba la API migrada y compara con PRE.
migration-cli endpoints --post auth-service \
  --source docs/openapi.yaml \
  --base-url https://api-migrada.example.com

# Consolida la evidencia de todas las estaciones.
migration-cli summary auth-service ./auth-service
```

Ejecuta `migration-cli <comando> --help` para consultar ejemplos, flags y variables de entorno específicas de cada comando.

## Línea de producción por estaciones

| Estación | Objetivo | Comandos |
| --- | --- | --- |
| **0 — Preparación** | Crear las tareas de migración y preservar el contrato de API previo. | `init`, `endpoints --pre` |
| **1 — Migración** | Versionar el microservicio y producir su README técnico. | `version`, `readme` |
| **2 — Calidad** | Evaluar cobertura JaCoCo y métricas de SonarQube. | `coverage`, `sonar` |
| **3 — Paridad** | Probar la API migrada, comparar PRE/POST y consolidar el resultado. | `endpoints --post`, `summary` |
| **4 — Entrega** | Desplegar en CUA/PRO y tramitar CAB. | Evidencia y proceso operativo externo |

### Estación 0 — Preparación

`init` crea una tarea padre llamada `Migración Microservicio: <nombre>` y las ocho subtareas estándar:

1. `[Estación 0] Pruebas endpoints pre-migración`
2. `[Estación 1] Tareas pre-migración y migración`
3. `[Estación 1] Post-migración y generación de README`
4. `[Estación 2] Aumentar cobertura de tests (>60%)`
5. `[Estación 2] Corrección de Code Smells y Bugs (Sonar)`
6. `[Estación 3] Despliegue DEV y Superar Prisma`
7. `[Estación 3] Pruebas endpoints post-migración`
8. `[Estación 4] Despliegue CUA / PRO y documentación CAB`

Con Jira configurado, las crea mediante `POST /rest/api/2/issue`. Sin configuración Jira, genera el checklist local:

```text
.axetrules/history/jira-tasks-<microservicio>.md
```

La baseline PRE ejecuta únicamente endpoints `GET`, conserva status, tiempo de respuesta, hash SHA-256 y un fragmento limitado de payload:

```bash
migration-cli endpoints --pre auth-service --source docs/openapi.yaml
```

La fuente de endpoints se detecta automáticamente en este orden:

1. `swagger.*` u `openapi.*` en la raíz.
2. `docs/swagger.*` o `docs/openapi.*`.
3. El primer JSON de `postman/`.

También puede indicarse manualmente:

```bash
migration-cli endpoints --pre auth-service \
  --source postman/collection.json \
  --base-url https://api.example.com \
  --timeout 15000
```

### Estación 1 — Versionado y README técnico

Incrementa versiones consistentes en `pom.xml`, `gradle.properties`, `build.gradle`, `build.gradle.kts` y/o `sonar-project.properties`:

```bash
migration-cli version --bump patch ./auth-service
migration-cli version --bump minor ./auth-service
migration-cli version --bump snapshot ./auth-service
```

| Tipo | Resultado |
| --- | --- |
| `patch` | `1.0.0` → `1.0.1` |
| `minor` | `1.0.0` → `1.1.0` |
| `snapshot` | `1.0.0` → `1.0.1-SNAPSHOT` |

Genera o actualiza el README técnico del microservicio:

```bash
migration-cli readme ./auth-service
```

El generador detecta, cuando están presentes, tecnologías Java/Kotlin, Spring Boot, Maven/Gradle, controladores REST, entidades JPA, configuración, persistencia y mensajería. La sección gestionada usa marcadores `migration-cli:readme`, preservando el contenido manual fuera de ellos.

### Estación 2 — Cobertura y calidad

Ejecuta tests y genera/analiza JaCoCo:

```bash
migration-cli coverage ./auth-service
```

- Maven: `mvn test jacoco:report`, con informe en `target/site/jacoco/jacoco.xml`.
- Gradle: `gradle test jacocoTestReport`, con informe en `build/reports/jacoco/test/jacocoTestReport.xml`.
- Quality Gate de cobertura de líneas: **60%** mínimo.
- Muestra las clases prioritarias para elevar cobertura según líneas sin cubrir y complejidad.

Consulta las métricas de SonarQube:

```bash
SONAR_HOST_URL=https://sonar.example.com \
SONAR_TOKEN=<token> \
migration-cli sonar ./auth-service
```

La clave del proyecto debe estar declarada como `sonar.projectKey` en `sonar-project.properties`.

| Métrica | Umbral |
| --- | --- |
| Code Smells | Menos de 30 |
| Bugs | 0 |
| Hotspots de seguridad | 0 |

Sin credenciales o configuración de SonarQube, el comando genera evidencia con estado `not-configured` sin realizar llamadas remotas.

### Estación 3 — Paridad API y resumen maestro

Ejecuta la API migrada y la compara contra el baseline PRE más reciente del mismo microservicio:

```bash
migration-cli endpoints --post auth-service \
  --source docs/openapi.yaml \
  --base-url https://api-migrada.example.com
```

Después consolida la evidencia:

```bash
migration-cli summary auth-service ./auth-service
```

El segundo argumento de `summary` es opcional; permite indicar la ruta del microservicio para verificar README y archivos de versión.

## Comandos CLI

| Comando | Descripción |
| --- | --- |
| `migration-cli` | Inicia el asistente interactivo. |
| `migration-cli init [microserviceName]` | Crea tareas Jira o checklist local. Sin argumento inicia el asistente. |
| `migration-cli endpoints --pre <microserviceName>` | Captura la baseline de endpoints GET previa. |
| `migration-cli endpoints --post <microserviceName>` | Ejecuta GET tras migración y analiza paridad. |
| `migration-cli version --bump <tipo> [microservicePath]` | Actualiza versiones de build y Sonar. |
| `migration-cli readme [microservicePath]` | Genera README técnico del microservicio. |
| `migration-cli coverage [microservicePath]` | Ejecuta JaCoCo y evalúa cobertura. |
| `migration-cli sonar [microservicePath]` | Consulta SonarQube y evalúa su Quality Gate. |
| `migration-cli summary <microserviceName> [microservicePath]` | Genera el reporte maestro. |

### Ayuda integrada

Todos los comandos incluyen ayuda contextual:

```bash
migration-cli --help
migration-cli endpoints --help
migration-cli version --help
migration-cli sonar --help
```

La ayuda muestra uso, argumentos, flags, ejemplos, archivos producidos y variables de entorno relevantes.

### Flags de `endpoints`

| Flag | Uso |
| --- | --- |
| `--pre` | Genera evidencia previa a migración. |
| `--post` | Ejecuta la comparación posterior contra el último PRE. |
| `--source <rutaOUrl>` | Definición OpenAPI, Swagger o colección Postman local/remota. |
| `--base-url <url>` | URL base si la definición no declara servidor o usa URLs relativas. |
| `--auth-token <token>` | Token Bearer para endpoints; tiene prioridad sobre `AUTH_TOKEN`. |
| `--timeout <milisegundos>` | Timeout por endpoint. |

Debe proporcionarse una y sólo una fase: `--pre` o `--post`.

## Motor de paridad API

El motor de Estación 3 compara endpoint por endpoint los artefactos `endpoints-pre.json` y `endpoints-post.json`.

Para cada respuesta se almacena:

- ruta del endpoint;
- status HTTP;
- tiempo de respuesta en milisegundos;
- `responseHash`: SHA-256 del payload de texto;
- fragmento de payload limitado;
- error, cuando la petición no se puede completar.

### Estados de comparación

| Estado | Criterio |
| --- | --- |
| 🟢 **MATCH** | Mismo status HTTP y mismo `responseHash`. |
| 🟡 **WARNING** | Mismo status con hash distinto, latencia que varía más de 50%, o endpoint nuevo. |
| 🔴 **BREAKING CHANGE** | Cambio de status HTTP o endpoint no disponible tras la migración. |

El resultado se escribe en `parity-report.md` con una tabla de status PRE/POST, tiempos y motivo. El estado global es:

- `PASSED`: todos los endpoints son `MATCH`.
- `WARNING`: no hay cambios rompientes, pero existe alguna advertencia.
- `FAILED`: existe al menos un `BREAKING CHANGE`.

> El hash compara el payload textual recibido. Si el endpoint devuelve campos dinámicos (fechas, UUIDs, tokens o trazas), puede producir un `WARNING` aunque el contrato funcional siga siendo compatible.

## Variables de entorno

Copia el archivo de ejemplo y completa sólo las variables necesarias:

```bash
cp .env.example .env
```

> El CLI no carga automáticamente archivos `.env`; exporta las variables desde tu shell, tu herramienta de secretos o el entorno de CI/CD.

### Jira

| Variable | Requerida | Descripción |
| --- | --- | --- |
| `JIRA_HOST` | Sí, para Jira | URL base de Jira, sin `/rest/api/2`. |
| `JIRA_PROJECT_KEY` | Sí, para Jira | Clave del proyecto destino. |
| `JIRA_AUTH_BASIC` | Una autenticación | Cabecera Basic codificada en Base64, con o sin prefijo `Basic `. |
| `JIRA_API_TOKEN` | Una autenticación | Token Bearer si la instancia Jira lo acepta. |
| `JIRA_ISSUE_TYPE` | No | Tipo de tarea padre; por defecto `Task`. |
| `JIRA_SUBTASK_ISSUE_TYPE` | No | Tipo de subtarea; por defecto `Sub-task`. |

Ejemplo:

```bash
export JIRA_HOST=https://jira.example.com
export JIRA_PROJECT_KEY=MYPROJ
export JIRA_AUTH_BASIC='Basic <credenciales-base64>'

migration-cli init auth-service
```

### Endpoints

| Variable | Descripción |
| --- | --- |
| `AUTH_TOKEN` | Token OAuth2/Bearer opcional para solicitudes GET. `--auth-token` tiene prioridad. |

El token se envía sólo en la cabecera `Authorization`; nunca se persiste en la evidencia.

### SonarQube

| Variable | Descripción |
| --- | --- |
| `SONAR_HOST_URL` | URL base de la instancia SonarQube. |
| `SONAR_TOKEN` | Token Bearer para consultar la API de SonarQube. |

Además se requiere `sonar.projectKey` en `sonar-project.properties`. El token no se escribe en los reportes.

## Artefactos y evidencia

Toda la evidencia local se guarda bajo `.axetrules/history/`, directorio excluido por `.gitignore`:

```text
.axetrules/
└── history/
    ├── jira-tasks-auth-service.md
    └── <timestamp>/
        ├── endpoints-pre.json
        ├── endpoints-post.json
        ├── parity-report.md
        ├── station2-quality.json
        └── migration-summary.md
```

| Artefacto | Productor | Contenido |
| --- | --- | --- |
| `jira-tasks-<servicio>.md` | `init` sin Jira | Tarea padre y checklist de subtareas. |
| `endpoints-pre.json` | `endpoints --pre` | Baseline de endpoints GET antes de migrar. |
| `endpoints-post.json` | `endpoints --post` | Resultados GET sobre la API migrada. |
| `parity-report.md` | `endpoints --post` | Comparativa PRE/POST y resultado de paridad. |
| `station2-quality.json` | `coverage` / `sonar` | Cobertura JaCoCo, Sonar y Quality Gates. |
| `migration-summary.md` | `summary` | Panel consolidado de las estaciones. |

`summary` localiza los artefactos más recientes para cada tipo, aunque se hayan generado en timestamps distintos.

## Asistente interactivo

Ejecuta sin argumentos:

```bash
migration-cli
```

El wizard guía el proceso:

1. solicita un nombre de microservicio con formato `kebab-case`;
2. detecta configuración Jira y permite elegir Jira o Markdown local;
3. confirma la creación de tareas;
4. ofrece ejecutar baseline PRE;
5. ofrece Estación 1 (versionado y README);
6. ofrece Estación 2 (cobertura y SonarQube);
7. ofrece Estación 3 (POST, paridad y reporte maestro).

Usa confirmaciones explícitas antes de crear incidencias, modificar versiones, generar documentación o lanzar análisis.

## Desarrollo

```bash
npm install
npm run lint
npm test
```

Los tests cubren integración de Jira, extracción y ejecución de endpoints, paridad PRE/POST, resumen maestro, versionado, generación de README, calidad JaCoCo/SonarQube y wizard.

Para probar el empaquetado antes de publicar:

```bash
npm pack --dry-run
```

## Seguridad

- Los comandos de endpoints ejecutan sólo `GET`.
- Los tokens Jira, OAuth2 y SonarQube se usan en cabeceras HTTP y no se guardan en reportes.
- No incluyas `.env`, credenciales, archivos de evidencia o artefactos de calidad en el repositorio.
- Revisa los cambios de `version` y `readme` antes de subirlos a la rama del microservicio.
- Usa secretos de CI/CD o un gestor de secretos para las credenciales de producción.

## Licencia

[MIT](LICENSE).
