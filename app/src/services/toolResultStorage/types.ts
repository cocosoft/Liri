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
export const BYTES_PER_TOKEN = 4;

export const DEFAULT_MAX_RESULT_SIZE_CHARS = 50000;

export const MAX_TOOL_RESULT_BYTES = 1_000_000;

export const MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 250_000;

export const TOOL_RESULTS_SUBDIR = 'tool-results';

export const PERSISTED_OUTPUT_TAG = '<persisted-output>';

export const PERSISTED_OUTPUT_CLOSING_TAG = '</persisted-output>';

export const TOOL_RESULT_CLEARED_MESSAGE = '[Old tool result content cleared]';

export const PREVIEW_SIZE_BYTES = 2000;

export type ContentReplacementState = {
  seenIds: Set<string>;
  replacements: Map<string, string>;
};

export type PersistedToolResult = {
  filepath: string;
  originalSize: number;
  isJson: boolean;
  preview: string;
  hasMore: boolean;
};

export type PersistToolResultError = {
  error: string;
};

export type ContentReplacementRecord = {
  kind: 'tool-result';
  toolUseId: string;
  replacement: string;
};

export type ToolResultReplacementRecord = Extract<
  ContentReplacementRecord,
  { kind: 'tool-result' }
>;

export type ToolResultCandidate = {
  toolUseId: string;
  content: string | Array<{ type: string; text?: string }>;
  size: number;
};

export type CandidatePartition = {
  mustReapply: Array<ToolResultCandidate & { replacement: string }>;
  frozen: ToolResultCandidate[];
  fresh: ToolResultCandidate[];
};
