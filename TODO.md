# LED Composer — Prochaines étapes

Feuille de route de la branche `feat/timeline-keyframes`. Cases à cocher au fil de l'eau.

## Priorité haute — modes de pilotage

### Audio-reactive (mode 1) — *headline*
Piloter un canal depuis une feature d'un calque audio (amplitude / bande / beat).
Modèle déjà présent : `AudioBinding` dans `front/src/domain/Layer.ts` (+ `layer.audioBindings`).

- [ ] Extraction de features par frame dans l'`AudioEngine` (amplitude RMS, bandes FFT, détection de beat) exposée à l'instant courant
- [ ] Chemin **override moteur-only** propre : le binding écrit la valeur du canal sans passer par les keyframes (mixé par-dessus l'animation), sans `_emit` par frame
- [ ] Application dans `Editor.tick` / `Animator` : `applyMap(binding.map, feature)` → canal, priorité vs. clés à trancher
- [ ] UI : éditer un binding (source audio, feature, bande Hz, canal cible, `MapRange`) — probablement dans l'Inspector
- [ ] Vérif : un shader/opacité qui « pulse » sur la piste audio importée

### Mapping spatial (mode 3)
Une région d'un média (vidéo/image) pilote un canal (fixture / zone du mur).
Modèle déjà présent : `SpatialBinding` dans `front/src/domain/Layer.ts` (+ `layer.spatialBindings`).

- [ ] Échantillonner la région `{x,y,w,h}` d'un média décodé (luma / couleur moyenne) par frame — réutiliser le canvas d'échantillonnage vidéo de l'`Editor`
- [ ] Application via `applyMap` → canal cible (même chemin override que mode 1)
- [ ] UI : dessiner/éditer la région sur un aperçu du média, choisir feature + canal
- [ ] Vérif : une lyre/spot dont la couleur suit une zone de la vidéo

## Timeline — finitions

- [ ] **Automation de volume sur le clip** (style Logic) : tracer la courbe de gain par-dessus la waveform, cliquer la ligne pour ajouter un point, glisser les points — en plus de la lane dépliée actuelle. Point d'attention : le gain est par-piste, les clips par-segment → la ligne doit s'afficher au niveau de la piste, pas par clip
- [ ] Valider le dézoom avec beaucoup de clips (perf) ; quantizer la clé de cache waveform par largeur si besoin
- [ ] UI signature rythmique (`beatsPerBar`) — l'API `Clock.setBeatsPerBar` existe, pas de contrôle
- [ ] Snap « intelligent » : aimanter aussi sur playhead / bords de clips / clés, pas seulement la grille BPM
- [ ] Persistance du tempo (BPM/signature) dans le projet si sérialisation

## Backlog / à confirmer

- [ ] Zoom vertical : scaler aussi le backing de la waveform avec `rowScale` (actuellement fixe 64px, downscale OK mais upscale limité au-delà de ~2×)
- [ ] Raccourcis outils (V/C/H) : les désactiver quand le focus est dans un champ (déjà géré via `isTyping`, à re-vérifier avec le rail)
- [ ] Nettoyer `led-exam-game.html` à la racine (fichier non suivi, hors périmètre)
