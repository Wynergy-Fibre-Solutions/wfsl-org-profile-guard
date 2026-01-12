import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { collectTimeWitnesses } from "./witness";

function ensureDirForFile(filePath: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function sha256FileHex(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function writeJson(filePath: string, data: unknown): void {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function writeAnchorManifest(opts?: {
  repo?: string;
  head?: string;
  branch?: string;
  inputPath?: string;
  emittedPath?: string;
  logPath?: string;
  manifestPath?: string;
  includeWitness?: boolean;
}): Promise<{ ok: boolean; manifestPath: string }> {
  const inputPath = opts?.inputPath ?? "evidence/org-profile-check.json";
  const emittedPath = opts?.emittedPath ?? "evidence/emitted/org-profile-check.emitted.json";
  const logPath = opts?.logPath ?? "evidence/ANCHOR_LOG.ndjson";
  const manifestPath = opts?.manifestPath ?? "evidence/ANCHOR_MANIFEST.json";

  const logHash = sha256FileHex(logPath);
  const inputHash = sha256FileHex(inputPath);
  const emittedHash = sha256FileHex(emittedPath);

  const manifest: any = {
    system: "wfsl-org-profile-guard",
    manifest_version: "1.0.0",
    created_utc: new Date().toISOString(),
    git: {
      repo: opts?.repo ?? "Wynergy-Fibre-Solutions/wfsl-org-profile-guard",
      head: opts?.head ?? null,
      branch: opts?.branch ?? null
    },
    artifacts: {
      input_evidence: { path: inputPath, sha256: inputHash },
      emitted_evidence: { path: emittedPath, sha256: emittedHash },
      anchor_log: { path: logPath, sha256: logHash }
    },
    bindings: {
      anchor_log_sha256: logHash
    }
  };

  if (opts?.includeWitness) {
    const witness = await collectTimeWitnesses();
    manifest.external_time_witness = {
      ok: witness.ok,
      witness_bundle_hash: witness.witness_bundle_hash,
      witnesses: witness.witnesses,
      bound_to: {
        anchor_log_sha256: logHash
      }
    };
  }

  writeJson(manifestPath, manifest);
  return { ok: true, manifestPath };
}
