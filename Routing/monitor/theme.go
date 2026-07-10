package main

import (
	"fmt"
	"image/color"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/theme"
)

// Palette "ember" reprise du front (front/src/styles/tokens.css), pour une
// harmonie visuelle entre le monitor et l'outil de création.
var (
	colApp     = hexColor("#0a0908")
	colPanel   = hexColor("#141210")
	colPanel2  = hexColor("#191614")
	colRow     = hexColor("#201c18")
	colRowHi   = hexColor("#2b241d")
	colLine    = color.NRGBA{R: 255, G: 220, B: 190, A: 26} // rgba(255,220,190,.1)
	colText    = hexColor("#efe8df")
	colDim     = hexColor("#948a7e")
	colFaint   = hexColor("#5d5449")
	colAccent  = hexColor("#ff8a3d")
	colAccFill = color.NRGBA{R: 255, G: 138, B: 61, A: 38} // rgba(...,.15)
	colAccGlow = color.NRGBA{R: 255, G: 138, B: 61, A: 71} // rgba(...,.28)
)

func hexColor(s string) color.Color {
	var r, g, b uint8
	fmt.Sscanf(s, "#%02x%02x%02x", &r, &g, &b)
	return color.NRGBA{R: r, G: g, B: b, A: 255}
}

// emberTheme applique la palette du front. Ignore le variant clair/sombre du
// système : le front lui-même impose sa palette sombre par défaut.
type emberTheme struct{}

var _ fyne.Theme = (*emberTheme)(nil)

func (emberTheme) Color(name fyne.ThemeColorName, variant fyne.ThemeVariant) color.Color {
	switch name {
	case theme.ColorNameBackground:
		return colApp
	case theme.ColorNameButton, theme.ColorNameOverlayBackground, theme.ColorNameScrollBarBackground:
		return colPanel
	case theme.ColorNameDisabledButton:
		return colRow
	case theme.ColorNameDisabled, theme.ColorNameScrollBar:
		return colFaint
	case theme.ColorNameForeground:
		return colText
	case theme.ColorNameForegroundOnPrimary:
		return colApp
	case theme.ColorNameHeaderBackground, theme.ColorNameInputBackground, theme.ColorNameMenuBackground:
		return colPanel2
	case theme.ColorNameHover, theme.ColorNamePressed:
		return colRowHi
	case theme.ColorNameHyperlink, theme.ColorNamePrimary:
		return colAccent
	case theme.ColorNameInputBorder, theme.ColorNameSeparator:
		return colLine
	case theme.ColorNamePlaceHolder:
		return colDim
	case theme.ColorNameFocus:
		return colAccGlow
	case theme.ColorNameSelection:
		return colAccFill
	}
	return theme.DefaultTheme().Color(name, variant)
}

func (emberTheme) Font(style fyne.TextStyle) fyne.Resource {
	return theme.DefaultTheme().Font(style)
}

func (emberTheme) Icon(name fyne.ThemeIconName) fyne.Resource {
	return theme.DefaultTheme().Icon(name)
}

func (emberTheme) Size(name fyne.ThemeSizeName) float32 {
	switch name {
	case theme.SizeNameInputRadius, theme.SizeNameSelectionRadius:
		return 4
	}
	return theme.DefaultTheme().Size(name)
}
