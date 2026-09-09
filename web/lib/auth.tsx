'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setToken, getToken } from './api';

interface Principal {
  userId: string;
  organizationId: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
}

interface AuthState {
  user: Principal | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (organization: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api<Principal>('/api/auth/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const { token, user } = await api<{ token: string; user: Principal }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setToken(token);
    setUser(user);
  };

  const register = async (organization: string, email: string, password: string) => {
    const { token, user } = await api<{ token: string; user: Principal }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ organization, email, password }),
    });
    setToken(token);
    setUser(user);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
