const STORAGE_KEY = "batbelt.typeToSearch.seed";

let homepageFilterReady = false;

export function setHomepageFilterReady(ready: boolean): void {
  homepageFilterReady = ready;
}

export function isHomepageFilterReady(): boolean {
  return homepageFilterReady;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function appendTypeToSearchSeed(ch: string): string {
  const next = takeTypeToSearchSeed() + ch;
  try {
    sessionStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* private mode */
  }
  return next;
}

export function takeTypeToSearchSeed(): string {
  try {
    const value = sessionStorage.getItem(STORAGE_KEY) ?? "";
    sessionStorage.removeItem(STORAGE_KEY);
    return value;
  } catch {
    return "";
  }
}

export function peekTypeToSearchSeed(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}
