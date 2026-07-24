package wall

// Traduit la numérotation "entité" (eHuB) vers (bande, LED), suivant le
// schéma du tableau LAPS : chaque quart (EntityPerQuarter entités)
// correspond à un contrôleur et contient StripsPerCtrl bandes, espacées de
// EntityPerStrip (davantage que LEDsPerStrip, pour laisser des trous entre
// bandes comme dans le fichier Excel d'origine).

// EntityLocation convertit un ID d'entité en (bande, LED). ok=false si
// l'entité ne correspond à aucune LED (hors plage, ou dans un trou).
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

// EntityForStripLED est l'inverse exact de EntityLocation : donne l'ID
// d'entité qui adresse (strip, led). ok=false si strip/led n'est pas
// représentable (bande au-delà des contrôleurs connus, LED au-delà de
// LEDsPerStrip, ou EntityPerStrip trop court pour cette hauteur de bande).
func (c Config) EntityForStripLED(strip, led int) (entityID int, ok bool) {
	if strip < 1 || led < 1 || led > c.LEDsPerStrip() {
		return 0, false
	}
	idx := strip - 1
	quarter := idx / c.StripsPerCtrl
	if quarter >= len(c.ControllerIPs) {
		return 0, false
	}
	k := idx % c.StripsPerCtrl
	localOffset := led - 1
	if localOffset > c.EntityPerStrip-1 {
		return 0, false // EntityPerStrip trop court pour separer cette bande de la suivante
	}
	return c.EntityBase + quarter*c.EntityPerQuarter + k*c.EntityPerStrip + localOffset, true
}

// FixtureChannel adresse les entités < EntityBase (lyres, projecteur) sur le
// dernier contrôleur, univers FixtureUniverse ; l'ID = canal DMX (1-indexé).
// Hypothèse à valider : seule la composante R sert de valeur brute du canal.
func (c Config) FixtureChannel(entityID int) (ip string, universe uint16, channelOffset int, ok bool) {
	if entityID < 1 || entityID > 511 || len(c.ControllerIPs) == 0 {
		return "", 0, 0, false
	}
	return c.ControllerIPs[len(c.ControllerIPs)-1], FixtureUniverse, entityID - 1, true
}
