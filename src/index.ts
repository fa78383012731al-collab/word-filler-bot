import "dotenv/config";
import app from "./app";
import { logger } from "./lib/logger";
import { createBot } from "./bot/index";
import https from "https";
import http from "http";

const rawPort = process.env.PORT || "8080";
const port = Number(rawPort);

const DOMAIN = process.env.RENDER_EXTERNAL_URL ||
  (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}` : null);
const WEBHOOK_PATH = "/api/bot/webhook";
const WEBHOOK_URL = DOMAIN ? `${DOMAIN}${WEBHOOK_PATH}` : null;

function startSelfPing() {
  if (!DOMAIN) return;
  const pingUrl = `${DOMAIN}/api/healthz`;
  setInterval(() => {
    const mod = pingUrl.startsWith("https") ? https : http;
    const req = mod.get(pingUrl, () => {});
    req.on("error", () => {});
    req.end();
  }, 4 * 60 * 1000);
  logger.info({ pingUrl }, "Self-ping started");
}

app.listen(port, async () => {
  logger.info({ port }, "Server listening");
  startSelfPing();

  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    logger.warn("Bot credentials missing — bot not started");
    return;
  }

  try {
    const bot = createBot();

    if (WEBHOOK_URL) {
      app.post(WEBHOOK_PATH, bot.webhookCallback(WEBHOOK_PATH));
      const info = await bot.telegram.getWebhookInfo();
      if (info.url !== WEBHOOK_URL) {
        await bot.telegram.setWebhook(WEBHOOK_URL, { drop_pending_updates: true });
        logger.info({ WEBHOOK_URL }, "Webhook registered");
      }
      logger.info("Bot started with webhook");
    } else {
      await bot.launch({ dropPendingUpdates: true });
      logger.info("Bot started with polling");
    }

    process.once("SIGINT", () => bot.stop("SIGINT"));
    process.once("SIGTERM", () => bot.stop("SIGTERM"));
  } catch (err) {
    logger.error({ err }, "Failed to start bot");
  }
});
