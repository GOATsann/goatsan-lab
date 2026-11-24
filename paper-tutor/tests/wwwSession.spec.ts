import { expect, test } from "@playwright/test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { lookupWwwUser } from "../src/lib/server/wwwSession";

// Login option "www": asking the main site who is signed in. A local server stands in for
// https://www.theonlygoatsan.com/api/me and answers as each case needs.

type Mode = "user" | "null" | "slow" | "500" | "refresh" | "junk";
let mode: Mode = "user";
let lastCookie = "";
let server: http.Server;
let url = "";

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    lastCookie = req.headers.cookie ?? "";
    const json = (status: number, body: unknown, extra: Record<string, string | string[]> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...extra });
      res.end(JSON.stringify(body));
    };
    if (mode === "user") return json(200, { user: { id: "user_1", email: "a@b.com", name: "Ike" }, auth: true });
    if (mode === "null") return json(200, { user: null, auth: true });
    if (mode === "500") return json(500, { error: "boom" });
    if (mode === "junk") return json(200, { user: { id: 5 } });
    if (mode === "refresh")
      return json(200, { user: { id: "user_1", email: "a@b.com", name: null } }, { "set-cookie": ["wos-session=NEW; Domain=theonlygoatsan.com; Path=/; HttpOnly; Secure"] });
    setTimeout(() => json(200, { user: { id: "late", email: "x@y.z" } }), 3000); // slow
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/me`;
});

test.afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const COOKIE = "theme=dark; wos-session=SEALED";

test("W01 signed in: the user, with the cookies forwarded", async () => {
  mode = "user";
  const r = await lookupWwwUser(COOKIE, { url });
  expect(r.user).toEqual({ id: "user_1", email: "a@b.com", name: "Ike" });
  expect(lastCookie).toBe(COOKIE);
});

test("W02 signed out: www says null", async () => {
  mode = "null";
  expect((await lookupWwwUser(COOKIE, { url })).user).toBeNull();
});

test("W03 www is slow: no user after the timeout, quickly", async () => {
  mode = "slow";
  const t = Date.now();
  const r = await lookupWwwUser(COOKIE, { url, timeoutMs: 1500 });
  expect(r.user).toBeNull();
  expect(r.ok).toBe(false);
  expect(Date.now() - t).toBeLessThan(2500);
});

test("W04 www fails (500): no user", async () => {
  mode = "500";
  const r = await lookupWwwUser(COOKIE, { url });
  expect(r.user).toBeNull();
  expect(r.ok).toBe(false);
});

test("W05 a refreshed session cookie comes back to pass on to the browser", async () => {
  mode = "refresh";
  const r = await lookupWwwUser(COOKIE, { url });
  expect(r.user?.id).toBe("user_1");
  expect(r.setCookies).toEqual(["wos-session=NEW; Domain=theonlygoatsan.com; Path=/; HttpOnly; Secure"]);
});

test("W06 no session cookie: nobody, without calling www", async () => {
  mode = "user";
  lastCookie = "untouched";
  expect((await lookupWwwUser("theme=dark", { url })).user).toBeNull();
  expect((await lookupWwwUser(null, { url })).user).toBeNull();
  expect(lastCookie).toBe("untouched");
});

test("W07 a malformed answer is nobody", async () => {
  mode = "junk";
  expect((await lookupWwwUser(COOKIE, { url })).user).toBeNull();
});
