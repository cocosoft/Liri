/**
 * Soul/User API 服务
 *
 * 提供读取/保存 AI 人格定义 (SOUL.md) 和用户身份 (USER.md) 的 API 调用。
 *
 * Phase 2.2: 端点从 /v1/soul、/v1/user 迁移到统一设置端点
 *   GET/PUT /v1/settings/soul 和 /v1/settings/user。
 *   存储后端从文件系统改为 ConfigManager。
 */

import { httpLegacy as http } from "./httpClient";

/** 新统一设置 API 响应结构 */
interface SettingsResponse {
  namespace: string;
  value: { content?: string };
}

/**
 * 读取 SOUL.md 人格定义
 */
export async function fetchSoul(): Promise<string> {
  const res = await http.get<SettingsResponse>("/v1/settings/soul");
  return res?.value?.content ?? "";
}

/**
 * 保存 SOUL.md 人格定义
 */
export async function saveSoul(content: string): Promise<boolean> {
  await http.put("/v1/settings/soul", { content });
  return true;
}

/**
 * 读取 USER.md 用户身份
 */
export async function fetchUser(): Promise<string> {
  const res = await http.get<SettingsResponse>("/v1/settings/user");
  return res?.value?.content ?? "";
}

/**
 * 保存 USER.md 用户身份
 */
export async function saveUser(content: string): Promise<boolean> {
  await http.put("/v1/settings/user", { content });
  return true;
}
