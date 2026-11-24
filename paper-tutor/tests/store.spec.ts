import { expect, test } from "@playwright/test";
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { AwsStore, type Blobs } from "../src/lib/server/store-aws";

// The AWS store against DynamoDB Local (free, no AWS account): JSON records, the big-record spill to S3, locks,
// daily limit counters under parallel load, spend totals and the shared rate slot.
// Start DynamoDB Local first (docker run -p 8000:8000 amazon/dynamodb-local, or the jar), then
// `npm run test:store`. DYNAMO_ENDPOINT overrides the address.

const endpoint = process.env.DYNAMO_ENDPOINT || "http://localhost:8000";
const dynamo = new DynamoDBClient({ endpoint, region: "us-east-1", credentials: { accessKeyId: "local", secretAccessKey: "local" } });
const TABLE = `pt-test-${Date.now()}`;

class MemBlobs implements Blobs {
  m = new Map<string, Buffer>();
  async get(k: string) {
    return this.m.get(k) ?? null;
  }
  async put(k: string, d: Buffer | Uint8Array) {
    this.m.set(k, Buffer.from(d));
  }
  async delete(k: string) {
    this.m.delete(k);
  }
}

let blobs: MemBlobs;
let store: AwsStore;

test.beforeAll(async () => {
  await dynamo.send(
    new CreateTableCommand({
      TableName: TABLE,
      AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  blobs = new MemBlobs();
  store = new AwsStore({ table: TABLE, dynamo, blobs });
});

test.afterAll(async () => {
  await dynamo.send(new DeleteTableCommand({ TableName: TABLE })).catch(() => undefined);
});

test("S01 JSON records round-trip; big ones spill to S3; delete removes both", async () => {
  await store.putJSON("papers/x/meta.json", { title: "A", n: 1 });
  expect(await store.getJSON("papers/x/meta.json")).toEqual({ title: "A", n: 1 });
  expect(await store.getJSON("papers/none.json")).toBeNull();

  const big = { text: "x".repeat(500_000) };
  await store.putJSON("papers/x/big.json", big);
  expect(blobs.m.has("json/papers/x/big.json")).toBe(true);
  expect(await store.getJSON("papers/x/big.json")).toEqual(big);
  await store.delete("papers/x/big.json");
  expect(await store.getJSON("papers/x/big.json")).toBeNull();
  expect(blobs.m.has("json/papers/x/big.json")).toBe(false);

  await store.putBlob("papers/x/paper.pdf", Buffer.from("%PDF-1"));
  expect((await store.getBlob("papers/x/paper.pdf"))?.toString()).toBe("%PDF-1");
  await expect(store.getJSON("../etc/passwd")).rejects.toThrow("bad store key");
});

test("S02 records with a time to live read as gone once expired", async () => {
  await store.putJSON("progress/old.json", { a: 1 }, { ttlSec: -10 });
  expect(await store.getJSON("progress/old.json")).toBeNull();
  await store.putJSON("progress/new.json", { a: 1 }, { ttlSec: 60 });
  expect(await store.getJSON<{ a: number }>("progress/new.json")).toMatchObject({ a: 1 });
});

test("S03 one writer: of 10 parallel lock attempts exactly one wins; an expired lock can be taken again", async () => {
  const wins = await Promise.all(Array.from({ length: 10 }, () => store.createJSON("papers/x/overview.lock.json", { at: 1 }, { ttlSec: 60 })));
  expect(wins.filter(Boolean)).toHaveLength(1);
  await store.delete("papers/x/overview.lock.json");
  expect(await store.createJSON("papers/x/overview.lock.json", { at: 2 }, { ttlSec: -5 })).toBe(true); // already expired
  expect(await store.createJSON("papers/x/overview.lock.json", { at: 3 }, { ttlSec: 60 })).toBe(true);
  expect(await store.createJSON("papers/x/overview.lock.json", { at: 4 }, { ttlSec: 60 })).toBe(false);
});

test("S04 daily limit: two parallel requests at the last slot, only one gets it", async () => {
  const key = "limits/2026-11-24/user_a_chat.json";
  for (let i = 0; i < 4; i++) expect(await store.count(key, { max: 5, ttlSec: 3600 })).toBe("counted");
  const [a, b] = await Promise.all([store.count(key, { max: 5, ttlSec: 3600 }), store.count(key, { max: 5, ttlSec: 3600 })]);
  expect([a, b].sort()).toEqual(["counted", "full"]);
  expect((await store.getJSON<{ n: number }>(key))?.n).toBe(5);
});

test("S05 daily limit under a burst: 20 parallel uses with a limit of 3 count exactly 3", async () => {
  const key = "limits/2026-11-24/user_b_deepdive.json";
  const r = await Promise.all(Array.from({ length: 20 }, () => store.count(key, { max: 3, ttlSec: 3600 })));
  expect(r.filter((x) => x === "counted")).toHaveLength(3);
  expect(r.filter((x) => x === "full")).toHaveLength(17);
});

test("S06 new papers: the same paper counts once, even in parallel; a 4th paper is refused", async () => {
  const key = "limits/2026-11-24/user_c_paper.json";
  const same = await Promise.all(Array.from({ length: 8 }, () => store.count(key, { max: 3, member: "2106.09685", ttlSec: 3600 })));
  expect(same.filter((x) => x === "counted")).toHaveLength(1);
  expect(same.filter((x) => x === "already")).toHaveLength(7);
  const others = await Promise.all(["a", "b", "c"].map((id) => store.count(key, { max: 3, member: id, ttlSec: 3600 })));
  expect(others.filter((x) => x === "counted")).toHaveLength(2);
  expect(others.filter((x) => x === "full")).toHaveLength(1);
  expect(await store.count(key, { max: 3, member: "2106.09685", ttlSec: 3600 })).toBe("already");
  const c = await store.getJSON<{ n: number; ids: string[] }>(key);
  expect(c?.n).toBe(3);
  expect(c?.ids).toHaveLength(3);
});

test("S07 spend: parallel adds all land", async () => {
  const key = "spend/2026-11.json";
  await Promise.all(Array.from({ length: 10 }, () => store.add(key, 0.25, { ttlSec: 3600 })));
  const total = (await store.getJSON<{ total: number }>(key))?.total ?? 0;
  expect(total).toBeCloseTo(2.5, 6);
});

test("S08 the shared rate slot spaces parallel callers by the gap", async () => {
  const waits = await Promise.all(Array.from({ length: 5 }, () => store.reserveSlot("rate/arxiv.json", 3000)));
  const sorted = [...waits].sort((a, b) => a - b);
  expect(sorted[0]).toBeLessThan(200);
  for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThan(2700);
});
