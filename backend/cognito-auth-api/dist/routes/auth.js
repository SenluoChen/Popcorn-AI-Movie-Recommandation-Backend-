import { Router } from "express";
import { env } from "../env.js";
import { clearAuthCookies, setAuthCookies } from "../cookies.js";
import { cognitoConfirm, cognitoLogin, cognitoRefresh, cognitoSignup } from "../cognito.js";
import { signMockJwt, verifyCognitoJwt, verifyMockJwt } from "../jwt.js";
export const authRouter = Router();
function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}
function getCookie(req, name) {
    return String(req?.cookies?.[name] || "");
}
function mockUserStore() {
    const g = globalThis;
    if (!g.__PC_MOCK_USERS__)
        g.__PC_MOCK_USERS__ = new Map();
    return g.__PC_MOCK_USERS__;
}
async function mockIssueCookies(res, email) {
    const idToken = await signMockJwt({ email }, { tokenUse: "id", expiresInSec: 60 * 60 });
    const accessToken = await signMockJwt({ email }, { tokenUse: "access", expiresInSec: 60 * 60 });
    // refresh token for mock: reuse a longer-lived access-like token
    const refreshToken = await signMockJwt({ email }, { tokenUse: "access", expiresInSec: 30 * 24 * 60 * 60 });
    setAuthCookies(res, { idToken, accessToken, refreshToken });
}
authRouter.post("/signup", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    if (!email)
        return res.status(400).json({ error: "Email is required" });
    if (!password)
        return res.status(400).json({ error: "Password is required" });
    if (env.authMode === "mock") {
        const users = mockUserStore();
        if (users.has(email))
            return res.status(400).json({ error: "This email is already registered" });
        users.set(email, { email, password, createdAt: Date.now() });
        // mock: no confirm required
        return res.json({ ok: true, userConfirmed: true, next: "done" });
    }
    const out = await cognitoSignup(email, password);
    // Cognito may require confirm code
    res.json({
        ok: true,
        userConfirmed: Boolean(out.UserConfirmed),
        userSub: out.UserSub,
        next: out.UserConfirmed ? "done" : "confirm",
    });
});
authRouter.post("/confirm", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || "").trim();
    if (!email)
        return res.status(400).json({ error: "Email is required" });
    if (!code)
        return res.status(400).json({ error: "Code is required" });
    if (env.authMode === "mock") {
        // mock: always confirmed
        return res.json({ ok: true });
    }
    await cognitoConfirm(email, code);
    res.json({ ok: true });
});
authRouter.post("/login", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    if (!email)
        return res.status(400).json({ error: "Email is required" });
    if (!password)
        return res.status(400).json({ error: "Password is required" });
    if (env.authMode === "mock") {
        const users = mockUserStore();
        const u = users.get(email);
        if (!u || u.password !== password)
            return res.status(401).json({ error: "Invalid email or password" });
        await mockIssueCookies(res, email);
        return res.json({ ok: true, user: { email, createdAt: u.createdAt } });
    }
    const auth = await cognitoLogin(email, password);
    const accessToken = auth?.AccessToken;
    const idToken = auth?.IdToken;
    const refreshToken = auth?.RefreshToken;
    if (!accessToken || !idToken) {
        return res.status(401).json({ error: "Login failed" });
    }
    setAuthCookies(res, { accessToken, idToken, refreshToken });
    const verified = await verifyCognitoJwt(idToken, "id");
    const user = { email: String(verified.claims.email || email), createdAt: Date.now() };
    res.json({ ok: true, user });
});
authRouter.post("/refresh", async (req, res) => {
    const refreshToken = getCookie(req, env.cookieNameRefresh);
    const idToken = getCookie(req, env.cookieNameId);
    if (env.authMode === "mock") {
        if (!refreshToken)
            return res.status(401).json({ error: "No refresh token" });
        try {
            const v = await verifyMockJwt(refreshToken);
            const email = normalizeEmail(String(v.claims.email || ""));
            if (!email)
                return res.status(401).json({ error: "Refresh failed" });
            await mockIssueCookies(res, email);
            return res.json({ ok: true, user: { email, createdAt: Date.now() } });
        }
        catch {
            return res.status(401).json({ error: "Refresh failed" });
        }
    }
    // Need an email to compute SECRET_HASH when client secret exists.
    // We can get it from id token if present; otherwise refresh may still work if client has no secret.
    let email = "";
    if (idToken) {
        try {
            const verified = await verifyCognitoJwt(idToken, "id");
            email = normalizeEmail(String(verified.claims.email || ""));
        }
        catch {
            // ignore
        }
    }
    if (!refreshToken)
        return res.status(401).json({ error: "No refresh token" });
    if (env.clientSecret && !email)
        return res.status(401).json({ error: "Cannot refresh session" });
    const auth = await cognitoRefresh(email, refreshToken);
    const nextAccess = auth?.AccessToken;
    const nextId = auth?.IdToken;
    if (!nextAccess || !nextId)
        return res.status(401).json({ error: "Refresh failed" });
    // Cognito usually does not return RefreshToken on refresh.
    setAuthCookies(res, { accessToken: nextAccess, idToken: nextId });
    const verified = await verifyCognitoJwt(nextId, "id");
    const user = { email: String(verified.claims.email || email), createdAt: Date.now() };
    res.json({ ok: true, user });
});
authRouter.post("/logout", async (_req, res) => {
    clearAuthCookies(res);
    res.json({ ok: true });
});
authRouter.get("/me", async (req, res) => {
    const idToken = getCookie(req, env.cookieNameId);
    if (!idToken)
        return res.status(401).json({ error: "Not authenticated" });
    try {
        const verified = env.authMode === "mock" ? await verifyMockJwt(idToken, "id") : await verifyCognitoJwt(idToken, "id");
        res.json({
            ok: true,
            user: {
                email: String(verified.claims.email || ""),
                createdAt: Date.now(),
            },
        });
    }
    catch {
        return res.status(401).json({ error: "Not authenticated" });
    }
});
