export function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function containsAny(text: string, keywords: string[]): boolean {
  const n = normalize(text);
  return keywords.some((k) => n.includes(normalize(k)));
}

export function countMatches(text: string, keywords: string[]): number {
  const n = normalize(text);
  const seen = new Set<string>();
  for (const k of keywords) {
    const nk = normalize(k);
    if (nk && n.includes(nk)) seen.add(nk);
  }
  return seen.size;
}
