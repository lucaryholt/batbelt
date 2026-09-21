import { spawn } from "node:child_process";

export async function openInCode(filePath: string): Promise<{ path: string }> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("code", [filePath], { stdio: "ignore", detached: true });
    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("`code` was not found on PATH. Install the Cursor/VS Code shell command."));
        return;
      }
      reject(err);
    });
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
  return { path: filePath };
}
