//
import { spawn, type ChildProcess } from 'child_process';

import type {
  Position,
  Location,
  LocationLink,
  CompletionItem,
  Hover,
  SignatureHelp,
  DocumentLink,
  DocumentHighlight,
  SymbolInformation,
  CodeAction,
  Diagnostic,
  DocumentFormattingParams,
  ReferenceContext,
  TextEdit,
  WorkspaceEdit,
} from './types.js';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'lsp:LSPClient', level: LogLevel.INFO });

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface PendingHandler {
  method: string;
  handler: (params: unknown) => void;
}

interface PendingRequestHandler {
  method: string;
  handler: (params: unknown) => unknown | Promise<unknown>;
}

export interface LSPClient {
  readonly capabilities: Record<string, unknown> | undefined;
  readonly isInitialized: boolean;

  start(
    command: string,
    args: string[],
    options?: {
      env?: Record<string, string>;
      cwd?: string;
    }
  ): Promise<void>;

  initialize(rootUri: string, workspaceFolder?: string): Promise<void>;

  didOpen(uri: string, text: string, version?: number): Promise<void>;
  didChange(uri: string, text: string, version?: number): Promise<void>;
  didClose(uri: string): Promise<void>;
  didSave(uri: string): Promise<void>;

  completion(uri: string, position: Position): Promise<CompletionItem[]>;
  hover(uri: string, position: Position): Promise<Hover | null>;
  gotoDefinition(
    uri: string,
    position: Position
  ): Promise<Location | Location[] | LocationLink[] | null>;
  gotoDeclaration(
    uri: string,
    position: Position
  ): Promise<Location | Location[] | LocationLink[] | null>;
  gotoImplementation(
    uri: string,
    position: Position
  ): Promise<Location | Location[] | LocationLink[] | null>;
  gotoTypeDefinition(
    uri: string,
    position: Position
  ): Promise<Location | Location[] | LocationLink[] | null>;
  findReferences(
    uri: string,
    position: Position,
    context?: ReferenceContext
  ): Promise<Location[]>;

  documentSymbol(uri: string): Promise<SymbolInformation[]>;
  documentHighlight(
    uri: string,
    position: Position
  ): Promise<DocumentHighlight[]>;
  documentLink(uri: string): Promise<DocumentLink[]>;

  signatureHelp(uri: string, position: Position): Promise<SignatureHelp | null>;
  hoverContent(uri: string, position: Position): Promise<string | null>;
  formatting(
    uri: string,
    options: DocumentFormattingParams
  ): Promise<TextEdit[]>;
  rename(
    uri: string,
    position: Position,
    newName: string
  ): Promise<WorkspaceEdit | null>;
  codeAction(
    uri: string,
    position: Position,
    context: { diagnostics: Diagnostic[] }
  ): Promise<CodeAction[]>;

  onDiagnostics(
    handler: (params: { uri: string; diagnostics: Diagnostic[] }) => void
  ): void;
  onShowMessage(
    handler: (params: { type: number; message: string }) => void
  ): void;
  onLogMessage(
    handler: (params: { type: number; message: string }) => void
  ): void;
  onTelemetry(handler: (params: unknown) => void): void;
  onNotification(method: string, handler: (params: unknown) => void): void;
  onRequest(
    method: string,
    handler: (params: unknown) => unknown | Promise<unknown>
  ): void;

  stop(): Promise<void>;
}

function isLocationLink(result: unknown): result is LocationLink {
  return typeof result === 'object' && result !== null && 'targetUri' in result;
}

function normalizeLocation(
  result: unknown
): Location | Location[] | LocationLink[] | null {
  if (!result) return null;
  if (Array.isArray(result)) {
    if (result.length === 0) return null;
    if (isLocationLink(result[0])) return result as LocationLink[];
    return result as Location[];
  }
  return result as Location;
}

export function createLSPClient(
  serverName: string,
  onCrash?: (error: Error) => void
): LSPClient {
  let childProcess: ChildProcess | undefined;
  let childProcHandle:
    | {
        pid: number;
        stdin: (data: string) => void;
        kill: () => void;
        onExit: (handler: (code: number | null) => void) => void;
      }
    | undefined;

  let capabilities: Record<string, unknown> | undefined;
  let isInitialized = false;
  let isStopping = false;
  let requestId = 0;
  let buffer = '';

  const pendingRequests = new Map<number, PendingRequest>();
  const pendingHandlers: PendingHandler[] = [];
  const pendingRequestHandlers: PendingRequestHandler[] = [];
  const notificationHandlers = new Map<
    string,
    Set<(params: unknown) => void>
  >();
  const requestHandlers = new Map<
    string,
    (params: unknown) => unknown | Promise<unknown>
  >();

  function handleData(data: string): void {
    buffer += data;
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = buffer.substring(0, headerEnd);
      const contentLengthMatch = header.match(/Content-Length: (\d+)/i);
      if (!contentLengthMatch) {
        buffer = buffer.substring(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const messageStart = headerEnd + 4;

      if (buffer.length < messageStart + contentLength) break;

      const content = buffer.substring(
        messageStart,
        messageStart + contentLength
      );
      buffer = buffer.substring(messageStart + contentLength);

      try {
        const message = JSON.parse(content);

        if (message.id !== undefined && message.id !== null) {
          const pending = pendingRequests.get(message.id);
          if (pending) {
            pendingRequests.delete(message.id);
            if (message.error) {
              pending.reject(
                new Error(message.error.message || 'LSP request failed')
              );
            } else {
              pending.resolve(message.result);
            }
          }
        } else if (message.method) {
          const handlers = notificationHandlers.get(message.method);
          if (handlers) {
            for (const handler of handlers) {
              try {
                handler(message.params);
              } catch (err) {
                // Handler errors are isolated per handler

                handleError(err, {
                  module: 'lsp:LSPClient',
                  action: 'handleNotification',
                });
              }
            }
          }

          const requestHandler = requestHandlers.get(message.method);
          if (requestHandler) {
            // @ignore-catch — LSP通知处理fire-and-forget，失败不影响后续通信
            Promise.resolve(requestHandler(message.params)).catch(() => {});
          }
        }
      } catch (err) {
        // JSON parse errors are silently ignored

        handleError(err, { module: 'lsp:LSPClient', action: 'parseMessage' });
      }
    }
  }

  function sendMessage(message: unknown): void {
    if (!childProcHandle)
      throw new AppError(
        'LSP client not started',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    const body = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n`;
    childProcHandle.stdin(header + body);
  }

  return {
    get capabilities(): Record<string, unknown> | undefined {
      return capabilities;
    },

    get isInitialized(): boolean {
      return isInitialized;
    },

    async start(
      command: string,
      args: string[],
      options?: {
        env?: Record<string, string>;
        cwd?: string;
      }
    ): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        try {
          const child = spawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, ...options?.env },
            cwd: options?.cwd,
            windowsHide: true,
          });

          let spawnResolved = false;

          child.on('spawn', () => {
            spawnResolved = true;
            resolve();
          });

          child.on('error', (error: Error) => {
            if (!spawnResolved) {
              reject(error);
            } else if (!isStopping) {
              onCrash?.(error);
            }
          });

          child.on('exit', (code) => {
            isInitialized = false;
            if (code !== 0 && code !== null && !isStopping) {
              onCrash?.(
                new Error(`LSP server ${serverName} exited with code ${code}`)
              );
            }
          });

          child.stdin?.on('error', () => {
            // stdin errors are logged but not thrown
          });

          childProcess = child;

          childProcHandle = {
            get pid() {
              return child.pid ?? 0;
            },
            stdin: (data: string) => {
              child.stdin?.write(data);
            },
            kill: () => {
              child.kill();
            },
            onExit: (handler: (code: number | null) => void) => {
              child.on('exit', handler);
            },
          };

          child.stdout?.on('data', (data: Buffer) => {
            handleData(data.toString('utf-8'));
          });

          child.stderr?.on('data', (data: Buffer) => {
            // stderr output is available for debugging
          });

          if (spawnResolved) resolve();
        } catch (error) {
          reject(error);
        }
      });
    },

    async initialize(rootUri: string, workspaceFolder?: string): Promise<void> {
      const result = await sendRequest('initialize', {
        processId: process.pid,
        rootUri,
        rootPath: workspaceFolder,
        workspaceFolders: workspaceFolder
          ? [
              {
                uri: rootUri,
                name: workspaceFolder.split(/[\\/]/).pop() || '',
              },
            ]
          : null,
        capabilities: {
          textDocument: {
            synchronization: {
              dynamicRegistration: false,
              willSave: false,
              willSaveWaitUntil: false,
              didSave: true,
            },
            completion: {
              dynamicRegistration: false,
              completionItem: {
                snippetSupport: true,
              },
            },
            hover: {
              dynamicRegistration: false,
              contentFormat: ['markdown', 'plaintext'],
            },
            definition: {
              dynamicRegistration: false,
              linkSupport: true,
            },
            references: {
              dynamicRegistration: false,
            },
            documentHighlight: {
              dynamicRegistration: false,
            },
            documentSymbol: {
              dynamicRegistration: false,
              hierarchicalDocumentSymbolSupport: true,
            },
            formatting: {
              dynamicRegistration: false,
            },
            rename: {
              dynamicRegistration: false,
            },
            codeAction: {
              dynamicRegistration: false,
            },
            signatureHelp: {
              dynamicRegistration: false,
            },
            documentLink: {
              dynamicRegistration: false,
            },
          },
          workspace: {
            configuration: false,
            workspaceFolders: false,
          },
          general: {
            positionEncodings: ['utf-16'],
          },
        },
        initializationOptions: {},
      });

      capabilities = (result as any)?.capabilities as
        | Record<string, unknown>
        | undefined;

      sendNotification('initialized', {});
      isInitialized = true;

      for (const handler of pendingHandlers) {
        const existing = notificationHandlers.get(handler.method);
        if (existing) {
          existing.add(handler.handler);
        } else {
          notificationHandlers.set(handler.method, new Set([handler.handler]));
        }
      }
      pendingHandlers.length = 0;

      for (const handler of pendingRequestHandlers) {
        requestHandlers.set(handler.method, handler.handler);
      }
      pendingRequestHandlers.length = 0;
    },

    async didOpen(
      uri: string,
      text: string,
      version: number = 1
    ): Promise<void> {
      sendNotification('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId: detectLanguage(uri),
          version,
          text,
        },
      });
    },

    async didChange(
      uri: string,
      text: string,
      version: number = 2
    ): Promise<void> {
      sendNotification('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    },

    async didClose(uri: string): Promise<void> {
      sendNotification('textDocument/didClose', {
        textDocument: { uri },
      });
    },

    async didSave(uri: string): Promise<void> {
      sendNotification('textDocument/didSave', {
        textDocument: { uri },
      });
    },

    async completion(
      uri: string,
      position: Position
    ): Promise<CompletionItem[]> {
      const result = await sendRequest('textDocument/completion', {
        textDocument: { uri },
        position,
      });
      if (!result) return [];
      if (Array.isArray(result)) return result as CompletionItem[];
      return (result as { items: CompletionItem[] }).items || [];
    },

    async hover(uri: string, position: Position): Promise<Hover | null> {
      const result = await sendRequest('textDocument/hover', {
        textDocument: { uri },
        position,
      });
      return result as Hover | null;
    },

    async gotoDefinition(
      uri: string,
      position: Position
    ): Promise<Location | Location[] | LocationLink[] | null> {
      const result = await sendRequest('textDocument/definition', {
        textDocument: { uri },
        position,
      });
      return normalizeLocation(result);
    },

    async gotoDeclaration(
      uri: string,
      position: Position
    ): Promise<Location | Location[] | LocationLink[] | null> {
      const result = await sendRequest('textDocument/declaration', {
        textDocument: { uri },
        position,
      });
      return normalizeLocation(result);
    },

    async gotoImplementation(
      uri: string,
      position: Position
    ): Promise<Location | Location[] | LocationLink[] | null> {
      const result = await sendRequest('textDocument/implementation', {
        textDocument: { uri },
        position,
      });
      return normalizeLocation(result);
    },

    async gotoTypeDefinition(
      uri: string,
      position: Position
    ): Promise<Location | Location[] | LocationLink[] | null> {
      const result = await sendRequest('textDocument/typeDefinition', {
        textDocument: { uri },
        position,
      });
      return normalizeLocation(result);
    },

    async findReferences(
      uri: string,
      position: Position,
      context?: ReferenceContext
    ): Promise<Location[]> {
      const result = await sendRequest('textDocument/references', {
        textDocument: { uri },
        position,
        context: context || { includeDeclaration: true },
      });
      return (result as Location[]) || [];
    },

    async documentSymbol(uri: string): Promise<SymbolInformation[]> {
      const result = await sendRequest('textDocument/documentSymbol', {
        textDocument: { uri },
      });
      return (result as SymbolInformation[]) || [];
    },

    async documentHighlight(
      uri: string,
      position: Position
    ): Promise<DocumentHighlight[]> {
      const result = await sendRequest('textDocument/documentHighlight', {
        textDocument: { uri },
        position,
      });
      return (result as DocumentHighlight[]) || [];
    },

    async documentLink(uri: string): Promise<DocumentLink[]> {
      const result = await sendRequest('textDocument/documentLink', {
        textDocument: { uri },
      });
      return (result as DocumentLink[]) || [];
    },

    async signatureHelp(
      uri: string,
      position: Position
    ): Promise<SignatureHelp | null> {
      const result = await sendRequest('textDocument/signatureHelp', {
        textDocument: { uri },
        position,
      });
      return result as SignatureHelp | null;
    },

    async hoverContent(
      uri: string,
      position: Position
    ): Promise<string | null> {
      const hoverResult = await this.hover(uri, position);
      if (!hoverResult?.contents) return null;
      const contents = hoverResult.contents;
      if (typeof contents === 'string') return contents;
      if ('kind' in contents && 'value' in contents) return contents.value;
      if (Array.isArray(contents)) {
        return contents
          .map((c) => (typeof c === 'string' ? c : c.value))
          .join('\n');
      }
      return null;
    },

    async formatting(
      uri: string,
      options: DocumentFormattingParams
    ): Promise<TextEdit[]> {
      const result = await sendRequest('textDocument/formatting', {
        textDocument: { uri },
        options,
      });
      return (result as TextEdit[]) || [];
    },

    async rename(
      uri: string,
      position: Position,
      newName: string
    ): Promise<WorkspaceEdit | null> {
      const result = await sendRequest('textDocument/rename', {
        textDocument: { uri },
        position,
        newName,
      });
      return result as WorkspaceEdit | null;
    },

    async codeAction(
      uri: string,
      position: Position,
      context: { diagnostics: Diagnostic[] }
    ): Promise<CodeAction[]> {
      const result = await sendRequest('textDocument/codeAction', {
        textDocument: { uri },
        range: { start: position, end: position },
        context,
      });
      return (result as CodeAction[]) || [];
    },

    onDiagnostics(
      handler: (params: { uri: string; diagnostics: Diagnostic[] }) => void
    ): void {
      this.onNotification(
        'textDocument/publishDiagnostics',
        handler as (params: unknown) => void
      );
    },

    onShowMessage(
      handler: (params: { type: number; message: string }) => void
    ): void {
      this.onNotification(
        'window/showMessage',
        handler as (params: unknown) => void
      );
    },

    onLogMessage(
      handler: (params: { type: number; message: string }) => void
    ): void {
      this.onNotification(
        'window/logMessage',
        handler as (params: unknown) => void
      );
    },

    onTelemetry(handler: (params: unknown) => void): void {
      this.onNotification('telemetry/event', handler);
    },

    onNotification(method: string, handler: (params: unknown) => void): void {
      if (!isInitialized) {
        pendingHandlers.push({ method, handler });
        return;
      }
      const existing = notificationHandlers.get(method);
      if (existing) {
        existing.add(handler);
      } else {
        notificationHandlers.set(method, new Set([handler]));
      }
    },

    onRequest(
      method: string,
      handler: (params: unknown) => unknown | Promise<unknown>
    ): void {
      if (!isInitialized) {
        pendingRequestHandlers.push({ method, handler });
        return;
      }
      requestHandlers.set(method, handler);
    },

    async stop(): Promise<void> {
      isStopping = true;
      try {
        if (isInitialized) {
          await sendRequest('shutdown', {});
          sendNotification('exit', {});
        }
      } catch (err) {
        // Errors during shutdown are ignored

        handleError(err, { module: 'lsp:LSPClient', action: 'stop' });
      }
      if (childProcess && !childProcess.killed) {
        childProcess.kill();
      }
      notificationHandlers.clear();
      requestHandlers.clear();
      pendingRequests.clear();
      isInitialized = false;
      capabilities = undefined;
    },
  };

  function sendRequest(method: string, params: unknown): Promise<unknown> {
    const id = ++requestId;
    return new Promise<unknown>((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      try {
        sendMessage({
          jsonrpc: '2.0',
          id,
          method,
          params,
        });
      } catch (error) {
        pendingRequests.delete(id);
        reject(error);
      }

      // Timeout to prevent hanging requests
      setTimeout(() => {
        const pending = pendingRequests.get(id);
        if (pending) {
          pendingRequests.delete(id);
          pending.reject(new Error(`LSP request timed out: ${method}`));
        }
      }, 30000);
    });
  }

  function sendNotification(method: string, params: unknown): void {
    sendMessage({
      jsonrpc: '2.0',
      method,
      params,
    });
  }
}

function detectLanguage(uri: string): string {
  const ext = uri.split('.').pop()?.toLowerCase() || '';
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    json: 'json',
    md: 'markdown',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    css: 'css',
    html: 'html',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    sql: 'sql',
    sh: 'shellscript',
    bash: 'shellscript',
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    dart: 'dart',
    scala: 'scala',
    vue: 'vue',
    svelte: 'svelte',
  };
  return languageMap[ext] || 'plaintext';
}
