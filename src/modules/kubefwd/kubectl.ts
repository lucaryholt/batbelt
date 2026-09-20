import { runCommand, runCommandOk } from "./debug.js";

const EXPLORER_TIMEOUT_MS = 10_000;

export async function checkKubectlAvailable(): Promise<void> {
  try {
    await runCommandOk("kubectl", ["version", "--client"], { timeoutMs: 15_000 });
  } catch (err) {
    throw new Error(
      `kubectl not available: ${err instanceof Error ? err.message : String(err)}\nPlease ensure kubectl is installed and available in your PATH`,
    );
  }
}

export async function validateContext(context: string): Promise<void> {
  const result = await runCommand("kubectl", ["config", "get-contexts", context, "--no-headers"], {
    timeoutMs: 10_000,
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`context '${context}' not found`);
  }
}

export { EXPLORER_TIMEOUT_MS };
