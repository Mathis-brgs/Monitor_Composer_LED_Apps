package main

import (
	"fmt"
	"strconv"
	"strings"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/widget"

	"ledtest/wall"
)

func sectionTitle(text string) *widget.Label {
	return widget.NewLabelWithStyle(text, fyne.TextAlignLeading, fyne.TextStyle{Bold: true})
}

// newEntry crée un champ texte à une ligne. Par défaut, widget.NewEntry()
// garde un widget.Scroll interne actif (pour le texte tronqué) qui intercepte
// la molette avant qu'elle atteigne le VScroll parent — ce qui rend le
// défilement du panneau saccadé dès que la souris passe sur un champ. On le
// désactive explicitement (Wrapping=Off + Scroll=None sont les 2 conditions
// requises par Fyne pour cacher ce scroll interne).
func newEntry() *widget.Entry {
	e := widget.NewEntry()
	e.Wrapping = fyne.TextWrapOff
	e.Scroll = fyne.ScrollNone
	return e
}

func intEntry(v int) *widget.Entry {
	e := newEntry()
	e.SetText(strconv.Itoa(v))
	return e
}

// atoi lit un entier depuis un champ ; message d'erreur nommé pour l'appelant.
func atoi(e *widget.Entry, name string) (int, error) {
	n, err := strconv.Atoi(e.Text)
	if err != nil {
		return 0, fmt.Errorf("%s invalide", name)
	}
	return n, nil
}

func atoiMin(e *widget.Entry, name string, min int) (int, error) {
	n, err := atoi(e, name)
	if err != nil || n < min {
		return 0, fmt.Errorf("%s invalide", name)
	}
	return n, nil
}

// configFields regroupe les champs du panneau Configuration : parse() les lit
// en wall.Config, load() y recharge une config existante (Appliquer/Charger).
type configFields struct {
	ips                                           *widget.Entry
	stripsPerCtrl, height                         *widget.Entry
	entityBase, entityPerQuarter, entityPerStrip  *widget.Entry
	regionX0, regionY0, regionWidth, regionHeight *widget.Entry
}

func newConfigFields(c wall.Config) *configFields {
	f := &configFields{
		ips:              newEntry(),
		stripsPerCtrl:    intEntry(c.StripsPerCtrl),
		height:           intEntry(c.Height),
		entityBase:       intEntry(c.EntityBase),
		entityPerQuarter: intEntry(c.EntityPerQuarter),
		entityPerStrip:   intEntry(c.EntityPerStrip),
		regionX0:         intEntry(c.RegionX0),
		regionY0:         intEntry(c.RegionY0),
		regionWidth:      intEntry(c.RegionWidth),
		regionHeight:     intEntry(c.RegionHeight),
	}
	f.ips.SetText(strings.Join(c.ControllerIPs, ","))
	return f
}

func (f *configFields) load(c wall.Config) {
	f.ips.SetText(strings.Join(c.ControllerIPs, ","))
	f.stripsPerCtrl.SetText(strconv.Itoa(c.StripsPerCtrl))
	f.height.SetText(strconv.Itoa(c.Height))
	f.entityBase.SetText(strconv.Itoa(c.EntityBase))
	f.entityPerQuarter.SetText(strconv.Itoa(c.EntityPerQuarter))
	f.entityPerStrip.SetText(strconv.Itoa(c.EntityPerStrip))
	f.regionX0.SetText(strconv.Itoa(c.RegionX0))
	f.regionY0.SetText(strconv.Itoa(c.RegionY0))
	f.regionWidth.SetText(strconv.Itoa(c.RegionWidth))
	f.regionHeight.SetText(strconv.Itoa(c.RegionHeight))
}

func (f *configFields) parse() (wall.Config, error) {
	var ips []string
	for _, raw := range strings.Split(f.ips.Text, ",") {
		if ip := strings.TrimSpace(raw); ip != "" {
			ips = append(ips, ip)
		}
	}
	if len(ips) == 0 {
		return wall.Config{}, fmt.Errorf("au moins une adresse IP est necessaire")
	}
	spc, err := atoiMin(f.stripsPerCtrl, "bandes/controleur", 1)
	if err != nil {
		return wall.Config{}, err
	}
	h, err := atoiMin(f.height, "hauteur", 1)
	if err != nil {
		return wall.Config{}, err
	}
	eb, err := atoi(f.entityBase, "entite de depart")
	if err != nil {
		return wall.Config{}, err
	}
	epq, err := atoiMin(f.entityPerQuarter, "ecart entites/controleur", 1)
	if err != nil {
		return wall.Config{}, err
	}
	eps, err := atoiMin(f.entityPerStrip, "ecart entites/bande", 1)
	if err != nil {
		return wall.Config{}, err
	}
	rx0, _ := atoi(f.regionX0, "")
	ry0, _ := atoi(f.regionY0, "")
	rw, _ := atoi(f.regionWidth, "")
	rh, _ := atoi(f.regionHeight, "")

	return wall.Config{
		ControllerIPs:    ips,
		StripsPerCtrl:    spc,
		Height:           h,
		EntityBase:       eb,
		EntityPerQuarter: epq,
		EntityPerStrip:   eps,
		RegionX0:         rx0,
		RegionY0:         ry0,
		RegionWidth:      rw,
		RegionHeight:     rh,
	}, nil
}

func regionInfo(c wall.Config) string {
	if c.RegionWidth <= 0 {
		return "Zone active : tout le mur"
	}
	return fmt.Sprintf("Zone active : x=%d..%d, y=%d..%d",
		c.RegionX0, c.RegionX0+c.RegionWidth-1, c.RegionY0, c.RegionY0+c.RegionHeight-1)
}
