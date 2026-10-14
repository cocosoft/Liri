/**
 * 用户服务：伙伴系统 + Soul/User 身份 API
 *
 * 由 buddyService + soulService 归并（GR15-001）。
 * 提供伙伴交互（/v1/buddy/*）与 AI 人格/用户身份（/v1/settings/soul、/v1/settings/user）API 调用。
 */

import { httpLegacy as http } from "./httpClient";
import type { BuddyCompanion, BuddyInteractionResult } from "../types";
import { ENDPOINTS } from "./endpoints";

/** 新统一设置 API 响应结构 */
interface SettingsResponse {
  namespace: string;
  value: { content?: string };
}

/**
 * 读取 SOUL.md 人格定义
 */
export async function fetchSoul(): Promise<string> {
  const res = await http.get<SettingsResponse>(ENDPOINTS.settings.soul);
  return res?.value?.content ?? "";
}

/**
 * 保存 SOUL.md 人格定义
 */
export async function saveSoul(content: string): Promise<boolean> {
  await http.put(ENDPOINTS.settings.soul, { content });
  return true;
}

/**
 * 读取 USER.md 用户身份
 */
export async function fetchUser(): Promise<string> {
  const res = await http.get<SettingsResponse>(ENDPOINTS.settings.user);
  return res?.value?.content ?? "";
}

/**
 * 保存 USER.md 用户身份
 */
export async function saveUser(content: string): Promise<boolean> {
  await http.put(ENDPOINTS.settings.user, { content });
  return true;
}

export const buddyService = {
  getBuddy: async (name?: string): Promise<BuddyCompanion> => {
    const params = name ? `?name=${encodeURIComponent(name)}` : "";
    return http.get<BuddyCompanion>(`${ENDPOINTS.buddy.companion}${params}`);
  },

  interact: async (
    action: string,
    name?: string,
  ): Promise<BuddyInteractionResult> => {
    return http.post<BuddyInteractionResult>(ENDPOINTS.buddy.interact, {
      action,
      name,
    });
  },

  getStats: async (): Promise<{
    interactions: number;
    dreamsCompleted: number;
    totalXp: number;
  }> => {
    return http.get(ENDPOINTS.buddy.stats);
  },
};
