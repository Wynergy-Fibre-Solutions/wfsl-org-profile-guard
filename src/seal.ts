// src/seal.ts
import crypto from "node:crypto";
import fs from "node:fs";

export type SealV1 = {
  algorithm: "sha256";
  input_digest: string;
  evidence_digest: string;
  previous_digest: string | null;
  chain_index: number;
};

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Canonical JSON stringification with stable key ordering.
 * - Objects: keys sorted lexicographically
 * - Arrays: preserved order
 * - Primitives: JSON default
 */
export function canonicalJson(value: unknown): string {
  const normalise = (v: unknown): JsonValue => {
    if (v === null) return null;
    if (typeof v === "string") return v;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;

    if (Array.isArray(v)) {
      return v.map((x) => normalise(x));
    }

    if (isPlainObject(v)) {
      const keys = Object.keys(v).sort();
      const out: Record<string, JsonValue> = {};
      for (const k of keys) out[k] = normalise(v[k]);
      return out;
    }

    // Functions, symbols, undefined etc are not representable in JSON
    return null;
  };

  return JSON.stringify(normalise(value));
}

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Computes digest over the evidence object excluding the `seal` property.
 */
export function computeEvidenceDigest(evidenceWithoutSeal: unknown): string {
  const payload = canonicalJson(evidenceWithoutSeal);
  return sha256Hex(payload);
}

/**
 * Builds a deterministic input digest from selected inputs.
 * Keep this strictly deterministic (no timestamps, no file paths).
 */
export function computeInputDigest(input: {
  engine: string;
  version: string;
  org: string;
  mode: string;
  expectedPins: string[];
  profileReadmeRequired: boolean;
  profileReadmeRepo?: string | null;
  profileReadmePath?: string | null;
}): string {
  const payload = canonicalJson({
    engine: input.engine,
    version: input.version,
    org: input.org,
    mode: input.mode,
    expectedPins: [...input.expectedPins].sort(),
    profileReadme: {
      required: input.profileReadmeRequired,
      repo: input.profileReadmeRepo ?? null,
      path: input.profileReadmePath ?? null,
    },
  });

  return sha256Hex(payload);
}

export function attachSeal(params: {
  evidenceWithoutSeal: any;
  inputDigest: string;
  previousDigest?: string | null;
  chainIndex?: number;
}): any {
  const previous = params.previousDigest ?? null;
  const chainIndex = params.chainIndex ?? 1;

  const evidenceDigest = computeEvidenceDigest(params.evidenceWithoutSeal);

  const seal: SealV1 = {
    algorithm: "sha256",
    input_digest: params.inputDigest,
    evidence_digest: evidenceDigest,
    previous_digest: previous,
    chain_index: chainIndex,
  };

  return { ...params.evidenceWithoutSeal, seal };
}

export function verifyEvidenceObject(evidence: any): {
  ok: boolean;
  expected: { evidence_digest: string };
  actual: { evidence_digest: string };
} {
  if (!evidence || typeof evidence !== "object") {
    return {
      ok: false,
      expected: { evidence_digest: "" },
      actual: { evidence_digest: "" },
    };
  }

  const seal = evidence.seal as SealV1 | undefined;
  if (!seal || seal.algorithm !== "sha256" || !seal.evidence_digest) {
    return {
      ok: false,
      expected: { evidence_digest: "" },
      actual: { evidence_digest: "" },
    };
  }

  // Recompute digest over evidence excluding `seal`
  const { seal: _ignored, ...withoutSeal } = evidence;
  const recomputed = computeEvidenceDigest(withoutSeal);

  return {
    ok: recomputed === seal.evidence_digest,
    expected: { evidence_digest: seal.evidence_digest },
    actual: { evidence_digest: recomputed },
  };
}

export function verifyEvidenceFile(filePath: string): {
  ok: boolean;
  expected: { evidence_digest: string };
  actual: { evidence_digest: string };
} {
  const raw = fs.readFileSync(filePath, "utf8");
  const obj = JSON.parse(raw);
  return verifyEvidenceObject(obj);
}
