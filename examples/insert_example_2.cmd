@echo off
cls

rem Insert timeline entry as JSON object on command line
rem (note the quoted double quotes) with picture attachment

node.exe cli_mirror.js -I ^
	"{""html"": ""<article>I am Example 2</article>""}" ^
	./ColorBars.png
	

