package wall

import (
	"encoding/json"
	"os"
)

// Limite du protocole DMX512 (512 canaux / 3 par LED RGB), pas un paramètre
// d'installation.
const LEDsPerUniverse = 512 / 3

// Univers réservé aux appareils DMX génériques (lyres, projecteur) sur le
// dernier contrôleur de la config.
const FixtureUniverse uint16 = 33

// Config décrit une installation physique, à la place d'anciennes constantes
// figées : IP/dimensions modifiables sans recompiler, et sauvegardables (P1).
type Config struct {
	// Une entrée par contrôleur BC216, dans l'ordre. Le dernier porte aussi
	// les fixtures (lyres/projecteur).
	ControllerIPs []string `json:"controllerIPs"`
	// Bandes gérées par un seul contrôleur (16 sorties sur un BC216).
	StripsPerCtrl int `json:"stripsPerCtrl"`
	// LED visibles dans la partie montante d'une bande. La bande complète
	// fait 2*Height+3 LED (fixation basse, montée, fixation haute, descente,
	// fixation fin), en serpentin.
	Height int `json:"height"`

	// Numérotation des entités eHuB (voir entities.go) : EntityBase = premier
	// ID du mur, EntityPerQuarter = écart entre 2 contrôleurs, EntityPerStrip
	// = écart entre 2 bandes.
	EntityBase       int `json:"entityBase"`
	EntityPerQuarter int `json:"entityPerQuarter"`
	EntityPerStrip   int `json:"entityPerStrip"`

	// Restreint la zone active du mur sans changer l'adressage réel (utile
	// pour n'utiliser qu'une portion du mur physique). Coordonnées comme
	// Pixel. RegionWidth==0 = pas de restriction.
	RegionX0     int `json:"regionX0"`
	RegionY0     int `json:"regionY0"`
	RegionWidth  int `json:"regionWidth"`
	RegionHeight int `json:"regionHeight"`
}

// DefaultConfig est la config du mur de test LAPS (128x128, 4 contrôleurs).
func DefaultConfig() Config {
	return Config{
		ControllerIPs:    []string{"192.168.1.45", "192.168.1.46", "192.168.1.47", "192.168.1.48"},
		StripsPerCtrl:    16,
		Height:           128,
		EntityBase:       100,
		EntityPerQuarter: 5000,
		EntityPerStrip:   300,
	}
}

func (c Config) StripCount() int {
	return len(c.ControllerIPs) * c.StripsPerCtrl
}

func (c Config) Width() int {
	return 2 * c.StripCount()
}

func (c Config) LEDsPerStrip() int {
	return 2*c.Height + 3
}

func (c Config) UniversesPerStrip() int {
	totalChannels := c.LEDsPerStrip() * 3
	return (totalChannels + 511) / 512
}

// IsVisible exclut les 3 LED de fixation d'une bande (base, milieu, fin).
func (c Config) IsVisible(led int) bool {
	return led != 1 && led != c.Height+2 && led != c.LEDsPerStrip()
}

func (c Config) Save(path string) error {
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func LoadConfig(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, err
	}
	var c Config
	if err := json.Unmarshal(data, &c); err != nil {
		return Config{}, err
	}
	return c, nil
}
