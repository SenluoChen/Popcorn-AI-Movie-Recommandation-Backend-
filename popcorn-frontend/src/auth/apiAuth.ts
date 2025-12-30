import type { AuthUser } from "./types";

type SignupResult = { next: "confirm" | "done"; userConfirmed: boolean };

const base = (process.env.REACT_APP_AUTH_API_BASE || "http://localhost:3001").replace(/\/+$/, "");

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    credentials: "include",
  });

  const text = await res.text().catch(() => "");
  const contentType = res.headers.get("content-type") || "";

  let json: any = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      const snippet = text.slice(0, 160).replace(/\s+/g, " ").trim();
      const hint = snippet.startsWith("<!DOCTYPE") || snippet.startsWith("<html") ? "(看起來像 HTML；可能打到前端 dev server 或 404)" : "";

      // If server didn't return JSON, surface a useful error instead of "Unexpected token '<'".
      throw new Error(
        `Auth API 回傳非 JSON：HTTP ${res.status} ${res.statusText} ${hint}. ` +
          `REACT_APP_AUTH_API_BASE=${base}. content-type=${contentType || "(none)"}. ` +
          `body="${snippet}"`
      );
    }
  }

  if (!res.ok) {
    const msg = String(json?.error || res.statusText || "Request failed");
    throw new Error(msg);
  }

  return json as T;
}

export async function apiMe(): Promise<AuthUser> {
  const out = await api<{ ok: true; user: AuthUser }>("/auth/me", { method: "GET" });
  return out.user;
}

export async function apiRefresh(): Promise<AuthUser> {
  const out = await api<{ ok: true; user: AuthUser }>("/auth/refresh", { method: "POST", body: "{}" });
  return out.user;
}

export async function apiLogin(email: string, password: string): Promise<AuthUser> {
  const out = await api<{ ok: true; user: AuthUser }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return out.user;
}

export async function apiSignup(email: string, password: string): Promise<SignupResult> {
  const out = await api<{ ok: true; next: "confirm" | "done"; userConfirmed: boolean }>("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return { next: out.next, userConfirmed: out.userConfirmed };
}

export async function apiConfirm(email: string, code: string): Promise<void> {
  await api<{ ok: true }>("/auth/confirm", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

export async function apiLogout(): Promise<void> {
  await api<{ ok: true }>("/auth/logout", { method: "POST", body: "{}" });
}
