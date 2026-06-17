/**
 * 工具助手
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { Tool, ToolInfo } from '@modules/tools/types/Tool';
import { aiService } from '../services/aiService';
import { AIMessage, AIMessageRole, AIResponse } from '../models/types';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 工具推荐信息
 */
export interface ToolRecommendation {
  tool: Tool;
  reason: string;
  confidence: number;
}

/**
 * 参数填充建议
 */
export interface ParameterSuggestion {
  parameter: string;
  value: any;
  reason: string;
  confidence: number;
}

/**
 * 工具使用建议
 */
export interface ToolUsageSuggestion {
  toolName: string;
  parameters: Record<string, unknown>;
  description: string;
  expectedOutcome: string;
}

/**
 * 工具助手类
 */
export class ToolAssistant {
  private tools: Tool[] = [];
  private contextWindow: number = 4096;

  /**
   * 构造函数
   * @param tools 可用工具列表
   */
  constructor(tools: Tool[] = []) {
    this.tools = tools;
  }

  /**
   * 更新工具列表
   * @param tools 工具列表
   */
  setTools(tools: Tool[]): void {
    this.tools = tools;
  }

  /**
   * 添加工具
   * @param tool 工具
   */
  addTool(tool: Tool): void {
    this.tools.push(tool);
  }

  /**
   * 移除工具
   * @param toolName 工具名称
   */
  removeTool(toolName: string): void {
    this.tools = this.tools.filter((t) => t.name !== toolName);
  }

  /**
   * 推荐合适的工具
   * @param taskDescription 任务描述
   * @param limit 返回数量限制
   * @returns 工具推荐列表
   */
  async recommendTools(
    taskDescription: string,
    limit: number = 3
  ): Promise<ToolRecommendation[]> {
    if (this.tools.length === 0) {
      return [];
    }

    const toolsDescription = this.tools
      .map((tool) => {
        const info = tool.getInfo();
        return `- ${info.name}: ${info.description} (参数: ${info.params.map((p) => `${p.name}: ${p.type}`).join(', ')})`;
      })
      .join('\n');

    const systemPrompt = `你是一个工具推荐助手。根据用户任务描述，从给定的工具列表中推荐最合适的工具。

规则：
1. 只推荐真正需要的工具，避免过度使用
2. 根据工具的功能和参数选择最匹配的
3. 给出推荐理由和置信度（0-1）
4. 返回JSON格式的结果`;

    const userMessage = `任务描述：${taskDescription}

可用工具：
${toolsDescription}

请推荐最合适的工具（最多${limit}个），返回JSON格式：
[{"toolName": "工具名", "reason": "推荐理由", "confidence": 0.9}]`;

    const messages: AIMessage[] = [
      { role: AIMessageRole.SYSTEM, content: systemPrompt },
      { role: AIMessageRole.USER, content: userMessage },
    ];

    try {
      const response = await aiService.generate(messages, undefined, {
        temperature: 0.3,
        max_tokens: 500,
      });

      const recommendations = this.parseRecommendations(
        response.content,
        limit
      );
      return recommendations;
    } catch (error) {
      logger.error('工具推荐失败:', error);
      return [];
    }
  }

  /**
   * 填充工具参数
   * @param toolName 工具名称
   * @param taskDescription 任务描述
   * @param partialParams 部分参数
   * @returns 参数建议
   */
  async fillParameters(
    toolName: string,
    taskDescription: string,
    partialParams: Record<string, unknown> = {}
  ): Promise<ParameterSuggestion[]> {
    const tool = this.tools.find((t) => t.name === toolName);
    if (!tool) {
      return [];
    }

    const info = tool.getInfo();
    const missingParams = info.params.filter(
      (p) => !partialParams[p.name] && p.required
    );

    if (missingParams.length === 0) {
      return [];
    }

    const systemPrompt = `你是一个参数填充助手。根据任务描述和已提供的参数，推断出缺失的必需参数值。

规则：
1. 根据任务描述推断合理的参数值
2. 考虑参数的含义和约束条件
3. 给出推断理由和置信度（0-1）
4. 返回JSON格式的结果`;

    const userMessage = `工具名称：${info.name}
工具描述：${info.description}

必需参数：
${missingParams.map((p) => `- ${p.name}: ${p.description} (类型: ${p.type})`).join('\n')}

已提供的参数：
${Object.entries(partialParams)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n')}

任务描述：${taskDescription}

请推断缺失的参数值，返回JSON格式：
[{"parameter": "参数名", "value": "推断值", "reason": "推断理由", "confidence": 0.8}]`;

    const messages: AIMessage[] = [
      { role: AIMessageRole.SYSTEM, content: systemPrompt },
      { role: AIMessageRole.USER, content: userMessage },
    ];

    try {
      const response = await aiService.generate(messages, undefined, {
        temperature: 0.3,
        max_tokens: 500,
      });

      return this.parseParameterSuggestions(response.content);
    } catch (error) {
      logger.error('参数填充失败:', error);
      return [];
    }
  }

  /**
   * 生成工具使用建议
   * @param userIntent 用户意图
   * @returns 使用建议
   */
  async suggestToolUsage(
    userIntent: string
  ): Promise<ToolUsageSuggestion | null> {
    if (this.tools.length === 0) {
      return null;
    }

    const toolsDescription = this.tools
      .map((tool) => {
        const info = tool.getInfo();
        return `- ${info.name}: ${info.description}`;
      })
      .join('\n');

    const systemPrompt = `你是一个工具使用建议助手。根据用户意图，推荐合适的工具并给出参数建议。

规则：
1. 选择最匹配用户意图的工具
2. 提供合理的参数值
3. 描述预期的执行结果
4. 返回JSON格式的结果`;

    const userMessage = `用户意图：${userIntent}

可用工具：
${toolsDescription}

请给出工具使用建议，返回JSON格式：
{"toolName": "工具名", "parameters": {"参数": "值"}, "description": "操作描述", "expectedOutcome": "预期结果"}`;

    const messages: AIMessage[] = [
      { role: AIMessageRole.SYSTEM, content: systemPrompt },
      { role: AIMessageRole.USER, content: userMessage },
    ];

    try {
      const response = await aiService.generate(messages, undefined, {
        temperature: 0.3,
        max_tokens: 500,
      });

      return this.parseToolUsageSuggestion(response.content);
    } catch (error) {
      logger.error('工具使用建议生成失败:', error);
      return null;
    }
  }

  /**
   * 解析工具推荐结果
   * @param content AI响应内容
   * @param limit 数量限制
   * @returns 工具推荐列表
   */
  private parseRecommendations(
    content: string,
    limit: number
  ): ToolRecommendation[] {
    try {
      const jsonMatch = content.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed
          .slice(0, limit)
          .map((item: any) => {
            const tool = this.tools.find((t) => t.name === item.toolName);
            if (tool) {
              return {
                tool,
                reason: item.reason || '',
                confidence: item.confidence || 0.5,
              };
            }
            return null;
          })
          .filter((r: any) => r !== null);
      }
    } catch (error) {
      logger.error('解析工具推荐失败:', error);
    }
    return [];
  }

  /**
   * 解析参数建议
   * @param content AI响应内容
   * @returns 参数建议列表
   */
  private parseParameterSuggestions(content: string): ParameterSuggestion[] {
    try {
      const jsonMatch = content.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.map((item: any) => ({
          parameter: item.parameter || '',
          value: item.value,
          reason: item.reason || '',
          confidence: item.confidence || 0.5,
        }));
      }
    } catch (error) {
      logger.error('解析参数建议失败:', error);
    }
    return [];
  }

  /**
   * 解析工具使用建议
   * @param content AI响应内容
   * @returns 工具使用建议
   */
  private parseToolUsageSuggestion(
    content: string
  ): ToolUsageSuggestion | null {
    try {
      const jsonMatch = content.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          toolName: parsed.toolName || '',
          parameters: parsed.parameters || {},
          description: parsed.description || '',
          expectedOutcome: parsed.expectedOutcome || '',
        };
      }
    } catch (error) {
      logger.error('解析工具使用建议失败:', error);
    }
    return null;
  }
}

/**
 * 创建工具助手实例
 * @param tools 初始工具列表
 * @returns 工具助手实例
 */
export function createToolAssistant(tools: Tool[] = []): ToolAssistant {
  return new ToolAssistant(tools);
}

/**
 * 工具助手单例
 */
let toolAssistantInstance: ToolAssistant | null = null;

export function getToolAssistant(): ToolAssistant {
  if (!toolAssistantInstance) {
    toolAssistantInstance = new ToolAssistant();
  }
  return toolAssistantInstance;
}
