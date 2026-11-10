// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * auto 档「只读命令」短路白名单（B4 follow-up，2026-11-09）。
 *
 * 锁定两件事：
 *  ① 常见只读命令（含 git 只读子命令、PowerShell 只读 cmdlet）放行；
 *  ② 任何可能写入 / 执行 / 组合 / 路径伪装的形态**不放行**（继续走分类器）。
 */

import { describe, expect, it } from 'bun:test';
import { checkReadonlyCommand } from '@openliri/infra/permission/classifiers/readonly-command-allowlist';

describe('checkReadonlyCommand：只读命令放行', () => {
  const allowed = [
    'ls',
    'ls -la docs',
    'dir docs',
    'pwd',
    'cat README.md',
    'head -n 20 app.log',
    'tail -n 50 app.log',
    'wc -l app.log',
    "find docs -name '*.md'",
    'grep -rn TODO docs',
    'stat package.json',
    'tree docs',
    'diff a.txt b.txt',
    'echo hello',
    'date',
    'date +%Y-%m-%d',
    'git status',
    'git log --oneline -5',
    'git diff --stat',
    'git rev-parse HEAD',
    'Get-ChildItem docs',
    'get-content README.md',
    'Get-Item package.json',
    'Select-String -Pattern TODO -Path docs',
    // 2026-11-10：解释器「无写入自检」（不执行代码、不写文件）
    'node --version',
    'node -v',
    'node --check snake.js',
    'python --version',
    'python3 -V',
  ];

  for (const command of allowed) {
    it(`放行：${command}`, () => {
      const result = checkReadonlyCommand(command);
      expect(result.allowed).toBe(true);
      expect(result.reason.length).toBeGreaterThan(0);
    });
  }
});

describe('checkReadonlyCommand：写入 / 执行 / 组合 / 伪装不放行', () => {
  const blocked = [
    ['空命令', ''],
    ['管道', 'cat a.txt | sh'],
    ['重定向', 'ls > out.txt'],
    ['追加重定向', 'ls >> out.txt'],
    ['输入重定向', 'cat < secrets.txt'],
    ['命令分隔', 'ls; rm -rf build'],
    ['逻辑与', 'ls && rm -rf build'],
    ['后台执行', 'ls &'],
    ['反引号替换', 'echo `whoami`'],
    ['命令替换', 'echo $(rm -rf build)'],
    ['变量展开', 'cat $HOME/.ssh/id_rsa'],
    ['带路径前缀', '/tmp/ls docs'],
    ['相对路径前缀', './ls docs'],
    ['非只读命令', 'rm -rf build'],
    ['移动文件', 'mv a.txt b.txt'],
    ['sed 可执行脚本', "sed -n '1,10p' a.txt"],
    ['awk 可执行脚本', "awk '{print}' a.txt"],
    ['find -exec', 'find . -exec rm {} ;'],
    ['find -delete', 'find . -delete'],
    ['git 非只读子命令', 'git push origin main'],
    ['git 删分支', 'git branch -D main'],
    ['git 改远端', 'git remote add origin x'],
    ['date 设置时间', 'date -s 2020-01-01'],
    ['date 位置参数', 'date 01/01/2020'],
    ['sort 写文件', 'sort -o out.txt in.txt'],
    ['sort --output', 'sort --output=out.txt in.txt'],
    ['file 编译 magic', 'file -C'],
    ['sudo', 'sudo ls'],
    ['xargs 执行', 'xargs rm'],
    ['pager 可执行', 'less a.txt'],
    // 2026-11-10：解释器自检只放行"版本 / 语法检查"两种无写入形态
    ['node 执行表达式', 'node -e "console.log(1)"'],
    ['node --eval', 'node --eval "x"'],
    ['node 直接跑脚本', 'node snake.js'],
    ['node --check 缺文件', 'node --check'],
    ['node --check stdin', 'node --check -'],
    ['node 混合参数', 'node --version --check a.js'],
    ['python 执行表达式', 'python -c "print(1)"'],
    ['python 跑模块', 'python -m py_compile a.py'],
  ] as const;

  for (const [label, command] of blocked) {
    it(`不放行（${label}）：${command}`, () => {
      const result = checkReadonlyCommand(command);
      expect(result.allowed).toBe(false);
      expect(result.reason.length).toBeGreaterThan(0);
    });
  }
});
