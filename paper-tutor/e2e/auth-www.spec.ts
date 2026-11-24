import { expect, request as pw, test } from "@playwright/test";

// Login option "www" (AUTH_MODE=www) through the real proxy: an app server on :3220 asks the mock www on :3299
// who is signed in. The cookie's value picks the mock's answer (e2e/mock/www-me.mjs).
const APP = "http://localhost:3220";

async function me(cookie?: string, extra: Record<string, string> = {}) {
  const ctx = await pw.newContext({ baseURL: APP });
  const res = await ctx.get("/api/me", { headers: { ...(cookie ? { cookie } : {}), ...extra } });
  const body = (await res.json()) as { user: { id: string } | null; auth: boolean };
  const setCookie = res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value);
  await ctx.dispose();
  return { status: res.status(), body, setCookie };
}

test.describe("@desktop-only A04 login through www", () => {
  test("signed in on www: the user, and the refreshed session cookie goes back to the browser", async () => {
    const r = await me("wos-session=GOOD");
    expect(r.status).toBe(200);
    expect(r.body.auth).toBe(true);
    expect(r.body.user?.id).toBe("user_www");
    expect(r.setCookie.some((c) => c.startsWith("wos-session=GOOD"))).toBe(true);
  });

  test("signed out on www: nobody", async () => {
    expect((await me("wos-session=NULL")).body.user).toBeNull();
    expect((await me()).body.user).toBeNull();
  });

  test("www fails or is slow: nobody, within the timeout", async () => {
    expect((await me("wos-session=FAIL")).body.user).toBeNull();
    const t = Date.now();
    expect((await me("wos-session=SLOW")).body.user).toBeNull();
    expect(Date.now() - t).toBeLessThan(2900);
  });

  test("a browser can't claim to be someone by sending the proxy's headers", async () => {
    const fake = encodeURIComponent(JSON.stringify({ id: "user_evil", email: "e@x.y", name: null }));
    const r = await me("wos-session=NULL", { "x-pt-user": fake, "x-pt-proxy": "guess" });
    expect(r.body.user).toBeNull();
    const r2 = await me(undefined, { "x-pt-user": fake });
    expect(r2.body.user).toBeNull();
  });

  test("actions that need sign-in are refused for nobody", async () => {
    const ctx = await pw.newContext({ baseURL: APP });
    const res = await ctx.post("/api/link", { data: { url: "https://example.com/a.pdf" }, headers: { cookie: "wos-session=NULL" } });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });
});
