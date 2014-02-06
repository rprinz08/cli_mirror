#!/usr/bin/env node
"use strict"; 

var stdio = require('stdio'),
	http = require('http'),
	path = require('path'),
	fs = require('fs'),
	fsEx = require('node-fs'),
	spawn = require('open'),
	colors = require('colors'),
	async = require('async'),
	mime = require('mime'),
	googleapis = require('googleapis'),
	OAuth2Client = googleapis.OAuth2Client;

var LOG_DEBUG = 0;
var LOG_INFO = 1;
var LOG_OK = 2;
var LOG_WARNING = 3;
var LOG_ERROR = 4;

var CONFIG_STORE = './config.json';
var OAUTH_STORE = './glasses/';
var DEFAULT_GLASS_ID = 'default';

// command line options
var programOptions = stdio.getopt({
	'help': { key: 'h', description: 'Shows this help infos', mandatory: false, args: 0 },
	'verbose': { key: 'v', description: 'Verbose debug output' },
	'quiet': { key: 'q', description: 'Don\'t show any output' },
	'glassid': { key: 'o', description: 'Specify which Google Glass to communicate with.', args: 1 },
	'list': { key: 'l', description: 'List active timeline (no deleted entries)' },
	'listids': { key: 'L', description: 'List active timeline (no deleted entries) as id list' },
	'delete': { key: 'd', description: 'Delete timeline entry with ID', args: 1 },
	'deleteall': { key: 'D', description: 'Delete ALL entries in the timeline'},
	'get': { key: 'g', description: 'Get timeline entry with ID', args: 1 },
	'insert': { key: 'i', description: 'Insert text timeline content and optional attachment (use - for no attachment)', args: 2 },
	'insertJson': { key: 'I', description: 'Insert JSON timeline object and optional attachment (use - for no attachment)', args: 2 },
	'update': { key: 'u', description: 'Update text timeline content and optional attachment', args: 3 },
	'updateJson': { key: 'U', description: 'Update JSON timeline content and optional attachment', args: 3 },
	'position':  { key: 'p', description: 'Attach a position (LAT LON Marker Zoom) as Google Map', args: 4 }
});



// ----------------------------------------------------------------------------
// Main part

// ensure glass authentication store exists
var glass_id = programOptions.glassid || DEFAULT_GLASS_ID;
glass_id = glass_id.replace(/[^a-zA-Z0-9_-]/g, '');
var glass_store = path.resolve(__dirname, OAUTH_STORE);
fsEx.mkdirSync(glass_store, 755, true);
glass_store = path.join(glass_store, glass_id + '.json');

// ensure cli_mirror has infos about a google project
// see http://www.min.at/prinz/cli_mirror#project
// for more infos
var config_store = path.resolve(__dirname, CONFIG_STORE);
if(!fs.existsSync(config_store))
	doExit('config.json not found!\r\nSee http://www.min.at/prinz/cli_mirror#project for more infos.');	
var config = require(config_store);

// init OAuth client with Google Project credentials
var oauth2Client = new OAuth2Client(
	config.installed.client_id,
	config.installed.client_secret,
	config.installed.redirect_uris[0]);

// main part
ensureToken(main);

function main() {
	var entryID;
	var counter = 0;
	
	googleapis
		.discover('mirror', 'v1')
		.execute(function(error, client) {
			if(error) {
				log(LOG_ERROR, 'Error using Google Mirror API', error);
				doExit(error);
			}
			
			// list timeline
			if(programOptions.list) {
				log(LOG_INFO, 'List timeline ...');
				
				listTimeline(client, doExit, function(data) { 
					log(LOG_OK, 'Glass timeline:'); 
					console.log(JSON.stringify(data, null, 2));
					doExit();
				});
			}
			
			// list timeline as id's
			else if(programOptions.listids) {
				log(LOG_INFO, 'Get timeline entry id\'s ...');
				
				counter = 0;
				listTimeline(client, doExit, function(data) { 
					log(LOG_OK, 'Glass timeline id\'s:'); 
					data.items.map(function(item) {
						console.log(item.id);
						counter++
					});
					log(LOG_OK, 'Listed timeline entries', counter); 
					doExit();
				});
			}
			
			// delete a specific timeline entry
			else if(programOptions.delete) {
				entryID = programOptions.delete;
				log(LOG_INFO, 'Delete timeline entry:', entryID);
				
				timelineDelete(client, entryID, doExit, function(data) { 
					log(LOG_OK, 'Timeline entry deleted', data); 
					doExit();
				});
			}
			
			// delete ALL timeline entries
			else if(programOptions.deleteall) {
				log(LOG_INFO, 'Delete ALL timeline entries!');
				
				counter = 0;
				listTimeline(client, doExit, function(data) { 
					var deleteJobs = [];
					data.items.map(function(item) {
						deleteJobs.push(function(callback) {
							timelineDelete(client, item.id, 
								function(error) {
									callback(error, null)
								},
								function(data) {
									counter++
									callback(null, data);
								});
						});
					});
					async.series(deleteJobs, function(error, data) {
						if(error)
							doExit(error);
						
						log(LOG_OK, 'Timeline entries deleted'); 
						console.log(counter);
						doExit();
					});
				});
			}
			
			// get a specific timeline entry
			else if(programOptions.get) {
				entryID = programOptions.get;
				log(LOG_INFO, 'Reading timeline entry:', entryID);
				
				timelineGet(client, entryID, doExit, function(data) { 
					log(LOG_OK, 'Timeline entry'); 
					console.log(JSON.stringify(data, null, 2));
					doExit();
				});
			}
			
			/*
			insertContact(client, doExit, function(data) { 
				success('insert contact', data);
				doExit(); 
			});			
			*/
			
			// add entry to timeline
			else if(programOptions.insert || programOptions.insertJson) {
				var isJSON = !!programOptions.insertJson;
				var params = (isJSON ? 
					programOptions.insertJson : programOptions.insert)
				
				var content = params[0];
				var attachment = params[1];
				var attachmentMime = mime.lookup(attachment);
				log(LOG_INFO, 'Inserting timeline entry');

				if(!attachment || attachment == '-' || !fs.existsSync(attachment)) {
					if(attachment != '-')
						log(LOG_WARNING, 'Attachment specified (' + attachment + 
											') but not found.');
					else {
						if(programOptions.position) {
							log(LOG_INFO, 'Using generated map image as attachment');
							var lat = programOptions.position[0];
							var lon = programOptions.position[1];
							var marker = programOptions.position[2];
							var zoom = programOptions.position[3];

							if(!/^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?)$/.test(lat))
								doExit('Invalid latitude ('+ lat +')');
								
							if(!/^[-+]?((1[0-7]\d)|([1-9]?\d))(\.\d+)?|(180(\.0+)?)$/.test(lon))
								doExit('Invalid longitude ('+ lon +')');
								
							if(!/^[0-9]|1[0-9]|-$/.test(zoom))
								zoom = '-';
								
							getMap(lat, lon, zoom, marker,
								function(error) {
									log(LOG_ERROR, 'Error getting map image');
									doExit(error);
								},
								function(mapMime, mapImage) {
									timelineInsert(client, content, 
											mapMime, mapImage,
											doExit, function(data) { 
										log(LOG_OK, 'Timeline entry ID');
										console.log(data.id);
										log(LOG_DEBUG, 'Timeline entry', data);
										doExit();
									}, isJSON);
								});
							
							return;
						}
					}					
					
					attachment = null
					attachmentMime = null;
				}
				else {
					attachmentMime = mime.lookup(attachment);
					attachment = fs.readFileSync(attachment);
				}

				timelineInsert(client, content, 
						attachmentMime, attachment,
						doExit, function(data) { 
					log(LOG_OK, 'Timeline entry ID');
					console.log(data.id);
					log(LOG_DEBUG, 'Timeline entry', data);
					doExit();
				}, isJSON);
			}

			// update entry to timeline
			else if(programOptions.update || programOptions.updateJson) {
				var isJSON = !!programOptions.updateJson;
				var params = (isJSON ? 
					programOptions.updateJson : programOptions.update)
				entryID = params[0];
				log(LOG_INFO, 'Updating timeline entry:', entryID);
				
				var content = params[1];
				var attachment = params[2];
				var attachmentMime = mime.lookup(attachment);

				if(!attachment || attachment == '-' || !fs.existsSync(attachment)) {
					if(attachment != '-')
						log(LOG_WARNING, 'Attachment specified (' + attachment + 
											') but not found.');
					else {
						if(programOptions.position) {
							log(LOG_INFO, 'Using generated map image as attachment');
							var lat = programOptions.position[0];
							var lon = programOptions.position[1];
							var marker = programOptions.position[2];
							var zoom = programOptions.position[3];

							if(!/^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?)$/.test(lat))
								doExit('Invalid latitude ('+ lat +')');
								
							if(!/^[-+]?((1[0-7]\d)|([1-9]?\d))(\.\d+)?|(180(\.0+)?)$/.test(lon))
								doExit('Invalid longitude ('+ lon +')');
								
							if(!/^[0-9]|1[0-9]|-$/.test(zoom))
								zoom = '-';
								
							getMap(lat, lon, zoom, marker,
								function(error) {
									log(LOG_ERROR, 'Error getting map image');
									doExit(error);
								},
								function(mapMime, mapImage) {
									timelineUpdate(client, entryID, content, 
											mapMime, mapImage,
											doExit, function(data) { 
										log(LOG_OK, 'Timeline entry ID');
										console.log(data.id);
										log(LOG_DEBUG, 'Timeline entry', data);
										doExit();
									}, isJSON);
								});
							
							return;
						}
					}					
					
					attachment = null
					attachmentMime = null;
				}
				else {
					attachmentMime = mime.lookup(attachment);
					attachment = fs.readFileSync(attachment);
				}

				timelineUpdate(client, entryID, content, 
						attachmentMime, attachment,
						doExit, function(data) { 
					log(LOG_OK, 'Timeline entry ID');
					console.log(data.id);
					log(LOG_DEBUG, 'Timeline entry', data);
					doExit();
				}, isJSON);
			}

			else {
				programOptions.printHelp();
				doExit();
			}
		});
}

// exit the app
function doExit(error, exitCode) {
	if(!isInt(exitCode))
		exitCode = 0;
	exitCode = Math.abs(exitCode);
	
	if(error) {
		log(LOG_ERROR, 'cli_mirror completed with errors'.red);
		var err;
		if(typeof error == 'string' || error instanceof String)
			err = error;
		else
			err = JSON.stringify(error, null, 2);
		err = err.replace(/\n/g, '\n      ');
		log(LOG_ERROR, err.red);
		
		
		if(exitCode < 1)
			exitCode = 1;
	}
	else
		log(LOG_OK, 'cli_mirror completed');

	process.exit(exitCode);
}



// ----------------------------------------------------------------------------
// OAuth functions

function ensureToken(callback) {
	try {
		if(fs.existsSync(glass_store)) {
			log(LOG_INFO, 'Existing Google OAuth tokens available for ' +
							'Google Glass (' + glass_id.magenta + ')');
			oauth2Client.credentials = require(glass_store);
		}
	}
	catch(error) {
		log(LOG_ERROR, 'Unable to use existing Google OAuth tokens', error);
	}
	
    if (!oauth2Client.credentials) {
		log(LOG_WARNING, 'Google OAuth tokens missing or invalid for ' +
							'Google Glass (' + glass_id.magenta + ')');
		log(LOG_WARNING, 'Requesting new ones');
        var url = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: 'https://www.googleapis.com/auth/glass.timeline'
        });
		
        requestCode(url, callback);
    }
	else
		if(callback)
			callback();
}

function requestCode(requestUrl, callback) {
	// call google oauth service. url according to:
	// https://developers.google.com/accounts/docs/OAuth2WebServer
	
	console.log('\r\n\r\Use your browser to open this URL:\r\n');
	console.log(requestUrl.cyan);
	console.log('\r\nThen come back and enter the CODE here\r\n');

	// start user browser for oauth registration
	spawn(requestUrl, function(error) {
		if(error) {
			log(LOG_ERROR, 'Error starting user web browser', error);
			doExit(error);
		}
	});
	
	// ask user for code parameter 
	ask('CODE', /.+/, function(code) {
		console.log();
		
		grabToken(code, callback);
	});
}

function grabToken(code, callback){
    oauth2Client.getToken(code, function(error, tokens){
        if (error) {
			log(LOG_ERROR, 'Error getting OAuth token', error);
			doExit(error);
        }
		else {
            log(LOG_DEBUG, 'tokens', tokens);
            oauth2Client.credentials = tokens;

			// save oauth token
			fs.writeFileSync(glass_store, 
				JSON.stringify(tokens, null, 4));
            log(LOG_OK, 'Google OAuth tokens saved for ' +
							'Google Glass (' + glass_id.magenta + ')');
			log(LOG_DEBUG, 'Tokens:', tokens);
		
			if(callback)
				callback();
        }
    });
};



// ----------------------------------------------------------------------------
// Google Glass Mirror API

function timelineInsert(client, message, attachmentMime, attachment,
		errorCallback, successCallback, isJSON) {
	// insert message into timeline
	
	var msg;

	if(message[0] == '@') {
		var messageFile = message.substring(1);
		if(!fs.existsSync(messageFile)) {
			var error = 'Timeline entry contentfile (' + messageFile + ') not found';
			if(errorCallback)
				errorCallback(error);
			else
				doExit(error);
		}
		message = fs.readFileSync(messageFile);
	}
	
	if(isJSON)
		msg = JSON.parse(message);
	else 
		msg = {
			'text': message,
			'menuItems': [{'action': 'DELETE'}]
		}
	
    client
		.mirror.timeline.insert(msg)
		.withAuthClient(oauth2Client)
		.execute(function(error, data, res) {
			if (error) {
				if(errorCallback)
					errorCallback(error);
			}
			else {
				var timelineEntry = data;
				
				// if attachment available - insert it
				if(attachmentMime && attachment) {
					log(LOG_DEBUG, 'Add attachment to timeline id: ', timelineEntry.id);
					client
						.mirror.timeline.attachments.insert({
							'itemId': timelineEntry.id,
							'uploadType': 'media'
						})
						.withMedia(attachmentMime, attachment)
						.withAuthClient(oauth2Client)
						.execute(function(error, data, res) {
							if (error) {
								if(errorCallback)
									errorCallback(error);
							}
							else {					
								if(successCallback)
									successCallback(timelineEntry);
							}
						});
				}
				else
					if(successCallback)
						successCallback(timelineEntry);
			}
		});
};

function timelineUpdate(client, entryID, message, attachmentMime, attachment,
		errorCallback, successCallback, isJSON) {
	// update entry in the timeline
	
	var msg;

	if(message[0] == '@') {
		var messageFile = message.substring(1);
		if(!fs.existsSync(messageFile)) {
			var error = 'Timeline entry contentfile (' + messageFile + ') not found';
			if(errorCallback)
				errorCallback(error);
			else
				doExit(error);
		}
		message = fs.readFileSync(messageFile);
	}
	
	if(isJSON)
		msg = JSON.parse(message);
	else 
		msg = {
			'text': message,
			'menuItems': [{'action': 'DELETE'}]
		}

    client
		.mirror.timeline.patch({'id': entryID}, msg)
		.withAuthClient(oauth2Client)
		.execute(function(error, data, res) {
			if (error) {
				if(errorCallback)
					errorCallback(error);
			}
			else {
				var timelineEntry = data;
				
				// if attachment available - insert it
				if(attachmentMime && attachment) {
					log(LOG_DEBUG, 'Add attachment to timeline id: ', timelineEntry.id);
					client
						.mirror.timeline.attachments.insert({
							'itemId': timelineEntry.id,
							'uploadType': 'media'
						})
						.withMedia(attachmentMime, attachment)
						.withAuthClient(oauth2Client)
						.execute(function(error, data, res) {
							if (error) {
								if(errorCallback)
									errorCallback(error);
							}
							else {					
								if(successCallback)
									successCallback(timelineEntry);
							}
						});
				}
				else
					if(successCallback)
						successCallback(timelineEntry);
			}
		});
};

function timelineDelete(client, entryID,
		errorCallback, successCallback) {
	// delete timeline entry
    client
		.mirror.timeline.delete({
			'id': entryID
		})
		.withAuthClient(oauth2Client)
		.execute(function(error, data, res) {
			if (error) {
				if(errorCallback)
					errorCallback(error);
			}
			else {
				if(successCallback)
					successCallback(data);
			}
		});
}

function timelineGet(client, entryID,
		errorCallback, successCallback) {
	// get timeline entry by id
    client
		.mirror.timeline.get({
			'id': entryID
		})
		.withAuthClient(oauth2Client)
		.execute(function(error, data, res) {
			if (error) {
				if(errorCallback)
					errorCallback(error);
			}
			else {
				if(successCallback)
					successCallback(data);
			}
		});
}

function insertContact(client, errorCallback, successCallback) {
    client
		.mirror.contacts.insert({
			"id": "prinz",
			"displayName": "Richard Prinz",
			"iconUrl": "http://www.min.at/prinz/rprinz.png",
			"priority": 7,
			"acceptCommands": [
				{"type": "POST_AN_UPDATE"},
				{"type": "TAKE_A_NOTE"}
			]
		})
		.withAuthClient(oauth2Client)
		.execute(function(error, data) {
			if (error)
				errorCallback(error);
			else
				successCallback(data);
		});
};

function listTimeline(client, errorCallback, successCallback) {
    client
		.mirror.timeline.list()
		.withAuthClient(oauth2Client)
		.execute(function(error, data, res) {
			if (error) {
				if(errorCallback)
					errorCallback(error);
			}
			else {
				if(successCallback)
					successCallback(data);
			}
		});
};



// ----------------------------------------------------------------------------
// Misc functions

function ask(question, format, callback) {
	var stdin = process.stdin
	var stdout = process.stdout;

	stdin.resume();
	stdout.write(question + ": ");

	stdin.once('data', function(data) {
		data = data.toString().trim();
		if(format.test(data)) {
			if(callback)
				callback(data);
		}
		else {
			stdout.write("It should match: "+ format +"\n");
			ask(question, format, callback);
		}
	});
}

function log(severity, message, object) {
	if(programOptions && programOptions.quiet)
		return;
		
	switch(severity) {
		case 0:
			if(programOptions && programOptions.verbose)
				console.log('[DBG] '.grey + message);
			break;
		case 2:
			console.log('[OK ] '.green + message);
			break;
		case 3:
			console.log('[WRN] '.yellow + message);
			break;
		case 4:
			console.log('[ERR] '.red + message);
			break;
		default:
			console.log('[INF] '.white + message);
			break;
	}

	if(object)
		if(severity > 0 || programOptions && programOptions.verbose)
			console.log(object);
}

function isInt(i_int) {
	var i = parseInt(i_int);
	if (isNaN(i))
		return false;
	return i_int == i && i_int.toString() == i.toString();
}

function getMap(lat, lon, zoom, marker, errorCallback, successCallback) {
	var position;
	if(marker && marker != '-')
		position = 'markers=color:red%7Clabel:' + marker.toString()[0] + 
			'%7C' + lat + ',' + lon;
	else {
		marker = null;
		position = 'center=' + lat + ',' + lon;
	}
	
	if(zoom == '-')
		zoom = null;
	if(!marker && !zoom)
		zoom = 12;
	if(zoom)
		zoom = 'zoom=' + zoom;
	
	var mapUrl = 'http://maps.googleapis.com/maps/api/staticmap?' +
		position + '&' +
		zoom +'&' +
		'size=640x320&format=png&sensor=false';

	log(LOG_DEBUG, 'Get map image from:', mapUrl);
	
	http.get(mapUrl, function(res) {
		var buffers = [];
		var length = 0;

		res.on('error', function(error) {
			if(errorCallback)
				errorCallback(error);
			else
				doExit(error);
		});
		
		res.on('data', function(chunk) {
			length += chunk.length;
			buffers.push(chunk);
		});

		res.on('end', function() {
			var mapImage = Buffer.concat(buffers);

			// determine the type of the image
			// with image/jpeg being the default
			var mapMime = 'image/jpeg';
			if(res.headers['content-type'] !== undefined)
				mapMime = res.headers['content-type'];
				
			log(LOG_OK, 'Map image successfully generated');
				
			if(successCallback)
				successCallback(mapMime, mapImage);
		});
	});
}

function readFileBase64(path) {
	var s = fs.readFileSync(path);
	return base64Image = s.toString('base64');
}
