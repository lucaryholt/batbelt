export type InboxReason = "review" | "team" | "assigned" | "authored" | "mentioned";

export interface PrlookerConfig {
  pollSeconds: number;
  teams: string[];
}

export interface InboxItem {
  number: number;
  title: string;
  url: string;
  repository: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  reviewDecision?: string;
  labels: string[];
  reasons: InboxReason[];
}

export interface HealthResponse {
  ghAvailable: boolean;
  loggedIn: boolean;
  login?: string;
}

export interface InboxResponse {
  viewer?: string;
  fetchedAt: string;
  items: InboxItem[];
}

export interface ConfigResponse {
  pollSeconds: number;
  teams: string[];
}

export interface GhResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}
