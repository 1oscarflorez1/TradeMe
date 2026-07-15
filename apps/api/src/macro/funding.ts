const FAPI_PREMIUM = 'https://fapi.binance.com/fapi/v1/premiumIndex';

interface PremiumIndex {
  lastFundingRate?: string;
}

/** Último funding rate del perpetuo (datos públicos de Binance Futures, sin clave). */
export async function fetchFundingRate(symbol: string, baseUrl = FAPI_PREMIUM): Promise<number> {
  const res = await fetch(`${baseUrl}?symbol=${symbol.toUpperCase()}`);
  if (!res.ok) throw new Error(`Binance premiumIndex ${res.status}`);
  const data = (await res.json()) as PremiumIndex;
  return Number(data.lastFundingRate ?? 0);
}
