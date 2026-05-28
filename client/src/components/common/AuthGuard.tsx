import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

interface AuthGuardProps {
  children: ReactNode;
  requiredRole?: 'admin' | 'user' | 'guest';
  requiredTrustLevel?: number;
}

const isDevelopment = process.env.NODE_ENV === 'development';

function AuthGuard({ children, requiredRole, requiredTrustLevel }: AuthGuardProps) {
  const location = useLocation();
  const { isAuthenticated, isLoading, user, checkAuth } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated && !isLoading && !isDevelopment) {
      checkAuth();
    }
  }, [isAuthenticated, isLoading, checkAuth]);

  if (isDevelopment) {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500 dark:text-gray-400">验证中...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiredRole && user) {
    const roleHierarchy = { admin: 3, user: 2, guest: 1 };
    const userRoleLevel = roleHierarchy[user.role] || 0;
    const requiredRoleLevel = roleHierarchy[requiredRole] || 0;

    if (userRoleLevel < requiredRoleLevel) {
      return <Navigate to="/dashboard" state={{ from: location }} replace />;
    }
  }

  if (requiredTrustLevel !== undefined && user) {
    if (user.trustLevel < requiredTrustLevel) {
      return <Navigate to="/dashboard" state={{ from: location }} replace />;
    }
  }

  return <>{children}</>;
}

export default AuthGuard;