package wall

import (
	"strings"
	"testing"
)

// TestControllerUniversesMatchesRealExcel verifie quelques lignes retranscrites
// a la main depuis le tableau Excel reel du prof (pas generees par le code
// teste : verification independante, pas un round-trip circulaire).
func TestControllerUniversesMatchesRealExcel(t *testing.T) {
	cfg := DefaultConfig()

	want := []UniverseInfo{
		{Universe: 0, Strip: 1, EntityStart: 100, EntityEnd: 269},
		{Universe: 1, Strip: 1, EntityStart: 270, EntityEnd: 358},
		{Universe: 2, Strip: 2, EntityStart: 400, EntityEnd: 569},
		{Universe: 3, Strip: 2, EntityStart: 570, EntityEnd: 658},
	}

	got := cfg.ControllerUniverses("192.168.1.45")
	if len(got) < 4 {
		t.Fatalf("attendu au moins 4 univers pour 192.168.1.45, recu %d", len(got))
	}
	for i, w := range want {
		if got[i] != w {
			t.Errorf("univers %d : recu %+v, attendu %+v", i, got[i], w)
		}
	}

	// 2e controleur : premiere bande doit commencer a EntityBase+EntityPerQuarter.
	us46 := cfg.ControllerUniverses("192.168.1.46")
	if len(us46) == 0 || us46[0].EntityStart != 5100 {
		t.Errorf("192.168.1.46 : premier univers attendu a l'entite 5100, recu %+v", us46)
	}
}

// TestParsePatchCSV verifie le parsing (avec et sans en-tete).
func TestParsePatchCSV(t *testing.T) {
	csvData := `Name,Entity Start,Entity End,ArtNet IP,ArtNet Universe
1,100,269,192.168.1.45,0
2,270,358,192.168.1.45,1
Lyre 1,10,23,192.168.1.48,33
`
	rows, err := ParsePatchCSV(strings.NewReader(csvData))
	if err != nil {
		t.Fatalf("ParsePatchCSV: %v", err)
	}
	if len(rows) != 3 {
		t.Fatalf("attendu 3 lignes, recu %d", len(rows))
	}
	if rows[0] != (PatchRow{Name: "1", EntityStart: 100, EntityEnd: 269, IP: "192.168.1.45", Universe: 0}) {
		t.Errorf("ligne 0 inattendue : %+v", rows[0])
	}
	if rows[2].Name != "Lyre 1" || rows[2].Universe != 33 {
		t.Errorf("ligne fixture inattendue : %+v", rows[2])
	}
}

// TestResolveEntityPatchOverridesFormula verifie qu'une table de patch non
// vide devient la source de verite (au lieu de la formule).
func TestResolveEntityPatchOverridesFormula(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Patch = []PatchRow{
		{Name: "1", EntityStart: 100, EntityEnd: 269, IP: "10.0.0.9", Universe: 7},
	}

	ip, universe, ch, ok := cfg.ResolveEntity(150)
	if !ok || ip != "10.0.0.9" || universe != 7 {
		t.Fatalf("attendu (10.0.0.9, univers 7), recu (%s, %d, ok=%v)", ip, universe, ok)
	}
	wantCh := (150 - 100) * cfg.ChannelsPerLED()
	if ch != wantCh {
		t.Errorf("offset canal : recu %d, attendu %d", ch, wantCh)
	}

	if _, _, _, ok := cfg.ResolveEntity(9999); ok {
		t.Error("entite hors patch : attendu ok=false")
	}
}

// TestResolveEntityFormulaFallback verifie que sans Patch, la formule
// (EntityLocation/LEDAddress) gouverne comme avant.
func TestResolveEntityFormulaFallback(t *testing.T) {
	cfg := DefaultConfig()
	ip, universe, ch, ok := cfg.ResolveEntity(102) // entite 102 = 1ere LED visible de la bande 1
	if !ok {
		t.Fatal("attendu ok=true")
	}
	wantIP, wantUniverse, wantCh := cfg.LEDAddress(1, 3)
	if ip != wantIP || universe != wantUniverse || ch != wantCh {
		t.Errorf("recu (%s,%d,%d), attendu (%s,%d,%d)", ip, universe, ch, wantIP, wantUniverse, wantCh)
	}
}

// TestFrameSetEntityUnifiesLEDsAndFixtures verifie que Frame.SetEntity route
// correctement une entite de bande ET une entite fixture vers leurs univers
// respectifs, et que Flush ne renvoie que les univers modifies.
func TestFrameSetEntityUnifiesLEDsAndFixtures(t *testing.T) {
	cfg := DefaultConfig()
	f := NewFrame(cfg)

	if !f.SetEntity(102, 10, 20, 30, 0) { // LED de bande
		t.Fatal("SetEntity(102,...) attendu ok=true")
	}
	if !f.SetEntity(1, 40, 50, 60, 0) { // fixture (projecteur, canal 1)
		t.Fatal("SetEntity(1,...) attendu ok=true (fixture)")
	}
	if f.SetEntity(999999, 1, 1, 1, 0) {
		t.Error("SetEntity sur une entite hors config : attendu ok=false")
	}

	ledIP, ledUniverse, ledCh := cfg.LEDAddress(1, 3)
	channels, ok := f.ChannelsFor(ledIP, ledUniverse)
	if !ok || channels[ledCh] != 10 || channels[ledCh+1] != 20 || channels[ledCh+2] != 30 {
		t.Errorf("canaux LED inattendus : %v (ok=%v)", channels[ledCh:ledCh+3], ok)
	}

	fixIP := cfg.ControllerIPs[len(cfg.ControllerIPs)-1]
	fixChannels, ok := f.ChannelsFor(fixIP, FixtureUniverse)
	if !ok || fixChannels[0] != 40 {
		t.Errorf("canal fixture inattendu : %v (ok=%v)", fixChannels[:2], ok)
	}
}

// TestFrameWithPatch verifie que Frame reserve ses slots depuis Config.Patch
// quand elle est renseignee, meme si les univers ne suivent aucune formule.
func TestFrameWithPatch(t *testing.T) {
	cfg := Config{
		ControllerIPs: []string{"10.0.0.1"},
		ChannelOrder:  "rgb",
		Patch: []PatchRow{
			{Name: "custom", EntityStart: 1, EntityEnd: 50, IP: "10.0.0.1", Universe: 5},
		},
	}
	f := NewFrame(cfg)
	if !f.SetEntity(1, 1, 2, 3, 0) {
		t.Fatal("attendu ok=true pour une entite couverte par le patch")
	}
	channels, ok := f.ChannelsFor("10.0.0.1", 5)
	if !ok || channels[0] != 1 || channels[1] != 2 || channels[2] != 3 {
		t.Errorf("canaux inattendus : %v (ok=%v)", channels[:3], ok)
	}
}

