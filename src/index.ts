/* wfsl-org-profile-guard
   Deterministic org profile drift detector (pins + org profile README).
   Emits evidence JSON and returns exit code 0 (OK) / 1 (DRIFT).
*/

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { graphql } from "@octokit/graphql";
import yaml from "js-yaml";

type Config = {
  org: string;
  profile: {
    expected_pins: string[];
    profile_readme: {
      required: boolean;
      repo: string;
      path: string;
    };
  };
  evidence: {
    out_dir: string;
    out_file: string;
  };
};

type EvidenceStatus = "OK" | "DRIFT" | "ERROR";

type Evidence = {
  tool: {
    name: string;
    version: string;
  };
  run: {
    utc: string;
    org: string;
    strict: boolean;
  };
  intent: {
    expected_pins: string[];
    profile_readme_required: boolean;
    profile_readme_repo: string;
    profile_readme_path: string;
  };
  observed: {
    pinned_repos: string[];
    profile_readme_exists: boolean;
  };
  drift: {
    missing_pins: string[];
    unexpected_pins: string[];
    profile_readme_missing: boolean;
  };
  status: EvidenceStatus;
  error?: {
    message: string;
  };
  integrity: {
    sha256: string;
  };
};

function nowUtcIso(): string {
  return new Date().toISOString();
}

function stableStringify(obj: unknown): string {
  // Deterministic JSON: recursively sort keys.
  const seen = new WeakSet<object>();

  const normalize = (value: any): any => {
    if (value === null || value === undefined) return value;
    if (typeof value !== "object") return value;

    if (seen.has(value)) {
      // No cycles expected. If present, collapse.
      return "[CYCLE]";
    }
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map(normalize);
    }

    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    const out: Record<string, any> = {};
    for (const k of keys) out[k] = normalize(value[k]);
    return out;
  };

  return JSON.stringify(normalize(obj), null, 2) + "\n";
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function readConfig(configPath: string): Config {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = yaml.load(raw) as any;

  // Minimal hard validation (no extra deps).
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid YAML config.");
  if (!parsed.org || typeof parsed.org !== "string") throw new Error("Missing config.org");
  if (!parsed.profile?.expected_pins || !Array.isArray(parsed.profile.expected_pins)) {
    throw new Error("Missing config.profile.expected_pins (array)");
  }
  if (typeof parsed.profile?.profile_readme?.required !== "boolean") {
    throw new Error("Missing config.profile.profile_readme.required (boolean)");
  }
  if (!parsed.profile?.profile_readme?.repo || typeof parsed.profile.profile_readme.repo !== "string") {
    throw new Error("Missing config.profile.profile_readme.repo (string)");
  }
  if (!parsed.profile?.profile_readme?.path || typeof parsed.profile.profile_readme.path !== "string") {
    throw new Error("Missing config.profile.profile_readme.path (string)");
  }
  if (!parsed.evidence?.out_dir || typeof parsed.evidence.out_dir !== "string") {
    throw new Error("Missing config.evidence.out_dir (string)");
  }
  if (!parsed.evidence?.out_file || typeof parsed.evidence.out_file !== "string") {
    throw new Error("Missing config.evidence.out_file (string)");
  }

  // Normalise: trim and de-dup pins, preserve declared order but compare set-wise.
  const pins = parsed.profile.expected_pins
    .map((x: any) => String(x).trim())
    .filter((x: string) => x.length > 0);

  return {
    org: parsed.org.trim(),
    profile: {
      expected_pins: pins,
      profile_readme: {
        required: parsed.profile.profile_readme.required,
        repo: parsed.profile.profile_readme.repo.trim(),
        path: parsed.profile.profile_readme.path.trim()
      }
    },
    evidence: {
      out_dir: parsed.evidence.out_dir.trim(),
      out_file: parsed.evidence.out_file.trim()
    }
  };
}

function getToken(): string {
  const t = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!t || t.trim().length === 0) {
    throw new Error("Missing token. Set GITHUB_TOKEN (recommended) or GH_TOKEN.");
  }
  return t.trim();
}

async function fetchPinnedRepos(orgLogin: string, token: string): Promise<string[]> {
  const query = `
    query($login: String!) {
      organization(login: $login) {
        pinnedItems(first: 25, types: [REPOSITORY]) {
          nodes {
            ... on Repository { name }
          }
        }
      }
    }
  `;

  const res: any = await graphql(query, {
    login: orgLogin,
    headers: { authorization: `token ${token}` }
  });

  const nodes = res?.organization?.pinnedItems?.nodes ?? [];
  const names = nodes
    .map((n: any) => (n?.name ? String(n.name) : ""))
    .filter((n: string) => n.length > 0);

  // Deterministic ordering: GitHub returns in pin order; keep it.
  return names;
}

async function checkProfileReadmeExists(orgLogin: string, readmeRepo: string, readmePath: string, token: string): Promise<boolean> {
  // Org profile README is stored in a repo named ".github" under org, at /profile/README.md
  const query = `
    query($owner: String!, $name: String!, $expr: String!) {
      repository(owner: $owner, name: $name) {
        object(expression: $expr) { __typename }
      }
    }
  `;

  const expr = `HEAD:${readmePath.replace(/^\/+/, "")}`;
  try {
    const res: any = await graphql(query, {
      owner: orgLogin,
      name: readmeRepo,
      expr,
      headers: { authorization: `token ${token}` }
    });
    return Boolean(res?.repository?.object?.__typename);
  } catch {
    // Repo missing or path missing.
    return false;
  }
}

function computeDrift(expectedPins: string[], pinned: string[]) {
  const expectedSet = new Set(expectedPins);
  const pinnedSet = new Set(pinned);

  const missing = expectedPins.filter((p) => !pinnedSet.has(p));
  const unexpected = pinned.filter((p) => !expectedSet.has(p));

  return {
    missing_pins: missing,
    unexpected_pins: unexpected
  };
}

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeEvidence(outDir: string, outFile: string, evidence: Evidence) {
  ensureDir(outDir);
  const p = path.join(outDir, outFile);

  // Integrity hash must be calculated on evidence without the hash, then inserted.
  const clone: Evidence = JSON.parse(JSON.stringify(evidence));
  clone.integrity.sha256 = "PENDING";

  const body = stableStringify(clone);
  const hash = sha256Hex(body);

  const finalEvidence: Evidence = {
    ...evidence,
    integrity: { sha256: hash }
  };

  fs.writeFileSync(p, stableStringify(finalEvidence), "utf8");
}

function getToolVersion(): string {
  try {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    const raw = fs.readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw);
    return String(pkg.version || "0.0.0");
  } catch {
    return "0.0.0";
  }
}

async function main() {
  const strict = process.argv.includes("--strict");
  const configPath = path.resolve(process.cwd(), "wfsl-org-profile.yml");

  const version = getToolVersion();

  let cfg: Config;
  let token: string;

  const baseEvidence: Evidence = {
    tool: { name: "wfsl-org-profile-guard", version },
    run: { utc: nowUtcIso(), org: "UNKNOWN", strict },
    intent: {
      expected_pins: [],
      profile_readme_required: false,
      profile_readme_repo: "",
      profile_readme_path: ""
    },
    observed: {
      pinned_repos: [],
      profile_readme_exists: false
    },
    drift: {
      missing_pins: [],
      unexpected_pins: [],
      profile_readme_missing: false
    },
    status: "ERROR",
    integrity: { sha256: "" }
  };

  try {
    cfg = readConfig(configPath);
    token = getToken();

    const pinned = await fetchPinnedRepos(cfg.org, token);
    const readmeExists = await checkProfileReadmeExists(
      cfg.org,
      cfg.profile.profile_readme.repo,
      cfg.profile.profile_readme.path,
      token
    );

    const driftPins = computeDrift(cfg.profile.expected_pins, pinned);
    const profileReadmeMissing = cfg.profile.profile_readme.required ? !readmeExists : false;

    const isDrift =
      driftPins.missing_pins.length > 0 ||
      driftPins.unexpected_pins.length > 0 ||
      profileReadmeMissing;

    const status: EvidenceStatus = isDrift ? "DRIFT" : "OK";

    const evidence: Evidence = {
      ...baseEvidence,
      run: { utc: nowUtcIso(), org: cfg.org, strict },
      intent: {
        expected_pins: cfg.profile.expected_pins,
        profile_readme_required: cfg.profile.profile_readme.required,
        profile_readme_repo: cfg.profile.profile_readme.repo,
        profile_readme_path: cfg.profile.profile_readme.path
      },
      observed: {
        pinned_repos: pinned,
        profile_readme_exists: readmeExists
      },
      drift: {
        missing_pins: driftPins.missing_pins,
        unexpected_pins: driftPins.unexpected_pins,
        profile_readme_missing: profileReadmeMissing
      },
      status,
      integrity: { sha256: "" }
    };

    writeEvidence(cfg.evidence.out_dir, cfg.evidence.out_file, evidence);

    if (status === "DRIFT") {
      // Deterministic console output, no noise.
      console.error("WFSL ORG PROFILE DRIFT DETECTED");
      console.error(`Org: ${cfg.org}`);
      console.error(`Evidence: ${path.join(cfg.evidence.out_dir, cfg.evidence.out_file)}`);
      if (driftPins.missing_pins.length) console.error(`Missing pins: ${driftPins.missing_pins.join(", ")}`);
      if (driftPins.unexpected_pins.length) console.error(`Unexpected pins: ${driftPins.unexpected_pins.join(", ")}`);
      if (profileReadmeMissing) console.error("Profile README: MISSING");
      process.exit(1);
    }

    console.log("WFSL ORG PROFILE OK");
    console.log(`Org: ${cfg.org}`);
    console.log(`Evidence: ${path.join(cfg.evidence.out_dir, cfg.evidence.out_file)}`);
    process.exit(0);
  } catch (err: any) {
    const msg = err?.message ? String(err.message) : "Unknown error";
    const evidence: Evidence = {
      ...baseEvidence,
      status: "ERROR",
      error: { message: msg }
    };

    // Best effort evidence even on config/token errors.
    try {
      // If config loads, honour its evidence path. Otherwise default.
      const outDir = "evidence";
      const outFile = "org-profile-check.json";
      writeEvidence(outDir, outFile, evidence);
    } catch {
      // Do nothing.
    }

    console.error("WFSL ORG PROFILE ERROR");
    console.error(msg);
    process.exit(2);
  }
}

main();
