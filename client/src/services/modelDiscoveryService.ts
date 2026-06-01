/**
 * 模型自动发现服务
 * 从 OpenAI 兼容端点拉取模型列表
 */

export const modelDiscoveryService = {
  async discoverFromEndpoint(baseUrl: string): Promise<string[]> {
    const normalizedUrl = `${baseUrl.replace(/\/+$/, '')}/v1/models`;
    const response = await fetch(normalizedUrl, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json() as { data?: Array<{ id: string }> };
    if (Array.isArray(data.data)) {
      return data.data.map((m) => m.id);
    }
    throw new Error('响应格式不匹配');
  },
};
