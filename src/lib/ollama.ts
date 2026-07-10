import { z } from "zod";

/**
 * Ollama discovery for `beacon init`. Ollama exposes its native API next to
 * the OpenAI-compatible `/v1` endpoint Beacon actually talks to; `/api/tags`
 * lists the locally pulled models, which lets init offer a picker instead of
 * asking the user to type a model name from memory.
 *
 * Best-effort by design: any failure (not running, timeout, unexpected shape)
 * returns null and init falls back to manual entry.
 */

const TagsResponseSchema = z.object({
  models: z.array(z.object({ name: z.string().min(1) })),
});

const DETECT_TIMEOUT_MS = 1500;

/** Strip a trailing `/v1` so an OpenAI-compat base URL yields the Ollama origin. */
export function ollamaOrigin(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, "");
}

/**
 * The models available on a running Ollama instance, or null when it is not
 * reachable at `baseUrl` (an OpenAI-compatible `…/v1` URL or a plain origin).
 */
export async function listOllamaModels(baseUrl: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${ollamaOrigin(baseUrl)}/api/tags`, {
      signal: AbortSignal.timeout(DETECT_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const parsed = TagsResponseSchema.safeParse(await res.json());
    if (!parsed.success) return null;
    return parsed.data.models.map((m) => m.name);
  } catch {
    return null;
  }
}
