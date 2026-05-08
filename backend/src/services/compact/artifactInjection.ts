//
/**
 * 制品注入实现（基于CC源码）
 * 支持压缩后注入计划/文件/MCP制品、记忆制品、技能制品
 */

import type { SessionMessage } from '@modules/session/models/SessionMessage';

/**
 * 制品类型（来自CC源码）
 */
export type ArtifactType = 
  | 'plan' 
  | 'file' 
  | 'mcp_instruction' 
  | 'memory' 
  | 'skill' 
  | 'tool' 
  | 'agent_listing';

/**
 * 制品接口（来自CC源码）
 */
export interface Artifact {
  /**
   * 制品ID
   */
  id: string;
  
  /**
   * 制品类型
   */
  type: ArtifactType;
  
  /**
   * 制品内容
   */
  content: string;
  
  /**
   * 元数据
   */
  metadata?: Record<string, any>;
  
  /**
   * 创建时间
   */
  createdAt: Date;
  
  /**
   * 更新时间
   */
  updatedAt: Date;
}

/**
 * 制品注入上下文（来自CC源码）
 */
export interface ArtifactInjectionContext {
  /**
   * 会话ID
   */
  sessionId: string;
  
  /**
   * 压缩前的消息
   */
  preCompactMessages: SessionMessage[];
  
  /**
   * 压缩后的消息
   */
  postCompactMessages: SessionMessage[];
  
  /**
   * 压缩类型
   */
  compactType: 'full' | 'partial' | 'reactive' | 'auto';
  
  /**
   * 模型名称
   */
  model: string;
  
  /**
   * 文件状态缓存
   */
  fileStateCache?: Map<string, any>;
  
  /**
   * 已加载的记忆路径
   */
  loadedMemoryPaths?: Set<string>;
  
  /**
   * 已发送的技能名称
   */
  sentSkillNames?: Set<string>;
  
  /**
   * 代理ID
   */
  agentId?: string;
  
  /**
   * 工具配置
   */
  tools?: any[];
  
  /**
   * MCP客户端
   */
  mcpClients?: any[];
}

/**
 * 制品注入选项（来自CC源码）
 */
export interface ArtifactInjectionOptions {
  /**
   * 最大文件恢复数量
   */
  maxFilesToRestore: number;
  
  /**
   * 制品token预算
   */
  artifactTokenBudget: number;
  
  /**
   * 每个文件的最大token数
   */
  maxTokensPerFile: number;
  
  /**
   * 每个技能的最大token数
   */
  maxTokensPerSkill: number;
  
  /**
   * 技能token预算
   */
  skillsTokenBudget: number;
  
  /**
   * 是否启用计划模式
   */
  enablePlanMode: boolean;
  
  /**
   * 是否启用技能搜索
   */
  enableSkillSearch: boolean;
}

/**
 * 制品注入结果（来自CC源码）
 */
export interface ArtifactInjectionResult {
  /**
   * 注入的制品
   */
  artifacts: Artifact[];
  
  /**
   * 生成的消息
   */
  messages: SessionMessage[];
  
  /**
   * 使用的token数量
   */
  tokenUsage: number;
  
  /**
   * 注入是否成功
   */
  success: boolean;
  
  /**
   * 错误信息
   */
  error?: string;
}

/**
 * 制品注入服务类（基于CC源码实现）
 */
export class ArtifactInjectionService {
  private defaultOptions: ArtifactInjectionOptions = {
    maxFilesToRestore: 5,
    artifactTokenBudget: 50000,
    maxTokensPerFile: 5000,
    maxTokensPerSkill: 5000,
    skillsTokenBudget: 25000,
    enablePlanMode: true,
    enableSkillSearch: false,
  };

  /**
   * 注入压缩后制品（来自CC源码）
   */
  async injectPostCompactArtifacts(
    context: ArtifactInjectionContext,
    options: Partial<ArtifactInjectionOptions> = {}
  ): Promise<ArtifactInjectionResult> {
    const mergedOptions = { ...this.defaultOptions, ...options };
    const artifacts: Artifact[] = [];
    const messages: SessionMessage[] = [];
    let totalTokenUsage = 0;

    try {
      // 注入文件制品
      const fileArtifacts = await this.injectFileArtifacts(context, mergedOptions);
      artifacts.push(...fileArtifacts.artifacts);
      totalTokenUsage += fileArtifacts.tokenUsage;

      // 注入计划制品
      if (mergedOptions.enablePlanMode) {
        const planArtifacts = await this.injectPlanArtifacts(context, mergedOptions);
        artifacts.push(...planArtifacts.artifacts);
        totalTokenUsage += planArtifacts.tokenUsage;
      }

      // 注入MCP指令制品
      const mcpArtifacts = await this.injectMcpArtifacts(context, mergedOptions);
      artifacts.push(...mcpArtifacts.artifacts);
      totalTokenUsage += mcpArtifacts.tokenUsage;

      // 注入记忆制品
      const memoryArtifacts = await this.injectMemoryArtifacts(context, mergedOptions);
      artifacts.push(...memoryArtifacts.artifacts);
      totalTokenUsage += memoryArtifacts.tokenUsage;

      // 注入技能制品
      if (mergedOptions.enableSkillSearch) {
        const skillArtifacts = await this.injectSkillArtifacts(context, mergedOptions);
        artifacts.push(...skillArtifacts.artifacts);
        totalTokenUsage += skillArtifacts.tokenUsage;
      }

      // 生成制品消息
      const artifactMessages = this.createArtifactMessages(artifacts);
      messages.push(...artifactMessages);

      return {
        artifacts,
        messages,
        tokenUsage: totalTokenUsage,
        success: true,
      };

    } catch (error) {
      return {
        artifacts: [],
        messages: [],
        tokenUsage: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 注入文件制品（来自CC源码）
   */
  private async injectFileArtifacts(
    context: ArtifactInjectionContext,
    options: ArtifactInjectionOptions
  ): Promise<ArtifactInjectionResult> {
    const artifacts: Artifact[] = [];
    let tokenUsage = 0;

    try {
      // 简化实现：从文件状态缓存中恢复文件
      if (context.fileStateCache) {
        const fileEntries = Array.from(context.fileStateCache.entries())
          .slice(0, options.maxFilesToRestore);

        for (const [filePath, fileContent] of fileEntries) {
          const content = this.truncateContent(fileContent, options.maxTokensPerFile);
          const artifact: Artifact = {
            id: `file_${Date.now()}_${artifacts.length}`,
            type: 'file',
            content: `File: ${filePath}\n\n${content}`,
            metadata: { filePath },
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          artifacts.push(artifact);
          tokenUsage += this.estimateTokenCount(content);

          // 检查token预算
          if (tokenUsage >= options.artifactTokenBudget) {
            break;
          }
        }
      }

      return {
        artifacts,
        messages: [],
        tokenUsage,
        success: true,
      };

    } catch (error) {
      return {
        artifacts: [],
        messages: [],
        tokenUsage: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 注入计划制品（来自CC源码）
   */
  private async injectPlanArtifacts(
    context: ArtifactInjectionContext,
    options: ArtifactInjectionOptions
  ): Promise<ArtifactInjectionResult> {
    const artifacts: Artifact[] = [];

    try {
      // 简化实现：创建计划制品
      const planContent = this.generatePlanContent(context);
      
      if (planContent) {
        const artifact: Artifact = {
          id: `plan_${Date.now()}`,
          type: 'plan',
          content: planContent,
          metadata: { agentId: context.agentId },
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        artifacts.push(artifact);
      }

      return {
        artifacts,
        messages: [],
        tokenUsage: this.estimateTokenCount(planContent || ''),
        success: true,
      };

    } catch (error) {
      return {
        artifacts: [],
        messages: [],
        tokenUsage: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 注入MCP指令制品（来自CC源码）
   */
  private async injectMcpArtifacts(
    context: ArtifactInjectionContext,
    options: ArtifactInjectionOptions
  ): Promise<ArtifactInjectionResult> {
    const artifacts: Artifact[] = [];

    try {
      // 简化实现：生成MCP指令制品
      if (context.mcpClients && context.mcpClients.length > 0) {
        const mcpContent = this.generateMcpContent(context);
        
        const artifact: Artifact = {
          id: `mcp_${Date.now()}`,
          type: 'mcp_instruction',
          content: mcpContent,
          metadata: { clientCount: context.mcpClients.length },
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        artifacts.push(artifact);
      }

      return {
        artifacts,
        messages: [],
        tokenUsage: this.estimateTokenCount(artifacts[0]?.content || ''),
        success: true,
      };

    } catch (error) {
      return {
        artifacts: [],
        messages: [],
        tokenUsage: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 注入记忆制品（来自CC源码）
   */
  private async injectMemoryArtifacts(
    context: ArtifactInjectionContext,
    options: ArtifactInjectionOptions
  ): Promise<ArtifactInjectionResult> {
    const artifacts: Artifact[] = [];

    try {
      // 简化实现：生成记忆制品
      if (context.loadedMemoryPaths && context.loadedMemoryPaths.size > 0) {
        const memoryContent = this.generateMemoryContent(context);
        
        const artifact: Artifact = {
          id: `memory_${Date.now()}`,
          type: 'memory',
          content: memoryContent,
          metadata: { pathCount: context.loadedMemoryPaths.size },
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        artifacts.push(artifact);
      }

      return {
        artifacts,
        messages: [],
        tokenUsage: this.estimateTokenCount(artifacts[0]?.content || ''),
        success: true,
      };

    } catch (error) {
      return {
        artifacts: [],
        messages: [],
        tokenUsage: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 注入技能制品（来自CC源码）
   */
  private async injectSkillArtifacts(
    context: ArtifactInjectionContext,
    options: ArtifactInjectionOptions
  ): Promise<ArtifactInjectionResult> {
    const artifacts: Artifact[] = [];
    let tokenUsage = 0;

    try {
      // 简化实现：生成技能制品
      if (context.sentSkillNames && context.sentSkillNames.size > 0) {
        const skillNames = Array.from(context.sentSkillNames);
        
        for (const skillName of skillNames) {
          const skillContent = this.generateSkillContent(skillName);
          const truncatedContent = this.truncateContent(skillContent, options.maxTokensPerSkill);
          
          const artifact: Artifact = {
            id: `skill_${Date.now()}_${artifacts.length}`,
            type: 'skill',
            content: truncatedContent,
            metadata: { skillName },
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          artifacts.push(artifact);
          tokenUsage += this.estimateTokenCount(truncatedContent);

          // 检查技能token预算
          if (tokenUsage >= options.skillsTokenBudget) {
            break;
          }
        }
      }

      return {
        artifacts,
        messages: [],
        tokenUsage,
        success: true,
      };

    } catch (error) {
      return {
        artifacts: [],
        messages: [],
        tokenUsage: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 生成计划内容（简化实现）
   */
  private generatePlanContent(context: ArtifactInjectionContext): string {
    return `Plan mode is active. Current agent: ${context.agentId || 'unknown'}`;
  }

  /**
   * 生成MCP内容（简化实现）
   */
  private generateMcpContent(context: ArtifactInjectionContext): string {
    return `MCP clients active: ${context.mcpClients?.length || 0}`;
  }

  /**
   * 生成记忆内容（简化实现）
   */
  private generateMemoryContent(context: ArtifactInjectionContext): string {
    return `Loaded memory paths: ${context.loadedMemoryPaths?.size || 0}`;
  }

  /**
   * 生成技能内容（简化实现）
   */
  private generateSkillContent(skillName: string): string {
    return `Skill: ${skillName}\nDescription: This skill is available for use.`;
  }

  /**
   * 创建制品消息（来自CC源码）
   */
  private createArtifactMessages(artifacts: Artifact[]): SessionMessage[] {
    const messages: SessionMessage[] = [];

    for (const artifact of artifacts) {
      const message: SessionMessage = {
        id: `artifact_${artifact.id}`,
        sessionId: '', // 将在调用处设置
        type: 'system',
        content: `[${artifact.type.toUpperCase()}] ${artifact.content}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      messages.push(message);
    }

    return messages;
  }

  /**
   * 截断内容（来自CC源码）
   */
  private truncateContent(content: string, maxTokens: number): string {
    // 简化实现：按字符数截断
    const maxChars = maxTokens * 4; // 粗略估计：1 token ≈ 4字符
    
    if (content.length <= maxChars) {
      return content;
    }

    return content.substring(0, maxChars) + '... [truncated]';
  }

  /**
   * 估计token数量（简化实现）
   */
  private estimateTokenCount(content: string): number {
    // 简化实现：按字符数估计
    return Math.ceil(content.length / 4);
  }
}