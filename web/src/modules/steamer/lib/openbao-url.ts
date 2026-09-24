export interface OpenBaoSecretLocation {
  addr: string;
  mount: string;
  path: string;
  namespace?: string;
}

function encodePath(value: string): string {
  return value
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

export function openBaoSecretUrl({
  addr,
  mount,
  path,
  namespace,
}: OpenBaoSecretLocation): string {
  const base = addr.trim().replace(/\/+$/, "");
  const encodedMount = encodePath(mount || "secret");
  const encodedPath = encodePath(path);
  const url = new URL(`${base}/ui/vault/secrets/${encodedMount}/show/${encodedPath}`);
  if (namespace?.trim()) url.searchParams.set("namespace", namespace.trim());
  return url.toString();
}
