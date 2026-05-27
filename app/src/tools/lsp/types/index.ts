/**
 * LSP工具类型定义 - 整合所有类型到单一文件避免循环导入问题
 */

// 基础类型定义
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

export enum ServerStatus {
  STOPPED = 'stopped',
  STARTING = 'starting',
  RUNNING = 'running',
  ERROR = 'error',
}

// 补全相关类型
export enum CompletionItemKind {
  TEXT = 1,
  METHOD = 2,
  FUNCTION = 3,
  CONSTRUCTOR = 4,
  FIELD = 5,
  VARIABLE = 6,
  CLASS = 7,
  INTERFACE = 8,
  MODULE = 9,
  PROPERTY = 10,
  UNIT = 11,
  VALUE = 12,
  ENUM = 13,
  KEYWORD = 14,
  SNIPPET = 15,
  COLOR = 16,
  FILE = 17,
  REFERENCE = 18,
  FOLDER = 19,
  ENUM_MEMBER = 20,
  CONSTANT = 21,
  STRUCT = 22,
  EVENT = 23,
  OPERATOR = 24,
  TYPE_PARAMETER = 25,
}

export interface TextEdit {
  range: Range;
  newText: string;
}

export enum CompletionTriggerKind {
  INVOKED = 1,
  TRIGGER_CHARACTER = 2,
  TRIGGER_FOR_INCOMPLETE_COMPLETIONS = 3,
}

export interface CompletionContext {
  triggerCharacter?: string;
  triggerKind?: CompletionTriggerKind;
}

export interface CompletionItem {
  label: string;
  detail?: string;
  documentation?: string;
  insertText: string;
  kind?: CompletionItemKind;
  sortText?: string;
  filterText?: string;
  textEdit?: TextEdit;
}

export interface CompletionList {
  items: CompletionItem[];
  isIncomplete?: boolean;
}

// 诊断相关类型
export enum DiagnosticSeverity {
  ERROR = 1,
  WARNING = 2,
  INFORMATION = 3,
  HINT = 4,
}

export enum DiagnosticTag {
  UNNECESSARY = 1,
  DEPRECATED = 2,
}

export interface DiagnosticRelatedInformation {
  location: Location;
  message: string;
}

export interface Diagnostic {
  range: Range;
  severity?: DiagnosticSeverity;
  code?: string | number;
  source?: string;
  message: string;
  relatedInformation?: DiagnosticRelatedInformation[];
  tags?: DiagnosticTag[];
}

export interface DiagnosticCollection {
  uri: string;
  diagnostics: Diagnostic[];
}

// LSPTool 接口
export interface LSPTool {
  startServer(): Promise<void>;
  stopServer(): Promise<void>;
  sendRequest(method: string, params: any): Promise<unknown>;
  getCompletions(
    document: string,
    position: Position
  ): Promise<CompletionItem[]>;
  getDefinition(document: string, position: Position): Promise<Location[]>;
  getReferences(document: string, position: Position): Promise<Location[]>;
  getDiagnostics(document: string): Promise<Diagnostic[]>;
  formatDocument(document: string): Promise<string>;
  getServerStatus(): ServerStatus;
  restartServer(): Promise<void>;
}
