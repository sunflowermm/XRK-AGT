/**
 * Workspace prompt section registry.
 *
 * - Stable ordering by title (call-site sorts).
 * - Async builders are supported.
 * - Intended for optional, pluggable sections (e.g. memory prompt section).
 */

/** @type {Map<string, (ctx: any) => (Promise<{ title: string, body: string } | null | void> | { title: string, body: string } | null | void)>} */
const sectionBuilders = new Map();

export function registerWorkspacePromptSection(name, builder) {
  const key = String(name || '').trim();
  if (!key) return () => {};
  if (typeof builder !== 'function') return () => {};
  sectionBuilders.set(key, builder);
  return () => sectionBuilders.delete(key);
}

export function clearWorkspacePromptSections() {
  sectionBuilders.clear();
}

export async function buildWorkspacePromptSections(ctx) {
  const out = [];
  for (const [, builder] of sectionBuilders.entries()) {
    try {
      const ret = await builder(ctx);
      if (!ret?.title || !ret?.body) continue;
      out.push({ title: String(ret.title), body: String(ret.body) });
    } catch {
      // ignore single builder failure
    }
  }
  return out;
}

