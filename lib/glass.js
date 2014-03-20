"use strict";

// richard.prinz@min.at 2014
// http://www.min.at/prinz/cli_mirror

// ============================================================================
// Variables

var Q = require('q'),
	path = require('path'),
    util = require('util'),
	colors = require('colors'),	
	http = require('http'),
	fs = require('fs'),
	fsEx = require('node-fs'),
	spawn = require('open'),	
	async = require('async'),
	mime = require('mime'),
	googleapis = require('googleapis'),
	OAuth2Client = googleapis.OAuth2Client;

	
	
// ============================================================================
// Constructor

/**
 * Constructs a Glass object for using the Google Glass Mirror API.
 * @constructor
 * @param {Object} args A configuration object containing the following
 *        fields (all optional):
 *           appConfig Object An object containing OAuth app tokens created
 *                     by the Google Project Console 
 *                     https://console.developers.google.com/project
 *           glassConfig Object An object containing OAuth tokens for a
 *                     specific Google Account
 *           glassID String An ID of Glass Device. This can be any name
 *                     as long as it uniquely identifies a specific device. 
 *                     Defaults to "default"
 *           logMode Integer Defines how informations are written to
 *                     the console. 0 - normal, 1 - debug, 2 - quiet
 *
 * If both "glassConfig" and "glassID" are specified, "glassID" is ignored.
 */
function Glass(args) {
	var self = this;

	self.LOG_DEBUG = 0;
	self.LOG_INFO = 1;
	self.LOG_OK = 2;
	self.LOG_WARNING = 3;
	self.LOG_ERROR = 4;

	var APP_CONFIG_STORE = './config.json';
	
	self.appConfig = (args ? args['appConfig'] : null);
	// ensure cli_mirror has infos about a Google project
	// see http://www.min.at/prinz/cli_mirror#project
	// for more infos
	self.appConfigStore = path.resolve(path.dirname(process.mainModule.filename), 
		APP_CONFIG_STORE);
	
	self.glassConfig = (args ? args['glassConfig'] : null);
	self.glassID = (args ? args['glassID'] : null);
	self._prepareGlassConfigStore(self.glassID);
	
	// 0 - normal, 1 - debug, 2 - quiet
	self.logMode = (args ? args['logMode'] : 0);
	if(!self._isInt(self.logMode))
		self.logMode = 0;
	self.logMode = Math.abs(self.logMode);
	if(self.logMode < 0 || self.logMode > 2)
		self.logMode = 0;
}



// ============================================================================
// Public Methods

/**
 * Connects to Googles Glass Mirror API and provides a text mode user interface
 * in case the given glassID was not already registered
 *
 * @param {String} glassID Optional id of Glass Device. This can be any name
 *        as long as it uniquely identifies a specific device. Defaults to
 *        "default"
 * @param {function()} errorCallback Optional callback function in case of 
 *        any errors
 * @param {function()} successCallback Optional callback function called
 *        when connect was successful
 */
Glass.prototype.connectGui = function(glassID, errorCallback, successCallback) {
	var self = this;
	var msg;

	// read app.config if no one was given during object creation
	if(!self.appConfig) {
		if(!fs.existsSync(self.appConfigStore)) {
			msg = 'app.config not found at ' + 
					self.appConfigStore + '!\r\n' +
					'See http://www.min.at/prinz/cli_mirror#project for more infos.';
			if(errorCallback) {
				errorCallback(msg);	
				return;
			}
		}
		
		try {
			self.appConfig = require(self.appConfigStore);
		}
		catch(error) {
			msg = 'Unable to use existing app config at ' + 
					self.appConfigStore + '!\r\n' +
					'See http://www.min.at/prinz/cli_mirror#project for more infos.'
			if(errorCallback) {
				errorCallback(msg);	
				return;
			}
		}
	}
		
	// create a glass id config file if no glass config file was given
	// during object cration
	if(!self.glassConfig) {
		if(!self.glassID) {
			self.glassID = glassID;
			self._prepareGlassConfigStore(self.glassID);
		}
		
		try {
			if(fs.existsSync(self.glassConfigStore)) {
				self.logInfo('Existing Google OAuth tokens available for ' +
								'Google Glass (' + self.glassID.magenta + ')');
				self.glassConfig = require(self.glassConfigStore);
			}
		}
		catch(error) {
			self.logError('Unable to use existing Google OAuth tokens', error);
		}

		if (!self.glassConfig) {
			self.logWarning('Google OAuth tokens missing or invalid for ' +
								'Google Glass (' + self.glassID.magenta + ')');
		}		
	}
		
	self.connect(
		// requestCodeCallback
		function(url) {
			self.logWarning('Requesting new Google OAuth tokens');
			return self._requestCode(url, errorCallback, function(code) {
				return code
			});
		},
		// saveTokenCallback
		function(tokens) {
			fs.writeFileSync(self.glassConfigStore, 
				JSON.stringify(tokens, null, 4));
			self.logOK('Google OAuth tokens saved for ' +
							'Google Glass (' + self.glassID.magenta + ')');
			self.logDebug('Tokens:', tokens);
		},
		// errorCallback
		errorCallback,
		// successCallback
		successCallback);	
}
	
/**
 * Connects to Googles Glass Mirror API without providing any GUI. Instead 
 * all interactions are done by using callbacks.
 *
 * @param {function()} requestCodeCallback Optional callback function in case 
 *        of a missing Glass config. Callback must call Google to retrieve
 *        an OAuth code for the given glassID and return this using a value or
 *        promise
 * @param {function()} saveTokenCallback Optional callback function to save
 *        OAuth tokens for later use 
 * @param {function()} errorCallback Optional callback function in case of 
 *        any errors
 * @param {function()} successCallback Optional callback function called
 *        when connect was successful
 */
Glass.prototype.connect = function(requestCodeCallback, saveTokenCallback,
		errorCallback, successCallback) {
	var self = this;

	// init OAuth client with Google Project credentials
	self.oauth2Client = new OAuth2Client(
		self.appConfig.installed.client_id,
		self.appConfig.installed.client_secret,
		self.appConfig.installed.redirect_uris[0]);

	self.oauth2Client.credentials = self.glassConfig;
		
    if (!self.oauth2Client.credentials) {
        var url = self.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: 'https://www.googleapis.com/auth/glass.timeline'
        });
		
		if(requestCodeCallback) {
			Q(requestCodeCallback(url)).then(function(code) {
				if(code) {
					self.oauth2Client.getToken(code, function(error, tokens){
						if(error) {
							if(errorCallback)
								errorCallback(error);
							return;
						}
						else {
							self.oauth2Client.credentials = tokens;
							if(saveTokenCallback)
								saveTokenCallback(tokens);
							self._connect(errorCallback, successCallback);
						}
					});
				}
				else {
					if(errorCallback)
						errorCallback('no oAuth code provided');
					return;
				}
			});
		}
		else {
			if(errorCallback)
				errorCallback('no requestCodeCallback specified');
			return;
		}
    }
	else {
		self._connect(errorCallback, successCallback);
	}
}

/**
 * Logs text to the console using a [DBG] prefix in dark grey colour and
 * optionally an objects properties
 *
 * @param {String} message Optional message to display on console 
 * @param {Object} object Optional object who's properties should be 
 *        displayed under the message text
 */
Glass.prototype.logDebug = function(message, object) {
	var self = this;
	self.log(self.LOG_DEBUG, message, object);
}

/**
 * Logs text to the console using a [INF] prefix in white and
 * optionally an objects properties
 *
 * @param {String} message Optional message to display on console 
 * @param {Object} object Optional object who's properties should be 
 *        displayed under the message text
 */
Glass.prototype.logInfo = function(message, object) {
	var self = this;
	self.log(self.LOG_INFO, message, object);
}

/**
 * Logs text to the console using a [OK ] prefix in green colour and
 * optionally an objects properties
 *
 * @param {String} message Optional message to display on console 
 * @param {Object} object Optional object who's properties should be 
 *        displayed under the message text
 */
Glass.prototype.logOK = function(message, object) {
	var self = this;
	self.log(self.LOG_OK, message, object);
}

/**
 * Logs text to the console using a [WRN] prefix in yellow and
 * optionally an objects properties
 *
 * @param {String} message Optional message to display on console 
 * @param {Object} object Optional object who's properties should be 
 *        displayed under the message text
 */
Glass.prototype.logWarning = function(message, object) {
	var self = this;
	self.log(self.LOG_WARNING, message, object);
}

/**
 * Logs text to the console using a [ERR] prefix in red colour and
 * optionally an objects properties
 *
 * @param {String} message Optional message to display on console 
 * @param {Object} object Optional object who's properties should be 
 *        displayed under the message text
 */
Glass.prototype.logError = function(message, object) {
	var self = this;
	self.log(self.LOG_ERROR, message, object);
}

/**
 * Logs text to the console using a selectable prefix and colour and
 * optionally an objects properties
 *
 * @param {Integer} severity Selects how a message should be displayed.
 *        See also the LOG_* constants. 
 *              LOG_DEBUG = 0
 *              LOG_INFO = 1
 *              LOG_OK = 2
 *              LOG_WARNING = 3
 *              LOG_ERROR = 4
 * @param {String} message Optional message to display on console 
 * @param {Object} object Optional object who's properties should be 
 *        displayed under the message text
 */
Glass.prototype.log = function(severity, message, object) {
	var self = this;
	
	// 0 - normal
	// 1 - debug
	// 2 - quiet	
	if(self.logMode == 2)
		return;
		
	switch(severity) {
		case self.LOG_DEBUG:
			if(self.logMode == 1)
				console.log('[DBG] '.grey + message);
			break;
		case self.LOG_OK:
			console.log('[OK ] '.green + message);
			break;
		case self.LOG_WARNING:
			console.log('[WRN] '.yellow + message);
			break;
		case self.LOG_ERROR:
			console.log('[ERR] '.red + message);
			break;
		default:
			console.log('[INF] '.white + message);
			break;
	}

	if(object)
		if(severity > 0 || self.logMode == 1)
			console.log(object);
}

/**
 * Retrieves ALL timeline entries from the connected Glass and returns a
 * Mirror API timeline object
 *
 * @param {function()} errorCallback Optional callback function in case of 
 *        any errors
 * @param {function()} successCallback Optional callback function called
 *        when API call was successful
 */
Glass.prototype.listTimeline = function(errorCallback, successCallback) {
	var self = this;
	
	self._listTimeline(self.mirrorApi, errorCallback, successCallback);
}

/**
 * Retrieves ALL timeline entries from the connected Glass and returns an
 * array of timeline entry ID's
 *
 * @param {function()} errorCallback Optional callback function in case of 
 *        any errors
 * @param {function()} successCallback Optional callback function called
 *        when API call was successful
 */
Glass.prototype.listTimelineIDs = function(errorCallback, successCallback) {
	var self = this;
	
	self._listTimeline(self.mirrorApi, errorCallback, function(data) { 
		var ids = [];
		data.items.map(function(item) {
			ids.push(item.id);
		});
		
		if(successCallback)
			successCallback(ids);
	});
}

Glass.prototype.createTimelineEntry = function(content, 
		attachment, lat, lon, marker, zoom,  isJSON,
		errorCallback, successCallback) {

	var self = this;
	var attachmentMime;

	if(!attachment || attachment == '-' || !fs.existsSync(attachment)) {
		if(attachment && attachment != '-')
			self.logWarning('Attachment specified (' + attachment + 
								') but not found.');
		else {
			if(lat && lon) {
				if(!/^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?)$/.test(lat)) {
					if(errorCallback)
						errorCallback('Invalid latitude ('+ lat +')');
					return;
				}
					
				if(!/^[-+]?((1[0-7]\d)|([1-9]?\d))(\.\d+)?|(180(\.0+)?)$/.test(lon)) {
					if(errorCallback)
						errorCallback('Invalid longitude ('+ lon +')');
					return;
				}
					
				if(!/^[0-9]|1[0-9]|-$/.test(zoom))
					zoom = '-';
					
				self._getMap(lat, lon, zoom, marker,
					errorCallback,
					function(mapMime, mapImage) {
						self._timelineInsert(self.mirrorApi, content, 
							mapMime, mapImage,
							errorCallback, successCallback, 
							isJSON);
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

	self._timelineInsert(self.mirrorApi, content, 
		attachmentMime, attachment,
		errorCallback, successCallback, 
		isJSON);
}

/**
 * Retrieves one timeline entrie by its unique id and returns a Mirror API
 * timeline entry object or null if not found
 *
 * @param {String} entryID The unique ID of the timelie entry to read
 * @param {function()} errorCallback Optional callback function in case of 
 *        any errors
 * @param {function()} successCallback Optional callback function called
 *        when API call was successful
 */
Glass.prototype.readTimelineEntry = function(entryID,
		errorCallback, successCallback) {

	var self = this;
	
	self._timelineGet(self.mirrorApi, entryID, errorCallback, successCallback);
}

Glass.prototype.updateTimelineEntry = function(entryID, content,
		attachment, lat, lon, marker, zoom,  isJSON,
		errorCallback, successCallback) {
		
	var self = this;
	var attachmentMime;

	if(!attachment || attachment == '-' || !fs.existsSync(attachment)) {
		if(!attachment && attachment != '-')
			self.logWarning('Attachment specified (' + attachment + 
								') but not found.');
		else {
			if(lat && lon) {
				if(!/^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?)$/.test(lat)) {
					if(errorCallback)
						errorCallback('Invalid latitude ('+ lat +')');
					return;
				}
					
				if(!/^[-+]?((1[0-7]\d)|([1-9]?\d))(\.\d+)?|(180(\.0+)?)$/.test(lon)) {
					if(errorCallback)
						errorCallback('Invalid longitude ('+ lon +')');
					return;
				}
					
				if(!/^[0-9]|1[0-9]|-$/.test(zoom))
					zoom = '-';

				self._getMap(lat, lon, zoom, marker,
					errorCallback,
					function(mapMime, mapImage) {
						self._timelineUpdate(self.mirrorApi, entryID, content, 
							mapMime, mapImage,
							errorCallback, successCallback, 
							isJSON);
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

	self._timelineUpdate(self.mirrorApi, entryID, content, 
		attachmentMime, attachment,
		errorCallback, successCallback, isJSON);
}

/**
 * Deletes one timeline entrie by its unique id and returns a Mirror API
 * timeline entry object or null if not deleted
 *
 * @param {String} entryID The unique ID of the timelie entry to delete
 * @param {function()} errorCallback Optional callback function in case of 
 *        any errors
 * @param {function()} successCallback Optional callback function called
 *        when API call was successful
 */
Glass.prototype.deleteTimelineEntry = function(entryID, 
		errorCallback, successCallback) {

	var self = this;
	
	self._timelineDelete(self.mirrorApi, entryID, errorCallback, successCallback);
}

/**
 * Deletes ALL timeline entries from the timeline and returns the number
 * of deleted entries
 *
 * @param {function()} errorCallback Optional callback function in case of 
 *        any errors
 * @param {function()} successCallback Optional callback function called
 *        when API call was successful
 */
Glass.prototype.deleteTimeline = function(errorCallback, successCallback) {
	var self = this;
	
	var counter = 0;
	self._listTimeline(self.mirrorApi, errorCallback, function(data) { 
		var deleteJobs = [];
		data.items.map(function(item) {
			deleteJobs.push(function(callback) {
				self._timelineDelete(self.mirrorApi, item.id, 
					function(error) {
						callback(error, null)
					},
					function(data) {
						counter++
						callback(null, data);
					});
			});
		});
		async.series(deleteJobs, function(errorCallback, data) {
			if(successCallback)
				successCallback(counter);
		});
	});
}



// ============================================================================
// Private Methods

// ----------------------------------------------------------------------------
// Google Glass Mirror API

Glass.prototype._timelineInsert = function(client, 
		message, attachmentMime, attachment,
		errorCallback, successCallback, isJSON) {
	// insert message into timeline
	
	var self = this;
	var msg;

	if(message[0] == '@') {
		var messageFile = message.substring(1);
		if(!fs.existsSync(messageFile)) {
			var error = 'Timeline entry contentfile (' + messageFile + ') not found';
			if(errorCallback)
				errorCallback(error);
			return;
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
		.withAuthClient(self.oauth2Client)
		.execute(function(error, data, res) {
			if (error) {
				if(errorCallback)
					errorCallback(error);
				return;
			}
			else {
				var timelineEntry = data;
				
				// if attachment available - insert it
				if(attachmentMime && attachment) {
					self.logDebug('Add attachment to timeline id: ', timelineEntry.id);
					client
						.mirror.timeline.attachments.insert({
							'itemId': timelineEntry.id,
							'uploadType': 'media'
						})
						.withMedia(attachmentMime, attachment)
						.withAuthClient(self.oauth2Client)
						.execute(function(error, data, res) {
							if (error) {
								if(errorCallback)
									errorCallback(error);
								return;
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

Glass.prototype._timelineUpdate = function(client, 
		entryID, message, attachmentMime, attachment,
		errorCallback, successCallback, isJSON) {
	// update entry in the timeline
	
	var self = this;
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
		.withAuthClient(self.oauth2Client)
		.execute(function(error, data, res) {
			if (error) {
				if(errorCallback)
					errorCallback(error);
			}
			else {
				var timelineEntry = data;
				
				// if attachment available - insert it
				if(attachmentMime && attachment) {
					self.logDebug('Add attachment to timeline id: ', timelineEntry.id);
					client
						.mirror.timeline.attachments.insert({
							'itemId': timelineEntry.id,
							'uploadType': 'media'
						})
						.withMedia(attachmentMime, attachment)
						.withAuthClient(self.oauth2Client)
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

Glass.prototype._timelineDelete = function(client, 
		entryID,
		errorCallback, successCallback) {
		
	// delete timeline entry
	
	var self = this;

    client
		.mirror.timeline.delete({
			'id': entryID
		})
		.withAuthClient(self.oauth2Client)
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

Glass.prototype._timelineGet = function(client, 
		entryID,
		errorCallback, successCallback) {
		
	// get timeline entry by id
	
	var self = this;
	
    client
		.mirror.timeline.get({
			'id': entryID
		})
		.withAuthClient(self.oauth2Client)
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

Glass.prototype._insertContact = function(client, 
		errorCallback, successCallback) {

	var self = this;

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
		.withAuthClient(self.oauth2Client)
		.execute(function(error, data) {
			if (error) {			
				if(errorCallBack)
					errorCallback(error);
			}
			else {
				if(successCallback)
					successCallback(data);
			}
		});
};

Glass.prototype._listTimeline = function(client, 
		errorCallback, successCallback) {

	var self = this;
	
    client
		.mirror.timeline.list()
		.withAuthClient(self.oauth2Client)
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
// Misc Methods

Glass.prototype._connect = function(errorCallback, successCallback) {
	var self = this;
	
	googleapis
		.discover('mirror', 'v1')
		.execute(function(error, client) {
			if(error) {
				if(errorCallback)
					errorCallback(error);
				return
			}
			
			self.mirrorApi = client;
			
			if(successCallback)
				successCallback();
		});
}

Glass.prototype._prepareGlassConfigStore = function() {
	var self = this;
	var OAUTH_STORE = './glasses/';	
	var DEFAULT_GLASS_ID = 'default';	
	
	self.glassID = (!self.glassID ? DEFAULT_GLASS_ID : self.glassID);
	self.glassID = self.glassID.replace(/[^a-zA-Z0-9_-]/g, '');
	self.glassConfigStore = path.resolve(path.dirname(process.mainModule.filename), OAUTH_STORE);
	fsEx.mkdirSync(self.glassConfigStore, 755, true);
	self.glassConfigStore = path.join(self.glassConfigStore, self.glassID + '.json');	
}

Glass.prototype._requestCode = function(requestUrl, 
		errorCallback, successCallback) {
	var self = this;
	var d = Q.defer();
	
	// call google oauth service. url according to:
	// https://developers.google.com/accounts/docs/OAuth2WebServer
	
	console.log('\r\n\r\Use your browser to open this URL:\r\n');
	console.log(requestUrl.cyan);
	console.log('\r\nThen come back and enter the CODE here\r\n');

	// start user browser for oauth registration
	spawn(requestUrl, function(error) {
		if(error) {
			log(LOG_ERROR, 'Error starting user web browser', error);
			if(errorCallback)
				errorCallback(error);
			return;
		}
	});
	
	// ask user for code parameter 
	self._ask('CODE', /.+/, function(code) {
		console.log();
		d.resolve(code);
		
		if(successCallback)
			successCallback(code);
	});
	
	return d.promise;
}

Glass.prototype._getMap = function(lat, lon, zoom, marker, 
		errorCallback, successCallback) {
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

	http.get(mapUrl, function(res) {
		var buffers = [];
		var length = 0;

		res.on('error', function(error) {
			if(errorCallback)
				errorCallback(error);
			return;
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
				
			if(successCallback)
				successCallback(mapMime, mapImage);
		});
	});
}

Glass.prototype._ask = function(question, format, callback) {
	var self = this;
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
			self._ask(question, format, callback);
		}
	});
}

Glass.prototype._isInt = function(i_int) {
	var i = parseInt(i_int);
	if (isNaN(i))
		return false;
	return i_int == i && i_int.toString() == i.toString();
}


module.exports.Glass = Glass;

