package wall

import (
	"encoding/json"
	"os"
	"sort"
	"strconv"
)

// Univers réservé aux appareils DMX génériques (lyres, projecteur) sur le
// dernier contrôleur de la config.
const FixtureUniverse uint16 = 33

// DefaultChannelOrder est utilisé si Config.ChannelOrder est vide (compat
// avec d'anciennes configs sauvées avant l'ajout du champ) : RGB, 3 canaux.
const DefaultChannelOrder = "rgb"

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

	// Ordre des canaux DMX par LED : lettres parmi r,g,b,w, chacune au plus
	// une fois (ex: "rgb", "grb", "rgbw"). Longueur = canaux/LED. Vide ->
	// DefaultChannelOrder (compat anciennes configs).
	ChannelOrder string `json:"channelOrder,omitempty"`

	// Patch : table explicite (nom, plage d'entites, IP, univers) — source de
	// verite prioritaire sur la formule EntityBase/EntityPerQuarter/
	// EntityPerStrip si non vide. Editable/creable a la main (fenetre
	// "Controleurs & Univers" du monitor) ou importee d'un CSV. Vide par
	// defaut : la formule gouverne comme avant (comportement inchange).
	Patch []PatchRow `json:"patch,omitempty"`
}

// ChannelsPerLED = nombre de canaux DMX consommés par LED (longueur de
// ChannelOrder, ou 3 si absent).
func (c Config) ChannelsPerLED() int {
	if c.ChannelOrder == "" {
		return len(DefaultChannelOrder)
	}
	return len(c.ChannelOrder)
}

// channelOrder retourne l'ordre effectif (jamais vide).
func (c Config) channelOrder() string {
	if c.ChannelOrder == "" {
		return DefaultChannelOrder
	}
	return c.ChannelOrder
}

// LEDsPerUniverse = combien de LED tiennent dans les 512 canaux d'un univers,
// selon le nombre de canaux/LED (3 pour RGB, 4 pour RGBW, ...).
func (c Config) LEDsPerUniverse() int {
	return 512 / c.ChannelsPerLED()
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
		ChannelOrder:     DefaultChannelOrder,
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
	totalChannels := c.LEDsPerStrip() * c.ChannelsPerLED()
	return (totalChannels + 511) / 512
}

// UniverseInfo décrit ce qu'un univers local d'un contrôleur transporte
// (plage d'entités + bande d'origine) — pour l'affichage/navigation dans le
// monitor (panneau "Contrôleurs & Univers"), à l'image du tableau Excel du
// prof (colonnes Entity Start/End, ArtNet IP/Universe).
type UniverseInfo struct {
	Universe    uint16
	Strip       int
	EntityStart int
	EntityEnd   int
}

// ControllerUniverses liste, pour un contrôleur (par IP), chaque univers
// utilisé et la plage d'entités qu'il transporte. Lit la table de patch
// explicite si elle est renseignée (source de vérité), sinon recalcule
// depuis la formule (EntityLocation/LEDAddress) — jamais de duplication qui
// risquerait de diverger du vrai routage (voir ResolveEntity, même logique).
func (c Config) ControllerUniverses(ip string) []UniverseInfo {
	if len(c.Patch) > 0 {
		var out []UniverseInfo
		for _, row := range c.Patch {
			if row.IP != ip {
				continue
			}
			strip, _ := strconv.Atoi(row.Name) // 0 si non-numerique (fixture) : pas de bande associee
			out = append(out, UniverseInfo{Universe: row.Universe, Strip: strip, EntityStart: row.EntityStart, EntityEnd: row.EntityEnd})
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Universe < out[j].Universe })
		return out
	}

	ctrlIdx := -1
	for i, cip := range c.ControllerIPs {
		if cip == ip {
			ctrlIdx = i
			break
		}
	}
	if ctrlIdx == -1 {
		return nil
	}
	lo := c.EntityBase + ctrlIdx*c.EntityPerQuarter
	hi := lo + c.EntityPerQuarter - 1

	byUniverse := map[uint16]*UniverseInfo{}
	var order []uint16
	for id := lo; id <= hi; id++ {
		strip, led, ok := c.EntityLocation(id)
		if !ok {
			continue
		}
		_, universe, _ := c.LEDAddress(strip, led)
		info, seen := byUniverse[universe]
		if !seen {
			info = &UniverseInfo{Universe: universe, Strip: strip, EntityStart: id, EntityEnd: id}
			byUniverse[universe] = info
			order = append(order, universe)
		} else {
			info.EntityEnd = id
		}
	}
	sort.Slice(order, func(i, j int) bool { return order[i] < order[j] })
	out := make([]UniverseInfo, len(order))
	for i, u := range order {
		out[i] = *byUniverse[u]
	}
	return out
}

// EntityRangeForIP renvoie la plage d'ID d'entités (min,max) qui adressent
// effectivement ce contrôleur avec la config actuelle (zone active incluse).
// Pour l'affichage (carte "Mapping" du monitor), pas le chemin d'envoi ArtNet.
func (c Config) EntityRangeForIP(ip string) (min, max int, ok bool) {
	us := c.ControllerUniverses(ip)
	if len(us) == 0 {
		return 0, 0, false
	}
	return us[0].EntityStart, us[len(us)-1].EntityEnd, true
}

// ResolveEntity donne (ip, univers, offset canal) pour une entité eHuB, en
// utilisant Patch si non vide (source de vérité explicite, une ligne = un
// univers), sinon la formule (EntityLocation/LEDAddress) puis FixtureChannel
// pour les fixtures (ID < EntityBase) — comportement par défaut inchangé.
// isFixture=true signifie "canal DMX brut, un seul octet (R) compte" (spot/lyre,
// via FixtureChannel) — par opposition à une LED de bande, qui occupe
// ChannelsPerLED() octets consécutifs (R,G,B[,W]).
func (c Config) ResolveEntity(entityID int) (ip string, universe uint16, channelOffset int, isFixture, ok bool) {
	if len(c.Patch) > 0 {
		for _, row := range c.Patch {
			if entityID >= row.EntityStart && entityID <= row.EntityEnd {
				if entityID < c.EntityBase {
					// Ligne de patch couvrant une fixture (lyre/projecteur) : même
					// convention que le chemin formule (FixtureChannel) — canal DMX
					// brut, 1 octet, pas le stride ChannelsPerLED() d'une LED.
					return row.IP, row.Universe, entityID - row.EntityStart, true, true
				}
				return row.IP, row.Universe, (entityID - row.EntityStart) * c.ChannelsPerLED(), false, true
			}
		}
		return "", 0, 0, false, false
	}
	if strip, led, located := c.EntityLocation(entityID); located {
		ip, universe, ch := c.LEDAddress(strip, led)
		return ip, universe, ch, false, true
	}
	if ip, universe, ch, located := c.FixtureChannel(entityID); located {
		return ip, universe, ch, true, true
	}
	return "", 0, 0, false, false
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
