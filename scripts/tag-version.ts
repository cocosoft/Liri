/**
 * 版本 tag 脚本 (Version Tag)
 *
 * 发布流程第 7 步（`.trae/rules/versioning.md` §四）：给当前 HEAD 打 **annotated** tag
 * `v<version>`，消息为 `Release v<version>`。
 *
 * 用法（在 `app/` 下）：`bun run version:tag`
 *
 * 为什么是脚本而非 package.json 里的内联命令：annotated 写法要在 `-m` 的引号里再嵌一次
 * `$(node -p "…")`，bash / PowerShell 对嵌套引号的规则不同（实测 PowerShell 会把单引号
 * 原样传给 node）⇒ 内联版无法跨平台。本脚本统一读 `app/package.json` 再调 git。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const MAIN_SOURCE = join(PROJECT_ROOT, 'app', 'package.json');

function main(): void {
  if (!existsSync(MAIN_SOURCE)) {
    console.error(`错误: 找不到主版本文件 ${MAIN_SOURCE}`);
    process.exit(1);
  }

  const { version } = JSON.parse(readFileSync(MAIN_SOURCE, 'utf-8')) as {
    version?: string;
  };
  if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    console.error(
      `错误: app/package.json 中的 version 不是合法 semver: "${version}"`
    );
    process.exit(1);
  }

  const tag = `v${version}`;
  const result = spawnSync('git', ['tag', '-a', tag, '-m', `Release ${tag}`], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`错误: 无法执行 git tag — ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    // tag 已存在 / 无 git 仓库等：git 已在自己的 stderr 说明原因，这里不重复猜测
    console.error(
      `错误: git tag -a ${tag} 失败（退出码 ${result.status ?? 'null'}）`
    );
    process.exit(result.status ?? 1);
  }

  console.log(
    `✓ 已创建 annotated tag ${tag}（消息：Release ${tag}）；下一步 git push origin ${tag}`
  );
  process.exit(0);
}

main();
