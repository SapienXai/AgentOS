import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAccountFaviconSources,
  resolveAccountIconKey,
  resolveAccountLogoDomain
} from "@/components/mission-control/account-icon.utils";

test("account favicon sources prefer the saved primary domain without leaking URL details", () => {
  assert.equal(
    resolveAccountLogoDomain({
      primaryDomain: "https://WWW.Example.com/login?token=secret#session",
      serviceId: "example",
      serviceName: "Example"
    }),
    "example.com"
  );

  assert.deepEqual(
    resolveAccountFaviconSources({
      primaryDomain: "https://WWW.Example.com/login?token=secret#session",
      serviceId: "example",
      serviceName: "Example"
    }),
    [
      "https://example.com/favicon.ico",
      "https://www.google.com/s2/favicons?domain=example.com&sz=64"
    ]
  );
});

test("account favicon sources fall back to domain-like service identifiers", () => {
  assert.deepEqual(
    resolveAccountFaviconSources({
      serviceId: "github.com",
      serviceName: "GitHub"
    }),
    [
      "https://github.com/favicon.ico",
      "https://www.google.com/s2/favicons?domain=github.com&sz=64"
    ]
  );
});

test("account icon helpers keep simple-icon fallback for non-domain accounts", () => {
  assert.deepEqual(resolveAccountFaviconSources({ serviceId: "gmail", serviceName: "Gmail" }), []);
  assert.equal(resolveAccountIconKey({ serviceId: "gmail", serviceName: "Gmail" }), "siGmail");
});
