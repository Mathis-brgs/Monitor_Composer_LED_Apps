package wall

import "strconv"

// regionKey groupe les LED d'un sous-rectangle par univers physique — une
// ligne de patch par (ip, univers) réellement traversé.
type regionKey struct {
	ip       string
	universe uint16
}

// GenerateRegionPatchRows dérive un patch CSV pour le sous-rectangle bas-gauche
// (colonnes x=1..width, lignes y=0..height-1, cf. Config.Pixel : y=0 = bas) de
// L'INSTALLATION RÉELLE que décrit cfg (mêmes bandes, même hauteur physique,
// mêmes IP/EntityBase/EntityPerQuarter/EntityPerStrip) — PAS une installation
// plus petite : les ID d'entité produits sont ceux du vrai mur pour ce même
// coin, donc un contenu conçu pour le coin bas-gauche du mur réel pilote
// exactement les mêmes LED sur un banc de test qui ne câble que ce coin.
//
// Une bande va-et-vient (montée puis descente, cf. Config.Pixel) : sa moitié
// descendante adresse le bas visuel du mur près de LA FIN de sa plage
// d'entités/canaux, pas au début — un sous-carré bas-gauche touche donc en
// général 2 univers par bande (un pour chaque moitié), pas 1. C'est calculé
// ici LED par LED via la formule réelle (Pixel/EntityForStripLED/LEDAddress),
// pas en supposant une géométrie simplifiée.
//
// includeFixtures ajoute les lignes lyres/projecteur (mêmes plages que
// l'installation réelle, indépendantes de la zone du mur choisie).
func GenerateRegionPatchRows(cfg Config, width, height int, includeFixtures bool) []PatchRow {
	ranges := map[regionKey][2]int{} // (ip,univers) -> [minEntity, maxEntity]
	var order []regionKey

	for x := 1; x <= width; x++ {
		for y := 0; y < height; y++ {
			strip, led, ok := cfg.Pixel(x, y)
			if !ok {
				continue
			}
			entityID, ok := cfg.EntityForStripLED(strip, led)
			if !ok {
				continue
			}
			ip, universe, _ := cfg.LEDAddress(strip, led)
			k := regionKey{ip, universe}
			if r, seen := ranges[k]; seen {
				if entityID < r[0] {
					r[0] = entityID
				}
				if entityID > r[1] {
					r[1] = entityID
				}
				ranges[k] = r
			} else {
				ranges[k] = [2]int{entityID, entityID}
				order = append(order, k)
			}
		}
	}

	var rows []PatchRow
	for i, k := range order {
		r := ranges[k]
		rows = append(rows, PatchRow{Name: strconv.Itoa(i + 1), EntityStart: r[0], EntityEnd: r[1], IP: k.ip, Universe: k.universe})
	}
	if includeFixtures {
		rows = append(rows, FixturePatchRows()...)
	}
	return rows
}

// FixturePatchRows renvoie les lignes lyres/projecteur telles que patchées
// dans l'installation réelle (Ecran.csv) : fixes, indépendantes de la taille
// du mur LED.
func FixturePatchRows() []PatchRow {
	const fixtureIP = "192.168.1.48"
	return []PatchRow{
		{Name: "Lyre 1", EntityStart: 10, EntityEnd: 23, IP: fixtureIP, Universe: FixtureUniverse},
		{Name: "Lyre 2", EntityStart: 30, EntityEnd: 43, IP: fixtureIP, Universe: FixtureUniverse},
		{Name: "Lyre 3", EntityStart: 50, EntityEnd: 63, IP: fixtureIP, Universe: FixtureUniverse},
		{Name: "Lyre 4", EntityStart: 70, EntityEnd: 83, IP: fixtureIP, Universe: FixtureUniverse},
		{Name: "Projector", EntityStart: 1, EntityEnd: 4, IP: fixtureIP, Universe: FixtureUniverse},
	}
}

