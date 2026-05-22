import type { QAHandler } from '../SimpleQAEngine.js';

export class GreetingHandler implements QAHandler {
  name = 'GreetingHandler';
  priority = 50;
  patterns = [
    /^(你好|您好|嗨|hi|hello|hey|早上好|下午好|晚上好|晚安)\b/i,
    /^(good\s*(morning|afternoon|evening)|nice\s*to\s*meet\s*you)\b/i,
  ];

  handle(input: string): { response: string; confidence: number } | null {
    const lower = input.toLowerCase().trim();

    if (lower.includes('早上好') || lower === 'good morning') {
      return { response: '早上好！今天有什么可以帮您的？', confidence: 0.95 };
    }

    if (lower.includes('下午好') || lower === 'good afternoon') {
      return { response: '下午好！有什么我可以帮忙的吗？', confidence: 0.95 };
    }

    if (
      lower.includes('晚上好') ||
      lower.includes('晚安') ||
      lower === 'good evening'
    ) {
      return { response: '晚上好！需要我帮您做些什么吗？', confidence: 0.95 };
    }

    return {
      response: '你好！我是 PY_APP 的 AI 助手，有什么我可以帮您的？',
      confidence: 0.9,
    };
  }
}
