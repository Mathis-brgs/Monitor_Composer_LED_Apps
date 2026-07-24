package main

import (
	"math"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/theme"
)

// responsiveGrid dispose ses enfants en grille dont le nombre de colonnes
// s'adapte à la largeur RÉELLEMENT disponible (recalculé à chaque Layout,
// donc à chaque redimensionnement de la fenêtre) — contrairement à
// container.NewGridWithColumns qui force toujours le même nombre de colonnes
// et empêche la fenêtre de descendre sous sa largeur totale.
//
// Chaque colonne fait au moins minCellWidth de large ; le nombre de colonnes
// ne dépasse jamais maxCols. Les enfants d'une même ligne partagent la
// hauteur de la ligne (la plus grande MinSize parmi eux).
type responsiveGrid struct {
	minCellWidth float32
	maxCols      int
}

// newResponsiveGrid crée un conteneur en grille adaptative : sur une fenêtre
// large, jusqu'à maxCols colonnes côte à côte ; sur une fenêtre étroite, les
// enfants passent automatiquement en colonne unique (empilés).
func newResponsiveGrid(minCellWidth float32, maxCols int, objects ...fyne.CanvasObject) *fyne.Container {
	return fyne.NewContainerWithLayout(&responsiveGrid{minCellWidth: minCellWidth, maxCols: maxCols}, objects...)
}

func visibleObjects(objects []fyne.CanvasObject) []fyne.CanvasObject {
	var out []fyne.CanvasObject
	for _, o := range objects {
		if o.Visible() {
			out = append(out, o)
		}
	}
	return out
}

func (r *responsiveGrid) columns(width float32, n int) int {
	cols := int(width / r.minCellWidth)
	if cols < 1 {
		cols = 1
	}
	if cols > r.maxCols {
		cols = r.maxCols
	}
	if cols > n {
		cols = n
	}
	return cols
}

func (r *responsiveGrid) MinSize(objects []fyne.CanvasObject) fyne.Size {
	visible := visibleObjects(objects)
	if len(visible) == 0 {
		return fyne.NewSize(0, 0)
	}
	// Largeur mini = 1 seule colonne (la fenêtre doit pouvoir descendre
	// jusque-là) : le plus large enfant. Hauteur mini = empilement complet.
	var w, h float32
	for _, o := range visible {
		m := o.MinSize()
		if m.Width > w {
			w = m.Width
		}
		h += m.Height
	}
	if len(visible) > 1 {
		h += float32(len(visible)-1) * theme.Padding()
	}
	return fyne.NewSize(w, h)
}

func (r *responsiveGrid) Layout(objects []fyne.CanvasObject, size fyne.Size) {
	visible := visibleObjects(objects)
	if len(visible) == 0 {
		return
	}
	pad := theme.Padding()
	cols := r.columns(size.Width, len(visible))
	rows := int(math.Ceil(float64(len(visible)) / float64(cols)))
	cellW := (size.Width - float32(cols-1)*pad) / float32(cols)

	rowHeights := make([]float32, rows)
	for i, o := range visible {
		row := i / cols
		if m := o.MinSize().Height; m > rowHeights[row] {
			rowHeights[row] = m
		}
	}

	var y float32
	for i, o := range visible {
		row, col := i/cols, i%cols
		x := float32(col) * (cellW + pad)
		o.Move(fyne.NewPos(x, y))
		o.Resize(fyne.NewSize(cellW, rowHeights[row]))
		if col == cols-1 || i == len(visible)-1 {
			y += rowHeights[row] + pad
		}
	}
}
