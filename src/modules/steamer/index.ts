import { Hono } from "hono";
import type { BatbeltModule } from "../types.js";
import { createRoutes } from "./routes.js";

class SteamerModule implements BatbeltModule {
  readonly id = "steamer";
  readonly title = "Steamer";
  readonly pages = [
    { id: "secrets", label: "Secrets", path: "secrets" },
    { id: "settings", label: "Settings", path: "settings" },
  ];

  private readonly routes = new Hono();

  createRoutes(): Hono {
    return this.routes;
  }

  async start(): Promise<void> {
    this.routes.route("/", createRoutes());
  }
}

export const steamerModule: BatbeltModule = new SteamerModule();
