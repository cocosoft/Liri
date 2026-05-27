/**
 * 插件标识符解析
 * 负责解析和处理插件标识符
 */

/**
 * 解析插件标识符
 * @param pluginId 插件标识符，格式为 "name@marketplace"
 * @returns 解析后的插件名称和市场
 */
export function parsePluginIdentifier(pluginId: string): {
  name: string | undefined;
  marketplace: string | undefined;
} {
  const parts = pluginId.split('@');
  if (parts.length === 2) {
    return {
      name: parts[0],
      marketplace: parts[1],
    };
  }
  return {
    name: pluginId,
    marketplace: undefined,
  };
}

/**
 * 构建插件标识符
 * @param name 插件名称
 * @param marketplace 市场名称
 * @returns 插件标识符
 */
export function buildPluginIdentifier(
  name: string,
  marketplace?: string
): string {
  if (marketplace) {
    return `${name}@${marketplace}`;
  }
  return name;
}

/**
 * 验证插件标识符
 * @param pluginId 插件标识符
 * @returns 是否有效
 */
export function validatePluginIdentifier(pluginId: string): boolean {
  // 插件标识符不能包含空格或特殊字符
  const validPattern = /^[a-zA-Z0-9\-_]+(@[a-zA-Z0-9\-_]+)?$/;
  return validPattern.test(pluginId);
}
