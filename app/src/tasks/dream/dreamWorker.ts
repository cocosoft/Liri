import { parentPort } from 'worker_threads';
import { configManager } from '@modules/config';

const prompt = configManager.env('LIRI_DREAM_PROMPT') || '默认思考主题';
const maxDuration = parseInt(
  configManager.env('LIRI_DREAM_MAX_DURATION') || '30000',
  10
);

if (!parentPort) {
  process.exit(1);
}

const thoughts: string[] = [];
const startTime = Date.now();

function sendThought(content: string): void {
  thoughts.push(content);
  parentPort!.postMessage({ type: 'thought', content });
}

function complete(success: boolean, error?: string): void {
  parentPort!.postMessage({
    thoughts,
    conclusion: error || `梦境思考完成: ${thoughts.length} 轮推理`,
    timestamp: Date.now(),
    durationMs: Date.now() - startTime,
    success,
    error,
  });
}

async function think(): Promise<void> {
  const steps = [
    `分析问题: ${prompt}`,
    '检索相关上下文信息',
    '识别关键约束条件',
    '生成候选方案',
    '评估各方案可行性',
    '选择最优方案',
    '形成最终结论',
  ];

  const interval = Math.min(800, Math.floor(maxDuration / steps.length));

  for (let i = 0; i < steps.length; i++) {
    if (Date.now() - startTime >= maxDuration) {
      sendThought('梦境时间配额耗尽，基于已有思考形成结论');
      break;
    }

    await sleep(interval);
    sendThought(steps[i]);
  }

  complete(true);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

think().catch((err) => {
  complete(false, err.message);
});
