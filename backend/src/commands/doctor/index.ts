/**
 * doctor命令 - 系统诊断
 */

import { Command } from '../types/index';
import {
  getDiagnosticsService,
  DiagnosticLevel,
} from '../../diagnostics/DiagnosticsService';

/**
 * doctor命令实现
 */
const doctor: Command = {
  type: 'prompt',
  name: 'doctor',
  description: 'Diagnose system issues',
  loadedFrom: 'builtin',
  async getPromptForCommand(
    args: string
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const diagnostics = getDiagnosticsService();
    const results = await diagnostics.runAllDiagnostics();
    const summary = diagnostics.getSummary();

    const diagnosticsText = results
      .map((r) => {
        const levelIcon = {
          [DiagnosticLevel.INFO]: 'ℹ️',
          [DiagnosticLevel.WARNING]: '⚠️',
          [DiagnosticLevel.ERROR]: '❌',
          [DiagnosticLevel.CRITICAL]: '🚨',
        }[r.level];

        let text = `${levelIcon} [${r.level.toUpperCase()}] ${r.name}: ${r.message}`;
        if (r.suggestions && r.suggestions.length > 0) {
          text += `\n   建议: ${r.suggestions.join(', ')}`;
        }
        return text;
      })
      .join('\n');

    const prompt = `
      系统诊断报告:

      诊断摘要:
      - 总计: ${summary.total} 项
      - 信息: ${summary.byLevel[DiagnosticLevel.INFO] || 0} 项
      - 警告: ${summary.byLevel[DiagnosticLevel.WARNING] || 0} 项
      - 错误: ${summary.byLevel[DiagnosticLevel.ERROR] || 0} 项
      - 严重: ${summary.byLevel[DiagnosticLevel.CRITICAL] || 0} 项

      详细结果:
      ${diagnosticsText}

      请根据以上诊断结果，提供问题解决方案。

      用户参数: ${args}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default doctor;
