"use client";

import { Component, Fragment, type ReactNode } from "react";

/**
 * Recovers from DOM corruption caused by browser auto-translation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THE PROBLEM
 *
 *  Google Translate (and Edge's translator, and several extensions) rewrite
 *  the page by replacing every text node with a <font> element wrapping the
 *  translated text. React does not know this happened — its fiber tree still
 *  points at the original text nodes.
 *
 *  The next time React updates that subtree it calls something like
 *  `parent.insertBefore(newNode, referenceNode)`, where `referenceNode` is a
 *  text node the translator removed. The browser throws:
 *
 *      NotFoundError: Failed to execute 'insertBefore' on 'Node':
 *      The node before which the new node is to be inserted
 *      is not a child of this node.
 *
 *  This is a long-standing React limitation, not a bug in our code, and there
 *  is no way to stop the translator mutating the DOM.
 *
 *  THE FIX — AND WHY IT IS TWO-PHASE
 *
 *  A first attempt bumped a remount key straight from componentDidCatch while
 *  still rendering `children`. That does not reliably work: React has already
 *  marked the failed subtree, and re-rendering the same children in the same
 *  commit can throw again before the new key takes effect.
 *
 *  So recovery happens in two phases:
 *
 *    1. Render `null`. React fully unmounts the corrupted subtree and clears
 *       the DOM under it — including everything the translator rewrote.
 *    2. On the next tick, bump the key and render children again. They mount
 *       into clean DOM, so reconciliation has real nodes to work against.
 *
 *  Anything that is not a translation-induced DOM error is re-thrown, so real
 *  bugs still reach app/error.tsx and stay visible.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * The three DOM operations React performs during commit that a mutated tree
 * can invalidate. `NotFoundError` on any of them means the node React expected
 * is no longer where it left it.
 */
function isTranslationDomError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message ?? "";
  const isMutationCall =
    message.includes("insertBefore") ||
    message.includes("removeChild") ||
    message.includes("appendChild");

  return (
    (error.name === "NotFoundError" || error.name === "HierarchyRequestError") && isMutationCall
  );
}

/**
 * Recovery budget.
 *
 * Occasional recoveries are expected and fine — the translator re-translates
 * after every remount, so a busy page can legitimately need several over a
 * session. What must not happen is a tight loop, which would pin the CPU and
 * be worse than the crash we set out to fix.
 *
 * So the budget resets once the page has been stable for a while: many
 * recoveries spread over minutes are fine, five inside ten seconds are not.
 */
const MAX_BURST = 5;
const STABLE_AFTER_MS = 10_000;

interface Props {
  children: ReactNode;
}

interface State {
  remountKey: number;
  /** True between the unmount and the remount. */
  recovering: boolean;
  burst: number;
  lastRecoveryAt: number;
  /** A non-translation error, held so `render` can re-throw it upward. */
  fatal: unknown;
}

export class TranslationSafeBoundary extends Component<Props, State> {
  state: State = {
    remountKey: 0,
    recovering: false,
    burst: 0,
    lastRecoveryAt: 0,
    fatal: null,
  };

  private timer: number | null = null;

  static getDerivedStateFromError(error: unknown): Partial<State> | null {
    // Phase 1: stop rendering children so React tears the bad subtree down.
    if (isTranslationDomError(error)) return { recovering: true };
    return { fatal: error };
  }

  componentDidCatch(error: unknown) {
    if (!isTranslationDomError(error)) return;

    // Phase 2, next tick — after React has finished unmounting.
    this.timer = window.setTimeout(() => {
      this.setState((prev) => {
        const now = Date.now();
        const burst = now - prev.lastRecoveryAt > STABLE_AFTER_MS ? 1 : prev.burst + 1;

        if (burst > MAX_BURST) {
          // Remounting is not helping, so this is our bug, not the
          // translator's. Let it surface.
          return { ...prev, recovering: false, fatal: error };
        }

        if (process.env.NODE_ENV === "development") {
          console.warn(
            "[TranslationSafeBoundary] Recovered from a DOM error caused by browser auto-translation. Remounting.",
          );
        }

        return {
          ...prev,
          recovering: false,
          remountKey: prev.remountKey + 1,
          burst,
          lastRecoveryAt: now,
        };
      });
    }, 0);
  }

  componentWillUnmount() {
    if (this.timer !== null) window.clearTimeout(this.timer);
  }

  render() {
    // Re-throw so app/error.tsx handles it as it normally would.
    if (this.state.fatal) throw this.state.fatal;

    // Phase 1: render nothing, so the corrupted DOM is torn down completely.
    if (this.state.recovering) return null;

    return <Fragment key={this.state.remountKey}>{this.props.children}</Fragment>;
  }
}
