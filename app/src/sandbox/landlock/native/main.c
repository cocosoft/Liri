/*
 * landlock-run: self-restrict-then-exec Landlock launcher.
 *
 * Ported into PY_APP from deepseek-harness `native/landlock-run` (MIT),
 * extended for MAX_ABI 10 (v4 NET TCP / v10 NET UDP / v8 TSYNC restrict
 * flag). See dev_docs/20260824/沙箱隔离机制与Landlock集成方案-20260824.md §4.2.
 *
 * !! UNVERIFIED — requires Linux build & kernel validation (plan §9.9) !!
 * This file cannot be compiled on Windows; correctness must be proven on a
 * Linux host (`cc -static -O2 -o landlock-run main.c`) plus a real kernel
 * (see `--probe` and the plan's landlock.e2e matrix).
 *
 * CLI contract (consumed by `app/src/sandbox/landlock/runWithLandlock.ts`):
 *
 *   landlock-run [--ro <path>]... [--rw <path>]... [--net-connect <tcp|udp>]... [--tsync] -- <argv>...
 *   landlock-run --probe
 *
 * `--ro` grants read+execute beneath the path; `--rw` grants full filesystem
 * access beneath the path. `--net-connect tcp|udp` grants CONNECT for the
 * protocol (TCP needs ABI 4, UDP needs ABI 10); bind is never granted
 * (deny-bind is the default posture of our policies). `--tsync` passes
 * LANDLOCK_RESTRICT_SELF_TSYNC (ABI 8) — needed only when restrict_self runs
 * in a multithreaded process; this helper is single-threaded before exec,
 * so it defaults to 0 (see plan §3.3 TSYNC warning).
 *
 * Fail-closed: exit 125 + `landlock-run: <message>` on stderr for any
 * launcher failure (kernel not enforcing / ruleset error / exec failure).
 * A partial (best-effort) enforcement on an older ABI is accepted and
 * reported on stderr; the consumer must attribute ONLY exit 125 to launcher
 * failure (postmortem 0004 — never "prefix + non-zero exit").
 *
 * Plain C11 over the raw Landlock UAPI — no libraries beyond libc (musl,
 * linked statically). Kernel UAPI is self-defined here (stable by contract).
 */

#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

/*
 * Landlock UAPI, self-defined verbatim from the kernel header. The
 * path-beneath struct is packed there, so it must be packed here.
 *
 * ABI evolution (kernel userspace-api/landlock):
 *   v1 (5.13)  base FS accesses
 *   v2 (5.19)  REFER
 *   v3 (6.2)   TRUNCATE
 *   v4 (6.7)   NET: BIND_TCP / CONNECT_TCP          -> handled_access_net
 *   v5 (6.10)  IOCTL_DEV
 *   v6 (6.11)  SCOPE (abstract unix sockets/signal) -> scoped field (unused here)
 *   v7         RESTRICT_SELF_LOG_* flags
 *   v8         RESTRICT_SELF_TSYNC flag
 *   v9         RESOLVE_UNIX                         -> resolve field (unused here)
 *   v10        NET: BIND/CONNECT/SEND/RECV_UDP
 */
struct landlock_ruleset_attr {
  uint64_t handled_access_fs;
  uint64_t handled_access_net; /* ABI 4+ */
  uint64_t scoped;             /* ABI 6+; unused (we never scope) */
  uint64_t resolve;            /* ABI 9+; unused (we never set resolve flags) */
};

struct landlock_path_beneath_attr {
  uint64_t allowed_access;
  int32_t parent_fd;
} __attribute__((packed));

#define LANDLOCK_CREATE_RULESET_VERSION (1U << 0)
#define LANDLOCK_RULE_PATH_BENEATH 1

/* --- Filesystem access bits (by introducing ABI) --- */
#define LL_FS_EXECUTE     (UINT64_C(1) << 0)  /* ABI 1 */
#define LL_FS_WRITE_FILE  (UINT64_C(1) << 1)
#define LL_FS_READ_FILE   (UINT64_C(1) << 2)
#define LL_FS_READ_DIR    (UINT64_C(1) << 3)
#define LL_FS_REMOVE_DIR  (UINT64_C(1) << 4)
#define LL_FS_REMOVE_FILE (UINT64_C(1) << 5)
#define LL_FS_MAKE_CHAR   (UINT64_C(1) << 6)
#define LL_FS_MAKE_DIR    (UINT64_C(1) << 7)
#define LL_FS_MAKE_REG    (UINT64_C(1) << 8)
#define LL_FS_MAKE_SOCK   (UINT64_C(1) << 9)
#define LL_FS_MAKE_FIFO   (UINT64_C(1) << 10)
#define LL_FS_MAKE_BLOCK  (UINT64_C(1) << 11)
#define LL_FS_MAKE_SYM    (UINT64_C(1) << 12)
#define LL_FS_REFER       (UINT64_C(1) << 13) /* ABI 2 */
#define LL_FS_TRUNCATE    (UINT64_C(1) << 14) /* ABI 3 */
#define LL_FS_IOCTL_DEV   (UINT64_C(1) << 15) /* ABI 5 */

#define LL_ABI1_MASK (LL_FS_REFER - 1) /* bits 0..12: every ABI-1 access, nothing newer */

/* --- Network access bits (by introducing ABI) --- */
#define LL_NET_BIND_TCP    (UINT64_C(1) << 0) /* ABI 4 */
#define LL_NET_CONNECT_TCP (UINT64_C(1) << 1)
#define LL_NET_BIND_UDP    (UINT64_C(1) << 2) /* ABI 10 */
#define LL_NET_CONNECT_UDP (UINT64_C(1) << 3)
#define LL_NET_SEND_UDP    (UINT64_C(1) << 4)
#define LL_NET_RECV_UDP    (UINT64_C(1) << 5)

/* --- restrict_self flags (by introducing ABI) --- */
#define LL_RESTRICT_LOG_SAME_EXEC_OFF  (UINT64_C(1) << 0) /* ABI 7 */
#define LL_RESTRICT_LOG_NEW_EXEC_ON    (UINT64_C(1) << 1)
#define LL_RESTRICT_LOG_SUBDOMAINS_OFF (UINT64_C(1) << 2)
#define LL_RESTRICT_TSYNC              (UINT64_C(1) << 3) /* ABI 8 */

/* Newest ABI this build knows (plan §3.4 / §9.6: 扩展 5 -> 10). */
#define MAX_ABI 10L

/*
 * Landlock has no libc wrappers; these are the raw syscalls (numbers are
 * identical on every architecture — the post-2011 unified table).
 */
#ifndef __NR_landlock_create_ruleset
#define __NR_landlock_create_ruleset 444
#define __NR_landlock_add_rule 445
#define __NR_landlock_restrict_self 446
#endif

/* Every fatal launcher error exits 125 — a code the wrapped command itself
 * is unlikely to use, so the executor can tell launcher failure from command
 * failure (the ONLY sanctioned attribution signal). */
#define EXIT_LAUNCHER_FAILURE 125

static const char NOT_ENFORCED_MESSAGE[] =
  "landlock is not enforced by this kernel (ABI unsupported or disabled)";

/* Print one fatal `landlock-run: ...` line; returns the fatal exit code. */
static int fail(const char *prefix, const char *detail) {
  if (detail == NULL) {
    fprintf(stderr, "landlock-run: %s\n", prefix);
  } else {
    fprintf(stderr, "landlock-run: %s: %s\n", prefix, detail);
  }
  return EXIT_LAUNCHER_FAILURE;
}

static int fail_usage(const char *message, const char *detail) {
  fprintf(stderr, "landlock-run: usage error: %s%s\n",
          message, detail == NULL ? "" : detail);
  return EXIT_LAUNCHER_FAILURE;
}

/* Parsed CLI: either a probe, or grants plus the command argv after `--`. */
struct cli {
  int probe;
  int tsync; /* request LANDLOCK_RESTRICT_TSYNC (ABI 8) */
  const char **ro;
  size_t ro_count;
  const char **rw;
  size_t rw_count;
  uint64_t net_connect; /* bitmask of LL_NET_CONNECT_* requested */
  char **command;       /* NULL-terminated tail of main's argv */
};

/* Hand-rolled argv parsing — a handful of flags do not justify a library. */
static int parse(int argc, char **argv, struct cli *cli) {
  /* argc bounds each grant list; the launcher execs or exits, so no free. */
  cli->ro = calloc(argc > 0 ? (size_t)argc : 1, sizeof *cli->ro);
  cli->rw = calloc(argc > 0 ? (size_t)argc : 1, sizeof *cli->rw);
  if (cli->ro == NULL || cli->rw == NULL) return fail("out of memory", NULL);

  int index = 1;
  while (index < argc) {
    const char *arg = argv[index];
    if (strcmp(arg, "--probe") == 0) {
      if (argc != 2) return fail_usage("--probe takes no other arguments", NULL);
      cli->probe = 1;
      index += 1;
    } else if (strcmp(arg, "--tsync") == 0) {
      cli->tsync = 1;
      index += 1;
    } else if (strcmp(arg, "--ro") == 0 || strcmp(arg, "--rw") == 0) {
      if (index + 1 >= argc) return fail_usage(arg, " requires a path");
      if (strcmp(arg, "--ro") == 0) {
        cli->ro[cli->ro_count++] = argv[index + 1];
      } else {
        cli->rw[cli->rw_count++] = argv[index + 1];
      }
      index += 2;
    } else if (strcmp(arg, "--net-connect") == 0) {
      if (index + 1 >= argc) return fail_usage("--net-connect", " requires tcp|udp");
      if (strcmp(argv[index + 1], "tcp") == 0) {
        cli->net_connect |= LL_NET_CONNECT_TCP;
      } else if (strcmp(argv[index + 1], "udp") == 0) {
        cli->net_connect |= LL_NET_CONNECT_UDP;
      } else {
        return fail_usage("--net-connect", " expects tcp|udp");
      }
      index += 2;
    } else if (strcmp(arg, "--") == 0) {
      cli->command = &argv[index + 1];
      break;
    } else {
      return fail_usage("unknown argument: ", arg);
    }
  }
  if (!cli->probe && (cli->command == NULL || cli->command[0] == NULL)) {
    return fail_usage("missing `-- <argv>...` command", NULL);
  }
  return 0;
}

/* The filesystem accesses the running kernel's ABI can govern. */
static uint64_t fs_mask_for_abi(long abi) {
  uint64_t mask = LL_ABI1_MASK;
  if (abi >= 2) mask |= LL_FS_REFER;
  if (abi >= 3) mask |= LL_FS_TRUNCATE;
  if (abi >= 5) mask |= LL_FS_IOCTL_DEV;
  return mask;
}

/* The network accesses the running kernel's ABI can govern. */
static uint64_t net_mask_for_abi(long abi) {
  uint64_t mask = 0;
  if (abi >= 4) mask |= LL_NET_BIND_TCP | LL_NET_CONNECT_TCP;
  if (abi >= 10) mask |= LL_NET_BIND_UDP | LL_NET_CONNECT_UDP |
                        LL_NET_SEND_UDP | LL_NET_RECV_UDP;
  return mask;
}

/* Add one path-beneath rule; 0 on success, else the exit code. */
static int add_rule(int ruleset_fd, const char *path, uint64_t access) {
  int path_fd = open(path, O_PATH | O_CLOEXEC);
  if (path_fd < 0) {
    fprintf(stderr, "landlock-run: cannot open rule path: %s: %s\n",
            path, strerror(errno));
    return EXIT_LAUNCHER_FAILURE;
  }
  /* The kernel rejects directory-only accesses on a non-directory rule
   * (EINVAL), so a file grant keeps only the file-compatible bits. */
  struct stat st;
  if (fstat(path_fd, &st) == 0 && !S_ISDIR(st.st_mode)) {
    access &= LL_FS_EXECUTE | LL_FS_WRITE_FILE | LL_FS_READ_FILE |
              LL_FS_TRUNCATE | LL_FS_IOCTL_DEV;
  }
  struct landlock_path_beneath_attr attr = {
    .allowed_access = access,
    .parent_fd = path_fd,
  };
  if (syscall(__NR_landlock_add_rule, ruleset_fd, LANDLOCK_RULE_PATH_BENEATH,
              &attr, 0) != 0) {
    int saved = errno;
    close(path_fd);
    return fail("landlock ruleset error", strerror(saved));
  }
  close(path_fd);
  return 0;
}

/*
 * Install the ruleset on the current thread, negotiating the kernel's ABI
 * down from MAX_ABI. The ruleset attr is sized by ABI so older kernels
 * (smaller attr) accept it; fields beyond the kernel's ABI are zeroed and
 * must never be requested. Sets `no_new_privs` first (mandatory for an
 * unprivileged restrict). On success `*partial` reports whether the kernel
 * governs only a subset of MAX_ABI's accesses. Returns 0, else exit code.
 */
static int restrict_self(const struct cli *cli, int *partial) {
  long abi = syscall(__NR_landlock_create_ruleset, NULL, 0,
                     LANDLOCK_CREATE_RULESET_VERSION);
  if (abi < 0) {
    /* ENOSYS: kernel built without Landlock; EOPNOTSUPP: built but disabled. */
    return fail(NOT_ENFORCED_MESSAGE, NULL);
  }
  *partial = abi < MAX_ABI;
  long use_abi = abi < MAX_ABI ? abi : MAX_ABI;

  /* Reject a request for accesses the kernel cannot govern (best-effort
   * would silently narrow the granted set; fail instead — the caller must
   * clamp by its own probe result). */
  uint64_t requested_fs = fs_mask_for_abi(MAX_ABI);
  uint64_t requested_net = cli->net_connect;
  if ((requested_fs & ~fs_mask_for_abi(use_abi)) != 0) return fail("landlock ruleset error", "requested FS access beyond kernel ABI");
  if ((requested_net & ~net_mask_for_abi(use_abi)) != 0) return fail("landlock ruleset error", "requested NET access beyond kernel ABI");

  struct landlock_ruleset_attr attr;
  memset(&attr, 0, sizeof attr);
  attr.handled_access_fs = fs_mask_for_abi(use_abi);
  attr.handled_access_net = requested_net; /* only non-zero if requested */

  /* Size passed must equal the kernel's view: ABI < 4 has no net field. */
  size_t attr_size = offsetof(struct landlock_ruleset_attr, handled_access_net);
  if (use_abi >= 4) attr_size = sizeof(attr);

  int ruleset_fd = (int)syscall(__NR_landlock_create_ruleset, &attr,
                                attr_size, 0);
  if (ruleset_fd < 0) return fail("landlock ruleset error", strerror(errno));

  const uint64_t read_side = LL_FS_EXECUTE | LL_FS_READ_FILE | LL_FS_READ_DIR;
  for (size_t i = 0; i < cli->ro_count; i++) {
    int code = add_rule(ruleset_fd, cli->ro[i], read_side & attr.handled_access_fs);
    if (code != 0) return code;
  }
  for (size_t i = 0; i < cli->rw_count; i++) {
    int code = add_rule(ruleset_fd, cli->rw[i], attr.handled_access_fs);
    if (code != 0) return code;
  }

  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
    return fail("landlock ruleset error", strerror(errno));
  }

  /* restrict flags: TSYNC (ABI 8) only when explicitly requested. This
   * helper is single-threaded before exec, so flags=0 is correct by default
   * (plan §3.3); LOG flags (ABI 7) are intentionally unused. */
  uint64_t restrict_flags = 0;
  if (cli->tsync) {
    if (use_abi < 8) return fail("landlock ruleset error", "TSYNC requires ABI 8");
    restrict_flags |= LL_RESTRICT_TSYNC;
  }
  if (syscall(__NR_landlock_restrict_self, ruleset_fd, restrict_flags) != 0) {
    return fail("landlock ruleset error", strerror(errno));
  }
  close(ruleset_fd);
  return 0;
}

int main(int argc, char **argv) {
  struct cli cli = { 0 };
  int code = parse(argc, argv, &cli);
  if (code != 0) return code;

  if (cli.probe) {
    /* The functional probe: build and enforce a maximal ruleset in THIS
     * short-lived process. `--version` style checks would miss a kernel that
     * has the syscalls but refuses enforcement; actually restricting is the
     * only honest signal. The report line is part of the CLI contract. */
    static const char *probe_root = "/";
    struct cli probe = { .ro = &probe_root, .ro_count = 1 };
    int partial = 0;
    code = restrict_self(&probe, &partial);
    if (code != 0) return code;
    printf("landlock: %s\n",
           partial ? "partially enforced (older ABI)" : "fully enforced");
    return 0;
  }

  int partial = 0;
  code = restrict_self(&cli, &partial);
  if (code != 0) return code;
  if (partial) {
    fprintf(stderr, "landlock-run: partial enforcement (older Landlock ABI)\n");
  }

  execvp(cli.command[0], cli.command);
  /* exec only returns on failure. */
  return fail("exec failed", strerror(errno));
}
