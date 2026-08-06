# Microservice Migration Orchestrator

[![npm](https://img.shields.io/npm/v/microservice-migration-orchestrator.svg)](https://www.npmjs.com/package/microservice-migration-orchestrator)
[![Node.js](https://img.shields.io/node/v/microservice-migration-orchestrator.svg)](https://nodejs.org/)
[![Licencia MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)

CLI en Node.js para orquestar una migración de microservicio mediante una **línea de producción por estaciones**. Centraliza la vinculación con Jira, evidencia de endpoints, versionado, documentación técnica, controles de calidad y el reporte final de migración.

> El CLI realiza peticiones HTTP de lectura (`GET`) para validar endpoints. `init` no crea incidencias ni subtareas: vincula una tarea Jira existente. `comment` publica evidencia explícita en dicha tarea.

## Contenido

- [Requisitos e instalación](#requisitos-e-instalación)
- [Inicio rápido](#inicio-rápido)
- [Modo Zero-Config y pipeline one-click](#modo-zero-config-y-pipeline-one-click)
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

Para ejecutar toda la línea de producción con la mínima configuración:

```bash
migration-cli run ./auth-service

# Incluye pruebas POST y paridad si ya conoces la URL migrada.
migration-cli run ./auth-service \
  --post-base-url https://api-migrada.example.com
```

También puedes ejecutar cada estación individualmente:

```bash
# Estación 0: vincula una tarea Jira existente y genera el workflow de IDE.
migration-cli init auth-service --jira-issue EVOLCRE4-1234

# Tras confirmar cada gateway, publica la evidencia correspondiente en Jira.
migration-cli comment 0 ./auth-service

# Regenera exclusivamente el workflow para Axet, Cursor o Copilot.
migration-cli workflow ./auth-service

# Estación 0: toma la baseline de la API antes de migrar.
migration-cli endpoints --pre auth-service --source docs/openapi.yaml

# Estación 1: convierte Maven si aplica, ejecuta OpenRewrite, incrementa versión y genera documentación.
migration-cli maven-to-gradle ./auth-service
migration-cli rewrite ./auth-service
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

## Modo Zero-Config y pipeline one-click

`run` es la ruta recomendada para automatizar una migración completa. Recibe la ruta del microservicio, o usa el directorio actual:

```bash
migration-cli run [microservicePath] [opciones]
```

Secuencia ejecutada:

1. **Estación 0:** vincula la incidencia Jira indicada mediante `JIRA_ISSUE_KEY`/`--jira-issue`, o genera el checklist local si no existe una clave, y genera el workflow Markdown para IDEs asistidos por IA.
2. **Estación 0:** detecta una definición OpenAPI, Swagger o Postman y genera la baseline PRE.
3. **Estación 1:** convierte automáticamente Maven a Gradle si detecta `pom.xml` sin `build.gradle`, ejecuta OpenRewrite, incrementa la versión (`patch` por defecto) y genera el README técnico.
4. **Estación 2:** ejecuta cobertura JaCoCo y consulta SonarQube.
5. **Estación 3:** con `--post-base-url`, ejecuta POST, el motor de paridad y el resumen maestro.

Opciones principales:

```bash
migration-cli run ./auth-service \
  --source docs/openapi.yaml \
  --base-url https://api-original.example.com \
  --post-base-url https://api-migrada.example.com \
  --bump minor \
  --timeout 15000
```

El pipeline es **tolerante a fallos**: una definición ausente, JaCoCo no disponible, SonarQube sin configurar o un error de un paso se informa como `[WARNING]`; las estaciones posteriores y la generación del resumen continúan. Las incidencias se reflejan en los artefactos de evidencia y el panel final.

### Auto-descubrimiento de API

Sin `--source`, el CLI explora la raíz del microservicio, `docs/` y `postman/` para archivos `.json`, `.yaml` o `.yml` cuyo nombre contenga `swagger` u `openapi`, además de colecciones JSON ubicadas en `postman/`.

- En `run` no interactivo se usa la primera coincidencia ordenada y se registra una advertencia si hay varias.
- En el wizard se presenta un selector navegable con flechas cuando hay varias coincidencias.
- Si no existe ninguna definición en el wizard, se solicita de forma amistosa una ruta local o URL remota.
- En modo no interactivo, la ausencia de fuente no detiene el pipeline: omite la estación de endpoints y registra `[WARNING]`.

## Línea de producción por estaciones

| Estación | Objetivo | Comandos |
| --- | --- | --- |
| **0 — Preparación** | Vincular la tarea Jira existente, generar el workflow de IDE y preservar el contrato de API previo. | `init --jira-issue`, `workflow`, `endpoints --pre`, `comment 0` |
| **1 — Migración** | Convertir Maven a Gradle cuando aplique, ejecutar OpenRewrite, versionar el microservicio y producir su README técnico. | `maven-to-gradle`, `rewrite`, `version`, `readme` |
| **2 — Calidad** | Evaluar cobertura JaCoCo y métricas de SonarQube. | `coverage`, `sonar` |
| **3 — Paridad** | Probar la API migrada, comparar PRE/POST y consolidar el resultado. | `endpoints --post`, `summary` |
| **4 — Entrega** | Desplegar en CUA/PRO y tramitar CAB. | Evidencia y proceso operativo externo |

### Estación 0 — Preparación

`init` **nunca crea tareas ni subtareas Jira**. Vincula una tarea existente a partir de una clave Jira o URL compleja y persiste solamente `JIRA_ISSUE_KEY` en `.env`, conservando el resto de variables y secretos:

```bash
migration-cli init auth-service --jira-issue EVOLCRE4-1234
migration-cli init auth-service --jira-issue \
  https://jira.example.com/browse/EVOLCRE4-1234
```

También puede definirse `JIRA_ISSUE_KEY` previamente en el entorno o en `.env`. Si no existe una incidencia vinculada, `init` genera el checklist local:

```text
.axetrules/history/jira-tasks-<microservicio>.md
```

Además, `init` genera o actualiza el workflow interactivo `micro-migration.md` para
**Axet, Cursor, Copilot y otros IDEs asistidos por IA**. Si el proyecto ya contiene
`.axet/`, se escribe en `.axet/skills/micro-migration.md`; de lo contrario se escribe
en la raíz del microservicio. El workflow guía a la IA por las cuatro estaciones,
incluye los puntos de parada para solicitar credenciales/confirmación de cutover y las
revisiones requeridas de Java 17, Lombok, MapStruct, logging, Docker, JaCoCo y Sonar.

Al completar cada estación, la IA **debe detenerse obligatoriamente**, solicitar la
revisión y el commit del usuario, y esperar el mensaje literal `Continuar`. Sólo tras
recibirlo ejecuta `migration-cli comment <0|1|2|3> .` para publicar la evidencia
Markdown en la incidencia vinculada antes de avanzar a la siguiente estación.

Puede regenerarse sin crear tareas ni checklist:

```bash
migration-cli workflow ./auth-service
migration-cli workflow . --name auth-service
```

Durante `init`, el CLI también crea o actualiza `.gitignore` mediante un bloque
gestionado e idempotente. Conserva todas las reglas previas del repositorio y protege
archivos locales, credenciales, evidencias y artefactos de Axet:

```gitignore
# Migration Orchestrator & Axet IDE Ignored Files
.env
.env.local
.env.*.local
.axetrules/
.axet/
micro-migration.md
rewriter.yml
zordon/
```

El bloque se identifica con delimitadores `Migration Orchestrator & Axet IDE Ignored Files`;
las ejecuciones posteriores lo actualizan sin duplicarlo ni modificar reglas ajenas.

La baseline PRE ejecuta únicamente endpoints `GET`, conserva status, tiempo de respuesta, hash SHA-256 y un fragmento limitado de payload:

```bash
migration-cli endpoints --pre auth-service --source docs/openapi.yaml
```

La fuente de endpoints se detecta automáticamente en raíz, `docs/` y `postman/`. Se admiten nombres que contengan `swagger` u `openapi` con extensión JSON/YAML, además de colecciones JSON dentro de `postman/`. El wizard permite elegir cuando hay varias fuentes.

También puede indicarse manualmente:

```bash
migration-cli endpoints --pre auth-service \
  --source postman/collection.json \
  --base-url https://api.example.com \
  --timeout 15000
```

### Estación 1 — Maven a Gradle, OpenRewrite, versionado y README técnico

Cuando un proyecto contiene `pom.xml` y no tiene `build.gradle`, `migration-cli run`
intenta la conversión Maven → Gradle automáticamente antes de OpenRewrite. También puede
ejecutarse de forma explícita:

```bash
migration-cli maven-to-gradle ./auth-service
```

El conversor analiza coordenadas Maven, propiedades Java, dependencias, scopes,
exclusiones, BOMs, repositorios y plugins. Genera `build.gradle` (Groovy),
`gradle.properties`, `settings.gradle`, `gradle/sonar.gradle` y
`gradle/googleArtifactory.gradle` cuando son necesarios. Incluye soporte para Spring
Boot, JaCoCo, Failsafe/`integrationTest`, SonarQube y Google Artifact Registry.

También instala el Gradle Wrapper completo y valida el resultado mediante
`gradlew compileJava`. Por defecto conserva `pom.xml`, `.mvn/` y `target/` para una
convivencia temporal de ambos sistemas. Una vez validada la transición, puede eliminarse
Maven explícitamente:

```bash
migration-cli maven-to-gradle ./auth-service --cutover
```

`--cutover` elimina `pom.xml`, `.mvn/` y `target/` **sólo después** de que la validación
Gradle haya finalizado correctamente.

Para proyectos Gradle, ejecuta la receta `upgrade.zordon.carre4` mediante OpenRewrite:

```bash
migration-cli rewrite ./auth-service
```

El comando crea `rewriter.yml` si no existe, inyecta temporalmente el plugin
`org.openrewrite.rewrite` `6.19.0`, la dependencia de receta y el bloque
`activeRecipe("upgrade.zordon.carre4")`. A continuación ejecuta `gradlew rewriteRun`
(`./gradlew` en Unix/macOS) y restaura la configuración temporal del build. Los cambios
aplicados por OpenRewrite se conservan. Tras completarlo, continúa con la actualización
a Java 17 y la fase post-migración. Puede sobrescribirse la dependencia de receta con
`REWRITE_RECIPE_DEPENDENCY`.

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
| `migration-cli init [microserviceName] --jira-issue <claveOUrl>` | Vincula una tarea Jira existente y guarda `JIRA_ISSUE_KEY`; sin clave genera checklist local. Sin argumento inicia el asistente. |
| `migration-cli comment <stationNumber> [microservicePath]` | Publica la evidencia Markdown de la estación `0`, `1`, `2` o `3` en la tarea Jira vinculada. |
| `migration-cli run [microservicePath]` | Pipeline One-Click Zero-Config de Estaciones 0 a 3, tolerante a fallos. |
| `migration-cli workflow [microservicePath] [--name <microserviceName>]` | Genera o actualiza `micro-migration.md` para Axet y otros IDEs asistidos por IA. |
| `migration-cli endpoints --pre <microserviceName>` | Captura la baseline de endpoints GET previa. |
| `migration-cli endpoints --post <microserviceName>` | Ejecuta GET tras migración y analiza paridad. |
| `migration-cli maven-to-gradle [microservicePath] [--cutover]` | Convierte Maven a Gradle, instala Wrapper y valida `compileJava`; `--cutover` elimina Maven tras validar. |
| `migration-cli rewrite [microservicePath]` | Ejecuta la receta OpenRewrite `upgrade.zordon.carre4` en un proyecto Gradle. |
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
| `JIRA_PROJECT_KEY` | Sí, para Jira | Clave del proyecto destino; por defecto `EVOLCRE4`. |
| `JIRA_ISSUE_KEY` | Sí, para `comment` | Clave de la tarea existente vinculada, por ejemplo `EVOLCRE4-1234`. `init --jira-issue` la persiste sin sobrescribir otras variables. |
| `JIRA_AUTH_BASIC` | Una autenticación | Cabecera Basic codificada en Base64, con o sin prefijo `Basic `. |
| `JIRA_API_TOKEN` | Una autenticación | Token Bearer si la instancia Jira lo acepta. |
| `JIRA_ISSUE_TYPE` | No | Tipo de tarea padre; por defecto `Task`. |
| `JIRA_SUBTASK_ISSUE_TYPE` | No | Tipo de subtarea; por defecto `Sub-task`. |

Ejemplo:

```bash
export JIRA_HOST=https://jira.example.com
export JIRA_PROJECT_KEY=MYPROJ
export JIRA_AUTH_BASIC='Basic <credenciales-base64>'

migration-cli init auth-service --jira-issue MYPROJ-1234
migration-cli comment 0 ./auth-service
```

### Endpoints

| Variable | Descripción |
| --- | --- |
| `AUTH_TOKEN` | Token OAuth2/Bearer opcional para solicitudes GET. `--auth-token` tiene prioridad. |
| `AUTH_PROVIDER` | Proveedor automático: `ATLAS`, `AGORA` o `CUSTOM`. |
| `ATLAS_CLIENT_ID`, `ATLAS_CLIENT_SECRET` | Reservados para la configuración ATLAS del proyecto. |
| `AGORA_CLIENT_ID`, `AGORA_CLIENT_SECRET` | Reservados para la configuración AGORA del proyecto. |
| `ATLAS_TOKEN_URL`, `AGORA_TOKEN_URL` | Opcionales; sobrescriben la URL OAuth2 por defecto. |
| `ATLAS_AUTH_BASIC`, `AGORA_AUTH_BASIC` | Opcionales; sobrescriben la cabecera Basic OAuth2 por defecto. |

Si no se proporciona `--auth-token` ni `AUTH_TOKEN`, el CLI obtiene un token OAuth2
automáticamente cuando `AUTH_PROVIDER=ATLAS` o `AUTH_PROVIDER=AGORA`, y lo inyecta como
`Authorization: Bearer <token>` en todos los GET PRE/POST. El token se envía sólo en
cabecera y nunca se persiste en la evidencia.

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
| `.gitignore` (bloque gestionado) | `init` | Ignora credenciales, evidencia, workflows y artefactos locales de migración/Axet. |
| `jira-tasks-<servicio>.md` | `init` sin incidencia vinculada | Checklist local de migración. |
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

En `init`, si no existe `.env` ni `.env.example` en el directorio de trabajo, se crean
ambos con la plantilla EVOLCRE4, Jira, proveedores ATLAS/AGORA y SonarQube. El CLI avisa
de que los valores deben completarse antes de publicar comentarios remotos o capturar endpoints.

El menú principal muestra:

1. `🚀 Ejecutar Migración Completa` — inicia el pipeline `run`.
2. `📋 Gestionar Tareas` — Estación 0.
3. `🔍 Analizar Endpoints y Paridad` — Estaciones 0 y 3.
4. `🛠️ Versionado y Documentación` — Estación 1.
5. `🧪 Cobertura y Calidad` — Estación 2.
6. `❌ Salir`.

La gestión de Jira se realiza de forma explícita: vincula la tarea existente con
`init --jira-issue <clave-o-url>` y configura credenciales antes de ejecutar `comment`.
No se crean tareas ni subtareas remotas. Si no hay una incidencia vinculada, `init`
genera el checklist Markdown local sin bloquear el flujo.

En CI/CD o terminales no interactivas no se solicitan datos: el comportamiento se mantiene
determinista y usa el fallback local.

Usa confirmaciones explícitas antes de ejecutar `--cutover`, modificar versiones,
generar documentación o lanzar análisis.

## Desarrollo

```bash
npm install
npm run lint
npm test
```

Los tests cubren integración de Jira, extracción y ejecución de endpoints, paridad PRE/POST, resumen maestro, versionado, generación de README, workflow Markdown para IDEs IA, calidad JaCoCo/SonarQube y wizard.

Para probar el empaquetado antes de publicar:

```bash
npm pack --dry-run
```

## Seguridad

- Los comandos de endpoints ejecutan sólo `GET`.
- `init` gestiona un bloque idempotente de `.gitignore` para evitar subir secretos, evidencias y workflows locales.
- Los tokens Jira, OAuth2 y SonarQube se usan en cabeceras HTTP y no se guardan en reportes.
- No incluyas `.env`, credenciales, archivos de evidencia o artefactos de calidad en el repositorio.
- Revisa los cambios de `version` y `readme` antes de subirlos a la rama del microservicio.
- Usa secretos de CI/CD o un gestor de secretos para las credenciales de producción.

## Licencia

[MIT](LICENSE).
