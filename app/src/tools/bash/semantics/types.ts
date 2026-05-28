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
/**
 * Bash命令语义分析类型定义
 * 用于UI折叠显示和安全决策
 */

export type BashCommandType =
  | 'search'
  | 'read'
  | 'list'
  | 'silent'
  | 'neutral'
  | 'other'
  | 'unknown';

export interface BashCommandClassification {
  type: BashCommandType;
  isSearch: boolean;
  isRead: boolean;
  isList: boolean;
  isSemanticNeutral: boolean;
  isSilent: boolean;
}

export interface BashCommandAnalysisResult {
  classification: BashCommandClassification;
  isCollapsible: boolean;
  summary: string;
}
