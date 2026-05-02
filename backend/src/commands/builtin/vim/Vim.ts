import type { CommandContext } from '../../types/index.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Vim命令
 * 提供Vim编辑器功能
 */
const vimCommand = {
  async call(args: string, context: CommandContext) {
    // 解析参数
    const params = args.trim().split(' ');
    const filePath = params[0];
    const options = params.slice(1);

    if (!filePath) {
      return {
        type: 'text' as const,
        value: '用法: /vim <文件路径> [选项]\n打开指定文件进行编辑\n\n选项:\n  --insert, -i  直接进入插入模式\n  --readonly, -r  只读模式\n  --line=<行号>, -l <行号>  跳转到指定行',
      };
    }

    try {
      const fullPath = path.resolve(filePath);
      let fileContent = '';
      let mode = 'normal'; // normal, insert, visual
      let currentLine = 1;
      let readonly = false;

      // 处理选项
      for (const option of options) {
        if (option === '--insert' || option === '-i') {
          mode = 'insert';
        } else if (option === '--readonly' || option === '-r') {
          readonly = true;
        } else if (option.startsWith('--line=') || option === '-l') {
          const lineIndex = options.indexOf(option);
          if (lineIndex + 1 < options.length) {
            currentLine = parseInt(options[lineIndex + 1], 10) || 1;
          } else if (option.startsWith('--line=')) {
            currentLine = parseInt(option.replace('--line=', ''), 10) || 1;
          }
        }
      }

      // 检查文件是否存在
      if (fs.existsSync(fullPath)) {
        fileContent = fs.readFileSync(fullPath, 'utf8');
      }

      // 计算文件行数
      const lines = fileContent.split('\n');
      const totalLines = lines.length;

      // 确保行号有效
      currentLine = Math.max(1, Math.min(currentLine, totalLines));

      // 构建Vim界面
      const vimInterface = this.buildVimInterface(
        fullPath,
        fileContent,
        mode,
        currentLine,
        totalLines,
        readonly
      );

      return {
        type: 'text' as const,
        value: vimInterface,
      };
    } catch (error) {
      return {
        type: 'text' as const,
        value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  /**
   * 构建Vim界面
   */
  buildVimInterface(
    filePath: string,
    content: string,
    mode: string,
    currentLine: number,
    totalLines: number,
    readonly: boolean
  ): string {
    const lines = content.split('\n');
    const header = `VIM - ${filePath}${readonly ? ' [只读]' : ''}`;
    const statusBar = `第 ${currentLine} 行, 共 ${totalLines} 行 [${mode.toUpperCase()}模式]`;
    
    // 构建文件内容显示
    let contentDisplay = '';
    for (let i = 0; i < lines.length; i++) {
      const lineNumber = i + 1;
      const lineContent = lines[i];
      const linePrefix = lineNumber === currentLine 
        ? `> ${lineNumber.toString().padStart(4)} | ` 
        : `  ${lineNumber.toString().padStart(4)} | `;
      contentDisplay += `${linePrefix}${lineContent}\n`;
    }

    // 构建帮助信息
    const helpInfo = `\nVim 命令帮助:\n` +
      `  i        - 进入插入模式\n` +
      `  Esc      - 返回普通模式\n` +
      `  :w       - 保存文件\n` +
      `  :q       - 退出\n` +
      `  :wq      - 保存并退出\n` +
      `  :q!      - 强制退出不保存\n` +
      `  dd       - 删除当前行\n` +
      `  yy       - 复制当前行\n` +
      `  p        - 粘贴\n` +
      `  /<搜索>  - 搜索\n` +
      `  n        - 下一个搜索结果\n` +
      `  N        - 上一个搜索结果\n` +
      `  :%s/old/new/g - 替换所有匹配\n`;

    return `${header}\n\n${contentDisplay}\n${statusBar}\n${helpInfo}`;
  },
};

export default vimCommand;
