// Package wall décrit la géométrie physique d'un mur LED (bandes en
// serpentin, plusieurs univers DMX par bande) et convertit une position
// logique (bande, LED) en adresse ArtNet (IP, univers, canal). La géométrie
// est portée par Config plutôt que figée en constantes.
package wall

import (
	"fmt"

	"ledtest/artnet"
)

// L'univers ArtNet est local à chaque contrôleur (chaque BC216 numérote ses
// univers à partir de 0), donc on repart à 0 à chaque nouveau contrôleur.
func (c Config) StripBase(strip int) (ip string, baseUniverse uint16) {
	idx := strip - 1
	ctrlIdx := idx / c.StripsPerCtrl
	localIdx := idx % c.StripsPerCtrl
	ip = c.ControllerIPs[ctrlIdx]
	baseUniverse = uint16(localIdx * c.UniversesPerStrip())
	return
}

func (c Config) LEDAddress(strip, led int) (ip string, universe uint16, channelOffset int) {
	ip, base := c.StripBase(strip)
	lpu := c.LEDsPerUniverse()
	universeIdx := (led - 1) / lpu
	channelOffset = ((led - 1) % lpu) * c.ChannelsPerLED()
	universe = base + uint16(universeIdx)
	return
}

// VisibleLEDIndex convertit un index de LED visible (0..2*Height-1) en
// numéro de LED réel, en sautant les 3 LED de fixation.
func (c Config) VisibleLEDIndex(n int) int {
	if n < c.Height {
		return n + 2
	}
	return n + 3
}

// Pixel convertit (x: 1..Width colonne, y: 0..Height-1, 0=bas) en (bande,
// LED). Une bande couvre 2 colonnes adjacentes en serpentin (montée puis
// descente), donc les colonnes impaires/paires ont un sens de LED opposé.
func (c Config) Pixel(x, y int) (strip, led int, ok bool) {
	if x < 1 || x > c.Width() || y < 0 || y >= c.Height {
		return 0, 0, false
	}
	strip = (x-1)/2 + 1
	if x%2 == 1 {
		led = y + 2
	} else {
		led = c.LEDsPerStrip() - 1 - y
	}
	return strip, led, true
}

// PixelForLED est l'inverse de Pixel. ok=false pour les LED de fixation.
func (c Config) PixelForLED(strip, led int) (x, y int, ok bool) {
	if !c.IsVisible(led) {
		return 0, 0, false
	}
	if led <= c.Height+1 {
		return 2*strip - 1, led - 2, true
	}
	return 2 * strip, c.LEDsPerStrip() - 1 - led, true
}

func (c Config) InRegion(x, y int) bool {
	if c.RegionWidth <= 0 {
		return true
	}
	return x >= c.RegionX0 && x < c.RegionX0+c.RegionWidth &&
		y >= c.RegionY0 && y < c.RegionY0+c.RegionHeight
}

func (c Config) LEDInRegion(strip, led int) bool {
	if c.RegionWidth <= 0 {
		return true
	}
	x, y, ok := c.PixelForLED(strip, led)
	return ok && c.InRegion(x, y)
}

// Frame est l'état DMX de tout le mur : un buffer 512 octets par univers
// physique (IP, univers), indexé par adresse plutôt que par bande — ainsi
// formule (StripBase) et table de patch explicite (Config.Patch) partagent
// exactement le même stockage/envoi, sans dupliquer la logique.
type frameSlot struct {
	ip       string
	universe uint16
	data     [512]byte
	dirty    bool
}

type Frame struct {
	cfg   Config
	slots []frameSlot
	index map[string]int // clé slotKey(ip,universe) -> indice dans slots
}

func slotKey(ip string, universe uint16) string {
	return fmt.Sprintf("%s#%d", ip, universe)
}

// NewFrame réserve un slot par univers physique utilisé : ceux de la table de
// patch explicite si elle est renseignée, sinon ceux dérivés de la formule
// (StripBase/UniversesPerStrip) — comportement par défaut inchangé — plus
// l'univers fixtures (lyres/projecteur) du dernier contrôleur.
func NewFrame(cfg Config) *Frame {
	f := &Frame{cfg: cfg, index: map[string]int{}}
	add := func(ip string, universe uint16) {
		key := slotKey(ip, universe)
		if _, exists := f.index[key]; exists {
			return
		}
		f.index[key] = len(f.slots)
		f.slots = append(f.slots, frameSlot{ip: ip, universe: universe})
	}
	if len(cfg.Patch) > 0 {
		for _, row := range cfg.Patch {
			add(row.IP, row.Universe)
		}
	} else {
		for strip := 1; strip <= cfg.StripCount(); strip++ {
			ip, base := cfg.StripBase(strip)
			for u := 0; u < cfg.UniversesPerStrip(); u++ {
				add(ip, base+uint16(u))
			}
		}
		if len(cfg.ControllerIPs) > 0 {
			add(cfg.ControllerIPs[len(cfg.ControllerIPs)-1], FixtureUniverse)
		}
	}
	return f
}

func (f *Frame) Config() Config {
	return f.cfg
}

func (f *Frame) slotFor(ip string, universe uint16) (int, bool) {
	idx, ok := f.index[slotKey(ip, universe)]
	return idx, ok
}

// SetLED adresse une LED via la formule bande/LED (StripBase/LEDAddress).
// Ignore silencieusement si (ip,univers) n'a pas de slot réservé (ex: table
// de patch active qui ne couvre pas cette bande).
func (f *Frame) SetLED(strip, led int, r, g, b, w byte) {
	ip, universe, ch := f.cfg.LEDAddress(strip, led)
	idx, ok := f.slotFor(ip, universe)
	if !ok {
		return
	}
	f.cfg.writeChannels(f.slots[idx].data[:], ch, r, g, b, w)
	f.slots[idx].dirty = true
}

func (f *Frame) GetLED(strip, led int) (r, g, b, w byte) {
	ip, universe, ch := f.cfg.LEDAddress(strip, led)
	idx, ok := f.slotFor(ip, universe)
	if !ok {
		return 0, 0, 0, 0
	}
	return f.cfg.readChannels(f.slots[idx].data[:], ch)
}

// SetEntity adresse une entité eHuB (LED de bande OU fixture, cf.
// Config.ResolveEntity) directement par ID, sans que l'appelant ait à
// distinguer les deux mécanismes. Renvoie false si l'entité n'est adressable
// nulle part (ID inconnu, ou (ip,univers) résolu hors de la config actuelle).
func (f *Frame) SetEntity(entityID int, r, g, b, w byte) bool {
	ip, universe, ch, isFixture, ok := f.cfg.ResolveEntity(entityID)
	if !ok {
		return false
	}
	idx, ok := f.slotFor(ip, universe)
	if !ok {
		return false
	}
	if isFixture {
		// canal DMX brut (spot/lyre) : un seul octet compte (R). Écrire 3+ octets
		// comme pour une LED écraserait les 1-2 canaux suivants (ex: Pan puis Pan
		// fin/Tilt d'une lyre) à chaque mise à jour.
		f.slots[idx].data[ch] = r
	} else {
		f.cfg.writeChannels(f.slots[idx].data[:], ch, r, g, b, w)
	}
	f.slots[idx].dirty = true
	return true
}

// writeChannels/readChannels appliquent Config.ChannelOrder (ex: "rgb",
// "grb", "rgbw") pour placer/lire les composantes aux bons octets DMX.
func (c Config) writeChannels(buf []byte, ch int, r, g, b, w byte) {
	order := c.channelOrder()
	for i := 0; i < len(order); i++ {
		switch order[i] {
		case 'r':
			buf[ch+i] = r
		case 'g':
			buf[ch+i] = g
		case 'b':
			buf[ch+i] = b
		case 'w':
			buf[ch+i] = w
		}
	}
}

func (c Config) readChannels(buf []byte, ch int) (r, g, b, w byte) {
	order := c.channelOrder()
	for i := 0; i < len(order); i++ {
		switch order[i] {
		case 'r':
			r = buf[ch+i]
		case 'g':
			g = buf[ch+i]
		case 'b':
			b = buf[ch+i]
		case 'w':
			w = buf[ch+i]
		}
	}
	return
}

// ChannelsFor renvoie les 512 octets bruts d'un (IP, univers) donné, pour le
// monitor (visualisation des canaux DMX avant envoi).
func (f *Frame) ChannelsFor(ip string, universe uint16) (data [512]byte, ok bool) {
	idx, found := f.slotFor(ip, universe)
	if !found {
		return [512]byte{}, false
	}
	return f.slots[idx].data, true
}

// SetRaw écrit directement les octets d'un univers, pour le mode "adressage
// brut" du monitor (bypass de l'abstraction bande/LED). Renvoie false si
// (ip, univers) n'a pas de slot réservé dans la config actuelle.
func (f *Frame) SetRaw(ip string, universe uint16, data []byte) bool {
	idx, ok := f.slotFor(ip, universe)
	if !ok {
		return false
	}
	copy(f.slots[idx].data[:], data)
	f.slots[idx].dirty = true
	return true
}

// Flush envoie uniquement les univers modifiés depuis le dernier Flush.
func (f *Frame) Flush(sender *artnet.Sender, seq byte) error {
	for i := range f.slots {
		if !f.slots[i].dirty {
			continue
		}
		if err := sender.Send(f.slots[i].ip, f.slots[i].universe, seq, f.slots[i].data[:]); err != nil {
			return err
		}
		f.slots[i].dirty = false
	}
	return nil
}
