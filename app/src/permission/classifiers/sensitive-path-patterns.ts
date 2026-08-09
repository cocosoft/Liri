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
 * SENSITIVE_PATH_PATTERNS — 敏感路径
 * 从 AutoModeClassifier.ts 提取（FSZ-003 拆分）。
 */

/**
 * 敏感路径模式
 */
export const SENSITIVE_PATH_PATTERNS = [
  // Unix/Linux系统目录
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
  '/dev/',
  '/mnt/',
  '/media/',
  '/opt/',
  '/usr/local/',
  '/srv/',
  '/kernel/',
  '/firmware/',
  '/etc/passwd',
  '/etc/shadow',
  '/etc/group',
  '/etc/gshadow',
  '/etc/sudoers',
  '/etc/ssh/',
  '/root/.ssh/',
  '/home/*/.ssh/',
  '/var/log/',
  '/var/log/auth.log',
  '/var/log/syslog',
  '/var/log/secure',
  '/var/log/messages',
  '/etc/resolv.conf',
  '/etc/hosts',
  '/etc/hostname',
  '/etc/fstab',
  '/etc/crontab',
  '/etc/anacrontab',
  '/var/spool/cron/',
  '/usr/lib/',
  '/usr/share/',
  '/usr/include/',
  '/usr/src/',
  '/etc/profile',
  '/etc/bashrc',
  '/etc/zshrc',
  '/etc/profile.d/',
  '/etc/security/',
  '/etc/pam.d/',
  '/etc/selinux/',
  '/etc/apparmor/',
  '/etc/audit/',
  '/etc/rsyslog.conf',
  '/etc/systemd/',
  '/var/run/',
  '/var/lock/',
  '/var/lib/',
  '/var/opt/',
  '/var/spool/',
  '/var/mail/',
  '/var/cache/',
  '/var/log/',
  '/tmp/',
  '/dev/shm/',
  '/run/shm/',
  '/run/user/',
  '/proc/sys/',
  '/proc/kcore',
  '/proc/kmsg',
  '/proc/self/',
  '/sys/kernel/',
  '/sys/devices/',
  '/sys/class/',
  '/sys/block/',
  // Windows系统目录
  'C:\\',
  'D:\\',
  'E:\\',
  'F:\\',
  '\\\\.\\',
  '\\\\?\\',
  'C:\\Windows\\',
  'C:\\Windows\\System32\\',
  'C:\\Windows\\SysWOW64\\',
  'C:\\Program Files\\',
  'C:\\Program Files (x86)\\',
  'C:\\Users\\',
  'C:\\Users\\Administrator\\',
  'C:\\Users\\Default\\',
  'C:\\Users\\Public\\',
  'C:\\Documents and Settings\\',
  'C:\\ProgramData\\',
  'C:\\WINDOWS\\system32\\config\\',
  'C:\\WINDOWS\\system32\\drivers\\',
  'C:\\WINDOWS\\system32\\services\\',
  'C:\\WINDOWS\\system32\\cmd.exe',
  'C:\\WINDOWS\\system32\\powershell.exe',
  'C:\\WINDOWS\\system32\\wscript.exe',
  'C:\\WINDOWS\\system32\\cscript.exe',
  'C:\\WINDOWS\\system32\\reg.exe',
  'C:\\WINDOWS\\system32\\net.exe',
  'C:\\WINDOWS\\system32\\sc.exe',
  'C:\\WINDOWS\\system32\\tasklist.exe',
  'C:\\WINDOWS\\system32\\taskkill.exe',
  'C:\\WINDOWS\\system32\\at.exe',
  'C:\\WINDOWS\\system32\\schtasks.exe',
  'C:\\WINDOWS\\system32\\mshta.exe',
  // 网络共享路径
  '\\\\localhost\\',
  '\\\\127.0.0.1\\',
  '\\\\*\\',
  'smb://',
  'cifs://',
  'nfs://',
  'afp://',
  // 云存储路径
  's3://',
  'gs://',
  'azure://',
  'wasb://',
  // 特殊路径
  '~/',
  '~/.ssh/',
  '~/.aws/',
  '~/.config/',
  '/var/run/secrets/',
  '/run/secrets/',
  '/etc/secrets/',
  '/var/lib/docker/',
  '/var/lib/kubelet/',
  '/etc/kubernetes/',
  '/usr/local/bin/',
  '/usr/local/sbin/',
  '/opt/bin/',
  '/snap/',
  '/var/snap/',
  '/srv/snap/',
];
