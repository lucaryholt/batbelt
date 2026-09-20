import { Hono } from "hono";
import type { BatbeltModule } from "../types.js";
import { writeSeedIfMissing } from "./config.js";
import { createRoutes } from "./routes.js";

class KickflipModule implements BatbeltModule {
  readonly id = "kickflip";
  readonly title = "Kickflip";
  readonly pages = [{ id: "services", label: "Services", path: "services" }];

  private readonly routes = new Hono();

  createRoutes(): Hono {
    return this.routes;
  }

  async start(): Promise<void> {
    await writeSeedIfMissing();
    this.routes.route("/", createRoutes());
  }
}

export const kickflipModule: BatbeltModule = new KickflipModule();
