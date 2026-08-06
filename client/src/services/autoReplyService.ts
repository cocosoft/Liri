import { httpLegacy as http } from "./httpClient";
import { handleClientError } from "../utils/handleError";

/** 匹配模式（与后端 StoredPattern 一致） */
export interface AutoReplyPattern {
  type: "regexp" | "substring";
  value: string;
  flags?: string;
}

/** 自动回复规则（对应后端 ReplyRule） */
export interface AutoReplyRule {
  id: string;
  name: string;
  pattern: AutoReplyPattern;
  response: string;
  priority: number;
  channel?: string;
  enabled: boolean;
  cooldown?: number;
}

/** 规则入参（创建/更新） */
export interface AutoReplyRuleInput {
  name: string;
  pattern: AutoReplyPattern;
  response: string;
  priority: number;
  enabled?: boolean;
  channel?: string;
  cooldown?: number;
}

/** 自动回复服务（S2：对应后端 /v1/auto-reply/rules） */
export const autoReplyService = {
  /** 列出规则 + 统计 */
  async listRules(): Promise<{
    rules: AutoReplyRule[];
    stats: {
      totalProcessed: number;
      matched: number;
      failed: number;
      ruleCount: number;
    };
  }> {
    try {
      return await http.get<{
        rules: AutoReplyRule[];
        stats: {
          totalProcessed: number;
          matched: number;
          failed: number;
          ruleCount: number;
        };
      }>("/v1/auto-reply/rules");
    } catch (e) {
      handleClientError(e, { module: "services:autoReply", action: "list" });
      throw e;
    }
  },

  /** 创建规则 */
  async createRule(rule: AutoReplyRuleInput): Promise<AutoReplyRule> {
    try {
      return await http.post<AutoReplyRule>("/v1/auto-reply/rules", rule);
    } catch (e) {
      handleClientError(e, { module: "services:autoReply", action: "create" });
      throw e;
    }
  },

  /** 更新规则 */
  async updateRule(
    ruleId: string,
    patch: Partial<AutoReplyRuleInput>,
  ): Promise<AutoReplyRule> {
    try {
      return await http.put<AutoReplyRule>(
        `/v1/auto-reply/rules/${ruleId}`,
        patch,
      );
    } catch (e) {
      handleClientError(e, { module: "services:autoReply", action: "update" });
      throw e;
    }
  },

  /** 删除规则 */
  async deleteRule(ruleId: string): Promise<void> {
    try {
      await http.delete(`/v1/auto-reply/rules/${ruleId}`);
    } catch (e) {
      handleClientError(e, { module: "services:autoReply", action: "delete" });
      throw e;
    }
  },
};
