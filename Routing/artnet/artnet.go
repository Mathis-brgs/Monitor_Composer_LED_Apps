// Package artnet construit et envoie des paquets ArtDMX
// vers des contrôleurs DMX/ArtNet.
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

// BuildDMXPacket construit un paquet ArtDMX (max 512 octets DMX512).
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
	pkt[10] = 0                            // ProtVerHi
	pkt[11] = 14                           // ProtVerLo
	pkt[12] = seq                          // Sequence (0 = désactivé)
	pkt[13] = 0                            // Physical
	pkt[14] = byte(universe & 0xFF)        // SubUni (Sub-Net + Universe)
	pkt[15] = byte((universe >> 8) & 0x7F) // Net
	pkt[16] = byte(length >> 8)            // LengthHi
	pkt[17] = byte(length & 0xFF)          // LengthLo
	copy(pkt[18:], data)
	return pkt
}

func (s *Sender) Send(ip string, universe uint16, seq byte, data []byte) error {
	addr := &net.UDPAddr{IP: net.ParseIP(ip), Port: Port}
	pkt := BuildDMXPacket(universe, seq, data)
	_, err := s.conn.WriteToUDP(pkt, addr)
	return err
}
