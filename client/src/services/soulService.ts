/**
 * Soul/User API 服务
 *
 * 提供读取/保存 AI 人格定义 (SOUL.md) 和用户身份 (USER.md) 的 API 调用
 */

import { http } from "./httpClient";

/** API 响应中 content 字段结构 */
interface ContentResponse {
  data: { content: string };
}

/** API 响应中通用结构 */
interface SimpleResponse {
  data: { success: boolean };
}

/**
 * 读取 SOUL.md 人格定义
 */
export async function fetchSoul(): Promise<string> {
  const res = await http.get<ContentResponse>("/v1/soul");
  return res?.data?.content ?? "";
}

/**
 * 保存 SOUL.md 人格定义
 */
export async function saveSoul(content: string): Promise<boolean> {
  const res = await http.put<SimpleResponse>("/v1/soul", { content });
  return res?.data?.success ?? false;
}

/**
 * 读取 USER.md 用户身份
 */
export async function fetchUser(): Promise<string> {
  const res = await http.get<ContentResponse>("/v1/user");
  return res?.data?.content ?? "";
}

/**
 * 保存 USER.md 用户身份
 */
export async function saveUser(content: string): Promise<boolean> {
  const res = await http.put<SimpleResponse>("/v1/user", { content });
  return res?.data?.success ?? false;
}
