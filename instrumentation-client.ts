const hash = window.location.hash ? window.location.hash.slice(1) : "";
const params = new URLSearchParams(hash);
const token = params.get("agentos_token");

if (token) {
  document.cookie = `agentos_api_token=${encodeURIComponent(token)}; Path=/; SameSite=Strict`;
  params.delete("agentos_token");

  const nextHash = params.toString();
  const sanitizedUrl = `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ""}`;
  history.replaceState(null, "", sanitizedUrl);
}

const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const response = await nativeFetch(...args);
  if (response.status === 401 && response.headers.get("x-agentos-auth-required") === "instance") {
    window.dispatchEvent(new Event("agentos:instance-auth-required"));
  }
  return response;
};
