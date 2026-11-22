/// <reference path="./.sst/platform/config.d.ts" />

// Paper Tutor on AWS (profile panda-dev, us-east-1). NOT DEPLOYED YET: the owner OKs every deploy.
//   npx sst secret set AnthropicApiKey --stage prod      (and OpenaiApiKey, plus the 3 Workos* secrets)
//   npx sst deploy --stage prod
// Login is the personal site's WorkOS AuthKit: same 3 secrets, cookie scoped to theonlygoatsan.com, and sign-in
// starts and ends on www (this app never handles the callback). DNS stays at GoDaddy: the papers subdomain is a
// CNAME to the CloudFront URL this prints, once a certificate exists (PAPERS_CERT_ARN in a gitignored .env).
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
    const workosApiKey = new sst.Secret("WorkosApiKey");
    const workosClientId = new sst.Secret("WorkosClientId");
    const workosCookiePassword = new sst.Secret("WorkosCookiePassword");

    // The paper index and its read results (structure JSON), plus cached scenes. pk = "paper#<id>", sk = kind.
    const papers = new sst.aws.Dynamo("Papers", {
      fields: { pk: "string", sk: "string" },
      primaryIndex: { hashKey: "pk", rangeKey: "sk" },
    });
    // Per-user daily limits: pk = "<userId>#<YYYY-MM-DD>#<kind>", conditional increment; rows expire.
    const limits = new sst.aws.Dynamo("Limits", {
      fields: { pk: "string" },
      primaryIndex: { hashKey: "pk" },
      ttl: "expireAt",
    });
    // PDFs, figure crops and voice files. Private: the app serves them after its own access checks.
    const files = new sst.aws.Bucket("Files");

    const withDomain = $app.stage === "prod" && Boolean(process.env.PAPERS_CERT_ARN);
    const site = new sst.aws.Nextjs("Site", {
      link: [papers, limits, files],
      environment: {
        ANTHROPIC_API_KEY: anthropicKey.value,
        OPENAI_API_KEY: openaiKey.value,
        PAPERS_TABLE: papers.name,
        LIMITS_TABLE: limits.name,
        FILES_BUCKET: files.name,
        WORKOS_API_KEY: workosApiKey.value,
        WORKOS_CLIENT_ID: workosClientId.value,
        WORKOS_COOKIE_PASSWORD: workosCookiePassword.value,
        WORKOS_COOKIE_DOMAIN: "theonlygoatsan.com",
        NEXT_PUBLIC_WORKOS_REDIRECT_URI: "https://www.theonlygoatsan.com/callback",
        NEXT_PUBLIC_AUTH_ORIGIN: "https://www.theonlygoatsan.com",
      },
      server: { timeout: "120 seconds", memory: "2048 MB" },
      ...(withDomain
        ? { domain: { name: "papers.theonlygoatsan.com", dns: false, cert: process.env.PAPERS_CERT_ARN! } }
        : {}),
    });
    return { url: site.url };
  },
});
