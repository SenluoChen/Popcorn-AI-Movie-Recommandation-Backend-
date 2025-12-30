import type { AuthUser } from "./types";

type StoredUser = {
  email: string;
  salt: string;
  passwordHash: string;
  createdAt: number;
};

type StoredSession = {
  email: string;
  createdAt: number;
};

const USERS_KEY = "pc:auth:users:v1";
const SESSION_KEY = "pc:auth:session:v1";

function normalizeEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

function readUsers(): Record<string, StoredUser> {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, StoredUser>;
  } catch {
    return {};
  }
}

function writeUsers(users: Record<string, StoredUser>) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    const email = normalizeEmail(parsed?.email);
    if (!email) return null;
    return { email, createdAt: typeof parsed?.createdAt === "number" ? parsed.createdAt : Date.now() };
  } catch {
    return null;
  }
}

function writeSession(session: StoredSession | null) {
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function randomSaltBase64(byteLen = 16): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes);
}

async function sha256Base64(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return bytesToBase64(new Uint8Array(buf));
}

async function hashPassword(password: string, salt: string): Promise<string> {
  // Demo-only client-side hash. For production, use server-side auth.
  return sha256Base64(`${salt}:${password}`);
}

export async function localGetCurrentUser(): Promise<AuthUser | null> {
  const session = readSession();
  if (!session) return null;
  const users = readUsers();
  const u = users[session.email];
  if (!u) {
    writeSession(null);
    return null;
  }
  return { email: u.email, createdAt: u.createdAt };
}

export async function localSignup(email: string, password: string): Promise<AuthUser> {
  const e = normalizeEmail(email);
  if (!e) throw new Error("Email is required");
  if (!String(password || "").trim()) throw new Error("Password is required");
  if (String(password).length < 6) throw new Error("Password must be at least 6 characters");

  const users = readUsers();
  if (users[e]) throw new Error("This email is already registered");

  const salt = randomSaltBase64(16);
  const passwordHash = await hashPassword(password, salt);
  const createdAt = Date.now();

  users[e] = { email: e, salt, passwordHash, createdAt };
  writeUsers(users);
  writeSession({ email: e, createdAt: Date.now() });
  return { email: e, createdAt };
}

export async function localLogin(email: string, password: string): Promise<AuthUser> {
  const e = normalizeEmail(email);
  if (!e) throw new Error("Email is required");
  if (!String(password || "").trim()) throw new Error("Password is required");

  const users = readUsers();
  const u = users[e];
  if (!u) throw new Error("Invalid email or password");

  const passwordHash = await hashPassword(password, u.salt);
  if (passwordHash !== u.passwordHash) throw new Error("Invalid email or password");

  writeSession({ email: e, createdAt: Date.now() });
  return { email: u.email, createdAt: u.createdAt };
}

export async function localLogout(): Promise<void> {
  writeSession(null);
}
