@echo off
cls

rem Insert timeline entry as JSON object on command line
rem (note the quoted double quotes) with no picture attachment

cli_mirror -I ^
	"{""html"": ""<article>I am Example 1</article>""}" -

