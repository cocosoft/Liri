import { getBackendBaseUrl, getApiSecret } from "./backendUrl";

class HTTPClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "HTTPClientError";
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${getBackendBaseUrl()}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // 自动附加共享密钥，确保后端只接受来自当前 Tauri 客户端的请求
  const apiSecret = getApiSecret();
  if (apiSecret) {
    headers["Authorization"] = `Bearer ${apiSecret}`;
  }

  // 合并自定义请求头（允许覆盖默认值）
  const customHeaders = options.headers as Record<string, string> | undefined;
  if (customHeaders) {
    Object.assign(headers, customHeaders);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new HTTPClientError(
      body?.error?.message || `HTTP ${response.status}`,
      response.status,
      body,
    );
  }

  return response.json();
}

export const http = {
  get: <T>(path: string, options?: { params?: Record<string, unknown> }) => {
    let url = path;
    if (options?.params) {
      const params = new URLSearchParams();
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.set(key, String(value));
        }
      });
      url += `?${params.toString()}`;
    }
    return request<T>(url);
  },

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),

  put: <T>(path: string, body: unknown) =>
    request<T>(path, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    }),

  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export { HTTPClientError };
