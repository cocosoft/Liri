// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * buildVariantBanner.ts — 启动横幅：**显式告知编译期被裁掉的能力**（主包瘦身 R4 缓解）
 *
 * 问题：`bun build --feature=DROP_*` 是在**编译期**删代码。裁剪后若用户仍设置
 * `FEATURE_CHANNEL_X=true` 或以为某项能力还在，就会遇到"开关不起作用"的静默失效。
 *
 * 缓解：启动时把被裁能力**主动打出来**。`feature()` 只能直接出现在 if / 三元条件里
 * （Bun 引擎强制，见 `主包瘦身-编译期裁剪-方案.md` §5.1），故这里逐项显式判定。
 *
 * 只在**有裁剪**时打日志（完整构建零噪音）。
 */

import { feature } from 'bun:bundle';

import { getLogger } from '@modules/monitoring';

const logger = getLogger('main');

/** 当前构建被裁掉的能力清单（人话文案；空数组 = 未裁剪任何能力） */
export function describeDroppedCapabilities(): string[] {
  const dropped: string[] = [];
  if (feature('DROP_UI')) {
    dropped.push('交互界面（ink / REPL / TUI）');
  }
  if (feature('DROP_CHANNELS_ALL')) {
    dropped.push('全部 IM 通道');
  }
  if (feature('DROP_CHANNEL_FEISHU')) {
    dropped.push('飞书通道');
  }
  return dropped;
}

/**
 * 启动时打印裁剪横幅（幂等；无裁剪则静默）
 */
export function logBuildVariantBanner(): void {
  const dropped = describeDroppedCapabilities();
  if (dropped.length === 0) return;
  logger.warning(
    `[构建变体] 本构建已在编译期裁掉：${dropped.join('、')}；` +
      '对应的 FEATURE_* / 配置项不会生效 —— 如需该能力请改用未裁剪的构建'
  );
}
