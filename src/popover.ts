/**
 * One shared popover for any element with a `data-popover` attribute.
 * Tap or click toggles it (works on touch); with a mouse it also opens on
 * hover. Clicking pins it open until you click elsewhere or press Escape.
 */
export type PopoverContent = (id: string) => Node;

const HOVER_CLOSE_DELAY_MS = 150;

export function setupPopovers(content: PopoverContent): {
  refresh: (rerender?: (id: string) => boolean) => void;
  reposition: () => void;
} {
  const el = document.createElement('div');
  el.className = 'popover';
  el.setAttribute('role', 'dialog');
  el.hidden = true;
  document.body.append(el);

  let anchor: HTMLElement | null = null;
  let pinned = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  const triggerOf = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLElement>('[data-popover]') : null;

  function position(): void {
    if (!anchor) return;
    const margin = 8;
    const a = anchor.getBoundingClientRect();
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const left = Math.min(Math.max(margin, a.left + a.width / 2 - width / 2), window.innerWidth - width - margin);
    const below = a.bottom + margin;
    const top = below + height > window.innerHeight - margin && a.top - height - margin > margin ? a.top - height - margin : below;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function open(trigger: HTMLElement, pin: boolean): void {
    clearTimeout(closeTimer);
    if (anchor !== trigger) {
      anchor?.setAttribute('aria-expanded', 'false');
      anchor = trigger;
      anchor.setAttribute('aria-expanded', 'true');
      el.replaceChildren(content(trigger.dataset.popover!));
    }
    pinned ||= pin;
    el.hidden = false;
    position();
  }

  function close(): void {
    clearTimeout(closeTimer);
    anchor?.setAttribute('aria-expanded', 'false');
    anchor = null;
    pinned = false;
    el.hidden = true;
  }

  document.addEventListener('click', (e) => {
    const trigger = triggerOf(e.target);
    if (trigger) {
      if (trigger === anchor && pinned) close();
      else open(trigger, true);
    } else if (!el.contains(e.target as Node)) {
      close();
    }
  });

  // Hover only for real mice, so a tap doesn't open-then-immediately-toggle.
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const trigger = triggerOf(e.target);
    if (trigger && !pinned) open(trigger, false);
    else if (trigger || el.contains(e.target as Node)) clearTimeout(closeTimer);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'mouse' || pinned || !anchor) return;
    const to = e.relatedTarget as Node | null;
    if (to && (anchor.contains(to) || el.contains(to))) return;
    closeTimer = setTimeout(close, HOVER_CLOSE_DELAY_MS);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && anchor) close();
  });
  window.addEventListener('resize', close);
  window.addEventListener('scroll', position, true);

  return {
    /** Call after the open popover's content changes size (e.g. async content arrived). */
    reposition: position,
    /** Closes the popover if its trigger was removed; otherwise re-renders it if `rerender` says so. */
    refresh(rerender = () => true) {
      if (!anchor) return;
      if (!anchor.isConnected) {
        close();
        return;
      }
      if (!rerender(anchor.dataset.popover!)) return;
      el.replaceChildren(content(anchor.dataset.popover!));
      position();
    },
  };
}
