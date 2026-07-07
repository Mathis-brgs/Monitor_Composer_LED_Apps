// Package wall décrit la géométrie physique d'un mur LED du Groupe LAPS
// (bandes en serpentin, RGB, plusieurs univers DMX par bande) et sait
// convertir une position logique (bande, LED) en adresse ArtNet (IP du
// contrôleur, univers, canal). La géométrie exacte (dimensions, IP des
// contrôleurs, numérotation) est portée par Config (voir config.go) plutôt
// que figée en constantes, pour pouvoir changer d'installation sans
// recompiler.
package wall

import "ledtest/artnet"

// StripBase retourne l'IP du contrôleur et le premier univers utilisé par une
// bande (1-indexée, 1..StripCount). L'univers ArtNet est local à chaque
// contrôleur (chaque BC216 numérote ses propres univers à partir de 0), il
// faut donc repartir à 0 à chaque nouveau contrôleur plutôt que de continuer
// à compter globalement.
func (c Config) StripBase(strip int) (ip string, baseUniverse uint16) {
	idx := strip - 1
	ctrlIdx := idx / c.StripsPerCtrl
	localIdx := idx % c.StripsPerCtrl
	ip = c.ControllerIPs[ctrlIdx]
	baseUniverse = uint16(localIdx * c.UniversesPerStrip())
	return
}

// LEDAddress retourne l'univers ArtNet et l'offset (0-indexé, début du canal
// R) pour adresser la LED "led" (1..LEDsPerStrip) de la bande "strip".
func (c Config) LEDAddress(strip, led int) (ip string, universe uint16, channelOffset int) {
	ip, base := c.StripBase(strip)
	universeIdx := (led - 1) / LEDsPerUniverse
	channelOffset = ((led - 1) % LEDsPerUniverse) * 3
	universe = base + uint16(universeIdx)
	return
}

// VisibleLEDIndex convertit un index de LED visible (0..2*Height-1) en
// numéro de LED réel (1..LEDsPerStrip) dans la bande, en sautant les 3 LED de
// fixation.
func (c Config) VisibleLEDIndex(n int) int {
	if n < c.Height {
		return n + 2 // montée
	}
	return n + 3 // descente : (n-Height) + (Height+3)
}

// Pixel convertit une coordonnée écran (x: 1..Width colonne, y: 0..Height-1
// ligne, 0 = bas, Height-1 = haut) en (bande, LED). Une bande couvre 2
// colonnes adjacentes en serpentin (montée puis descente), donc les colonnes
// impaires et paires d'une même bande ont un sens de LED opposé. ok vaut
// false si (x,y) est hors du mur.
func (c Config) Pixel(x, y int) (strip, led int, ok bool) {
	if x < 1 || x > c.Width() || y < 0 || y >= c.Height {
		return 0, 0, false
	}
	strip = (x-1)/2 + 1
	if x%2 == 1 {
		led = y + 2 // colonne montante : 0=bas
	} else {
		led = c.LEDsPerStrip() - 1 - y // colonne descendante : 0=bas
	}
	return strip, led, true
}

// PixelForLED est l'inverse de Pixel : retrouve la coordonnée écran (x,y)
// d'une LED donnée. ok vaut false pour les 3 LED de fixation (non visibles,
// donc sans coordonnée écran).
func (c Config) PixelForLED(strip, led int) (x, y int, ok bool) {
	if !c.IsVisible(led) {
		return 0, 0, false
	}
	if led <= c.Height+1 {
		return 2*strip - 1, led - 2, true // colonne montante
	}
	return 2 * strip, c.LEDsPerStrip() - 1 - led, true // colonne descendante
}

// InRegion indique si la coordonnée écran (x,y) tombe dans la zone active de
// la configuration (voir Config.Region*). Sans restriction définie, toute la
// surface du mur est active.
func (c Config) InRegion(x, y int) bool {
	if c.RegionWidth <= 0 {
		return true
	}
	return x >= c.RegionX0 && x < c.RegionX0+c.RegionWidth &&
		y >= c.RegionY0 && y < c.RegionY0+c.RegionHeight
}

// LEDInRegion indique si une LED (bande, led) tombe dans la zone active.
func (c Config) LEDInRegion(strip, led int) bool {
	if c.RegionWidth <= 0 {
		return true
	}
	x, y, ok := c.PixelForLED(strip, led)
	return ok && c.InRegion(x, y)
}

// ledSlot calcule le slot de stockage interne et l'offset de canal pour une
// LED (bande, led). Factorisé entre SetLED, GetLED et Flush.
func (c Config) ledSlot(strip, led int) (slot, ch int) {
	universeIdx := (led - 1) / LEDsPerUniverse
	ch = ((led - 1) % LEDsPerUniverse) * 3
	slot = (strip-1)*c.UniversesPerStrip() + universeIdx
	return
}

// Frame représente l'état RGB de l'ensemble des univers du mur, avec suivi
// des univers modifiés pour n'envoyer que le strict nécessaire sur le réseau.
type Frame struct {
	cfg   Config
	data  [][512]byte
	dirty []bool
}

// NewFrame crée une frame vide dimensionnée pour la configuration donnée.
func NewFrame(cfg Config) *Frame {
	n := cfg.StripCount() * cfg.UniversesPerStrip()
	return &Frame{cfg: cfg, data: make([][512]byte, n), dirty: make([]bool, n)}
}

// Config renvoie la configuration utilisée par cette frame.
func (f *Frame) Config() Config {
	return f.cfg
}

// SetLED colore une LED donnée (bande 1..StripCount, led 1..LEDsPerStrip). Le
// stockage interne utilise un slot global unique (indépendant du contrôleur)
// pour éviter toute collision entre bandes de contrôleurs différents qui
// partagent les mêmes numéros d'univers locaux.
func (f *Frame) SetLED(strip, led int, r, g, b byte) {
	slot, ch := f.cfg.ledSlot(strip, led)
	f.data[slot][ch] = r
	f.data[slot][ch+1] = g
	f.data[slot][ch+2] = b
	f.dirty[slot] = true
}

// GetLED lit la couleur actuellement stockée pour une LED, utilisé par le
// monitor pour prévisualiser l'état sans dupliquer le mapping bande/LED.
func (f *Frame) GetLED(strip, led int) (r, g, b byte) {
	slot, ch := f.cfg.ledSlot(strip, led)
	return f.data[slot][ch], f.data[slot][ch+1], f.data[slot][ch+2]
}

// ChannelsFor renvoie les 512 octets bruts actuellement stockés pour un
// (IP, univers) donné, utilisé par le monitor pour visualiser les canaux DMX
// bruts avant leur envoi (P8). ok vaut false si ce couple ne correspond à
// aucune bande de la configuration.
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

// Flush envoie uniquement les univers modifiés depuis le dernier Flush, en
// reconvertissant chaque slot de stockage vers l'IP et l'univers local réels.
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
