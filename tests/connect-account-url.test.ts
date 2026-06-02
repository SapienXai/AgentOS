import assert from "node:assert/strict";
import test from "node:test";

import { accountLoginExamples, resolveConnectAccountWebsite } from "@/components/operations/connect-account-url";

test("connect account URL examples expose 20 unique shortcuts", () => {
  assert.equal(accountLoginExamples.length, 20);
  assert.equal(new Set(accountLoginExamples.map((example) => example.id)).size, accountLoginExamples.length);
  assert.equal(new Set(accountLoginExamples.map((example) => example.loginUrl)).size, accountLoginExamples.length);
});

test("connect account URL resolution accepts one website and strips query/hash data", () => {
  assert.deepEqual(
    resolveConnectAccountWebsite("https://www.example.com/login?token=query-secret#password=hash-secret"),
    {
      serviceId: "example-com",
      serviceName: "Example",
      loginUrl: "https://www.example.com/login",
      primaryDomain: "example.com",
      label: "example-login"
    }
  );
});

test("connect account URL resolution accepts domain-only input", () => {
  assert.deepEqual(
    resolveConnectAccountWebsite("github.com"),
    {
      serviceId: "github",
      serviceName: "GitHub",
      loginUrl: "https://github.com/",
      primaryDomain: "github.com",
      label: "github-login"
    }
  );
});

test("connect account URL resolution rejects search-only text", () => {
  assert.equal(resolveConnectAccountWebsite("github"), null);
  assert.equal(resolveConnectAccountWebsite("not a website"), null);
});
