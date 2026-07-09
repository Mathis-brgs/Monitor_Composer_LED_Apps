// Application de monitoring/debug (P8) : visualise en direct l'état du mur
// (reçu depuis le front via eHuB, ou depuis les commandes manuelles) et permet
// de tester le routage sans dépendre du front. Permet aussi de modifier la
// configuration physique (IP des contrôleurs, dimensions, numérotation des
// entités) depuis l'application (P1), avec sauvegarde/chargement JSON.
// Application desktop native (Fyne), pas de web. Réutilise les mêmes packages
// que le CLI "Routing" (artnet, ehub, wall) : le monitor n'est qu'une autre
// façade sur le même module de routage.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/app"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/dialog"
	"fyne.io/fyne/v2/widget"

	"ledtest/artnet"
	"ledtest/ehub"
	"ledtest/wall"
)

// Rendu de la preview façon vraie matrice de LED : chaque LED est un petit
// point rond séparé de ses voisins par du noir, pas un pixel plein contigu.
const (
	cellSize  = 6 // espace alloué par LED dans l'image de preview
	dotRadius = 2 // rayon du point (diametre 4-5, laisse un espace visible)
)

// drawDot peint un disque plein (une LED) centré sur (cx,cy).
func drawDot(img *image.RGBA, cx, cy, radius int, col color.Color) {
	for dy := -radius; dy <= radius; dy++ {
		for dx := -radius; dx <= radius; dx++ {
			if dx*dx+dy*dy <= radius*radius {
				img.Set(cx+dx, cy+dy, col)
			}
		}
	}
}

// Grille des 512 canaux DMX bruts d'un univers, chaque canal affiché en
// niveau de gris (0=noir, 255=blanc) : permet de voir exactement ce qui part
// sur le fil avant l'encapsulation ArtNet (P8), canal par canal et pas juste
// LED par LED (ex: bleu = canal R noir, canal V noir, canal B blanc).
const (
	dmxCols     = 16
	dmxRows     = 512 / dmxCols
	dmxCellSize = 14
)

func drawChannelGrid(img *image.RGBA, channels [512]byte) {
	draw.Draw(img, img.Bounds(), image.NewUniform(color.Black), image.Point{}, draw.Src)
	for i, v := range channels {
		col, row := i%dmxCols, i/dmxCols
		x0, y0 := col*dmxCellSize+1, row*dmxCellSize+1
		gray := color.Gray{Y: v}
		for dy := range dmxCellSize - 2 {
			for dx := range dmxCellSize - 2 {
				img.Set(x0+dx, y0+dy, gray)
			}
		}
	}
}

// sharedState regroupe tout ce qui est accédé à la fois par la goroutine
// réseau (réception eHuB), la boucle d'envoi ArtNet, et l'UI (config, tests
// manuels, preview) : un seul mutex protège l'ensemble pour rester simple.
// cfg/frame sont remplacés ensemble par applyConfig quand l'utilisateur
// change de configuration ; l'ancien état ne peut pas être réinterprété dans
// une géométrie différente, donc on repart d'une frame vide.
type sharedState struct {
	mu sync.Mutex

	cfg          wall.Config
	frame        *wall.Frame
	fixtureData  [512]byte
	fixtureDirty bool

	updateCount  int
	unknownCount int
	lastSource   string
}

func newSharedState(cfg wall.Config) *sharedState {
	return &sharedState{cfg: cfg, frame: wall.NewFrame(cfg)}
}

func (s *sharedState) applyConfig(cfg wall.Config) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg = cfg
	s.frame = wall.NewFrame(cfg)
	s.fixtureData = [512]byte{}
	s.fixtureDirty = false
	s.updateCount = 0
	s.unknownCount = 0
	s.lastSource = ""
}

func (s *sharedState) snapshotConfig() wall.Config {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg
}

// listenEhub décode en continu le flux eHuB (config + update) et met à jour
// l'état partagé. Tourne dans sa propre goroutine, indépendamment de l'UI et
// de la cadence d'envoi ArtNet (mêmes principes que `listen` du CLI).
func (s *sharedState) listenEhub(port int) {
	conn, err := net.ListenUDP("udp", &net.UDPAddr{Port: port})
	if err != nil {
		fmt.Println("erreur d'ecoute UDP eHuB:", err)
		return
	}
	defer conn.Close()

	buf := make([]byte, 65535)
	for {
		n, src, err := conn.ReadFromUDP(buf)
		if err != nil {
			fmt.Println("erreur de lecture UDP:", err)
			continue
		}

		header, compressed, err := ehub.ParseHeader(buf[:n])
		if err != nil {
			fmt.Println("paquet eHuB invalide de", src, ":", err)
			continue
		}
		payload, err := ehub.Decompress(compressed)
		if err != nil {
			fmt.Println("erreur de decompression gzip de", src, ":", err)
			continue
		}

		switch header.Type {
		case ehub.TypeUpdate:
			entities, err := ehub.DecodeUpdate(payload, header.Count)
			if err != nil {
				fmt.Println("update eHuB invalide:", err)
				continue
			}

			s.mu.Lock()
			cfg := s.cfg
			for _, e := range entities {
				if strip, led, ok := cfg.EntityLocation(int(e.ID)); ok {
					s.frame.SetLED(strip, led, e.R, e.G, e.B)
					continue
				}
				if _, _, ch, ok := cfg.FixtureChannel(int(e.ID)); ok {
					s.fixtureData[ch] = e.R
					s.fixtureDirty = true
					continue
				}
				s.unknownCount++
			}
			s.updateCount++
			s.lastSource = src.String()
			s.mu.Unlock()

		case ehub.TypeConfig:
			if _, err := ehub.DecodeConfig(payload, header.Count); err != nil {
				fmt.Println("config eHuB invalide:", err)
			}

		default:
			fmt.Printf("type de message eHuB inconnu (%d) de %s\n", header.Type, src)
		}
	}
}

func main() {
	port := flag.Int("port", 8765, "port UDP d'ecoute eHuB")
	fps := flag.Int("fps", 24, "frequence d'envoi ArtNet (Hz)")
	flag.Parse()

	sender, err := artnet.NewSender()
	if err != nil {
		fmt.Println("erreur d'ouverture du socket UDP ArtNet:", err)
		os.Exit(1)
	}
	defer sender.Close()

	state := newSharedState(wall.DefaultConfig())

	a := app.New()
	win := a.NewWindow("LED Monitor")

	// --- grille de preview : matrice de points, reconstruite si les
	// dimensions de la configuration changent, rafraichie depuis l'etat partage ---
	img := image.NewRGBA(image.Rect(0, 0, state.cfg.Width()*cellSize, state.cfg.Height*cellSize))
	grid := canvas.NewImageFromImage(img)
	grid.ScaleMode = canvas.ImageScalePixels // rendu "pixelise", pas de flou
	grid.FillMode = canvas.ImageFillContain
	grid.SetMinSize(fyne.NewSize(640, 640))

	// --- grille des canaux DMX bruts de l'univers surveille (voir "Mode
	// univers brut" plus bas : IP/univers partages entre envoi et lecture) ---
	dmxImg := image.NewRGBA(image.Rect(0, 0, dmxCols*dmxCellSize, dmxRows*dmxCellSize))
	dmxGrid := canvas.NewImageFromImage(dmxImg)
	dmxGrid.ScaleMode = canvas.ImageScalePixels
	dmxGrid.FillMode = canvas.ImageFillContain
	dmxGrid.SetMinSize(fyne.NewSize(dmxCols*dmxCellSize, dmxRows*dmxCellSize))
	dmxLabel := widget.NewLabel("Canaux DMX : univers introuvable")

	statusLabel := widget.NewLabel("en attente de donnees eHuB...")

	// --- couleur courante : valeurs saisies (0-255), pas de sliders ---
	clampByte := func(n int) byte {
		if n < 0 {
			return 0
		}
		if n > 255 {
			return 255
		}
		return byte(n)
	}
	rEntry := widget.NewEntry()
	rEntry.SetText("255")
	gEntry := widget.NewEntry()
	gEntry.SetText("255")
	bEntry := widget.NewEntry()
	bEntry.SetText("255")
	swatch := canvas.NewRectangle(color.White)
	swatch.SetMinSize(fyne.NewSize(60, 30))

	currentColor := func() (byte, byte, byte) {
		r, _ := strconv.Atoi(rEntry.Text)
		g, _ := strconv.Atoi(gEntry.Text)
		b, _ := strconv.Atoi(bEntry.Text)
		return clampByte(r), clampByte(g), clampByte(b)
	}
	updateSwatch := func() {
		r, g, b := currentColor()
		swatch.FillColor = color.NRGBA{R: r, G: g, B: b, A: 255}
		swatch.Refresh()
	}
	rEntry.OnChanged = func(string) { updateSwatch() }
	gEntry.OnChanged = func(string) { updateSwatch() }
	bEntry.OnChanged = func(string) { updateSwatch() }

	// --- test manuel : une LED ou une bande entiere ---
	stripEntry := widget.NewEntry()
	stripEntry.SetText("1")
	ledEntry := widget.NewEntry()
	ledEntry.SetText("2")

	setLedBtn := widget.NewButton("Allumer cette LED", func() {
		strip, errS := strconv.Atoi(stripEntry.Text)
		led, errL := strconv.Atoi(ledEntry.Text)
		if errS != nil || errL != nil {
			return
		}
		r, g, b := currentColor()
		state.mu.Lock()
		state.frame.SetLED(strip, led, r, g, b)
		state.mu.Unlock()
	})

	fillStripBtn := widget.NewButton("Remplir cette bande", func() {
		strip, errS := strconv.Atoi(stripEntry.Text)
		if errS != nil {
			return
		}
		r, g, b := currentColor()
		state.mu.Lock()
		for led := 1; led <= state.cfg.LEDsPerStrip(); led++ {
			if state.cfg.IsVisible(led) {
				state.frame.SetLED(strip, led, r, g, b)
			}
		}
		state.mu.Unlock()
	})

	fillAllBtn := widget.NewButton("Tout remplir", func() {
		r, g, b := currentColor()
		state.mu.Lock()
		for strip := 1; strip <= state.cfg.StripCount(); strip++ {
			for led := 1; led <= state.cfg.LEDsPerStrip(); led++ {
				if state.cfg.IsVisible(led) && state.cfg.LEDInRegion(strip, led) {
					state.frame.SetLED(strip, led, r, g, b)
				}
			}
		}
		state.mu.Unlock()
	})

	clearBtn := widget.NewButton("Tout eteindre", func() {
		state.mu.Lock()
		for strip := 1; strip <= state.cfg.StripCount(); strip++ {
			for led := 1; led <= state.cfg.LEDsPerStrip(); led++ {
				if state.cfg.IsVisible(led) {
					state.frame.SetLED(strip, led, 0, 0, 0)
				}
			}
		}
		state.mu.Unlock()
	})

	// --- mode univers brut : adressage direct IP/univers/plage d'ID, sans
	// passer par l'abstraction bande/LED. Utile pour tester le cablage/mapping
	// independamment de notre modele (ex: "l'univers 5 du controleur .46
	// allume-t-il bien les LED 1 a 20 ?"). Envoi immediat, comme les commandes
	// "single"/"fill" du CLI (le BC216 garde la derniere valeur recue).
	ipSelect := widget.NewSelect(state.cfg.ControllerIPs, nil)
	ipSelect.SetSelected(state.cfg.ControllerIPs[0])
	universeEntry := widget.NewEntry()
	universeEntry.SetText("0")
	startIDEntry := widget.NewEntry()
	startIDEntry.SetText("1")
	endIDEntry := widget.NewEntry()
	endIDEntry.SetText("10")

	rawSendBtn := widget.NewButton("Allumer cette plage (univers brut)", func() {
		universe, errU := strconv.Atoi(universeEntry.Text)
		startID, errS := strconv.Atoi(startIDEntry.Text)
		endID, errE := strconv.Atoi(endIDEntry.Text)
		if errU != nil || errS != nil || errE != nil || ipSelect.Selected == "" || startID < 1 || endID < startID {
			return
		}
		r, g, b := currentColor()
		var buf [512]byte
		for id := startID; id <= endID; id++ {
			ch := (id - 1) * 3
			if ch+2 >= 512 {
				break
			}
			buf[ch], buf[ch+1], buf[ch+2] = r, g, b
		}
		if err := sender.Send(ipSelect.Selected, uint16(universe), 0, buf[:]); err != nil {
			fmt.Println("erreur d'envoi ArtNet (mode univers):", err)
		}
	})

	// --- configuration (P1) : IP des controleurs, dimensions, numerotation
	// des entites. Modifiable depuis l'appli, sauvegardable/rechargeable en
	// JSON (pas d'import Excel direct pour l'instant, juste l'equivalent
	// saisi/edite dans l'appli). "Appliquer" repart d'un mur vide dans la
	// nouvelle geometrie (l'etat precedent n'a pas de sens dans une geometrie
	// differente).
	ipsEntry := widget.NewEntry()
	ipsEntry.SetText(strings.Join(state.cfg.ControllerIPs, ","))
	stripsPerCtrlEntry := widget.NewEntry()
	stripsPerCtrlEntry.SetText(strconv.Itoa(state.cfg.StripsPerCtrl))
	heightEntry := widget.NewEntry()
	heightEntry.SetText(strconv.Itoa(state.cfg.Height))
	entityBaseEntry := widget.NewEntry()
	entityBaseEntry.SetText(strconv.Itoa(state.cfg.EntityBase))
	entityPerQuarterEntry := widget.NewEntry()
	entityPerQuarterEntry.SetText(strconv.Itoa(state.cfg.EntityPerQuarter))
	entityPerStripEntry := widget.NewEntry()
	entityPerStripEntry.SetText(strconv.Itoa(state.cfg.EntityPerStrip))

	// Zone active (optionnelle) : restreint le mur SANS changer son adressage
	// reel (voir wall.Config.Region*). Laisser Largeur a 0 = pas de restriction.
	regionX0Entry := widget.NewEntry()
	regionX0Entry.SetText(strconv.Itoa(state.cfg.RegionX0))
	regionY0Entry := widget.NewEntry()
	regionY0Entry.SetText(strconv.Itoa(state.cfg.RegionY0))
	regionWidthEntry := widget.NewEntry()
	regionWidthEntry.SetText(strconv.Itoa(state.cfg.RegionWidth))
	regionHeightEntry := widget.NewEntry()
	regionHeightEntry.SetText(strconv.Itoa(state.cfg.RegionHeight))

	configInfoLabel := widget.NewLabel("")
	configErrorLabel := widget.NewLabel("")
	refreshConfigInfo := func(c wall.Config) {
		info := fmt.Sprintf(
			"Largeur: %d colonnes  Hauteur: %d  Bandes: %d  Univers/bande: %d",
			c.Width(), c.Height, c.StripCount(), c.UniversesPerStrip(),
		)
		if c.RegionWidth > 0 {
			info += fmt.Sprintf("\nZone active : x=%d..%d, y=%d..%d",
				c.RegionX0, c.RegionX0+c.RegionWidth-1, c.RegionY0, c.RegionY0+c.RegionHeight-1)
		} else {
			info += "\nZone active : tout le mur"
		}
		configInfoLabel.SetText(info)
	}
	refreshConfigInfo(state.cfg)

	parseConfigFromFields := func() (wall.Config, error) {
		var ips []string
		for _, raw := range strings.Split(ipsEntry.Text, ",") {
			ip := strings.TrimSpace(raw)
			if ip != "" {
				ips = append(ips, ip)
			}
		}
		if len(ips) == 0 {
			return wall.Config{}, fmt.Errorf("au moins une adresse IP est necessaire")
		}
		spc, err := strconv.Atoi(stripsPerCtrlEntry.Text)
		if err != nil || spc < 1 {
			return wall.Config{}, fmt.Errorf("bandes/controleur invalide")
		}
		h, err := strconv.Atoi(heightEntry.Text)
		if err != nil || h < 1 {
			return wall.Config{}, fmt.Errorf("hauteur invalide")
		}
		eb, err := strconv.Atoi(entityBaseEntry.Text)
		if err != nil {
			return wall.Config{}, fmt.Errorf("entite de depart invalide")
		}
		epq, err := strconv.Atoi(entityPerQuarterEntry.Text)
		if err != nil || epq < 1 {
			return wall.Config{}, fmt.Errorf("ecart entites/controleur invalide")
		}
		eps, err := strconv.Atoi(entityPerStripEntry.Text)
		if err != nil || eps < 1 {
			return wall.Config{}, fmt.Errorf("ecart entites/bande invalide")
		}
		// Zone active : champs vides/invalides -> 0 -> pas de restriction.
		rx0, _ := strconv.Atoi(regionX0Entry.Text)
		ry0, _ := strconv.Atoi(regionY0Entry.Text)
		rw, _ := strconv.Atoi(regionWidthEntry.Text)
		rh, _ := strconv.Atoi(regionHeightEntry.Text)
		return wall.Config{
			ControllerIPs:    ips,
			StripsPerCtrl:    spc,
			Height:           h,
			EntityBase:       eb,
			EntityPerQuarter: epq,
			EntityPerStrip:   eps,
			RegionX0:         rx0,
			RegionY0:         ry0,
			RegionWidth:      rw,
			RegionHeight:     rh,
		}, nil
	}

	loadFieldsFromConfig := func(c wall.Config) {
		ipsEntry.SetText(strings.Join(c.ControllerIPs, ","))
		stripsPerCtrlEntry.SetText(strconv.Itoa(c.StripsPerCtrl))
		heightEntry.SetText(strconv.Itoa(c.Height))
		entityBaseEntry.SetText(strconv.Itoa(c.EntityBase))
		entityPerQuarterEntry.SetText(strconv.Itoa(c.EntityPerQuarter))
		entityPerStripEntry.SetText(strconv.Itoa(c.EntityPerStrip))
		regionX0Entry.SetText(strconv.Itoa(c.RegionX0))
		regionY0Entry.SetText(strconv.Itoa(c.RegionY0))
		regionWidthEntry.SetText(strconv.Itoa(c.RegionWidth))
		regionHeightEntry.SetText(strconv.Itoa(c.RegionHeight))
		ipSelect.SetOptions(c.ControllerIPs)
		ipSelect.SetSelected(c.ControllerIPs[0])
		refreshConfigInfo(c)
	}

	applyBtn := widget.NewButton("Appliquer", func() {
		newCfg, err := parseConfigFromFields()
		if err != nil {
			configErrorLabel.SetText("Erreur : " + err.Error())
			return
		}
		configErrorLabel.SetText("")
		state.applyConfig(newCfg)
		ipSelect.SetOptions(newCfg.ControllerIPs)
		ipSelect.SetSelected(newCfg.ControllerIPs[0])
		refreshConfigInfo(newCfg)
	})

	saveBtn := widget.NewButton("Sauvegarder...", func() {
		newCfg, err := parseConfigFromFields()
		if err != nil {
			configErrorLabel.SetText("Erreur : " + err.Error())
			return
		}
		configErrorLabel.SetText("")
		dialog.ShowFileSave(func(uc fyne.URIWriteCloser, ferr error) {
			if ferr != nil || uc == nil {
				return
			}
			defer uc.Close()
			enc := json.NewEncoder(uc)
			enc.SetIndent("", "  ")
			if err := enc.Encode(newCfg); err != nil {
				configErrorLabel.SetText("Erreur de sauvegarde : " + err.Error())
			}
		}, win)
	})

	loadBtn := widget.NewButton("Charger...", func() {
		dialog.ShowFileOpen(func(uc fyne.URIReadCloser, ferr error) {
			if ferr != nil || uc == nil {
				return
			}
			defer uc.Close()
			var newCfg wall.Config
			if err := json.NewDecoder(uc).Decode(&newCfg); err != nil {
				configErrorLabel.SetText("Erreur de chargement : " + err.Error())
				return
			}
			configErrorLabel.SetText("")
			state.applyConfig(newCfg)
			loadFieldsFromConfig(newCfg)
		}, win)
	})

	configPanel := container.NewVScroll(container.NewVBox(
		widget.NewLabelWithStyle("Configuration physique", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		widget.NewLabel("IP des controleurs (separees par des virgules)"), ipsEntry,
		widget.NewLabel("Bandes par controleur"), stripsPerCtrlEntry,
		widget.NewLabel("Hauteur (LED visibles par colonne)"), heightEntry,
		widget.NewLabel("Entite de depart"), entityBaseEntry,
		widget.NewLabel("Ecart entites / controleur"), entityPerQuarterEntry,
		widget.NewLabel("Ecart entites / bande"), entityPerStripEntry,
		widget.NewSeparator(),

		widget.NewLabelWithStyle("Zone active (optionnel)", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		widget.NewLabel("N'adresse qu'une partie du mur ci-dessus, sans changer son cablage/adressage reel. Largeur=0 -> tout le mur."),
		widget.NewLabel("X debut (colonne, 1..Largeur)"), regionX0Entry,
		widget.NewLabel("Y debut (ligne, 0=bas)"), regionY0Entry,
		widget.NewLabel("Largeur de la zone"), regionWidthEntry,
		widget.NewLabel("Hauteur de la zone"), regionHeightEntry,
		container.NewGridWithColumns(3, applyBtn, saveBtn, loadBtn),
		configInfoLabel,
		configErrorLabel,
	))

	// --- preview du mur : fenetre secondaire, ouvrable/masquable a la demande
	// (pas besoin de l'avoir affichee en permanence). Se cache au lieu de se
	// fermer pour ne pas quitter l'appli quand on clique sur la croix.
	previewWin := a.NewWindow("Preview du mur")
	previewWin.SetContent(container.NewScroll(grid))
	previewWin.Resize(fyne.NewSize(680, 680))
	previewVisible := false
	previewToggleBtn := widget.NewButton("Afficher la preview du mur", nil)
	previewToggleBtn.OnTapped = func() {
		if previewVisible {
			previewWin.Hide()
			previewToggleBtn.SetText("Afficher la preview du mur")
		} else {
			previewWin.Show()
			previewToggleBtn.SetText("Masquer la preview du mur")
		}
		previewVisible = !previewVisible
	}
	previewWin.SetCloseIntercept(func() {
		previewWin.Hide()
		previewVisible = false
		previewToggleBtn.SetText("Afficher la preview du mur")
	})

	controlsPanel := container.NewVScroll(container.NewVBox(
		previewToggleBtn,
		widget.NewSeparator(),

		widget.NewLabelWithStyle("Couleur", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		swatch,
		widget.NewLabel("Rouge (0-255)"), rEntry,
		widget.NewLabel("Vert (0-255)"), gEntry,
		widget.NewLabel("Bleu (0-255)"), bEntry,
		widget.NewSeparator(),

		widget.NewLabelWithStyle("Test manuel (bande/LED)", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		widget.NewLabel("Bande"), stripEntry,
		widget.NewLabel("LED"), ledEntry,
		setLedBtn,
		fillStripBtn,
		widget.NewSeparator(),
		fillAllBtn,
		clearBtn,
		widget.NewSeparator(),

		widget.NewLabelWithStyle("Mode univers brut (IP/univers/ID)", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		widget.NewLabel("Adresse IP"), ipSelect,
		widget.NewLabel("Univers"), universeEntry,
		widget.NewLabel("ID debut"), startIDEntry,
		widget.NewLabel("ID fin"), endIDEntry,
		rawSendBtn,
		widget.NewSeparator(),

		widget.NewLabelWithStyle("Canaux DMX bruts de cet univers", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		widget.NewLabel("512 canaux, noir=0, blanc=255, lecture gauche->droite puis haut->bas (3 canaux = 1 LED RVB)"),
		dmxGrid,
		dmxLabel,
		widget.NewSeparator(),

		widget.NewLabelWithStyle("Etat eHuB", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		statusLabel,
	))

	tabs := container.NewAppTabs(
		container.NewTabItem("Configuration", configPanel),
		container.NewTabItem("Controles", controlsPanel),
	)
	win.SetContent(tabs)
	win.Resize(fyne.NewSize(520, 700))

	// --- reseau : reception eHuB, decouplee de l'UI et de l'envoi ArtNet ---
	go state.listenEhub(*port)

	// --- envoi ArtNet a cadence controlee (24 fps par defaut, cf. consigne) ---
	go func() {
		ticker := time.NewTicker(time.Second / time.Duration(*fps))
		defer ticker.Stop()
		var seq byte
		for range ticker.C {
			state.mu.Lock()
			cfg := state.cfg
			frame := state.frame
			sendFixture := state.fixtureDirty
			state.fixtureDirty = false
			var fixtureSnapshot [512]byte
			if sendFixture {
				fixtureSnapshot = state.fixtureData
			}
			flushErr := frame.Flush(sender, seq)
			state.mu.Unlock()

			if flushErr != nil {
				fmt.Println("erreur d'envoi ArtNet:", flushErr)
			}
			if sendFixture {
				ip, universe, _, _ := cfg.FixtureChannel(1)
				if err := sender.Send(ip, universe, seq, fixtureSnapshot[:]); err != nil {
					fmt.Println("erreur d'envoi ArtNet (fixtures):", err)
				}
			}
			seq++
		}
	}()

	// --- rafraichissement de la preview (UI seulement, cadence plus faible) ---
	go func() {
		ticker := time.NewTicker(150 * time.Millisecond)
		defer ticker.Stop()
		for range ticker.C {
			monitorIP := ipSelect.Selected
			monitorUniverse, _ := strconv.Atoi(universeEntry.Text)

			state.mu.Lock()
			cfg := state.cfg
			frame := state.frame
			n, unk, src := state.updateCount, state.unknownCount, state.lastSource
			channels, chOK := frame.ChannelsFor(monitorIP, uint16(monitorUniverse))
			state.mu.Unlock()

			w, h := cfg.Width(), cfg.Height
			wantBounds := image.Rect(0, 0, w*cellSize, h*cellSize)
			if img == nil || img.Bounds() != wantBounds {
				img = image.NewRGBA(wantBounds)
			}
			draw.Draw(img, img.Bounds(), image.NewUniform(color.Black), image.Point{}, draw.Src)
			for y := 0; y < h; y++ {
				for x := 1; x <= w; x++ {
					strip, led, ok := cfg.Pixel(x, y)
					if !ok {
						continue
					}
					r, g, b := frame.GetLED(strip, led)
					cx := (x-1)*cellSize + cellSize/2
					cy := (h-1-y)*cellSize + cellSize/2 // (0,0) en haut a gauche a l'ecran
					drawDot(img, cx, cy, dotRadius, color.NRGBA{R: r, G: g, B: b, A: 255})
				}
			}

			dmxText := fmt.Sprintf("Canaux DMX : %s, univers %d introuvable dans la config actuelle", monitorIP, monitorUniverse)
			if chOK {
				drawChannelGrid(dmxImg, channels)
				dmxText = fmt.Sprintf("Canaux DMX : %s, univers %d", monitorIP, monitorUniverse)
			}

			if src == "" {
				src = "(aucun)"
			}
			// Les mises a jour d'UI depuis une goroutine externe doivent passer
			// par fyne.Do pour rester sur le thread de rendu.
			fyne.Do(func() {
				statusLabel.SetText(fmt.Sprintf(
					"Port: %d\nMessages update recus: %d\nEntites inconnues: %d\nDerniere source: %s",
					*port, n, unk, src,
				))
				grid.Image = img
				grid.Refresh()
				dmxLabel.SetText(dmxText)
				if chOK {
					dmxGrid.Refresh()
				}
			})
		}
	}()

	win.ShowAndRun()
}
