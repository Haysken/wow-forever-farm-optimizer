import type { ZodType, ZodTypeDef } from "zod";

export const DEFAULT_USER_AGENT =
  "WoWForeverFarmOptimizer/0.1 (+https://github.com/Haysken/wow-forever-farm-optimizer)";

export interface FetchJsonOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxRetries?: number;
  minIntervalMs?: number;
  fetchImpl?: typeof fetch;
}

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly status: number,
    public readonly retryAfterSec: number | null = null
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

export class RateLimiter {
  private lastCallAt = 0;

  constructor(private readonly minIntervalMs: number) {}

  async wait(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const now = Date.now();
    const elapsed = now - this.lastCallAt;
    if (elapsed < this.minIntervalMs) {
      await sleep(this.minIntervalMs - elapsed);
    }
    this.lastCallAt = Date.now();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const asSeconds = Number(header);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return asSeconds;
  }
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, Math.ceil((asDate - Date.now()) / 1000));
  }
  return null;
}

export async function fetchValidatedJson<T>(
  url: string,
  schema: ZodType<T, ZodTypeDef, unknown>,
  options: FetchJsonOptions = {},
  rateLimiter?: RateLimiter
): Promise<{ data: T; headers: Headers; status: number }> {
  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = 25_000,
    maxRetries = 3,
    fetchImpl = fetch,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (rateLimiter) {
      await rateLimiter.wait();
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        method,
        headers: {
          "User-Agent": DEFAULT_USER_AGENT,
          Accept: "application/json",
          ...headers,
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.status === 429 || response.status >= 500) {
        const retryAfterSec = parseRetryAfter(response.headers.get("retry-after"));
        const err = new ProviderHttpError(
          `HTTP ${response.status} from ${url}`,
          url,
          response.status,
          retryAfterSec
        );
        if (attempt < maxRetries) {
          const backoffMs =
            retryAfterSec !== null
              ? Math.min(retryAfterSec * 1000, 30_000)
              : Math.min(1000 * 2 ** attempt, 10_000);
          await sleep(backoffMs);
          lastError = err;
          continue;
        }
        throw err;
      }

      if (!response.ok) {
        throw new ProviderHttpError(
          `HTTP ${response.status} from ${url}`,
          url,
          response.status
        );
      }

      const rawJson: unknown = await response.json();
      const parsed = schema.safeParse(rawJson);
      if (!parsed.success) {
        throw new Error(
          `Schema validation failed for ${url}: ${parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`
        );
      }

      return { data: parsed.data, headers: response.headers, status: response.status };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;

      const isAbortOrNetwork =
        error instanceof Error &&
        !(error instanceof ProviderHttpError) &&
        !error.message.startsWith("Schema validation failed");

      if (isAbortOrNetwork && attempt < maxRetries) {
        await sleep(Math.min(1000 * 2 ** attempt, 8_000));
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
}
