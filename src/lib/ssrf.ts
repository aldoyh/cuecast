const PRIVATE_HOST =
  /^(localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|\[::1\]|::1$)/i;

export function normalizeFeedUrl(input: string): URL {
  const trimmed = input.trim();
  const withScheme = trimmed.startsWith("webcal://")
    ? `https://${trimmed.slice("webcal://".length)}`
    : trimmed;
  const url = new URL(withScheme);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Feed URL must be http(s) or webcal.");
  }
  const host = url.hostname;
  if (PRIVATE_HOST.test(host)) {
    throw new Error("That host cannot be fetched from the scheduler.");
  }
  return url;
}
