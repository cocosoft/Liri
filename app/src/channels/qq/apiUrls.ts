/**
 * apiUrls.ts — QQ 出站 target 解析与 API URL 构造（纯函数）
 *
 * 由 `QQChannel.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §40）：**只搬不改**（含全部原注释）。
 * 无状态、无依赖 ⇒ 宿主单向 import，无循环。
 */

/**
 * 解析 target 格式，返回目标类型和真实 ID
 * "c2c:{openid}" → { scope: "c2c", targetId: "{openid}" }
 * "group:{group_openid}" → { scope: "group", targetId: "{group_openid}" }
 * "{channel_id}" → { scope: "guild", targetId: "{channel_id}" }
 * 对标 OpenClaw routes.ts messagePath
 */
export function parseTarget(target: string): {
  scope: 'c2c' | 'group' | 'guild';
  targetId: string;
} {
  if (target.startsWith('c2c:')) {
    return { scope: 'c2c', targetId: target.slice(4) };
  }
  if (target.startsWith('group:')) {
    return { scope: 'group', targetId: target.slice(6) };
  }
  return { scope: 'guild', targetId: target };
}

/**
 * 构建消息发送 API URL（对标 OpenClaw routes.ts messagePath）
 */
export function getMessageApiUrl(target: string): string {
  const parsed = parseTarget(target);
  const base = 'https://api.sgroup.qq.com';

  switch (parsed.scope) {
    case 'c2c':
      return `${base}/v2/users/${parsed.targetId}/messages`;
    case 'group':
      return `${base}/v2/groups/${parsed.targetId}/messages`;
    case 'guild':
      return `${base}/channels/${parsed.targetId}/messages`;
  }
}

/**
 * 构建媒体上传 API URL（对标 OpenClaw routes.ts mediaUploadPath）
 */
export function getMediaUploadApiUrl(target: string): string {
  const parsed = parseTarget(target);
  const base = 'https://api.sgroup.qq.com';

  switch (parsed.scope) {
    case 'c2c':
      return `${base}/v2/users/${parsed.targetId}/files`;
    case 'group':
      return `${base}/v2/groups/${parsed.targetId}/files`;
    case 'guild':
      return `${base}/channels/${parsed.targetId}/files`;
  }
}
