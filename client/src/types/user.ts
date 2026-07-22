export interface User {
  id: string;
  username: string;
  email?: string;
  role: "admin" | "user" | "guest";
  trustLevel: 1 | 2 | 3 | 4 | 5;
  created_at: number;
  last_login_at?: number;
}

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: number;
  last_used_at?: number;
  expires_at?: number;
  permissions: string[];
}

export interface Permission {
  scope: string;
  description: string;
  level: "none" | "read" | "write" | "admin";
}
