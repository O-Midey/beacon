import { spawn } from "node:child_process";

/**
 * Open a URL in the user's default browser, best-effort. Failure is never
 * fatal — callers always print the URL too, so the user can click it.
 */
export function openBrowser(url: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // The printed URL is the fallback.
  }
}
