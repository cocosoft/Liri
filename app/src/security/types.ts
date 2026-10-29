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
 * 安全模块类型定义
 */

export type RiskLevel = 'low' | 'medium' | 'high';

export type SecurityBehavior = 'allow' | 'deny' | 'ask';

export interface SecurityAnalysisResult {
  safe: boolean;
  behavior: SecurityBehavior;
  riskLevel: RiskLevel;
  message?: string;
  matchedPatterns: string[];
  /**
   * B3（2026-10-30，issue #37）：本次判定是否基于**只读族**放行
   * （`readonly-single` / `compound-readonly` / PowerShell 包裹委托）。
   *
   * 用途：`checkAstAndAnalyzer` 的"AST 解析不确定 ⇒ 转人工"分支据此**免 ask** ——
   * 只读族已由 argv 级判据确认无副作用，再弹卡只会让调用悬空（真机 6 次 ask 无人应答）。
   * 缺省 `undefined` ⇒ 维持原 fail-closed 转人工。
   */
  readOnly?: boolean;
}

export interface SecurityPattern {
  name: string;
  pattern: RegExp;
  message: string;
  riskLevel: RiskLevel;
  behavior: SecurityBehavior;
}

export interface SecurityCheckContext {
  command: string;
  baseCommand: string;
  shellType: 'bash' | 'zsh' | 'powershell' | 'unknown';
}

export interface SecurityDecision {
  allowed: boolean;
  reason?: string;
  securityAnalysis?: SecurityAnalysisResult;
  sandboxRequired: boolean;
  permissionBehavior: 'allow' | 'deny' | 'ask';
}
