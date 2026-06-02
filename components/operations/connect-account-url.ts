export type ConnectAccountWebsiteExample = {
  id: string;
  label: string;
  service: string;
  loginUrl: string;
  domains: string[];
};

export type ConnectAccountWebsiteResolution = {
  serviceId: string;
  serviceName: string;
  loginUrl: string;
  primaryDomain: string;
  label: string;
};

export const accountLoginExamples: ConnectAccountWebsiteExample[] = [
  {
    id: "product-hunt",
    label: "Product Hunt",
    service: "Product Hunt",
    loginUrl: "https://www.producthunt.com/login",
    domains: ["producthunt.com"]
  },
  {
    id: "gmail",
    label: "Gmail",
    service: "Gmail",
    loginUrl: "https://accounts.google.com/",
    domains: ["accounts.google.com", "mail.google.com"]
  },
  {
    id: "x-twitter",
    label: "X / Twitter",
    service: "X / Twitter",
    loginUrl: "https://x.com/login",
    domains: ["x.com", "twitter.com"]
  },
  {
    id: "github",
    label: "GitHub",
    service: "GitHub",
    loginUrl: "https://github.com/login",
    domains: ["github.com"]
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    service: "LinkedIn",
    loginUrl: "https://www.linkedin.com/login",
    domains: ["linkedin.com"]
  },
  {
    id: "discord",
    label: "Discord",
    service: "Discord",
    loginUrl: "https://discord.com/login",
    domains: ["discord.com"]
  },
  {
    id: "telegram",
    label: "Telegram",
    service: "Telegram",
    loginUrl: "https://web.telegram.org/",
    domains: ["web.telegram.org"]
  },
  {
    id: "slack",
    label: "Slack",
    service: "Slack",
    loginUrl: "https://slack.com/signin",
    domains: ["slack.com"]
  },
  {
    id: "notion",
    label: "Notion",
    service: "Notion",
    loginUrl: "https://www.notion.so/login",
    domains: ["notion.so"]
  },
  {
    id: "figma",
    label: "Figma",
    service: "Figma",
    loginUrl: "https://www.figma.com/login",
    domains: ["figma.com"]
  },
  {
    id: "canva",
    label: "Canva",
    service: "Canva",
    loginUrl: "https://www.canva.com/login",
    domains: ["canva.com"]
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    service: "ChatGPT",
    loginUrl: "https://chatgpt.com/auth/login",
    domains: ["chatgpt.com", "openai.com"]
  },
  {
    id: "microsoft",
    label: "Microsoft",
    service: "Microsoft",
    loginUrl: "https://login.microsoftonline.com/",
    domains: ["login.microsoftonline.com", "microsoft.com", "live.com", "outlook.live.com"]
  },
  {
    id: "facebook",
    label: "Facebook",
    service: "Facebook",
    loginUrl: "https://www.facebook.com/login/",
    domains: ["facebook.com"]
  },
  {
    id: "instagram",
    label: "Instagram",
    service: "Instagram",
    loginUrl: "https://www.instagram.com/accounts/login/",
    domains: ["instagram.com"]
  },
  {
    id: "reddit",
    label: "Reddit",
    service: "Reddit",
    loginUrl: "https://www.reddit.com/login",
    domains: ["reddit.com"]
  },
  {
    id: "youtube",
    label: "YouTube",
    service: "YouTube",
    loginUrl: "https://www.youtube.com/signin",
    domains: ["youtube.com"]
  },
  {
    id: "amazon",
    label: "Amazon",
    service: "Amazon",
    loginUrl: "https://www.amazon.com/ap/signin",
    domains: ["amazon.com"]
  },
  {
    id: "shopify",
    label: "Shopify",
    service: "Shopify",
    loginUrl: "https://accounts.shopify.com/store-login",
    domains: ["accounts.shopify.com", "shopify.com"]
  },
  {
    id: "stripe",
    label: "Stripe",
    service: "Stripe",
    loginUrl: "https://dashboard.stripe.com/login",
    domains: ["dashboard.stripe.com", "stripe.com"]
  }
];

export function resolveConnectAccountWebsite(
  value: string,
  examples: ConnectAccountWebsiteExample[] = accountLoginExamples
): ConnectAccountWebsiteResolution | null {
  const url = normalizeConnectAccountUrl(value);

  if (!url) {
    return null;
  }

  const primaryDomain = normalizeConnectAccountDomain(url.hostname);
  if (!primaryDomain) {
    return null;
  }

  const example = findMatchingExample(primaryDomain, examples);
  const serviceName = example?.service ?? formatConnectAccountServiceName(primaryDomain);
  const serviceId = example?.id ?? (slugifyConnectAccountValue(primaryDomain) || "website");

  return {
    serviceId,
    serviceName,
    loginUrl: url.toString(),
    primaryDomain,
    label: `${slugifyConnectAccountValue(serviceName) || serviceId}-login`
  };
}

function normalizeConnectAccountUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    if (!normalizeConnectAccountDomain(url.hostname)) {
      return null;
    }

    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function normalizeConnectAccountDomain(value: string) {
  const hostname = value.trim().toLowerCase().replace(/^www\./, "");

  if (!hostname || hostname === "localhost" || !hostname.includes(".")) {
    return null;
  }

  return /^[a-z0-9.-]+$/.test(hostname) ? hostname : null;
}

function findMatchingExample(domain: string, examples: ConnectAccountWebsiteExample[]) {
  return examples.find((example) => {
    return example.domains.some((candidate) => {
      const normalized = normalizeConnectAccountDomain(candidate);
      return normalized === domain || (normalized ? domain.endsWith(`.${normalized}`) : false);
    });
  }) ?? null;
}

function formatConnectAccountServiceName(domain: string) {
  const [name = domain] = domain.split(".");
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ") || "Website";
}

function slugifyConnectAccountValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
