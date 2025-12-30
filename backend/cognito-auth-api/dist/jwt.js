import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import { env } from "./env.js";
const issuer = `https://cognito-idp.${env.awsRegion}.amazonaws.com/${env.userPoolId}`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
export async function verifyCognitoJwt(token, expectedUse) {
    const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: env.clientId,
    });
    if (expectedUse) {
        const use = String(payload.token_use || "");
        if (use !== expectedUse)
            throw new Error(`Invalid token_use: ${use}`);
    }
    return { claims: payload };
}
export async function signMockJwt(payload, opts) {
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
export async function verifyMockJwt(token, expectedUse) {
    const key = new TextEncoder().encode(env.mockJwtSecret);
    const { payload } = await jwtVerify(token, key, {
        issuer: "popcorn-mock",
        audience: "popcorn",
    });
    if (expectedUse) {
        const use = String(payload.token_use || "");
        if (use !== expectedUse)
            throw new Error(`Invalid token_use: ${use}`);
    }
    return { claims: payload };
}
