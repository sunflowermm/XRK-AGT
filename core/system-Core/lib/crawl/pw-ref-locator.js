/** OpenClaw refLocator 移植 — role / aria / ax ref + frame scope */
import { parseRoleRef } from './pw-role-snapshot.js';
import {
  AX_REF_PATTERN,
  BROWSER_REF_MARKER_ATTRIBUTE,
  ensurePageState,
  getPageState
} from './pw-page-state.js';

/**
 * @param {import('playwright').Page} page
 * @param {string} ref
 */
export function refLocator(page, ref) {
  const normalized = ref.startsWith('@')
    ? ref.slice(1)
    : ref.startsWith('ref=')
      ? ref.slice(4)
      : ref;

  if (/^e\d+$/i.test(normalized)) {
    const state = getPageState(page) ?? ensurePageState(page);
    if (state.roleRefsMode === 'aria') {
      const scope = state.roleRefsFrameSelector
        ? page.frameLocator(state.roleRefsFrameSelector)
        : page;
      return scope.locator(`aria-ref=${normalized}`);
    }
    const info = state.roleRefs?.[normalized];
    if (!info) {
      throw new Error(
        `Unknown ref "${normalized}". Run a new snapshot and use a ref from that snapshot.`
      );
    }
    const scope = state.roleRefsFrameSelector
      ? page.frameLocator(state.roleRefsFrameSelector)
      : page;
    const locator = info.name
      ? scope.getByRole(/** @type {any} */ (info.role), { name: info.name, exact: true })
      : scope.getByRole(/** @type {any} */ (info.role));
    return info.nth !== undefined ? locator.nth(info.nth) : locator;
  }

  if (AX_REF_PATTERN.test(normalized)) {
    const state = getPageState(page) ?? ensurePageState(page);
    const info = state.roleRefs?.[normalized];
    if (!info) {
      throw new Error(
        `Unknown ref "${normalized}". Run a new snapshot and use a ref from that snapshot.`
      );
    }
    const scope = state.roleRefsFrameSelector
      ? page.frameLocator(state.roleRefsFrameSelector)
      : page;
    if (info.domMarker) {
      return scope.locator(`[${BROWSER_REF_MARKER_ATTRIBUTE}="${normalized}"]`);
    }
    const locator = info.name
      ? scope.getByRole(/** @type {any} */ (info.role), { name: info.name, exact: true })
      : scope.getByRole(/** @type {any} */ (info.role));
    return info.nth !== undefined ? locator.nth(info.nth) : locator;
  }

  return page.locator(`aria-ref=${normalized}`);
}

/**
 * @param {{ ref?: string, selector?: string }} target
 * @param {import('playwright').Page} page
 */
export function resolveInteractionTarget(target, page) {
  const refRaw = typeof target.ref === 'string' ? target.ref.trim() : '';
  if (refRaw) {
    const parsed = parseRoleRef(refRaw);
    if (!parsed) throw new Error(`Invalid ref: ${refRaw}`);
    return { kind: 'ref', ref: parsed, locator: refLocator(page, parsed) };
  }
  const selector = typeof target.selector === 'string' ? target.selector.trim() : '';
  if (selector) {
    return { kind: 'selector', selector, locator: page.locator(selector).first() };
  }
  throw new Error('ref 或 selector 必填其一');
}
