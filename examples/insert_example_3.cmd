@echo off
cls

rem Insert timeline entry as JSON object from content file
rem (note when content param on command line starts with a '@'
rem it is interpreted as filename without the @ from where to 
rem read the JSON object) with picture attachment

cli_mirror -I ^
	@insert_example_3.json ^
	./ColorBars.png
	

