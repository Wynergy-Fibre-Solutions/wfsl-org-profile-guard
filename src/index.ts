// src/index.ts
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import yaml from "js-yaml";
import { graphql } from "@octokit/graphql";
import { attachSeal, computeInputDigest, verifyEvidenceFile } from "./seal.js";

type OrgProfileConfig = {
  org: string;
  profile: {
    expected_pins: string[];
    profile_readme?: {
      required: boolean;
      repo?: string;
      path?: string;
    };
  };
  evidence: {
    out_dir: string;
    out_file: string;
  };
};

function fail(msg: string): never {
  console.error(`WFSL ORG PROFILE ERROR\n${msg}`);
  process.exit(2);
}

function getArgValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : null;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getToken(): string {
  const t = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!t) fail("Missing token. Set GITHUB_TOKEN (recommended) or GH_TOKEN.");
  return t;
}

function loadConfig(configPath: string): OrgProfileConfig {
  const raw = fs.readFileSync(configPath, "utf8");
  const obj = yaml.load(raw) as any;

  if (!obj || typeof obj !== "object") fail("Invalid config YAML.");

  const cfg: OrgProfileConfig = obj;

  if (!cfg.org) fail("Config missing: org");
  if (!cfg.profile?.expected_pins || !Array.isArray(cfg.profile.expected_pins)) {
    fail("Config missing: profile.expected_pins[]");
  }
  if (!cfg.evidence?.out_dir || !cfg.evidence?.out_file) {
    fail("Config missing: evidence.out_dir and evidence.out_file");
  }

  return cfg;
}

async function fetchPinnedRepos(org: string, token: string): Promise<string[]> {
  const gql = graphql.defaults({
    headers: { authorization: `token ${token}` },
  });

  // Organisation pinned items are exposed via GraphQL: pinnedItems
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

  const res: any = await gql(query, { login: org });
  const nodes = res?.organization?.pinnedItems?.nodes ?? [];
  return nodes.map((n: any) => String(n.name)).filter(Boolean);
}

function writeEvidence(outDir: string, outFile: string, obj: unknown): string {
  fs.mkdirSync(outDir, { recursive: true });
  const p = path.join(outDir, outFile);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
  return p;
}

async function run(): Promise<void> {
  // Verify mode (offline): --verify <file>
  const verifyPath = getArgValue("--verify");
  if (verifyPath) {
    const v = verifyEvidenceFile(verifyPath);
    if (v.ok) {
      console.log("WFSL EVIDENCE VERIFIED");
      console.log(`File: ${verifyPath}`);
      process.exit(0);
    } else {
      console.error("WFSL EVIDENCE VERIFICATION FAILED");
      console.error(`File: ${verifyPath}`);
      console.error(`Expected: ${v.expected.evidence_digest}`);
      console.error(`Actual:   ${v.actual.evidence_digest}`);
      process.exit(1);
    }
  }

  const strict = hasFlag("--strict");

  const token = getToken();
  const configPath = path.resolve(process.cwd(), "wfsl-org-profile.yml");
  const cfg = loadConfig(configPath);

  const expectedPins = cfg.profile.expected_pins.map(String);
  const pinned = await fetchPinnedRepos(cfg.org, token);

  const missingPins = expectedPins.filter((x) => !pinned.includes(x));

  const status = missingPins.length === 0 ? "ADMITTED" : "DRIFT";

  const engine = "wfsl-org-profile-guard";
  const version = "0.2.0";
  const mode = "community";

  const inputDigest = computeInputDigest({
    engine,
    version,
    org: cfg.org,
    mode,
    expectedPins,
    profileReadmeRequired: Boolean(cfg.profile.profile_readme?.required),
    profileReadmeRepo: cfg.profile.profile_readme?.repo ?? null,
    profileReadmePath: cfg.profile.profile_readme?.path ?? null,
  });

  const evidenceWithoutSeal = {
    meta: {
      engine,
      version,
      mode,
      org: cfg.org,
      timestamp_utc: new Date().toISOString(),
    },
    result: {
      status,
      expected_pins: expectedPins,
      pinned: pinned,
      missing_pins: missingPins,
    },
  };

  const evidence = attachSeal({
    evidenceWithoutSeal,
    inputDigest,
    previousDigest: null,
    chainIndex: 1,
  });

  const outPath = writeEvidence(cfg.evidence.out_dir, cfg.evidence.out_file, evidence);

  if (status === "ADMITTED") {
    console.log("WFSL ORG PROFILE ADMITTED");
    console.log(`Org: ${cfg.org}`);
    console.log(`Evidence: ${outPath}`);
    process.exit(0);
  } else {
    console.log("WFSL ORG PROFILE DRIFT DETECTED");
    console.log(`Org: ${cfg.org}`);
    console.log(`Evidence: ${outPath}`);
    console.log(`Missing pins: ${missingPins.join(", ") || "(none)"}`);

    if (strict) process.exit(1);
    process.exit(0);
  }
}

run().catch((err) => {
  console.error("WFSL ORG PROFILE ERROR");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
