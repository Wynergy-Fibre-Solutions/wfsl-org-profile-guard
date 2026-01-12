import https from "node:https";
import crypto from "node:crypto";

export type TimeWitness = {
  url: string;
  ok: boolean;
  status?: number;
  date?: string;
  server?: string;
  via?: string;
  received_utc: string;
  note?: string;
};

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function head(url: string, timeoutMs: number): Promise<TimeWitness> {
  return new Promise((resolve) => {
    const received_utc = new Date().toISOString();

    const req = https.request(
      url,
      {
        method: "HEAD",
        timeout: timeoutMs,
        headers: {
          "user-agent": "wfsl-org-profile-guard/0.3.x (time-witness)"
        }
      },
      (res) => {
        const date = Array.isArray(res.headers["date"]) ? res.headers["date"][0] : res.headers["date"];
        const server = Array.isArray(res.headers["server"]) ? res.headers["server"][0] : res.headers["server"];
        const via = Array.isArray(res.headers["via"]) ? res.headers["via"][0] : res.headers["via"];

        resolve({
          url,
          ok: true,
          status: res.statusCode,
          date: typeof date === "string" ? date : undefined,
          server: typeof server === "string" ? server : undefined,
          via: typeof via === "string" ? via : undefined,
          received_utc
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });

    req.on("error", (err) => {
      resolve({
        url,
        ok: false,
        received_utc,
        note: String(err?.message ?? err)
      });
    });

    req.end();
  });
}

export async function collectTimeWitnesses(opts?: {
  timeoutMs?: number;
  urls?: string[];
}): Promise<{
  ok: boolean;
  witnesses: TimeWitness[];
  witness_bundle_hash: string;
}> {
  const timeoutMs = opts?.timeoutMs ?? 8000;

  const urls =
    opts?.urls ??
    [
      "https://timestamp.digicert.com",
      "https://timestamp.sectigo.com",
      "https://www.cloudflare.com",
      "https://www.google.com"
    ];

  const witnesses = [];
  for (const url of urls) {
    // sequential to keep behaviour stable
    // eslint-disable-next-line no-await-in-loop
    witnesses.push(await head(url, timeoutMs));
  }

  const stableBundle = JSON.stringify(
    witnesses.map((w) => ({
      url: w.url,
      ok: w.ok,
      status: w.status ?? null,
      date: w.date ?? null,
      server: w.server ?? null,
      via: w.via ?? null,
      received_utc: w.received_utc,
      note: w.note ?? null
    }))
  );

  return {
    ok: witnesses.some((w) => w.ok),
    witnesses,
    witness_bundle_hash: sha256Hex(stableBundle)
  };
}
