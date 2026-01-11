import fs from "node:fs";
import crypto from "node:crypto";

export type AnchorEntryInput = {
  logPath: string;
  evidencePath: string;
  evidence: unknown;
};

export type AnchorLogVerifyResult = {
  ok: boolean;
  entries: number;
  error?: string;
};

function hash(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function appendAnchorEntry(input: AnchorEntryInput): unknown {
  const { logPath, evidencePath, evidence } = input;

  const prevHash = fs.existsSync(logPath)
    ? fs
        .readFileSync(logPath, "utf8")
        .trim()
        .split("\n")
        .slice(-1)[0]
        ?.split(" ")
        ?.shift() ?? "GENESIS"
    : "GENESIS";

  const payload = {
    ts: new Date().toISOString(),
    evidence_path: evidencePath,
    evidence_hash: hash(JSON.stringify(evidence)),
    prev_hash: prevHash
  };

  const line =
    hash(JSON.stringify(payload)) + " " + JSON.stringify(payload);

  fs.mkdirSync(require("path").dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, line + "\n", "utf8");

  return payload;
}

export function verifyAnchorLog(
  logPath: string
): AnchorLogVerifyResult {
  if (!fs.existsSync(logPath)) {
    return { ok: true, entries: 0 };
  }

  const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");

  let prev = "GENESIS";

  for (let i = 0; i < lines.length; i++) {
    const [h, json] = lines[i].split(" ", 2);
    const payload = JSON.parse(json);

    if (payload.prev_hash !== prev) {
      return {
        ok: false,
        entries: i,
        error: "Hash chain broken at entry " + i
      };
    }

    if (hash(JSON.stringify(payload)) !== h) {
      return {
        ok: false,
        entries: i,
        error: "Entry hash mismatch at " + i
      };
    }

    prev = h;
  }

  return { ok: true, entries: lines.length };
}
