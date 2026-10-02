// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * InvokeXmlParser —— 带「任意非 > 前缀」的工具调用（T-⑥05 回归守卫，2026-10-02）
 *
 * 取证：本机会话 `messages.jsonl` 解码后的**真实模型输出**形如
 *   LT + U+FF5C×2 + DSML + U+FF5C×2 + 空格 + invoke name="bash" GT
 * ⇒ 旧写法（要求 LT **紧跟** invoke）整块漏解析 ⇒ 工具未被执行，且协议原文原样进可见回复。
 * 已用探针在真实样本上验证修复后能解析出 1 个 bash 调用。
 *
 * 本用例用**字符码**构造样本与标签：源码里不出现该特殊字符，也不出现标签字面量。
 * 契约（`parsers/types.ts`）：`ParsedResult.toolCalls: ParsedToolCall[] | null`；
 * `ParsedToolCall.arguments` 为 **JSON 字符串**。
 */
import { describe, expect, test } from 'bun:test';
import { InvokeXmlParser } from '../../../src/ai/parsers/InvokeXmlParser';

const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const SL = String.fromCharCode(47);
const DQ = String.fromCharCode(34);
/** DSML 标记：两个 U+FF5C 包住 DSML，再接一个空格 */
const DSML = String.fromCharCode(0xff5c, 0xff5c) + 'DSML' + String.fromCharCode(0xff5c, 0xff5c) + ' ';

/** 拼一个开标签：LT + 前缀 + 标签名 + 属性 + GT */
const open = (prefix: string, tag: string, attrs = '') =>
  LT + prefix + tag + attrs + GT;
/** 拼一个闭标签：LT + SL + 前缀 + 标签名 + GT */
const close = (prefix: string, tag: string) => LT + SL + prefix + tag + GT;
const attr = (name: string, value: string) =>
  ' ' + name + '=' + DQ + value + DQ;

/** 与实测同构的工具调用块（可注入前缀：DSML 或空） */
function sample(prefix: string): string {
  return [
    open(prefix, 'calls'),
    open(prefix, 'invoke', attr('name', 'bash')),
    open(prefix, 'parameter', attr('name', 'command') + attr('string', 'true')) +
      'pwd; ls -la' +
      close(prefix, 'parameter'),
    open(prefix, 'parameter', attr('name', 'description')) +
      'Print working directory' +
      close(prefix, 'parameter'),
    close(prefix, 'invoke'),
    close(prefix, 'calls'),
  ].join('\n');
}

describe('InvokeXmlParser：前缀形态（T-⑥05）', () => {
  test('DSML 前缀形态会被解析为工具调用', () => {
    const parser = new InvokeXmlParser();
    const text = '前言\n' + sample(DSML);

    expect(parser.mayContainToolCalls(text)).toBe(true);

    const calls = parser.parse(text).toolCalls!;
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('bash');
    expect(JSON.parse(calls[0].arguments)).toMatchObject({
      command: 'pwd; ls -la',
      description: 'Print working directory',
    });
  });

  test('裸 invoke 形态不回归（阳性对照）', () => {
    const parser = new InvokeXmlParser();
    const calls = parser.parse(sample('')).toolCalls!;
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('bash');
    expect(JSON.parse(calls[0].arguments)).toMatchObject({
      command: 'pwd; ls -la',
    });
  });

  test('普通文本不受影响（阴性对照）', () => {
    const parser = new InvokeXmlParser();
    expect(parser.parse('这只是一段普通回复，没有工具调用。').toolCalls).toBeNull();
  });
});
