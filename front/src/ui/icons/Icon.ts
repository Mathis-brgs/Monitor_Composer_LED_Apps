/**
 * Composant Icône : charge tous les SVG de ce dossier (build-time via Vite import.meta.glob).
 * Pour ajouter/remplacer une icône, il suffit de déposer un `.svg` ici — dispo par son nom de fichier.
 * Les SVG utilisent `currentColor` → l'icône hérite de la couleur CSS du parent ; la taille via `--icon-size`.
 */

const modules = import.meta.glob("./*.svg", {
  query: "?raw",
  eager: true,
  import: "default",
}) as Record<string, string>;

const REGISTRY: Record<string, string> = {};
for (const path in modules) {
  const name = path.slice(path.lastIndexOf("/") + 1, -".svg".length);
  REGISTRY[name] = modules[path];
}

export type IconName = string;

/** Noms d'icônes disponibles dans le dossier. */
export function iconNames(): string[] {
  return Object.keys(REGISTRY).sort();
}

/** SVG brut d'une icône (chaîne vide si absente). */
export function iconMarkup(name: IconName): string {
  return REGISTRY[name] ?? "";
}

/** Crée un élément icône (span > svg). `size` en px surcharge --icon-size. */
export function createIcon(name: IconName, opts: { size?: number; className?: string } = {}): HTMLElement {
  const el = document.createElement("span");
  el.className = opts.className ? `icon ${opts.className}` : "icon";
  const svg = REGISTRY[name];
  if (svg) el.innerHTML = svg;
  else el.dataset.iconMissing = name;
  if (opts.size !== undefined) el.style.setProperty("--icon-size", `${opts.size}px`);
  return el;
}
