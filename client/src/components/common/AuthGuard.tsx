import { type ReactNode } from "react";

interface AuthGuardProps {
  children: ReactNode;
  requiredRole?: "admin" | "user" | "guest";
  requiredTrustLevel?: number;
}

/** 认证守卫 — 本地单机应用无需认证，直接放行 */
function AuthGuard({ children }: AuthGuardProps) {
  return <>{children}</>;
}

export default AuthGuard;
