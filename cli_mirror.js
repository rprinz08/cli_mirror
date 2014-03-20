#!/usr/bin/env node
"use strict"; 

// richard.prinz@min.at 2014
// http://www.min.at/prinz/cli_mirror

var stdio = require('stdio'),
	fs = require('fs'),
	colors = require('colors'),
	glassAPI = require('cli_mirror');


// command line options
var programOptions = stdio.getopt({
	'help': { key: 'h', mandatory: false, args: 0,
		description: 'Shows this help infos' },
	'verbose': { key: 'v', 
		description: 'Verbose debug output' },
	'quiet': { key: 'q', 
		description: 'Don\'t show any output' },
	'glassid': { key: 'o', args: 1,
		description: 'Specify which Google Glass to communicate with.' },
	'list': { key: 'l', 
		description: 'List active timeline (no deleted entries)' },
	'listids': { key: 'L', 
		description: 'List active timeline (no deleted entries) as id list' },
	'delete': { key: 'd', args: 1,
		description: 'Delete timeline entry with ID' },
	'deleteall': { key: 'D', 
		description: 'Delete ALL entries in the timeline'},
	'get': { key: 'g', args: 1,
		description: 'Get timeline entry with ID' },
	'insert': { key: 'i', args: 2,
		description: 'Insert text timeline content and optional attachment (use - for no attachment)' },
	'insertJson': { key: 'I', args: 2,
		description: 'Insert JSON timeline object and optional attachment (use - for no attachment)' },
	'update': { key: 'u', args: 3,
		description: 'Update text timeline content and optional attachment' },
	'updateJson': { key: 'U', args: 3,
		description: 'Update JSON timeline content and optional attachment' },
	'position': { key: 'p', args: 4,
		description: 'Attach a position (LAT LON Marker Zoom) as Google Map' }
});



var args = {
	logMode: 0
}

// 0 - normal, 1 - debug, 2 - quiet
if(programOptions) {
	if(programOptions.quiet)
		args.logMode = 2;
	else if(programOptions.verbose)
		args.logMode = 1
}

var glass = new glassAPI.Glass(args);
glass.connectGui(null, doExit, main);


// main part
function main() {
	var entryID;
	
	// list timeline
	if(programOptions.list) {
		glass.logInfo('List timeline ...');
		
		glass.listTimeline(doExit, function(data) { 
			glass.logOK('Glass timeline:'); 
			console.log(JSON.stringify(data, null, 2));
			doExit();
		});
	}
	
	// list timeline as id's
	else if(programOptions.listids) {
		glass.logInfo('Get timeline entry id\'s ...');
		
		glass.listTimelineIDs(doExit, function(IDs) { 
			glass.logOK('Glass timeline id\'s:'); 
			IDs.forEach(function(id) {
				console.log(id);
			});
			glass.logOK('Listed timeline entries', IDs.length); 
			doExit();
		});
	}
	
	// delete a specific timeline entry
	else if(programOptions.delete) {
		entryID = programOptions.delete;
		glass.logInfo('Delete timeline entry:', entryID);
		
		glass.timelineDelete(entryID, doExit, function(data) { 
			glass.logOK('Timeline entry deleted', data); 
			doExit();
		});
	}
	
	// delete ALL timeline entries
	else if(programOptions.deleteall) {
		glass.logInfo('Delete ALL timeline entries!');
		
		glass.deleteTimeline(doExit, function(count) {
			glass.logOK('Timeline entries deleted'); 
			console.log(count);
			doExit();
		});				
	}
	
	// get a specific timeline entry
	else if(programOptions.get) {
		entryID = programOptions.get;
		glass.logInfo('Reading timeline entry:', entryID);
		
		glass.timelineGet(entryID, doExit, function(data) { 
			glass.logOK('Timeline entry'); 
			console.log(JSON.stringify(data, null, 2));
			doExit();
		});
	}
	
	// add entry to timeline
	else if(programOptions.insert || programOptions.insertJson) {			
		glass.logInfo('Inserting timeline entry');
		
		var isJSON = !!programOptions.insertJson;
		var params = (isJSON ? 
			programOptions.insertJson : programOptions.insert)
		
		var content = params[0];
		var attachment = params[1];

		var lat = null;
		var lon = null;
		var marker = null;
		var zoom = null;
			
		if(programOptions.position) {
			glass.logInfo('Using generated map image as attachment');
			
			lat = programOptions.position[0];
			lon = programOptions.position[1];
			marker = programOptions.position[2];
			zoom = programOptions.position[3];
		}
		
		glass.createTimelineEntry(content, 
			attachment, lat, lon, marker, zoom, isJSON,
			doExit, function(data) {
				glass.logOK('Timeline entry ID');
				console.log(data.id);
				glass.logDebug('Timeline entry', data);
				doExit();
			});
	}

	// update entry to timeline
	else if(programOptions.update || programOptions.updateJson) {
		var isJSON = !!programOptions.updateJson;
		var params = (isJSON ? 
			programOptions.updateJson : programOptions.update)
		entryID = params[0];
		
		glass.logInfo('Updating timeline entry:', entryID);
		
		var content = params[1];
		var attachment = params[2];

		var lat = null;
		var lon = null;
		var marker = null;
		var zoom = null;
			
		if(programOptions.position) {
			glass.logInfo('Using generated map image as attachment');
			
			lat = programOptions.position[0];
			lon = programOptions.position[1];
			marker = programOptions.position[2];
			zoom = programOptions.position[3];
		}
		
		glass.updateTimelineEntry(entryID, content,
			attachment, lat, lon, marker, zoom, isJSON,
			doExit, function(data) {
				glass.logOK('Timeline entry ID');
				console.log(data.id);
				glass.logDebug('Timeline entry', data);
				doExit();
			});
	}

	else {
		console.log();
		programOptions.printHelp();
		console.log();
		doExit();
	}
}

// exit the app
function doExit(error, exitCode) {
	if(!isInt(exitCode))
		exitCode = 0;
	exitCode = Math.abs(exitCode);
	
	if(error) {
		glass.logError('cli_mirror completed with errors'.red);
		var err;
		if(typeof error == 'string' || error instanceof String)
			err = error;
		else
			err = JSON.stringify(error, null, 2);
		err = err.replace(/\n/g, '\n      ') + '\r\n';
		glass.logError(err.red);
		
		
		if(exitCode < 1)
			exitCode = 1;
	}
	else
		glass.logOK('cli_mirror completed\r\n');

	process.exit(exitCode);
}



// ----------------------------------------------------------------------------
// Misc functions

function isInt(i_int) {
	var i = parseInt(i_int);
	if (isNaN(i))
		return false;
	return i_int == i && i_int.toString() == i.toString();
}
