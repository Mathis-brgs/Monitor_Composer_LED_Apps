package wall

// Ce fichier traduit la numérotation logique "entité" (utilisée par l'outil
// de création / eHuB) vers la géométrie physique (bande, LED) décrite par une
// Config, à partir du même schéma que le tableau d'adressage LAPS :
//
//	Entités       Univers   IP contrôleur
//	100   - 4858  0  à 31   192.168.1.45
//	5100  - 9858  32 à 63   192.168.1.46
//	...
//
// Chaque "quart" (EntityPerQuarter entités) correspond à un contrôleur et
// contient StripsPerCtrl bandes, espacées de EntityPerStrip (davantage que
// LEDsPerStrip pour laisser des numéros d'entité inutilisés entre 2 bandes,
// comme dans le fichier Excel d'origine).

// EntityLocation convertit un ID d'entité eHuB (>= EntityBase) en (bande,
// LED). ok vaut false si l'entité ne correspond à aucune LED connue de cette
// configuration (numéro hors plage, ou dans un des "trous" entre 2 bandes).
func (c Config) EntityLocation(entityID int) (strip, led int, ok bool) {
	if entityID < c.EntityBase {
		return 0, 0, false
	}
	adj := entityID - c.EntityBase
	quarter := adj / c.EntityPerQuarter
	if quarter >= len(c.ControllerIPs) {
		return 0, 0, false
	}
	withinQuarter := adj % c.EntityPerQuarter
	k := withinQuarter / c.EntityPerStrip
	if k >= c.StripsPerCtrl {
		return 0, 0, false
	}
	localOffset := withinQuarter - k*c.EntityPerStrip
	if localOffset > c.LEDsPerStrip()-1 {
		return 0, 0, false // trou entre 2 bandes
	}

	strip = quarter*c.StripsPerCtrl + k + 1
	led = localOffset + 1
	if !c.LEDInRegion(strip, led) {
		return 0, 0, false // hors de la zone active (Config.Region*)
	}
	return strip, led, true
}

// FixtureChannel adresse les entités < EntityBase, réservées aux appareils
// DMX génériques (lyres, projecteur) branchés sur le dernier contrôleur de la
// configuration, univers FixtureUniverse. Le numéro d'entité correspond
// directement au numéro de canal DMX (1-indexé).
//
// Hypothèse à valider avec l'équipe : seule la composante R de l'entité est
// utilisée comme valeur brute du canal DMX (une lyre/projecteur n'a pas de
// notion de RGB, eHuB n'envoie qu'un quadruplet RGBW par entité).
func (c Config) FixtureChannel(entityID int) (ip string, universe uint16, channelOffset int, ok bool) {
	if entityID < 1 || entityID > 511 || len(c.ControllerIPs) == 0 {
		return "", 0, 0, false
	}
	return c.ControllerIPs[len(c.ControllerIPs)-1], FixtureUniverse, entityID - 1, true
}
