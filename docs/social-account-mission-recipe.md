# Social Account Mission Recipe

Use this recipe when an AgentOS workspace needs a human-reviewed mission that touches an owned social account, such as X/Twitter research, monitoring, drafts, replies, media review, direct messages, or post-publication checks.

AgentOS stays the operator control layer. OpenClaw remains the runtime and plugin source of truth.

## Current Support Matrix

| Need | Current AgentOS path | Operator control |
| --- | --- | --- |
| Register an owned social login | Accounts page backed by an OpenClaw browser profile | AgentOS stores the service, domain, profile name, and stripped login URL only |
| Let one agent use that account target | Account access rule with `use_browser_profile` | AgentOS passes account-target context before mission dispatch |
| Require approval before account use | Account access rule with `requires_approval` | Persisted but blocked until approval dispatch exists |
| Run an OpenClaw social plugin | Install and configure the plugin in OpenClaw | AgentOS can surface OpenClaw capabilities and transcript state, but plugin execution remains OpenClaw-owned |

## Setup

1. Run `agentos doctor --deep` and fix OpenClaw Gateway, auth, model, and browser-profile readiness before dispatching the mission.
2. Open the Accounts page and connect the owned social account login through a reported OpenClaw browser profile.
3. Keep the default account rule at `no_access`.
4. Grant `use_browser_profile` only to the agent that should inspect or operate that account target.
5. Keep `requires_approval` rules for future approval dispatch. Today they intentionally block mission launch.
6. If the workflow needs structured X/Twitter actions, install TweetClaw in OpenClaw:

```bash
openclaw plugins install @xquik/tweetclaw
```

Configure any required TweetClaw or Xquik credential in the OpenClaw-approved configuration path. Do not paste keys, cookies, browser sessions, or tokens into AgentOS mission text.

## Mission Template

```text
Use the selected AgentOS account target only for browser-profile selection.
Do not ask for, print, store, or expose credentials, cookies, tokens, sessions, query parameters, or URL fragments.

Start with read-only public checks.
Allowed X/Twitter work: search tweets, search tweet replies, follower export, user lookup, media metadata review, monitor status review, and webhook status review.

Before post tweets, post tweet replies, direct messages, media upload, monitor creation, webhook creation, or giveaway draws:
1. Summarize the exact planned action.
2. Show the account, target URL or handle, draft text, media, and expected side effect.
3. Wait for explicit operator confirmation in this chat.

If the browser tool cannot select the reported OpenClaw profile, stop and report that profile selection is not exposed for this dispatch path.
If TweetClaw is not installed or configured in OpenClaw, stop and report the missing plugin capability.
```

## Review Checklist

- Confirm the mission transcript shows the selected account target context.
- Confirm the agent did not print login URLs with query strings, cookies, tokens, or API keys.
- Confirm read-only collection happened before any proposed write action.
- Confirm every public action had an explicit operator confirmation in chat.
- Save useful source URLs, tweet IDs, handles, and review notes in workspace docs or deliverables.
- Keep credentials, cookies, browser profile internals, direct-message contents, and private session details out of workspace files.

## When To Stop

Stop instead of dispatching when:

- OpenClaw Gateway or browser-profile capability is unavailable.
- The selected account rule is `no_access`.
- The selected account rule is `requires_approval`.
- The mission asks for account actions without a named account target.
- The mission asks for unsupported plugin actions or missing TweetClaw capability.
- The operator has not confirmed a public write action.
