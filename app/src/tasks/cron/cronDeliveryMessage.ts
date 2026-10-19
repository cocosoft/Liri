/**
 * Cron 投递文案（纯函数）。
 *
 * 2026-10-19 修复：此前 `dispatchDelivery` 只读取 `output/finalResponse`，失败结果两者均为空串
 * ⇒ 无 origin/sessionKey 的任务会被写成「定时任务完成 + 执行完成」，与事实相反。
 * 这里按 `success/error` 分支，失败时带上错误与耗时。
 */

/** 投递所需的最小结果形状（`CronJobResult` 的结构子集，便于纯函数单测） */
export interface CronDeliveryResultLike {
  success?: boolean;
  output?: string;
  finalResponse?: string;
  error?: string;
  durationMs?: number;
}

export interface CronDeliveryMessage {
  /** 通知中心标题（渠道投递不使用） */
  title: string;
  /** 渠道正文 / 通知中心 content */
  content: string;
  failed: boolean;
}

/**
 * 构造 cron 投递文案。
 *
 * - 成功：`output || finalResponse || 执行完成`
 * - 失败：`error || 执行失败（无错误详情）`，并附耗时（如有）
 */
export function buildCronDeliveryMessage(
  jobName: string,
  result: CronDeliveryResultLike
): CronDeliveryMessage {
  const failed = result.success === false;
  const durationText =
    typeof result.durationMs === 'number'
      ? `（耗时 ${result.durationMs}ms）`
      : '';

  if (failed) {
    const reason =
      result.error?.trim() || `[定时任务: ${jobName}] 执行失败（无错误详情）`;
    return {
      failed: true,
      title: `定时任务失败: ${jobName}`,
      content: `📋 **${jobName}**\n${reason}${durationText}`,
    };
  }

  const detail =
    result.output || result.finalResponse || `[定时任务: ${jobName}] 执行完成`;
  return {
    failed: false,
    title: `定时任务完成: ${jobName}`,
    content: `📋 **${jobName}**\n${detail}`,
  };
}
