/**
 * 自动模式分类器
 * 用于自动判断工具使用是否安全
 */

/**
 * 分类器决策结果
 */
export interface ClassifierDecision {
  /**
   * 是否应该阻止
   */
  shouldBlock: boolean;
  /**
   * 阻止原因
   */
  reason?: string;
  /**
   * 分类器是否不可用
   */
  unavailable?: boolean;
  /**
   * 转录是否太长
   */
  transcriptTooLong?: boolean;
  /**
   * 分类器使用信息
   */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  };
  /**
   * 使用的模型
   */
  model?: string;
  /**
   * 执行耗时（毫秒）
   */
  durationMs?: number;
}

/**
 * 分类器接口
 */
export interface IAutoModeClassifier {
  /**
   * 分类工具使用
   * @param toolName 工具名称
   * @param input 工具输入
   * @param messages 对话历史
   * @returns 分类决策
   */
  classify(
    toolName: string,
    input: Record<string, unknown>,
    messages: Array<{ role: string; content: string }>
  ): Promise<ClassifierDecision>;

  /**
   * 检查工具是否在安全白名单中
   * @param toolName 工具名称
   * @returns 是否在白名单中
   */
  isAllowlistedTool(toolName: string): boolean;
}

/**
 * 安全工具白名单
 * 这些工具被认为是安全的，不需要分类器检查
 */
const SAFE_TOOLS = new Set([
  'read',
  'list',
  'search',
  'view',
  'cat',
  'pwd',
  'echo',
  'help',
  'info',
  'status',
  'version',
  'whoami',
]);

/**
 * 模拟自动模式分类器实现
 * 这是一个基础实现，实际项目中可以替换为真实的AI分类器
 */
export class AutoModeClassifier implements IAutoModeClassifier {
  /**
   * 分类器名称
   */
  readonly name = 'auto-mode';

  /**
   * 分类工具使用
   * @param toolName 工具名称
   * @param input 工具输入
   * @param messages 对话历史
   * @returns 分类决策
   */
  async classify(
    toolName: string,
    input: Record<string, unknown>,
    messages: Array<{ role: string; content: string }>
  ): Promise<ClassifierDecision> {
    const startTime = Date.now();

    try {
      // 检查是否是安全工具
      if (this.isAllowlistedTool(toolName)) {
        return {
          shouldBlock: false,
          reason: 'Tool is in safe allowlist',
          durationMs: Date.now() - startTime,
        };
      }

      // 简单的启发式规则
      const decision = this.heuristicClassify(toolName, input);

      return {
        ...decision,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      console.error('AutoModeClassifier error:', error);
      return {
        shouldBlock: true,
        unavailable: true,
        reason: 'Classifier unavailable',
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * 检查工具是否在安全白名单中
   * @param toolName 工具名称
   * @returns 是否在白名单中
   */
  isAllowlistedTool(toolName: string): boolean {
    const lowerName = toolName.toLowerCase();
    return SAFE_TOOLS.has(lowerName) || this.isPartialMatch(lowerName);
  }

  /**
   * 危险工具关键词列表
   */
  private readonly dangerousToolKeywords = new Set([
    // 文件系统危险操作
    'rm', 'del', 'delete', 'format', 'mkfs', 'dd',
    'chmod', 'chown', 'chgrp', 'truncate', 'fallocate',
    'ln', 'mv', 'cp', 'rmdir', 'mkdir', 'touch',
    // 系统操作
    'shutdown', 'reboot', 'halt', 'poweroff', 'init',
    'fdisk', 'parted', 'sfdisk', 'cfdisk',
    'kill', 'killall', 'pkill', 'killall5',
    // 权限提升
    'sudo', 'su', 'doas', 'pkexec', 'setuid', 'setgid',
    // 网络操作
    'iptables', 'ip6tables', 'ufw', 'firewalld', 'nft',
    'mount', 'umount', 'swapoff', 'swapon',
    'route', 'ip', 'ifconfig', 'netstat', 'ss',
    // 命令执行
    'eval', 'exec', 'source', 'command', 'builtin',
    // 远程获取/执行
    'curl', 'wget', 'fetch', 'aria2', 'axel', 'lftp',
    // 网络扫描
    'nc', 'netcat', 'nmap', 'dig', 'host', 'traceroute', 'ping',
    'hping', 'arping', 'tcping', 'mtr', 'whois',
    // 加密/安全
    'openssl', 'gpg', 'cryptsetup', 'keytool', 'keystore',
    // 压缩/解压
    'tar', 'zip', 'unzip', '7z', 'unrar', 'gzip', 'bzip2', 'xz',
    // 脚本语言
    'python', 'perl', 'php', 'ruby', 'node', 'lua', 'tcl', 'awk', 'sed',
    // 包管理器
    'npm', 'yarn', 'pip', 'gem', 'cargo', 'composer', 'go', 'rustup',
    // 容器/虚拟化
    'docker', 'podman', 'kubectl', 'helm', 'qemu', 'kvm', 'virsh', 'vboxmanage',
    // 云服务
    'aws', 'gcloud', 'azure', 'terraform', 'ansible', 'pulumi', 'cloudformation',
    // 系统服务
    'systemctl', 'service', 'cron', 'at', 'anacron', 'crontab',
    // 网络服务
    'sshd', 'httpd', 'nginx', 'apache', 'lighttpd', 'haproxy',
    // 数据库
    'mysql', 'postgres', 'mariadb', 'redis', 'mongodb', 'sqlite3', 'oracle',
    // 进程管理
    'screen', 'tmux', 'nohup', 'disown', 'setsid', 'nice', 'renice',
    // 调试工具
    'strace', 'ltrace', 'gdb', 'valgrind', 'perf', 'dtrace', 'lldb',
    // 网络工具
    'tcpdump', 'wireshark', 'tshark', 'socat', 'netcat-openbsd',
    // SSH相关
    'ssh', 'scp', 'rsync', 'sftp', 'ssh-keygen', 'ssh-agent',
    // 环境变量操作
    'env', 'export', 'unset', 'declare',
    // 系统信息
    'cat', 'head', 'tail', 'less', 'more', 'grep', 'find', 'which', 'whereis',
    // 用户管理
    'useradd', 'userdel', 'usermod', 'groupadd', 'groupdel', 'groupmod', 'passwd',
    // 文件权限
    'chattr', 'setfacl', 'getfacl',
    // 系统配置
    'sysctl', 'modprobe', 'rmmod', 'insmod', 'depmod',
    // 定时任务
    'at', 'batch', 'cron', 'crontab',
    // 日志操作
    'journalctl', 'dmesg', 'rsyslogd', 'syslogd',
    // 安全审计
    'auditctl', 'auditd', 'ausearch', 'aureport',
    // SELinux/AppArmor
    'setenforce', 'getenforce', 'sestatus', 'aa-status', 'aa-enforce',
    // 网络配置
    'nmcli', 'nmtui', 'networkctl', 'wpa_supplicant', 'dhclient',
    // 时间同步
    'ntpd', 'chronyd', 'timedatectl', 'ntpdate',
    // 硬件管理
    'lspci', 'lsusb', 'dmidecode', 'hdparm', 'smartctl',
    // 电源管理
    'pm-suspend', 'pm-hibernate', 'pm-poweroff', 'acpi',
    // 备份恢复
    'rsync', 'cpio', 'dump', 'restore', 'tar',
    // Web服务
    'curl', 'wget', 'lynx', 'links', 'w3m',
    // 邮件
    'sendmail', 'postfix', 'exim', 'dovecot', 'mail', 'mailx',
    // DNS
    'dig', 'nslookup', 'host', 'dnsmasq', 'bind', 'named',
    // FTP
    'ftp', 'vsftpd', 'proftpd', 'pure-ftpd', 'lftp',
    // SMB/CIFS
    'smbclient', 'smbd', 'nmbd', 'mount.cifs',
    // NFS
    'mount.nfs', 'exportfs', 'nfsd',
    // LDAP
    'ldapsearch', 'ldapadd', 'ldapmodify', 'slapd',
    // Kerberos
    'kinit', 'kdestroy', 'klist', 'krb5kdc',
    // Samba
    'smbpasswd', 'testparm', 'pdbedit',
    // 虚拟化
    'virt-install', 'virt-clone', 'virt-convert', 'virt-manager',
    // 容器网络
    'cni', 'flannel', 'calico', 'weave', 'cilium',
    // Service Mesh
    'istioctl', 'linkerd', 'consul', 'envoy',
    // CI/CD
    'git', 'gitlab-runner', 'jenkins', 'gh', 'gh-cli',
    // 监控
    'prometheus', 'grafana-cli', 'influx', 'telegraf', 'collectd',
    // 日志
    'fluentd', 'logstash', 'filebeat', 'journalctl',
    // 安全扫描
    'nmap', 'nessus', 'openvas', 'metasploit', 'sqlmap', 'burpsuite',
    // 破解工具
    'john', 'hashcat', 'hydra', 'medusa', 'crunch', 'wordlist',
    // 取证工具
    'dd', 'strings', 'hexdump', 'xxd', 'foremost', 'testdisk',
    // 逆向工程
    'objdump', 'readelf', 'nm', 'ld', 'strip', 'upx',
    // 漏洞利用
    'msfconsole', 'exploit', 'payload', 'shellcode',
    // 代理/隧道
    'proxychains', 'tor', 'sshuttle', 'chisel', 'frp', 'ngrok',
    // 钓鱼
    'phishing', 'spoof', 'social-engineer', 'evilginx',
    // 恶意软件
    'virus', 'malware', 'ransomware', 'trojan', 'worm', 'botnet',
  ]);

  /**
   * 危险命令模式列表
   */
  private readonly dangerousCommandPatterns = [
    'rm -rf',
    'rm -fr',
    'rm -rf /',
    'rm -rf *',
    'rm -rf /*',
    'del /s /q',
    'erase /f /s',
    'rd /s /q',
    'format',
    'mkfs',
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
    'sudo',
    'su root',
    'pkexec',
    'doas',
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
    'eval ',
    'exec ',
    'source ',
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
    'LD_PRELOAD=',
    'LD_SHOW_AUXV=',
    'LD_DEBUG=',
    '/etc/',
    '/sys/',
    '/proc/',
    '/usr/bin/',
    '/usr/sbin/',
    '/bin/',
    '/sbin/',
    '/var/',
    '/boot/',
    '/lib/',
    '/lib64/',
    '/root/',
    '/home/',
    '/tmp/',
    '/var/tmp/',
    '/run/',
    'C:\\',
    'D:\\',
    '\\\\.\\',
    '\\\\?\\',
    '/dev/',
    '/mnt/',
    '/media/',
    '/opt/',
    '/usr/local/',
    '../',
    '..\\',
    '/../',
    '\\..\\',
    '..//',
    './/..',
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
    'crontab',
    'at ',
    'batch ',
    'anacron',
    'nc ',
    'netcat ',
    'telnet ',
    'ftp ',
    'sftp ',
    'ssh ',
    'ncat ',
    'socat ',
    'curl ',
    'wget ',
    'systemctl start',
    'systemctl stop',
    'systemctl restart',
    'systemctl enable',
    'systemctl disable',
    'service ',
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
    'echo -n',
    'echo -e',
    'printf ',
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
    'ptrace',
    'inject',
    'hook',
    'LD_PRELOAD',
    '/proc/mem',
    '/dev/mem',
    '/dev/kmem',
    'kmod',
    'insmod',
    'rmmod',
    'modprobe',
    'tcpdump ',
    'tshark ',
    'wireshark ',
    'nmap ',
    'masscan ',
    'zmap ',
    'unicornscan ',
    'hping ',
    'arpspoof ',
    'dnsspoof ',
    'tcpspoof ',
    'ping -f',
    'ping -s',
    'flood',
    'synflood',
    'ddos',
    'UNION SELECT',
    'DROP TABLE',
    'INSERT INTO',
    'UPDATE ',
    'DELETE ',
    'OR 1=1',
    'AND 1=1',
    'OR \'x\'=\'x',
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
    ' | ',
    ' || ',
    ' & ',
    ' && ',
    ' ` ',
    ' $(',
    '`',
    '`',
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
    'ReflectionClass',
    'getMethod',
    'invoke',
    'call_user_func',
    'array_filter',
    'array_map',
    'usort',
    'uasort',
    'uksort',
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
    'sleep ',
    'usleep ',
    'nanosleep ',
    'pause ',
    'wait ',
    'yes ',
    'cat /dev/zero',
    'dd if=/dev/zero',
    'while true',
    'env',
    'printenv',
    'export',
    'declare -x',
    '/etc/passwd',
    '/etc/shadow',
    '/etc/group',
    '/etc/gshadow',
    '/etc/hosts',
    '/etc/resolv.conf',
    '/etc/ssh/',
    '/etc/sudoers',
    '/root/.ssh/',
    '/home/*/.ssh/',
    '/var/log/',
    '/var/log/auth.log',
    'cat /root/.ssh/id_rsa',
    'cat /home/*/.ssh/id_rsa',
    'rm /var/log/',
    'cat /dev/null >',
    'truncate -s 0',
    'iptables -F',
    'iptables -X',
    'ip6tables -F',
    'ip6tables -X',
    'ufw disable',
    'firewall-cmd --set-default-zone=trusted',
    'echo PermitRootLogin yes >>',
    'echo PasswordAuthentication yes >>',
    'useradd ',
    'userdel ',
    'usermod ',
    'groupadd ',
    'groupdel ',
    'groupmod ',
    'passwd ',
    'chpasswd',
    'openssl passwd',
    'ssh-keygen -f',
    'ssh-keygen -t',
    'mkfifo',
    'named pipe',
    'reverse shell',
    'bind shell',
    'script ',
    'scriptreplay ',
    'ttyrec ',
    'xinput ',
    'evtest ',
    'sniff ',
    'keylog ',
    'screencap ',
    'scrot ',
    'import ',
    'xwd ',
    'fswebcam ',
    'cheese ',
    'guvcview ',
    'arecord ',
    'sox ',
    'ffmpeg ',
    'aplay ',
    'mpg123 ',
    'ffplay ',
    'lsusb ',
    'usb-devices ',
    'usbmount ',
    'mount /dev/cdrom',
    'mount /dev/dvd',
    'eject ',
    'lsblk ',
    'fdisk ',
    'parted ',
    'blkid ',
    'df ',
    'du ',
    'mdadm ',
    'lvm ',
    'vgcreate ',
    'lvcreate ',
    'fsck ',
    'e2fsck ',
    'xfs_repair ',
    'mkfs ',
    'mke2fs ',
    'mkfs.ext4 ',
    'mkfs.xfs ',
    'mkfs.btrfs ',
    'sfdisk ',
    'cfdisk ',
    'gdisk ',
    'parted ',
    'shred ',
    'dd if=/dev/urandom',
    'dd if=/dev/zero',
    'testdisk ',
    'photorec ',
    'foremost ',
    'scalpel ',
    'tar ',
    'cpio ',
    'dump ',
    'restore ',
    'rsync ',
    'gzip ',
    'bzip2 ',
    'xz ',
    'zip ',
    'unzip ',
    '7z ',
    'rar ',
    'unrar ',
    'gpg -c',
    'openssl enc',
    'zip -e',
    '7z -p',
    'mount.nfs ',
    'mount.cifs ',
    'mount.smbfs ',
    'mount.sshfs ',
    'hdfs ',
    'glusterfs ',
    'ceph ',
    'nfs ',
    'git ',
    'svn ',
    'hg ',
    'bzr ',
    'apt ',
    'apt-get ',
    'dpkg ',
    'rpm ',
    'yum ',
    'dnf ',
    'pacman ',
    'zypper ',
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
    'reboot',
    'shutdown',
    'halt',
    'poweroff',
    'init 6',
    'init 0',
    'systemctl status',
    'service status',
    'uptime',
    'who ',
    'w ',
    'uname ',
    'hostname ',
    'domainname ',
    'dnsdomainname ',
    'lspci ',
    'lsusb ',
    'dmidecode ',
    'hdparm ',
    'smartctl ',
    'lscpu ',
    'free ',
    'cat /proc/cpuinfo',
    'cat /proc/meminfo',
    'cat /proc/version',
    'cat /proc/cmdline',
    'ps ',
    'top ',
    'htop ',
    'pidof ',
    'pgrep ',
    'pkill ',
    'free ',
    'vmstat ',
    'mpstat ',
    'iostat ',
    'df ',
    'ifconfig ',
    'ip ',
    'route ',
    'netstat ',
    'ss ',
    'arp ',
    'hostname -I',
    'ping ',
    'traceroute ',
    'mtr ',
    'curl ',
    'wget ',
    'nc -zv',
    'dig ',
    'nslookup ',
    'host ',
    'dnsmasq ',
    'systemctl ',
    'service ',
    'chkconfig ',
    'update-rc.d ',
    'journalctl ',
    'dmesg ',
    'tail -f /var/log/',
    'cat /var/log/',
    'logrotate ',
    'rsyslogd ',
    'syslogd ',
    'useradd ',
    'userdel ',
    'usermod ',
    'groupadd ',
    'groupdel ',
    'groupmod ',
    'passwd ',
    'id ',
    'whoami ',
    'who ',
    'last ',
    'lastlog ',
    'groups ',
    'getent group',
    'getent passwd',
    'chmod ',
    'chown ',
    'chgrp ',
    'chattr ',
    'setfacl ',
    'getfacl ',
    'ls ',
    'dir ',
    'pwd ',
    'cd ',
    'mkdir ',
    'rmdir ',
    'touch ',
    'ln ',
    'mv ',
    'cp ',
    'rm ',
    'cat ',
    'head ',
    'tail ',
    'less ',
    'more ',
    'view ',
    'nano ',
    'vi ',
    'vim ',
    'emacs ',
    'find ',
    'grep ',
    'egrep ',
    'fgrep ',
    'locate ',
    'which ',
    'whereis ',
    'diff ',
    'cmp ',
    'comm ',
    'diff3 ',
    'sdiff ',
    'sed ',
    'awk ',
    'cut ',
    'paste ',
    'sort ',
    'uniq ',
    'tr ',
    'wc ',
    'iconv ',
    'dos2unix ',
    'unix2dos ',
    'toascii ',
    'toupper ',
    'tolower ',
    'md5sum ',
    'sha1sum ',
    'sha256sum ',
    'sha512sum ',
    'cksum ',
    'sum ',
    'openssl ',
    'gpg ',
    'cryptsetup ',
    'keytool ',
    'keystore ',
    'date ',
    'cal ',
    'time ',
    'timeout ',
    'sleep ',
    'usleep ',
    'bc ',
    'dc ',
    'expr ',
    'let ',
    'tr ',
    'sed ',
    'awk ',
    'cut ',
    'paste ',
    'join ',
    'split ',
    'csplit ',
    'sort ',
    'uniq ',
    'comm ',
    'diff ',
    'cmp ',
    'wc ',
    'uniq -c',
    'sort -n',
    'gcc ',
    'g++ ',
    'clang ',
    'make ',
    'cmake ',
    'autoconf ',
    'automake ',
    'python ',
    'perl ',
    'ruby ',
    'node ',
    'php ',
    'lua ',
    'tcl ',
    'awk ',
    'sed ',
    'gdb ',
    'lldb ',
    'strace ',
    'ltrace ',
    'valgrind ',
    'perf ',
    'dtrace ',
    'top ',
    'htop ',
    'iotop ',
    'iftop ',
    'vmstat ',
    'iostat ',
    'mpstat ',
    'pidstat ',
    'prometheus ',
    'grafana-cli ',
    'influx ',
    'telegraf ',
    'collectd ',
    'fluentd ',
    'logstash ',
    'filebeat ',
    'journalctl ',
    'nmap ',
    'nessus ',
    'openvas ',
    'metasploit ',
    'sqlmap ',
    'burpsuite ',
    'john ',
    'hashcat ',
    'hydra ',
    'medusa ',
    'crunch ',
    'wordlist ',
    'dd ',
    'strings ',
    'hexdump ',
    'xxd ',
    'foremost ',
    'testdisk ',
    'objdump ',
    'readelf ',
    'nm ',
    'ld ',
    'strip ',
    'upx ',
    'msfconsole ',
    'exploit ',
    'payload ',
    'shellcode ',
    'proxychains ',
    'tor ',
    'sshuttle ',
    'chisel ',
    'frp ',
    'ngrok ',
    'phishing ',
    'spoof ',
    'social-engineer ',
    'evilginx ',
    'virus ',
    'malware ',
    'ransomware ',
    'trojan ',
    'worm ',
    'botnet '
  ];

  /**
   * 敏感路径模式
   */
  private readonly sensitivePathPatterns = [
    // Unix/Linux系统目录
    '/etc/', '/sys/', '/proc/', '/usr/bin/', '/usr/sbin/',
    '/bin/', '/sbin/', '/var/', '/boot/', '/lib/', '/lib64/',
    '/root/', '/home/', '/tmp/', '/var/tmp/', '/run/',
    '/dev/', '/mnt/', '/media/', '/opt/', '/usr/local/',
    '/srv/', '/kernel/', '/firmware/', '/etc/passwd', '/etc/shadow',
    '/etc/group', '/etc/gshadow', '/etc/sudoers', '/etc/ssh/',
    '/root/.ssh/', '/home/*/.ssh/', '/var/log/', '/var/log/auth.log',
    '/var/log/syslog', '/var/log/secure', '/var/log/messages',
    '/etc/resolv.conf', '/etc/hosts', '/etc/hostname', '/etc/fstab',
    '/etc/crontab', '/etc/anacrontab', '/var/spool/cron/',
    '/usr/lib/', '/usr/share/', '/usr/include/', '/usr/src/',
    '/etc/profile', '/etc/bashrc', '/etc/zshrc', '/etc/profile.d/',
    '/etc/security/', '/etc/pam.d/', '/etc/selinux/', '/etc/apparmor/',
    '/etc/audit/', '/etc/rsyslog.conf', '/etc/systemd/',
    '/var/run/', '/var/lock/', '/var/lib/', '/var/opt/',
    '/var/spool/', '/var/mail/', '/var/cache/', '/var/log/',
    '/tmp/', '/dev/shm/', '/run/shm/', '/run/user/',
    '/proc/sys/', '/proc/kcore', '/proc/kmsg', '/proc/self/',
    '/sys/kernel/', '/sys/devices/', '/sys/class/', '/sys/block/',
    // Windows系统目录
    'C:\\', 'D:\\', 'E:\\', 'F:\\',
    '\\\\.\\', '\\\\?\\',
    'C:\\Windows\\', 'C:\\Windows\\System32\\', 'C:\\Windows\\SysWOW64\\',
    'C:\\Program Files\\', 'C:\\Program Files (x86)\\',
    'C:\\Users\\', 'C:\\Users\\Administrator\\', 'C:\\Users\\Default\\',
    'C:\\Users\\Public\\', 'C:\\Documents and Settings\\',
    'C:\\ProgramData\\', 'C:\\WINDOWS\\system32\\config\\',
    'C:\\WINDOWS\\system32\\drivers\\', 'C:\\WINDOWS\\system32\\services\\',
    'C:\\WINDOWS\\system32\\cmd.exe', 'C:\\WINDOWS\\system32\\powershell.exe',
    'C:\\WINDOWS\\system32\\wscript.exe', 'C:\\WINDOWS\\system32\\cscript.exe',
    'C:\\WINDOWS\\system32\\reg.exe', 'C:\\WINDOWS\\system32\\net.exe',
    'C:\\WINDOWS\\system32\\sc.exe', 'C:\\WINDOWS\\system32\\tasklist.exe',
    'C:\\WINDOWS\\system32\\taskkill.exe', 'C:\\WINDOWS\\system32\\at.exe',
    'C:\\WINDOWS\\system32\\schtasks.exe', 'C:\\WINDOWS\\system32\\mshta.exe',
    // 网络共享路径
    '\\\\localhost\\', '\\\\127.0.0.1\\', '\\\\*\\',
    'smb://', 'cifs://', 'nfs://', 'afp://',
    // 云存储路径
    's3://', 'gs://', 'azure://', 'wasb://',
    // 特殊路径
    '~/', '~/.ssh/', '~/.aws/', '~/.config/',
    '/var/run/secrets/', '/run/secrets/', '/etc/secrets/',
    '/var/lib/docker/', '/var/lib/kubelet/', '/etc/kubernetes/',
    '/usr/local/bin/', '/usr/local/sbin/', '/opt/bin/',
    '/snap/', '/var/snap/', '/srv/snap/',
  ];

  /**
   * 环境变量污染模式
   */
  private readonly envPollutionPatterns = [
    // 路径变量
    'PATH=', 'LD_PRELOAD=', 'LD_LIBRARY_PATH=', 'LD_AUDIT=',
    'LD_SHOW_AUXV=', 'LD_DEBUG=', 'LD_TRACE_LOADED_OBJECTS=',
    'LD_BIND_NOW=', 'LD_WARN=', 'LD_NOWARN=',
    'LD_ORIGIN_PATH=', 'LD_USE_LOAD_BIAS=',
    // 语言路径变量
    'PYTHONPATH=', 'PERL5LIB=', 'RUBYLIB=', 'NODE_PATH=',
    'JAVA_HOME=', 'CLASSPATH=', 'GOPATH=', 'CARGO_HOME=',
    'RUSTUP_HOME=', 'GO111MODULE=', 'PYTHONIOENCODING=',
    // Shell变量
    'IFS=', 'HOME=', 'USER=', 'SHELL=', 'LOGNAME=',
    'TERM=', 'PS1=', 'PROMPT=', 'HISTFILE=',
    'HISTSIZE=', 'HISTCONTROL=', 'HISTIGNORE=', 'HISTTIMEFORMAT=',
    // 系统变量
    'USERNAME=', 'HOSTNAME=', 'DOMAINNAME=', 'MAIL=',
    'TZ=', 'LANG=', 'LC_ALL=', 'LC_COLLATE=',
    'LC_CTYPE=', 'LC_MESSAGES=', 'LC_MONETARY=', 'LC_NUMERIC=',
    'LC_TIME=', 'PWD=', 'OLDPWD=', 'CDPATH=',
    // 网络变量
    'http_proxy=', 'https_proxy=', 'ftp_proxy=', 'socks_proxy=',
    'ALL_PROXY=', 'NO_PROXY=', 'PROXY=', 'SOCKS_SERVER=',
    // 安全变量
    'SSH_AUTH_SOCK=', 'SSH_AGENT_PID=', 'GPG_AGENT_INFO=',
    'KRB5CCNAME=', 'KRB5_CONFIG=', 'KRB5_KTNAME=',
    // 云凭证变量
    'AWS_ACCESS_KEY_ID=', 'AWS_SECRET_ACCESS_KEY=', 'AWS_SESSION_TOKEN=',
    'AWS_PROFILE=', 'AWS_DEFAULT_REGION=', 'AWS_CONFIG_FILE=',
    'GOOGLE_APPLICATION_CREDENTIALS=', 'GCLOUD_PROJECT=',
    'AZURE_CLIENT_ID=', 'AZURE_CLIENT_SECRET=', 'AZURE_TENANT_ID=',
    'AZURE_SUBSCRIPTION_ID=', 'ARM_CLIENT_ID=', 'ARM_CLIENT_SECRET=',
    'ARM_TENANT_ID=', 'ARM_SUBSCRIPTION_ID=',
    // 容器变量
    'DOCKER_HOST=', 'DOCKER_API_VERSION=', 'DOCKER_CERT_PATH=',
    'DOCKER_TLS_VERIFY=', 'KUBECONFIG=', 'KUBE_CONFIG=',
    // 编译变量
    'CC=', 'CXX=', 'CFLAGS=', 'CXXFLAGS=', 'LDFLAGS=',
    'CPPFLAGS=', 'MAKEFLAGS=', 'AUTOMAKE_FLAGS=', 'AUTOCONF_FLAGS=',
    // 调试变量
    'DEBUG=', 'VERBOSE=', 'TRACE=', 'LOG_LEVEL=',
    'NODE_ENV=', 'RAILS_ENV=', 'DJANGO_SETTINGS_MODULE=',
    // 临时目录变量
    'TMPDIR=', 'TEMP=', 'TMP=', 'XDG_RUNTIME_DIR=',
    // 其他危险变量
    'LD_PRELOAD_=', '_=', 'SHLVL=', 'PPID=', 'PID=',
    'UID=', 'GID=', 'EUID=', 'EGID=',
    'TERMINFO=', 'INFOPATH=', 'MANPATH=', 'PAGER=',
    'EDITOR=', 'VISUAL=', 'LESS=', 'MORE=',
    'SHELLOPTS=', 'BASHOPTS=', 'POSIXLY_CORRECT=', 'POSIX_ME_HARDER=',
    'CDPATH=', 'FIGNORE=', 'IGNOREEOF=', 'INPUTRC=',
    'KEYTIMEOUT=', 'LANG=', 'LC_ALL=', 'LINES=',
    'COLUMNS=', 'LS_COLORS=', 'LS_OPTIONS=', 'MAILCHECK=',
    'PATH_DIRS=', 'POSIX_CORRECT=', 'PROMPT_COMMAND=', 'REPLY=',
    'SECONDS=', 'SHELL=', 'SHLVL=', 'TIMEFORMAT=',
    'TMOUT=', 'UID=', 'USER=', '_=',
  ];

  /**
   * Unicode零宽字符模式
   */
  private readonly zeroWidthPatterns = [
    // 零宽空格
    '\u200B', '\u200C', '\u200D', '\u200E', '\u200F',
    // 双向控制字符
    '\uFEFF', '\u202A', '\u202B', '\u202C', '\u202D', '\u202E',
    // 阿拉伯文双向字符
    '\u061C', '\u200F', '\u202B', '\u202D',
    // 其他零宽字符
    '\u180E', '\u200B', '\u200C', '\u200D', '\uFEFF',
    // 不可见控制字符
    '\u0000', '\u0001', '\u0002', '\u0003', '\u0004', '\u0005',
    '\u0006', '\u0007', '\u0008', '\u000B', '\u000C', '\u000E',
    '\u000F', '\u0010', '\u0011', '\u0012', '\u0013', '\u0014',
    '\u0015', '\u0016', '\u0017', '\u0018', '\u0019', '\u001A',
    '\u001B', '\u001C', '\u001D', '\u001E', '\u001F',
    // 空格变体
    '\u00A0', '\u1680', '\u2000', '\u2001', '\u2002', '\u2003',
    '\u2004', '\u2005', '\u2006', '\u2007', '\u2008', '\u2009',
    '\u200A', '\u202F', '\u205F', '\u3000',
    // 组合标记
    '\u0300', '\u0301', '\u0302', '\u0303', '\u0304', '\u0305',
    '\u0306', '\u0307', '\u0308', '\u0309', '\u030A', '\u030B',
    '\u030C', '\u030D', '\u030E', '\u030F', '\u0310', '\u0311',
    '\u0312', '\u0313', '\u0314', '\u0315', '\u0316', '\u0317',
    '\u0318', '\u0319', '\u031A', '\u031B', '\u031C', '\u031D',
    '\u031E', '\u031F', '\u0320', '\u0321', '\u0322', '\u0323',
    '\u0324', '\u0325', '\u0326', '\u0327', '\u0328', '\u0329',
    '\u032A', '\u032B', '\u032C', '\u032D', '\u032E', '\u032F',
    '\u0330', '\u0331', '\u0332', '\u0333', '\u0334', '\u0335',
    '\u0336', '\u0337', '\u0338', '\u0339', '\u033A', '\u033B',
    '\u033C', '\u033D', '\u033E', '\u033F', '\u0340', '\u0341',
    '\u0342', '\u0343', '\u0344', '\u0345', '\u0346', '\u0347',
    '\u0348', '\u0349', '\u034A', '\u034B', '\u034C', '\u034D',
    '\u034E', '\u034F', '\u0350', '\u0351', '\u0352', '\u0353',
    '\u0354', '\u0355', '\u0356', '\u0357', '\u0358', '\u0359',
    '\u035A', '\u035B', '\u035C', '\u035D', '\u035E', '\u035F',
    '\u0360', '\u0361', '\u0362', '\u0363', '\u0364', '\u0365',
    '\u0366', '\u0367', '\u0368', '\u0369', '\u036A', '\u036B',
    '\u036C', '\u036D', '\u036E', '\u036F',
  ];

  /**
   * 启发式分类
   * @param toolName 工具名称
   * @param input 工具输入
   * @returns 分类决策
   */
  private heuristicClassify(
    toolName: string,
    input: Record<string, unknown>
  ): ClassifierDecision {
    const lowerToolName = toolName.toLowerCase();

    // 检查危险工具关键词（使用完整单词匹配，避免子字符串误匹配）
    for (const dangerous of this.dangerousToolKeywords) {
      // 只匹配完整单词：工具名等于关键词，或以关键词开头后跟下划线/连字符，或包含关键词作为完整部分
      const pattern = new RegExp(`(^${dangerous}$)|(^${dangerous}[_-])|([_-]${dangerous}$)|([_-]${dangerous}[_-])`);
      if (pattern.test(lowerToolName)) {
        return {
          shouldBlock: true,
          reason: `Tool "${toolName}" contains dangerous keyword: "${dangerous}"`,
        };
      }
    }

    // 检查输入中的危险命令模式
    const inputString = JSON.stringify(input).toLowerCase();
    
    // 检查Unicode零宽字符注入
    const zeroWidthResult = this.detectZeroWidthCharacters(inputString);
    if (zeroWidthResult) {
      return zeroWidthResult;
    }

    // 检查空字节注入
    const nullByteResult = this.detectNullByteInjection(inputString);
    if (nullByteResult) {
      return nullByteResult;
    }

    // 检查Zsh equals expansion攻击
    const zshResult = this.detectZshEqualsExpansion(inputString);
    if (zshResult) {
      return zshResult;
    }

    // 检查编码攻击（Base64、URL编码等）
    const encodingResult = this.detectEncodingAttack(inputString);
    if (encodingResult) {
      return encodingResult;
    }

    // 检查危险命令模式
    for (const pattern of this.dangerousCommandPatterns) {
      if (inputString.includes(pattern)) {
        return {
          shouldBlock: true,
          reason: `Input contains dangerous command pattern: "${pattern}"`,
        };
      }
    }

    // 检查敏感路径访问
    for (const pathPattern of this.sensitivePathPatterns) {
      if (inputString.includes(pathPattern.toLowerCase())) {
        return {
          shouldBlock: true,
          reason: `Input attempts to access sensitive path: "${pathPattern}"`,
        };
      }
    }

    // 检查环境变量污染
    for (const envPattern of this.envPollutionPatterns) {
      if (inputString.includes(envPattern)) {
        return {
          shouldBlock: true,
          reason: `Input attempts to modify critical environment variable: "${envPattern}"`,
        };
      }
    }

    // 检查路径遍历
    const pathTraversalResult = this.detectPathTraversal(inputString);
    if (pathTraversalResult) {
      return pathTraversalResult;
    }

    // 检查管道和重定向
    const pipeResult = this.detectPipeAndRedirect(inputString);
    if (pipeResult) {
      return pipeResult;
    }

    // 检查SQL注入
    const sqlResult = this.detectSqlInjection(inputString);
    if (sqlResult) {
      return sqlResult;
    }

    // 检查XSS攻击
    const xssResult = this.detectXssAttack(inputString);
    if (xssResult) {
      return xssResult;
    }

    // 检查命令注入
    const cmdInjectionResult = this.detectCommandInjection(inputString);
    if (cmdInjectionResult) {
      return cmdInjectionResult;
    }

    // 检查反序列化攻击
    const deserializationResult = this.detectDeserializationAttack(inputString);
    if (deserializationResult) {
      return deserializationResult;
    }

    // 检查正则表达式DoS攻击（ReDoS）
    const redosResult = this.detectReDoSAttack(inputString);
    if (redosResult) {
      return redosResult;
    }

    // 检查服务器端请求伪造（SSRF）
    const ssrfResult = this.detectSSRFAttack(inputString);
    if (ssrfResult) {
      return ssrfResult;
    }

    // 检查文件包含攻击
    const fileInclusionResult = this.detectFileInclusion(inputString);
    if (fileInclusionResult) {
      return fileInclusionResult;
    }

    // 检查LDAP注入攻击
    const ldapResult = this.detectLDAPInjection(inputString);
    if (ldapResult) {
      return ldapResult;
    }

    // 检查XML外部实体攻击（XXE）
    const xxeResult = this.detectXXEAttack(inputString);
    if (xxeResult) {
      return xxeResult;
    }

    // 检查模板注入攻击
    const templateResult = this.detectTemplateInjection(inputString);
    if (templateResult) {
      return templateResult;
    }

    // 检查请求走私攻击
    const smugglingResult = this.detectRequestSmuggling(inputString);
    if (smugglingResult) {
      return smugglingResult;
    }

    // 检查WebSocket劫持攻击
    const websocketResult = this.detectWebSocketAttack(inputString);
    if (websocketResult) {
      return websocketResult;
    }

    // 检查DNS隧道攻击
    const dnsTunnelResult = this.detectDNSTunnel(inputString);
    if (dnsTunnelResult) {
      return dnsTunnelResult;
    }

    // 默认允许
    return {
      shouldBlock: false,
      reason: 'Action appears safe',
    };
  }

  /**
   * 检测Unicode零宽字符注入
   * @param input 输入字符串
   * @returns 检测结果
   */
  private detectZeroWidthCharacters(input: string): ClassifierDecision | null {
    for (const zeroWidth of this.zeroWidthPatterns) {
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
  private detectNullByteInjection(input: string): ClassifierDecision | null {
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
  private detectZshEqualsExpansion(input: string): ClassifierDecision | null {
    // Zsh equals expansion模式：=command
    const zshPatterns = ['=rm', '=sh', '=bash', '=cp', '=mv', '=cat', '=echo',
                         '=kill', '=sudo', '=su', '=curl', '=wget', '=python',
                         '=perl', '=ruby', '=node', '=gcc', '=make', '=docker',
                         '=kubectl', '=ssh', '=scp', '=rsync', '=git', '=npm',
                         '=pip', '=gem', '=cargo', '=go', '=rustup', '=composer'];
    
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
  private detectEncodingAttack(input: string): ClassifierDecision | null {
    // 检查Base64编码模式
    if (input.includes('base64') && (input.includes('-d') || input.includes('--decode'))) {
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
   * 检测路径遍历攻击
   * @param input 输入字符串
   * @returns 检测结果
   */
  private detectPathTraversal(input: string): ClassifierDecision | null {
    // 标准路径遍历模式
    const traversalPatterns = [
      '../', '..\\', '/../', '\\..\\', '..//', './/..',
      '.../', '..../', '..\\..\\', '../..',
      // URL编码版本
      '%2e%2e/', '%2e%2e\\', '%2f%2e%2e', '%5c%2e%2e',
      // Unicode编码版本
      '%u002e%u002e/', '%u002e%u002e\\',
      // 双重编码版本
      '%252e%252e/', '%252e%252e\\',
      // 其他变体
      '.%2e/', '.%2e\\', '%2e./', '%2e.\\',
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
  private detectPipeAndRedirect(input: string): ClassifierDecision | null {
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
   * 检测SQL注入攻击
   * @param input 输入字符串
   * @returns 检测结果
   */
  private detectSqlInjection(input: string): ClassifierDecision | null {
    const sqlPatterns = [
      'union select', 'drop table', 'insert into', 'update ', 'delete ',
      'or 1=1', 'and 1=1', 'or \'x\'=\'x', 'and \'x\'=\'x',
      'or 1=1--', 'and 1=1--', ';drop table', ';delete from',
      ';insert into', ';update', 'select 1', 'select *',
      'from users', 'from table', 'where 1=1', 'having 1=1',
      'order by', 'group by', 'limit 1', 'offset 0',
      'union all', 'union distinct', 'cross join', 'inner join',
      'left join', 'right join', 'full join', 'natural join',
      'exec sp_', 'execute sp_', 'xp_cmdshell', 'sp_configure',
      'declare @', 'create table', 'alter table', 'truncate table',
      'drop database', 'create database', 'backup database',
      'restore database', 'grant all', 'revoke all', 'deny all',
      'with encryption', 'waitfor delay', 'if exists', 'while 1=1',
      'begin transaction', 'commit transaction', 'rollback transaction',
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
  private detectXssAttack(input: string): ClassifierDecision | null {
    const xssPatterns = [
      '<script>', '</script>', 'javascript:', 'onclick=', 'onload=',
      'onmouseover=', 'onmousemove=', 'onkeydown=', 'onkeyup=',
      'onfocus=', 'onblur=', 'onsubmit=', 'onreset=',
      'alert(', 'prompt(', 'confirm(', 'eval(',
      'document.cookie', 'document.write', 'window.location',
      'document.location', 'document.createElement', 'innerHTML',
      'outerHTML', 'appendChild', 'insertBefore', 'replaceChild',
      'setTimeout(', 'setInterval(', 'new Function(',
      'String.fromCharCode', 'unescape(', 'escape(',
      'decodeURI(', 'decodeURIComponent(',
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
  private detectCommandInjection(input: string): ClassifierDecision | null {
    const injectionPatterns = [
      // 命令替换
      '$(', '`', '${', '${{',
      // 子shell
      'bash -c', 'sh -c', 'zsh -c', 'ksh -c',
      // Python执行
      'python -c', 'python3 -c', 'python2 -c',
      // Perl执行
      'perl -e', 'perl -E',
      // Ruby执行
      'ruby -e', 'ruby -E',
      // Node执行
      'node -e', 'node --eval',
      // PHP执行
      'php -r', 'php -f',
      // Lua执行
      'lua -e', 'lua -l',
      // Tcl执行
      'tclsh -c', 'wish -c',
      // 远程执行
      'curl ', 'wget ', 'nc ', 'netcat ',
      // 管道执行
      '| bash', '| sh', '| zsh', '| ksh',
      // Base64解码执行
      'base64 -d |', 'echo | base64 -d',
      // 环境变量执行
      '${IFS}', '${RANDOM}', '${UID}', '${USER}',
      // eval执行
      'eval ', 'eval(', 'system(', 'exec(',
      // 反射执行
      'call_user_func', 'create_function',
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
  private detectDeserializationAttack(input: string): ClassifierDecision | null {
    const deserializationPatterns = [
      // PHP反序列化（使用更具体的模式避免误报）
      '"O":', '"C":', 'O:[0-9]+:', 'C:[0-9]+:', '"a":', '"s":', '"i":', '"d":', '"N";',
      '__wakeup', '__destruct', '__construct', '__call',
      '__callStatic', '__get', '__set', '__isset', '__unset',
      '__sleep', '__toString', '__invoke', '__set_state',
      // Java反序列化
      'java.io.ObjectInputStream', 'readObject()',
      'org.apache.commons.collections', 'InvokerTransformer',
      'Runtime.exec', 'ProcessBuilder',
      // Python反序列化
      'pickle.load', 'pickle.loads', 'cPickle.load', 'cPickle.loads',
      'marshal.load', 'marshal.loads',
      // Node.js反序列化
      'JSON.parse', 'Buffer.from', 'eval(',
      // 通用反序列化特征
      'serialize(', 'unserialize(', 'deserialize(',
      'base64_decode(', 'decodeBase64(', 'fromBase64(',
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
   * 检测正则表达式DoS攻击（ReDoS）
   * @param input 输入字符串
   * @returns 检测结果
   */
  private detectReDoSAttack(input: string): ClassifierDecision | null {
    const redosPatterns = [
      // 灾难性回溯模式
      '(a+)+', '(a++)+', '(a*)*', '(a+){1,}', '(a+){2,}',
      '(a|aa)+', '(ab|a)+', '(a|b)*c', '([ab]+)+c',
      // 嵌套量词
      '.*.*', '.+.*', '.*.+', '.+.+',
      // 重复组
      '(.+)+', '(.++)+', '([^@]+)+@',
      // 高复杂度模式
      '(?:a|b)*c', '(?:a|b)+c', '(a|b)+$',
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
  private detectSSRFAttack(input: string): ClassifierDecision | null {
    const ssrfPatterns = [
      // 本地IP地址
      '127.0.0.1', 'localhost', '0.0.0.0',
      '10.', '172.16.', '172.17.', '172.18.', '172.19.',
      '172.20.', '172.21.', '172.22.', '172.23.',
      '172.24.', '172.25.', '172.26.', '172.27.',
      '172.28.', '172.29.', '172.30.', '172.31.',
      '192.168.', '169.254.',
      // IPv6本地地址
      '::1', '::ffff:', 'fe80:', 'fc00:', 'fd00:',
      // 元字符绕过
      '127。0。0。1', '127\\.0\\.0\\.1', '127%2E0%2E0%2E1',
      '0177.000.000.001', '0x7f.0x0.0x0.0x1',
      // 云元数据端点
      '169.254.169.254', 'instance-data', 'metadata.google.internal',
      '100.100.100.200', // Aliyun
      // URL协议
      'http://', 'https://', 'ftp://', 'gopher://', 'file://',
      'ldap://', 'ldaps://', 'mysql://', 'postgresql://',
      'mongodb://', 'redis://', 'memcached://', 'socket://',
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
  private detectFileInclusion(input: string): ClassifierDecision | null {
    const fileInclusionPatterns = [
      // PHP文件包含
      'include(', 'require(', 'include_once(', 'require_once(',
      'file_get_contents(', 'file_put_contents(',
      'fopen(', 'readfile(', 'highlight_file(',
      'show_source(', 'parse_ini_file(',
      // 路径遍历变体
      '../', '..\\', '/../', '\\..\\',
      '.../', '..../', '..\\..\\', '../..',
      // 协议包装器
      'php://', 'data://', 'glob://', 'phar://',
      'zip://', 'zlib://', 'compress.zlib://', 'compress.bzip2://',
      'rar://', 'ogg://', 'expect://', 'ssh2://',
      'ftp://', 'ftps://', 'http://', 'https://',
      // 编码绕过
      '%2e%2e/', '%2e%2e\\', '%2f%2e%2e', '%5c%2e%2e',
      '%u002e%u002e/', '%u002e%u002e\\',
      '%c0%ae%c0%ae/', '%c0%ae%c0%ae\\',
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
   * 检测LDAP注入攻击
   * @param input 输入字符串
   * @returns 检测结果
   */
  private detectLDAPInjection(input: string): ClassifierDecision | null {
    const ldapPatterns = [
      // LDAP特殊字符
      '*', '(', ')', '&', '|', '=', '!', '~',
      // 逻辑操作符
      '&', '|', '!',
      // LDAP过滤器注入
      '(|', '(&', '(!', '))',
      // 通配符攻击
      '*', '**', '***',
      // 空值攻击
      '\x00', '%00',
      // 编码绕过
      '\\2a', '\\28', '\\29', '\\26', '\\7c',
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
        reason: 'Input contains multiple LDAP special characters indicating potential LDAP injection',
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
  private detectXXEAttack(input: string): ClassifierDecision | null {
    const xxePatterns = [
      // DOCTYPE声明
      '<!DOCTYPE', '<!DOCTYPE ', '<!DOCTYPE\t',
      // 外部实体声明
      '<!ENTITY', '<!ENTITY ', '<!ENTITY\t',
      // 外部引用
      'SYSTEM ', 'SYSTEM\t', 'PUBLIC ', 'PUBLIC\t',
      // 协议处理程序
      'file://', 'http://', 'https://', 'ftp://',
      'gopher://', 'expect://', 'php://',
      // 内部实体
      '&#', '&#x', '&amp;', '&lt;', '&gt;',
      // 实体引用
      '&', ']]>',
    ];
    
    // 检查DOCTYPE和ENTITY组合
    if (input.includes('<!DOCTYPE') && input.includes('<!ENTITY')) {
      return {
        shouldBlock: true,
        reason: 'Input contains both DOCTYPE and ENTITY declarations indicating potential XXE attack',
      };
    }
    
    // 检查外部实体引用
    if (input.includes('<!ENTITY') && (input.includes('SYSTEM') || input.includes('PUBLIC'))) {
      return {
        shouldBlock: true,
        reason: 'Input contains external entity declaration indicating potential XXE attack',
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

  /**
   * 检测模板注入攻击
   * @param input 输入字符串
   * @returns 检测结果
   */
  private detectTemplateInjection(input: string): ClassifierDecision | null {
    const templatePatterns = [
      // Jinja2/Twig模板（使用成对模式避免误报）
      '{{', '{%', '%}', '{%%', '%%}',
      '{{ ', '{% ', ' %}',
      // Django模板
      '{{', '{%', '%}', '{%=', '%}=',
      // ERB模板
      '<%', '%>', '<%=', '%=>', '<%==',
      // PHP模板
      '<?php', '<?=', '<?', '?>',
      // ASP.NET模板
      '<%', '%>', '<%=', '<%#', '#%>',
      // Handlebars/Mustache
      '{{', '{{{', '}}}',
      // EJS模板
      '<%', '%>', '<%-', '<%=',
      // 表达式语言（使用左括号避免误报）
      '${', '#{',
      // 模板函数调用
      '{% if ', '{% for ', '{% while ', '{% include ',
      '{{ if ', '{{ for ', '{{ while ', '{{ include ',
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
   * 检测请求走私攻击（HTTP Request Smuggling）
   * @param input 输入字符串
   * @returns 检测结果
   */
  private detectRequestSmuggling(input: string): ClassifierDecision | null {
    const smugglingPatterns = [
      // Content-Length冲突
      'Content-Length:', 'Transfer-Encoding:',
      // 双重Content-Length
      'Content-Length:', 'Content-Length:',
      // CL.TE攻击
      'Transfer-Encoding: chunked',
      // TE.CL攻击
      'Content-Length:', 'Transfer-Encoding:',
      // 换行注入
      '\r\n\r\n', '\n\n', '\r\r',
      // 分块编码攻击
      '0\r\n\r\n', '0\n\n',
      // 模糊边界
      'X-Forwarded-For:', 'X-Real-IP:',
      'X-Original-URL:', 'X-Rewrite-URL:',
    ];
    
    // 检查是否同时包含Content-Length和Transfer-Encoding
    if (input.includes('Content-Length:') && input.includes('Transfer-Encoding:')) {
      return {
        shouldBlock: true,
        reason: 'Input contains both Content-Length and Transfer-Encoding headers indicating potential request smuggling',
      };
    }
    
    // 检查分块编码模式
    if (input.includes('Transfer-Encoding: chunked')) {
      return {
        shouldBlock: true,
        reason: 'Input contains Transfer-Encoding chunked header indicating potential request smuggling',
      };
    }
    
    return null;
  }

  /**
   * 检测WebSocket劫持攻击
   * @param input 输入字符串
   * @returns 检测结果
   */
  private detectWebSocketAttack(input: string): ClassifierDecision | null {
    const websocketPatterns = [
      // WebSocket协议升级
      'Upgrade: websocket', 'Connection: Upgrade',
      'Sec-WebSocket-Key:', 'Sec-WebSocket-Version:',
      // WebSocket URL
      'ws://', 'wss://',
      // WebSocket劫持
      'Origin:', 'Host:',
      // 协议切换攻击
      'HTTP/1.1 101', 'Switching Protocols',
    ];
    
    // 检查WebSocket升级请求
    if (input.includes('Upgrade: websocket') && input.includes('Connection: Upgrade')) {
      return {
        shouldBlock: true,
        reason: 'Input contains WebSocket upgrade headers indicating potential WebSocket attack',
      };
    }
    
    return null;
  }

  /**
   * 检测DNS劫持/隧道攻击
   * @param input 输入字符串
   * @returns 检测结果
   */
  private detectDNSTunnel(input: string): ClassifierDecision | null {
    const dnsPatterns = [
      // DNS查询模式
      'dig ', 'nslookup ', 'host ', 'dnsquery ',
      // DNS隧道工具
      'iodine ', 'dnscat2 ', 'dns2tcp ', 'dns-exfiltrator ',
      // DNS协议
      '_dns.', 'dns.', 'ns.', 'mx.', 'txt.',
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
          reason: 'Input contains pattern consistent with DNS tunneling (many short domain parts)',
        };
      }
    }
    
    return null;
  }

  /**
   * 检查是否部分匹配
   * @param toolName 工具名称
   * @returns 是否匹配
   */
  private isPartialMatch(toolName: string): boolean {
    const safeKeywords = [
      'read',
      'list',
      'search',
      'view',
      'show',
      'get',
      'find',
      'ls',
      'dir',
      'cat',
    ];

    for (const keyword of safeKeywords) {
      if (toolName.includes(keyword)) {
        return true;
      }
    }

    return false;
  }
}

/**
 * 分类器管理器
 * 管理多个分类器的注册和使用
 */
export class ClassifierManager {
  /**
   * 分类器实例
   */
  private classifier: IAutoModeClassifier | null = null;

  /**
   * 分类器缓存
   */
  private cache = new Map<string, ClassifierDecision>();

  /**
   * 分类器配置
   */
  private config = {
    enabled: true,
    cacheEnabled: true,
    cacheTTL: 60000, // 1分钟
  };

  /**
   * 注册分类器
   * @param classifier 分类器实例
   */
  registerClassifier(classifier: IAutoModeClassifier): void {
    this.classifier = classifier;
  }

  /**
   * 获取分类器
   * @returns 分类器实例
   */
  getClassifier(): IAutoModeClassifier {
    if (!this.classifier) {
      this.classifier = new AutoModeClassifier();
    }
    return this.classifier;
  }

  /**
   * 分类工具使用
   * @param toolName 工具名称
   * @param input 工具输入
   * @param messages 对话历史
   * @returns 分类决策
   */
  async classify(
    toolName: string,
    input: Record<string, unknown>,
    messages: Array<{ role: string; content: string }> = []
  ): Promise<ClassifierDecision> {
    if (!this.config.enabled) {
      return {
        shouldBlock: false,
        reason: 'Classifier is disabled',
      };
    }

    // 检查缓存
    const cacheKey = this.getCacheKey(toolName, input);
    if (this.config.cacheEnabled && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      // 简单的TTL检查
      if (Date.now() - (cached.durationMs || 0) < this.config.cacheTTL) {
        return cached;
      }
    }

    // 使用分类器
    const classifier = this.getClassifier();
    const decision = await classifier.classify(toolName, input, messages);

    // 缓存结果
    if (this.config.cacheEnabled) {
      this.cache.set(cacheKey, decision);
    }

    return decision;
  }

  /**
   * 检查工具是否在安全白名单中
   * @param toolName 工具名称
   * @returns 是否在白名单中
   */
  isAllowlistedTool(toolName: string): boolean {
    return this.getClassifier().isAllowlistedTool(toolName);
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 启用/禁用分类器
   * @param enabled 是否启用
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * 启用/禁用缓存
   * @param enabled 是否启用
   */
  setCacheEnabled(enabled: boolean): void {
    this.config.cacheEnabled = enabled;
  }

  /**
   * 获取缓存键
   * @param toolName 工具名称
   * @param input 工具输入
   * @returns 缓存键
   */
  private getCacheKey(toolName: string, input: Record<string, unknown>): string {
    return `${toolName}:${JSON.stringify(input)}`;
  }
}

// 导出单例
export const classifierManager = new ClassifierManager();