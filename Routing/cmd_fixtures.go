package main

import (
	"fmt"
	"time"

	"ledtest/artnet"
	"ledtest/wall"
)

// cmdFixtureTest pilote le projecteur et les 4 lyres directement via
// Frame.SetEntity (même chemin que cmdListen/le monitor face à un message
// eHuB), en contournant entièrement l'app de création. Si l'allumage d'un
// mauvais appareil se reproduit ici, le bug est dans le routage Go
// (adressage/Frame) ; si tout reste correctement isolé, le bug est côté front.
func cmdFixtureTest(cfg wall.Config, s *artnet.Sender, args []string) {
	frame := wall.NewFrame(cfg)
	var seq byte

	allOff := func() {
		for id := 1; id <= 83; id++ {
			frame.SetEntity(id, 0, 0, 0, 0)
		}
	}

	step := func(label string) {
		if err := frame.Flush(s, seq); err != nil {
			fmt.Println("erreur d'envoi ArtNet:", err)
		}
		seq++
		fmt.Println("--->", label)
		time.Sleep(4 * time.Second)
	}

	fmt.Println("=== Test fixtures (bypass front + eHuB) : regarde le vrai mur a chaque etape (pause 4s) ===")
	allOff()
	step("Tout eteint (etat de depart)")

	// Projecteur seul : entites 1-4 = R,G,B,W (canaux 1-4 de l'univers 33).
	frame.SetEntity(1, 255, 0, 0, 0)
	frame.SetEntity(2, 255, 0, 0, 0)
	frame.SetEntity(3, 255, 0, 0, 0)
	frame.SetEntity(4, 255, 0, 0, 0)
	step("PROJECTEUR seul, blanc plein -> les 4 LYRES doivent rester eteintes/immobiles")

	allOff()
	step("Tout eteint")

	// Chaque lyre : pan/tilt bouges + dimmer/couleur allumes (canaux relatifs a
	// sa base, cf. LYRE_CHANNEL_ORDER : pan=+0, tilt=+2, dimmer=+5, r/g/b=+7/+8/+9).
	lyreBases := []int{10, 30, 50, 70}
	colors := [][3]byte{{255, 0, 0}, {0, 255, 0}, {0, 0, 255}, {255, 255, 255}}
	for i, base := range lyreBases {
		c := colors[i]
		frame.SetEntity(base, 200, 0, 0, 0)    // pan
		frame.SetEntity(base+2, 200, 0, 0, 0)  // tilt
		frame.SetEntity(base+5, 255, 0, 0, 0)  // dimmer
		frame.SetEntity(base+7, c[0], 0, 0, 0) // r
		frame.SetEntity(base+8, c[1], 0, 0, 0) // g
		frame.SetEntity(base+9, c[2], 0, 0, 0) // b
		step(fmt.Sprintf(
			"LYRE %d seule (canaux %d-%d, pan/tilt bouges, allumee) -> le PROJECTEUR doit rester eteint, les autres lyres immobiles/eteintes",
			i+1, base, base+12,
		))
		allOff()
		step("Tout eteint")
	}

	fmt.Println("=== Fin du test : si a un moment le PROJECTEUR a reagi pendant une etape LYRE (ou l'inverse), note bien laquelle ===")
}
