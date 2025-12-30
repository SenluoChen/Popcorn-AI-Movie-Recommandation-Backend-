import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import { env } from "./env.js";

const issuer = `https://cognito-idp.${env.awsRegion}.amazonaws.com/${env.userPoolId}`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

export type Verified = {
  claims: Record<string, any>;
};

export async function verifyCognitoJwt(token: string, expectedUse?: "access" | "id"): Promise<Verified> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience: env.clientId,
  });

  if (expectedUse) {
    const use = String((payload as any).token_use || "");
    if (use !== expectedUse) throw new Error(`Invalid token_use: ${use}`);
  }

  return { claims: payload as any };
}

export async function signMockJwt(payload: Record<string, any>, opts: { tokenUse: "id" | "access"; expiresInSec: number }) {
  const key = new TextEncoder().encode(env.mockJwtSecret);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...payload, token_use: opts.tokenUse })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setIssuer("popcorn-mock")
    .setAudience("popcorn")
    .setExpirationTime(now + opts.expiresInSec)
    .sign(key);
}

export async function verifyMockJwt(token: string, expectedUse?: "access" | "id"): Promise<Verified> {
  const key = new TextEncoder().encode(env.mockJwtSecret);
  const { payload } = await jwtVerify(token, key, {
    issuer: "popcorn-mock",
    audience: "popcorn",
  });
  if (expectedUse) {
    const use = String((payload as any).token_use || "");
    if (use !== expectedUse) throw new Error(`Invalid token_use: ${use}`);
  }
  return { claims: payload as any };
}
