import { readFile } from "node:fs/promises";
import { logger } from "./middleware/logger.js";

/**
 * Helpers shared by the per-plugin auto-seed functions below.
 */

function apiBaseUrl(): string {
  const port = process.env.PAPERCLIP_LISTEN_PORT || process.env.PORT || "3100";
  return `http://127.0.0.1:${port}`;
}

type PluginRow = { id: string; pluginKey: string; status: string };

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers as Record<string, string> ?? {}) },
  });
  const text = await res.text();
  let body: any;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
}

/**
 * Find existing secrets for a company and return a lookup-by-name plus a
 * findOrCreate helper scoped to that company.  The helper records the first
 * company's secret ids into `secretIdsByName` so plugin config (which is
 * per-plugin, not per-company) can reference them.
 */
async function withCompanySecrets(
  secretsPluginId: string,
  companyId: string,
  secretIdsByName: Record<string, string>,
) {
  const listResp = await api(`/api/plugins/${secretsPluginId}/data/list-secrets`, {
    method: "POST",
    body: JSON.stringify({ companyId, params: { companyId } }),
  });
  const existingArr = (() => {
    const data = listResp?.data ?? listResp ?? [];
    return Array.isArray(data) ? data : (data.secrets ?? []);
  })() as Array<{ id: string; name: string }>;
  const findExisting = (name: string) => existingArr.find((s) => s?.name === name);

  return async function createSecret(name: string, value: string): Promise<string> {
    const existing = findExisting(name);
    if (existing) {
      if (!secretIdsByName[name]) secretIdsByName[name] = existing.id;
      return existing.id;
    }
    const resp = await api(`/api/plugins/${secretsPluginId}/actions/create-secret`, {
      method: "POST",
      body: JSON.stringify({
        companyId,
        params: { companyId, name, value, provider: "local_encrypted" },
      }),
    });
    const created = resp?.data ?? resp;
    const id = created?.id ?? created?.secret?.id;
    if (id && !secretIdsByName[name]) secretIdsByName[name] = id;
    return id;
  };
}

/**
 * Auto-seed research + market-data plugin secrets from environment variables.
 *
 * Reads FRED_API_KEY, SEC_EDGAR_USER_AGENT, ALPACA_API_KEY_ID,
 * ALPACA_SECRET_KEY from process.env. If present, creates corresponding
 * Paperclip secrets (idempotent — skips if they already exist) and saves
 * the research / market-data plugin instance configs with the secret refs.
 *
 * Called at startup (may no-op if no companies exist yet) and again
 * after company creation so secrets are available immediately.
 */
export async function autoSeedResearchSecrets() {
  const fredKey = process.env.FRED_API_KEY?.trim();
  const secEdgarAgent = process.env.SEC_EDGAR_USER_AGENT?.trim();
  const alpacaKeyId = process.env.ALPACA_API_KEY_ID?.trim();
  const alpacaSecret = process.env.ALPACA_SECRET_KEY?.trim();

  if (!fredKey && !secEdgarAgent && !alpacaKeyId) return;

  const plugins = await api("/api/plugins") as PluginRow[];
  const research = plugins.find((p) => p.pluginKey === "paperclip-plugin-research");
  const secrets = plugins.find((p) => p.pluginKey === "lucitra.plugin-secrets");
  if (!research || !secrets) {
    logger.debug("auto-seed research: research or secrets plugin not ready yet");
    return;
  }

  const companies = await api("/api/companies") as Array<{ id: string; name?: string }>;
  if (!companies.length) return;

  const secretIdsByName: Record<string, string> = {};

  for (const company of companies) {
    const createSecret = await withCompanySecrets(secrets.id, company.id, secretIdsByName);

    if (alpacaKeyId) await createSecret("market-data-alpaca-key-id", alpacaKeyId);
    if (alpacaSecret) await createSecret("market-data-alpaca-secret", alpacaSecret);
    if (fredKey) await createSecret("research-fred-api-key", fredKey);

    logger.info({ companyId: company.id }, "auto-seed: secrets seeded for company");
  }

  const researchConfig: Record<string, unknown> = {};
  if (secretIdsByName["research-fred-api-key"]) {
    researchConfig.fredApiKeyRef = secretIdsByName["research-fred-api-key"];
  }
  if (secEdgarAgent) {
    researchConfig.secEdgarUserAgent = secEdgarAgent;
  }

  if (Object.keys(researchConfig).length > 0) {
    await api(`/api/plugins/${research.id}/config`, {
      method: "POST",
      body: JSON.stringify({ configJson: researchConfig }),
    });
    logger.info({ keys: Object.keys(researchConfig) }, "auto-seed research: config saved");
  }

  const marketDataConfig: Record<string, unknown> = {};
  if (secretIdsByName["market-data-alpaca-key-id"]) {
    marketDataConfig.alpacaKeyIdRef = secretIdsByName["market-data-alpaca-key-id"];
  }
  if (secretIdsByName["market-data-alpaca-secret"]) {
    marketDataConfig.alpacaSecretRef = secretIdsByName["market-data-alpaca-secret"];
  }
  if (Object.keys(marketDataConfig).length > 0) {
    const marketData = plugins.find((p) => p.pluginKey === "paperclip-plugin-market-data");
    if (marketData) {
      await api(`/api/plugins/${marketData.id}/config`, {
        method: "POST",
        body: JSON.stringify({ configJson: marketDataConfig }),
      });
      logger.info({ keys: Object.keys(marketDataConfig) }, "auto-seed market-data: config saved");
    }
  }
}

/**
 * Auto-seed Kalshi plugin secrets from environment variables.
 *
 * Reads KALSHI_ENV, KALSHI_DEMO_API_KEY_ID, KALSHI_DEMO_PRIVATE_KEY_PATH,
 * KALSHI_PROD_API_KEY_ID, KALSHI_PROD_PRIVATE_KEY_PATH from process.env.
 * PEM file paths support `~/` expansion and are resolved relative to the
 * server's cwd when non-absolute. Inline `KALSHI_<ENV>_PRIVATE_KEY` values
 * are also accepted (escaped `\n` gets unescaped) for deployments where
 * files aren't practical, mirroring the GITHUB_APP_PRIVATE_KEY pattern.
 *
 * Creates two secrets per configured env (`kalshi-<env>-api-key-id` and
 * `kalshi-<env>-private-key`), saves the Kalshi plugin instance config
 * with matching refs plus `defaultEnv`. Idempotent.
 */
export async function autoSeedKalshiSecrets() {
  const defaultEnvRaw = process.env.KALSHI_ENV?.trim().toLowerCase();
  const defaultEnv: "demo" | "prod" =
    defaultEnvRaw === "prod" ? "prod" : "demo";

  const demoKeyId = process.env.KALSHI_DEMO_API_KEY_ID?.trim();
  const prodKeyId = process.env.KALSHI_PROD_API_KEY_ID?.trim();

  if (!demoKeyId && !prodKeyId) return;

  const demoPem = demoKeyId ? await readPrivateKey("KALSHI_DEMO") : null;
  const prodPem = prodKeyId ? await readPrivateKey("KALSHI_PROD") : null;

  const demoOk = Boolean(demoKeyId && demoPem);
  const prodOk = Boolean(prodKeyId && prodPem);

  if (demoKeyId && !demoPem) {
    logger.warn(
      { path: process.env.KALSHI_DEMO_PRIVATE_KEY_PATH },
      "auto-seed kalshi: demo api key set but PEM not found — demo env will not be seeded",
    );
  }
  if (prodKeyId && !prodPem) {
    logger.warn(
      { path: process.env.KALSHI_PROD_PRIVATE_KEY_PATH },
      "auto-seed kalshi: prod api key set but PEM not found — prod env will not be seeded",
    );
  }
  if (!demoOk && !prodOk) return;

  const plugins = await api("/api/plugins") as PluginRow[];
  const kalshi = plugins.find((p) => p.pluginKey === "paperclip-plugin-kalshi");
  const secrets = plugins.find((p) => p.pluginKey === "lucitra.plugin-secrets");
  if (!kalshi || !secrets) {
    logger.debug("auto-seed kalshi: kalshi or secrets plugin not ready yet");
    return;
  }

  const companies = await api("/api/companies") as Array<{ id: string; name?: string }>;
  if (!companies.length) return;

  const secretIdsByName: Record<string, string> = {};

  for (const company of companies) {
    const createSecret = await withCompanySecrets(secrets.id, company.id, secretIdsByName);

    if (demoOk) {
      await createSecret("kalshi-demo-api-key-id", demoKeyId!);
      await createSecret("kalshi-demo-private-key", demoPem!);
    }
    if (prodOk) {
      await createSecret("kalshi-prod-api-key-id", prodKeyId!);
      await createSecret("kalshi-prod-private-key", prodPem!);
    }

    logger.info({ companyId: company.id }, "auto-seed kalshi: secrets seeded for company");
  }

  const kalshiConfig: Record<string, unknown> = { defaultEnv };
  if (secretIdsByName["kalshi-demo-api-key-id"] && secretIdsByName["kalshi-demo-private-key"]) {
    kalshiConfig.demo = {
      apiKeyIdRef: secretIdsByName["kalshi-demo-api-key-id"],
      privateKeyRef: secretIdsByName["kalshi-demo-private-key"],
    };
  }
  if (secretIdsByName["kalshi-prod-api-key-id"] && secretIdsByName["kalshi-prod-private-key"]) {
    kalshiConfig.prod = {
      apiKeyIdRef: secretIdsByName["kalshi-prod-api-key-id"],
      privateKeyRef: secretIdsByName["kalshi-prod-private-key"],
    };
  }

  await api(`/api/plugins/${kalshi.id}/config`, {
    method: "POST",
    body: JSON.stringify({ configJson: kalshiConfig }),
  });
  logger.info(
    {
      defaultEnv,
      envs: [demoOk && "demo", prodOk && "prod"].filter(Boolean),
    },
    "auto-seed kalshi: config saved",
  );
}

/**
 * Read a Kalshi private key from the `<prefix>_PRIVATE_KEY` inline env var
 * (escaped `\n` gets unescaped, same as GITHUB_APP_PRIVATE_KEY) or from
 * `<prefix>_PRIVATE_KEY_PATH`.  Paths support `~/` expansion and relative
 * resolution against the server's cwd.
 *
 * @param prefix - "KALSHI_DEMO" or "KALSHI_PROD"
 * @returns PEM contents or null if neither var resolves to a readable key.
 */
async function readPrivateKey(prefix: "KALSHI_DEMO" | "KALSHI_PROD"): Promise<string | null> {
  const inline = process.env[`${prefix}_PRIVATE_KEY`]?.trim();
  if (inline) {
    return inline.includes("\\n") ? inline.replace(/\\n/g, "\n") : inline;
  }

  const rawPath = process.env[`${prefix}_PRIVATE_KEY_PATH`]?.trim();
  if (!rawPath) return null;

  const expanded = rawPath.startsWith("~/")
    ? `${process.env.HOME ?? ""}${rawPath.slice(1)}`
    : rawPath;

  try {
    return await readFile(expanded, "utf8");
  } catch {
    return null;
  }
}
