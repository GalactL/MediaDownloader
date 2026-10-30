// Récupère le .xpi déjà signé par AMO (qui refuse de signer deux fois la même version).
// Usage : WEB_EXT_API_KEY=... WEB_EXT_API_SECRET=... node tools/fetch-signed-xpi.mjs <id> <version> <sortie>
// Codes de sortie : 0 = récupéré, 3 = version pas encore signée, 1 = erreur.
import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

export function buildJwt(issuer, secret, now, jti) {
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: issuer, jti, iat: now, exp: now + 60 })}`;
  return `${body}.${crypto.createHmac("sha256", secret).update(body).digest("base64url")}`;
}

async function main() {
  const [id, version, out] = process.argv.slice(2);
  const { WEB_EXT_API_KEY: key, WEB_EXT_API_SECRET: secret } = process.env;
  if (!key || !secret || !id || !version || !out) {
    throw new Error("Usage : WEB_EXT_API_KEY et WEB_EXT_API_SECRET dans l'environnement, puis <id> <version> <sortie>.");
  }
  const headers = () => ({
    Authorization: `JWT ${buildJwt(key, secret, Math.floor(Date.now() / 1000), crypto.randomUUID())}`,
  });
  const base = "https://addons.mozilla.org/api/v5/addons/addon";
  const res = await fetch(`${base}/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}/`, { headers: headers() });
  if (res.status === 404) {
    console.error(`Version ${version} pas encore signée sur AMO.`);
    process.exit(3);
  }
  if (!res.ok) throw new Error(`AMO a répondu HTTP ${res.status} pour la version ${version}.`);
  const url = (await res.json())?.file?.url;
  if (!url) throw new Error("Réponse AMO sans file.url (version signée mais fichier indisponible).");
  // Le fetch Node retire l'en-tête Authorization lors d'une redirection vers un autre hôte : normal pour le CDN.
  const file = await fetch(url, { headers: headers(), redirect: "follow" });
  if (!file.ok) throw new Error(`Téléchargement du .xpi : HTTP ${file.status}.`);
  const data = Buffer.from(await file.arrayBuffer());
  if (data.subarray(0, 2).toString("latin1") !== "PK") throw new Error("Le fichier téléchargé n'est pas une archive zip (PK absent).");
  fs.writeFileSync(out, data);
  console.error(`.xpi signé récupéré (${data.length} octets) : ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`Erreur : ${e.message}`);
    process.exit(1);
  });
}
