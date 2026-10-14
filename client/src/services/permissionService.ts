import { httpLegacy as http } from "./httpClient";
import { ENDPOINTS } from "./endpoints";

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

/** D 体系（细粒度权限）角色（P2-7 桥接） */
export interface PermissionRole {
  id: string;
  name: string;
  description?: string;
  permissionCount: number;
  createdAt: number;
  updatedAt: number;
}

/** D 体系（细粒度权限）用户（P2-7 桥接） */
export interface PermissionUser {
  id: string;
  name: string;
  roles: string[];
  permissionCount: number;
  createdAt: number;
  updatedAt: number;
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

  /** D 体系（细粒度权限）角色列表（P2-7） */
  async listRoles(): Promise<PermissionRole[]> {
    return http.get<PermissionRole[]>(ENDPOINTS.permissions.roles);
  },

  /** D 体系（细粒度权限）用户列表（P2-7） */
  async listUsers(): Promise<PermissionUser[]> {
    return http.get<PermissionUser[]>(ENDPOINTS.permissions.users);
  },

  /** D 体系（细粒度权限）更新用户角色（M0e：PUT /v1/permissions/users/{id}） */
  async updateUserRoles(userId: string, roles: string[]): Promise<void> {
    return http.put(ENDPOINTS.permissions.userById(userId), { roles });
  },

  /** D 体系（细粒度权限）资源列表（P2-7） */
  async listResources(): Promise<unknown[]> {
    return http.get<unknown[]>(ENDPOINTS.permissions.resources);
  },
};
