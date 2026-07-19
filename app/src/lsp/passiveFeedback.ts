//
import { fileURLToPath } from 'url';

import type {
  Diagnostic,
  DiagnosticFile,
  DiagnosticSeverity,
} from './types.js';
import { registerPendingLSPDiagnostic } from './LSPDiagnosticRegistry.js';
import type { LSPServerManager } from './LSPServerManager.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'lsp:passiveFeedback',
  level: LogLevel.INFO,
});

function mapLSPSeverity(lspSeverity: number | undefined): string {
  switch (lspSeverity) {
    case 1:
      return 'Error';
    case 2:
      return 'Warning';
    case 3:
      return 'Info';
    case 4:
      return 'Hint';
    default:
      return 'Error';
  }
}

export function formatDiagnosticsForAttachment(params: {
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
}): DiagnosticFile[] {
  let uri: string;
  try {
    uri = params.uri.startsWith('file://')
      ? fileURLToPath(params.uri)
      : params.uri;
  } catch {
    uri = params.uri;
  }

  const diagnostics = params.diagnostics.map((diag) => ({
    message: diag.message,
    severity: mapLSPSeverity(
      diag.severity
    ) as unknown as DiagnosticFile['diagnostics'][0]['severity'],
    range: {
      start: {
        line: diag.range.start.line,
        character: diag.range.start.character,
      },
      end: {
        line: diag.range.end.line,
        character: diag.range.end.character,
      },
    },
    source: diag.source,
    code:
      diag.code !== undefined && diag.code !== null
        ? String(diag.code)
        : undefined,
  }));

  return [
    {
      uri,
      diagnostics,
    },
  ];
}

export type HandlerRegistrationResult = {
  totalServers: number;
  successCount: number;
  registrationErrors: Array<{ serverName: string; error: string }>;
  diagnosticFailures: Map<string, { count: number; lastError: string }>;
};

export function registerLSPNotificationHandlers(
  manager: LSPServerManager
): HandlerRegistrationResult {
  const servers = manager.getAllServers();
  const registrationErrors: Array<{ serverName: string; error: string }> = [];
  let successCount = 0;
  const diagnosticFailures: Map<string, { count: number; lastError: string }> =
    new Map();

  for (const [serverName, serverInstance] of servers.entries()) {
    try {
      if (
        !serverInstance ||
        typeof serverInstance.onNotification !== 'function'
      ) {
        const errorMsg = !serverInstance
          ? 'Server instance is null/undefined'
          : 'Server instance has no onNotification method';

        registrationErrors.push({ serverName, error: errorMsg });
        continue;
      }

      serverInstance.onNotification(
        'textDocument/publishDiagnostics',
        (params: unknown) => {
          try {
            if (
              !params ||
              typeof params !== 'object' ||
              !('uri' in params) ||
              !('diagnostics' in params)
            ) {
              return;
            }

            const diagnosticParams = params as {
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
            };

            const diagnosticFiles =
              formatDiagnosticsForAttachment(diagnosticParams);

            const firstFile = diagnosticFiles[0];
            if (
              !firstFile ||
              diagnosticFiles.length === 0 ||
              firstFile.diagnostics.length === 0
            ) {
              return;
            }

            try {
              registerPendingLSPDiagnostic({
                serverName,
                files: diagnosticFiles,
              });

              diagnosticFailures.delete(serverName);
            } catch (error) {
              const err =
                error instanceof Error ? error : new Error(String(error));
              const failures = diagnosticFailures.get(serverName) || {
                count: 0,
                lastError: '',
              };
              failures.count++;
              failures.lastError = err.message;
              diagnosticFailures.set(serverName, failures);
            }
          } catch (err) {
            // Handler errors are isolated

            logger.debug('Operation skipped', {
              context: 'Handler errors are isolated',
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      );

      successCount++;
    } catch (error) {
      registrationErrors.push({
        serverName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    totalServers: servers.size,
    successCount,
    registrationErrors,
    diagnosticFailures,
  };
}
