import { SAML } from "@node-saml/node-saml";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { AsyncLocalStorage } from "node:async_hooks";
import { Op } from "sequelize";
import { db, models as M } from "./db.js";
import {
  fail,
  token,
  hash,
  plain,
  scopedDepartments,
  permissionsSchema,
  audit,
} from "./core.js";

export const production = process.env.NODE_ENV === "production";
export const mockAuth = !production && process.env.MOCK_AUTH === "true";
export const origin = process.env.APP_ORIGIN || "http://127.0.0.1:5173";
export const secret =
  process.env.SESSION_SECRET ||
  (!production ? "local-development-only-change-before-deploying" : "");
if (
  production &&
  (secret.length < 32 ||
    secret.includes("replace-with") ||
    !origin.startsWith("https://"))
)
  throw new Error(
    "Production requires HTTPS APP_ORIGIN and a unique SESSION_SECRET of at least 32 characters.",
  );
const cookieOptions = {
  httpOnly: true,
  secure: production,
  sameSite: "lax",
  signed: true,
  path: "/",
  maxAge: 8 * 60 * 60 * 1000,
};
const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
async function createSession(res, user) {
  const sid = token(),
    csrf = token();
  await M.sessions.create({
    sid: hash(sid),
    expires_at: new Date(Date.now() + cookieOptions.maxAge),
    data: JSON.stringify({ userId: user.id, csrf }),
  });
  res.cookie("ledger_session", sid, cookieOptions);
  return csrf;
}
export async function loadIdentity(req, res, next) {
  const sid = req.signedCookies?.ledger_session;
  if (!sid) return next();
  const session = await M.sessions.findByPk(hash(sid));
  if (!session || session.expires_at <= new Date()) return next();
  const data = JSON.parse(session.data),
    user = await M.users.findByPk(data.userId);
  if (!user?.is_active) return next();
  const role = await M.roles.findByPk(user.role_id);
  if (!role) return next();
  const permissions = permissionsSchema.parse(
    JSON.parse(role.permissions_json || "{}"),
  );
  const departments = await scopedDepartments(user, permissions);
  req.ctx = {
    user: plain(user),
    role: plain(role),
    permissions,
    departmentIds: departments.map((x) => x.id),
    departments: departments.map(plain),
    csrf: data.csrf,
    sessionId: session.sid,
  };
  next();
}
export function authenticated(req, res, next) {
  if (!req.ctx) fail(401, "Please sign in to your workspace.");
  next();
}
export function originGuard(req, res, next) {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers.origin &&
    req.headers.origin !== origin
  )
    fail(403, "Request origin is not permitted.");
  next();
}
export function csrfGuard(req, res, next) {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.get("x-csrf-token") !== req.ctx.csrf
  )
    fail(
      403,
      "Your session token is missing or expired. Refresh and try again.",
    );
  next();
}
export function publicIdentity(ctx) {
  return {
    user: ctx.user,
    role: ctx.role.role_name,
    permissions: ctx.permissions,
    departments: ctx.departments,
    csrf: ctx.csrf,
  };
}
let saml;
const samlTransactions = new AsyncLocalStorage();
export function samlConfigured() {
  return Boolean(
    process.env.SAML_ENTRY_POINT &&
    process.env.SAML_ISSUER &&
    process.env.SAML_CALLBACK_URL &&
    process.env.SAML_IDP_CERT &&
    process.env.SAML_SP_PRIVATE_KEY &&
    process.env.SAML_SP_CERT,
  );
}
function samlClient() {
  if (!samlConfigured())
    fail(
      503,
      "UIC SAML is not configured. The administrator must supply identity-provider settings.",
    );
  if (saml) return saml;
  saml = new SAML({
    entryPoint: process.env.SAML_ENTRY_POINT,
    issuer: process.env.SAML_ISSUER,
    callbackUrl: process.env.SAML_CALLBACK_URL,
    idpCert: process.env.SAML_IDP_CERT.replaceAll("\\n", "\n"),
    privateKey: process.env.SAML_SP_PRIVATE_KEY.replaceAll("\\n", "\n"),
    publicCert: process.env.SAML_SP_CERT.replaceAll("\\n", "\n"),
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: true,
    validateInResponseTo: "always",
    requestIdExpirationPeriodMs: 5 * 60 * 1000,
    acceptedClockSkewMs: 30000,
    audience: process.env.SAML_ISSUER,
    cacheProvider: {
      async saveAsync(key, value) {
        const createdAt = new Date();
        await M.saml_requests.create({
          request_id: key,
          expires_at: new Date(Date.now() + 300000),
          validation_token: value,
        });
        return { value, createdAt };
      },
      async getAsync(key) {
        const transaction = samlTransactions.getStore();
        const x = await M.saml_requests.findByPk(key, {
          transaction,
          ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}),
        });
        return x &&
          x.validation_state === "pending" &&
          x.expires_at > new Date()
          ? x.validation_token
          : null;
      },
      async removeAsync(key) {
        const [changed] = await M.saml_requests.update(
          { validation_state: "consumed" },
          {
            where: {
              request_id: key,
              validation_state: "pending",
              expires_at: { [Op.gt]: new Date() },
            },
            transaction: samlTransactions.getStore(),
          },
        );
        return changed ? key : null;
      },
    },
  });
  return saml;
}
export function authRoutes(app) {
  app.get("/api/auth/config", async (req, res) =>
    res.json({
      mock: mockAuth,
      saml: samlConfigured(),
      users: mockAuth
        ? await M.users.findAll({
            where: { is_active: true },
            attributes: ["id", "first_name", "last_name", "netid"],
            order: [["id", "ASC"]],
          })
        : [],
    }),
  );
  app.post("/api/auth/mock", loginLimit, originGuard, async (req, res) => {
    if (!mockAuth) fail(404, "Mock sign-in is disabled.");
    const { user_id } = z
      .object({ user_id: z.coerce.number().int().positive() })
      .parse(req.body);
    const user = await M.users.findByPk(user_id);
    if (!user?.is_active) fail(403, "This account is unavailable.");
    if (req.ctx)
      await M.sessions.destroy({ where: { sid: req.ctx.sessionId } });
    await createSession(res, user);
    await audit({ user }, "sign_in", "users", null, user);
    res.json({ success: true });
  });
  app.get("/api/auth/saml/login", loginLimit, async (req, res) =>
    res.redirect(await samlClient().getAuthorizeUrlAsync("", undefined, {})),
  );
  app.get("/api/auth/saml/metadata", (req, res) =>
    res
      .type("application/xml")
      .send(
        samlClient().generateServiceProviderMetadata(
          null,
          process.env.SAML_SP_CERT.replaceAll("\\n", "\n"),
        ),
      ),
  );
  app.post("/api/auth/saml/callback", loginLimit, async (req, res) => {
    const { profile } = await db.transaction((transaction) =>
      samlTransactions.run(transaction, () =>
        samlClient().validatePostResponseAsync(req.body),
      ),
    );
    const netid = profile?.[process.env.SAML_NETID_ATTRIBUTE || "uid"];
    if (typeof netid !== "string")
      fail(
        403,
        "The SAML assertion does not contain the configured NetID attribute.",
      );
    const user = await M.users.findOne({ where: { netid, is_active: true } });
    if (!user)
      fail(
        403,
        "Your UIC account has not been provisioned for this application.",
      );
    await createSession(res, user);
    await audit({ user }, "sign_in_saml", "users", null, user);
    res.redirect(`${origin}/app`);
  });
  app.get("/api/auth/me", authenticated, (req, res) =>
    res.json(publicIdentity(req.ctx)),
  );
  app.post(
    "/api/auth/logout",
    authenticated,
    originGuard,
    csrfGuard,
    async (req, res) => {
      await M.sessions.destroy({ where: { sid: req.ctx.sessionId } });
      res.clearCookie("ledger_session", {
        path: "/",
        secure: production,
        httpOnly: true,
        sameSite: "lax",
      });
      res.json({ success: true });
    },
  );
}
