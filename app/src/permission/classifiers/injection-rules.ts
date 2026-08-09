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
 * 代码注入类检测规则（FSZ-003）
 * 从 AutoModeClassifier.ts 提取（FSZ-003 拆分），由 heuristicClassify 按原顺序调用。
 */

import type { ClassifierDecision } from './AutoModeClassifier';

/**
 * 检测Unicode零宽字符注入
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectZeroWidthCharacters(
  input: string,
  patterns: string[]
): ClassifierDecision | null {
  for (const zeroWidth of patterns) {
    if (input.includes(zeroWidth)) {
      return {
        shouldBlock: true,
        reason: 'Input contains Unicode zero-width characters',
      };
    }
  }
  return null;
}

/**
 * 检测空字节注入
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectNullByteInjection(
  input: string
): ClassifierDecision | null {
  // 检查空字节
  if (input.includes('\x00')) {
    return {
      shouldBlock: true,
      reason: 'Input contains null byte injection',
    };
  }

  // 检查URL编码的空字节
  if (input.includes('%00')) {
    return {
      shouldBlock: true,
      reason: 'Input contains URL-encoded null byte injection',
    };
  }

  // 检查Unicode编码的空字节
  if (input.includes('\u0000')) {
    return {
      shouldBlock: true,
      reason: 'Input contains Unicode null byte injection',
    };
  }

  return null;
}

/**
 * 检测Zsh equals expansion攻击
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectZshEqualsExpansion(
  input: string
): ClassifierDecision | null {
  // Zsh equals expansion模式：=command
  const zshPatterns = [
    '=rm',
    '=sh',
    '=bash',
    '=cp',
    '=mv',
    '=cat',
    '=echo',
    '=kill',
    '=sudo',
    '=su',
    '=curl',
    '=wget',
    '=python',
    '=perl',
    '=ruby',
    '=node',
    '=gcc',
    '=make',
    '=docker',
    '=kubectl',
    '=ssh',
    '=scp',
    '=rsync',
    '=git',
    '=npm',
    '=pip',
    '=gem',
    '=cargo',
    '=go',
    '=rustup',
    '=composer',
  ];

  for (const pattern of zshPatterns) {
    if (input.includes(pattern)) {
      return {
        shouldBlock: true,
        reason: `Input contains Zsh equals expansion attack pattern: "${pattern}"`,
      };
    }
  }

  return null;
}

/**
 * 检测编码攻击（Base64、URL编码等）
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectEncodingAttack(input: string): ClassifierDecision | null {
  // 检查Base64编码模式
  if (
    input.includes('base64') &&
    (input.includes('-d') || input.includes('--decode'))
  ) {
    return {
      shouldBlock: true,
      reason: 'Input contains Base64 decoding command',
    };
  }

  // 检查URL编码模式
  if (input.includes('%2e') || input.includes('%2f') || input.includes('%5c')) {
    return {
      shouldBlock: true,
      reason: 'Input contains URL-encoded path traversal characters',
    };
  }

  // 检查Unicode编码模式
  if (input.includes('%u') || input.includes('\\u')) {
    return {
      shouldBlock: true,
      reason: 'Input contains Unicode encoding attack',
    };
  }

  // 检查十六进制编码模式
  if (input.includes('\\x') || input.includes('0x')) {
    return {
      shouldBlock: true,
      reason: 'Input contains hexadecimal encoding attack',
    };
  }

  // 检查printf编码模式
  if (input.includes('printf') && input.includes('\\x')) {
    return {
      shouldBlock: true,
      reason: 'Input contains printf encoding attack',
    };
  }

  return null;
}

/**
 * 检测SQL注入攻击
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectSqlInjection(input: string): ClassifierDecision | null {
  const sqlPatterns = [
    'union select',
    'drop table',
    'insert into',
    'update ',
    'delete ',
    'or 1=1',
    'and 1=1',
    "or 'x'='x",
    "and 'x'='x",
    'or 1=1--',
    'and 1=1--',
    ';drop table',
    ';delete from',
    ';insert into',
    ';update',
    'select 1',
    'select *',
    'from users',
    'from table',
    'where 1=1',
    'having 1=1',
    'order by',
    'group by',
    'limit 1',
    'offset 0',
    'union all',
    'union distinct',
    'cross join',
    'inner join',
    'left join',
    'right join',
    'full join',
    'natural join',
    'exec sp_',
    'execute sp_',
    'xp_cmdshell',
    'sp_configure',
    'declare @',
    'create table',
    'alter table',
    'truncate table',
    'drop database',
    'create database',
    'backup database',
    'restore database',
    'grant all',
    'revoke all',
    'deny all',
    'with encryption',
    'waitfor delay',
    'if exists',
    'while 1=1',
    'begin transaction',
    'commit transaction',
    'rollback transaction',
  ];

  for (const pattern of sqlPatterns) {
    if (input.includes(pattern)) {
      return {
        shouldBlock: true,
        reason: `Input contains SQL injection pattern: "${pattern}"`,
      };
    }
  }

  return null;
}

/**
 * 检测XSS攻击
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectXssAttack(input: string): ClassifierDecision | null {
  const xssPatterns = [
    '<script>',
    '</script>',
    'javascript:',
    'onclick=',
    'onload=',
    'onmouseover=',
    'onmousemove=',
    'onkeydown=',
    'onkeyup=',
    'onfocus=',
    'onblur=',
    'onsubmit=',
    'onreset=',
    'alert(',
    'prompt(',
    'confirm(',
    'eval(',
    'document.cookie',
    'document.write',
    'window.location',
    'document.location',
    'document.createElement',
    'innerHTML',
    'outerHTML',
    'appendChild',
    'insertBefore',
    'replaceChild',
    'setTimeout(',
    'setInterval(',
    'new Function(',
    'String.fromCharCode',
    'unescape(',
    'escape(',
    'decodeURI(',
    'decodeURIComponent(',
  ];

  for (const pattern of xssPatterns) {
    if (input.includes(pattern)) {
      return {
        shouldBlock: true,
        reason: `Input contains XSS attack pattern: "${pattern}"`,
      };
    }
  }

  return null;
}

/**
 * 检测命令注入攻击
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectCommandInjection(
  input: string
): ClassifierDecision | null {
  const injectionPatterns = [
    // 命令替换
    '$(',
    '`',
    '${',
    '${{',
    // 子shell
    'bash -c',
    'sh -c',
    'zsh -c',
    'ksh -c',
    // Python执行
    'python -c',
    'python3 -c',
    'python2 -c',
    // Perl执行
    'perl -e',
    'perl -E',
    // Ruby执行
    'ruby -e',
    'ruby -E',
    // Node执行
    'node -e',
    'node --eval',
    // PHP执行
    'php -r',
    'php -f',
    // Lua执行
    'lua -e',
    'lua -l',
    // Tcl执行
    'tclsh -c',
    'wish -c',
    // 远程执行
    'curl ',
    'wget ',
    'nc ',
    'netcat ',
    // 管道执行
    '| bash',
    '| sh',
    '| zsh',
    '| ksh',
    // Base64解码执行
    'base64 -d |',
    'echo | base64 -d',
    // 环境变量执行
    '${IFS}',
    '${RANDOM}',
    '${UID}',
    '${USER}',
    // eval执行
    'eval ',
    'eval(',
    'system(',
    'exec(',
    // 反射执行
    'call_user_func',
    'create_function',
  ];

  for (const pattern of injectionPatterns) {
    if (input.includes(pattern)) {
      return {
        shouldBlock: true,
        reason: `Input contains command injection pattern: "${pattern}"`,
      };
    }
  }

  return null;
}

/**
 * 检测反序列化攻击
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectDeserializationAttack(
  input: string
): ClassifierDecision | null {
  const deserializationPatterns = [
    // PHP反序列化（使用更具体的模式避免误报）
    '"O":',
    '"C":',
    'O:[0-9]+:',
    'C:[0-9]+:',
    '"a":',
    '"s":',
    '"i":',
    '"d":',
    '"N";',
    '__wakeup',
    '__destruct',
    '__construct',
    '__call',
    '__callStatic',
    '__get',
    '__set',
    '__isset',
    '__unset',
    '__sleep',
    '__toString',
    '__invoke',
    '__set_state',
    // Java反序列化
    'java.io.ObjectInputStream',
    'readObject()',
    'org.apache.commons.collections',
    'InvokerTransformer',
    'Runtime.exec',
    'ProcessBuilder',
    // Python反序列化
    'pickle.load',
    'pickle.loads',
    'cPickle.load',
    'cPickle.loads',
    'marshal.load',
    'marshal.loads',
    // Node.js反序列化
    'JSON.parse',
    'Buffer.from',
    'eval(',
    // 通用反序列化特征
    'serialize(',
    'unserialize(',
    'deserialize(',
    'base64_decode(',
    'decodeBase64(',
    'fromBase64(',
  ];

  for (const pattern of deserializationPatterns) {
    if (input.includes(pattern)) {
      return {
        shouldBlock: true,
        reason: `Input contains deserialization attack pattern: "${pattern}"`,
      };
    }
  }

  return null;
}

/**
 * 检测LDAP注入攻击
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectLDAPInjection(input: string): ClassifierDecision | null {
  const ldapPatterns = [
    // LDAP特殊字符
    '*',
    '(',
    ')',
    '&',
    '|',
    '=',
    '!',
    '~',
    // 逻辑操作符
    '&',
    '|',
    '!',
    // LDAP过滤器注入
    '(|',
    '(&',
    '(!',
    '))',
    // 通配符攻击
    '*',
    '**',
    '***',
    // 空值攻击
    '\x00',
    '%00',
    // 编码绕过
    '\\2a',
    '\\28',
    '\\29',
    '\\26',
    '\\7c',
  ];

  // 检查是否包含多个LDAP特殊字符
  let specialCharCount = 0;
  for (const char of ['*', '(', ')', '&', '|', '=']) {
    if (input.includes(char)) {
      specialCharCount++;
    }
  }

  if (specialCharCount >= 3) {
    return {
      shouldBlock: true,
      reason:
        'Input contains multiple LDAP special characters indicating potential LDAP injection',
    };
  }

  // 检查特定模式
  for (const pattern of ldapPatterns) {
    if (input.includes(pattern)) {
      // 跳过单独的 * 和 =，这些在正常输入中很常见
      if (pattern === '*' || pattern === '=') {
        continue;
      }
      return {
        shouldBlock: true,
        reason: `Input contains potential LDAP injection pattern: "${pattern}"`,
      };
    }
  }

  return null;
}

/**
 * 检测XML外部实体攻击（XXE）
 * @param input 输入字符串
 * @returns 检测结果
 */
export function detectXXEAttack(input: string): ClassifierDecision | null {
  const xxePatterns = [
    // DOCTYPE声明
    '<!DOCTYPE',
    '<!DOCTYPE ',
    '<!DOCTYPE\t',
    // 外部实体声明
    '<!ENTITY',
    '<!ENTITY ',
    '<!ENTITY\t',
    // 外部引用
    'SYSTEM ',
    'SYSTEM\t',
    'PUBLIC ',
    'PUBLIC\t',
    // 协议处理程序
    'file://',
    'http://',
    'https://',
    'ftp://',
    'gopher://',
    'expect://',
    'php://',
    // 内部实体
    '&#',
    '&#x',
    '&amp;',
    '&lt;',
    '&gt;',
    // 实体引用
    '&',
    ']]>',
  ];

  // 检查DOCTYPE和ENTITY组合
  if (input.includes('<!DOCTYPE') && input.includes('<!ENTITY')) {
    return {
      shouldBlock: true,
      reason:
        'Input contains both DOCTYPE and ENTITY declarations indicating potential XXE attack',
    };
  }

  // 检查外部实体引用
  if (
    input.includes('<!ENTITY') &&
    (input.includes('SYSTEM') || input.includes('PUBLIC'))
  ) {
    return {
      shouldBlock: true,
      reason:
        'Input contains external entity declaration indicating potential XXE attack',
    };
  }

  // 检查危险协议
  for (const protocol of ['file://', 'gopher://', 'expect://']) {
    if (input.includes(protocol)) {
      return {
        shouldBlock: true,
        reason: `Input contains dangerous protocol: "${protocol}"`,
      };
    }
  }

  return null;
}
