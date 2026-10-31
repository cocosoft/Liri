/**
 * 微信入站协议原语（FIX-12 收口，2026-10-31）
 *
 * 原三个导出是空实现：`verifySignature()` 恒 `true`、解析恒 `{}`、回复恒 `''`。
 * 本文件锁住「诚实实现」的行为边界：
 *  ① 明文模式 SHA1 验签：正确签名通过（大小写不敏感）、错签/缺参/长度不符一律拒绝；
 *  ② XML 解析：CDATA 与裸值都能取、根标签不吞 body、畸形输入不抛；
 *  ③ 回复构造：CDATA 包裹、`]]>` 被转义（防注入破坏 XML）。
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'bun:test';

import {
  buildWechatReply,
  parseWechatXML,
  verifyWechatSignature,
} from '../../src/channels/wechat/WechatChannel';

const TOKEN = 'test-token';
const TIMESTAMP = '1700000000';
const NONCE = '12345';

function sign(token: string, timestamp: string, nonce: string): string {
  return createHash('sha1')
    .update([token, timestamp, nonce].sort().join(''))
    .digest('hex');
}

describe('verifyWechatSignature（明文模式）', () => {
  it('正确签名通过，且大小写不敏感', () => {
    const sig = sign(TOKEN, TIMESTAMP, NONCE);
    expect(verifyWechatSignature(TOKEN, TIMESTAMP, NONCE, sig)).toBe(true);
    expect(
      verifyWechatSignature(TOKEN, TIMESTAMP, NONCE, sig.toUpperCase())
    ).toBe(true);
  });

  it('参数顺序不影响结果（实现内部按字典序排序）', () => {
    const sig = sign(TOKEN, TIMESTAMP, NONCE);
    expect(verifyWechatSignature(TOKEN, NONCE, TIMESTAMP, sig)).toBe(true);
  });

  it('同长度但内容不同的签名 ⇒ 拒绝', () => {
    const sig = sign(TOKEN, TIMESTAMP, NONCE);
    const tampered = `${sig.slice(0, -1)}${sig.endsWith('0') ? '1' : '0'}`;
    expect(verifyWechatSignature(TOKEN, TIMESTAMP, NONCE, tampered)).toBe(
      false
    );
  });

  it('长度不符 / 缺参 / 空值 ⇒ 拒绝（fail-closed）', () => {
    const sig = sign(TOKEN, TIMESTAMP, NONCE);
    expect(verifyWechatSignature(TOKEN, TIMESTAMP, NONCE, 'deadbeef')).toBe(
      false
    );
    expect(verifyWechatSignature('', TIMESTAMP, NONCE, sig)).toBe(false);
    expect(verifyWechatSignature(TOKEN, '', NONCE, sig)).toBe(false);
    expect(verifyWechatSignature(TOKEN, TIMESTAMP, '', sig)).toBe(false);
    expect(verifyWechatSignature(TOKEN, TIMESTAMP, NONCE, '')).toBe(false);
  });
});

describe('parseWechatXML', () => {
  const xml = [
    '<xml>',
    '<ToUserName><![CDATA[gh_account]]></ToUserName>',
    '<FromUserName><![CDATA[user_openid]]></FromUserName>',
    '<CreateTime>1700000000</CreateTime>',
    '<MsgType><![CDATA[text]]></MsgType>',
    '<Content><![CDATA[你好 & <hi>]]></Content>',
    '</xml>',
  ].join('');

  it('CDATA 与裸值都能取，且根标签不会吞掉 body', () => {
    const parsed = parseWechatXML(xml);
    expect(parsed.ToUserName).toBe('gh_account');
    expect(parsed.FromUserName).toBe('user_openid');
    expect(parsed.CreateTime).toBe('1700000000');
    expect(parsed.MsgType).toBe('text');
    expect(parsed.Content).toBe('你好 & <hi>');
  });

  it('空串与畸形输入不抛异常', () => {
    expect(parseWechatXML('')).toEqual({});
    expect(parseWechatXML('not xml at all')).toEqual({});
    expect(parseWechatXML('<xml><broken>')).toEqual({});
  });
});

describe('buildWechatReply', () => {
  it('按微信被动回复结构输出（CDATA + text 类型 + 秒级时间戳）', () => {
    const reply = buildWechatReply('user_openid', 'gh_account', '收到');
    expect(reply).toContain('<ToUserName><![CDATA[user_openid]]></ToUserName>');
    expect(reply).toContain(
      '<FromUserName><![CDATA[gh_account]]></FromUserName>'
    );
    expect(reply).toContain('<MsgType><![CDATA[text]]></MsgType>');
    expect(reply).toContain('<Content><![CDATA[收到]]></Content>');
    expect(reply).toMatch(/<CreateTime>\d{10}<\/CreateTime>/);
  });

  it('内容里的 `]]>` 被转义（防止破坏 XML）', () => {
    const reply = buildWechatReply('u', 'g', 'a]]>b');
    expect(reply).toContain('a]]]]><![CDATA[>b');
    // 转义后仍应能被本方解析器读回原文
    expect(parseWechatXML(reply).Content).toBe('a]]>b');
  });
});
