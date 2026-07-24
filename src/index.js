'use strict';

const { runInitCommand } = require('./commands/init');
const { runPreMigrationEndpoints } = require('./commands/endpoints');
const {
  runReadmeCommand,
  runStation1Preparation,
  runVersionCommand
} = require('./commands/station1');
const {
  runInteractiveWizard,
  validateMicroserviceSlug
} = require('./commands/wizard');
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
  discoverEndpointSource,
  executeGetEndpoints,
  extractGetEndpoints,
  loadEndpointDefinition
} = require('./services/endpoints');
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
  JiraClient,
  QualityAnalysisError,
  VersioningError,
  JiraConfigurationError,
  JiraRequestError,
  STANDARD_SUBTASKS,
  analyzeCoverage,
  analyzeMicroservice,
  buildMigrationChecklist,
  calculateCoverageGate,
  bumpProjectVersion,
  bumpVersion,
  discoverEndpointSource,
  evaluateSonarQualityGate,
  executeGetEndpoints,
  extractGetEndpoints,
  fetchSonarMetrics,
  generateProjectReadme,
  loadEndpointDefinition,
  parseJacocoReport,
  rankCoveragePriorities,
  runCoverageCommand,
  runInitCommand,
  runPreMigrationEndpoints,
  runReadmeCommand,
  runSonarCommand,
  runStation1Preparation,
  runStation2Quality,
  runVersionCommand,
  runInteractiveWizard,
  toHistoryFileName,
  validateMicroserviceSlug
};
