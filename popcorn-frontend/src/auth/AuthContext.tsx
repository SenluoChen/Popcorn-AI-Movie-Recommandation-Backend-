import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { AuthUser } from "./types";
import { apiConfirm, apiLogin, apiLogout, apiMe, apiRefresh, apiSignup } from "./apiAuth";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<{ next: "confirm" | "done" }>;
  confirm: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 1) try current session
        try {
          const u = await apiMe();
          if (!cancelled) setUser(u);
          return;
        } catch {
          // ignore
        }

        // 2) try refresh then me
        try {
          const u = await apiRefresh();
          if (!cancelled) setUser(u);
          return;
        } catch {
          // ignore
        }

        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    return {
      user,
      loading,
      login: async (email, password) => {
        const u = await apiLogin(email, password);
        setUser(u);
      },
      signup: async (email, password) => {
        const out = await apiSignup(email, password);
        // Signup may require confirm; user is not logged in yet.
        if (out.next === "done") {
          // Some pools auto-confirm; still need login tokens, so caller should login.
          return { next: "done" };
        }
        return { next: "confirm" };
      },
      confirm: async (email, code) => {
        await apiConfirm(email, code);
      },
      logout: async () => {
        await apiLogout();
        setUser(null);
      },
    };
  }, [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
