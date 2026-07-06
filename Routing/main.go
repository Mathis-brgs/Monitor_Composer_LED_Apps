// Petit outil en ligne de commande pour tester le mur LED (partie routage) :
// il construit des paquets ArtNet et les envoie directement aux contrôleurs
// BC216, sans passer par un outil de création.
package main

import (
	"flag"
	"fmt"
	"os"
	"time"

	"ledtest/artnet"
	"ledtest/wall"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(1)
	}

	sender, err := artnet.NewSender()
	if err != nil {
		fmt.Println("erreur d'ouverture du socket UDP:", err)
		os.Exit(1)
	}
	defer sender.Close()

	switch os.Args[1] {
	case "single":
		cmdSingle(sender, os.Args[2:])
	case "fill":
		cmdFill(sender, os.Args[2:])
	case "sweep":
		cmdSweep(sender, os.Args[2:])
	case "chase":
		cmdChase(sender, os.Args[2:])
	default:
		usage()
		os.Exit(1)
	}
}

func usage() {
	fmt.Println(`Usage: ledtest <commande> [options]

Commandes:
  single -strip N -led N -r N -g N -b N   Allume une seule LED
  fill   -strip N -r N -g N -b N          Remplit une bande (-strip 0 = tout le mur)
  sweep                                    Balaie chaque bande en rouge/vert/bleu (debug cablage)
  chase  -fps N                            Anime un point lumineux sur tout le mur (test perf/synchro)`)
}

func cmdSingle(s *artnet.Sender, args []string) {
	fs := flag.NewFlagSet("single", flag.ExitOnError)
	strip := fs.Int("strip", 1, "numero de bande (1-64)")
	led := fs.Int("led", 2, "numero de LED dans la bande (1-259)")
	r := fs.Int("r", 255, "rouge (0-255)")
	g := fs.Int("g", 255, "vert (0-255)")
	b := fs.Int("b", 255, "bleu (0-255)")
	fs.Parse(args)

	f := wall.NewFrame()
	f.SetLED(*strip, *led, byte(*r), byte(*g), byte(*b))
	if err := f.Flush(s, 0); err != nil {
		fmt.Println("erreur d'envoi:", err)
		os.Exit(1)
	}
	ip, universe, ch := wall.LEDAddress(*strip, *led)
	fmt.Printf("bande %d, LED %d -> IP %s, univers %d, canaux %d-%d : (%d,%d,%d)\n",
		*strip, *led, ip, universe, ch, ch+2, *r, *g, *b)
}

func cmdFill(s *artnet.Sender, args []string) {
	fs := flag.NewFlagSet("fill", flag.ExitOnError)
	strip := fs.Int("strip", 0, "numero de bande (0 = tout le mur)")
	r := fs.Int("r", 255, "rouge (0-255)")
	g := fs.Int("g", 0, "vert (0-255)")
	b := fs.Int("b", 0, "bleu (0-255)")
	fs.Parse(args)

	strips := []int{*strip}
	if *strip == 0 {
		strips = make([]int, wall.StripCount)
		for i := range strips {
			strips[i] = i + 1
		}
	}

	f := wall.NewFrame()
	for _, st := range strips {
		for led := 1; led <= wall.LEDsPerStrip; led++ {
			if !wall.IsVisible(led) {
				continue
			}
			f.SetLED(st, led, byte(*r), byte(*g), byte(*b))
		}
	}
	if err := f.Flush(s, 0); err != nil {
		fmt.Println("erreur d'envoi:", err)
		os.Exit(1)
	}
	fmt.Println("remplissage envoye")
}

// cmdSweep allume chaque bande une par une en rouge/vert/bleu : pratique
// pour vérifier visuellement que le mapping bande -> IP/univers est correct.
func cmdSweep(s *artnet.Sender, args []string) {
	colors := [][3]byte{{255, 0, 0}, {0, 255, 0}, {0, 0, 255}}
	for _, c := range colors {
		for st := 1; st <= wall.StripCount; st++ {
			on := wall.NewFrame()
			for led := 1; led <= wall.LEDsPerStrip; led++ {
				if wall.IsVisible(led) {
					on.SetLED(st, led, c[0], c[1], c[2])
				}
			}
			on.Flush(s, 0)
			fmt.Printf("bande %d en (%d,%d,%d)\n", st, c[0], c[1], c[2])
			time.Sleep(150 * time.Millisecond)

			off := wall.NewFrame()
			for led := 1; led <= wall.LEDsPerStrip; led++ {
				if wall.IsVisible(led) {
					off.SetLED(st, led, 0, 0, 0)
				}
			}
			off.Flush(s, 0)
		}
	}
}

// cmdChase fait défiler un point lumineux sur tout le mur, utile pour
// vérifier la fluidité/synchronisation (pas de saccades, pas d'artefacts).
func cmdChase(s *artnet.Sender, args []string) {
	fs := flag.NewFlagSet("chase", flag.ExitOnError)
	fps := fs.Int("fps", 30, "images par seconde")
	fs.Parse(args)

	ticker := time.NewTicker(time.Second / time.Duration(*fps))
	defer ticker.Stop()

	total := wall.StripCount * wall.VisiblePerStrip
	pos := 0
	prevStrip, prevLed := 0, 0
	var seq byte

	fmt.Println("chase en cours, Ctrl+C pour arreter")
	for range ticker.C {
		strip := pos/wall.VisiblePerStrip + 1
		led := wall.VisibleLEDIndex(pos % wall.VisiblePerStrip)

		f := wall.NewFrame()
		if prevStrip != 0 {
			f.SetLED(prevStrip, prevLed, 0, 0, 0)
		}
		f.SetLED(strip, led, 0, 255, 255)
		if err := f.Flush(s, seq); err != nil {
			fmt.Println("erreur d'envoi:", err)
		}

		seq++
		prevStrip, prevLed = strip, led
		pos = (pos + 1) % total
	}
}
