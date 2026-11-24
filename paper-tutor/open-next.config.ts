// OpenNext settings for the AWS build (SST runs `open-next build`, which reads this file).
// - Streaming: the overview and chat send scenes as they are written (NDJSON); the default wrapper would buffer
//   the whole answer.
// - @napi-rs/canvas renders PDF pages and crops figures. Its native binary must be the Linux arm64 build (the Lambda runs on arm64),
//   not the one on the build machine.
const config = {
  default: {
    override: { wrapper: "aws-lambda-streaming" },
    install: { packages: ["@napi-rs/canvas@1.2.0"], arch: "arm64", libc: "glibc", nodeVersion: "24" },
  },
};
export default config;
