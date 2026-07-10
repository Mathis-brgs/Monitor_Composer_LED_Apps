// Application de monitoring/debug (P8) : visualise en direct l'état du mur
// et permet de tester le routage sans dépendre du front. Permet aussi de
// modifier la configuration physique depuis l'application (P1). Application
// desktop native (Fyne). Réutilise les mêmes packages que le CLI "Routing".
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"os"
	"strconv"
	"time"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/app"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/dialog"
	"fyne.io/fyne/v2/widget"

	"ledtest/artnet"
	"ledtest/wall"
)

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
	a.Settings().SetTheme(emberTheme{})
	win := a.NewWindow("LED Monitor")

	img := image.NewRGBA(image.Rect(0, 0, state.cfg.Width()*cellSize, state.cfg.Height*cellSize))
	grid := canvas.NewImageFromImage(img)
	grid.ScaleMode = canvas.ImageScalePixels
	grid.FillMode = canvas.ImageFillContain
	grid.SetMinSize(fyne.NewSize(640, 640))

	// Grille DMX : IP/univers partagés avec "Mode univers brut" plus bas.
	dmxImg := image.NewRGBA(image.Rect(0, 0, dmxCols*dmxCellSize, dmxRows*dmxCellSize))
	dmxGrid := canvas.NewImageFromImage(dmxImg)
	dmxGrid.ScaleMode = canvas.ImageScalePixels
	dmxGrid.FillMode = canvas.ImageFillContain
	dmxGrid.SetMinSize(fyne.NewSize(dmxCols*dmxCellSize, dmxRows*dmxCellSize))
	dmxLabel := widget.NewLabel("Canaux DMX : univers introuvable")

	statusLabel := widget.NewLabel("en attente de donnees eHuB...")

	// --- couleur courante ---
	rEntry, gEntry, bEntry := intEntry(255), intEntry(255), intEntry(255)
	swatch := canvas.NewRectangle(color.White)
	swatch.SetMinSize(fyne.NewSize(60, 30))

	currentColor := func() (byte, byte, byte) {
		clamp := func(e *widget.Entry) byte {
			n, _ := strconv.Atoi(e.Text)
			if n < 0 {
				return 0
			}
			if n > 255 {
				return 255
			}
			return byte(n)
		}
		return clamp(rEntry), clamp(gEntry), clamp(bEntry)
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
	stripEntry, ledEntry := intEntry(1), intEntry(2)

	setLedBtn := widget.NewButton("Allumer cette LED", func() {
		strip, err1 := atoi(stripEntry, "")
		led, err2 := atoi(ledEntry, "")
		if err1 != nil || err2 != nil {
			return
		}
		r, g, b := currentColor()
		state.mu.Lock()
		state.frame.SetLED(strip, led, r, g, b)
		state.mu.Unlock()
	})

	fillStripBtn := widget.NewButton("Remplir cette bande", func() {
		strip, err := atoi(stripEntry, "")
		if err != nil {
			return
		}
		r, g, b := currentColor()
		state.mu.Lock()
		setStripLEDs(state.frame, state.cfg, strip, r, g, b)
		state.mu.Unlock()
	})

	fillAllBtn := widget.NewButton("Tout remplir", func() {
		r, g, b := currentColor()
		state.mu.Lock()
		setAllLEDs(state.frame, state.cfg, r, g, b, true)
		state.mu.Unlock()
	})

	clearBtn := widget.NewButton("Tout eteindre", func() {
		state.mu.Lock()
		setAllLEDs(state.frame, state.cfg, 0, 0, 0, false)
		state.mu.Unlock()
		state.clearRaw()
	})

	// --- mode univers brut : adressage direct IP/univers/ID, sans passer par
	// bande/LED — utile pour tester le cablage independamment du modele ---
	ipSelect := widget.NewSelect(state.cfg.ControllerIPs, nil)
	ipSelect.SetSelected(state.cfg.ControllerIPs[0])
	universeEntry := intEntry(0)
	startIDEntry, endIDEntry := intEntry(1), intEntry(10)

	rawSendBtn := widget.NewButton("Allumer cette plage (univers brut)", func() {
		universe, err1 := atoi(universeEntry, "")
		startID, err2 := atoi(startIDEntry, "")
		endID, err3 := atoi(endIDEntry, "")
		if err1 != nil || err2 != nil || err3 != nil || ipSelect.Selected == "" || startID < 1 || endID < startID {
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
		// Si (ip, univers) correspond a une bande de la config actuelle, on
		// ecrit dans frame comme les autres modes (etat toujours a jour, pas
		// de "dernier envoi" fige). Sinon (univers hors config, ex: test d'un
		// univers arbitraire), on garde une trace a part juste pour l'affichage.
		state.mu.Lock()
		mapped := state.frame.SetRaw(ipSelect.Selected, uint16(universe), buf[:])
		state.mu.Unlock()
		if !mapped {
			state.setRaw(ipSelect.Selected, uint16(universe), buf[:])
		}
		if err := sender.Send(ipSelect.Selected, uint16(universe), 0, buf[:]); err != nil {
			fmt.Println("erreur d'envoi ArtNet (mode univers):", err)
		}
	})

	// --- configuration (P1) ---
	fields := newConfigFields(state.cfg)
	configInfoLabel := widget.NewLabel("")
	configErrorLabel := widget.NewLabel("")

	refreshConfigInfo := func(c wall.Config) {
		configInfoLabel.SetText(fmt.Sprintf(
			"Largeur: %d colonnes  Hauteur: %d  Bandes: %d  Univers/bande: %d\n%s",
			c.Width(), c.Height, c.StripCount(), c.UniversesPerStrip(), regionInfo(c),
		))
	}
	refreshConfigInfo(state.cfg)

	applyConfigFromFields := func(onOK func(wall.Config)) {
		newCfg, err := fields.parse()
		if err != nil {
			configErrorLabel.SetText("Erreur : " + err.Error())
			return
		}
		configErrorLabel.SetText("")
		onOK(newCfg)
	}

	applyBtn := widget.NewButton("Appliquer", func() {
		applyConfigFromFields(func(newCfg wall.Config) {
			state.applyConfig(newCfg)
			ipSelect.SetOptions(newCfg.ControllerIPs)
			ipSelect.SetSelected(newCfg.ControllerIPs[0])
			refreshConfigInfo(newCfg)
		})
	})

	saveBtn := widget.NewButton("Sauvegarder...", func() {
		applyConfigFromFields(func(newCfg wall.Config) {
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
			fields.load(newCfg)
			ipSelect.SetOptions(newCfg.ControllerIPs)
			ipSelect.SetSelected(newCfg.ControllerIPs[0])
			refreshConfigInfo(newCfg)
		}, win)
	})

	configPanel := container.NewVScroll(container.NewVBox(
		sectionTitle("Configuration physique"),
		widget.NewLabel("IP des controleurs (separees par des virgules)"), fields.ips,
		widget.NewLabel("Bandes par controleur"), fields.stripsPerCtrl,
		widget.NewLabel("Hauteur (LED visibles par colonne)"), fields.height,
		widget.NewLabel("Entite de depart"), fields.entityBase,
		widget.NewLabel("Ecart entites / controleur"), fields.entityPerQuarter,
		widget.NewLabel("Ecart entites / bande"), fields.entityPerStrip,
		widget.NewSeparator(),

		sectionTitle("Zone active (optionnel)"),
		widget.NewLabel("N'adresse qu'une partie du mur ci-dessus, sans changer son cablage/adressage reel. Largeur=0 -> tout le mur."),
		widget.NewLabel("X debut (colonne, 1..Largeur)"), fields.regionX0,
		widget.NewLabel("Y debut (ligne, 0=bas)"), fields.regionY0,
		widget.NewLabel("Largeur de la zone"), fields.regionWidth,
		widget.NewLabel("Hauteur de la zone"), fields.regionHeight,
		container.NewGridWithColumns(3, applyBtn, saveBtn, loadBtn),
		configInfoLabel,
		configErrorLabel,
	))

	// Fenêtre secondaire, cachée par défaut ; se cache (pas ferme) sur la croix.
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

		sectionTitle("Couleur"),
		swatch,
		widget.NewLabel("Rouge (0-255)"), rEntry,
		widget.NewLabel("Vert (0-255)"), gEntry,
		widget.NewLabel("Bleu (0-255)"), bEntry,
		widget.NewSeparator(),

		sectionTitle("Test manuel (bande/LED)"),
		widget.NewLabel("Bande"), stripEntry,
		widget.NewLabel("LED"), ledEntry,
		setLedBtn,
		fillStripBtn,
		widget.NewSeparator(),
		fillAllBtn,
		clearBtn,
		widget.NewSeparator(),

		sectionTitle("Mode univers brut (IP/univers/ID)"),
		widget.NewLabel("Adresse IP"), ipSelect,
		widget.NewLabel("Univers"), universeEntry,
		widget.NewLabel("ID debut"), startIDEntry,
		widget.NewLabel("ID fin"), endIDEntry,
		rawSendBtn,
		widget.NewSeparator(),

		sectionTitle("Canaux DMX bruts de cet univers"),
		widget.NewLabel("512 canaux, noir=0, blanc=255, lecture gauche->droite puis haut->bas (3 canaux = 1 LED RVB)"),
		dmxGrid,
		dmxLabel,
		widget.NewSeparator(),

		sectionTitle("Etat eHuB"),
		statusLabel,
	))

	tabs := container.NewAppTabs(
		container.NewTabItem("Configuration", configPanel),
		container.NewTabItem("Controles", controlsPanel),
	)
	win.SetContent(tabs)
	win.Resize(fyne.NewSize(520, 700))

	go state.listenEhub(*port)
	go runArtnetFlushLoop(state, sender, *fps)
	go runPreviewLoop(state, ipSelect, universeEntry, *port, img, grid, dmxImg, dmxGrid, dmxLabel, statusLabel)

	win.ShowAndRun()
}

// runArtnetFlushLoop envoie l'état accumulé vers ArtNet à cadence contrôlée,
// découplé de la réception eHuB (voir cmdListen du CLI pour le pourquoi).
func runArtnetFlushLoop(state *sharedState, sender *artnet.Sender, fps int) {
	ticker := time.NewTicker(time.Second / time.Duration(fps))
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
}

// runPreviewLoop rafraîchit la grille du mur et la grille DMX (UI seulement,
// cadence plus faible que l'envoi ArtNet).
func runPreviewLoop(
	state *sharedState,
	ipSelect *widget.Select,
	universeEntry *widget.Entry,
	port int,
	img *image.RGBA,
	grid *canvas.Image,
	dmxImg *image.RGBA,
	dmxGrid *canvas.Image,
	dmxLabel, statusLabel *widget.Label,
) {
	ticker := time.NewTicker(150 * time.Millisecond)
	defer ticker.Stop()
	for range ticker.C {
		monitorIP := ipSelect.Selected
		monitorUniverse, _ := strconv.Atoi(universeEntry.Text)

		state.mu.Lock()
		cfg := state.cfg
		frame := state.frame
		n, unk, src := state.updateCount, state.unknownCount, state.lastSource
		channels, chOK := state.channelsFor(monitorIP, uint16(monitorUniverse))
		state.mu.Unlock()

		w, h := cfg.Width(), cfg.Height
		wantBounds := image.Rect(0, 0, w*cellSize, h*cellSize)
		if img.Bounds() != wantBounds {
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
		var newDmxImg *image.RGBA
		if chOK {
			// Nouvelle image a chaque tick (pas de mutation en place) : evite
			// tout risque que Fyne ne detecte pas un changement de contenu
			// sur un pointeur qui reste identique d'un refresh a l'autre.
			newDmxImg = image.NewRGBA(dmxImg.Bounds())
			drawChannelGrid(newDmxImg, channels)
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
				port, n, unk, src,
			))
			grid.Image = img
			grid.Refresh()
			dmxLabel.SetText(dmxText)
			if chOK {
				dmxGrid.Image = newDmxImg
				dmxGrid.Refresh()
			}
		})
	}
}
