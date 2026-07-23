# Review UX / utilisation — liste des problèmes

To-do à plat. `[signalé]` = remonté par Stan. Le reste = trouvé à la review.
Priorité indicative : 🔴 bug bloquant · 🟠 manque important · 🟡 confort.

## Fait — quick wins (batch 1)

- ✅ Flip UV précomp (corrigé + vérifié parent vs intérieur)
- ✅ Fin du highlight orange sur objets non sélectionnés
- ✅ 3 modes de rendu 3D : wireframe / solide (helper sur sélection) / aucun (touche Z + bouton rail)
- ✅ Suppression au clavier globale (Suppr / Retour)
- ✅ Dupliquer un calque (Cmd/Ctrl+D, sous-arbre + tracks)
- ✅ Renommage inline (double-clic sur le nom, Entrée/Échap)
- ✅ Sélection outliner → reflétée dans l'éditeur 3D (shapes : accent + gizmo)

## Bugs à corriger

- 🔴 Prérendu non fonctionnel [signalé] — le type existe mais rien n'est rendu par une caméra ; une comp `prerender` est traitée comme une précomp
- 🔴 Prérendu : pas de caméra par défaut visible/éditable [signalé]
- 🔴 Prérendu : un mur LED apparaît alors qu'il ne devrait pas — c'est la caméra qui filme la scène 3D [signalé]
- 🔴 Précomp : flip vertical des UV dans le parent [signalé] — correct en entrant dans la précomp, retourné une fois composité dans le main
- 🟠 Réutiliser une même comp plusieurs fois : rendue une seule fois (garde de cycle par id)
- 🟠 Supprimer une instance de précomp laisse la composition orpheline (aucun nettoyage)

## Sélection & édition directe

- 🟠 Sélection multiple de calques [signalé] — Maj+clic (plage), Cmd/Ctrl+clic (ajout), rubber-band
- 🟠 Clic droit → menu contextuel sur un calque [signalé] — renommer / supprimer / dupliquer / précomposer / grouper / entrer
- 🟠 Renommage inline [signalé] — double-clic sur le nom, F2, commit sur Entrée/blur (aujourd'hui : seulement via champ "Nom" de l'Inspector)
- 🟠 Suppression au clavier partout [signalé] — Suppr / Retour arrière / Cmd+Suppr (aujourd'hui : seulement dans le viewport 3D)
- 🟡 Dupliquer un calque — Cmd/Ctrl+D
- 🟡 Copier / couper / coller des calques — Cmd+C / X / V
- 🟡 Grouper / dégrouper la sélection — Cmd+G / Cmd+Maj+G
- 🟡 Réordonner la sélection au clavier (monter/descendre dans la pile)

## Raccourcis clavier (à unifier)

- 🟠 Raccourcis d'ajout d'objet dans la scène [signalé] — palette d'ajout (façon Maj+A Blender) ou touches dédiées
- 🟠 Raccourcis des outils de transformation [signalé] — déplacer / pivoter / échelle disponibles et cohérents partout (pas seulement dans un panneau)
- 🟠 Raccourcis incohérents entre panneaux [signalé] — timeline vs éditeur 3D vs outliner ; un même geste doit marcher selon le focus
- 🔴 Annuler / Rétablir — Cmd+Z / Cmd+Maj+Z (à vérifier : semble absent)
- 🟡 Aide-mémoire des raccourcis (overlay `?`)

## Rendu 3D / viewport

- 🟠 Supprimer le highlight orange sur les objets NON sélectionnés [signalé]
- 🟠 3 modes de rendu [signalé] — wireframe · solide sans helpers (sauf l'objet sélectionné) · aucun helper même sélectionné
- 🟠 Sélection auto dans l'éditeur 3D quand on sélectionne un calque [signalé] — pour TOUS les types, pas seulement les shapes
- 🟠 Calques 2D transformables dans l'espace [signalé] — shaders et précomps déplaçables (gizmo, 2 axes) comme les objets
- 🟡 Sélection bidirectionnelle synchronisée outliner ↔ timeline ↔ viewport 3D
- 🟡 Cadrer la sélection (touche F), vue de dessus/face/côté, reset caméra
- 🟡 Distinguer visuellement les types dans le viewport (objet vs shader vs précomp vs fixture)

## Précomposition / Prérendu

- 🟠 Précomp déplaçable/transformable sur 2 axes comme un shader [signalé]
- 🟠 Réglages d'une instance dans l'Inspector — offset temporel, vitesse, remap
- 🟠 Réglages d'une composition — durée, fps, résolution (surtout pour un prérendu)
- 🟠 Réglages caméra d'un prérendu dans l'Inspector — position, cible, FOV, near/far, fond
- 🟡 Icône/indicateur distinguant précomp vs prérendu vs groupe dans l'outliner et la timeline
- 🟡 Vignette (aperçu RT réduit) sur les lignes de précomp/prérendu
- 🟡 « Ouvrir la composition » explicite (bouton) en plus du double-clic
- 🟡 Convertir un groupe en précomp / aplatir une précomp

## Timeline / navigation

- 🟠 Fil d'Ariane des comps aussi dans la timeline (aujourd'hui seulement dans l'outliner)
- 🟠 Clic droit sur les lignes de la timeline — mêmes actions que l'outliner
- 🟡 Playhead local persistant par comp (déjà partiellement : à confirmer au retour)
- 🟡 Aimantation (snap) sur bords de clips / playhead / clés en plus de la grille BPM

## Inspector

- 🟠 Inspector contextuel complet par type de calque (précomp, prérendu, groupe)
- 🟡 Sélection multiple → édition groupée des propriétés communes
- 🟡 Barre de recherche / filtre dans l'outliner quand beaucoup de calques

## Robustesse / feedback

- 🟡 Confirmation avant suppression d'un calque non vide / d'une comp référencée
- 🟡 États vides explicites (composition vide, aucune sélection) avec pistes d'action
- 🟡 Retour visuel sur les actions du menu Composition (toast/surbrillance du résultat)
