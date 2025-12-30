import { Router } from "express";
import { env } from "../env.js";
import { clearAuthCookies, setAuthCookies } from "../cookies.js";
import { cognitoConfirm, cognitoLogin, cognitoRefresh, cognitoSignup } from "../cognito.js";
import { signMockJwt, verifyCognitoJwt, verifyMockJwt } from "../jwt.js";

export const authRouter = Router();

type Json = Record<string, any>;

function normalizeEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

function getCookie(req: any, name: string): string {
  return String(req?.cookies?.[name] || "");
}

function mockUserStore() {
  const g = globalThis as any;
  if (!g.__PC_MOCK_USERS__) g.__PC_MOCK_USERS__ = new Map<string, { email: string; password: string; createdAt: number }>();
  return g.__PC_MOCK_USERS__ as Map<string, { email: string; password: string; createdAt: number }>;
}

async function mockIssueCookies(res: any, email: string) {
  const idToken = await signMockJwt({ email }, { tokenUse: "id", expiresInSec: 60 * 60 });
  const accessToken = await signMockJwt({ email }, { tokenUse: "access", expiresInSec: 60 * 60 });
  // refresh token for mock: reuse a longer-lived access-like token
  const refreshToken = await signMockJwt({ email }, { tokenUse: "access", expiresInSec: 30 * 24 * 60 * 60 });
  setAuthCookies(res, { idToken, accessToken, refreshToken });
}

authRouter.post("/signup", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  if (!email) return res.status(400).json({ error: "Email is required" } as Json);
  if (!password) return res.status(400).json({ error: "Password is required" } as Json);

  if (env.authMode === "mock") {
    const users = mockUserStore();
    if (users.has(email)) return res.status(400).json({ error: "This email is already registered" } as Json);
    users.set(email, { email, password, createdAt: Date.now() });
    // mock: no confirm required
    return res.json({ ok: true, userConfirmed: true, next: "done" } as Json);
  }

  const out = await cognitoSignup(email, password);
  // Cognito may require confirm code
  res.json({
    ok: true,
    userConfirmed: Boolean(out.UserConfirmed),
    userSub: out.UserSub,
    next: out.UserConfirmed ? "done" : "confirm",
  } as Json);
});

authRouter.post("/confirm", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || "").trim();
  if (!email) return res.status(400).json({ error: "Email is required" } as Json);
  if (!code) return res.status(400).json({ error: "Code is required" } as Json);

  if (env.authMode === "mock") {
    // mock: always confirmed
    return res.json({ ok: true } as Json);
  }

  await cognitoConfirm(email, code);
  res.json({ ok: true } as Json);
});

authRouter.post("/login", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  if (!email) return res.status(400).json({ error: "Email is required" } as Json);
  if (!password) return res.status(400).json({ error: "Password is required" } as Json);

  if (env.authMode === "mock") {
    const users = mockUserStore();
    const u = users.get(email);
    if (!u || u.password !== password) return res.status(401).json({ error: "Invalid email or password" } as Json);
    await mockIssueCookies(res, email);
    return res.json({ ok: true, user: { email, createdAt: u.createdAt } } as Json);
  }

  const auth = await cognitoLogin(email, password);
  const accessToken = auth?.AccessToken;
  const idToken = auth?.IdToken;
  const refreshToken = auth?.RefreshToken;

  if (!accessToken || !idToken) {
    return res.status(401).json({ error: "Login failed" } as Json);
  }

  setAuthCookies(res, { accessToken, idToken, refreshToken });

  const verified = await verifyCognitoJwt(idToken, "id");
  const user = { email: String((verified.claims as any).email || email), createdAt: Date.now() };
  res.json({ ok: true, user } as Json);
});

authRouter.post("/refresh", async (req, res) => {
  const refreshToken = getCookie(req, env.cookieNameRefresh);
  const idToken = getCookie(req, env.cookieNameId);

  if (env.authMode === "mock") {
    if (!refreshToken) return res.status(401).json({ error: "No refresh token" } as Json);
    try {
      const v = await verifyMockJwt(refreshToken);
      const email = normalizeEmail(String((v.claims as any).email || ""));
      if (!email) return res.status(401).json({ error: "Refresh failed" } as Json);
      await mockIssueCookies(res, email);
      return res.json({ ok: true, user: { email, createdAt: Date.now() } } as Json);
    } catch {
      return res.status(401).json({ error: "Refresh failed" } as Json);
    }
  }

  // Need an email to compute SECRET_HASH when client secret exists.
  // We can get it from id token if present; otherwise refresh may still work if client has no secret.
  let email = "";
  if (idToken) {
    try {
      const verified = await verifyCognitoJwt(idToken, "id");
      email = normalizeEmail(String((verified.claims as any).email || ""));
    } catch {
      // ignore
    }
  }

  if (!refreshToken) return res.status(401).json({ error: "No refresh token" } as Json);
  if (env.clientSecret && !email) return res.status(401).json({ error: "Cannot refresh session" } as Json);

  const auth = await cognitoRefresh(email, refreshToken);
  const nextAccess = auth?.AccessToken;
  const nextId = auth?.IdToken;

  if (!nextAccess || !nextId) return res.status(401).json({ error: "Refresh failed" } as Json);

  // Cognito usually does not return RefreshToken on refresh.
  setAuthCookies(res, { accessToken: nextAccess, idToken: nextId });

  const verified = await verifyCognitoJwt(nextId, "id");
  const user = { email: String((verified.claims as any).email || email), createdAt: Date.now() };
  res.json({ ok: true, user } as Json);
});

authRouter.post("/logout", async (_req, res) => {
  clearAuthCookies(res);
  res.json({ ok: true } as Json);
});

authRouter.get("/me", async (req, res) => {
  const idToken = getCookie(req, env.cookieNameId);
  if (!idToken) return res.status(401).json({ error: "Not authenticated" } as Json);

  try {
    const verified = env.authMode === "mock" ? await verifyMockJwt(idToken, "id") : await verifyCognitoJwt(idToken, "id");
    res.json({
      ok: true,
      user: {
        email: String((verified.claims as any).email || ""),
        createdAt: Date.now(),
      },
    } as Json);
  } catch {
    return res.status(401).json({ error: "Not authenticated" } as Json);
  }
});
