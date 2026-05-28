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
export interface AgentStrategy {
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly model: string;
  readonly systemPrompt: string;
}

export interface AgentTask {
  id: string;
  type: string;
  description: string;
  input: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface AgentResponse {
  success: boolean;
  output: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentContext {
  sessionId: string;
  configuration: Record<string, unknown>;
  history: AgentTask[];
}

export type AgentState =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';
