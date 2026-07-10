// Package ehub décode le protocole UDP "eHuB" (messages "config" et "update")
// tel que décrit dans le sujet : un en-tête de 10 octets suivi d'un payload
// compressé en GZip.

package ehub

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"fmt"
	"io"
)

type MessageType byte

const (
	TypeConfig MessageType = 1
	TypeUpdate MessageType = 2
)

const headerSize = 10

var magic = [4]byte{'e', 'H', 'u', 'B'}

var byteOrder = binary.LittleEndian

// Header est l'en-tête commun aux messages config et update.
type Header struct {
	Type         MessageType
	EhubUniverse byte
	Count        uint16 // nombre de plages (config) ou d'entités (update)
	PayloadLen   uint16 // taille du payload compressé, en octets
}

// ParseHeader lit l'en-tête et retourne le payload (encore en GZip).
func ParseHeader(buf []byte) (Header, []byte, error) {
	if len(buf) < headerSize {
		return Header{}, nil, fmt.Errorf("eHuB: message trop court (%d octets)", len(buf))
	}
	if !bytes.Equal(buf[0:4], magic[:]) {
		return Header{}, nil, fmt.Errorf("eHuB: entete invalide")
	}

	h := Header{
		Type:         MessageType(buf[4]),
		EhubUniverse: buf[5],
		Count:        byteOrder.Uint16(buf[6:8]),
		PayloadLen:   byteOrder.Uint16(buf[8:10]),
	}

	rest := buf[headerSize:]
	if len(rest) < int(h.PayloadLen) {
		return h, nil, fmt.Errorf("eHuB: payload tronque (attendu %d, recu %d)", h.PayloadLen, len(rest))
	}
	return h, rest[:h.PayloadLen], nil
}

func Decompress(compressed []byte) ([]byte, error) {
	r, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return nil, fmt.Errorf("eHuB: gzip invalide: %w", err)
	}
	defer r.Close()
	return io.ReadAll(r)
}

// ConfigRange décrit une plage d'entités et sa position dans le payload des
// messages "update".
type ConfigRange struct {
	SlotStart   uint16
	EntityStart uint16
	SlotEnd     uint16
	EntityEnd   uint16
}

const configRangeSize = 8

func DecodeConfig(payload []byte, count uint16) ([]ConfigRange, error) {
	need := int(count) * configRangeSize
	if len(payload) < need {
		return nil, fmt.Errorf("eHuB config: payload trop court (attendu %d, recu %d)", need, len(payload))
	}
	ranges := make([]ConfigRange, count)
	for i := range ranges {
		o := i * configRangeSize
		ranges[i] = ConfigRange{
			SlotStart:   byteOrder.Uint16(payload[o : o+2]),
			EntityStart: byteOrder.Uint16(payload[o+2 : o+4]),
			SlotEnd:     byteOrder.Uint16(payload[o+4 : o+6]),
			EntityEnd:   byteOrder.Uint16(payload[o+6 : o+8]),
		}
	}
	return ranges, nil
}

// Entity est la couleur RGBW reçue pour une entité dans un message "update".
type Entity struct {
	ID         uint16
	R, G, B, W byte
}

const entitySize = 6

func DecodeUpdate(payload []byte, count uint16) ([]Entity, error) {
	need := int(count) * entitySize
	if len(payload) < need {
		return nil, fmt.Errorf("eHuB update: payload trop court (attendu %d, recu %d)", need, len(payload))
	}
	entities := make([]Entity, count)
	for i := range entities {
		o := i * entitySize
		entities[i] = Entity{
			ID: byteOrder.Uint16(payload[o : o+2]),
			R:  payload[o+2],
			G:  payload[o+3],
			B:  payload[o+4],
			W:  payload[o+5],
		}
	}
	return entities, nil
}
