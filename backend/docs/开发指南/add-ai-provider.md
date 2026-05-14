# 添加新的 AI 提供商

> 如何让 PY_APP 支持新的 AI 模型提供商。

---

## 接口契约

所有提供商实现 `AIProvider` 接口：

```typescript
export interface AIProvider {
  readonly id: string;
  readonly displayName: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string, ChatResponse, unknown>;
  listModels(): Promise<string[]>;
  validateConfig(config: ProviderConfig): ProviderValidationResult;
  setToolRegistry?(registry: unknown): void;
  setToolExecutor?(executor: unknown): void;
  supportsThinking?(model: string): boolean;
}
```

---

## 创建 Provider

在 `src/ai/providers/` 下新建文件 `MyProvider.ts`：

```typescript
import type { AIProvider, ProviderConfig, ChatOptions } from './AIProvider';
import type { ChatMessage, ChatResponse } from '../models/types';

export class MyProvider implements AIProvider {
  readonly id = 'my-provider';
  readonly displayName = 'My Provider';
  private apiKey: string;

  constructor(config: ProviderConfig) {
    this.apiKey = (config.apiKey as string) || process.env.MY_API_KEY || '';
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const res = await fetch('https://api.my-provider.com/v1/chat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: options?.model, messages }),
    });
    const data = await res.json();
    return {
      content: data.choices[0].message.content,
      stop_reason: 'stop',
      usage: {
        prompt_tokens: data.usage?.prompt_tokens || 0,
        completion_tokens: data.usage?.completion_tokens || 0,
        total_tokens: data.usage?.total_tokens || 0,
      },
    };
  }

  async *chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string, ChatResponse, unknown> {
    // SSE 流式解析
    let fullContent = '';
    for await (const chunk of parseSSE(/* response body */)) {
      fullContent += chunk;
      yield chunk;
    }
    return {
      content: fullContent,
      stop_reason: 'stop',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  async listModels(): Promise<string[]> { return ['my-model-1']; }
  validateConfig(c: ProviderConfig) {
    return { valid: !!c.apiKey, errors: c.apiKey ? [] : ['API key required'], warnings: [] };
  }
}
```

---

## 注册

修改 `src/ai/providers/index.ts`：

```typescript
export { MyProvider } from './MyProvider';
```

---

## OpenAI 兼容模式

大多数新提供商与 OpenAI API 兼容。参考 `DeepSeekProvider.ts` 或 `MoonshotProvider.ts`。

Anthropic 格式参考 `BedrockProvider.ts`。

---

## 可选增强

| 能力 | 方式 |
|------|------|
| 思考配置 | 实现 `supportsThinking(model)` |
| 工具调用 | 在 `chat()` 中处理 `options.tools` |
| 提示缓存 | 消息中加 `cache_control: { type: "ephemeral" }` |
| 模型回退 | 用 `createFallbackProvider()` 包装 |
| 成本跟踪 | 在 `CostTracker` 注册模型定价 |
