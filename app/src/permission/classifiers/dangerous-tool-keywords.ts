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
 * DANGEROUS_TOOL_KEYWORDS — 危险工具关键词（完整单词匹配）
 * 从 AutoModeClassifier.ts 提取（FSZ-003 拆分）。
 */

/**
 * 危险工具关键词列表
 */
export const DANGEROUS_TOOL_KEYWORDS = new Set([
  // 文件系统危险操作
  'rm',
  'del',
  'delete',
  'format',
  'mkfs',
  'dd',
  'chmod',
  'chown',
  'chgrp',
  'truncate',
  'fallocate',
  'ln',
  'mv',
  'cp',
  'rmdir',
  'mkdir',
  'touch',
  // 系统操作
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'init',
  'fdisk',
  'parted',
  'sfdisk',
  'cfdisk',
  'kill',
  'killall',
  'pkill',
  'killall5',
  // 权限提升
  'sudo',
  'su',
  'doas',
  'pkexec',
  'setuid',
  'setgid',
  // 网络操作
  'iptables',
  'ip6tables',
  'ufw',
  'firewalld',
  'nft',
  'mount',
  'umount',
  'swapoff',
  'swapon',
  'route',
  'ip',
  'ifconfig',
  'netstat',
  'ss',
  // 命令执行
  'eval',
  'exec',
  'source',
  'command',
  'builtin',
  // 远程获取/执行
  'curl',
  'wget',
  'fetch',
  'aria2',
  'axel',
  'lftp',
  // 网络扫描
  'nc',
  'netcat',
  'nmap',
  'dig',
  'host',
  'traceroute',
  'ping',
  'hping',
  'arping',
  'tcping',
  'mtr',
  'whois',
  // 加密/安全
  'openssl',
  'gpg',
  'cryptsetup',
  'keytool',
  'keystore',
  // 压缩/解压
  'tar',
  'zip',
  'unzip',
  '7z',
  'unrar',
  'gzip',
  'bzip2',
  'xz',
  // 脚本语言
  'python',
  'perl',
  'php',
  'ruby',
  'node',
  'lua',
  'tcl',
  'awk',
  'sed',
  // 包管理器
  'npm',
  'yarn',
  'pip',
  'gem',
  'cargo',
  'composer',
  'go',
  'rustup',
  // 容器/虚拟化
  'docker',
  'podman',
  'kubectl',
  'helm',
  'qemu',
  'kvm',
  'virsh',
  'vboxmanage',
  // 云服务
  'aws',
  'gcloud',
  'azure',
  'terraform',
  'ansible',
  'pulumi',
  'cloudformation',
  // 系统服务
  'systemctl',
  'service',
  'cron',
  'at',
  'anacron',
  'crontab',
  // 网络服务
  'sshd',
  'httpd',
  'nginx',
  'apache',
  'lighttpd',
  'haproxy',
  // 数据库
  'mysql',
  'postgres',
  'mariadb',
  'redis',
  'mongodb',
  'sqlite3',
  'oracle',
  // 进程管理
  'screen',
  'tmux',
  'nohup',
  'disown',
  'setsid',
  'nice',
  'renice',
  // 调试工具
  'strace',
  'ltrace',
  'gdb',
  'valgrind',
  'perf',
  'dtrace',
  'lldb',
  // 网络工具
  'tcpdump',
  'wireshark',
  'tshark',
  'socat',
  'netcat-openbsd',
  // SSH相关
  'ssh',
  'scp',
  'rsync',
  'sftp',
  'ssh-keygen',
  'ssh-agent',
  // 环境变量操作
  'env',
  'export',
  'unset',
  'declare',
  // 系统信息
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'grep',
  'find',
  'which',
  'whereis',
  // 用户管理
  'useradd',
  'userdel',
  'usermod',
  'groupadd',
  'groupdel',
  'groupmod',
  'passwd',
  // 文件权限
  'chattr',
  'setfacl',
  'getfacl',
  // 系统配置
  'sysctl',
  'modprobe',
  'rmmod',
  'insmod',
  'depmod',
  // 定时任务
  'at',
  'batch',
  'cron',
  'crontab',
  // 日志操作
  'journalctl',
  'dmesg',
  'rsyslogd',
  'syslogd',
  // 安全审计
  'auditctl',
  'auditd',
  'ausearch',
  'aureport',
  // SELinux/AppArmor
  'setenforce',
  'getenforce',
  'sestatus',
  'aa-status',
  'aa-enforce',
  // 网络配置
  'nmcli',
  'nmtui',
  'networkctl',
  'wpa_supplicant',
  'dhclient',
  // 时间同步
  'ntpd',
  'chronyd',
  'timedatectl',
  'ntpdate',
  // 硬件管理
  'lspci',
  'lsusb',
  'dmidecode',
  'hdparm',
  'smartctl',
  // 电源管理
  'pm-suspend',
  'pm-hibernate',
  'pm-poweroff',
  'acpi',
  // 备份恢复
  'rsync',
  'cpio',
  'dump',
  'restore',
  'tar',
  // Web服务
  'curl',
  'wget',
  'lynx',
  'links',
  'w3m',
  // 邮件
  'sendmail',
  'postfix',
  'exim',
  'dovecot',
  'mail',
  'mailx',
  // DNS
  'dig',
  'nslookup',
  'host',
  'dnsmasq',
  'bind',
  'named',
  // FTP
  'ftp',
  'vsftpd',
  'proftpd',
  'pure-ftpd',
  'lftp',
  // SMB/CIFS
  'smbclient',
  'smbd',
  'nmbd',
  'mount.cifs',
  // NFS
  'mount.nfs',
  'exportfs',
  'nfsd',
  // LDAP
  'ldapsearch',
  'ldapadd',
  'ldapmodify',
  'slapd',
  // Kerberos
  'kinit',
  'kdestroy',
  'klist',
  'krb5kdc',
  // Samba
  'smbpasswd',
  'testparm',
  'pdbedit',
  // 虚拟化
  'virt-install',
  'virt-clone',
  'virt-convert',
  'virt-manager',
  // 容器网络
  'cni',
  'flannel',
  'calico',
  'weave',
  'cilium',
  // Service Mesh
  'istioctl',
  'linkerd',
  'consul',
  'envoy',
  // CI/CD
  'git',
  'gitlab-runner',
  'jenkins',
  'gh',
  'gh-cli',
  // 监控
  'prometheus',
  'grafana-cli',
  'influx',
  'telegraf',
  'collectd',
  // 日志
  'fluentd',
  'logstash',
  'filebeat',
  'journalctl',
  // 安全扫描
  'nmap',
  'nessus',
  'openvas',
  'metasploit',
  'sqlmap',
  'burpsuite',
  // 破解工具
  'john',
  'hashcat',
  'hydra',
  'medusa',
  'crunch',
  'wordlist',
  // 取证工具
  'dd',
  'strings',
  'hexdump',
  'xxd',
  'foremost',
  'testdisk',
  // 逆向工程
  'objdump',
  'readelf',
  'nm',
  'ld',
  'strip',
  'upx',
  // 漏洞利用
  'msfconsole',
  'exploit',
  'payload',
  'shellcode',
  // 代理/隧道
  'proxychains',
  'tor',
  'sshuttle',
  'chisel',
  'frp',
  'ngrok',
  // 钓鱼
  'phishing',
  'spoof',
  'social-engineer',
  'evilginx',
  // 恶意软件
  'virus',
  'malware',
  'ransomware',
  'trojan',
  'worm',
  'botnet',
]);
