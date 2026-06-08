export type AccountLogoInput = {
  serviceId?: string | null;
  serviceName?: string | null;
  primaryDomain?: string | null;
};

const accountIconKeys: Record<string, string> = {
  "product-hunt": "siProducthunt",
  "producthunt.com": "siProducthunt",
  gmail: "siGmail",
  "mail.google.com": "siGmail",
  "accounts.google.com": "siGmail",
  linkedin: "siLinkedin",
  "linkedin.com": "siLinkedin",
  "x-twitter": "siX",
  x: "siX",
  "x.com": "siX",
  "twitter.com": "siX",
  github: "siGithub",
  "github.com": "siGithub",
  discord: "siDiscord",
  "discord.com": "siDiscord",
  telegram: "siTelegram",
  "telegram.org": "siTelegram",
  "web.telegram.org": "siTelegram"
};

export function resolveAccountFaviconSources(input: AccountLogoInput) {
  const domain = resolveAccountLogoDomain(input);

  if (!domain) {
    return [];
  }

  return [
    `https://${domain}/favicon.ico`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`
  ];
}

export function resolveAccountLogoDomain(input: AccountLogoInput) {
  const candidates = [input.primaryDomain, input.serviceId, input.serviceName];

  for (const candidate of candidates) {
    const domain = normalizeAccountLogoDomain(candidate);

    if (domain) {
      return domain;
    }
  }

  return null;
}

export function resolveAccountIconKey(input: AccountLogoInput) {
  const candidates = [
    normalizeIconLookupKey(input.serviceId),
    normalizeIconLookupKey(input.primaryDomain),
    normalizeIconLookupKey(input.serviceName)
  ].filter((entry): entry is string => Boolean(entry));

  for (const candidate of candidates) {
    const direct = accountIconKeys[candidate];
    if (direct) {
      return direct;
    }

    const withoutWww = candidate.replace(/^www\./, "");
    if (accountIconKeys[withoutWww]) {
      return accountIconKeys[withoutWww];
    }
  }

  return null;
}

function normalizeAccountLogoDomain(value?: string | null) {
  const trimmed = value?.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  const candidate = trimmed.includes("://") ? trimmed : `https://${trimmed}`;

  try {
    const hostname = new URL(candidate).hostname.replace(/^www\./, "");

    if (!hostname || hostname === "localhost" || !hostname.includes(".")) {
      return null;
    }

    if (!/^[a-z0-9.-]+$/.test(hostname)) {
      return null;
    }

    return hostname;
  } catch {
    return null;
  }
}

function normalizeIconLookupKey(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}
