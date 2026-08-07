'use strict';

class JiraConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JiraConfigurationError';
  }
}

function extractJiraIssueKey(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new JiraConfigurationError(
      'Debes indicar una clave o URL de incidencia Jira (por ejemplo EVOLCRE4-1234).'
    );
  }

  const candidate = value.trim();
  const directMatch = /^([A-Za-z][A-Za-z0-9_]*-\d+)$/i.exec(candidate);
  if (directMatch) {
    return directMatch[1].toUpperCase();
  }

  try {
    const url = new URL(candidate);
    const match = /(?:browse|issue|issues)\/([A-Za-z][A-Za-z0-9_]*-\d+)(?:[/?#]|$)/i
      .exec(`${url.pathname}${url.search}${url.hash}`);
    if (match) {
      return match[1].toUpperCase();
    }
  } catch {
    // A non-URL must be a valid Jira key and is handled by the error below.
  }

  const embeddedMatch = /(?:^|[/?#=&])([A-Za-z][A-Za-z0-9_]*-\d+)(?:$|[/?#&])/i
    .exec(candidate);
  if (embeddedMatch) {
    return embeddedMatch[1].toUpperCase();
  }

  throw new JiraConfigurationError(
    `No se pudo extraer JIRA_ISSUE_KEY de "${candidate}".`
  );
}

module.exports = {
  extractJiraIssueKey,
  JiraConfigurationError
};
