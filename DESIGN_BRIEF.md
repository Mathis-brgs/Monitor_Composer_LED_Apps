# Brief à coller pour l'assistant design (Figma)

> Copie tout ce qui suit dans une conversation avec Claude (design / Figma).

---

Tu es mon partenaire design. Je veux que tu **repenses et améliores l'UI** d'une partie de mon logiciel, puis que tu me produises des **maquettes haute-fidélité dans Figma**, cohérentes avec mon design system existant.

## Le produit

**LED Composer** est un logiciel desktop (Electron + WebGPU) de composition visuelle qui pilote un **mur de LED 128×128 RGBW** en temps réel (sortie réseau ~40 Hz). L'ergonomie s'inspire d'**After Effects / Blender / Premiere** : interface **sombre à panneaux**, pensée pour une salle noire. On y compose des calques (shaders procéduraux, objets 3D, vidéos, pistes audio, projecteurs DMX) sur une **timeline avec keyframes**.

## Identité visuelle actuelle (à respecter et sublimer)

- Thème **sombre**, palette « ember » par défaut : fond quasi noir `#0a0908`, panneaux `#141210`, accent **orange** `#ff8a3d`. + 3 palettes alternatives (graphite/vert, cobalt/bleu, signal/rose) et 2 densités (comfort/compact).
- Typo : **JetBrains Mono** (données/labels, souvent en CAPITALES avec letter-spacing) + **Space Grotesk** (titres/wordmark).
- Layout : barre de menus → barre d'onglets d'espaces (**Éditeur 3D / Compositor / Render**) → corps en panneaux (**rail d'outils · Outliner · Viewport · Inspector**) → **timeline** en bas → barre de statut.
- **Un design system existe déjà dans Figma** (tokens en Variables : couleurs 4 modes, dimensions, text/effect styles ; composants : tool-button, outliner-row, inspector-section, slider, field, timeline-track, layer-row…). **Réutilise-le et étends-le** plutôt que de repartir de zéro.

## La feature à (re)designer : précompositions & prérendus (façon After Effects)

On vient d'ajouter deux mécanismes de composition **imbriquée** :

- **Précomposition** : un ensemble de calques regroupé qui se comporte comme **un seul calque**, avec **sa propre timeline interne**. On peut « entrer » dedans (double-clic) pour éditer sa séquence ; un **fil d'Ariane** indique où on se trouve (ex. « Composition / Précomp 01 »). Commande « Précomposer la sélection ».
- **Prérendu** : une **scène 3D (caméra + objets)** rendue hors-champ, dont l'image sert de **source vidéo** appliquée sur les LED. C'est **la caméra** qui définit ce qui est diffusé (pas de mur LED à l'intérieur d'un prérendu).

**État actuel de l'UI (fonctionnel mais brut, à améliorer) :**
- **Outliner** : liste plate des calques du contexte courant (œil · vignette · nom · type · mode de fusion · opacité), fil d'Ariane des comps en haut, un simple bouton « + ».
- **Menu « Composition »** : Précomposer la sélection / Nouvelle précomposition / Nouveau prérendu.
- **Timeline** : pistes du contexte courant, règle temporelle, keyframes.
- **Inspector** : propriétés du calque sélectionné (Transform, Apparence…), très générique.
- **Viewport 3D** : mur en perspective, sélection des objets, gizmos, et 3 modes d'affichage réduits à un bouton « W / S / N ».

## Les problèmes UX à résoudre (cœur du brief)

**Sélection & édition directe**
- Sélection **multiple** de calques (le modèle n'en gère qu'un seul aujourd'hui) — Maj/Cmd-clic, rubber-band.
- **Menu contextuel** au clic droit : renommer, supprimer, dupliquer, précomposer, grouper, entrer.
- Renommage inline, suppression, duplication, copier/coller, grouper/dégrouper.

**Raccourcis clavier**
- Ajout d'objet (palette type « Maj+A »), outils de transformation cohérents, **annuler/rétablir**, aide-mémoire des raccourcis.

**Viewport 3D**
- Un **vrai sélecteur des 3 modes de rendu** (wireframe / solide sans helpers sauf sélection / aucun helper) au lieu d'un bouton cryptique.
- Sélection d'un calque **reflétée** dans le viewport pour **tous** les types (pas seulement les objets).
- Calques 2D (shaders, précomps) **transformables dans l'espace** (gizmo, 2 axes).
- Plus de couleur « highlight » parasite sur les objets non sélectionnés.

**Précomposition / Prérendu**
- Instance de précomp/prérendu **déplaçable/transformable** comme un calque.
- **Réglages d'instance** dans l'Inspector : décalage temporel, vitesse, remap.
- **Réglages de composition** : durée, fps, résolution.
- **Réglages caméra** d'un prérendu : position, cible, FOV, fond ; + sa **vue caméra** (sans mur LED, avec cadre/gizmo caméra).
- **Icônes distinctives** objet / shader / vidéo / précomp / prérendu / groupe, et **vignettes** (aperçu) sur les lignes.
- « Ouvrir la composition » explicite en plus du double-clic.

**Timeline / navigation**
- Fil d'Ariane des comps aussi dans la timeline ; clic droit sur les pistes.

**Inspector / feedback**
- Inspector **contextuel** complet par type de calque ; édition groupée en sélection multiple ; filtre/recherche dans l'Outliner.
- Confirmations avant suppression, états vides explicites, retours visuels sur les actions.

## Ce que j'attends de toi (livrables)

1. Une **direction UX/UI** argumentée pour ces flux (repense l'ergonomie, pas un simple reskin).
2. Des **maquettes haute-fidélité Figma** cohérentes avec le design system (palette ember + tokens + composants existants), pour au minimum :
   - **Outliner enrichi** : sélection multiple, menu contextuel, renommage inline, icônes par type, vignettes, fil d'Ariane.
   - **Inspector contextuel** d'une **précomp** et d'un **prérendu** (réglages d'instance + de comp + caméra).
   - **Viewport 3D** : sélecteur des 3 modes de rendu + **vue caméra du prérendu**.
   - Le geste **« Précomposer la sélection »** et la **navigation entrer/sortir** d'une comp (états + fil d'Ariane).
   - Un **menu contextuel** type + une **palette d'ajout d'objet**.
3. Les **états des composants** (défaut / survol / sélection / édition) et les **raccourcis** annotés.
4. Bonus : un aperçu des **interactions clés** (sélection multiple, clic droit, drag).

## Contraintes

- Desktop **dense**, salle noire : contraste maîtrisé, **pas de blanc pur**, hiérarchie claire, lisible aussi en densité compacte.
- **Respecte les tokens** et la grammaire visuelle ; propose des extensions cohérentes (icônes, couleurs de labels) plutôt que de réinventer.
- Inspire-toi d'**After Effects** (précomps, timeline), **Blender** (viewport, modes, raccourcis), **Premiere** (montage) — sans copier.
- Cible : écran desktop large (≈1520×940), mais pense la **réactivité** des panneaux.
