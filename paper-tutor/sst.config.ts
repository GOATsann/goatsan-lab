/// <reference path="./.sst/platform/config.d.ts" />

// Paper Tutor on AWS (profile panda-dev, us-east-1), at papers.theonlygoatsan.com. Deploys need the owner's OK.
//   npx sst secret set AnthropicApiKey --stage prod      (and OpenaiApiKey; the 3 Workos* secrets only for "workos")
//   npx sst deploy --stage prod
// Login is shared with www.theonlygoatsan.com; sign-in starts and ends on www (this app never handles the callback).
// PAPERS_LOGIN picks how this app learns who is signed in:
//   "www" (default): it asks www's /api/me with the browser's cookies; no WorkOS secrets here.
//   "workos": WorkOS AuthKit runs here too, with the 3 Workos* secrets (same values as www).
// DNS stays at GoDaddy: papers is a CNAME to the CloudFront URL this prints, with the ACM certificate in
// PAPERS_CERT_ARN (gitignored .env).
export default $config({
  app(input) {
    return {
      name: "paper-tutor",
      removal: input?.stage === "prod" ? "retain" : "remove",
      home: "aws",
      providers: { aws: { region: "us-east-1", profile: process.env.AWS_PROFILE ?? "panda-dev" } },
    };
  },
  async run() {
    const anthropicKey = new sst.Secret("AnthropicApiKey");
    const openaiKey = new sst.Secret("OpenaiApiKey");
    const loginViaWww = (process.env.PAPERS_LOGIN ?? "www") !== "workos";
    const workos = loginViaWww
      ? null
      : {
          WORKOS_API_KEY: new sst.Secret("WorkosApiKey").value,
          WORKOS_CLIENT_ID: new sst.Secret("WorkosClientId").value,
          WORKOS_COOKIE_PASSWORD: new sst.Secret("WorkosCookiePassword").value,
          WORKOS_COOKIE_DOMAIN: "theonlygoatsan.com",
          NEXT_PUBLIC_WORKOS_REDIRECT_URI: "https://www.theonlygoatsan.com/callback",
        };

    // The store (src/lib/server/store-aws.ts): one table for JSON records, counters, locks and rate slots
    // (pk = the store key; rows with expireAt expire on their own), and one private bucket for blobs.
    const table = new sst.aws.Dynamo("Store", {
      fields: { pk: "string" },
      primaryIndex: { hashKey: "pk" },
      ttl: "expireAt",
    });
    const files = new sst.aws.Bucket("Files");

    // An alarm on the whole AWS account's monthly bill (AI spend has its own cap in the app: SPEND_CAP_USD).
    // The address comes from BUDGET_EMAIL in the gitignored .env; no address, no alarm.
    if ($app.stage === "prod" && process.env.BUDGET_EMAIL) {
      new aws.budgets.Budget("MonthlyBudget", {
        budgetType: "COST",
        limitAmount: "50",
        limitUnit: "USD",
        timeUnit: "MONTHLY",
        notifications: [
          { comparisonOperator: "GREATER_THAN", threshold: 80, thresholdType: "PERCENTAGE", notificationType: "ACTUAL", subscriberEmailAddresses: (process.env.BUDGET_EMAIL ?? "").split(",").filter(Boolean) },
          { comparisonOperator: "GREATER_THAN", threshold: 100, thresholdType: "PERCENTAGE", notificationType: "FORECASTED", subscriberEmailAddresses: (process.env.BUDGET_EMAIL ?? "").split(",").filter(Boolean) },
        ],
      });
    }

    const cert = process.env.PAPERS_CERT_ARN;
    const withDomain = $app.stage === "prod" && Boolean(cert);
    const site = new sst.aws.Nextjs("Site", {
      link: [table, files],
      environment: {
        ANTHROPIC_API_KEY: anthropicKey.value,
        OPENAI_API_KEY: openaiKey.value,
        PAPERS_TABLE: table.name,
        FILES_BUCKET: files.name,
        SPEND_CAP_USD: "50",
        ...(workos ?? { AUTH_MODE: "www" }),
        NEXT_PUBLIC_AUTH_ORIGIN: "https://www.theonlygoatsan.com",
        // The hosted sign-in page (WorkOS AuthKit); the browser connects to it early when someone heads to sign in.
        NEXT_PUBLIC_AUTHKIT_ORIGIN: "https://glorious-peacock-56.authkit.app",
      },
      // 60 s is CloudFront's longest wait between bytes (the overview streams, so it never waits that long).
      server: { timeout: "60 seconds", memory: "2048 MB", architecture: "arm64" }, // arm64 matches the canvas binary in open-next.config.ts
      transform: {
        server: (args) => {
          // The function itself may run longer than a response: downloads, figure crops and the full map finish
          // in the background after the page has its answer (next/server after()).
          args.timeout = "240 seconds";
        },
      },
      // The real client IP, set at the edge so a visitor can't fake it (rate limits use it).
      edge: {
        viewerRequest: {
          injection: `event.request.headers["x-client-ip"] = { value: event.viewer.ip };`,
        },
      },
      ...(withDomain ? { domain: { name: "papers.theonlygoatsan.com", dns: false, cert: cert! } } : {}),
    });
    return { url: site.url };
  },
});
