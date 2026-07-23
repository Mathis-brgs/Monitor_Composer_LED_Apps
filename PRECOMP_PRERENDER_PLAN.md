# Plan — Précompositions & Prérendus

Plan d'implémentation. Cases à cocher au fil de l'eau. Rédigé après cartographie de l'archi
existante (voir `Annexe A` pour les ancrages code exacts).

## 0. Objectif

Deux features couplées, qui partagent la même machinerie « une sous-composition avec sa
propre timeline, rendue dans une RenderTarget, réinjectée comme un calque du parent » :

- **Précomposition** (façon groupe/précomp After Effects) : un ensemble de calques imbriqués
  qui se comporte comme **un seul calque** dans son parent, avec **sa propre timeline interne**.
  On peut « entrer » dedans (double-clic) pour éditer sa séquence.
- **Prérendu** : on crée une **scène 3D (caméra + objets)**, on la rend dans une **RenderTarget**,
  et on utilise la **texture** comme source vidéo appliquée sur les LED. Chaque prérendu a **sa
  propre timeline / animation interne**.

Le point commun (et la difficulté centrale demandée) : **la gestion de la séquence visible**.
La timeline doit pouvoir « entrer » dans une précomp / un prérendu et afficher SA séquence,
avec sa durée et son playhead locaux.

## 1. Contrainte structurante (état actuel)

- **Une seule `Composition` globale** (`domain/Composition.ts`) + **un seul `Clock` global**
  (durée unique). Tracks keyées `{layerId, channel}`, à plat sur tout l'arbre.
- **Les groupes sont des scopes de navigation** : le moteur (`Editor._push`) ne rend que
  `_activeGroup().children`. Aucun compositing hiérarchique parent←enfant aujourd'hui.
- **Moteur Three.js r0.180 + WebGPU** : `LayerStack` empile des quads (`build(ctx): TSLNode`)
  → `RenderTarget` 128×128. `CompositePass` = patron `setRenderTarget → render → setRenderTarget(null)`,
  directement réutilisable pour rendre une sous-scène dans une RT.
- **Le « 3D » actuel est du raster CPU** (`Scene3DLayer` → DataTexture), pas un rendu GPU caméra.
  → Le prérendu introduit un **vrai chemin scène 3D → RT** (nouveau ; c'est la partie la plus neuve).

## 2. Décision d'architecture centrale (À CONFIRMER avant Phase 1)

Pour donner à chaque précomp/prérendu **sa propre timeline**, il faut sortir du modèle
« une composition + une horloge globales ». Deux options :

### Option A — `Composition` comme entité imbricable de 1er ordre (RECOMMANDÉE)
Le projet détient **plusieurs compositions** ; chacune a sa durée, ses tracks, son arbre.
Un calque `precomp` **référence** une composition par id et la rend comme un calque.
- + Modèle AE fidèle : durée/fps propres, réutilisation (instancier 2× la même comp), remap temporel.
- + Généralise proprement au prérendu (une comp `kind:"prerender"` avec un producteur 3D).
- + Réutilise les coutures existantes : indirection `editor.getComposition()`, navigation
  `enter/exitGroup`, rendu piloté par `_activeGroup()`.
- − **Refactor réel** : Animator (tracks par comp + évaluateur récursif), Clock (durée par comp
  + mapping temporel), sérialisation (`composition` → `compositions` + migration).

### Option B — Groupes rendus en RT + horloge locale par groupe (plus léger)
Garder la composition globale ; rendre chaque groupe dans une RT et lui donner une durée /
remap locale. Tracks restent globales (keyées layerId, unique).
- + Beaucoup moins de churn de sérialisation ; réutilise l'arbre existant.
- − Pas de vraie réutilisation/instanciation de comp ; le « temps imbriqué » n'est qu'une fenêtre
  dans le frame global → diverge de la mécanique AE que tu décris ; se paie plus tard.

**Recommandation : Option A.** Le refactor est le coût d'entrée honnête pour des timelines
imbriquées réelles ; Option B économise à court terme mais bloque réutilisation + remap.

## 3. Modèle de données cible (Option A)

```ts
// domain/Composition.ts — Composition devient une unité nommée, autonome, imbricable
interface Composition {
  id: string;
  name: string;
  kind: "main" | "precomp" | "prerender";
  durationFrames: number;        // durée propre
  fps?: number;                  // fps propre (défaut = projet)
  root: GroupLayer;              // arbre de calques propre
  tracks: Track[];               // animation propre
  scene?: PrerenderScene;        // prérendu seulement (caméra + réglages 3D)
}

interface PrerenderScene {
  camera: { kind: "perspective" | "orthographic"; fov?: number;
            position: Vec3; target: Vec3; near: number; far: number };
  background: RGB;
  resolution?: { w: number; h: number };   // défaut = fixture (128×128)
}

// domain/Layer.ts — nouveau type : instance de composition (calque du parent)
interface PrecompLayer extends LayerBase {
  type: "precomp";
  compId: string;                // composition jouée (kind precomp OU prerender)
  timeOffset: number;            // frame local de la comp à timelineIn de l'instance
  speed: number;                 // étirement temporel (1 = 1:1)
  // v2 : timeRemap?: Track      // remap temporel keyframé (AE)
}
// Layer = ... | PrecompLayer  (ajouter à l'union Layer.ts:112)

// domain/Project.ts
interface Project {
  config: ProjectConfig;
  compositions: Record<string, Composition>;   // remplace `composition`
  mainCompId: string;
  objects: SceneObject[];
}
// Navigation (activeCompId, breadcrumb, groupId, selectedId) = état éditeur, hors modèle pur.
```

Décision de modélisation : **précomp et prérendu = même mécanisme** (instance → RT → calque),
distingués par `Composition.kind`. Deux commandes UI distinctes, un seul chemin de rendu.

## 4. Phases (le TODO)

### Phase 1 — Modèle de données + sérialisation + migration  — FAIT (branche feat/timeline-keyframes)
But : le nouveau modèle compile et charge/sauve, sans changement de rendu (main = comp existante).
- [x] `domain/Composition.ts` : `Composition` = entité `id/name/kind/durationFrames/fps?/root/tracks/scene?` + `PrerenderScene`, `CompKind` ; helpers `makeComposition`, `findComposition`, `isComposition` (garde entité), `hasTracks` (garde ancien format), `DEFAULT_DURATION_FRAMES` ; primitives d'anim conservées. `EMPTY_COMPOSITION` supprimé.
- [x] `domain/Layer.ts` : `PrecompLayer { type:"precomp"; compId; timeOffset; speed }` ajouté à l'union + `makePrecomp(...)`. Frontière opaque native (pas de `children` → `findLayer`/`findParent` ne descendent pas). `layer-display.ts` : `case "precomp"`.
- [x] `domain/Project.ts` : `composition` → `compositions: Record<id,Composition>` + `mainCompId` + `mainComposition(p)`. `deserializeProject` : nouveau format + **migration** ancien `{composition, document}` → comp `main`.
- [x] Bridge sans casser l'app : `Animator._comp` init = entité vide ; `app.ts` load/save/bootstrap via `mainComposition` (invariant `animator._comp === compositions[mainCompId]` ; root partagé avec le document éditeur). Bonus : `durationFrames` désormais persistée (Clock).
- [x] Tests purs (`domain/Project.test.ts`, 5) : createProject, round-trip nouveau format, migration avec/sans document, config par défaut. **69 tests OK, tsc OK, boot runtime 0 erreur.**
- Livrable : projet existant se recharge à l'identique ; `main` = ancienne composition. ATTEINT.

### Phase 2 — Éditeur comp-scoped + navigation (entrer/sortir) + timeline de la comp active  — FAIT
But : créer/entrer/sortir une précomp et la timeline montre SA séquence + son playhead local. Pas encore de compositing imbriqué dans le parent.
- [x] `core/Editor.ts` : détient `_compositions` (partagé avec le projet) + pile `_nav: NavFrame[]`. `_doc` reste la vue active (`_doc.root === activeComp().root` → tout le code d'arbre inchangé). `loadCompositions`, `activeComp`/`activeCompId`/`activeCompDuration`, `compTrail`, `enterComp`/`exitComp`/`exitToComp`/`enterCompOf`. Ancien `loadDocument`/`loadComposition` remplacés.
- [x] Horloge : **injectée** dans l'éditeur (`setClock`) ; `enterComp/exitComp` font `clock.configure({durationFrames})` + `seekFrame` (playhead local sauvé/restauré par niveau). Pas de modif de `Clock.ts` (API `configure`/`seekFrame` suffisantes).
- [x] `Editor.precomposeSelection()` : déplace le calque sélectionné (+ sous-arbre) dans une nouvelle comp, le remplace par un `PrecompLayer`, **repartitionne les tracks** via `partitionTracks(collectSubtreeIds(sel))` (helpers purs du domaine, testés).
- [x] `Editor.addPrecomp()` / `addPrerender()` : créent la comp (kind precomp/prerender + `defaultPrerenderScene`) + l'instance sélectionnée. Numérotation cohérente (id d'instance `${compId}-inst`).
- [x] Seed déplacé dans le domaine (`createSeededProject`) → source unique partagée éditeur↔projet ; `main.ts`/`app.ts` recâblés (`setClock` + `loadCompositions`) ; save/load via le jeu de comps partagé.
- [x] Outliner : **breadcrumb** de comps (segments cliquables → `exitToComp`) + retour intelligent (groupe puis comp) + double-clic sur un row `precomp` → `enterComp`. Style `comp-trail` (shell.css).
- [x] Timeline : rows/durée/règle depuis la comp active (déjà via `editor.children`/`getComposition`) ; double-clic sur le nom d'un row `precomp` → `enterCompOf`.
- [x] `timeline-properties.ts` : un `precomp` tombe dans le `default` → `[OPACITY]` (transform/timeRemap viendront en Phase 3/5).
- [x] Vérifs : **71 tests / 0 fail** (dont `partitionTracks`, `collectSubtreeIds`), tsc OK, runtime Playwright : créer précomp (menu), précomposer sélection (calque+track déplacés), entrer/sortir avec fil d'Ariane, **0 erreur console**.
- **Note (attendu, différé en Phase 3)** : une instance de précomp ne rend encore RIEN sur le mur du parent (le compositing imbriqué RT arrive en Phase 3) ; on voit son contenu en entrant dedans. Idem : pendant qu'on édite une précomp, le mur affiche cette précomp (viewer = comp active).
- Livrable : précomposer une sélection, entrer/sortir, éditer la timeline interne. ATTEINT.

### Phase 3 — Rendu imbriqué (précomp → RT → calque du parent) + mapping temporel  — FAIT
But : une instance de précomp affiche réellement la sortie de sa comp, composée dans le parent, au bon temps.
- [x] `engine/layers/NestedTexture.layer.ts` : `NestedTextureLayer` échantillonne `childRT.texture` (`build = texture(tex, uv())`) ; `LAYER_ID.NESTED` + registre `createLayer`.
- [x] Un `LayerStack` + `RenderTarget` + `Scene3DLayer` **par comp imbriquée** (`Editor._subs: Map<compId, SubRenderer>`, créés à la demande).
- [x] Graphe de rendu récursif (`Editor._syncNested`/`_updateSub`) : depuis les instances `precomp` du groupe actif, rend chaque comp enfant dans sa RT **au frame local mappé**, injecte `childRT.texture` via `NestedTextureLayer` dans le parent. **Enfants avant parents** (`ordered` plus profond d'abord) ; `Engine.setNested` rend les sous-RT avant la comp active dans `update`. **Garde de cycle** par `compId`.
- [x] Une comp imbriquée rend **tout son arbre** (groupes traversés via `_renderablesIn`) ; l'instance `precomp` est la frontière de rendu. (La comp ACTIVE garde le scope « groupe actif » — inchangé, moins de risque.)
- [x] Mapping temporel pur `precompChildFrame`/`precompActiveAt` (offset + vitesse + fenêtre `clip`, clampé) — **testé**.
- [x] Évaluateur d'animation par comp : `Animator.evaluateAt(tracks, frame)` ; `_applyChannel`/`_readChannel` résolvent le calque cross-comp (`_findAnywhere`) ; opacité d'instance animée → `sub.nested.opacity`.
- [x] Perf (1re passe) : RT/stack par comp mis en cache ; rebuild du stack seulement si la signature du set actif change (`_compSigIn`) ; uniforms/temps mis à jour chaque frame.
- [x] Vérifs : tsc OK · **73 tests / 0 fail** (dont mapping temporel) · runtime : précomposer le shader Plasma → il s'affiche sur le mur **via la RT de la précomp** ; couper sa visibilité → le plasma disparaît (attribution confirmée) ; **0 erreur console**.
- **Différé (noté)** : (a) **réutilisation/multi-instances** d'une même comp — la garde par `compId` ne la rend qu'une fois (Phase 5) ; (b) fills image/vidéo sur shapes imbriquées → fallback (décodage câblé côté édition active) ; (c) shapes imbriquées re-rasterisées CPU chaque frame (optim Phase 6).
- Livrable : une précomp animée jouée dans la comp parente, décalée/étirée. ATTEINT.

### Phase 4 — Prérendu : producteur scène 3D → RT  — FAIT (branche feat/timeline-keyframes)
But : une comp `kind:"prerender"` rend une vraie scène 3D (caméra + objets) dans sa RT, consommée comme un prérendu.
- [x] `engine/Prerender3DScene.ts` : `Scene` Three.js + caméra (perspective/ortho, **depth buffer**) + meshes éclairés (`MeshStandardNodeMaterial` + `DirectionalLight`/`AmbientLight`) construits depuis les shapes de la comp (`unitGeometry(ShapeKind)` — même convention que l'éditeur 3D et le collider CPU ; couleur depuis `Fill`). Rebuild au changement de structure (kinds), transform+couleur mis à jour chaque frame. Rendu via `renderer.render(scene, camera)` → RT propre.
- [x] Interface commune `NestedSource {scene,camera,target}` (Engine.ts) : `LayerStack` (précomp 2D) ET `Prerender3DScene` (prérendu 3D) la satisfont → `Engine.setNested` les rend uniformément. Côté parent, un prérendu = une texture via `NestedTextureLayer`, indistinct d'une précomp. `Editor._updateSub` branche sur `comp.kind` → `_updatePrerenderSub`.
- [x] Animation interne : transforms des objets pilotés par les tracks de la comp (réutilise `_animator.evaluateAt` + `_shapeInputsIn`). **Différé** : animation de la caméra par keyframes (statique/éditable en v1).
- [x] Réglages `PrerenderScene` dans l'Inspector (instance prérendu sélectionnée) : caméra type persp/ortho, FOV, position, cible, near/far, fond. Setters `Editor.setPrerenderCamera`/`setPrerenderBackground`/`setPrecompTiming` (éditent la COMPOSITION référencée, snapshot undo via `_emit`).
- [x] Viewer : (a) le **mur** (compositor) affiche la sortie caméra quand la comp active est un prérendu (`_pushPrerenderActive`/`_syncNested`, pas de pile LED) ; (b) l'**éditeur 3D** masque la grille LED + son cadre et affiche le **frustum de la caméra** (`CameraHelper`) quand on édite un prérendu ; retour au main → mur rétabli.
- **Sémantique** : le fond du prérendu est **opaque** (source vidéo plein-cadre) → une instance couvre les couches en dessous, comme une vidéo. **Différé** : caméra animée, ortho affinée, multi-instances, précomp imbriquée DANS un prérendu (scène 3D pure en v1).
- **Vérifs** : tsc OK · **73 tests / 0 fail** · Playwright : prérendu → sphère éclairée rendue par caméra sur le mur (dégradé d'éclairage confirmé vs disque plat CPU) ; instance composite dans le main ; édition du fond → mur plein-cadre ; éditeur 3D sans mur LED + frustum ; **0 erreur console**.
- Livrable : un objet 3D animé, rendu par caméra, appliqué comme source sur le mur LED. ATTEINT.

### Phase 5 — Finitions timeline / UX séquence
- [ ] Remap temporel keyframé (`timeRemap: Track`) sur l'instance (courbe façon AE).
- [ ] Réglages de comp : durée/fps/résolution éditables ; propagation aux instances.
- [ ] Réutilisation : instancier la même comp plusieurs fois (compteur d'usages, suppression sûre).
- [ ] Vignettes de comp (rendu RT réduit) dans Outliner/rows.
- [ ] Overlay « comp active » dans le viewer + navigation clavier (échap = sortir).

### Phase 6 — Perf, robustesse, persistance, tests
- [ ] Garde de récursion/cycle entre comps (A→B→A) : détection à la création d'instance + au rendu.
- [ ] GC des comps orphelines (aucune instance) — ou conservation explicite (bibliothèque de comps).
- [ ] Budget RT : nombre max de comps rendues/frame, LRU des RT inactives, tailles adaptatives.
- [ ] Y-flip RT à vérifier (aperçu vs sortie eHuB — cf. note EhubOutput).
- [ ] Sérialisation complète (comps + instances + scene prérendu) round-trip testée.
- [ ] Tests purs : mapping temporel, partition de tracks au precompose, migration, cycle guard.

## 5. Sujets transverses

- **Sérialisation/migration** : point le plus sensible ; garder `deserializeProject` rétro-compatible (détecter l'ancienne forme). Ne jamais committer sans test de round-trip legacy.
- **Perf** : le risque est de rendre N comps × chaque frame. Dirty-tracking par comp + cache RT + gate par signature (déjà en place pour `_push`) sont non négociables.
- **Frontière opaque** : `findLayer`/parcours d'arbre ne doivent PAS traverser une `precomp` (son arbre vit dans SA comp). À vérifier partout où l'arbre est parcouru (parenting, bindings, DMX free-channel scan).
- **Audio** : l'audio d'une précomp — décision à trancher en Phase 2/3 (l'audio se mixe-t-il depuis les comps imbriquées, ou seulement au niveau main ?). Défaut proposé : audio uniquement au niveau `main` en v1 (les comps imbriquées ignorent l'audio au rendu mur, cohérent avec « audio non spatial »).
- **DMX (spot/lyre)** : les fixtures adressent des canaux globaux ; dans une précomp imbriquée leur sens est ambigu. Défaut proposé : DMX seulement dans `main` en v1.

## 6. Décisions à confirmer (avant de coder)

1. **Architecture** : Option A (Composition entité) — recommandée. OK pour le refactor sérialisation + Animator ?
2. **Ordre** : commencer par **précomp** (réutilise le stack 2D existant, pose toute la machinerie de timeline imbriquée) puis **prérendu** (ajoute le producteur 3D par-dessus l'infra éprouvée). Recommandé pour dé-risquer.
3. **v1 scope** : audio + DMX uniquement au niveau `main` (comps imbriquées = visuel pur) ?

## Annexe A — Ancrages code (vérifiés)

- Union `Layer` + helpers arbre : `domain/Layer.ts:112, 274, 315-348`.
- Composition/Track/sampleKeyframes : `domain/Composition.ts:11-47`.
- Projet/sérialisation : `domain/Project.ts:7-43`.
- Rendu = groupe actif : `core/Editor.ts:806 (_activeGroup), 917 (_shapeInputs), 976-1003 (_push), 1005-1012 (_activeSignature)`.
- Indirection timeline : `editor.getComposition()` (Editor) ; `TimelinePanel.tsx:~112 (frame), ~136-171 (rows)`.
- Navigation groupe : `Editor.ts:281-294 (enter/exitGroup)` ; Outliner double-clic.
- Moteur : `engine/Engine.ts (update, _renderer, texture)`, `engine/LayerStack.ts`, `engine/passes.ts:13 (CompositePass = patron RT)`, `engine/layers/Layer.ts:10-55 (LAYER_ID, build)`, `engine/layers/Scene3D.layer.ts:37`, `engine/layers/Video.layer.ts:25`.
- « 3D » = raster CPU : `engine/shapes.ts (rasterizeShapes)`, `Scene3DLayer` ; `Editor3DView`/`SceneObject` = stubs → base à compléter pour le producteur 3D du prérendu.
