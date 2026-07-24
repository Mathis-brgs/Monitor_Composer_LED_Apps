package wall

import "testing"

// TestEntityForStripLEDRoundTrip verifie que EntityForStripLED est bien
// l'inverse exact de EntityLocation sur le mur reel (defaut), pour toutes
// les LED visibles de quelques bandes.
func TestEntityForStripLEDRoundTrip(t *testing.T) {
	cfg := DefaultConfig()
	for strip := 1; strip <= 3; strip++ {
		for led := 1; led <= cfg.LEDsPerStrip(); led++ {
			entityID, ok := cfg.EntityForStripLED(strip, led)
			if !ok {
				t.Fatalf("bande %d led %d : EntityForStripLED ok=false inattendu", strip, led)
			}
			gotStrip, gotLed, ok := cfg.EntityLocation(entityID)
			if !ok || gotStrip != strip || gotLed != led {
				t.Errorf("bande %d led %d -> entite %d -> (%d,%d,ok=%v), attendu (%d,%d,true)",
					strip, led, entityID, gotStrip, gotLed, ok, strip, led)
			}
		}
	}
}

// TestGenerateRegionPatchRowsBottomLeft32 verifie, sur le mur reel (128x128,
// 4 controleurs), que le coin bas-gauche 32x32 (= exactement les 16 bandes du
// 1er controleur) donne 2 lignes par bande (moitie montante + moitie
// descendante, sur 2 univers differents) et reste uniquement sur .45.
func TestGenerateRegionPatchRowsBottomLeft32(t *testing.T) {
	cfg := DefaultConfig()
	rows := GenerateRegionPatchRows(cfg, 32, 32, false)

	if len(rows) != 32 { // 16 bandes x 2 univers (montee/descente)
		t.Fatalf("attendu 32 lignes (16 bandes x 2 univers), recu %d : %+v", len(rows), rows)
	}
	for _, r := range rows {
		if r.IP != "192.168.1.45" {
			t.Errorf("ligne hors du 1er controleur : %+v", r)
		}
		if r.EntityEnd-r.EntityStart+1 != 32 {
			t.Errorf("plage attendue de 32 entites (32 lignes de pixels), recu %+v", r)
		}
	}

	// Verifie qu'un pixel du coin (x=1,y=0 : bas-gauche) et le pixel le plus
	// haut de la region (x=1,y=31) tombent bien dans une des plages generees.
	for _, y := range []int{0, 31} {
		strip, led, ok := cfg.Pixel(1, y)
		if !ok {
			t.Fatalf("Pixel(1,%d) ok=false inattendu", y)
		}
		entityID, ok := cfg.EntityForStripLED(strip, led)
		if !ok {
			t.Fatalf("EntityForStripLED(%d,%d) ok=false inattendu", strip, led)
		}
		found := false
		for _, r := range rows {
			if entityID >= r.EntityStart && entityID <= r.EntityEnd {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("pixel (1,%d) -> entite %d non couverte par les lignes generees : %+v", y, entityID, rows)
		}
	}
}
