package main

import (
	"flag"
	"fmt"
	"os"

	"ledtest/wall"
)

// cmdGenCSV génère un patch CSV (format wall.ParsePatchCSV) pour un
// sous-carré bas-gauche de L'INSTALLATION RÉELLE (wall.DefaultConfig : mêmes
// bandes, même hauteur physique 128, mêmes 4 IP/EntityBase/Quarter/Strip) —
// pas une installation raccourcie. Les ID d'entité produits sont ceux du vrai
// mur pour ce même coin (wall.GenerateRegionPatchRows), donc un contenu conçu
// pour le coin bas-gauche du mur réel pilote exactement les mêmes LED sur un
// banc de test qui ne câble que ce coin.
func cmdGenCSV(args []string) {
	def := wall.DefaultConfig()

	fs := flag.NewFlagSet("gencsv", flag.ExitOnError)
	width := fs.Int("width", 0, "largeur du sous-carre, coin bas-gauche (ex: 32 ou 64) (requis)")
	height := fs.Int("height", 0, "hauteur du sous-carre, coin bas-gauche (defaut: = -width)")
	fixtures := fs.Bool("fixtures", true, "ajouter les lignes lyres/projecteur (fixes, independantes de la zone choisie)")
	out := fs.String("out", "", "fichier CSV de sortie (defaut: stdout)")
	fs.Parse(args)

	if *width <= 0 {
		fmt.Println("gencsv: -width est requis (ex: -width 32)")
		os.Exit(1)
	}
	h := *height
	if h <= 0 {
		h = *width
	}
	if *width > def.Width() || h > def.Height {
		fmt.Printf("gencsv: le mur reel ne fait que %dx%d, impossible d'en extraire un carre de %dx%d\n", def.Width(), def.Height, *width, h)
		os.Exit(1)
	}

	rows := wall.GenerateRegionPatchRows(def, *width, h, *fixtures)

	fmt.Fprintf(os.Stderr, "gencsv: coin bas-gauche %dx%d du mur reel (%d ligne(s) au total)\n", *width, h, len(rows))

	w := os.Stdout
	if *out != "" {
		f, err := os.Create(*out)
		if err != nil {
			fmt.Println("gencsv: erreur de creation du fichier:", err)
			os.Exit(1)
		}
		defer f.Close()
		w = f
	}
	if err := wall.WritePatchCSV(w, rows); err != nil {
		fmt.Println("gencsv: erreur d'ecriture CSV:", err)
		os.Exit(1)
	}
	if *out != "" {
		fmt.Fprintf(os.Stderr, "gencsv: ecrit dans %s\n", *out)
	}
}
