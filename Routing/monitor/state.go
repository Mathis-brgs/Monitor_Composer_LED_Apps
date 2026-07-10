package main

import (
	"fmt"
	"net"
	"sync"

	"ledtest/ehub"
	"ledtest/wall"
)

// sharedState est accédé par la goroutine réseau, l'envoi ArtNet et l'UI ;
// un seul mutex protège l'ensemble. applyConfig repart d'une frame vide (un
// état ne se réinterprète pas dans une géométrie différente).
type sharedState struct {
	mu sync.Mutex

	cfg          wall.Config
	frame        *wall.Frame
	fixtureData  [512]byte
	fixtureDirty bool

	// Dernier envoi via "Mode univers brut" : ce mode écrit directement sur le
	// réseau sans passer par frame (par design, pour pouvoir tester n'importe
	// quel univers même hors du modèle). On garde une trace ici uniquement
	// pour que la preview/grille DMX puisse afficher ce qui a été envoyé, peu
	// importe le mode utilisé pour l'envoyer.
	rawIP       string
	rawUniverse uint16
	rawData     [512]byte
	rawValid    bool

	updateCount  int
	unknownCount int
	lastSource   string
}

// setRaw enregistre le dernier envoi "mode univers brut" pour que la preview
// puisse le montrer (voir commentaire sur les champs raw* ci-dessus).
func (s *sharedState) setRaw(ip string, universe uint16, data []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rawIP = ip
	s.rawUniverse = universe
	copy(s.rawData[:], data)
	s.rawValid = true
}

// clearRaw efface le dernier envoi "mode univers brut" mémorisé (utilisé par
// "Tout éteindre", pour ne pas laisser la preview bloquée dessus).
func (s *sharedState) clearRaw() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rawValid = false
}

// channelsFor renvoie ce qui doit être affiché pour (ip, univers) : la donnée
// "mode univers brut" si elle correspond ET ne fait pas partie de la config
// actuelle (sinon SetRaw l'a déjà écrite dans frame, source normale).
func (s *sharedState) channelsFor(ip string, universe uint16) (data [512]byte, ok bool) {
	if data, ok := s.frame.ChannelsFor(ip, universe); ok {
		return data, true
	}
	if s.rawValid && s.rawIP == ip && s.rawUniverse == universe {
		return s.rawData, true
	}
	return [512]byte{}, false
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
	s.rawValid = false
	s.updateCount = 0
	s.unknownCount = 0
	s.lastSource = ""
}

// listenEhub décode en continu le flux eHuB, indépendamment de l'UI et de
// l'envoi ArtNet (mêmes principes que `listen` du CLI).
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

// setStripLEDs colore toutes les LED visibles d'une bande.
func setStripLEDs(f *wall.Frame, cfg wall.Config, strip int, r, g, b byte) {
	for led := 1; led <= cfg.LEDsPerStrip(); led++ {
		if cfg.IsVisible(led) {
			f.SetLED(strip, led, r, g, b)
		}
	}
}

// setAllLEDs colore tout le mur. Si respectRegion, saute les LED hors de la
// zone active (utilisé par "Tout remplir" mais pas par "Tout éteindre", qui
// doit toujours pouvoir tout couper).
func setAllLEDs(f *wall.Frame, cfg wall.Config, r, g, b byte, respectRegion bool) {
	for strip := 1; strip <= cfg.StripCount(); strip++ {
		for led := 1; led <= cfg.LEDsPerStrip(); led++ {
			if !cfg.IsVisible(led) {
				continue
			}
			if respectRegion && !cfg.LEDInRegion(strip, led) {
				continue
			}
			f.SetLED(strip, led, r, g, b)
		}
	}
}
