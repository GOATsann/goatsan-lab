import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Same-origin everything. Paper thumbnails come from Hugging Face and arXiv; KaTeX fonts are bundled.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://cdn-thumbnails.huggingface.co https://huggingface.co",
  "font-src 'self' data:",
  // The sign-in warm-up wakes www's server before the redirect (src/lib/client/signIn.ts).
  `connect-src 'self'${process.env.NEXT_PUBLIC_AUTH_ORIGIN ? ` ${process.env.NEXT_PUBLIC_AUTH_ORIGIN}` : ""}${isDev ? " ws:" : ""}`,
  "media-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Dev only: let the owner's phone open the dev server over the private Tailscale network.
  ...(isDev ? { allowedDevOrigins: (process.env.DEV_ORIGINS ?? "").split(",").filter(Boolean) } : {}),
  images: { unoptimized: true },
  // Native and worker-heavy packages stay outside the server bundle.
  // The e2e suite runs its own dev server next to yours; it builds into its own folder.
  ...(process.env.PT_DIST_DIR ? { distDir: process.env.PT_DIST_DIR } : {}),
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist", "undici"],
  // Never ship local data or build leftovers in the server bundle: .data/ holds cached papers and private uploads
  // (the file store points there, so tracing would pick it up), and the Lambda gets the Linux canvas binary.
  outputFileTracingExcludes: {
    "*": [".data/**", ".next-e2e/**", "test-results/**", "e2e/**", "tests/**", "node_modules/@napi-rs/canvas-darwin-*/**"],
  },
  // pdf.js loads its worker, fonts and image decoders by path at run time, so tracing can't see them.
  outputFileTracingIncludes: {
    "*": [
      "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "node_modules/pdfjs-dist/standard_fonts/**",
      "node_modules/pdfjs-dist/wasm/**",
    ],
  },
  // Uploads go through the proxy (sign-in); its default 10 MB body cap would cut off PDFs below our 40 MB limit.
  experimental: { proxyClientMaxBodySize: "41mb" },
  turbopack: { root: __dirname },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
