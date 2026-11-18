/// <reference path="./.sst/platform/config.d.ts" />

// Shooter Z as a static site (S3 + CloudFront). Nothing server-side: the AI runs in the browser.
//   npx sst deploy --stage prod
// Settings come from a gitignored .env next to this file (SST loads it): AWS_PROFILE, and SHOOTERZ_CERT_ARN
// once the ACM certificate for the domain is issued. DNS lives elsewhere (GoDaddy):
// shooterz.theonlygoatsan.com is a CNAME to the CloudFront URL printed here.
// The AI model, the character models and the Special Move sounds are not in git (ASSETS.md); they ship
// only if they are in public/ at build time.
export default $config({
  app(input) {
    return {
      name: "shooter-z",
      removal: input?.stage === "prod" ? "retain" : "remove",
      home: "aws",
      providers: { aws: { region: "us-east-1", ...(process.env.AWS_PROFILE ? { profile: process.env.AWS_PROFILE } : {}) } },
    };
  },
  async run() {
    const cert = process.env.SHOOTERZ_CERT_ARN;
    const site = new sst.aws.StaticSite("Game", {
      build: { command: "npm run build", output: "dist" },
      assets: {
        // Later entries win. Only Vite's hashed files (assets/: JS, CSS, the onnxruntime .wasm) may be
        // cached forever. Everything that keeps its name (the AI model, the characters, the sounds, the
        // pages) must revalidate, so a new model reaches players quickly (the runner once shipped a
        // 1-year immutable cache on unhashed files; never again).
        fileOptions: [
          { files: "**", cacheControl: "public,max-age=300,must-revalidate" },
          { files: "assets/**", cacheControl: "public,max-age=31536000,immutable" },
          { files: "assets/**/*.wasm", contentType: "application/wasm", cacheControl: "public,max-age=31536000,immutable" },
          { files: "**/*.html", cacheControl: "max-age=0,no-cache,no-store,must-revalidate" },
          { files: "models/**", cacheControl: "public,max-age=300,must-revalidate" },
          { files: "models/*.onnx", contentType: "application/octet-stream", cacheControl: "public,max-age=300,must-revalidate" },
          { files: "characters/*.glb", contentType: "model/gltf-binary", cacheControl: "public,max-age=300,must-revalidate" },
          { files: "sfx/*.mp3", contentType: "audio/mpeg", cacheControl: "public,max-age=3600,must-revalidate" },
        ],
      },
      ...(cert ? { domain: { name: "shooterz.theonlygoatsan.com", dns: false, cert } } : {}),
    });
    return { url: site.url };
  },
});
