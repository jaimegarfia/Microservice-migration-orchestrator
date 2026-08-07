'use strict';

const { runInitCommand } = require('./commands/init');
const {
  buildStationComment,
  runCommentCommand
} = require('./commands/comment');
const { runWorkflowCommand } = require('./commands/workflow');
const {
  runPreMigrationEndpoints,
  runPostMigrationEndpoints
} = require('./commands/endpoints');
const {
  runMavenToGradleCommand,
  runReadmeCommand,
  runRewriteCommand,
  runStation1Preparation,
  runVersionCommand
} = require('./commands/station1');
const {
  GOOGLE_ARTIFACTORY_TEMPLATE,
  GRADLE_VERSION,
  MavenToGradleError,
  SONAR_TEMPLATE,
  convertMavenToGradle,
  generateGradleArtifacts,
  parsePom
} = require('./services/maven-to-gradle');
const {
  BLOCK_END,
  BLOCK_START,
  DEFAULT_IGNORED_ENTRIES,
  GITIGNORE_FILE_NAME,
  GitIgnoreError,
  createManagedBlock,
  ensureGitIgnore,
  updateGitIgnoreContent
} = require('./services/gitignore');
const {
  TEMPLATE_PATH,
  WORKFLOW_FILE_NAME,
  WorkflowError,
  generateMigrationWorkflow,
  renderMigrationWorkflow,
  resolveWorkflowPath
} = require('./services/workflow');
const {
  AUTH_PROVIDERS,
  AuthenticationError,
  resolveEndpointAuthToken
} = require('./services/authentication');
const {
  DEFAULT_JIRA_PROJECT_KEY,
  ENVIRONMENT_TEMPLATE,
  ensureEnvironmentFiles,
  saveJiraIssueKey
} = require('./services/environment');
const {
  DEFAULT_RECIPE_DEPENDENCY,
  REWRITE_PLUGIN_VERSION,
  REWRITER_TEMPLATE,
  RewriteError,
  runOpenRewrite
} = require('./services/rewrite');
const {
  runInteractiveWizard,
  validateMicroserviceSlug
} = require('./commands/wizard');
const { runMigrationSummary } = require('./commands/summary');
const {
  analyzeMicroservice,
  generateProjectReadme
} = require('./services/readme');
const {
  runCoverageCommand,
  runSonarCommand,
  runStation2Quality
} = require('./commands/quality');
const {
  QualityAnalysisError,
  analyzeCoverage,
  calculateCoverageGate,
  evaluateSonarQualityGate,
  fetchSonarMetrics,
  parseJacocoReport,
  rankCoveragePriorities
} = require('./services/quality');
const {
  EndpointSourceError,
  createPostMigrationReport,
  discoverEndpointSource,
  executeGetEndpoints,
  extractGetEndpoints,
  loadEndpointDefinition,
  writePostMigrationReport
} = require('./services/endpoints');
const {
  PARITY_STATUS,
  ParityError,
  compareEndpointResults,
  createParityReport,
  findLatestPreReport
} = require('./services/parity');
const {
  SummaryError,
  assessMigration,
  collectMigrationEvidence,
  renderMigrationSummary
} = require('./services/summary');
const {
  VersioningError,
  bumpProjectVersion,
  bumpVersion
} = require('./services/versioning');
const {
  extractJiraIssueKey,
  JiraConfigurationError
} = require('./services/jira');
const {
  STANDARD_SUBTASKS,
  buildMigrationChecklist,
  toHistoryFileName
} = require('./utils/checklist');

module.exports = {
  EndpointSourceError,
  AuthenticationError,
  MavenToGradleError,
  ParityError,
  GitIgnoreError,
  WorkflowError,
  RewriteError,
  SummaryError,
  QualityAnalysisError,
  extractJiraIssueKey,
  VersioningError,
  JiraConfigurationError,
  PARITY_STATUS,
  AUTH_PROVIDERS,
  BLOCK_END,
  BLOCK_START,
  DEFAULT_IGNORED_ENTRIES,
  DEFAULT_JIRA_PROJECT_KEY,
  DEFAULT_RECIPE_DEPENDENCY,
  GRADLE_VERSION,
  ENVIRONMENT_TEMPLATE,
  GITIGNORE_FILE_NAME,
  GOOGLE_ARTIFACTORY_TEMPLATE,
  REWRITE_PLUGIN_VERSION,
  REWRITER_TEMPLATE,
  SONAR_TEMPLATE,
  STANDARD_SUBTASKS,
  TEMPLATE_PATH,
  WORKFLOW_FILE_NAME,
  analyzeCoverage,
  assessMigration,
  analyzeMicroservice,
  buildMigrationChecklist,
  buildStationComment,
  calculateCoverageGate,
  collectMigrationEvidence,
  compareEndpointResults,
  createManagedBlock,
  createParityReport,
  createPostMigrationReport,
  bumpProjectVersion,
  bumpVersion,
  discoverEndpointSource,
  ensureEnvironmentFiles,
  ensureGitIgnore,
  saveJiraIssueKey,
  evaluateSonarQualityGate,
  executeGetEndpoints,
  extractGetEndpoints,
  fetchSonarMetrics,
  findLatestPreReport,
  generateGradleArtifacts,
  generateMigrationWorkflow,
  generateProjectReadme,
  loadEndpointDefinition,
  parseJacocoReport,
  parsePom,
  rankCoveragePriorities,
  renderMigrationSummary,
  renderMigrationWorkflow,
  resolveEndpointAuthToken,
  resolveWorkflowPath,
  runCoverageCommand,
  runCommentCommand,
  runInitCommand,
  runPostMigrationEndpoints,
  runPreMigrationEndpoints,
  runMigrationSummary,
  runMavenToGradleCommand,
  runWorkflowCommand,
  runReadmeCommand,
  runRewriteCommand,
  runOpenRewrite,
  convertMavenToGradle,
  runSonarCommand,
  runStation1Preparation,
  runStation2Quality,
  runVersionCommand,
  runInteractiveWizard,
  toHistoryFileName,
  updateGitIgnoreContent,
  validateMicroserviceSlug,
  writePostMigrationReport
};
