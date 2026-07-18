import {
  DiagnosticRegistry,
  type DiagnosticFile,
  type DiagnosticEntry,
  formatDiagnosticsForFile,
  globalDiagnosticRegistry,
} from './DiagnosticRegistry';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'services:lsp:PassiveFeedback', level: LogLevel.INFO });

export type FeedbackEvent = 'diagnostics_changed' | 'diagnostics_cleared';

export type FeedbackListener = (event: FeedbackEvent, data: any) => void;

export type DiagnosticSummary = {
  uri: string;
  errors: number;
  warnings: number;
  info: number;
  hints: number;
  diagnostics: DiagnosticEntry[];
};

export class PassiveFeedback {
  private registry: DiagnosticRegistry;
  private listeners: Map<string, Set<FeedbackListener>> = new Map();
  private lastDiagnosticSnapshot: Map<string, DiagnosticSummary> = new Map();

  constructor(registry: DiagnosticRegistry) {
    this.registry = registry;
  }

  onEvent(event: FeedbackEvent, listener: FeedbackListener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  private emit(event: FeedbackEvent, data: any): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event, data);
        } catch (err) {

          // ignore listener errors

          logger.debug("Operation skipped", { context: "ignore listener errors", error: err instanceof Error ? err.message : String(err) });

        }
      }
    }
  }

  notifyDiagnosticsChanged(
    serverName: string,
    params: {
      uri: string;
      diagnostics: Array<{
        message: string;
        severity?: number;
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
        source?: string;
        code?: string | number;
      }>;
    }
  ): void {
    const file = formatDiagnosticsForFile(params);
    const summary = this.summarizeFile(file);

    this.registry.registerDiagnostics(serverName, [file]);

    const prevSummary = this.lastDiagnosticSnapshot.get(file.uri);
    if (this.hasChanged(prevSummary, summary)) {
      this.lastDiagnosticSnapshot.set(file.uri, summary);
      this.emit('diagnostics_changed', {
        serverName,
        file,
        summary,
        previousSummary: prevSummary,
      });
    }
  }

  getPendingFeedback(): {
    newDiagnostics: DiagnosticFile[];
  } {
    const pending = this.registry.getNewDiagnostics();
    const files: DiagnosticFile[] = [];

    for (const diag of pending) {
      for (const file of diag.files) {
        files.push(file);
      }
    }

    return { newDiagnostics: files };
  }

  getDiagnosticSummary(uri: string): DiagnosticSummary | null {
    return this.lastDiagnosticSnapshot.get(uri) || null;
  }

  getAllSummaries(): Map<string, DiagnosticSummary> {
    return new Map(this.lastDiagnosticSnapshot);
  }

  private summarizeFile(file: DiagnosticFile): DiagnosticSummary {
    let errors = 0;
    let warnings = 0;
    let info = 0;
    let hints = 0;

    for (const d of file.diagnostics) {
      switch (d.severity) {
        case 'Error':
          errors++;
          break;
        case 'Warning':
          warnings++;
          break;
        case 'Info':
          info++;
          break;
        case 'Hint':
          hints++;
          break;
      }
    }

    return {
      uri: file.uri,
      errors,
      warnings,
      info,
      hints,
      diagnostics: file.diagnostics,
    };
  }

  private hasChanged(
    prev: DiagnosticSummary | undefined,
    current: DiagnosticSummary
  ): boolean {
    if (!prev) return true;
    return (
      prev.errors !== current.errors ||
      prev.warnings !== current.warnings ||
      prev.info !== current.info ||
      prev.hints !== current.hints
    );
  }

  clear(): void {
    this.lastDiagnosticSnapshot.clear();
    this.emit('diagnostics_cleared', {});
  }
}

export const globalPassiveFeedback = new PassiveFeedback(
  globalDiagnosticRegistry
);
