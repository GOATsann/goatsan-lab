import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { safeKey, type CountResult, type Store } from "./store-key";

// The store on AWS: one DynamoDB table (pk = the store key) for JSON records, counters, locks and rate slots, and
// one private S3 bucket for blobs (PDFs, figure crops, extracted text, voice files, icons). JSON over DynamoDB's
// item limit goes to S3 with a pointer row. Every read-modify-write is a conditional write, so it is correct with
// any number of server instances.

const BIG = 350_000; // DynamoDB items max out at 400 KB
const nowSec = () => Math.floor(Date.now() / 1000);
const isConditionFail = (e: unknown) => (e as { name?: string })?.name === "ConditionalCheckFailedException";

// Blobs, behind a small interface so tests can swap S3 out.
export interface Blobs {
  get(key: string): Promise<Buffer | null>;
  put(key: string, data: Buffer | Uint8Array, contentType?: string): Promise<void>;
  delete(key: string): Promise<void>;
}

class S3Blobs implements Blobs {
  private s3 = new S3Client({});
  constructor(private bucket: string) {}
  async get(key: string) {
    try {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    } catch (e) {
      if (e instanceof NoSuchKey || (e as { name?: string }).name === "NoSuchKey") return null;
      throw e;
    }
  }
  async put(key: string, data: Buffer | Uint8Array, contentType?: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }));
  }
  async delete(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

const TYPES: Record<string, string> = { png: "image/png", mp3: "audio/mpeg", pdf: "application/pdf", txt: "text/plain; charset=utf-8", svg: "image/svg+xml", json: "application/json" };
const typeOf = (key: string) => TYPES[key.split(".").pop() ?? ""];

type Item = { pk: string; json?: string; s3?: boolean; n?: number; ids?: Set<string>; total?: number; next?: number; expireAt?: number };

export class AwsStore implements Store {
  private db: DynamoDBDocumentClient;
  private table: string;
  private blobs: Blobs;

  constructor(o: { table: string; bucket?: string; dynamo?: DynamoDBClient; blobs?: Blobs }) {
    this.table = o.table;
    this.db = DynamoDBDocumentClient.from(o.dynamo ?? new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
    this.blobs = o.blobs ?? new S3Blobs(o.bucket!);
  }

  private async item(key: string, raw = false): Promise<Item | null> {
    const r = await this.db.send(new GetCommand({ TableName: this.table, Key: { pk: safeKey(key) }, ConsistentRead: true }));
    const it = (r.Item as Item | undefined) ?? null;
    if (!raw && it?.expireAt && it.expireAt < nowSec()) return null; // TTL deletes lazily
    return it;
  }

  async getJSON<T>(key: string): Promise<T | null> {
    const it = await this.item(key);
    if (!it) return null;
    if (it.s3) {
      const b = await this.blobs.get(`json/${key}`);
      return b ? (JSON.parse(b.toString("utf8")) as T) : null;
    }
    if (typeof it.json === "string") return JSON.parse(it.json) as T;
    // Counters and slots: their fields.
    const { pk: _pk, ids, ...rest } = it;
    return { ...rest, ...(ids ? { ids: [...ids] } : {}) } as T;
  }

  async putJSON(key: string, value: unknown, opts?: { ttlSec?: number }) {
    const json = JSON.stringify(value);
    const expireAt = opts?.ttlSec ? nowSec() + opts.ttlSec : undefined;
    if (json.length > BIG) {
      await this.blobs.put(`json/${safeKey(key)}`, Buffer.from(json, "utf8"), "application/json");
      await this.db.send(new PutCommand({ TableName: this.table, Item: { pk: key, s3: true, expireAt } }));
    } else {
      await this.db.send(new PutCommand({ TableName: this.table, Item: { pk: safeKey(key), json, expireAt } }));
    }
  }

  getBlob(key: string) {
    return this.blobs.get(safeKey(key));
  }

  putBlob(key: string, data: Buffer | Uint8Array) {
    return this.blobs.put(safeKey(key), data, typeOf(key));
  }

  async delete(key: string) {
    const it = await this.item(key);
    if (it?.s3) await this.blobs.delete(`json/${safeKey(key)}`);
    await this.db.send(new DeleteCommand({ TableName: this.table, Key: { pk: safeKey(key) } }));
  }

  async createJSON(key: string, value: unknown, opts: { ttlSec: number }) {
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.table,
          Item: { pk: safeKey(key), json: JSON.stringify(value), expireAt: nowSec() + opts.ttlSec },
          ConditionExpression: "attribute_not_exists(pk) OR expireAt < :now",
          ExpressionAttributeValues: { ":now": nowSec() },
        }),
      );
      return true;
    } catch (e) {
      if (isConditionFail(e)) return false;
      throw e;
    }
  }

  async count(key: string, opts: { max: number; member?: string; ttlSec: number }): Promise<CountResult> {
    const values: Record<string, unknown> = { ":zero": 0, ":one": 1, ":max": opts.max, ":exp": nowSec() + opts.ttlSec };
    let update = "SET n = if_not_exists(n, :zero) + :one, expireAt = :exp";
    let cond = "(attribute_not_exists(n) OR n < :max)";
    if (opts.member) {
      values[":idset"] = new Set([opts.member]);
      values[":id"] = opts.member;
      update += " ADD ids :idset";
      cond += " AND (attribute_not_exists(ids) OR NOT contains(ids, :id))";
    }
    try {
      await this.db.send(
        new UpdateCommand({ TableName: this.table, Key: { pk: safeKey(key) }, UpdateExpression: update, ConditionExpression: cond, ExpressionAttributeValues: values }),
      );
      return "counted";
    } catch (e) {
      if (!isConditionFail(e)) throw e;
      const it = await this.item(key);
      if (opts.member && it?.ids?.has(opts.member)) return "already";
      return "full";
    }
  }

  async add(key: string, amount: number, opts: { ttlSec: number }) {
    const r = await this.db.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { pk: safeKey(key) },
        UpdateExpression: "SET #total = if_not_exists(#total, :zero) + :amt, expireAt = :exp",
        ExpressionAttributeNames: { "#total": "total" }, // a reserved word in DynamoDB
        ExpressionAttributeValues: { ":zero": 0, ":amt": amount, ":exp": nowSec() + opts.ttlSec },
        ReturnValues: "UPDATED_NEW",
      }),
    );
    return Number(r.Attributes?.total ?? amount);
  }

  async reserveSlot(key: string, gapMs: number) {
    for (let tries = 0; tries < 30; tries++) {
      const now = Date.now();
      const it = await this.item(key, true);
      const prev = it?.next;
      const at = Math.max(now, prev ?? 0);
      try {
        await this.db.send(
          new UpdateCommand({
            TableName: this.table,
            Key: { pk: safeKey(key) },
            UpdateExpression: "SET #next = :next, expireAt = :exp",
            ConditionExpression: prev === undefined ? "attribute_not_exists(#next)" : "#next = :prev",
            ExpressionAttributeNames: { "#next": "next" },
            ExpressionAttributeValues: { ":next": at + gapMs, ":exp": nowSec() + 3600, ...(prev === undefined ? {} : { ":prev": prev }) },
          }),
        );
        return at - now;
      } catch (e) {
        if (!isConditionFail(e)) throw e;
        // Another instance took that slot: read again and take the next one.
      }
    }
    throw new Error("Too many requests at once; try again.");
  }
}
