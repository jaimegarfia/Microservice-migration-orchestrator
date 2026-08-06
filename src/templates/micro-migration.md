# Workflow de migración: {{MICROSERVICE_NAME}}

> Este workflow está diseñado para que Axet, Cursor, Copilot u otra IA de IDE
> orqueste la migración junto con el usuario. Ejecuta cada estación en orden,
> muestra los resultados relevantes y detente cuando se requiera una decisión,
> credencial o revisión manual.

## Contexto del microservicio

- **Microservicio:** `{{MICROSERVICE_NAME}}`
- **Directorio de trabajo:** raíz del microservicio
- **CLI:** `migration-cli`
- **Tarea Jira vinculada:** configura una clave o URL existente mediante:
  ```bash
  migration-cli init {{MICROSERVICE_NAME}} --jira-issue <EVOLCRE4-1234-o-URL>
  ```
  El comando guarda `JIRA_ISSUE_KEY` en `.env`. Nunca crees una tarea ni subtareas
  Jira nuevas durante este workflow.

## Regla obligatoria de gateway por estación

Al terminar cada estación (0, 1, 2 o 3), **DEBES PARAR OBLIGATORIAMENTE**. No
inicies la siguiente estación hasta que el usuario haya revisado los cambios, realizado
el commit y escrito exactamente **“Continuar”** en el chat.

Tras la confirmación, publica la evidencia en Jira antes de avanzar:

```bash
npx microservice-migration-orchestrator comment <numero-estacion> .
```

Confirma en el chat que el comentario se publicó en la tarea Jira vinculada. Si falla,
detente y solicita al usuario resolver configuración, credenciales o conectividad Jira.

## Estación 0 — Preparación y baseline

1. Vincula la tarea Jira existente si `JIRA_ISSUE_KEY` no está ya configurada:

   ```bash
   migration-cli init {{MICROSERVICE_NAME}} --jira-issue <EVOLCRE4-1234-o-URL>
   ```

2. Revisa la salida y los archivos `.env` / `.env.example`.
   - Si faltan credenciales necesarias de Jira, OAuth2 o SonarQube, **detente**.
   - Solicita al usuario por el chat del IDE los valores requeridos.
   - No inventes, persistas ni expongas secretos en el workflow, consola o commits.

3. Comprueba el sistema de build:
   - Si existe `pom.xml` y no existe `build.gradle`, ejecuta:

     ```bash
     migration-cli maven-to-gradle .
     ```

   - Cuando la conversión y `gradlew compileJava` finalicen correctamente, pregunta
     al usuario si desea ejecutar el cutover definitivo:

     ```bash
     migration-cli maven-to-gradle . --cutover
     ```

   - No ejecutes `--cutover` sin confirmación explícita: elimina `pom.xml`, `.mvn/`
     y `target/` después de validar Gradle.

4. Con la terminal configurada en **Java 8**, captura la baseline previa:

   ```bash
   migration-cli endpoints --pre {{MICROSERVICE_NAME}}
   ```

   Si se requiere una definición de API o URL base, pide al usuario la ruta/URL y
   vuelve a ejecutar el comando con `--source` y/o `--base-url`.

### ✋ GATEWAY OBLIGATORIO — Estación 0 completada

Comunica exactamente al usuario:

> ✋ **Estación 0 Completada.**
> 1. Revisa los cambios generados en el código.
> 2. Realiza el commit en Git:
>    ```bash
>    git add .
>    git commit -m "feat(migration): Estación 0 completada"
>    ```
> 3. Escribe *"Continuar"* en el chat cuando hayas verificado y hecho el commit.

**PARA.** Tras recibir *“Continuar”*, ejecuta `npx microservice-migration-orchestrator comment 0 .`, confirma que la evidencia se publicó en Jira y sólo entonces continúa.

## Estación 1 — Modernización a Java 17

1. Ejecuta OpenRewrite:

   ```bash
   migration-cli rewrite .
   ```

2. Indica al usuario que cambie la consola o `JAVA_HOME` a **Java 17** antes de
   compilar, probar o continuar con la modernización.

3. Revisa manualmente `build.gradle` junto con el usuario:
   - Dependencias y procesadores de anotaciones de **Lombok**.
   - Dependencias y procesadores de anotaciones de **MapStruct**.
   - La versión/configuración de
     `ms-commons-logging-springboot:1.0.4`.
   - La imagen base y compatibilidad Java 17 del `Dockerfile`.

   Detente ante incompatibilidades, dependencias no resueltas o cambios funcionales
   que requieran una decisión del usuario.

4. Incrementa la versión y genera la documentación técnica:

   ```bash
   migration-cli version --bump patch .
   migration-cli readme .
   ```

### ✋ GATEWAY OBLIGATORIO — Estación 1 completada

Comunica exactamente al usuario:

> ✋ **Estación 1 Completada.**
> 1. Revisa los cambios generados en el código.
> 2. Realiza el commit en Git:
>    ```bash
>    git add .
>    git commit -m "feat(migration): Estación 1 completada"
>    ```
> 3. Escribe *"Continuar"* en el chat cuando hayas verificado y hecho el commit.

**PARA.** Tras recibir *“Continuar”*, ejecuta `npx microservice-migration-orchestrator comment 1 .`, confirma que la evidencia se publicó en Jira y sólo entonces continúa.

## Estación 2 — Calidad

1. Ejecuta JaCoCo:

   ```bash
   migration-cli coverage .
   ```

   Valida que la cobertura de líneas sea **superior al 60%**. Si no se alcanza,
   muestra las clases prioritarias y solicita al usuario que complete o apruebe los
   tests necesarios.

2. Ejecuta SonarQube:

   ```bash
   migration-cli sonar .
   ```

   Valida:
   - **Code Smells < 30**
   - **0 Bugs**

   Si SonarQube no está configurado, solicita al usuario las credenciales/configuración
   necesarias o registra que la validación queda pendiente.

### ✋ GATEWAY OBLIGATORIO — Estación 2 completada

Comunica exactamente al usuario:

> ✋ **Estación 2 Completada.**
> 1. Revisa los cambios generados en el código.
> 2. Realiza el commit en Git:
>    ```bash
>    git add .
>    git commit -m "feat(migration): Estación 2 completada"
>    ```
> 3. Escribe *"Continuar"* en el chat cuando hayas verificado y hecho el commit.

**PARA.** Tras recibir *“Continuar”*, ejecuta `npx microservice-migration-orchestrator comment 2 .`, confirma que la evidencia se publicó en Jira y sólo entonces continúa.

## Estación 3 — Validación posterior y cierre

1. Levanta la aplicación en local o DEV con la configuración aprobada por el usuario.

2. Ejecuta la validación POST contra la instancia migrada:

   ```bash
   migration-cli endpoints --post {{MICROSERVICE_NAME}}
   ```

   Añade `--base-url <url>` y `--source <ruta-o-url>` cuando sea necesario. Revisa
   el informe de paridad y detente ante cambios rompientes.

3. Genera el reporte consolidado:

   ```bash
   migration-cli summary {{MICROSERVICE_NAME}} .
   ```

4. Presenta al usuario un resumen de:
   - conversión Maven → Gradle y estado de cutover;
   - baseline y paridad PRE/POST;
   - cobertura y SonarQube;
   - versiones, README y evidencias generadas;
   - advertencias, bloqueos y acciones pendientes.

### ✋ GATEWAY OBLIGATORIO — Estación 3 completada

Comunica exactamente al usuario:

> ✋ **Estación 3 Completada.**
> 1. Revisa los cambios generados en el código.
> 2. Realiza el commit en Git:
>    ```bash
>    git add .
>    git commit -m "feat(migration): Estación 3 completada"
>    ```
> 3. Escribe *"Continuar"* en el chat cuando hayas verificado y hecho el commit.

**PARA.** Tras recibir *“Continuar”*, ejecuta `npx microservice-migration-orchestrator comment 3 .`, confirma que la evidencia se publicó en Jira y cierra el workflow.
