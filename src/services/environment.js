'use strict';

const path = require('node:path');
const { access, readFile, writeFile } = require('node:fs/promises');
const { constants } = require('node:fs');

const DEFAULT_JIRA_HOST = 'https://umane.emeal.nttdata.com/jiraito';
const DEFAULT_JIRA_PROJECT_KEY = 'EVOLCRE4';

const ENVIRONMENT_TEMPLATE = `# Jira Configuration (Default: EVOLCRE4)
JIRA_HOST=${DEFAULT_JIRA_HOST}
JIRA_PROJECT_KEY=${DEFAULT_JIRA_PROJECT_KEY}
JIRA_ISSUE_KEY=
JIRA_AUTH_BASIC=
JIRA_API_TOKEN=

# Authentication Providers for Endpoints (ATLAS / AGORA)
# Opciones: ATLAS, AGORA, CUSTOM
AUTH_PROVIDER=ATLAS
ATLAS_CLIENT_ID=
ATLAS_CLIENT_SECRET=
AGORA_CLIENT_ID=
AGORA_CLIENT_SECRET=
AUTH_TOKEN=

# Quality & SonarQube
SONAR_HOST_URL=https://sonar.example.com
SONAR_TOKEN=
`;

async function ensureEnvironmentFiles(currentDirectory = process.cwd(), {
  fileSystem = { access, writeFile }
} = {}) {
  const envPath = path.join(currentDirectory, '.env');
  const examplePath = path.join(currentDirectory, '.env.example');
  const [hasEnv, hasExample] = await Promise.all([
    exists(envPath, fileSystem),
    exists(examplePath, fileSystem)
  ]);

  if (hasEnv || hasExample) {
    return {
      created: false,
      envPath,
      examplePath,
      existingFile: hasEnv ? envPath : examplePath
    };
  }

  await fileSystem.writeFile(examplePath, ENVIRONMENT_TEMPLATE, 'utf8');
  await fileSystem.writeFile(envPath, ENVIRONMENT_TEMPLATE, 'utf8');

  return {
    created: true,
    envPath,
    examplePath
  };
}

async function saveJiraIssueKey(issueKey, currentDirectory = process.cwd(), {
  fileSystem = { readFile, writeFile }
} = {}) {
  if (typeof issueKey !== 'string' || !issueKey.trim()) {
    throw new Error('JIRA_ISSUE_KEY es obligatoria.');
  }

  const envPath = path.join(currentDirectory, '.env');
  let content;

  try {
    content = await fileSystem.readFile(envPath, 'utf8');
  } catch (cause) {
    if (cause.code !== 'ENOENT') {
      throw new Error(`No se pudo leer ${envPath}.`, { cause });
    }
    content = ENVIRONMENT_TEMPLATE;
  }

  const normalizedIssueKey = issueKey.trim();
  const assignment = `JIRA_ISSUE_KEY=${normalizedIssueKey}`;
  const keyPattern = /^JIRA_ISSUE_KEY=.*$/m;
  const updatedContent = keyPattern.test(content)
    ? content.replace(keyPattern, assignment)
    : `${content.trimEnd()}\n${assignment}\n`;

  try {
    await fileSystem.writeFile(envPath, updatedContent, 'utf8');
  } catch (cause) {
    throw new Error(`No se pudo guardar JIRA_ISSUE_KEY en ${envPath}.`, { cause });
  }

  return { envPath, issueKey: normalizedIssueKey };
}

async function exists(filePath, fileSystem) {
  try {
    await fileSystem.access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  DEFAULT_JIRA_HOST,
  DEFAULT_JIRA_PROJECT_KEY,
  ENVIRONMENT_TEMPLATE,
  ensureEnvironmentFiles,
  saveJiraIssueKey
};
