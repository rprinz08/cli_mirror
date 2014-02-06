@echo off
cls

rem Insert timeline entry as simple text from command line
rem with picture attachment

node.exe cli_mirror.js -i ^
	"I am a simple text from example 4 with attachment" ^
	./ColorBars.png

