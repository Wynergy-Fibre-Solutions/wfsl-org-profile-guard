/**
 * WFSL Org Profile Guard
 * Uses wfsl-control-plane for deterministic governance execution.
 */

import controlPlane from "wfsl-control-plane";
import fs from "fs";

function runVerification(evidencePath: string) {
  const raw = fs.readFileSync(evidencePath, "utf-8");
  const command = JSON.parse(raw);

  const evidence = controlPlane.execute(command);

  return evidence;
}

const args = process.argv.slice(2);

if (args[0] === "--verify" && args[1]) {
  const result = runVerification(args[1]);
  console.log(JSON.stringify(result, null, 2));
} else {
  throw new Error("Invalid arguments");
}
