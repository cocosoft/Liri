/**
 * W-1（2026-10-20）：出站卡片**形状收敛**的回归锁。
 *
 * 收敛前存在两种形状：
 *   - `DeliveryInteractiveCard`：`title / color / options[{label,value}]`
 *   - `InteractiveCard`：`title / content / buttons[{text,value,style?}] / color`
 * 收敛后只保留后者（`channels/types/IChannel.ts`），`options` 语义并入 `buttons`。
 *
 * 本测试锁住合并后的**渲染语义**（interactive → markdown 降级链）：
 * title / color / content / buttons / fallbackText 全部保留，不丢字段。
 */

import { describe, expect, it } from 'bun:test';
import { interactiveToMarkdown } from '../../src/channels/deliveryFormatters';

describe('W-1 出站卡片收敛：interactive → markdown', () => {
  it('渲染 title / content / buttons / fallback', () => {
    const md = interactiveToMarkdown(
      {
        title: '需要审批',
        content: '即将执行 rm -rf /tmp/x',
        buttons: [
          { text: '同意', value: 'approve', style: 'primary' },
          { text: '拒绝', value: 'reject', style: 'danger' },
        ],
        color: 'yellow',
      },
      '请回复 同意 / 拒绝'
    );

    expect(md).toContain('**需要审批**');
    expect(md).toContain('_(yellow)_');
    expect(md).toContain('即将执行 rm -rf /tmp/x');
    expect(md).toContain('- 同意');
    expect(md).toContain('- 拒绝');
    expect(md).toContain('请回复 同意 / 拒绝');
  });

  it('空 content / 无 buttons ⇒ 不产生空行噪声', () => {
    const md = interactiveToMarkdown(
      { title: 'T', content: '', buttons: [] },
      'fb'
    );
    expect(md).toBe('**T**\n\nfb');
  });
});
