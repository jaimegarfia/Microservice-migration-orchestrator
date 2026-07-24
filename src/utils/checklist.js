'use strict';

const STANDARD_SUBTASKS = Object.freeze([
  '[Estación 0] Pruebas endpoints pre-migración',
  '[Estación 1] Tareas pre-migración y migración',
  '[Estación 1] Post-migración y generación de README',
  '[Estación 2] Aumentar cobertura de tests (>60%)',
  '[Estación 2] Corrección de Code Smells y Bugs (Sonar)',
  '[Estación 3] Despliegue DEV y Superar Prisma',
  '[Estación 3] Pruebas endpoints post-migración',
  '[Estación 4] Despliegue CUA / PRO y documentación CAB'
]);

function validateMicroserviceName(microserviceName) {
  if (typeof microserviceName !== 'string' || !microserviceName.trim()) {
    throw new Error('El nombre del microservicio debe ser un texto no vacío.');
  }

  return microserviceName.trim();
}

function toHistoryFileName(microserviceName) {
  const normalizedName = validateMicroserviceName(microserviceName)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  if (!normalizedName) {
    throw new Error(
      'El nombre del microservicio no contiene caracteres válidos para crear el historial.'
    );
  }

  return `jira-tasks-${normalizedName}.md`;
}

function buildMigrationChecklist(microserviceName) {
  const serviceName = validateMicroserviceName(microserviceName);
  const parentTitle = `Migración Microservicio: ${serviceName}`;
  const taskLines = STANDARD_SUBTASKS.map((title) => `- [ ] ${title}`);

  return [
    `# ${parentTitle}`,
    '',
    '## Tarea padre',
    `- [ ] ${parentTitle}`,
    '',
    '## Subtareas estándar',
    ...taskLines,
    ''
  ].join('\n');
}

module.exports = {
  STANDARD_SUBTASKS,
  buildMigrationChecklist,
  toHistoryFileName,
  validateMicroserviceName
};
