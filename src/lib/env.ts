export const env = {
  mode: (process.env.BLAAIZ_MODE === "live" ? "live" : "mock") as "mock" | "live",
  apiUrl: process.env.BLAAIZ_API_URL || "https://api-dev.blaaiz.com",
  clientId: process.env.BLAAIZ_CLIENT_ID || "",
  clientSecret: process.env.BLAAIZ_CLIENT_SECRET || "",
  oauthScope: process.env.BLAAIZ_OAUTH_SCOPE || "",
  webhookSecret: process.env.BLAAIZ_WEBHOOK_SECRET || "mock_signing_secret",
  customerId: process.env.BLAAIZ_CUSTOMER_ID || "mock_customer_kaduna",
  cycleCron: process.env.CYCLE_CRON || "0 * * * *",
};
