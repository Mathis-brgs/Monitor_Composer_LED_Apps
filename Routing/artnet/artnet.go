// Package artnet construit et envoie des paquets ArtDMX minimaux (spec Art-Net 4)
// vers des contrôleurs DMX/ArtNet comme le BC216.
package artnet

import (
	"encoding/binary"
	"net"
)

const (
	Port      = 6454
	headerID  = "Art-Net\x00"
	opCodeDMX = 0x5000
)

type Sender struct {
	conn *net.UDPConn
}

func NewSender() (*Sender, error) {
	conn, err := net.ListenUDP("udp", &net.UDPAddr{})
	if err != nil {
		return nil, err
	}
	return &Sender{conn: conn}, nil
}

func (s *Sender) Close() error {
	return s.conn.Close()
}

// BuildDMXPacket construit un paquet ArtDMX pour l'univers donné (0-32767, on
// n'utilise ici que 0-127) avec au plus 512 octets de données DMX512.
func BuildDMXPacket(universe uint16, seq byte, data []byte) []byte {
	if len(data) > 512 {
		data = data[:512]
	}
	length := len(data)
	if length%2 != 0 {
		data = append(data, 0)
		length++
	}

	pkt := make([]byte, 18+length)
	copy(pkt[0:8], headerID)
	binary.LittleEndian.PutUint16(pkt[8:10], opCodeDMX)
	pkt[10] = 0                             // ProtVerHi
	pkt[11] = 14                            // ProtVerLo
	pkt[12] = seq                           // Sequence (0 = désactivé)
	pkt[13] = 0                             // Physical
	pkt[14] = byte(universe & 0xFF)         // SubUni (Sub-Net + Universe)
	pkt[15] = byte((universe >> 8) & 0x7F)  // Net
	pkt[16] = byte(length >> 8)             // LengthHi
	pkt[17] = byte(length & 0xFF)           // LengthLo
	copy(pkt[18:], data)
	return pkt
}

// Send envoie les données DMX pour un univers donné vers l'IP du contrôleur cible.
func (s *Sender) Send(ip string, universe uint16, seq byte, data []byte) error {
	addr := &net.UDPAddr{IP: net.ParseIP(ip), Port: Port}
	pkt := BuildDMXPacket(universe, seq, data)
	_, err := s.conn.WriteToUDP(pkt, addr)
	return err
}
