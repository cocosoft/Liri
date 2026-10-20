/**
 * U-02（2026-10-20 用户裁定「无人值守自动通过，记录审计」）——
 * `resolveUnattendedAnswers()` 的口径回归。
 *
 * 只测**纯函数**：编排层（`ReActToolLoop` / `ChatManagerTAORAdapter`）仅在
 * `UNATTENDED_MODE` 开启时调用它，普通交互路径不受影响。
 */
import { describe, expect, it } from 'bun:test';

import { resolveUnattendedAnswers } from '../../src/utils/unattendedAnswers';

describe('U-02 无人值守自动答复', () => {
  it('confirm：优先选「确认/继续/approve」类选项', () => {
    expect(
      resolveUnattendedAnswers({
        questionType: 'confirm',
        options: [{ label: '取消' }, { label: '继续执行' }],
      })
    ).toEqual(['继续执行']);

    expect(
      resolveUnattendedAnswers({
        questionType: 'confirm',
        options: [{ label: 'Approve' }, { label: 'Reject' }],
      })
    ).toEqual(['Approve']);
  });

  it('confirm：无正向关键词 ⇒ 取第一个选项（模型建议项）', () => {
    expect(
      resolveUnattendedAnswers({
        questionType: 'confirm',
        options: [{ label: '方案 A' }, { label: '方案 B' }],
      })
    ).toEqual(['方案 A']);
  });

  it('choice：取第一个选项（含 multiSelect）', () => {
    expect(
      resolveUnattendedAnswers({
        questionType: 'choice',
        options: [{ label: 'React' }, { label: 'Vue' }],
      })
    ).toEqual(['React']);
    expect(
      resolveUnattendedAnswers({
        options: [{ label: 'A' }, { label: 'B' }],
      })
    ).toEqual(['A']);
  });

  it('open：返回显式占位，不伪造用户具体输入', () => {
    const answers = resolveUnattendedAnswers({ questionType: 'open' });
    expect(answers).toHaveLength(1);
    expect(answers[0]).toContain('无人值守');
  });

  it('无选项（choice/open 缺省）⇒ 占位而非空数组（避免 tool 侧"未回答"错误）', () => {
    expect(resolveUnattendedAnswers({})).toHaveLength(1);
    expect(resolveUnattendedAnswers({ options: [] })).toHaveLength(1);
  });
});
