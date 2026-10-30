import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { buildJwt } from "./fetch-signed-xpi.mjs";

test("buildJwt produit un JWT HS256 vérifiable", () => {
  const jwt = buildJwt("user:1", "secret", 1000, "abc");
  const parts = jwt.split(".");
  assert.equal(parts.length, 3);
  for (const p of parts) assert.match(p, /^[A-Za-z0-9_-]+$/);
  const [header, payload, sig] = parts.map((p, i) => (i < 2 ? JSON.parse(Buffer.from(p, "base64url")) : p));
  assert.deepEqual(header, { alg: "HS256", typ: "JWT" });
  assert.equal(payload.iss, "user:1");
  assert.equal(payload.jti, "abc");
  assert.equal(payload.iat, 1000);
  assert.equal(payload.exp, 1060);
  const expected = crypto.createHmac("sha256", "secret").update(parts.slice(0, 2).join(".")).digest("base64url");
  assert.equal(sig, expected);
});
