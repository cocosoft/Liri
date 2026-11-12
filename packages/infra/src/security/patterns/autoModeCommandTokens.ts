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
 * auto 模式的**命令令牌表**（2026-11-11 从 `permission/classifiers/dangerous-command-patterns.ts`
 * 迁入安全规则域；由 `./dangerousCommands` 统一对外导出）。
 *
 * 两档语义（**不同档位，不得混用**）：
 *  - `AUTO_MODE_HARD_DENY_TOKENS`：命中即 `deny`（不可逆 / 越权 / 任意代码执行 / 系统与远端）；
 *  - `AUTO_MODE_APPROVAL_TOKENS`：命中**不拒绝**，转人工审批（常见但可能覆盖既有文件）。
 *
 * 匹配语义与 `DANGEROUS_COMMAND_PATTERNS` 不同：本表按**命令位**匹配
 * （`containsCommandToken`，含嵌套 shell 递归），**不是**评分/打分输入
 * （当前无评分档：分类器只有「硬拦 / 审批 / 放行」三态）。
 *
 * 收录口径（P5 第二步，2026-11-11）：只收「**命中即不可逆 / 越权 / 执行任意代码 /
 * 触碰系统或远端**」的令牌。普通只读与导航命令（`ls` / `cat` / `grep` / `ps` …）
 * **不在此表** —— 它们由 `readonly-command-allowlist` 放行；
 * `git` 也由整词令牌收敛为「丢弃工作区 / 改写历史 / 触碰远端」的子命令。
 * 新增令牌前先自问：这条命令是否可能在**不经过用户批准**的情况下造成不可逆后果？
 */
// P1（2026-11-12）：两档令牌均由命令语义注册表派生（单一来源）
import {
  approvalTokensFromSpecs,
  denyTokensFromSpecs,
} from './commandSpecs';

const STRUCTURAL_HARD_DENY_TOKENS = [
  // P0 紧急新增：Remove-Item 别名全覆盖
  // 原始模式列表
  'rm -rf',
  'rm -fr',
  'rm -rf /',
  'rm -rf *',
  'rm -rf /*',
  'del /s /q',
  'erase /f /s',
  'rd /s /q',
  'mkfs.ext',
  'mkfs.xfs',
  'dd if=',
  'dd of=/dev/',
  'dd of=/dev/sd',
  'dd of=/dev/hd',
  'chmod 777',
  'chmod -R 777',
  'chmod a+rwx',
  'chown -R',
  'chgrp -R',
  'chown root',
  'chgrp root',
  'truncate -s 0',
  'fallocate -l 0',
  ':(){ :|:& };:',
  'forkbomb',
  '(){ :|:& };:',
  'su root',
  'su -',
  'sudo -i',
  'curl | bash',
  'wget | bash',
  'curl | sh',
  'wget | sh',
  'curl | sudo',
  'wget | sudo',
  'curl | su',
  'wget | su',
  'base64 -d |',
  'echo ... | base64',
  'echo | base64 -d',
  'python -c',
  'python3 -c',
  'perl -e',
  'ruby -e',
  'node -e',
  'bash -c',
  'sh -c',
  'zsh -c',
  'ksh -c',
  'curl -sL',
  'curl -s',
  'wget -q',
  'wget -qO-',
  'curl http',
  'curl https',
  'wget http',
  'wget https',
  '. ',
  '$(',
  '`',
  '${',
  '${{',
  '$((',
  '$(<',
  '${!',
  '=rm',
  '=sh',
  '=bash',
  '=cp',
  '=mv',
  '=cat',
  '=echo',
  'PATH=',
  'LD_PRELOAD=',
  'LD_LIBRARY_PATH=',
  'LD_AUDIT=',
  'PYTHONPATH=',
  'PERL5LIB=',
  'RUBYLIB=',
  'NODE_PATH=',
  'IFS=',
  'HOME=',
  'USER=',
  'SHELL=',
  'LOGNAME=',
  'LD_SHOW_AUXV=',
  'LD_DEBUG=',
  // 2026-11-11（P5 路径单一来源）：**路径类令牌不在此表**。
  // 路径敏感度由 `SENSITIVE_PATH_PATTERNS` 判定、`../` 类遍历由 `detectPathTraversal` 判定，
  // 两者都在分类器里**先于审批档**执行 ⇒ 把同一批字符串再抄进本表只会长出第二份真源，
  // 并让"该转审批"的 `cp` / `mv` 在 `/tmp`、`/home`、`/var` 等普通目录上被直接拒绝。
  // 本次移除：/etc/ /sys/ /proc/ /usr/bin/ /usr/sbin/ /bin/ /sbin/ /var/ /boot/ /lib/
  // /lib64/ /root/ /home/ /tmp/ /var/tmp/ /run/ /dev/ /mnt/ /media/ /opt/ /usr/local/、
  // C:\ D:\ \\.\ \\?\、../ ..\ /../ \..\ ..// .//..，以及 /proc/mem /dev/mem /dev/kmem、
  // /etc/passwd /etc/shadow /etc/sudoers /root/.ssh/ /home/*/.ssh/ /var/log/ 等具体路径
  //（`/home/*/.ssh/` 含字面量 `*`，本就永不命中；真实凭据目录由 `/.ssh/` 覆盖）。
  ' | ',
  ' > ',
  ' >> ',
  ' < ',
  ' << ',
  ' <<< ',
  ' >&',
  ' 2>&',
  ' & ',
  ' && ',
  ' || ',
  ' ;& ',
  ' ;&& ',
  // Windows 持久化 / 服务 / 提权（2026-11-11：与 Linux 的 crontab / systemctl / chown 对齐）
  // 只读子命令（`schtasks /query`、`reg query`、`sc query`）不在此列，仍走只读/普通判定。
  'schtasks /create',
  'schtasks /change',
  'schtasks /delete',
  'schtasks /run',
  'reg add',
  'reg delete',
  'reg import',
  'sc create',
  'sc config',
  'sc start',
  'sc stop',
  'sc delete',
  // `wmic` 整词硬拦：`wmic process call create <cmd>` 是任意执行；该工具已被微软弃用，
  // 只读查询也一并拒（并引导改用 PowerShell CIM）。注：命令位锚定会裁掉前导空格，
  // 故不能用 `' call create'` 这种中缀写法。
  // 2026-11-11（P0 等价性补齐）：Windows 账户 / 提权 / 系统加固 / 持久化 —— 与 Linux 侧
  // 的 `useradd` / `chown` / `crontab` / `systemctl` 对齐。此前这批**全部放行**（探针实测）。
  // 只读查询（`net user` 无参数、`netsh advfirewall show`）会一并被拒 —— 与 `wmic` 同口径：
  // 该组命令的只读形态在本项目里没有实际用途，宁可多拒。
  'net user ',
  'net localgroup ',
  'net group ',
  'netsh advfirewall',
  'netsh firewall',
  // 服务 / 计划任务**定义**变更（等价于已拦的 `sc create|config|delete`、`schtasks /create`）
  // 下载落地 / 编解码落地（`-urlcache` 可把远端载荷写到本地）
  'certutil -urlcache',
  'certutil -decode',
  'certutil -encode',
  'certutil -addstore',
  // 子系统 / 远端执行（与已拦的 `ssh ` 对齐）
  // 设备节点 / 文件能力（提权）
  // 一次性远端执行器 / 全局安装（供应链执行入口）
  'npm i -g',
  'npm publish',
  'yarn global add',
  'pnpm add -g',
  'bun add -g',
  'winget install',
  'choco install',
  'scoop install',
  // 容器滥用形态：特权容器 / 宿主机根目录挂载
  '--privileged',
  ' -v /:',
  // 磁盘 / 分区 / 回收站（等价于已拦的 `format` / `mkfs`；`Initialize-Disk` / `Clear-Disk`
  // 由等价组展开）
  // 任意代码执行 / 起子进程（`iex` / `saps` 由等价组展开）
  // 2026-11-12（P0 · 执行体/注册类补齐，实测此前全为 ALLOW）：
  // cmd 内建 `start`、提权 `runas`、DLL/MSI 加载、内存编译、模块导入、全权限运行时
  '[reflection.assembly]::load',
  'systemctl start',
  'systemctl stop',
  'systemctl restart',
  'systemctl enable',
  'systemctl disable',
  'service start',
  'service stop',
  'service restart',
  '>/dev/null',
  '2>/dev/null',
  '>/dev/null 2>&1',
  '2>&1 /dev/null',
  '>/dev/zero',
  '2>/dev/zero',
  '>/dev/null >&',
  'xxd -r',
  'xxd -p',
  'urlencode',
  'urldecode',
  'htmlencode',
  'htmldecode',
  'openssl enc',
  'openssl des',
  'openssl aes',
  'gpg -c',
  'inject',
  'hook',
  'ping -f',
  'ping -s',
  'flood',
  'synflood',
  'ddos',
  'UNION SELECT',
  'DROP TABLE',
  'INSERT INTO',
  'OR 1=1',
  'AND 1=1',
  "OR 'x'='x",
  '<script>',
  '</script>',
  'javascript:',
  'onclick=',
  'onload=',
  'alert(',
  'prompt(',
  'confirm(',
  '%2e%2e',
  '%2e%2e/',
  '%2f',
  '%5c',
  '..%2f',
  '..%5c',
  '%u002e',
  '%u002f',
  '%c0%ae',
  '%c0%af',
  ' ; ',
  ' ;; ',
  ' ` ',
  ' $(',
  '＀',
  'include(',
  'require(',
  'include_once(',
  'require_once(',
  'shell_exec(',
  'exec(',
  'passthru(',
  'system(',
  'proc_open(',
  'popen(',
  'pcntl_exec(',
  'create_function(',
  'serialize(',
  'unserialize(',
  '__wakeup',
  '__destruct',
  '__construct',
  '"O":',
  '"C":',
  'O:[0-9]+:',
  'C:[0-9]+:',
  '"a":',
  '"s":',
  '"i":',
  '"d":',
  '"N";',
  '{{',
  '}}',
  '{%',
  '%}',
  '{%%',
  '%%}',
  'eval(',
  'new Function(',
  'setTimeout(',
  'setInterval(',
  '${IFS}',
  '${RANDOM}',
  '${UID}',
  '${USER}',
  '${HOME}',
  '$_',
  '$0',
  '$1',
  '$@',
  '$*',
  '$#',
  '$$',
  'cat /dev/zero',
  'dd if=/dev/zero',
  'while true',
  'declare -x',
  'cat /dev/null >',
  'iptables -F',
  'iptables -X',
  'ip6tables -F',
  'ip6tables -X',
  'ufw disable',
  'firewall-cmd --set-default-zone=trusted',
  'echo PermitRootLogin yes >>',
  'echo PasswordAuthentication yes >>',
  'openssl passwd',
  'ssh-keygen -f',
  'ssh-keygen -t',
  'named pipe',
  'reverse shell',
  'bind shell',
  'scriptreplay ',
  'ttyrec ',
  'sniff ',
  'keylog ',
  'screencap ',
  'mount /dev/cdrom',
  'mount /dev/dvd',
  'mkfs.ext4 ',
  'mkfs.xfs ',
  'mkfs.btrfs ',
  'dd if=/dev/urandom',
  '7z ',
  'zip -e',
  '7z -p',
  'mount.nfs ',
  'mount.cifs ',
  'mount.smbfs ',
  'mount.sshfs ',
  // 2026-11-11（P5 第二步）：`git ` 不再整体硬拦 —— 只读子命令由 readonly 短路先放行，
  // 硬拦面收敛到**会丢弃工作区 / 改写历史 / 触碰远端**的子命令。
  'git push',
  'git pull',
  'git clone',
  'git reset --hard',
  'git clean ',
  'git checkout --',
  'git restore ',
  'git rebase ',
  'git filter-branch',
  'git reflog expire',
  'git prune',
  'git update-ref',
  'git branch -D',
  'git branch -d',
  'git tag -d',
  'git stash drop',
  'git stash clear',
  'git remote add',
  'git remote remove',
  'git remote set-url',
  'git submodule ',
  'git worktree remove',
  // 2026-11-11：`core.hooksPath` 可把 git 钩子指到任意目录 ⇒ 持久化执行入口 ⇒ 硬拦。
  'git config core.hookspath',
  'npm install',
  'pip install',
  'gem install',
  'cargo install',
  'go get',
  'npm uninstall',
  'pip uninstall',
  'gem uninstall',
  'cargo uninstall',
  'apt upgrade',
  'apt dist-upgrade',
  'yum update',
  'dnf update',
  'pacman -Syu',
  'apt install linux-image',
  'yum install kernel',
  'dnf install kernel',
  'init 6',
  'init 0',
  'systemctl status',
  'service status',
  'nc -zv',
  'update-rc.d ',
  'tail -f /var/log/',
  'cat /var/log/',
  // 2026-11-11（P5 第二步）：**普通命令不再硬拦** —— 只读查看 / 文本过滤 / 导航 /
  // 系统信息这类「结构上不写、不执行子进程」的命令由 `readonly-command-allowlist`
  // 放行；留在硬拦表里只会让 auto 档把正常操作判死。仍保留的是能**删除 / 覆盖 /
  // 改权限 / 就地写回 / 起子进程**的命令。
  // 2026-11-11（审批档扩容）：`rm` / `ln` / `find` / `chmod` 属「常见但可能不可逆」，
  // 改由 `AUTO_MODE_APPROVAL_TOKENS` 转人工审批；其中**递归/强删/777** 等明确危险形态
  // 仍由上方硬拦令牌拦死（`rm -rf`、`chmod 777` …）。`sed` / `awk` 保留硬拦：
  // 二者可执行任意命令（`sed e` / `awk system()`），按"任意代码执行 ⇒ deny"的既定政策不降级。
  // `find` 本体走审批档，但 `-exec*` / `-ok*` 是**执行任意命令**的形态 ⇒ 硬拦。
  // 带前后空格的元字符令牌按原文子串匹配（命令位锚定无法覆盖 `find . -exec` 这种中缀）。
  ' -exec ',
  ' -execdir ',
  ' -ok ',
  ' -okdir ',
  'g++ ',
  'wordlist ',
  'exploit ',
  'payload ',
  'shellcode ',
  'phishing ',
  'spoof ',
  'virus ',
  'malware ',
  'ransomware ',
  'trojan ',
  'worm ',
  'botnet ',
  // 2026-11-12（P4 复核）：这些是**注入特征关键词**（SQL 关键字 / PHP·JS 反射与回调
  // 函数名 / 环境变量名），不是可执行命令 —— 从 commandSpecs.ts 移回结构表，避免把
  // "注入特征"伪装成"命令语义"。判定行为不变。
  'UPDATE ',
  'DELETE ',
  'LD_PRELOAD',
  'ReflectionClass',
  'getMethod',
  'invoke',
  'call_user_func',
  'array_filter',
  'array_map',
  'usort',
  'uasort',
  'uksort',
  'social-engineer ',
];

export const AUTO_MODE_HARD_DENY_TOKENS: readonly string[] = [
  ...denyTokensFromSpecs(),
  ...STRUCTURAL_HARD_DENY_TOKENS,
];

/**
 * auto 模式**审批**令牌表 —— 由命令语义注册表派生（P1，2026-11-12）。
 *
 * 口径（保留历史语义）：命中**不拒绝**，转人工审批（`ask`）：
 *  - 文件搬运 / 写盘 / 权限位 / 归档 / 进程终止 / 依赖安装 / 容器与集群写子命令；
 *  - 危险子形态（`rm -rf`、`chmod 777`、`sudo cp …`）仍由硬拦表先判 ⇒ 仍是 deny。
 *
 * **新增写法只改 `commandSpecs.ts`**：`token` 自动进入本表，`equivalents` 自动进入
 * `expandTokenAliases()` 的等价展开。此处只保留**参数形态**令牌（不属于任何命令家族）。
 */
export const AUTO_MODE_APPROVAL_TOKENS = [
  ...approvalTokensFromSpecs(),
  // 参数形态令牌（无法用 CommandSpec 表达）
  '-itemtype symboliclink', // `New-Item -ItemType SymbolicLink` = `mklink`（ask）
  '-outfile', // 下载落盘（`iwr -OutFile`；此前只有 `http://` 触发 SSRF）
  ' -force', // `New-Item -Force` / `Set-Content -Force` 等覆盖既有文件的强写形态
];
