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
	"strings"
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

	// Aperçu compact (carte "Source"), et sa version agrandie dans une fenêtre à part
	// (même image sous-jacente, les deux sont rafraîchies ensemble à chaque tick).
	grid := canvas.NewImageFromImage(img)
	grid.ScaleMode = canvas.ImageScalePixels
	grid.FillMode = canvas.ImageFillContain
	grid.SetMinSize(fyne.NewSize(220, 220))

	gridBig := canvas.NewImageFromImage(img)
	gridBig.ScaleMode = canvas.ImageScalePixels
	gridBig.FillMode = canvas.ImageFillContain
	gridBig.SetMinSize(fyne.NewSize(640, 640))

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
		state.frame.SetLED(strip, led, r, g, b, 0)
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
			"Controleurs (%d): %s\nLargeur: %d colonnes  Hauteur: %d  Bandes: %d  Univers/bande: %d  Canaux/LED: %d (%s)\n%s",
			len(c.ControllerIPs), strings.Join(c.ControllerIPs, ", "),
			c.Width(), c.Height, c.StripCount(), c.UniversesPerStrip(), c.ChannelsPerLED(), c.ChannelOrder, regionInfo(c),
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

	// applyPatchRows remplace Config.Patch (source de verite si non vide, cf.
	// Config.ResolveEntity) et deduit ControllerIPs des IP presentes dans les
	// lignes — chemin commun a la fenetre "Controleurs & Univers" et a
	// l'import CSV.
	applyPatchRows := func(rows []wall.PatchRow) {
		newCfg := state.cfg
		newCfg.Patch = rows
		newCfg.ControllerIPs = uniqueIPsInOrder(rows)
		configErrorLabel.SetText("")
		state.applyConfig(newCfg)
		fields.load(newCfg)
		if len(newCfg.ControllerIPs) > 0 {
			ipSelect.SetOptions(newCfg.ControllerIPs)
			ipSelect.SetSelected(newCfg.ControllerIPs[0])
		}
		refreshConfigInfo(newCfg)
	}

	// --- import direct d'un patch CSV (Name, Entity Start, Entity End,
	// ArtNet IP, ArtNet Universe) : remplit toute la config d'un coup, sans
	// exiger que le fichier suive une formule uniforme.
	importBtn := widget.NewButton("Importer un patch (CSV)...", func() {
		dialog.ShowFileOpen(func(uc fyne.URIReadCloser, ferr error) {
			if ferr != nil || uc == nil {
				return
			}
			defer uc.Close()
			rows, err := wall.ParsePatchCSV(uc)
			if err != nil {
				configErrorLabel.SetText("Erreur d'import : " + err.Error())
				return
			}
			applyPatchRows(rows)
		}, win)
	})

	// --- fenetre dediee "Controleurs & Univers" : cartes cliquables par
	// controleur (aspect materiel), navigation vers ses univers, creation/
	// edition/suppression a la main. Genere depuis la formule au 1er lancement
	// si aucun patch n'existe encore.
	patchWindowBtn := widget.NewButton("Controleurs & Univers...", func() {
		showPatchWindow(a, state.cfg, applyPatchRows)
	})

	configPanel := container.NewVScroll(container.NewVBox(
		sectionTitle("Configuration physique"),
		widget.NewLabel("Controleurs : geres via \"Controleurs & Univers...\" ou l'import CSV, ci-dessous."),
		widget.NewLabel("Bandes par controleur"), fields.stripsPerCtrl,
		widget.NewLabel("Hauteur (LED visibles par colonne)"), fields.height,
		widget.NewLabel("Entite de depart"), fields.entityBase,
		widget.NewLabel("Ecart entites / controleur"), fields.entityPerQuarter,
		widget.NewLabel("Ecart entites / bande"), fields.entityPerStrip,
		widget.NewLabel("Ordre des canaux DMX (ex: rgb, grb, rgbw)"), fields.channelOrder,
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
		widget.NewSeparator(),

		sectionTitle("Controleurs & Univers"),
		widget.NewLabel("Vue detaillee/editable (patch explicite) ou import direct depuis un fichier."),
		container.NewGridWithColumns(2, patchWindowBtn, importBtn),
	))

	// Fenêtre secondaire (aperçu agrandi), cachée par défaut ; se cache (pas ferme) sur la croix.
	previewWin := a.NewWindow("Apercu du mur (agrandi)")
	previewWin.SetContent(container.NewScroll(gridBig))
	previewWin.Resize(fyne.NewSize(680, 680))
	previewVisible := false
	previewToggleBtn := widget.NewButton("Agrandir l'apercu", nil)
	previewToggleBtn.OnTapped = func() {
		if previewVisible {
			previewWin.Hide()
			previewToggleBtn.SetText("Agrandir l'apercu")
		} else {
			previewWin.Show()
			previewToggleBtn.SetText("Masquer l'apercu agrandi")
		}
		previewVisible = !previewVisible
	}
	previewWin.SetCloseIntercept(func() {
		previewWin.Hide()
		previewVisible = false
		previewToggleBtn.SetText("Agrandir l'apercu")
	})

	// --- Pipeline de routage (P8) : 3 cartes toujours visibles, mêmes étapes
	// que l'outil "Emitter Hub" du prof (source -> mapping -> sortie ArtNet).
	// Chaque carte a son propre "Show monitor" (comme le prof) : le contenu
	// live peut se cacher indépendamment sans perdre les réglages/contrôles.
	// Les outils de test (ci-dessous) restent à part, repliés par défaut.
	entityRangeLabel := widget.NewLabel("")

	sourceMonitor := container.NewVBox(statusLabel, grid)
	sourceCheck := widget.NewCheck("Show monitor", func(on bool) {
		if on {
			sourceMonitor.Show()
		} else {
			sourceMonitor.Hide()
		}
	})
	sourceCheck.SetChecked(true)
	sourceCard := widget.NewCard("1. eHuB -> Entites", "Reception UDP + apercu du mur", container.NewVBox(
		sourceCheck,
		sourceMonitor,
		previewToggleBtn,
	))

	mappingMonitor := container.NewVBox(configInfoLabel, entityRangeLabel)
	mappingCheck := widget.NewCheck("Show monitor", func(on bool) {
		if on {
			mappingMonitor.Show()
		} else {
			mappingMonitor.Hide()
		}
	})
	mappingCheck.SetChecked(true)
	mappingCard := widget.NewCard("2. Entites -> DMX", "Mapping entite -> bande/LED (formule de config.go)", container.NewVBox(
		mappingCheck,
		mappingMonitor,
		widget.NewLabel("Reglages complets : onglet Configuration"),
	))

	artnetMonitor := container.NewVBox(dmxGrid, dmxLabel)
	artnetCheck := widget.NewCheck("Show monitor", func(on bool) {
		if on {
			artnetMonitor.Show()
		} else {
			artnetMonitor.Hide()
		}
	})
	artnetCheck.SetChecked(true)
	artnetCard := widget.NewCard("3. DMX -> ArtNet", "Canaux bruts envoyes au controleur choisi (port ArtNet standard : 6454)", container.NewVBox(
		container.NewGridWithColumns(2,
			widget.NewLabel("Adresse IP"), ipSelect,
			widget.NewLabel("Univers"), universeEntry,
		),
		artnetCheck,
		artnetMonitor,
	))

	pipelineRow := container.NewGridWithColumns(3, sourceCard, mappingCard, artnetCard)

	toolsAccordion := widget.NewAccordion(
		widget.NewAccordionItem("Couleur", container.NewVBox(
			swatch,
			widget.NewLabel("Rouge (0-255)"), rEntry,
			widget.NewLabel("Vert (0-255)"), gEntry,
			widget.NewLabel("Bleu (0-255)"), bEntry,
		)),
		widget.NewAccordionItem("Test manuel (bande/LED)", container.NewVBox(
			widget.NewLabel("Bande"), stripEntry,
			widget.NewLabel("LED"), ledEntry,
			setLedBtn,
			fillStripBtn,
			widget.NewSeparator(),
			fillAllBtn,
			clearBtn,
		)),
		widget.NewAccordionItem("Mode univers brut (ID)", container.NewVBox(
			widget.NewLabel("IP/univers : voir la carte \"DMX -> ArtNet\" ci-dessus"),
			widget.NewLabel("ID debut"), startIDEntry,
			widget.NewLabel("ID fin"), endIDEntry,
			rawSendBtn,
		)),
	)

	monitoringPanel := container.NewVScroll(container.NewVBox(
		pipelineRow,
		widget.NewSeparator(),
		sectionTitle("Outils de test"),
		toolsAccordion,
	))

	tabs := container.NewAppTabs(
		container.NewTabItem("Monitoring", monitoringPanel),
		container.NewTabItem("Configuration", configPanel),
	)
	win.SetContent(tabs)
	win.Resize(fyne.NewSize(1000, 760))

	go state.listenEhub(*port)
	go runArtnetFlushLoop(state, sender, *fps)
	go runPreviewLoop(state, ipSelect, universeEntry, *port, img, grid, gridBig, dmxImg, dmxGrid, dmxLabel, statusLabel, entityRangeLabel)

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
		snapshot := state.frame.Snapshot() // copie memoire pure, verrou tenu tres brievement
		state.mu.Unlock()

		// envoi reseau HORS verrou : ne bloque jamais la reception eHuB
		if err := wall.SendSnapshot(sender, seq, snapshot); err != nil {
			fmt.Println("erreur d'envoi ArtNet:", err)
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
	gridBig *canvas.Image,
	dmxImg *image.RGBA,
	dmxGrid *canvas.Image,
	dmxLabel, statusLabel, entityRangeLabel *widget.Label,
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
		rangeMin, rangeMax, rangeOK := cfg.EntityRangeForIP(monitorIP)
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
				r, g, b, _ := frame.GetLED(strip, led)
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
		rangeText := fmt.Sprintf("Entites -> %s : aucune (IP hors config)", monitorIP)
		if rangeOK {
			rangeText = fmt.Sprintf("Entites -> %s : %d a %d", monitorIP, rangeMin, rangeMax)
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
			gridBig.Image = img
			gridBig.Refresh()
			dmxLabel.SetText(dmxText)
			if chOK {
				dmxGrid.Image = newDmxImg
				dmxGrid.Refresh()
			}
			entityRangeLabel.SetText(rangeText)
		})
	}
}
