/**
 * Les tooltips (`[data-tooltip]`) sont positionnées en CSS pur, centrées sous
 * l'élément — sans savoir si ça dépasse du bord de l'écran. Au survol, on
 * mesure la position réelle de l'élément et on bascule l'alignement de sa
 * tooltip via des classes CSS plutôt que de la centrer/mettre en bas sans condition.
 */
const EDGE_MARGIN = 120;
const BOTTOM_MARGIN = 40;
const EDGE_CLASSES = ["tooltip--edge-left", "tooltip--edge-right", "tooltip--edge-top"];

export function installEdgeAwareTooltips(): void {
  let current: HTMLElement | null = null;

  const clear = (): void => {
    current?.classList.remove(...EDGE_CLASSES);
    current = null;
  };

  document.addEventListener(
    "pointerover",
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-tooltip]");
      if (!el || el === current) return;
      clear();
      current = el;
      const r = el.getBoundingClientRect();
      if (r.left < EDGE_MARGIN) el.classList.add("tooltip--edge-left");
      else if (window.innerWidth - r.right < EDGE_MARGIN) el.classList.add("tooltip--edge-right");
      if (window.innerHeight - r.bottom < BOTTOM_MARGIN) el.classList.add("tooltip--edge-top");
    },
    { passive: true },
  );

  document.addEventListener(
    "pointerout",
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-tooltip]");
      if (el === current) clear();
    },
    { passive: true },
  );
}
