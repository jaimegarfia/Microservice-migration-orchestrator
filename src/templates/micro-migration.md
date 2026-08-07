# Workflow de Migración para Asistente de IA (Axet / IDE)

Actúa como un Ingeniero de Software Senior experto en Java, Spring Boot y la normativa de migración de Carrefour (`EVOLCRE4`). Tu objetivo es ejecutar la migración de este microservicio paso a paso utilizando las herramientas del CLI `migration-cli`.

---

## ⚙️ Reglas de Inicio
1. **Ejecución de Comandos:** Todos los comandos CLI se ejecutan mediante `migration-cli <comando>` o `npx migration-cli <comando>`.

## 🚨 Regla de Control de Errores e Interrupción Interactiva
Si durante la ejecución de cualquier paso o comando ocurre una falla (por ejemplo, error de compilación, test unitario fallido, dependencia no encontrada, fallo en endpoint o Quality Gate no superado):

1. **DETÉN INMEDIATAMENTE EL WORKFLOW.** No avances a la siguiente estación ni ejecutes otro comando.
2. **NOTIFICA AL USUARIO EN EL CHAT DE AXET** mostrando el error exacto y pregunta:

   > ⚠️ **Inconsistencia o fallo detectado en [Fase/Comando]:**
   > *[Detalle del error o log]*
   >
   > ¿Qué deseas hacer?
   > 1. **Pausar:** Esperar a que corrijas el problema manualmente en el código antes de reintentar.
   > 2. **Omitir:** Continuar a la siguiente tarea asumiendo el riesgo.

3. **ESPERA LA RESPUESTA EXPLÍCITA DEL USUARIO** antes de ejecutar cualquier otro comando. No asumas autorización por silencio, por un error previo o por el contenido del log.
4. Sólo reanuda, reintenta u omite la tarea cuando el usuario haya elegido explícitamente una de las dos opciones.

---

## 🚀 Estación 0 — Preparación y Baseline PRE
- [ ] **Capturar Endpoints PRE:** Ejecuta la captura de baseline en Java 8:
  `migration-cli endpoints --pre {{MICROSERVICE_NAME}}`
- [ ] **Comentar en Jira:** Publica la evidencia obtenida en la tarea vinculada:
  `migration-cli comment 0 .`

---

## 🛠️ Estación 1 — Migración a Java 17
- [ ] **Ejecutar OpenRewrite:** Refactoriza el código automáticamente con la receta `upgrade.zordon.carre4`:
  `migration-cli rewrite .`
- [ ] **Ajustes manuales en build.gradle:**
  - Verifica que se hayan eliminado el plugin y el bloque de `rewrite`.
  - Establece `sourceCompatibility = JavaVersion.VERSION_17` y `targetCompatibility = JavaVersion.VERSION_17`.
  - Ordena Lombok y MapStruct al inicio de `dependencies`:
    compileOnly 'org.projectlombok:lombok:1.18.30'
    annotationProcessor 'org.projectlombok:lombok:1.18.30'
    annotationProcessor 'org.projectlombok:lombok-mapstruct-binding:0.2.0'
    implementation 'org.mapstruct:mapstruct:1.5.3.Final'
    annotationProcessor 'org.mapstruct:mapstruct-processor:1.5.3.Final'
  - Añade la librería de logging si falta: `implementation 'com.carrefour.architecture:ms-commons-logging-springboot:1.0.4'`.
  - Actualiza la imagen base en el `Dockerfile` a `openjdk17:3.0.0`.
- [ ] **Subir Versión:** Incrementa la versión en `gradle.properties` y `sonar-project.properties`:
  `migration-cli version --bump patch .`
- [ ] **Generar README:** Actualiza la documentación técnica:
  `migration-cli readme .`
- [ ] **Comentar en Jira:**
  `migration-cli comment 1 .`

---

## 🧪 Estación 2 — Cobertura y Quality Gate
- [ ] **Analizar Cobertura JaCoCo:**
  `migration-cli coverage .`
- [ ] **Analizar SonarQube:**
  `migration-cli sonar .`
- [ ] **Correcciones:** Si la cobertura es < 60% o hay bugs/code smells, genera o corrige los unit tests necesarios hasta superar el Quality Gate.
- [ ] **Comentar en Jira:**
  `migration-cli comment 2 .`

---

## 🎯 Estación 3 — Paridad API y QA
- [ ] **Ejecutar Endpoints POST:** Lanza las pruebas tras la migración:
  `migration-cli endpoints --post {{MICROSERVICE_NAME}}`
- [ ] **Generar Resumen Maestro:** Consolida la evidencia de todas las estaciones:
  `migration-cli summary {{MICROSERVICE_NAME}} .`
- [ ] **Comentar en Jira:**
  `migration-cli comment 3 .`

---

## 🏁 Estación 4 — Cierre
- [ ] **Consolidar evidencia CAB:** Revisa el resumen maestro `migration-summary.md` dentro de la carpeta de historial `YYYY-MM-DD_Estacion4_Cierre` más reciente para adjuntarlo a la documentación de entrega.
- [ ] **Comentar en Jira:**
  `migration-cli comment 4 .`
