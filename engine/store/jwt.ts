import type { StoreEnv } from "./config.ts";

/**
 * Apple 允许的 JWT 上限，比 apple.ts 的 PROCESSING_TIMEOUT_MS（轮询窗口）短：processing
 * 慢过 20 分钟是常态，故 token 绝不能整轮共用，每次 ASC 请求现签（共用会在轮询中途
 * 401 掉整轮发布）。ascJson 是唯一持有者，调用方拿不到 token，也就无从复用。
 */
const ASC_JWT_LIFETIME_SECONDS = 20 * 60;
const GOOGLE_JWT_LIFETIME_SECONDS = 60 * 60;

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function utf8Base64Url(text: string): string {
  return base64Url(new TextEncoder().encode(text));
}

function pkcs8KeyBytes(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(
    /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,
    "",
  );
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}

export async function serviceAccountJwt(params: {
  clientEmail: string;
  privateKeyPem: string;
  tokenUri: string;
  issuedAt: number;
}): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8KeyBytes(params.privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const header = utf8Base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = utf8Base64Url(JSON.stringify({
    iss: params.clientEmail,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: params.tokenUri,
    iat: params.issuedAt,
    exp: params.issuedAt + GOOGLE_JWT_LIFETIME_SECONDS,
  }));
  const signingInput = `${header}.${payload}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(signingInput),
    ),
  );
  return `${signingInput}.${base64Url(signature)}`;
}

export async function appStoreConnectJwt(env: StoreEnv): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8KeyBytes(Deno.readTextFileSync(env.appStoreKeyPath)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const header = utf8Base64Url(
    JSON.stringify({ alg: "ES256", kid: env.appStoreKeyId, typ: "JWT" }),
  );
  const payload = utf8Base64Url(JSON.stringify({
    iss: env.appStoreIssuerId,
    iat: now,
    exp: now + ASC_JWT_LIFETIME_SECONDS,
    aud: "appstoreconnect-v1",
  }));
  const signingInput = `${header}.${payload}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(signingInput),
    ),
  );
  return `${signingInput}.${base64Url(signature)}`;
}
