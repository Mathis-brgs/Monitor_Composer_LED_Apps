# LED — logiciel de composition (Electron + WebGPU/TSL)

**Logiciel desktop** de création : compose des couches → produit un state RGBW → l'émet en
**eHuB** vers le routage Go de Mathis. Architecture détaillée dans **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Structure

```
electron/    le "back" : main.ts (fenêtre + UDP eHuB + I/O disque) + preload.ts (pont IPC)
src/         le renderer (fenêtre WebGPU)
├─ core/     la base : composition root (app.ts) + AppContext + device + moteur (engine/)
├─ domain/   le document : Project · ProjectConfig · Composition · SceneObject · Fixture
├─ assets/   manifeste des assets
├─ views/    un dossier par vue (editor · compositor · preview2d · preview3d), ui/ + webgpu/
└─ main.ts   entrée renderer : crée la root et ouvre un projet
```

Principe clé : une **root** (`core/app.ts`) charge config + assets + document une fois, puis
**injecte un `AppContext`** dans chaque vue. Les vues lisent le contexte, ne chargent rien elles-mêmes.
Le renderer n'a pas de réseau : il envoie l'eHuB au **process principal** (IPC), qui l'émet en **UDP**.

## Lancer

```bash
pnpm install
pnpm dev            # lance le logiciel (Electron + WebGPU, HMR)
pnpm typecheck      # tsc renderer + electron (main/preload)
pnpm dist           # build + package Win64/macOS Silicon (electron-builder)
```

## État

- **Posé (seams)** : root + contexte injecté, device partagé, moteur (couches→RT→eHuB), protocole
  eHuB, fixture du mur, document/config/assets déclarés, contrat de vue, preview 2D branchée.
- **Vérifié sans navigateur** : eHuB (encode/décode + gzip), WallFixture (16384 entités uniques).
- **À construire (features)** : timeline/séquences, création d'objets, compositor, preview 3D,
  pipeline d'assets, load/save projet. Voir la feuille de route dans `docs/ARCHITECTURE.md`.
- **Non vérifiable ici** : typage TSL/Three + rendu WebGPU → `pnpm install` puis `pnpm typecheck` + `pnpm dev`.

## Contrat eHuB avec Mathis

Points à verrouiller (tous dans `core/ehub.ts`) : endianness, type du `config`, découpage univers,
**port UDP** (config projet `ehub.port`, émis par `electron/main.ts`), listener eHuB côté Go,
univers local vs global. Détail dans la doc.
