import dotenv from "dotenv";
dotenv.config();
function req(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`Missing env: ${name}`);
    return v;
}
const authMode = String(process.env.AUTH_MODE || "cognito").toLowerCase();
export const env = {
    authMode,
    port: Number(process.env.PORT || 3001),
    frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:3000",
    awsRegion: authMode === "mock" ? (process.env.AWS_REGION || "us-east-1") : req("AWS_REGION"),
    userPoolId: authMode === "mock" ? (process.env.COGNITO_USER_POOL_ID || "mock") : req("COGNITO_USER_POOL_ID"),
    clientId: authMode === "mock" ? (process.env.COGNITO_CLIENT_ID || "mock") : req("COGNITO_CLIENT_ID"),
    clientSecret: process.env.COGNITO_CLIENT_SECRET || "",
    mockJwtSecret: process.env.MOCK_JWT_SECRET || "dev-only-change-me",
    cookieNameAccess: process.env.COOKIE_NAME_ACCESS || "pc_at",
    cookieNameId: process.env.COOKIE_NAME_ID || "pc_it",
    cookieNameRefresh: process.env.COOKIE_NAME_REFRESH || "pc_rt",
    cookieSecure: String(process.env.COOKIE_SECURE || "false").toLowerCase() === "true",
    cookieSameSite: (process.env.COOKIE_SAMESITE || "lax"),
};
