// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 攻击向量检测规则（FSZ-003）
 * 从 AutoModeClassifier.ts 提取（FSZ-003 拆分），由 heuristicClassify 按原顺序调用。
 */

import type { ClassifierDecision } from './AutoModeClassifier';

/**
 * 检测模板注入攻击
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectTemplateInjection(
  input: string
): ClassifierDecision | null {
  const templatePatterns = [
    // Jinja2/Twig模板（使用成对模式避免误报）
    '{{',
    '{%',
    '%}',
    '{%%',
    '%%}',
    '{{ ',
    '{% ',
    ' %}',
    // Django模板
    '{{',
    '{%',
    '%}',
    '{%=',
    '%}=',
    // ERB模板
    '<%',
    '%>',
    '<%=',
    '%=>',
    '<%==',
    // PHP模板
    '<?php',
    '<?=',
    '<?',
    '?>',
    // ASP.NET模板
    '<%',
    '%>',
    '<%=',
    '<%#',
    '#%>',
    // Handlebars/Mustache
    '{{',
    '{{{',
    '}}}',
    // EJS模板
    '<%',
    '%>',
    '<%-',
    '<%=',
    // 表达式语言（使用左括号避免误报）
    '${',
    '#{',
    // 模板函数调用
    '{% if ',
    '{% for ',
    '{% while ',
    '{% include ',
    '{{ if ',
    '{{ for ',
    '{{ while ',
    '{{ include ',
  ];

  for (const pattern of templatePatterns) {
    if (input.includes(pattern)) {
      return {
        shouldBlock: true,
        reason: `Input contains potential template injection pattern: "${pattern}"`,
      };
    }
  }

  return null;
}

/**
 * 检测路径遍历攻击
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectPathTraversal(input: string): ClassifierDecision | null {
  // 标准路径遍历模式
  const traversalPatterns = [
    '../',
    '..\\',
    '/../',
    '\\..\\',
    '..//',
    './/..',
    '.../',
    '..../',
    '..\\..\\',
    '../..',
    // URL编码版本
    '%2e%2e/',
    '%2e%2e\\',
    '%2f%2e%2e',
    '%5c%2e%2e',
    // Unicode编码版本
    '%u002e%u002e/',
    '%u002e%u002e\\',
    // 双重编码版本
    '%252e%252e/',
    '%252e%252e\\',
    // 其他变体
    '.%2e/',
    '.%2e\\',
    '%2e./',
    '%2e.\\',
  ];

  for (const pattern of traversalPatterns) {
    if (input.includes(pattern)) {
      return {
        shouldBlock: true,
        reason: `Input contains path traversal pattern: "${pattern}"`,
      };
    }
  }

  return null;
}

/**
 * 检测管道和重定向操作
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectPipeAndRedirect(
  input: string
): ClassifierDecision | null {
  // 管道操作符
  if (input.includes('|')) {
    return {
      shouldBlock: true,
      reason: 'Input contains pipe operator',
    };
  }

  // 重定向操作符
  if (input.includes('>') && !input.includes('=>')) {
    return {
      shouldBlock: true,
      reason: 'Input contains redirect operator',
    };
  }

  if (input.includes('>>')) {
    return {
      shouldBlock: true,
      reason: 'Input contains append redirect operator',
    };
  }

  if (input.includes('<')) {
    return {
      shouldBlock: true,
      reason: 'Input contains input redirect operator',
    };
  }

  // 后台执行
  if (input.includes('&') && !input.includes('&&')) {
    return {
      shouldBlock: true,
      reason: 'Input contains background execution operator',
    };
  }

  // 逻辑操作符
  if (input.includes('&&') || input.includes('||')) {
    return {
      shouldBlock: true,
      reason: 'Input contains logical operator',
    };
  }

  return null;
}

/**
 * 检测正则表达式DoS攻击（ReDoS）
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectReDoSAttack(input: string): ClassifierDecision | null {
  const redosPatterns = [
    // 灾难性回溯模式
    '(a+)+',
    '(a++)+',
    '(a*)*',
    '(a+){1,}',
    '(a+){2,}',
    '(a|aa)+',
    '(ab|a)+',
    '(a|b)*c',
    '([ab]+)+c',
    // 嵌套量词
    '.*.*',
    '.+.*',
    '.*.+',
    '.+.+',
    // 重复组
    '(.+)+',
    '(.++)+',
    '([^@]+)+@',
    // 高复杂度模式
    '(?:a|b)*c',
    '(?:a|b)+c',
    '(a|b)+$',
    // 指数时间模式
    'a?a?a?a?a?a?a?a?a?a?a?a?a?a?a?',
    '(a|aa|aaa|aaaa|aaaaa|aaaaaa)+',
  ];

  for (const pattern of redosPatterns) {
    if (input.includes(pattern)) {
      return {
        shouldBlock: true,
        reason: `Input contains potential ReDoS attack pattern: "${pattern}"`,
      };
    }
  }

  return null;
}

/**
 * 检测服务器端请求伪造（SSRF）
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectSSRFAttack(input: string): ClassifierDecision | null {
  const ssrfPatterns = [
    // 本地IP地址
    '127.0.0.1',
    'localhost',
    '0.0.0.0',
    '10.',
    '172.16.',
    '172.17.',
    '172.18.',
    '172.19.',
    '172.20.',
    '172.21.',
    '172.22.',
    '172.23.',
    '172.24.',
    '172.25.',
    '172.26.',
    '172.27.',
    '172.28.',
    '172.29.',
    '172.30.',
    '172.31.',
    '192.168.',
    '169.254.',
    // IPv6本地地址
    '::1',
    '::ffff:',
    'fe80:',
    'fc00:',
    'fd00:',
    // 元字符绕过
    '127。0。0。1',
    '127\\.0\\.0\\.1',
    '127%2E0%2E0%2E1',
    '0177.000.000.001',
    '0x7f.0x0.0x0.0x1',
    // 云元数据端点
    '169.254.169.254',
    'instance-data',
    'metadata.google.internal',
    '100.100.100.200', // Aliyun
    // URL协议
    'http://',
    'https://',
    'ftp://',
    'gopher://',
    'file://',
    'ldap://',
    'ldaps://',
    'mysql://',
    'postgresql://',
    'mongodb://',
    'redis://',
    'memcached://',
    'socket://',
  ];

  for (const pattern of ssrfPatterns) {
    if (input.includes(pattern)) {
      return {
        shouldBlock: true,
        reason: `Input contains potential SSRF attack pattern: "${pattern}"`,
      };
    }
  }

  return null;
}

/**
 * 检测文件包含攻击
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectFileInclusion(input: string): ClassifierDecision | null {
  const fileInclusionPatterns = [
    // PHP文件包含
    'include(',
    'require(',
    'include_once(',
    'require_once(',
    'file_get_contents(',
    'file_put_contents(',
    'fopen(',
    'readfile(',
    'highlight_file(',
    'show_source(',
    'parse_ini_file(',
    // 路径遍历变体
    '../',
    '..\\',
    '/../',
    '\\..\\',
    '.../',
    '..../',
    '..\\..\\',
    '../..',
    // 协议包装器
    'php://',
    'data://',
    'glob://',
    'phar://',
    'zip://',
    'zlib://',
    'compress.zlib://',
    'compress.bzip2://',
    'rar://',
    'ogg://',
    'expect://',
    'ssh2://',
    'ftp://',
    'ftps://',
    'http://',
    'https://',
    // 编码绕过
    '%2e%2e/',
    '%2e%2e\\',
    '%2f%2e%2e',
    '%5c%2e%2e',
    '%u002e%u002e/',
    '%u002e%u002e\\',
    '%c0%ae%c0%ae/',
    '%c0%ae%c0%ae\\',
  ];

  for (const pattern of fileInclusionPatterns) {
    if (input.includes(pattern)) {
      return {
        shouldBlock: true,
        reason: `Input contains potential file inclusion attack pattern: "${pattern}"`,
      };
    }
  }

  return null;
}

/**
 * 检测请求走私攻击（HTTP Request Smuggling）
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectRequestSmuggling(
  input: string
): ClassifierDecision | null {
  const smugglingPatterns = [
    // Content-Length冲突
    'Content-Length:',
    'Transfer-Encoding:',
    // 双重Content-Length
    'Content-Length:',
    'Content-Length:',
    // CL.TE攻击
    'Transfer-Encoding: chunked',
    // TE.CL攻击
    'Content-Length:',
    'Transfer-Encoding:',
    // 换行注入
    '\r\n\r\n',
    '\n\n',
    '\r\r',
    // 分块编码攻击
    '0\r\n\r\n',
    '0\n\n',
    // 模糊边界
    'X-Forwarded-For:',
    'X-Real-IP:',
    'X-Original-URL:',
    'X-Rewrite-URL:',
  ];

  // 检查是否同时包含Content-Length和Transfer-Encoding
  if (
    input.includes('Content-Length:') &&
    input.includes('Transfer-Encoding:')
  ) {
    return {
      shouldBlock: true,
      reason:
        'Input contains both Content-Length and Transfer-Encoding headers indicating potential request smuggling',
    };
  }

  // 检查分块编码模式
  if (input.includes('Transfer-Encoding: chunked')) {
    return {
      shouldBlock: true,
      reason:
        'Input contains Transfer-Encoding chunked header indicating potential request smuggling',
    };
  }

  return null;
}

/**
 * 检测WebSocket劫持攻击
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectWebSocketAttack(
  input: string
): ClassifierDecision | null {
  const websocketPatterns = [
    // WebSocket协议升级
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Key:',
    'Sec-WebSocket-Version:',
    // WebSocket URL
    'ws://',
    'wss://',
    // WebSocket劫持
    'Origin:',
    'Host:',
    // 协议切换攻击
    'HTTP/1.1 101',
    'Switching Protocols',
  ];

  // 检查WebSocket升级请求
  if (
    input.includes('Upgrade: websocket') &&
    input.includes('Connection: Upgrade')
  ) {
    return {
      shouldBlock: true,
      reason:
        'Input contains WebSocket upgrade headers indicating potential WebSocket attack',
    };
  }

  return null;
}

/**
 * 检测DNS劫持/隧道攻击
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectDNSTunnel(input: string): ClassifierDecision | null {
  const dnsPatterns = [
    // DNS查询模式
    'dig ',
    'nslookup ',
    'host ',
    'dnsquery ',
    // DNS隧道工具
    'iodine ',
    'dnscat2 ',
    'dns2tcp ',
    'dns-exfiltrator ',
    // DNS协议
    '_dns.',
    'dns.',
    'ns.',
    'mx.',
    'txt.',
    // 长域名（可能包含编码数据）
    // 检测超过63个字符的域名部分
  ];

  // 检查DNS隧道工具
  for (const tool of ['iodine', 'dnscat2', 'dns2tcp', 'dns-exfiltrator']) {
    if (input.includes(tool)) {
      return {
        shouldBlock: true,
        reason: `Input contains DNS tunneling tool reference: "${tool}"`,
      };
    }
  }

  // 检查是否有大量点分隔的短字符串（base32/base64编码特征）
  const parts = input.split('.');
  if (parts.length > 10) {
    let shortPartCount = 0;
    for (const part of parts) {
      if (part.length >= 4 && part.length <= 8) {
        shortPartCount++;
      }
    }
    if (shortPartCount >= 5) {
      return {
        shouldBlock: true,
        reason:
          'Input contains pattern consistent with DNS tunneling (many short domain parts)',
      };
    }
  }

  return null;
}
