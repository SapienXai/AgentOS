(() => {
  const hash = window.location.hash ? window.location.hash.slice(1) : "";
  const params = new URLSearchParams(hash);
  const token = params.get("agentos_token");

  if (!token) {
    return;
  }

  document.cookie = `agentos_api_token=${encodeURIComponent(token)}; Path=/; SameSite=Strict`;
  params.delete("agentos_token");

  const nextHash = params.toString();
  const sanitizedUrl = `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ""}`;
  history.replaceState(null, "", sanitizedUrl);
})();
