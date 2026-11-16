/// <reference path="./.sst/platform/config.d.ts" />

// Lights-Out Surfer as a static site (S3 + CloudFront). Nothing server-side.
//   SURFER_CERT_ARN=<acm arn> npx sst deploy --stage prod
// DNS lives elsewhere (GoDaddy): surfer.theonlygoatsan.com is a CNAME to the CloudFront URL printed here.
// The music file (public/audio/music.mp3) is not in git; it ships only if present at build time.
export default $config({
  app(input) {
    return {
      name: "lights-out-surfer",
      removal: input?.stage === "prod" ? "retain" : "remove",
      home: "aws",
      providers: { aws: { region: "us-east-1", ...(process.env.AWS_PROFILE ? { profile: process.env.AWS_PROFILE } : {}) } },
    };
  },
  async run() {
    const cert = process.env.SURFER_CERT_ARN;
    const site = new sst.aws.StaticSite("Game", {
      build: { command: "npm run build", output: "dist" },
      assets: {
        // Later entries win. Only Vite's hashed files (assets/) may be cached forever: the models,
        // characters and music keep their names, so a new AI model must reach players quickly.
        fileOptions: [
          { files: "**", cacheControl: "public,max-age=300,must-revalidate" },
          { files: "assets/**", cacheControl: "public,max-age=31536000,immutable" },
          { files: "**/*.html", cacheControl: "max-age=0,no-cache,no-store,must-revalidate" },
          { files: "**/*.mp3", contentType: "audio/mpeg", cacheControl: "public,max-age=86400" },
          { files: "**/*.glb", contentType: "model/gltf-binary", cacheControl: "public,max-age=3600" },
        ],
      },
      ...(cert ? { domain: { name: "surfer.theonlygoatsan.com", dns: false, cert } } : {}),
    });
    return { url: site.url };
  },
});
