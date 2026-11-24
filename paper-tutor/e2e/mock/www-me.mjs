// Stands in for https://www.theonlygoatsan.com/api/me in the e2e suite (login option "www").
// The session cookie's value picks the answer: GOOD (a user, plus a refreshed cookie), NULL, SLOW (3 s), FAIL (500).
import http from "node:http";

const port = Number(process.argv[2] || 3299);
http
  .createServer((req, res) => {
    const m = /wos-session=([A-Z]+)/.exec(req.headers.cookie ?? "");
    const v = m?.[1];
    const send = (status, body, extra = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...extra });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/health") return send(200, { ok: true });
    if (v === "GOOD") return send(200, { user: { id: "user_www", email: "www@example.com", name: "Www" }, auth: true }, { "set-cookie": "wos-session=GOOD; Domain=localhost; Path=/; HttpOnly" });
    if (v === "FAIL") return send(500, { error: "boom" });
    if (v === "SLOW") return setTimeout(() => send(200, { user: { id: "late", email: "l@x.y" } }), 3000);
    send(200, { user: null, auth: true });
  })
  .listen(port, "127.0.0.1");
