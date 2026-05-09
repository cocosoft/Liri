export {
  DiagnosticRegistry,
  globalDiagnosticRegistry,
  mapSeverity,
  formatDiagnosticsForFile,
  type DiagnosticSeverity,
  type DiagnosticFile,
  type DiagnosticEntry,
  type PendingDiagnostic,
} from './DiagnosticRegistry';

export {
  PassiveFeedback,
  globalPassiveFeedback,
  type FeedbackEvent,
  type FeedbackListener,
  type DiagnosticSummary,
} from './PassiveFeedback';
