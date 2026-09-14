import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCompactPrimaryAgentName,
  buildCompactWorkspaceName,
  deriveProjectNameFromText,
  deriveWorkspaceBrandName,
  isGenericWorkspaceName
} from "@/lib/workspace-naming";

test("project identity extraction ignores generic workspace labels", () => {
  assert.equal(deriveProjectNameFromText("nitroclash projemize marketing ekibi kuracaz"), "nitroclash");
  assert.equal(deriveProjectNameFromText("coincollect marketing ekibi oluşturalım"), "coincollect");
  assert.equal(deriveProjectNameFromText("https://coincollect.org"), "coincollect");
  assert.equal(deriveProjectNameFromText("Visit https://paperkite.co.uk for the project context."), "paperkite");
  assert.equal(deriveProjectNameFromText("Build a simple product for independent makers."), null);
  assert.equal(isGenericWorkspaceName("Workspace Works"), true);
  assert.equal(isGenericWorkspaceName("Workspace Maker"), true);
  assert.equal(isGenericWorkspaceName("NitroClash Works"), false);
});

test("workspace naming keeps a long project title out of the workspace identity", () => {
  assert.equal(
    deriveWorkspaceBrandName("AvatarsAI | Unleash Your Digital Identity in the Blockchain Universe"),
    "AvatarsAI"
  );
  assert.equal(
    buildCompactWorkspaceName("AvatarsAI | Unleash Your Digital Identity in the Blockchain Universe"),
    "AvatarsAI Workspace"
  );
  assert.equal(
    buildCompactPrimaryAgentName("AvatarsAI Workspace"),
    "AvatarsAI Builder"
  );
});

test("workspace and primary-agent suffixes are stable but vary by project brand", () => {
  const names = ["AvatarsAI", "CoinCollect", "PlaceDJ", "Key2Web3"].map((name) => buildCompactWorkspaceName(name));
  const agentNames = ["AvatarsAI", "CoinCollect", "PlaceDJ", "Key2Web3"].map((name) => buildCompactPrimaryAgentName(name));

  assert.equal(new Set(names).size, names.length);
  assert.equal(new Set(agentNames).size, agentNames.length);
  assert.deepEqual(names, [
    "AvatarsAI Workspace",
    "CoinCollect Lab",
    "PlaceDJ Works",
    "Key2Web3 Studio"
  ]);
  assert.deepEqual(agentNames, [
    "AvatarsAI Builder",
    "CoinCollect Lead",
    "PlaceDJ Maker",
    "Key2Web3 Scout"
  ]);
});

test("existing workspace suffixes are not duplicated and names stay bounded", () => {
  const workspaceName = buildCompactWorkspaceName("Faros Group Workspace");
  const longName = buildCompactWorkspaceName("A very long project title with many words");

  assert.equal(workspaceName, "Faros Group Workspace");
  assert.ok(longName.split(/\s+/u).length <= 3);
  assert.equal(buildCompactPrimaryAgentName(workspaceName).split(/\s+/u).length, 3);
});
