import { createSignal, onCleanup, type Accessor } from "solid-js";

/** Store impératif minimal du `core` : notifie ses abonnés, renvoie un désabonnement. */
export interface Observable {
  subscribe(listener: () => void): () => void;
}

/**
 * Pont store impératif (`core`, agnostique) → réactivité Solid. `select()` relit
 * l'état courant à chaque émission. `equals: false` car les stores mutent en place
 * (même référence d'objet) : il faut propager même quand l'identité ne change pas.
 * À appeler dans un scope réactif : `onCleanup` gère le désabonnement (fin de la fuite).
 */
export function fromStore<T>(store: Observable, select: () => T): Accessor<T> {
  const [value, setValue] = createSignal(select(), { equals: false });
  const unsub = store.subscribe(() => setValue(() => select()));
  onCleanup(unsub);
  return value;
}
