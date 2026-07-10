// Package wall décrit la géométrie physique d'un mur LED (bandes en
// serpentin, plusieurs univers DMX par bande) et convertit une position
// logique (bande, LED) en adresse ArtNet (IP, univers, canal). La géométrie
// est portée par Config plutôt que figée en constantes.
package wall

import "ledtest/artnet"

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
	universeIdx := (led - 1) / LEDsPerUniverse
	channelOffset = ((led - 1) % LEDsPerUniverse) * 3
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

func (c Config) ledSlot(strip, led int) (slot, ch int) {
	universeIdx := (led - 1) / LEDsPerUniverse
	ch = ((led - 1) % LEDsPerUniverse) * 3
	slot = (strip-1)*c.UniversesPerStrip() + universeIdx
	return
}

// Frame est l'état RGB de tout le mur, avec suivi des univers modifiés pour
// n'envoyer que le strict nécessaire sur le réseau.
type Frame struct {
	cfg   Config
	data  [][512]byte
	dirty []bool
}

func NewFrame(cfg Config) *Frame {
	n := cfg.StripCount() * cfg.UniversesPerStrip()
	return &Frame{cfg: cfg, data: make([][512]byte, n), dirty: make([]bool, n)}
}

func (f *Frame) Config() Config {
	return f.cfg
}

// SetLED utilise un slot de stockage global (indépendant du contrôleur) pour
// éviter toute collision entre bandes de contrôleurs différents qui
// partagent les mêmes numéros d'univers locaux.
func (f *Frame) SetLED(strip, led int, r, g, b byte) {
	slot, ch := f.cfg.ledSlot(strip, led)
	f.data[slot][ch] = r
	f.data[slot][ch+1] = g
	f.data[slot][ch+2] = b
	f.dirty[slot] = true
}

func (f *Frame) GetLED(strip, led int) (r, g, b byte) {
	slot, ch := f.cfg.ledSlot(strip, led)
	return f.data[slot][ch], f.data[slot][ch+1], f.data[slot][ch+2]
}

// ChannelsFor renvoie les 512 octets bruts d'un (IP, univers) donné, pour le
// monitor (visualisation des canaux DMX avant envoi).
func (f *Frame) ChannelsFor(ip string, universe uint16) (data [512]byte, ok bool) {
	ups := f.cfg.UniversesPerStrip()
	for strip := 1; strip <= f.cfg.StripCount(); strip++ {
		sip, base := f.cfg.StripBase(strip)
		if sip != ip || universe < base || universe >= base+uint16(ups) {
			continue
		}
		slot := (strip-1)*ups + int(universe-base)
		return f.data[slot], true
	}
	return [512]byte{}, false
}

// SetRaw écrit directement les octets d'un univers, pour le mode "adressage
// brut" du monitor (bypass de l'abstraction bande/LED). Renvoie false si
// (ip, univers) ne correspond à aucune bande de la config actuelle.
func (f *Frame) SetRaw(ip string, universe uint16, data []byte) bool {
	ups := f.cfg.UniversesPerStrip()
	for strip := 1; strip <= f.cfg.StripCount(); strip++ {
		sip, base := f.cfg.StripBase(strip)
		if sip != ip || universe < base || universe >= base+uint16(ups) {
			continue
		}
		slot := (strip-1)*ups + int(universe-base)
		copy(f.data[slot][:], data)
		f.dirty[slot] = true
		return true
	}
	return false
}

// Flush envoie uniquement les univers modifiés depuis le dernier Flush.
func (f *Frame) Flush(sender *artnet.Sender, seq byte) error {
	ups := f.cfg.UniversesPerStrip()
	for slot := range f.data {
		if !f.dirty[slot] {
			continue
		}
		strip := slot/ups + 1
		universeIdx := slot % ups
		ip, base := f.cfg.StripBase(strip)
		universe := base + uint16(universeIdx)
		if err := sender.Send(ip, universe, seq, f.data[slot][:]); err != nil {
			return err
		}
		f.dirty[slot] = false
	}
	return nil
}
