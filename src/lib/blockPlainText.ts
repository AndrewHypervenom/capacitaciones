type Lang = 'es' | 'en' | 'pt'

/** Texto de un bloque para mandárselo a la IA: toma el idioma pedido de cada campo multilingüe. */
export function blockPlainText(value: unknown, lang: Lang): string {
  const out: string[] = []
  const walk = (v: unknown, key?: string) => {
    if (typeof v === 'string') {
      if (key && /url|id$|^id|color|kind|type|lang|align|size/i.test(key)) return
      out.push(v)
      return
    }
    if (Array.isArray(v)) { v.forEach((x) => walk(x)); return }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (typeof o.es === 'string' && typeof o.en === 'string' && typeof o.pt === 'string') {
        const t = (o[lang] as string)?.trim() || (o.es as string).trim() || (o.en as string).trim() || (o.pt as string).trim()
        if (t) out.push(t)
        return
      }
      for (const [k, x] of Object.entries(o)) walk(x, k)
    }
  }
  walk(value)
  return out.join(' · ')
}
