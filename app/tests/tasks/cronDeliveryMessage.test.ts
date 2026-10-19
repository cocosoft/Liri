/**
 * Cron 投递文案契约：失败不得渲染为「执行完成」。
 */
import { describe, expect, test } from 'bun:test';
import { buildCronDeliveryMessage } from '../../src/tasks/cron/cronDeliveryMessage';

describe('buildCronDeliveryMessage', () => {
  test('成功 + output ⇒ 完成标题与原样正文', () => {
    const msg = buildCronDeliveryMessage('日报', {
      success: true,
      output: '今日摘要',
    });
    expect(msg.failed).toBe(false);
    expect(msg.title).toBe('定时任务完成: 日报');
    expect(msg.content).toBe('📋 **日报**\n今日摘要');
  });

  test('成功但无 output ⇒ 保留「执行完成」回退', () => {
    const msg = buildCronDeliveryMessage('日报', {
      success: true,
      output: '',
      finalResponse: '',
    });
    expect(msg.content).toBe('📋 **日报**\n[定时任务: 日报] 执行完成');
  });

  test('失败 + error + 耗时 ⇒ 失败标题、错误与耗时都在正文', () => {
    const msg = buildCronDeliveryMessage('备份', {
      success: false,
      output: '',
      finalResponse: '',
      error: 'provider timeout',
      durationMs: 1234,
    });
    expect(msg.failed).toBe(true);
    expect(msg.title).toBe('定时任务失败: 备份');
    expect(msg.content).toContain('provider timeout');
    expect(msg.content).toContain('耗时 1234ms');
    expect(msg.content).not.toContain('执行完成');
  });

  test('失败但无 error ⇒ 明确「无错误详情」，不冒充完成', () => {
    const msg = buildCronDeliveryMessage('备份', {
      success: false,
      output: '',
      finalResponse: '',
    });
    expect(msg.title).toBe('定时任务失败: 备份');
    expect(msg.content).toContain('执行失败（无错误详情）');
  });

  test('success 缺省 ⇒ 按成功处理（兼容旧投递载荷）', () => {
    const msg = buildCronDeliveryMessage('日报', { output: 'ok' });
    expect(msg.failed).toBe(false);
  });
});
