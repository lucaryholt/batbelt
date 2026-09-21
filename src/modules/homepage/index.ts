import { Hono } from "hono";
import type { BatbeltModule } from "../types.js";
import { createRoutes } from "./routes.js";

class HomepageModule implements BatbeltModule {
  readonly id = "homepage";
  readonly title = "Homepage";
  readonly pages = [{ id: "links", label: "Links", path: "links" }];

  private readonly routes = new Hono();

  createRoutes(): Hono {
    return this.routes;
  }

  async start(): Promise<void> {
    this.routes.route("/", createRoutes());
  }
}

export const homepageModule: BatbeltModule = new HomepageModule();
