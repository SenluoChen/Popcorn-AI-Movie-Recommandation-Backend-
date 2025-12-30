import crypto from "crypto";
import { CognitoIdentityProviderClient, ConfirmSignUpCommand, InitiateAuthCommand, SignUpCommand, } from "@aws-sdk/client-cognito-identity-provider";
import { env } from "./env.js";
export const cognito = new CognitoIdentityProviderClient({ region: env.awsRegion });
export function secretHash(username) {
    if (!env.clientSecret)
        return undefined;
    const h = crypto
        .createHmac("sha256", env.clientSecret)
        .update(username + env.clientId)
        .digest("base64");
    return h;
}
export async function cognitoSignup(email, password) {
    const Username = email;
    const cmd = new SignUpCommand({
        ClientId: env.clientId,
        Username,
        Password: password,
        SecretHash: secretHash(Username),
        UserAttributes: [{ Name: "email", Value: email }],
    });
    return cognito.send(cmd);
}
export async function cognitoConfirm(email, code) {
    const Username = email;
    const cmd = new ConfirmSignUpCommand({
        ClientId: env.clientId,
        Username,
        ConfirmationCode: code,
        SecretHash: secretHash(Username),
    });
    return cognito.send(cmd);
}
export async function cognitoLogin(email, password) {
    const Username = email;
    const cmd = new InitiateAuthCommand({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: env.clientId,
        AuthParameters: {
            USERNAME: Username,
            PASSWORD: password,
            ...(env.clientSecret ? { SECRET_HASH: secretHash(Username) } : {}),
        },
    });
    const res = await cognito.send(cmd);
    return res.AuthenticationResult;
}
export async function cognitoRefresh(email, refreshToken) {
    const Username = email;
    const cmd = new InitiateAuthCommand({
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: env.clientId,
        AuthParameters: {
            REFRESH_TOKEN: refreshToken,
            ...(env.clientSecret ? { SECRET_HASH: secretHash(Username) } : {}),
        },
    });
    const res = await cognito.send(cmd);
    return res.AuthenticationResult;
}
