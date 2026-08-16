import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";

interface AuthGuardProps {
  children: ReactNode;
  requiredRole?: "admin" | "user" | "guest";
  requiredTrustLevel?: number;
}

/**
 * 认证守卫 — 本地单机应用默认无需认证（无 requiredRole/requiredTrustLevel 时放行）。
 *
 * W7 修复：requiredRole / requiredTrustLevel 声明即契约——此前参数被忽略、一律放行，
 * 形同虚设。现按声明校验并重定向到 /login：
 * - requiredRole="admin"：必须已登录且 role 为 admin
 * - requiredRole="user"：必须已登录且 role 为 admin/user
 * - requiredRole="guest"：无需登录（等同放行）
 * - requiredTrustLevel=N：必须已登录且 trustLevel >= N
 */
function AuthGuard({
  children,
  requiredRole,
  requiredTrustLevel,
}: AuthGuardProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  const needsCheck =
    requiredRole !== undefined || requiredTrustLevel !== undefined;
  if (needsCheck) {
    if (!isAuthenticated) {
      return <Navigate to="/login" replace />;
    }
    if (requiredRole === "admin" && user?.role !== "admin") {
      return <Navigate to="/login" replace />;
    }
    if (
      requiredRole === "user" &&
      user?.role !== "admin" &&
      user?.role !== "user"
    ) {
      return <Navigate to="/login" replace />;
    }
    if (
      requiredTrustLevel !== undefined &&
      (user?.trustLevel ?? 0) < requiredTrustLevel
    ) {
      return <Navigate to="/login" replace />;
    }
  }

  return <>{children}</>;
}

export default AuthGuard;
