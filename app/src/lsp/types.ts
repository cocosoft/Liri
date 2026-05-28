// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export interface LocationLink {
  originSelectionRange?: Range;
  targetUri: string;
  targetRange: Range;
  targetSelectionRange: Range;
}

export interface Diagnostic {
  range: Range;
  severity?: DiagnosticSeverity;
  code?: string | number;
  source?: string;
  message: string;
  tags?: DiagnosticTag[];
  relatedInformation?: DiagnosticRelatedInformation[];
}

export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

export enum DiagnosticTag {
  Unnecessary = 1,
  Deprecated = 2,
}

export interface DiagnosticRelatedInformation {
  location: Location;
  message: string;
}

export interface DiagnosticFile {
  uri: string;
  diagnostics: Diagnostic[];
}

export interface CompletionItem {
  label: string;
  kind?: CompletionItemKind;
  detail?: string;
  documentation?: string | MarkupContent;
  insertText?: string;
  insertTextFormat?: InsertTextFormat;
  filterText?: string;
  sortText?: string;
  textEdit?: TextEdit;
  additionalTextEdits?: TextEdit[];
  command?: Command;
  data?: unknown;
}

export enum CompletionItemKind {
  Text = 1,
  Method = 2,
  Function = 3,
  Constructor = 4,
  Field = 5,
  Variable = 6,
  Class = 7,
  Interface = 8,
  Module = 9,
  Property = 10,
  Unit = 11,
  Value = 12,
  Enum = 13,
  Keyword = 14,
  Snippet = 15,
  Color = 16,
  File = 17,
  Reference = 18,
  Folder = 19,
  EnumMember = 20,
  Constant = 21,
  Struct = 22,
  Event = 23,
  Operator = 24,
  TypeParameter = 25,
}

export enum InsertTextFormat {
  PlainText = 1,
  Snippet = 2,
}

export interface TextEdit {
  range: Range;
  newText: string;
}

export interface MarkupContent {
  kind: MarkupKind;
  value: string;
}

export enum MarkupKind {
  PlainText = 'plaintext',
  Markdown = 'markdown',
}

export interface Hover {
  contents: MarkupContent | string | MarkedString[];
  range?: Range;
}

export interface MarkedString {
  language: string;
  value: string;
}

export interface SignatureHelp {
  signatures: SignatureInformation[];
  activeSignature?: number;
  activeParameter?: number;
}

export interface SignatureInformation {
  label: string;
  documentation?: string | MarkupContent;
  parameters?: ParameterInformation[];
}

export interface ParameterInformation {
  label: string;
  documentation?: string | MarkupContent;
}

export interface DocumentLink {
  range: Range;
  target?: string;
  tooltip?: string;
}

export interface DocumentHighlight {
  range: Range;
  kind?: DocumentHighlightKind;
}

export enum DocumentHighlightKind {
  Text = 1,
  Read = 2,
  Write = 3,
}

export interface SymbolInformation {
  name: string;
  kind: SymbolKind;
  location: Location;
  containerName?: string;
}

export enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

export interface CodeAction {
  title: string;
  kind?: CodeActionKind;
  diagnostics?: Diagnostic[];
  edit?: WorkspaceEdit;
  command?: Command;
}

export type CodeActionKind = string;

export interface WorkspaceEdit {
  changes?: Record<string, TextEdit[]>;
  documentChanges?: TextDocumentEdit[];
}

export interface TextDocumentEdit {
  textDocument: VersionedTextDocumentIdentifier;
  edits: TextEdit[];
}

export interface VersionedTextDocumentIdentifier {
  uri: string;
  version: number;
}

export interface Command {
  title: string;
  command: string;
  arguments?: unknown[];
}

export interface DocumentFormattingParams {
  tabSize: number;
  insertSpaces: boolean;
}

export interface ReferenceContext {
  includeDeclaration: boolean;
}

export type LspServerState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'error'
  | 'stopping';

export interface ScopedLspServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  workspaceFolder?: string;
  initializationOptions?: Record<string, unknown>;
  maxRestarts?: number;
  startupTimeout?: number;
}

export interface LSPClient {
  capabilities: Record<string, unknown>;
  serverConfig: LSPServerConfig;
  sendRequest(method: string, params?: unknown): Promise<unknown>;
  sendNotification(method: string, params?: unknown): void;
  onNotification(method: string, handler: (params: unknown) => void): void;
  close(): void;
}

export interface LSPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  languageId?: string;
}

export interface LSPConnection {
  client: LSPClient;
  serverCapabilities: Record<string, unknown>;
  isConnected: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
