import fs from "node:fs";
import path from "node:path";
import { execute } from "wfsl-control-plane";
import { appendAnchorEntry, verifyAnchorLog } from "./anchor";

type Args = {
  evidenceFile?: string;
  doVerify?: boolean;
  doAnchor?: boolean;
  anchorLog?: string;
  doVerifyLog?: boolean;
  verifyLogPath?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {};

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === "--verify") {
      args.doVerify = true;
      args.evidenceFile = argv[i + 1];
      i++;
      continue;
    }

    if (a === "--anchor") {
      args.doAnchor = true;
      args.evidenceFile = argv[i + 1];
      i++;
      continue;
    }

    if (a === "--anchor-log") {
      args.anchorLog = argv[i + 1];
      i++;
      continue;
    }

    if (a === "--verify-log") {
      args.doVerifyLog = true;
      args.verifyLogPath = argv[i + 1];
      i++;
      continue;
    }
  }

  return args;
}

function ensureDirForFile(filePath: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function writeJson(filePath: string, data: unknown): void {
  ensureDirForFile(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function runControlPlaneVerification(evidencePath: string): unknown {
  const input = readJson(evidencePath);
  const out = execute(input as any);
  return out;
}

function main(): void {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.doVerifyLog) {
    const logPath = args.verifyLogPath ?? "evidence/ANCHOR_LOG.ndjson";
    const res = verifyAnchorLog(logPath);
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 2);
  }

  // Backward-compatible behaviour: default to --verify evidence/org-profile-check.json
  const evidencePath = args.evidenceFile ?? "evidence/org-profile-check.json";

  if (!args.doVerify && !args.doAnchor) {
    // Preserve existing UX if user runs the old script.
    const out = runControlPlaneVerification(evidencePath);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (args.doVerify) {
    const out = runControlPlaneVerification(evidencePath);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (args.doAnchor) {
    const out = runControlPlaneVerification(evidencePath);

    // Emit evidence result first, then anchor result. Both are facts.
    console.log(JSON.stringify(out, null, 2));

    // Persist the evidence result as an artefact for anchoring and later audit.
    const emittedEvidencePath = "evidence/emitted/org-profile-check.emitted.json";
    writeJson(emittedEvidencePath, out);

    const logPath = args.anchorLog ?? "evidence/ANCHOR_LOG.ndjson";
    const entry = appendAnchorEntry({
      logPath,
      evidencePath: emittedEvidencePath,
      evidence: out
    });

    console.log(JSON.stringify({ anchored: true, log: logPath, entry }, null, 2));
    return;
  }
}

main();
