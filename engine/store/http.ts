const HTTP_TIMEOUT_MS = 60_000;
// 商店 API 的重试策略只有这一份来源：fetch 侧按次数循环，curl 侧换算成 --retry
//（次数 - 1）与 --retry-delay（秒）。
const HTTP_ATTEMPTS = 4;
const HTTP_RETRY_DELAY_MS = 2_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 网络不可达的错误文案：必须点出端点、尝试次数与单次超时。构建日志里只有一句
 * `The signal has been aborted` 时，既看不出是哪个商店 API 在等，也看不出等了多久。
 */
export function httpUnreachableMessage(
  description: string,
  url: string,
  transportFailure: string,
): string {
  return `${description} unreachable: ${HTTP_ATTEMPTS} attempts to ${url}` +
    ` failed (${HTTP_TIMEOUT_MS}ms timeout each) —— ${transportFailure}`;
}

/**
 * 打网络的 JSON 请求唯一入口，两件事必须由它统一：
 * - 超时自述是哪个端点在等。裸 AbortController 抛的是 `The signal has been
 *   aborted`，五分钟引擎构建之后拿到这句话无从定位卡在哪一步。
 * - 瞬时网络故障重试。商店侧的 curl 调用一律 `--retry`，这里同样不能是单点。
 * HTTP 状态错误不重试：4xx/5xx 要带响应体上抛，让调用方看到商店给的原因。
 */
export async function requestJson(
  description: string,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  let lastTransportFailure = "";
  for (let attempt = 1; attempt <= HTTP_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (error) {
      lastTransportFailure = error instanceof Error
        ? error.message
        : String(error);
      if (attempt < HTTP_ATTEMPTS) {
        // 静默重试等于让终端在最长 4 分钟里什么都不显示——卡住必须当场可见。
        console.log(
          `[store] ${description} attempt ${attempt}/${HTTP_ATTEMPTS} failed: ${lastTransportFailure}; retrying in ${HTTP_RETRY_DELAY_MS}ms`,
        );
        await sleep(HTTP_RETRY_DELAY_MS);
      }
      continue;
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${description} failed ${response.status}: ${text}`);
    }
    return text === "" ? {} : JSON.parse(text);
  }
  throw new Error(
    httpUnreachableMessage(description, url, lastTransportFailure),
  );
}

const CURL_RETRY_ARGS: readonly string[] = [
  "--retry",
  String(HTTP_ATTEMPTS - 1),
  "--retry-delay",
  String(HTTP_RETRY_DELAY_MS / 1000),
  "--max-time",
  String(HTTP_TIMEOUT_MS / 1000),
];

export async function curlJsonRequest(
  args: readonly string[],
): Promise<unknown> {
  const result = await new Deno.Command("curl", {
    args: [
      "-fsSL",
      ...CURL_RETRY_ARGS,
      ...args,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
  const text = new TextDecoder().decode(result.stdout).trim();
  return text === "" ? {} : JSON.parse(text);
}

/** 调用方不看响应体，故丢弃而非 inherit：那点 JSON 打在控制台上只是噪声。 */
export async function curlNoJson(args: readonly string[]): Promise<void> {
  const result = await new Deno.Command("curl", {
    args: [
      "-fsS",
      ...CURL_RETRY_ARGS,
      ...args,
    ],
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
}

/**
 * 商店 API 的出口在本进程内显式钉死，不依赖调用者 shell 恰好导出了什么：无代理
 * 直连 `oauth2.googleapis.com` 只会挂到超时，所以代理是可达性前提而非可选优化。写进程
 * 环境而非只喂 fetch，是因为同一条出口必须同时覆盖 curl、altool、gh 这些子进程。
 * socks5 形式的 ALL_PROXY 不动：混合端口的代理两种协议同端口都听，改写它反而可能踩坏
 * 本机既有配置。
 */
export function applyStoreProxy(proxy: string): void {
  for (
    const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]
  ) {
    Deno.env.set(key, proxy);
  }
  console.log(`[store] store API egress via ${proxy}`);
}
