@echo off
cls

rem Insert timeline entry for a given lat lon position as Google Maps 
rem image attachment

node.exe cli_mirror.js -i ^
	"I am a map" - ^
	-p 48.209117 16.369522 X 10

