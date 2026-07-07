# Architecture — front (logiciel de composition LED, Electron)

> Doc d'équipe. Le front est l'outil de création (**logiciel desktop**, pas une app web) ;
> le routage est en Go (Mathis). Contrat entre les deux : **eHuB**.

## 1. Vue d'ensemble

Le front est un **logiciel desktop** (Electron) de composition (façon montage vidéo/audio) qui
permet de : gérer des **séquences**, **créer des objets** à afficher, et **visualiser le rendu**
(2D et 3D). Il produit un **state RGBW** (une couleur par entité) et l'émet en **eHuB** vers le routage.

```
 renderer (fenêtre Electron)         moteur headless           process principal
 vues : editor / compositor    ──►   couches → RT 128×128  ──►  eHuB ──IPC──► main ──UDP──► Routage Go ──► mur
        preview 2D / preview 3D       → readback → state                    (le "back")     (Mathis)
```

Répartition équipe : **front = WebGPU/TSL (Stan)**, **routage = Go (Mathis,
`github.com/Mathis-brgs/LEDProject`)**. Le front ne connaît QUE des entités/couleurs
(jamais IP/univers) — c'est le rôle du Go.

## 2. Principes directeurs

1. **Feature / vue** : un dossier par vue (`editor`, `compositor`, `preview2d`, `preview3d`),
   et dans chacun une séparation **`ui/`** (DOM/contrôles) et **`webgpu/`** (rendu de la vue).
2. **Composition root + contexte injecté** (le "root en back") : un **seul point** (`core/app.ts`)
   charge la **config**, précharge les **assets**, construit le **document**, crée le **device**,
   puis **injecte un `AppContext`** dans chaque vue. Les vues **lisent** le contexte, elles ne
   chargent rien elles-mêmes et n'utilisent aucune globale.
3. **Un seul renderer/device WebGPU**, créé une fois dans la base, partagé (stratégie canvas A :
   un device + render targets par vue).
4. **Séparation document / moteur / vues** :
   - `domain/` = **le document édité** (config, composition, objets, fixture) — données pures, sérialisables.
   - `core/engine/` = **le moteur headless** (couches → RT → state → eHuB), tourne **même sans UI**.
   - `views/` = **ce qu'on voit/édite**, lit le document via le contexte.
5. **Un concept = un fichier**, barrels en re-exports nommés (jamais `export *`), TS strict.

## 3. Structure

```
electron/                le "back" du logiciel (process principal Node)
├─ main.ts               fenêtre + socket UDP eHuB + I/O disque (projets)
└─ preload.ts            pont IPC sécurisé (window.led : sendEhub, load/saveProject)
src/                     le renderer (fenêtre) — WebGPU/TSL
├─ core/                 la base : composition root + moteur
│  ├─ app.ts             ROOT : config → assets → document, crée device+engine, monte les vues
│  ├─ AppContext.ts      { renderer, project, assets, engine, transport } injecté aux vues
│  ├─ device.ts          création du renderer/device WebGPU (1 fois)
│  ├─ Runtime.ts         boucle (RAF) + type Frame
│  ├─ AssetStore.ts      chargement des assets déclarés (async)
│  ├─ transport.ts       IpcTransport : renderer → main (IPC) → UDP
│  ├─ ehub.ts            encodage du protocole eHuB (le contrat, testé)
│  └─ engine/            moteur headless
│     ├─ Engine.ts       compose (update) + sort (output eHuB)
│     ├─ LayerStack.ts   empile les couches → render target 128×128
│     ├─ passes.ts       CompositePass (rend la pile dans la RT)
│     ├─ EhubOutput.ts   readback RT → eHuB → transport
│     └─ layers/         couches TSL (Plasma/Solid/Sweep) + factory
├─ domain/               LE document (données pures, sérialisables)
│  ├─ Project.ts         config + composition + objets ; load/save JSON (P1 du cours)
│  ├─ ProjectConfig.ts   fixture, contrôleurs/IP, eHuB, layout…
│  ├─ Composition.ts     séquences · pistes · keyframes
│  ├─ SceneObject.ts     objets créés à afficher
│  ├─ Fixture.ts         installation abstraite (entités + id eHuB)
│  └─ fixtures/          WallFixture (128×128 → ids eHuB, données Ecran.xlsx)
├─ assets/
│  └─ assets.manifest.ts manifeste déclaratif des assets
├─ views/
│  ├─ View.ts            contrat commun : mount(ctx) / unmount / render?
│  ├─ editor/            ui/ (timeline, inspector, création d'objets) + webgpu/
│  ├─ compositor/        ui/ (graphe de couches) + webgpu/
│  ├─ preview2d/         ui/ + webgpu/ (grille LED plate)
│  └─ preview3d/         ui/ + webgpu/ (installation en 3D)
└─ main.ts               entrée renderer : crée la root et ouvre un projet
electron.vite.config.ts  build main + preload + renderer (electron-vite)
```

## 4. Flux de données

**Ouverture d'un projet** (la root, une fois) :
```
App.create(canvas, project)
  → createRenderer(canvas)                  (device WebGPU partagé)
  → AssetStore.load(ASSET_MANIFEST)         (précharge, async)
  → transport.connect()                     (fixe la cible eHuB du Go ; envoi via IPC → main → UDP)
  → Engine(renderer, fixture, transport)
  → AppContext { renderer, project, assets, engine, transport }
  → runtime.start()  +  boucle output eHuB à 40 Hz
  → mountView(view)  pour chaque vue, avec le contexte
```

**Chaque frame** : `engine.update(frame)` compose les couches dans la RT ; la vue active
dessine à l'écran. **À 40 Hz** (découplé) : `engine.output()` fait le readback RT → eHuB → transport.

**Une vue** : `mount(ctx)` lit `ctx.project` (document), `ctx.assets`, rend via `ctx.renderer`.
Elle n'ouvre ni fichier ni socket.

## 5. Contrat eHuB (front ↔ Go)

Format centralisé dans `core/ehub.ts` (source unique). `update` (40 Hz) : en-tête 10 o
(`eHuB` + type=2 + univers + nbEntités + taille) + payload GZip de sextets
(`id u16 · R · G · B · W`). `config` : plages 8 o.

**À verrouiller avec Mathis** :
- endianness des `unsigned short` (front = **little-endian**)
- octet de type du `config` (front = 1)
- découpage en univers eHuB (front = **1 univers eHuB = 1 contrôleur**, groupes 0..3)
- **port UDP** d'écoute eHuB du routeur Go (config projet `ehub.port`, défaut 8765 ; émis par le main Electron)
- Mathis ajoute un **listener eHuB** côté Go (le CLI actuel génère en interne)
- univers **local (0-31) vs global (0-127)** : Excel dit local, page cours + Go de Mathis disent global → à tester (`ledtest single -strip 17`)

## 6. Ce qui est posé (seams) vs à construire

**Posé** : coque Electron (main = UDP eHuB + I/O disque, preload = IPC), composition root +
contexte injecté, device partagé, moteur (couches→RT→eHuB, vérifié), protocole eHuB (testé),
fixture du mur (vérifiée), config/document/assets déclarés, contrat de vue, une preview 2D branchée.

**À construire (features, plus tard)** : édition de la timeline/séquences, création d'objets,
graphe du compositor, preview 3D de l'installation, pipeline d'assets réel (textures/vidéo/audio),
load/save de projet, modèle de couches piloté par le document, layout multi-panneaux.

## 7. Conventions

TS strict, alias `@core`/`@domain`/`@assets`/`@views`, imports en `.ts`, un concept par fichier,
barrels en re-exports nommés. Renderer **WebGPU + TSL** (`three/webgpu` + `three/tsl`).
Desktop : **Electron** (main/preload = Node), build **electron-vite**, packaging **electron-builder**
(Win64 + macOS Silicon = le livrable du cours).
