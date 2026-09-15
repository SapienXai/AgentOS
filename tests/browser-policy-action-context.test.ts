import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildTrustedBrowserActionContext,
  classifyBrowserAction,
  parseBrowserToolSnapshotResult
} from "../openclaw-plugins/agentos-browser-policy/action-context.js";
import { evaluateBrowserActionPolicy } from "@/lib/agentos/browser-accounts/action-policy";
import type { TrustedBrowserActionContext } from "@/lib/agentos/browser-accounts/action-policy";

const binding = {
  serviceId: "x" as const,
  approvalPolicy: "block_sensitive" as const
};

function snapshot(
  refs: Record<string, { role: string; name: string }>,
  options: { targetId?: string; url?: string; dialogMessage?: string } = {}
) {
  const targetId = options.targetId ?? "tab-x-1";
  const url = options.url ?? "https://x.com/home";
  const lines = Object.entries(refs)
    .map(([ref, metadata]) => `- ${metadata.role} ${JSON.stringify(metadata.name)} [ref=${ref}]`)
    .join("\n");
  return {
    ok: true,
    format: "ai",
    targetId,
    url,
    snapshot: lines,
    refs,
    ...(options.dialogMessage
      ? { browserState: { dialogs: { pending: [{ id: "dialog-1", message: options.dialogMessage }] } } }
      : {})
  };
}

function context(raw: ReturnType<typeof snapshot>): TrustedBrowserActionContext {
  const result = buildTrustedBrowserActionContext(raw, { allowedDomains: ["x.com"] });
  assert.ok(result);
  return result;
}

function evaluate(
  current: TrustedBrowserActionContext,
  observed: TrustedBrowserActionContext,
  input: {
    ref?: string;
    kind?: string;
    action?: string;
    submit?: boolean;
    key?: string;
    description?: string;
    capabilities: ("read" | "interact" | "publish" | "transact" | "account_admin")[];
  }
) {
  return evaluateBrowserActionPolicy({
    action: input.action ?? "act",
    actionDescription: input.description ?? "model-provided description is not trusted",
    actionKind: input.kind ?? "click",
    actionRef: input.ref,
    submit: input.submit,
    key: input.key,
    serviceId: binding.serviceId,
    trustedContext: current,
    observedContext: observed,
    grantedCapabilities: input.capabilities,
    approvalPolicy: binding.approvalPolicy,
    approvalInfrastructureAvailable: true
  });
}

test("real OpenClaw AI snapshot refs classify ordinary and publish targets", () => {
  const raw = snapshot({
    e41: { role: "button", name: "Notifications filter" },
    e42: { role: "button", name: "Post" }
  });
  const observed = context(raw);
  const current = context(raw);

  assert.equal(classifyBrowserAction({
    action: "act",
    params: { request: { kind: "click", ref: "e41" } },
    binding,
    trustedContext: current,
    observedContext: observed
  }).capability, "interact");
  assert.equal(evaluate(current, observed, { ref: "e41", capabilities: ["read", "interact"] }).decision, "allow");

  assert.equal(classifyBrowserAction({
    action: "act",
    params: { request: { kind: "click", ref: "e42" }, actionDescription: "harmless click" },
    binding,
    trustedContext: current,
    observedContext: observed
  }).capability, "publish");
  assert.equal(evaluate(current, observed, { ref: "e42", capabilities: ["read", "interact"] }).decision, "block");
  assert.equal(evaluate(current, observed, { ref: "e42", capabilities: ["read", "interact", "publish"] }).decision, "allow");
});

test("real OpenClaw ref-based transaction and account-admin targets cannot use interact", () => {
  const raw = snapshot({
    e43: { role: "button", name: "Buy now" },
    e44: { role: "button", name: "Account settings" }
  });
  const observed = context(raw);
  const current = context(raw);

  assert.equal(evaluate(current, observed, { ref: "e43", capabilities: ["read", "interact"] }).decision, "block");
  assert.equal(evaluate(current, observed, { ref: "e43", capabilities: ["read", "interact", "transact"] }).decision, "require_approval");
  assert.equal(evaluate(current, observed, { ref: "e44", capabilities: ["read", "interact", "account_admin"] }).decision, "block");
});

test("submit, Enter, and browser dialog confirmation use trusted page state", () => {
  const publishRaw = snapshot({
    e45: { role: "textbox", name: "Message composer" },
    e46: { role: "button", name: "Post" }
  });
  const publishObserved = context(publishRaw);
  const publishCurrent = context(publishRaw);
  assert.equal(evaluate(publishCurrent, publishObserved, {
    ref: "e45",
    kind: "type",
    submit: true,
    capabilities: ["read", "interact"]
  }).decision, "block");

  const checkoutRaw = snapshot({
    e47: { role: "textbox", name: "Checkout form" },
    e48: { role: "button", name: "Buy now" }
  });
  const checkoutObserved = context(checkoutRaw);
  const checkoutCurrent = context(checkoutRaw);
  assert.equal(evaluate(checkoutCurrent, checkoutObserved, {
    ref: "e47",
    kind: "press",
    key: "Enter",
    capabilities: ["read", "interact", "transact"]
  }).decision, "require_approval");

  const dialogRaw = snapshot(
    { e49: { role: "button", name: "Confirm" } },
    { dialogMessage: "Confirm purchase" }
  );
  const dialogObserved = context(dialogRaw);
  const dialogCurrent = context(dialogRaw);
  assert.equal(evaluate(dialogCurrent, dialogObserved, {
    action: "dialog",
    kind: "dialog",
    capabilities: ["read", "interact", "transact"]
  }).decision, "require_approval");
});

test("stale, unknown, and semantically contradictory refs fail closed", () => {
  const observed = context(snapshot({ e50: { role: "button", name: "Post" } }));
  const changed = context(snapshot({ e50: { role: "button", name: "Buy now" } }));
  const stale = evaluate(changed, observed, { ref: "e50", capabilities: ["read", "interact", "transact"] });
  assert.equal(stale.capability, "unknown");
  assert.equal(stale.decision, "require_approval");

  const unknown = evaluate(changed, observed, { ref: "e99", capabilities: ["read", "interact"] });
  assert.equal(unknown.capability, "unknown");
  assert.equal(unknown.decision, "require_approval");

  const ordinary = context(snapshot({ e51: { role: "button", name: "Notifications filter" } }));
  assert.equal(evaluate(ordinary, ordinary, {
    ref: "e51",
    description: "publish this post",
    capabilities: ["read", "interact"]
  }).decision, "allow");
});

test("formatted OpenClaw snapshot results are reduced to trusted ref metadata", () => {
  const parsed = parseBrowserToolSnapshotResult({
    content: [{
      type: "text",
      text: '- button "Post" [ref=e52]\n- button "Filter" [ref=e53]'
    }],
    details: {
      ok: true,
      format: "ai",
      targetId: "tab-x-2",
      url: "https://x.com/home"
    }
  }, { allowedDomains: ["x.com"] });
  assert.ok(parsed);
  assert.deepEqual(parsed.refs.e52, { role: "button", name: "Post" });
  assert.equal(parsed.refs.e53.name, "Filter");
  assert.equal("cookie" in parsed, false);
  assert.equal("token" in parsed, false);
});

test("OpenClaw wait predicates and act lifecycle mutations do not become reads", () => {
  assert.equal(classifyBrowserAction({
    action: "wait",
    params: { fn: "document.body.dataset.ready === 'true'" },
    binding
  }).capability, "account_admin");
  assert.equal(classifyBrowserAction({
    action: "act",
    params: { request: { kind: "close" } },
    binding
  }).capability, "account_admin");
  assert.equal(evaluateBrowserActionPolicy({
    action: "wait",
    waitPredicate: "document.body.dataset.ready === 'true'",
    grantedCapabilities: ["read", "interact"],
    approvalInfrastructureAvailable: true
  }).decision, "block");
});
