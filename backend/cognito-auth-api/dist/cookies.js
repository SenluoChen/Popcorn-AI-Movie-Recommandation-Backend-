import { env } from "./env.js";
export function setAuthCookies(res, tokens) {
    const common = {
        httpOnly: true,
        secure: env.cookieSecure,
        sameSite: env.cookieSameSite,
        path: "/",
    };
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
export function clearAuthCookies(res) {
    const common = {
        httpOnly: true,
        secure: env.cookieSecure,
        sameSite: env.cookieSameSite,
        path: "/",
    };
    res.clearCookie(env.cookieNameAccess, common);
    res.clearCookie(env.cookieNameId, common);
    res.clearCookie(env.cookieNameRefresh, common);
}
