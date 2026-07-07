package wall

import (
	"encoding/json"
	"os"
)

// LEDsPerUniverse est une limite du protocole DMX512 (512 canaux / 3 par LED
// RGB), pas un paramètre d'installation : elle ne fait pas partie de Config.
const LEDsPerUniverse = 512 / 3 // 170

// FixtureUniverse est l'univers conventionnellement réservé aux appareils DMX
// génériques (lyres, projecteurs) sur le dernier contrôleur de la config.
const FixtureUniverse uint16 = 33

// Config décrit une installation physique : dimensions, contrôleurs et
// numérotation des entités. Remplace les anciennes constantes figées pour
// pouvoir changer d'installation (IP, taille du mur, etc.) sans recompiler,
// et pour pouvoir sauvegarder/recharger une configuration (P1 du cours).
type Config struct {
	// ControllerIPs : une entrée par contrôleur BC216, dans l'ordre. Le
	// dernier de la liste porte aussi les fixtures (lyres/projecteur).
	ControllerIPs []string `json:"controllerIPs"`
	// StripsPerCtrl : nombre de bandes gerées par un seul contrôleur
	// (16 sur un BC216 avec 16 sorties, une bande par sortie).
	StripsPerCtrl int `json:"stripsPerCtrl"`
	// Height : nombre de LED visibles dans la partie montante d'une bande
	// (= nombre de lignes visuelles). La bande complète fait 2*Height+3 LED
	// (1 fixation basse + Height montée + 1 fixation haute + Height
	// descente + 1 fixation basse), suivant la géométrie en serpentin.
	Height int `json:"height"`

	// Numérotation des entités eHuB (voir wall/entities.go) : EntityBase est
	// le premier ID utilisé par le mur (les ID en dessous sont réservés aux
	// fixtures), EntityPerQuarter l'écart entre 2 contrôleurs, EntityPerStrip
	// l'écart entre 2 bandes d'un même contrôleur.
	EntityBase       int `json:"entityBase"`
	EntityPerQuarter int `json:"entityPerQuarter"`
	EntityPerStrip   int `json:"entityPerStrip"`

	// Region restreint la zone active du mur SANS changer l'adressage réel
	// (IP/univers/canal restent ceux du mur complet) : utile pour n'utiliser
	// qu'une portion de l'installation physique existante (ex: le coin
	// haut-droit d'un mur 128x128), par opposition à définir une toute
	// nouvelle installation plus petite. Coordonnées identiques à Pixel
	// (x: 1..Width, y: 0..Height-1, 0=bas). RegionWidth==0 signifie "pas de
	// restriction, toute la surface est active" (comportement par défaut).
	RegionX0     int `json:"regionX0"`
	RegionY0     int `json:"regionY0"`
	RegionWidth  int `json:"regionWidth"`
	RegionHeight int `json:"regionHeight"`
}

// DefaultConfig renvoie la configuration du mur de test LAPS (128x128,
// 64 bandes sur 4 contrôleurs), telle que décrite dans le sujet et le fichier
// Ecran.xlsx.
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

// StripCount : nombre total de bandes de l'installation.
func (c Config) StripCount() int {
	return len(c.ControllerIPs) * c.StripsPerCtrl
}

// Width : nombre de colonnes visuelles (2 par bande : montée + descente).
func (c Config) Width() int {
	return 2 * c.StripCount()
}

// LEDsPerStrip : nombre total de LED d'une bande, fixations incluses.
func (c Config) LEDsPerStrip() int {
	return 2*c.Height + 3
}

// UniversesPerStrip : nombre d'univers DMX nécessaires pour adresser une
// bande entière (3 canaux par LED, 512 canaux max par univers).
func (c Config) UniversesPerStrip() int {
	totalChannels := c.LEDsPerStrip() * 3
	return (totalChannels + 511) / 512
}

// IsVisible indique si une LED (1..LEDsPerStrip) d'une bande est physiquement
// visible (les 3 LED de fixation ne le sont pas : base, milieu, fin).
func (c Config) IsVisible(led int) bool {
	return led != 1 && led != c.Height+2 && led != c.LEDsPerStrip()
}

// Save écrit la configuration au format JSON.
func (c Config) Save(path string) error {
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// LoadConfig relit une configuration précédemment sauvegardée.
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
