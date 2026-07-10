package main

import (
	"image"
	"image/color"
	"image/draw"
)

const (
	cellSize  = 6
	dotRadius = 2
)

// Grille des 512 canaux DMX bruts d'un univers, en niveau de gris (0=noir,
// 255=blanc) : ce qui part vraiment sur le fil, canal par canal.
const (
	dmxCols     = 16
	dmxRows     = 512 / dmxCols
	dmxCellSize = 14
)

// drawDot peint un disque plein (une LED) centré sur (cx,cy).
func drawDot(img *image.RGBA, cx, cy, radius int, col color.Color) {
	for dy := -radius; dy <= radius; dy++ {
		for dx := -radius; dx <= radius; dx++ {
			if dx*dx+dy*dy <= radius*radius {
				img.Set(cx+dx, cy+dy, col)
			}
		}
	}
}

func drawChannelGrid(img *image.RGBA, channels [512]byte) {
	draw.Draw(img, img.Bounds(), image.NewUniform(color.Black), image.Point{}, draw.Src)
	for i, v := range channels {
		col, row := i%dmxCols, i/dmxCols
		x0, y0 := col*dmxCellSize+1, row*dmxCellSize+1
		gray := color.Gray{Y: v}
		for dy := range dmxCellSize - 2 {
			for dx := range dmxCellSize - 2 {
				img.Set(x0+dx, y0+dy, gray)
			}
		}
	}
}
