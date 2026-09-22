import { Hono } from "hono";
import type { BatbeltModule } from "../types.js";
import { writeEmptyIfMissing } from "./config.js";
import { createRoutes } from "./routes.js";

class PrlookerModule implements BatbeltModule {
  readonly id = "prlooker";
  readonly title = "PR Looker";
  readonly pages = [{ id: "inbox", label: "Inbox", path: "inbox" }];

  private readonly routes = new Hono();

  createRoutes(): Hono {
    return this.routes;
  }

  async start(): Promise<void> {
    await writeEmptyIfMissing();
    this.routes.route("/", createRoutes());
  }
}

export const prlookerModule: BatbeltModule = new PrlookerModule();
