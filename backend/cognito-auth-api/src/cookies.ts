import type { Response } from "express";
import { env } from "./env.js";

export function setAuthCookies(res: Response, tokens: { accessToken?: string; idToken?: string; refreshToken?: string }) {
  const common = {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
  } as const;

  if (tokens.accessToken) {
    res.cookie(env.cookieNameAccess, tokens.accessToken, { ...common, maxAge: 60 * 60 * 1000 });
  }
  if (tokens.idToken) {
    res.cookie(env.cookieNameId, tokens.idToken, { ...common, maxAge: 60 * 60 * 1000 });
  }
  if (tokens.refreshToken) {
    // Cognito refresh token often valid days; keep a conservative 30 days
    res.cookie(env.cookieNameRefresh, tokens.refreshToken, { ...common, maxAge: 30 * 24 * 60 * 60 * 1000 });
  }
}

export function clearAuthCookies(res: Response) {
  const common = {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
  } as const;

  res.clearCookie(env.cookieNameAccess, common);
  res.clearCookie(env.cookieNameId, common);
  res.clearCookie(env.cookieNameRefresh, common);
}
