import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Readable } from "node:stream";
import { AwsClient, AwsV4Signer } from "aws4fetch";
import { assertKey, type StorageDriver } from "./driver";

export type S3Config = {
  bucket: string;
  /** e.g. https://<account>.r2.cloudflarestorage.com or http://minio:9000; AWS when missing. */
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** `<endpoint>/<bucket>/<key>` instead of `<bucket>.<endpoint>/<key>`; MinIO needs it. */
  forcePathStyle: boolean;
  /** Put keys under this folder of the bucket (no slashes at either end). */
  prefix?: string;
};

/**
 * S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, …), signed with AWS Signature V4 by
 * aws4fetch. Uploads stream with a known length and an unsigned payload hash, so large files are
 * never held in memory.
 */
export function s3Driver(config: S3Config): StorageDriver {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: config.region,
    retries: 2,
  });
  const prefix = config.prefix ? `${config.prefix.replace(/^\/+|\/+$/g, "")}/` : "";

  const urlOf = (key: string) => {
    assertKey(key);
    const objectKey = prefix + key;
    if (!config.endpoint) {
      return config.forcePathStyle
        ? `https://s3.${config.region}.amazonaws.com/${config.bucket}/${objectKey}`
        : `https://${config.bucket}.s3.${config.region}.amazonaws.com/${objectKey}`;
    }
    const endpoint = new URL(config.endpoint);
    const base = endpoint.origin + endpoint.pathname.replace(/\/+$/, "");
    return config.forcePathStyle
      ? `${base}/${config.bucket}/${objectKey}`
      : `${endpoint.protocol}//${config.bucket}.${endpoint.host}${endpoint.pathname.replace(/\/+$/, "")}/${objectKey}`;
  };

  const failure = async (what: string, res: Response) => {
    const body = await res.text().catch(() => "");
    return new Error(`S3 ${what} failed: ${res.status} ${body.slice(0, 300)}`);
  };

  return {
    kind: "s3",

    async put(key, body, { size, contentType }) {
      const signer = new AwsV4Signer({
        url: urlOf(key),
        method: "PUT",
        headers: {
          "content-type": contentType,
          "content-length": String(size),
          "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
        },
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        service: "s3",
        region: config.region,
      });
      const signed = await signer.sign();
      await sendStream(signed.url, signed.headers, body);
    },

    async get(key, range) {
      const res = await client.fetch(urlOf(key), {
        method: "GET",
        headers: range ? { range: `bytes=${range.start}-${range.end}` } : {},
      });
      if (res.status === 404) {
        await res.body?.cancel();
        return null;
      }
      if (!res.ok) throw await failure("GET", res);
      return res.body;
    },

    async delete(key) {
      const res = await client.fetch(urlOf(key), { method: "DELETE" });
      await res.body?.cancel();
      if (!res.ok && res.status !== 404) throw await failure("DELETE", res);
    },
  };
}

/**
 * PUTs a stream with the signed headers. Node's http client, not fetch: S3 wants a Content-Length
 * on uploads (it refuses chunked bodies), which fetch won't set for a stream.
 */
function sendStream(url: URL, headers: Headers, body: Readable): Promise<void> {
  return new Promise((resolvePut, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(url, { method: "PUT", headers: Object.fromEntries(headers.entries()) }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        if (chunks.length < 16) chunks.push(chunk);
      });
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolvePut();
        else reject(new Error(`S3 PUT failed: ${res.statusCode} ${Buffer.concat(chunks).toString("utf8").slice(0, 300)}`));
      });
      res.on("error", reject);
    });
    req.setTimeout(5 * 60 * 1000, () => req.destroy(new Error("S3 PUT timed out")));
    req.on("error", reject);
    body.on("error", (error) => req.destroy(error));
    body.pipe(req);
  });
}
