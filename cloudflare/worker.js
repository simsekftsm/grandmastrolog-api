import { env } from "cloudflare:workers";
import { Container, getContainer } from "@cloudflare/containers";

export class GrandMastrologContainer extends Container {
  defaultPort = 3000;
  sleepAfter = "10m";
  enableInternet = true;

  envVars = {
    PORT: "3000",
    NODE_ENV: "production",
    PYTHON_BIN: "python3",
    GM_API_SECRET: env.GM_API_SECRET,
    GROQ_API_KEY: env.GROQ_API_KEY,
    DATABASE_URL: env.DATABASE_URL,
    GROQ_MODEL: env.GROQ_MODEL,
    GM_DELIVERY_RUNTIME_URL: env.GM_DELIVERY_RUNTIME_URL,
    GM_LEGACY_INTERNAL_PORT: env.GM_LEGACY_INTERNAL_PORT,
    GM_DELIVERY_TIMEOUT_MS: env.GM_DELIVERY_TIMEOUT_MS,
    REPORT_RENDER_TIMEOUT_MS: env.REPORT_RENDER_TIMEOUT_MS
  };
}

export default {
  async fetch(request) {
    const container = getContainer(env.GM_CONTAINER, "grandmastrolog-api-staging");
    return container.fetch(request);
  }
};
