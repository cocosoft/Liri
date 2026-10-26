/*
MIT License

Copyright (c) 2026 190615273@qq.com

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

/*
 * win-sandbox-run.exe —— Windows 兜底沙箱启动器（Low IL + Job Object）
 *
 * 方案：.trae/specs/windows-sandbox.md
 *
 * 做三件事：
 *   1. 用「自身令牌的受限副本」把子进程降到 **Low 完整性级别**（MIC 默认 NO_WRITE_UP）
 *      ⇒ 子进程**无法写入** Medium/High 完整性对象（用户仓库、文档、%APPDATA% 等）；
 *   2. 子进程加入 **Job Object**（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）⇒ 父进程退出/被杀时
 *      整棵子进程树一并回收（防孤儿）；可选内存 / 进程数上限；
 *   3. 转发退出码。
 *
 * 关键可行性：`CreateProcessAsUser` 在令牌为**调用方自身令牌的受限版本**时
 * 不要求 `SeAssignPrimaryTokenPrivilege`（Windows 文档口径）；降低自己的完整性级别也无需特权
 * （只能降不能升）⇒ 普通用户权限即可运行。
 *
 * CLI（与 TypeScript 侧约定，见 spec §3.2）：
 *   win-sandbox-run.exe [--timeout-ms N] [--mem-mb N] [--max-procs N] -- <program> [args...]
 *
 * 退出码：
 *   - 子进程退出码原样返回（含 125 —— 上层**只**按 126 判 helper 自身失败，避免与用户命令的 125 混淆）
 *   - 124 = 超时被终止
 *   - 126 = helper 自身初始化失败（取令牌 / 建 Job / 起进程失败）
 *   - 2   = 参数错误
 *
 * 明确不做：路径授权。写白名单由 TypeScript 侧对**自有目录**打 Low 强制标签实现
 * （`icacls /setintegritylevel`），helper 不碰用户 ACL。
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <sddl.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

/* 126 而非 125：125 是 landlock 协议的"初始化失败"，若复用会与「用户命令恰好退出 125」混淆
 * （macOS 侧已踩过这个坑，见 macos-sandbox-exec.md 的 exit-125 守卫）。 */
#define EXIT_HELPER_INIT_FAILED 126
#define EXIT_USAGE 2
#define EXIT_TIMEOUT 124

/* 运行期文案一律 ASCII：控制台代码页（CP936/CP65001）不同会导致中文变 `???`，
 * 而 helper 的 stderr 会直接进日志/CI 输出。 */
static void err(const wchar_t *msg) {
  fwprintf(stderr, L"win-sandbox-run: %ls (GetLastError=%lu)\n", msg,
           (unsigned long)GetLastError());
}

/* 把剩余 argv 拼成 CreateProcess 需要的命令行（按 Windows 规则给含空格/引号的参数加引号） */
static wchar_t *build_command_line(int argc, wchar_t **argv, int start) {
  size_t cap = 4096;
  for (int i = start; i < argc; i++) {
    cap += wcslen(argv[i]) * 2 + 4;
  }
  wchar_t *out = (wchar_t *)calloc(cap, sizeof(wchar_t));
  if (!out) return NULL;

  for (int i = start; i < argc; i++) {
    const wchar_t *arg = argv[i];
    int need_quote = (arg[0] == L'\0') || wcschr(arg, L' ') || wcschr(arg, L'\t');
    if (i > start) wcscat_s(out, cap, L" ");
    if (!need_quote) {
      wcscat_s(out, cap, arg);
      continue;
    }
    wcscat_s(out, cap, L"\"");
    for (const wchar_t *p = arg; *p; p++) {
      /* 引号转义：\"（本用途下参数不含复杂反斜杠序列，按最小规则处理） */
      if (*p == L'"') wcscat_s(out, cap, L"\\\"");
      else {
        wchar_t one[2] = {*p, L'\0'};
        wcscat_s(out, cap, one);
      }
    }
    wcscat_s(out, cap, L"\"");
  }
  return out;
}

/* 复制自身令牌 → 受限版本 → 降为 Low 完整性级别 */
static int make_low_il_restricted_token(HANDLE *out_token) {
  HANDLE self = NULL;
  if (!OpenProcessToken(GetCurrentProcess(),
                        TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ADJUST_DEFAULT |
                            TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_SESSIONID,
                        &self)) {
    err(L"OpenProcessToken failed");
    return 0;
  }

  HANDLE restricted = NULL;
  if (!CreateRestrictedToken(self, DISABLE_MAX_PRIVILEGE, 0, NULL, 0, NULL, 0,
                             NULL, &restricted)) {
    err(L"CreateRestrictedToken failed");
    CloseHandle(self);
    return 0;
  }
  CloseHandle(self);

  /* Low 完整性级别 = S-1-16-4096 */
  PSID low_sid = NULL;
  if (!ConvertStringSidToSidW(L"S-1-16-4096", &low_sid)) {
    err(L"ConvertStringSidToSidW failed");
    CloseHandle(restricted);
    return 0;
  }

  DWORD sid_len = GetLengthSid(low_sid);
  DWORD info_len = sizeof(TOKEN_MANDATORY_LABEL) + sid_len;
  TOKEN_MANDATORY_LABEL *tml = (TOKEN_MANDATORY_LABEL *)calloc(1, info_len);
  if (!tml) {
    LocalFree(low_sid);
    CloseHandle(restricted);
    err(L"out of memory");
    return 0;
  }
  tml->Label.Attributes = SE_GROUP_INTEGRITY;
  tml->Label.Sid = low_sid;

  BOOL ok = SetTokenInformation(restricted, TokenIntegrityLevel, tml, info_len);
  free(tml);
  LocalFree(low_sid);

  if (!ok) {
    err(L"SetTokenInformation(TokenIntegrityLevel) failed");
    CloseHandle(restricted);
    return 0;
  }

  *out_token = restricted;
  return 1;
}

int wmain(int argc, wchar_t **argv) {
  DWORD timeout_ms = 0; /* 0 = 不限（由上层 spawn 超时兜底） */
  SIZE_T mem_mb = 0;
  DWORD max_procs = 0;
  int i = 1;

  for (; i < argc; i++) {
    if (wcscmp(argv[i], L"--") == 0) {
      i++;
      break;
    }
    if (wcscmp(argv[i], L"--timeout-ms") == 0 && i + 1 < argc) {
      timeout_ms = (DWORD)_wtoi(argv[++i]);
      continue;
    }
    if (wcscmp(argv[i], L"--mem-mb") == 0 && i + 1 < argc) {
      mem_mb = (SIZE_T)_wtoi(argv[++i]);
      continue;
    }
    if (wcscmp(argv[i], L"--max-procs") == 0 && i + 1 < argc) {
      max_procs = (DWORD)_wtoi(argv[++i]);
      continue;
    }
    fwprintf(stderr, L"win-sandbox-run: unknown argument %ls\n", argv[i]);
    return EXIT_USAGE;
  }

  if (i >= argc) {
    fwprintf(stderr,
             L"usage: win-sandbox-run.exe [--timeout-ms N] [--mem-mb N] "
             L"[--max-procs N] -- <program> [args...]\n");
    return EXIT_USAGE;
  }

  wchar_t *cmdline = build_command_line(argc, argv, i);
  if (!cmdline) {
    err(L"build command line failed");
    return EXIT_HELPER_INIT_FAILED;
  }

  HANDLE token = NULL;
  if (!make_low_il_restricted_token(&token)) {
    free(cmdline);
    return EXIT_HELPER_INIT_FAILED;
  }

  HANDLE job = CreateJobObjectW(NULL, NULL);
  if (!job) {
    err(L"CreateJobObject failed");
    CloseHandle(token);
    free(cmdline);
    return EXIT_HELPER_INIT_FAILED;
  }

  JOBOBJECT_EXTENDED_LIMIT_INFORMATION jlim;
  ZeroMemory(&jlim, sizeof(jlim));
  jlim.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (mem_mb > 0) {
    jlim.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_PROCESS_MEMORY;
    jlim.ProcessMemoryLimit = mem_mb * 1024 * 1024;
  }
  if (max_procs > 0) {
    jlim.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
    jlim.BasicLimitInformation.ActiveProcessLimit = max_procs;
  }
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &jlim,
                               sizeof(jlim))) {
    err(L"SetInformationJobObject failed");
    CloseHandle(job);
    CloseHandle(token);
    free(cmdline);
    return EXIT_HELPER_INIT_FAILED;
  }

  STARTUPINFOW si;
  PROCESS_INFORMATION pi;
  ZeroMemory(&si, sizeof(si));
  ZeroMemory(&pi, sizeof(pi));
  si.cb = sizeof(si);

  /* bInheritHandles=TRUE：让 Node 侧通过 pipe 设置的 std 句柄被继承 */
  if (!CreateProcessAsUserW(token, NULL, cmdline, NULL, NULL, TRUE,
                            CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT, NULL,
                            NULL, &si, &pi)) {
    err(L"CreateProcessAsUser failed (low IL token)");
    CloseHandle(job);
    CloseHandle(token);
    free(cmdline);
    return EXIT_HELPER_INIT_FAILED;
  }

  free(cmdline);
  CloseHandle(token);

  if (!AssignProcessToJobObject(job, pi.hProcess)) {
    err(L"AssignProcessToJobObject failed");
    TerminateProcess(pi.hProcess, EXIT_HELPER_INIT_FAILED);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    CloseHandle(job);
    return EXIT_HELPER_INIT_FAILED;
  }

  ResumeThread(pi.hThread);
  CloseHandle(pi.hThread);

  DWORD wait = WaitForSingleObject(pi.hProcess, timeout_ms > 0 ? timeout_ms : INFINITE);
  if (wait == WAIT_TIMEOUT) {
    /* 整个 Job 一起终止（含孙进程） */
    TerminateJobObject(job, EXIT_TIMEOUT);
    WaitForSingleObject(pi.hProcess, 5000);
    CloseHandle(pi.hProcess);
    CloseHandle(job);
    return EXIT_TIMEOUT;
  }
  if (wait != WAIT_OBJECT_0) {
    err(L"WaitForSingleObject failed");
    TerminateJobObject(job, EXIT_HELPER_INIT_FAILED);
    CloseHandle(pi.hProcess);
    CloseHandle(job);
    return EXIT_HELPER_INIT_FAILED;
  }

  DWORD child_code = EXIT_HELPER_INIT_FAILED;
  GetExitCodeProcess(pi.hProcess, &child_code);
  CloseHandle(pi.hProcess);
  /* Job 句柄关闭 ⇒ KILL_ON_JOB_CLOSE 兜底回收残余子进程 */
  CloseHandle(job);
  return (int)child_code;
}
