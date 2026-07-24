'use strict';

const { runInitCommand } = require('./commands/init');
const {
  runPreMigrationEndpoints,
  runPostMigrationEndpoints
} = require('./commands/endpoints');
const {
  runReadmeCommand,
  runStation1Preparation,
  runVersionCommand
} = require('./commands/station1');
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
  JiraClient,
  JiraConfigurationError,
  JiraRequestError
} = require('./services/jira');
const {
  STANDARD_SUBTASKS,
  buildMigrationChecklist,
  toHistoryFileName
} = require('./utils/checklist');

module.exports = {
  EndpointSourceError,
  ParityError,
  SummaryError,
  JiraClient,
  QualityAnalysisError,
  VersioningError,
  JiraConfigurationError,
  JiraRequestError,
  PARITY_STATUS,
  STANDARD_SUBTASKS,
  analyzeCoverage,
  assessMigration,
  analyzeMicroservice,
  buildMigrationChecklist,
  calculateCoverageGate,
  collectMigrationEvidence,
  compareEndpointResults,
  createParityReport,
  createPostMigrationReport,
  bumpProjectVersion,
  bumpVersion,
  discoverEndpointSource,
  evaluateSonarQualityGate,
  executeGetEndpoints,
  extractGetEndpoints,
  fetchSonarMetrics,
  findLatestPreReport,
  generateProjectReadme,
  loadEndpointDefinition,
  parseJacocoReport,
  rankCoveragePriorities,
  renderMigrationSummary,
  runCoverageCommand,
  runInitCommand,
  runPostMigrationEndpoints,
  runPreMigrationEndpoints,
  runMigrationSummary,
  runReadmeCommand,
  runSonarCommand,
  runStation1Preparation,
  runStation2Quality,
  runVersionCommand,
  runInteractiveWizard,
  toHistoryFileName,
  validateMicroserviceSlug,
  writePostMigrationReport
};
