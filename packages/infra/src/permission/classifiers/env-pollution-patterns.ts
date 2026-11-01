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
 * ENV_POLLUTION_PATTERNS — 环境变量污染
 * 从 AutoModeClassifier.ts 提取（FSZ-003 拆分）。
 */

/**
 * 环境变量污染模式
 */
export const ENV_POLLUTION_PATTERNS = [
  // 路径变量
  'PATH=',
  'LD_PRELOAD=',
  'LD_LIBRARY_PATH=',
  'LD_AUDIT=',
  'LD_SHOW_AUXV=',
  'LD_DEBUG=',
  'LD_TRACE_LOADED_OBJECTS=',
  'LD_BIND_NOW=',
  'LD_WARN=',
  'LD_NOWARN=',
  'LD_ORIGIN_PATH=',
  'LD_USE_LOAD_BIAS=',
  // 语言路径变量
  'PYTHONPATH=',
  'PERL5LIB=',
  'RUBYLIB=',
  'NODE_PATH=',
  'JAVA_HOME=',
  'CLASSPATH=',
  'GOPATH=',
  'CARGO_HOME=',
  'RUSTUP_HOME=',
  'GO111MODULE=',
  'PYTHONIOENCODING=',
  // Shell变量
  'IFS=',
  'HOME=',
  'USER=',
  'SHELL=',
  'LOGNAME=',
  'TERM=',
  'PS1=',
  'PROMPT=',
  'HISTFILE=',
  'HISTSIZE=',
  'HISTCONTROL=',
  'HISTIGNORE=',
  'HISTTIMEFORMAT=',
  // 系统变量
  'USERNAME=',
  'HOSTNAME=',
  'DOMAINNAME=',
  'MAIL=',
  'TZ=',
  'LANG=',
  'LC_ALL=',
  'LC_COLLATE=',
  'LC_CTYPE=',
  'LC_MESSAGES=',
  'LC_MONETARY=',
  'LC_NUMERIC=',
  'LC_TIME=',
  'PWD=',
  'OLDPWD=',
  'CDPATH=',
  // 网络变量
  'http_proxy=',
  'https_proxy=',
  'ftp_proxy=',
  'socks_proxy=',
  'ALL_PROXY=',
  'NO_PROXY=',
  'PROXY=',
  'SOCKS_SERVER=',
  // 安全变量
  'SSH_AUTH_SOCK=',
  'SSH_AGENT_PID=',
  'GPG_AGENT_INFO=',
  'KRB5CCNAME=',
  'KRB5_CONFIG=',
  'KRB5_KTNAME=',
  // 云凭证变量
  'AWS_ACCESS_KEY_ID=',
  'AWS_SECRET_ACCESS_KEY=',
  'AWS_SESSION_TOKEN=',
  'AWS_PROFILE=',
  'AWS_DEFAULT_REGION=',
  'AWS_CONFIG_FILE=',
  'GOOGLE_APPLICATION_CREDENTIALS=',
  'GCLOUD_PROJECT=',
  'AZURE_CLIENT_ID=',
  'AZURE_CLIENT_SECRET=',
  'AZURE_TENANT_ID=',
  'AZURE_SUBSCRIPTION_ID=',
  'ARM_CLIENT_ID=',
  'ARM_CLIENT_SECRET=',
  'ARM_TENANT_ID=',
  'ARM_SUBSCRIPTION_ID=',
  // 容器变量
  'DOCKER_HOST=',
  'DOCKER_API_VERSION=',
  'DOCKER_CERT_PATH=',
  'DOCKER_TLS_VERIFY=',
  'KUBECONFIG=',
  'KUBE_CONFIG=',
  // 编译变量
  'CC=',
  'CXX=',
  'CFLAGS=',
  'CXXFLAGS=',
  'LDFLAGS=',
  'CPPFLAGS=',
  'MAKEFLAGS=',
  'AUTOMAKE_FLAGS=',
  'AUTOCONF_FLAGS=',
  // 调试变量
  'DEBUG=',
  'VERBOSE=',
  'TRACE=',
  'LOG_LEVEL=',
  'NODE_ENV=',
  'RAILS_ENV=',
  'DJANGO_SETTINGS_MODULE=',
  // 临时目录变量
  'TMPDIR=',
  'TEMP=',
  'TMP=',
  'XDG_RUNTIME_DIR=',
  // 其他危险变量
  'LD_PRELOAD_=',
  '_=',
  'SHLVL=',
  'PPID=',
  'PID=',
  'UID=',
  'GID=',
  'EUID=',
  'EGID=',
  'TERMINFO=',
  'INFOPATH=',
  'MANPATH=',
  'PAGER=',
  'EDITOR=',
  'VISUAL=',
  'LESS=',
  'MORE=',
  'SHELLOPTS=',
  'BASHOPTS=',
  'POSIXLY_CORRECT=',
  'POSIX_ME_HARDER=',
  'CDPATH=',
  'FIGNORE=',
  'IGNOREEOF=',
  'INPUTRC=',
  'KEYTIMEOUT=',
  'LANG=',
  'LC_ALL=',
  'LINES=',
  'COLUMNS=',
  'LS_COLORS=',
  'LS_OPTIONS=',
  'MAILCHECK=',
  'PATH_DIRS=',
  'POSIX_CORRECT=',
  'PROMPT_COMMAND=',
  'REPLY=',
  'SECONDS=',
  'SHELL=',
  'SHLVL=',
  'TIMEFORMAT=',
  'TMOUT=',
  'UID=',
  'USER=',
  '_=',
];
