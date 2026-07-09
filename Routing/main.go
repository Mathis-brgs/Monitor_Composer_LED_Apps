// Petit outil en ligne de commande pour tester le mur LED (partie routage) :
// il construit des paquets ArtNet et les envoie directement aux contrôleurs
// BC216, sans passer par un outil de création.
package main

import (
	"flag"
	"fmt"
	"net"
	"os"
	"sync"
	"time"

	"ledtest/artnet"
	"ledtest/ehub"
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

	cfg := wall.DefaultConfig()

	switch os.Args[1] {
	case "single":
		cmdSingle(cfg, sender, os.Args[2:])
	case "fill":
		cmdFill(cfg, sender, os.Args[2:])
	case "sweep":
		cmdSweep(cfg, sender, os.Args[2:])
	case "chase":
		cmdChase(cfg, sender, os.Args[2:])
	case "listen":
		cmdListen(cfg, sender, os.Args[2:])
	default:
		usage()
		os.Exit(1)
	}
}

func usage() {
	fmt.Println(`Usage: ledtest <commande> [options]

Toutes les commandes utilisent la configuration LAPS par defaut (wall.DefaultConfig) :
64 bandes / 4 controleurs (192.168.1.45-48). Pour une autre installation, utilisez le
monitor (go run ./monitor), qui permet de charger/modifier la configuration.

Commandes:
  single -strip N -led N -r N -g N -b N   Allume une seule LED
  fill   -strip N -r N -g N -b N          Remplit une bande (-strip 0 = tout le mur)
  sweep                                    Balaie chaque bande en rouge/vert/bleu (debug cablage)
  chase  -fps N                            Anime un point lumineux sur tout le mur (test perf/synchro)
  listen -port N -fps N                    Ecoute le flux eHuB (config+update) et le route vers ArtNet`)
}

func cmdSingle(cfg wall.Config, s *artnet.Sender, args []string) {
	fs := flag.NewFlagSet("single", flag.ExitOnError)
	strip := fs.Int("strip", 1, "numero de bande")
	led := fs.Int("led", 2, "numero de LED dans la bande")
	r := fs.Int("r", 255, "rouge (0-255)")
	g := fs.Int("g", 255, "vert (0-255)")
	b := fs.Int("b", 255, "bleu (0-255)")
	fs.Parse(args)

	f := wall.NewFrame(cfg)
	f.SetLED(*strip, *led, byte(*r), byte(*g), byte(*b))
	if err := f.Flush(s, 0); err != nil {
		fmt.Println("erreur d'envoi:", err)
		os.Exit(1)
	}
	ip, universe, ch := cfg.LEDAddress(*strip, *led)
	fmt.Printf("bande %d, LED %d -> IP %s, univers %d, canaux %d-%d : (%d,%d,%d)\n",
		*strip, *led, ip, universe, ch, ch+2, *r, *g, *b)
}

func cmdFill(cfg wall.Config, s *artnet.Sender, args []string) {
	fs := flag.NewFlagSet("fill", flag.ExitOnError)
	strip := fs.Int("strip", 0, "numero de bande (0 = tout le mur)")
	r := fs.Int("r", 255, "rouge (0-255)")
	g := fs.Int("g", 0, "vert (0-255)")
	b := fs.Int("b", 0, "bleu (0-255)")
	fs.Parse(args)

	strips := []int{*strip}
	if *strip == 0 {
		strips = make([]int, cfg.StripCount())
		for i := range strips {
			strips[i] = i + 1
		}
	}

	f := wall.NewFrame(cfg)
	for _, st := range strips {
		for led := 1; led <= cfg.LEDsPerStrip(); led++ {
			if !cfg.IsVisible(led) {
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
func cmdSweep(cfg wall.Config, s *artnet.Sender, args []string) {
	colors := [][3]byte{{255, 0, 0}, {0, 255, 0}, {0, 0, 255}}
	for _, c := range colors {
		for st := 1; st <= cfg.StripCount(); st++ {
			on := wall.NewFrame(cfg)
			for led := 1; led <= cfg.LEDsPerStrip(); led++ {
				if cfg.IsVisible(led) {
					on.SetLED(st, led, c[0], c[1], c[2])
				}
			}
			on.Flush(s, 0)
			fmt.Printf("bande %d en (%d,%d,%d)\n", st, c[0], c[1], c[2])
			time.Sleep(150 * time.Millisecond)

			off := wall.NewFrame(cfg)
			for led := 1; led <= cfg.LEDsPerStrip(); led++ {
				if cfg.IsVisible(led) {
					off.SetLED(st, led, 0, 0, 0)
				}
			}
			off.Flush(s, 0)
		}
	}
}

// cmdChase fait défiler un point lumineux sur tout le mur, utile pour
// vérifier la fluidité/synchronisation (pas de saccades, pas d'artefacts).
func cmdChase(cfg wall.Config, s *artnet.Sender, args []string) {
	fs := flag.NewFlagSet("chase", flag.ExitOnError)
	fps := fs.Int("fps", 24, "images par seconde (limite fixee par le prof : 24 fps max)")
	fs.Parse(args)

	ticker := time.NewTicker(time.Second / time.Duration(*fps))
	defer ticker.Stop()

	visiblePerStrip := 2 * cfg.Height
	total := cfg.StripCount() * visiblePerStrip
	pos := 0
	prevStrip, prevLed := 0, 0
	var seq byte

	fmt.Println("chase en cours, Ctrl+C pour arreter")
	for range ticker.C {
		strip := pos/visiblePerStrip + 1
		led := cfg.VisibleLEDIndex(pos % visiblePerStrip)

		f := wall.NewFrame(cfg)
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

// cmdListen écoute le flux eHuB envoyé par l'outil de création (config +
// update), et route chaque état reçu vers les contrôleurs via ArtNet. C'est
// le module de routage proprement dit : il ne connaît rien de l'origine des
// couleurs (Unity, Tan, ...), seulement le protocole eHuB en entrée et le
// mapping entité -> bande/LED (ou canal DMX brut pour les lyres/projecteur)
// en sortie.
//
// Réception et envoi sont découplés : l'émetteur peut envoyer son état en de
// nombreux petits messages UDP par seconde (un `update` eHuB dépasse vite la
// taille qu'un datagramme UDP peut transporter d'un coup, voir ehub.go), mais
// on ne veut surtout pas déclencher un envoi ArtNet par message reçu — ça
// génère beaucoup plus de paquets que nécessaire et peut saturer le buffer
// d'envoi local (ENOBUFS). On accumule donc l'état dans `frame` au fil de la
// réception, et on ne flush vers ArtNet qu'à une cadence contrôlée (-fps).
func cmdListen(cfg wall.Config, s *artnet.Sender, args []string) {
	fs := flag.NewFlagSet("listen", flag.ExitOnError)
	port := fs.Int("port", 8765, "port UDP sur lequel ecouter les messages eHuB")
	fps := fs.Int("fps", 24, "frequence d'envoi vers ArtNet (Hz), decouplee de la reception (limite fixee par le prof : 24 fps max)")
	fs.Parse(args)

	conn, err := net.ListenUDP("udp", &net.UDPAddr{Port: *port})
	if err != nil {
		fmt.Println("erreur d'ecoute UDP:", err)
		os.Exit(1)
	}
	defer conn.Close()

	frame := wall.NewFrame(cfg)
	var mu sync.Mutex
	var fixtureData [512]byte
	fixtureDirty := false
	unknownEntities := 0
	updateCount := 0

	go func() {
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
			case ehub.TypeConfig:
				ranges, err := ehub.DecodeConfig(payload, header.Count)
				if err != nil {
					fmt.Println("config eHuB invalide:", err)
					continue
				}
				fmt.Printf("config eHuB recue (univers eHuB %d) : %d plage(s)\n", header.EhubUniverse, len(ranges))

			case ehub.TypeUpdate:
				entities, err := ehub.DecodeUpdate(payload, header.Count)
				if err != nil {
					fmt.Println("update eHuB invalide:", err)
					continue
				}

				mu.Lock()
				for _, e := range entities {
					if strip, led, ok := cfg.EntityLocation(int(e.ID)); ok {
						frame.SetLED(strip, led, e.R, e.G, e.B)
						continue
					}
					if _, _, ch, ok := cfg.FixtureChannel(int(e.ID)); ok {
						fixtureData[ch] = e.R
						fixtureDirty = true
						continue
					}
					unknownEntities++
					if unknownEntities == 1 {
						fmt.Printf("entite eHuB inconnue: %d (ignoree, ce message ne s'affiche qu'une fois)\n", e.ID)
					}
				}
				mu.Unlock()

				updateCount++
				if updateCount%200 == 0 {
					fmt.Printf("update eHuB #%d recu de %s (%d entites dans ce message)\n", updateCount, src, len(entities))
				}

			default:
				fmt.Printf("type de message eHuB inconnu (%d) de %s\n", header.Type, src)
			}
		}
	}()

	ticker := time.NewTicker(time.Second / time.Duration(*fps))
	defer ticker.Stop()
	var seq byte

	fmt.Printf("ecoute eHuB sur le port %d, envoi ArtNet a %d Hz, Ctrl+C pour arreter\n", *port, *fps)
	for range ticker.C {
		mu.Lock()
		sendFixture := fixtureDirty
		fixtureDirty = false
		var fixtureSnapshot [512]byte
		if sendFixture {
			fixtureSnapshot = fixtureData
		}
		flushErr := frame.Flush(s, seq)
		mu.Unlock()

		if flushErr != nil {
			fmt.Println("erreur d'envoi ArtNet:", flushErr)
		}
		if sendFixture {
			ip, universe, _, _ := cfg.FixtureChannel(1)
			if err := s.Send(ip, universe, seq, fixtureSnapshot[:]); err != nil {
				fmt.Println("erreur d'envoi ArtNet (fixtures):", err)
			}
		}
		seq++
	}
}
