// Package wall décrit la géométrie physique du mur LED du Groupe LAPS
// (64 bandes de 259 LED en serpentin, RGB, 2 univers DMX par bande) et
// sait convertir une position logique (bande, LED) en adresse ArtNet
// (IP du contrôleur, univers, canal).
package wall

import "ledtest/artnet"

const (
	StripCount        = 64  // 64 bandes au total
	LEDsPerStrip      = 259 // 1 base + 128 montée + 1 haut + 128 descente + 1 fin
	UniversesPerStrip = 2   // chaque bande a besoin de 2 univers (259 LED > 170)
	LEDsPerUniverse   = 170 // 170*3 = 510 canaux <= 512
	StripsPerCtrl     = 16  // 64 bandes / 4 contrôleurs
	VisiblePerStrip   = 256 // 128 montée + 128 descente
)

// ControllerIPs : contrôleur i gère les bandes [i*16+1 ; i*16+16].
var ControllerIPs = [4]string{
	"192.168.1.45",
	"192.168.1.46",
	"192.168.1.47",
	"192.168.1.48",
}

// StripBase retourne l'IP du contrôleur et le premier univers (0-indexé,
// global 0-127) utilisé par une bande (1-indexée, 1..64).
func StripBase(strip int) (ip string, baseUniverse uint16) {
	idx := strip - 1
	ip = ControllerIPs[idx/StripsPerCtrl]
	baseUniverse = uint16(idx * UniversesPerStrip)
	return
}

// LEDAddress retourne l'univers ArtNet et l'offset (0-indexé, début du canal
// R) pour adresser la LED "led" (1..259) de la bande "strip" (1..64).
func LEDAddress(strip, led int) (ip string, universe uint16, channelOffset int) {
	ip, base := StripBase(strip)
	if led <= LEDsPerUniverse {
		universe = base
		channelOffset = (led - 1) * 3
	} else {
		universe = base + 1
		channelOffset = (led - 1 - LEDsPerUniverse) * 3
	}
	return
}

// IsVisible indique si une LED (1..259) d'une bande est physiquement visible
// (les LED 1, 130 et 259 servent uniquement à fixer la bande au cadre).
func IsVisible(led int) bool {
	return led != 1 && led != 130 && led != 259
}

// VisibleLEDIndex convertit un index de LED visible (0..255) en numéro de
// LED réel (1..259) dans la bande, en sautant les 3 LED de fixation.
func VisibleLEDIndex(n int) int {
	if n < 128 {
		return n + 2 // montée : LED 2..129
	}
	return n - 128 + 131 // descente : LED 131..258
}

// Frame représente l'état RGB de l'ensemble des 128 univers du mur
// (128*512 octets), avec suivi des univers modifiés pour n'envoyer que le
// strict nécessaire sur le réseau.
type Frame struct {
	data  [StripCount * UniversesPerStrip][512]byte
	dirty [StripCount * UniversesPerStrip]bool
}

func NewFrame() *Frame {
	return &Frame{}
}

// SetLED colore une LED donnée (bande 1..64, led 1..259).
func (f *Frame) SetLED(strip, led int, r, g, b byte) {
	_, universe, ch := LEDAddress(strip, led)
	f.data[universe][ch] = r
	f.data[universe][ch+1] = g
	f.data[universe][ch+2] = b
	f.dirty[universe] = true
}

// Flush envoie uniquement les univers modifiés depuis le dernier Flush.
func (f *Frame) Flush(sender *artnet.Sender, seq byte) error {
	for u := range f.data {
		if !f.dirty[u] {
			continue
		}
		strip := u/UniversesPerStrip + 1
		ip, _ := StripBase(strip)
		if err := sender.Send(ip, uint16(u), seq, f.data[u][:]); err != nil {
			return err
		}
		f.dirty[u] = false
	}
	return nil
}
