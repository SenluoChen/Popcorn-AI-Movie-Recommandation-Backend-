import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { env } from "./env.js";
import { authRouter } from "./routes/auth.js";
import { favoritesRouter } from "./routes/favorites.js";

const app = express();

app.use(
  cors({
    origin: env.frontendOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/auth", authRouter);

app.use("/favorites", favoritesRouter);

app.use((err: any, _req: any, res: any, _next: any) => {
  // eslint-disable-next-line no-console
  console.error(err);
  const msg = String(err?.message || "Server error");
  res.status(500).json({ error: msg });
});

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`cognito-auth-api listening on http://localhost:${env.port}`);
});
