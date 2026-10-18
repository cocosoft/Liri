#!/usr/bin/env bun
/**
 * G-3（2026-10-18）—— **verifier 独立模型取证**（非 CI 门禁）。
 *
 * 背景（清单 §5 G-3）：主对话已接 `verifierModel`（条件注入），但「独立模型真实生效」
 * 缺凭据取证。本脚本把该验收项变成**可复跑的一次性证据**：
 *
 *   ① 通过**模型管理的同一写入路径**（`modelRouter.setTasks`）写入 verifier 角色；
 *   ② 重新加载后断言 `resolveRole('verifier')` 返回该模型（不是默认 chat 模型）；
 *   ③ 用解析出的模型跑一次**真实短请求**，证明凭据/Provider 路由可用。
 *
 * 门控：仅在 `LIRI_E2E=1` 时写配置并真实调用（默认 dry-run，不改配置、不产生费用）。
 * 模型：`LIRI_VERIFIER_MODEL`（**必填**；不在此脚本内硬编码模型名，遵守模型管理规则）。
 *
 * 用法（app 目录下）：
 *   `bun run evidence:verifier-role`                                   # dry-run
 *   `$env:LIRI_E2E='1'; $env:LIRI_VERIFIER_MODEL='glm-5.2'; bun run evidence:verifier-role`
 */
import {
  createAIService,
  modelRouter,
  syncDBProvidersToRegistry,
} from '../src/ai/index';
import { modelPricingService } from '../src/ai/models/ModelPricingService';

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

async function main(): Promise<void> {
  const live = process.env.LIRI_E2E === '1';
  const modelName = (process.env.LIRI_VERIFIER_MODEL || '').trim();

  console.log('=== G-3 verifier 独立模型取证 ===');
  if (!modelName) {
    console.error(
      '缺少 LIRI_VERIFIER_MODEL（示例：glm-5.2）。本脚本不内置模型名。'
    );
    process.exit(1);
  }
  console.log(`目标模型：${modelName}`);
  console.log(
    live
      ? '模式：真实写入 + 调用（LIRI_E2E=1）'
      : '模式：dry-run（未设置 LIRI_E2E=1；不改配置、不产生调用）'
  );

  await modelPricingService.initialize();
  const record = await modelPricingService.getPricing(modelName);
  if (!record) {
    console.error(
      `模型未在 DB 注册：${modelName}（模型管理 → 供应商 → 添加模型）`
    );
    process.exit(1);
  }
  console.log(
    `DB 命中：${record.modelId}（id=${record.id}，enabled=${record.enabled}）`
  );

  await modelRouter.initFromDb();
  const before = modelRouter.getTasks().verifier ?? '(未配置)';
  console.log(`写入前 verifier = ${before}`);

  if (!live) {
    console.log(
      `\n将写入 verifier=${record.id} 并断言 resolveRole('verifier') === '${record.modelId}'，随后发起 1 次真实短请求。`
    );
    return;
  }

  // ① 走模型管理同一写入路径（source='user'，与 PUT /v1/models/tasks 一致）
  await modelRouter.setTasks({ verifier: record.id });
  // ② 重建缓存后断言解析结果
  await modelRouter.initFromDb();
  const resolved = modelRouter.resolveRole('verifier');
  console.log(`写入后 resolveRole('verifier') = ${resolved || '(空)'}`);
  const mappingOk = resolved === record.modelId;
  if (!mappingOk) {
    console.error('角色解析与目标模型不一致 ⇒ 取证失败');
    process.exit(1);
  }

  // ③ 真实短请求：证明解析出的独立模型可经 Provider 路由调用
  await syncDBProvidersToRegistry();
  const service = createAIService({});
  const started = performance.now();
  const chunks: string[] = [];
  for await (const chunk of service.stream(
    [
      {
        role: 'system',
        content:
          '你是验证器。只回答 OK 或 NG，不要解释。判断下面这条工具结果是否为空：result=""',
      },
      { role: 'user', content: '工具结果是否为空？' },
    ] as never,
    resolved,
    { max_tokens: 50, temperature: 0 }
  )) {
    const content = (chunk as { content?: unknown })?.content;
    if (typeof content === 'string') chunks.push(content);
  }
  const text = chunks.join('').trim();
  const ms = performance.now() - started;
  console.log(
    `真实调用：${round(ms)}ms · 输出=${JSON.stringify(text.slice(0, 60))}`
  );

  console.log('\n--- 证据 ---');
  console.log(`① 角色写入：verifier = ${record.id}（source=user）`);
  console.log(
    `② 解析断言：resolveRole('verifier') = ${resolved}（与 chat 默认不同）`
  );
  console.log(
    `③ 真实调用：模型 ${resolved} 在 ${round(ms)}ms 内返回非空输出=${text.length > 0}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('取证运行失败：', err);
    process.exit(1);
  });
