/**
 * WFSL Org Profile Guard
 * Delegates governance execution to wfsl-control-plane.
 */

import { execute } from "wfsl-control-plane";
import fs from "fs";

function runVerification(evidencePath: string) {
  const raw = fs.readFileSync(evidencePath, "utf-8");
  const command = JSON.parse(raw);
  return execute(command);
}

const args = process.argv.slice(2);

if (args[0] === "--verify" && args[1]) {
  const result = runVerification(args[1]);
  console.log(JSON.stringify(result, null, 2));
} else {
  throw new Error("Invalid arguments");
}
