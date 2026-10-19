/**
 * 飞书出站卡片 Card JSON 2.0 契约（2026-10-19）
 *
 * 背景：旧版 1.0 卡片的回调**不支持长连接**（官方限制），出站必须用 2.0 才能收到按钮回调。
 * 依据：https://open.feishu.cn/document/feishu-cards/card-json-v2-structure
 *       https://open.feishu.cn/document/feishu-cards/card-components/interactive-components/button
 */
import { describe, expect, it } from 'bun:test';
import { buildFeishuInteractiveCard } from '@modules/channels/feishu/FeishuChannel';

type AnyRecord = Record<string, unknown>;

describe('buildFeishuInteractiveCard（Card JSON 2.0）', () => {
  it('声明 schema=2.0，正文进 body.elements 的 markdown，不再有根级 elements/action 模块', () => {
    const card = buildFeishuInteractiveCard({
      title: '预算放行',
      content: '今日预算已用尽',
    });

    expect(card['schema']).toBe('2.0');
    expect(card['elements']).toBeUndefined();
    expect(card['header']).toEqual({
      title: { tag: 'plain_text', content: '预算放行' },
    });

    const elements = (card['body'] as AnyRecord)['elements'] as AnyRecord[];
    expect(elements).toHaveLength(1);
    expect(elements[0]).toEqual({ tag: 'markdown', content: '今日预算已用尽' });
  });

  it('按钮用 behaviors:[{type:callback,value}]，不再用 tag:action', () => {
    const card = buildFeishuInteractiveCard({
      title: 't',
      content: 'c',
      buttons: [{ text: '继续', value: 'payload-1' }],
    });

    const elements = (card['body'] as AnyRecord)['elements'] as AnyRecord[];
    expect(elements).toHaveLength(2);
    const button = elements[1]!;
    expect(button['tag']).toBe('button');
    expect(button['type']).toBe('primary');
    expect(button['text']).toEqual({ tag: 'plain_text', content: '继续' });
    expect(button['behaviors']).toEqual([
      { type: 'callback', value: { key: 'action', value: 'payload-1' } },
    ]);
    expect(JSON.stringify(card)).not.toContain('"tag":"action"');
  });

  it('danger 样式映射 type=danger，其余映射 primary', () => {
    const card = buildFeishuInteractiveCard({
      title: 't',
      content: 'c',
      buttons: [
        { text: 'A', value: 'a', style: 'danger' },
        { text: 'B', value: 'b', style: 'default' },
      ],
    });
    const elements = (card['body'] as AnyRecord)['elements'] as AnyRecord[];
    expect(elements[1]!['type']).toBe('danger');
    expect(elements[2]!['type']).toBe('primary');
  });

  it('无按钮时只有 markdown 正文；query 动作的值原样透传', () => {
    const empty = buildFeishuInteractiveCard({ title: 't', content: 'c' });
    expect((empty['body'] as AnyRecord)['elements']).toHaveLength(1);

    const withAction = buildFeishuInteractiveCard({
      title: 't',
      content: 'c',
      buttons: [{ text: '查看', value: '{"a":"query","action":"open-menu"}' }],
    });
    const button = (
      (withAction['body'] as AnyRecord)['elements'] as AnyRecord[]
    )[1]!;
    expect(
      ((button['behaviors'] as AnyRecord[])[0]!['value'] as AnyRecord)['value']
    ).toBe('{"a":"query","action":"open-menu"}');
  });
});
