package wall

// Ce fichier traduit la numérotation logique "entité" (utilisée par l'outil
// de création / eHuB) vers notre géométrie physique (bande, LED), à partir du
// tableau d'adressage fourni par LAPS :
//
//	Entités       Univers   IP contrôleur
//	100   - 4858  0  à 31   192.168.1.45
//	5100  - 9858  32 à 63   192.168.1.46
//	10100 - 14858 64 à 95   192.168.1.47
//	15100 - 19858 96 à 127  192.168.1.48
//
// Chaque quart (5000 entités) contient 16 bandes de 259 entités, espacées de
// 300 (259 utilisées + 41 numéros non utilisés entre deux bandes). Dans une
// bande, les 170 premières entités vont sur le premier univers (LED 1-170) et
// les 89 suivantes sur le second univers (LED 171-259) : c'est exactement le
// même découpage que LEDAddress/StripBase.
const (
	entityWallBase   = 100  // premiere entite utilisee par le mur (avant : fixtures)
	entityPerQuarter = 5000 // ecart entre 2 quarts de mur
	entityPerStrip   = 300  // ecart entre 2 bandes (259 utilisees + 41 vides)
)

// EntityLocation convertit un ID d'entité eHuB (>= 100) en (bande, LED) pour
// une LED du mur. ok vaut false si l'entité ne correspond à aucune LED connue
// (numéro hors plage, ou dans un des "trous" laissés entre deux bandes).
func EntityLocation(entityID int) (strip, led int, ok bool) {
	if entityID < entityWallBase {
		return 0, 0, false
	}
	adj := entityID - entityWallBase
	quarter := adj / entityPerQuarter
	if quarter >= len(ControllerIPs) {
		return 0, 0, false
	}
	withinQuarter := adj % entityPerQuarter
	k := withinQuarter / entityPerStrip
	if k >= StripsPerCtrl {
		return 0, 0, false
	}
	localOffset := withinQuarter - k*entityPerStrip
	if localOffset > LEDsPerStrip-1 {
		return 0, 0, false // trou entre 2 bandes
	}

	strip = quarter*StripsPerCtrl + k + 1
	if localOffset <= LEDsPerUniverse-1 {
		led = localOffset + 1
	} else {
		led = LEDsPerUniverse + 1 + (localOffset - LEDsPerUniverse)
	}
	return strip, led, true
}

// FixtureChannel adresse les entités < 100, réservées aux appareils DMX
// génériques (lyres, projecteur) branchés sur le contrôleur .48, univers 33,
// d'après le tableau LAPS (ex: Lyre 1 = entités 10-23, Projecteur = entité 1).
// Le numéro d'entité correspond directement au numéro de canal DMX (1-indexé).
//
// Hypothèse à valider avec l'équipe : seule la composante R de l'entité est
// utilisée comme valeur brute du canal DMX (une lyre/projecteur n'a pas de
// notion de RGB, eHuB n'envoie qu'un quadruplet RGBW par entité).
const (
	FixtureUniverse  uint16 = 33
	FixtureCtrlIndex        = 3 // 192.168.1.48
)

func FixtureChannel(entityID int) (ip string, universe uint16, channelOffset int, ok bool) {
	if entityID < 1 || entityID > 511 {
		return "", 0, 0, false
	}
	return ControllerIPs[FixtureCtrlIndex], FixtureUniverse, entityID - 1, true
}
