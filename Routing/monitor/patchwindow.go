package main

// Fenêtre dédiée "Contrôleurs & Univers" : cartes cliquables par contrôleur
// (aspect matériel), navigation vers ses univers, création/édition/
// suppression manuelle. Opère sur une copie de travail de Config.Patch,
// appliquée d'un coup via applyFn (bouton "Appliquer") — jamais de mutation
// partielle de la config réelle pendant l'édition.

import (
	"fmt"
	"strconv"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/dialog"
	"fyne.io/fyne/v2/widget"

	"ledtest/wall"
)

// uniqueIPsInOrder liste les IP distinctes d'un jeu de lignes, dans l'ordre
// de première apparition — utilisé pour déduire Config.ControllerIPs d'un
// patch (import CSV ou édition manuelle).
func uniqueIPsInOrder(rows []wall.PatchRow) []string {
	var out []string
	seen := map[string]bool{}
	for _, r := range rows {
		if !seen[r.IP] {
			seen[r.IP] = true
			out = append(out, r.IP)
		}
	}
	return out
}

type patchEditor struct {
	win  fyne.Window
	rows []wall.PatchRow
	body *fyne.Container
}

// showPatchWindow ouvre la fenêtre d'édition. `cfg` fournit le point de
// départ (patch existant, ou généré depuis la formule si vide) ; `applyFn`
// reçoit les lignes définitives quand l'utilisateur clique "Appliquer".
func showPatchWindow(a fyne.App, cfg wall.Config, applyFn func(rows []wall.PatchRow)) {
	win := a.NewWindow("Controleurs & Univers")
	win.Resize(fyne.NewSize(760, 580))

	rows := make([]wall.PatchRow, len(cfg.Patch))
	copy(rows, cfg.Patch)

	e := &patchEditor{win: win, rows: rows, body: container.NewVBox()}
	e.showControllers()

	applyBtn := widget.NewButton("Appliquer", func() {
		applyFn(e.rows)
		win.Close()
	})
	cancelBtn := widget.NewButton("Annuler", func() {
		win.Close()
	})

	win.SetContent(container.NewBorder(
		nil,
		container.NewGridWithColumns(2, applyBtn, cancelBtn),
		nil, nil,
		container.NewVScroll(e.body),
	))
	win.Show()
}

func (e *patchEditor) ips() []string {
	return uniqueIPsInOrder(e.rows)
}

// showControllers affiche la grille de "cartes" contrôleurs (aspect
// matériel) : clic -> univers de ce contrôleur.
func (e *patchEditor) showControllers() {
	grid := container.NewGridWrap(fyne.NewSize(170, 70))
	for _, ip := range e.ips() {
		ip := ip
		count := 0
		for _, r := range e.rows {
			if r.IP == ip {
				count++
			}
		}
		btn := widget.NewButton(fmt.Sprintf("▤ %s\n%d univers", ip, count), func() {
			e.showUniverses(ip)
		})
		grid.Add(btn)
	}
	addBtn := widget.NewButton("+ Ajouter\nun controleur", func() { e.promptNewController() })
	grid.Add(addBtn)

	e.body.Objects = []fyne.CanvasObject{
		widget.NewLabelWithStyle("Controleurs (cliquer pour voir/editer ses univers)", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		grid,
	}
	e.body.Refresh()
}

func (e *patchEditor) promptNewController() {
	entry := widget.NewEntry()
	entry.SetPlaceHolder("192.168.1.49")
	dialog.ShowCustomConfirm("Nouveau controleur", "Ajouter", "Annuler", entry, func(ok bool) {
		if !ok || entry.Text == "" {
			return
		}
		ip := entry.Text
		e.rows = append(e.rows, wall.PatchRow{Name: "1", EntityStart: 0, EntityEnd: 0, IP: ip, Universe: 0})
		e.showUniverses(ip)
	}, e.win)
}

// showUniverses affiche les univers d'un contrôleur : une carte éditable par
// univers (nom, entité début/fin, numéro d'univers), + ajout/suppression.
func (e *patchEditor) showUniverses(ip string) {
	list := container.NewVBox()
	for i := range e.rows {
		if e.rows[i].IP != ip {
			continue
		}
		row := &e.rows[i]

		nameEntry := newEntry()
		nameEntry.SetText(row.Name)
		nameEntry.OnChanged = func(v string) { row.Name = v }

		universeEntry := intEntry(int(row.Universe))
		universeEntry.OnChanged = func(v string) {
			if n, err := strconv.Atoi(v); err == nil && n >= 0 {
				row.Universe = uint16(n)
			}
		}

		startEntry := intEntry(row.EntityStart)
		startEntry.OnChanged = func(v string) {
			if n, err := strconv.Atoi(v); err == nil {
				row.EntityStart = n
			}
		}

		endEntry := intEntry(row.EntityEnd)
		endEntry.OnChanged = func(v string) {
			if n, err := strconv.Atoi(v); err == nil {
				row.EntityEnd = n
			}
		}

		removeBtn := widget.NewButton("Retirer cet univers", func() {
			e.rows = append(e.rows[:i], e.rows[i+1:]...)
			e.showUniverses(ip)
		})

		list.Add(widget.NewCard("", "", container.NewVBox(
			container.NewGridWithColumns(2, widget.NewLabel("Nom (bande/fixture)"), nameEntry),
			container.NewGridWithColumns(2, widget.NewLabel("Univers ArtNet"), universeEntry),
			container.NewGridWithColumns(2, widget.NewLabel("Entite debut"), startEntry),
			container.NewGridWithColumns(2, widget.NewLabel("Entite fin"), endEntry),
			removeBtn,
		)))
	}
	if len(list.Objects) == 0 {
		list.Add(widget.NewLabel("(aucun univers pour ce controleur)"))
	}

	addUniverseBtn := widget.NewButton("+ Ajouter un univers", func() {
		var nextUniverse uint16
		var nextEntity int
		for _, r := range e.rows {
			if r.IP != ip {
				continue
			}
			if r.Universe+1 > nextUniverse {
				nextUniverse = r.Universe + 1
			}
			if r.EntityEnd+1 > nextEntity {
				nextEntity = r.EntityEnd + 1
			}
		}
		e.rows = append(e.rows, wall.PatchRow{EntityStart: nextEntity, EntityEnd: nextEntity, IP: ip, Universe: nextUniverse})
		e.showUniverses(ip)
	})

	removeControllerBtn := widget.NewButton("Supprimer ce controleur", func() {
		var kept []wall.PatchRow
		for _, r := range e.rows {
			if r.IP != ip {
				kept = append(kept, r)
			}
		}
		e.rows = kept
		e.showControllers()
	})

	backBtn := widget.NewButton("< Controleurs", func() { e.showControllers() })

	e.body.Objects = []fyne.CanvasObject{
		backBtn,
		widget.NewLabelWithStyle(fmt.Sprintf("Controleur %s", ip), fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		list,
		container.NewGridWithColumns(2, addUniverseBtn, removeControllerBtn),
	}
	e.body.Refresh()
}
