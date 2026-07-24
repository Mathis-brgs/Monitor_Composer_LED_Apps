package wall

// Table de patch explicite (nom, plage d'entités, IP, univers) : format du
// tableau Excel/CSV du prof, et source de vérité pour Config.Patch quand
// elle est renseignée (voir Config.ResolveEntity). Éditable/créable à la
// main (fenêtre "Contrôleurs & Univers" du monitor) ou importée d'un CSV.

import (
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
	"strings"
)

// PatchRow est une ligne d'un tableau de patch (nom, plage d'entités, IP et
// univers ArtNet cibles).
type PatchRow struct {
	Name        string `json:"name"`
	EntityStart int    `json:"entityStart"`
	EntityEnd   int    `json:"entityEnd"`
	IP          string `json:"ip"`
	Universe    uint16 `json:"universe"`
}

// ParsePatchCSV lit un CSV à 5 colonnes (Name, Entity Start, Entity End,
// ArtNet IP, ArtNet Universe). En-tête optionnelle : sautée automatiquement
// si la 1re ligne ne contient pas des nombres aux bonnes colonnes.
func ParsePatchCSV(r io.Reader) ([]PatchRow, error) {
	cr := csv.NewReader(r)
	cr.TrimLeadingSpace = true
	cr.FieldsPerRecord = -1

	records, err := cr.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("lecture CSV : %w", err)
	}

	var rows []PatchRow
	for i, rec := range records {
		if len(rec) < 5 || strings.TrimSpace(strings.Join(rec, "")) == "" {
			continue // ligne vide
		}
		name := strings.TrimSpace(rec[0])
		start, err1 := strconv.Atoi(strings.TrimSpace(rec[1]))
		end, err2 := strconv.Atoi(strings.TrimSpace(rec[2]))
		ip := strings.TrimSpace(rec[3])
		universe, err3 := strconv.Atoi(strings.TrimSpace(rec[4]))
		if err1 != nil || err2 != nil || err3 != nil {
			if i == 0 {
				continue // en-tete de colonnes (texte, pas des nombres)
			}
			return nil, fmt.Errorf("ligne %d invalide : %v", i+1, rec)
		}
		rows = append(rows, PatchRow{Name: name, EntityStart: start, EntityEnd: end, IP: ip, Universe: uint16(universe)})
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("aucune ligne de patch trouvee dans le fichier")
	}
	return rows, nil
}

// WritePatchCSV écrit une table de patch au même format 5 colonnes que
// ParsePatchCSV attend en lecture (round-trip garanti par
// TestPatchCSVRoundTrip) : en-tête, puis une ligne par PatchRow.
func WritePatchCSV(w io.Writer, rows []PatchRow) error {
	cw := csv.NewWriter(w)
	if err := cw.Write([]string{"Name", "Entity Start", "Entity End", "ArtNet IP", "ArtNet Universe"}); err != nil {
		return err
	}
	for _, row := range rows {
		rec := []string{
			row.Name,
			strconv.Itoa(row.EntityStart),
			strconv.Itoa(row.EntityEnd),
			row.IP,
			strconv.Itoa(int(row.Universe)),
		}
		if err := cw.Write(rec); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}
