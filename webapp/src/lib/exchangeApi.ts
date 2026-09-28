/** Upbit / Binance endpoints stay suspended until CRYPTO_EXCHANGE_API_ENABLED=true. */
const EXCHANGE_HOSTS = /(^|\.)(upbit\.com|binance\.com|binance\.vision)$/i;

export const EXCHANGE_API_SUSPENDED_MSG = "업비트·바이낸스 API 사용 중단 중";

export function exchangeApiEnabled(): boolean {
  return process.env.CRYPTO_EXCHANGE_API_ENABLED === "true";
}

export function isBlockedExchangeUrl(url: string): boolean {
  if (exchangeApiEnabled()) return false;
  try {
    return EXCHANGE_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}
