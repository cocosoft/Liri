import { httpLegacy as http } from "./httpClient";
import { ENDPOINTS } from "./endpoints";

export interface PermissionRule {
  id: string;
  behavior: "allow" | "deny" | "ask";
  toolName: string;
  contentPattern?: string;
  /** PR-2：「始终允许」档的参数指纹摘要（存在 ⇒ 该规则只对同一指纹生效） */
  inputFingerprint?: string;
  source: string;
  priority: number;
  createdAt: string | null;
  updatedAt: string | null;
  /**
   * PR-2：settings 文件来源的规则（只读合并视图）。
   * 真实来源在 settings 文件里，面板只展示、不可经 `tool_rules.json` 接口删除。
   */
  readOnly?: boolean;
}

export interface PermissionRulesSummary {
  total: number;
  allow: number;
  deny: number;
  ask: number;
}

export interface PermissionRulesResponse {
  rules: PermissionRule[];
  summary: PermissionRulesSummary;
  /** 影子规则（遮蔽冲突）检测：deny/allow 规则互相遮蔽时提示，防止权限配置漏洞 */
  shadowDetection?: {
    shadowedCount: number;
    isValid: boolean;
    suggestions: string[];
    shadowedRules: Array<{
      reason: string;
      severity: "warning" | "error";
      shadowingIndex: number;
      shadowedRule: PermissionRule;
      shadowingRule: PermissionRule;
    }>;
  };
}

/** 工具权限规则管理（P1-5：对应后端 /v1/permissions/rules） */
export const permissionService = {
  async listRules(): Promise<PermissionRulesResponse> {
    return http.get<PermissionRulesResponse>(ENDPOINTS.permissions.rules);
  },

  async addRule(
    behavior: "allow" | "deny" | "ask",
    toolName: string,
    contentPattern?: string,
  ): Promise<void> {
    return http.post(ENDPOINTS.permissions.rules, {
      behavior,
      toolName,
      contentPattern,
    });
  },

  async deleteRule(ruleId: string): Promise<void> {
    return http.delete(ENDPOINTS.permissions.ruleById(ruleId));
  },
};
