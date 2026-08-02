/**
 * 代码分析工具
 * 用于分析代码结构、质量和依赖关系
 */
import { Tool, ToolInfo, ToolTag, ToolCallProgress } from '../types/Tool';
import {
  ToolResult,
  createToolResult,
  ToolExecutionStatus,
} from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { createFailureResult } from '../utils/ToolUtils';
import * as fs from 'fs';
import * as path from 'path';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools:CodeAnalysisTool:CodeAnalysisTool',
  level: LogLevel.INFO,
});

/**
 * 代码分析工具输入
 */
interface CodeAnalysisInput {
  /** 分析目标路径 */
  target: string;
  /** 分析类型：structure, complexity, dependencies, quality */
  analysisType: 'structure' | 'complexity' | 'dependencies' | 'quality';
  /** 是否递归分析 */
  recursive?: boolean;
  /** 文件扩展名过滤 */
  extensions?: string[];
  /** 最大分析文件数 */
  maxFiles?: number;
}

/**
 * 代码分析工具输出
 */
interface CodeAnalysisOutput {
  /** 分析结果 */
  analysis: {
    type: string;
    stats: Record<string, unknown>;
    details?: any;
  };
  /** 分析的文件数 */
  filesAnalyzed: number;
  /** 分析耗时（毫秒） */
  analysisTime: number;
}

/**
 * 代码分析工具
 */
export class CodeAnalysisTool implements Tool {
  /** 工具信息 */
  private info: ToolInfo;
  name: string = 'code_analysis';
  description: string = '分析代码结构、质量和依赖关系';
  params: any[] = [];

  constructor() {
    this.info = {
      name: 'code_analysis',
      description: '分析代码结构、质量和依赖关系',
      enabled: true,
      readOnly: true,
      destructive: false,
      concurrencySafe: true,
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'block',
      maxResultSizeChars: 50000,
      tags: [ToolTag.CODE, ToolTag.READ],
      params: [
        {
          name: 'target',
          type: 'string',
          description: '分析目标路径',
          required: true,
        },
        {
          name: 'analysisType',
          type: 'string',
          description: '分析类型: structure, complexity, dependencies, quality',
          required: true,
        },
        {
          name: 'recursive',
          type: 'boolean',
          description: '是否递归分析',
          required: false,
          default: true,
        },
        {
          name: 'extensions',
          type: 'array',
          description: '文件扩展名过滤',
          required: false,
        },
        {
          name: 'maxFiles',
          type: 'number',
          description: '最大分析文件数',
          required: false,
          default: 100,
        },
      ],
    };
  }

  /**
   * 获取工具信息
   */
  getInfo(): ToolInfo {
    return this.info;
  }

  /**
   * 检查工具是否启用
   */
  isEnabled(): boolean {
    return true;
  }

  /**
   * 检查工具是否只读
   */
  isReadOnly(_input?: Record<string, unknown>): boolean {
    return true;
  }

  /**
   * 检查工具是否破坏性操作
   */
  isDestructive(_input?: Record<string, unknown>): boolean {
    return false;
  }

  /**
   * 检查工具是否并发安全
   */
  isConcurrencySafe(_input?: Record<string, unknown>): boolean {
    return true;
  }

  /**
   * 验证输入参数
   */
  validateInput(
    input: Record<string, unknown>
  ): { result: true } | { result: false; message: string; errorCode?: number } {
    if (!input.target || typeof input.target !== 'string') {
      return {
        result: false,
        message: 'target is required and must be a string',
      };
    }
    if (!input.analysisType || typeof input.analysisType !== 'string') {
      return {
        result: false,
        message: 'analysisType is required and must be a string',
      };
    }
    return { result: true };
  }

  /**
   * 检查权限
   */
  async checkPermissions(
    input: Record<string, unknown>,
    context: ToolUseContext
  ): Promise<{ behavior: 'allow' | 'deny' | 'ask'; message?: string }> {
    return { behavior: 'allow' };
  }

  /**
   * 执行工具
   * @param input 工具输入
   * @param context 工具使用上下文
   * @param onProgress 进度回调
   * @returns 工具执行结果
   */
  async execute(
    input: Record<string, unknown>,
    context?: ToolUseContext,
    onProgress?: ToolCallProgress
  ): Promise<ToolResult<unknown>> {
    const startTime = Date.now();
    const analysisInput = input as unknown as CodeAnalysisInput;

    try {
      // 验证输入
      if (!analysisInput.target) {
        return createFailureResult('Target path is required');
      }

      if (!analysisInput.analysisType) {
        return createFailureResult('Analysis type is required');
      }

      // 检查目标路径是否存在
      if (!fs.existsSync(analysisInput.target)) {
        return createFailureResult(
          `Target path does not exist: ${analysisInput.target}`
        );
      }

      // 收集文件
      const files = await this.collectFiles(
        analysisInput.target,
        analysisInput.recursive ?? true,
        analysisInput.extensions,
        analysisInput.maxFiles ?? 100
      );

      if (files.length === 0) {
        return createFailureResult('No files found for analysis');
      }

      // 执行分析
      let analysisResult;
      switch (analysisInput.analysisType) {
        case 'structure':
          analysisResult = await this.analyzeStructure(files);
          break;
        case 'complexity':
          analysisResult = await this.analyzeComplexity(files);
          break;
        case 'dependencies':
          analysisResult = await this.analyzeDependencies(files);
          break;
        case 'quality':
          analysisResult = await this.analyzeQuality(files);
          break;
        default:
          return createFailureResult(
            `Invalid analysis type: ${analysisInput.analysisType}`
          );
      }

      const analysisTime = Date.now() - startTime;
      const output: CodeAnalysisOutput = {
        analysis: analysisResult as CodeAnalysisOutput['analysis'],
        filesAnalyzed: files.length,
        analysisTime,
      };

      return {
        status: ToolExecutionStatus.SUCCESS,
        result: output,
        error: undefined,
        executionTime: analysisTime,
        output: JSON.stringify(output),
        errorOutput: '',
        progress: [],
        metadata: {},
        executionId: `exec_${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    } catch (error: unknown) {
      return createFailureResult(
        `Analysis failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 收集文件
   * @param target 目标路径
   * @param recursive 是否递归
   * @param extensions 文件扩展名
   * @param maxFiles 最大文件数
   * @returns 文件列表
   */
  private async collectFiles(
    target: string,
    recursive: boolean,
    extensions?: string[],
    maxFiles: number = 100
  ): Promise<string[]> {
    const files: string[] = [];
    const queue: string[] = [target];

    while (queue.length > 0 && files.length < maxFiles) {
      const current = queue.shift()!;
      const stats = fs.statSync(current);

      if (stats.isDirectory() && recursive) {
        const entries = fs.readdirSync(current);
        for (const entry of entries) {
          const fullPath = path.join(current, entry);
          queue.push(fullPath);
        }
      } else if (stats.isFile()) {
        if (!extensions || extensions.some((ext) => current.endsWith(ext))) {
          files.push(current);
        }
      }
    }

    return files;
  }

  /**
   * 分析代码结构
   * @param files 文件列表
   * @returns 分析结果
   */
  private async analyzeStructure(files: string[]): Promise<unknown> {
    const stats = {
      totalFiles: files.length,
      totalLines: 0,
      fileTypes: {} as Record<string, number>,
      largestFile: { path: '', lines: 0 },
      smallestFile: { path: '', lines: Number.MAX_SAFE_INTEGER },
    };

    for (const file of files) {
      const ext = path.extname(file);
      stats.fileTypes[ext] = (stats.fileTypes[ext] || 0) + 1;

      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n').length;
      stats.totalLines += lines;

      if (lines > stats.largestFile.lines) {
        stats.largestFile = { path: file, lines };
      }

      if (lines < stats.smallestFile.lines) {
        stats.smallestFile = { path: file, lines };
      }
    }

    return {
      type: 'structure',
      stats,
    };
  }

  /**
   * 分析代码复杂度
   * @param files 文件列表
   * @returns 分析结果
   */
  private async analyzeComplexity(files: string[]): Promise<unknown> {
    const stats = {
      averageLinesPerFile: 0,
      filesWithHighComplexity: 0,
      totalFunctions: 0,
      complexFunctions: 0,
    };

    let totalLines = 0;

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n').length;
      totalLines += lines;

      // 简单的复杂度分析
      const functionMatches = content.match(
        /function\s+\w+|const\s+\w+\s*=\s*\(.*?\)\s*=>|class\s+\w+/g
      );
      if (functionMatches) {
        stats.totalFunctions += functionMatches.length;
        // 简单判断：函数体超过20行认为复杂度高
        if (lines > 50) {
          stats.filesWithHighComplexity++;
        }
      }
    }

    stats.averageLinesPerFile = totalLines / files.length;

    return {
      type: 'complexity',
      stats,
    };
  }

  /**
   * 分析依赖关系
   * @param files 文件列表
   * @returns 分析结果
   */
  private async analyzeDependencies(files: string[]): Promise<unknown> {
    const dependencies: Record<string, string[]> = {};
    const imports: Record<string, number> = {};

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      // 简单的import分析
      const importMatches = content.match(/import\s+.*?from\s+['"](.*?)['"]/g);
      if (importMatches) {
        const fileDeps: string[] = [];
        for (const match of importMatches) {
          const depMatch = match.match(/from\s+['"](.*?)['"]/);
          if (depMatch && depMatch[1]) {
            const dep = depMatch[1];
            fileDeps.push(dep);
            imports[dep] = (imports[dep] || 0) + 1;
          }
        }
        dependencies[file] = fileDeps;
      }
    }

    return {
      type: 'dependencies',
      stats: {
        totalDependencies: Object.keys(imports).length,
        mostUsedDependencies: Object.entries(imports)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
      },
      details: {
        fileDependencies: dependencies,
      },
    };
  }

  /**
   * 分析代码质量
   * @param files 文件列表
   * @returns 分析结果
   */
  private async analyzeQuality(files: string[]): Promise<unknown> {
    const issues = {
      missingComments: 0,
      longLines: 0,
      trailingSpaces: 0,
      inconsistentIndentation: 0,
    };

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 检查长行
        if (line.length > 120) {
          issues.longLines++;
        }

        // 检查尾随空格
        if (line.match(/\s+$/)) {
          issues.trailingSpaces++;
        }

        // 检查缩进一致性（简单检查）
        if (i > 0 && line.trim() && lines[i - 1].trim()) {
          const currentIndent = line.match(/^\s*/)?.[0].length || 0;
          const prevIndent = lines[i - 1].match(/^\s*/)?.[0].length || 0;
          if (Math.abs(currentIndent - prevIndent) > 4) {
            issues.inconsistentIndentation++;
          }
        }
      }

      // 检查文件头部注释
      if (!lines[0]?.startsWith('/**') && !lines[0]?.startsWith('//')) {
        issues.missingComments++;
      }
    }

    return {
      type: 'quality',
      stats: {
        totalIssues: Object.values(issues).reduce(
          (sum, count) => sum + count,
          0
        ),
        ...issues,
      },
    };
  }
}

/**
 * 创建代码分析工具实例
 * @returns 代码分析工具实例
 */
export function createCodeAnalysisTool(): Tool {
  return new CodeAnalysisTool();
}
