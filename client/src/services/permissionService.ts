import { httpLegacy as http } from "./httpClient";

export interface PermissionRule {
  id: string;
  behavior: "allow" | "deny" | "ask";
  toolName: string;
  contentPattern?: string;
  source: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
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
}

/** 工具权限规则管理（P1-5：对应后端 /v1/permissions/rules） */
export const permissionService = {
  async listRules(): Promise<PermissionRulesResponse> {
    return http.get<PermissionRulesResponse>("/v1/permissions/rules");
  },

  async addRule(
    behavior: "allow" | "deny" | "ask",
    toolName: string,
    contentPattern?: string,
  ): Promise<void> {
    return http.post("/v1/permissions/rules", {
      behavior,
      toolName,
      contentPattern,
    });
  },

  async deleteRule(ruleId: string): Promise<void> {
    return http.delete(`/v1/permissions/rules/${ruleId}`);
  },
};
