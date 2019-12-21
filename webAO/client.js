/*
 * Glorious webAO
 * made by sD, refactored by oldmud0 and Qubrick
 * credits to aleks for original idea and source
*/

// Load some defaults for the background and evidence dropdowns
import background_arr from "./backgrounds.js";
import evidence_arr from "./evidence.js";

import Fingerprint from "./fingerprint.js";

import { EventEmitter } from "events";


// Get the arguments from the URL bar
const queryDict = {};
location.search.substr(1).split("&").forEach(function (item) {
	queryDict[item.split("=")[0]] = item.split("=")[1];
});

const serverIP = queryDict.ip;
let mode = queryDict.mode;

// Unless there is an asset URL specified, use the wasabi one
const AO_HOST = queryDict.asset || "http://s3.wasabisys.com/webao/base/";
const MUSIC_HOST = AO_HOST + "sounds/music/";
const CHAR_SELECT_WIDTH = 8;
const UPDATE_INTERVAL = 60;

/**
 * Toggles AO1-style loading using paginated music packets for mobile platforms.
 * The old loading uses more smaller packets instead of a single big one,
 * which caused problems on low-memory devices in the past.
 */
let oldLoading = false;
if (/webOS|iPod|BlackBerry|BB|PlayBook|IEMobile|Windows Phone|Kindle|Silk|PlayStation|Opera Mini/i.test(navigator.userAgent)) {
	oldLoading = true;
}

// presettings
let selectedEffect = 0;
let selectedMenu = 1;
let selectedShout = 0;

let extrafeatures = [];

const fp = new Fingerprint({
	canvas: true,
	ie_activex: true,
	screen_resolution: true
});

// An emulated, semi-unique HDID that is generally safe for HDID bans.
const hdid = fp.get();
console.info(`Your emulated HDID is ${hdid}`);

let lastICMessageTime = new Date(0);

function safe_tags(str) {
	if (str)
		return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') ;
}

class Client extends EventEmitter {
	constructor(address) {
		super();
		this.serv = new WebSocket("ws://" + address);
		// Assign the websocket events
		this.serv.addEventListener("open", this.emit.bind(this, "open"));
		this.serv.addEventListener("close", this.emit.bind(this, "close"));
		this.serv.addEventListener("message", this.emit.bind(this, "message"));
		this.serv.addEventListener("error", this.emit.bind(this, "error"));

		this.on("open", this.onOpen.bind(this));
		this.on("close", this.onClose.bind(this));
		this.on("message", this.onMessage.bind(this));
		this.on("error", this.onError.bind(this));

		// Preset some of the variables

		this.flip = false;
		this.presentable = false;

		this.hp = [0, 0];

		this.playerID = 1;
		this.charID = -1;
		this.char_list_length = 0;
		this.evidence_list_length = 0;
		this.music_list_length = 0;
		this.testimonyID = 0;

		this.chars = [];
		this.emotes = [];
		this.evidences = [];

		this.resources = {
			"holdit": {
				"src": "misc/holdit.gif",
				"duration": 720
			},
			"objection": {
				"src": "misc/objection.gif",
				"duration": 720
			},
			"takethat": {
				"src": "misc/takethat.gif",
				"duration": 840
			},
			"witnesstestimony": {
				"src": "misc/witnesstestimony.gif",
				"duration": 1560,
				"sfx": "sounds/general/sfx-testimony.wav"
			},
			"crossexamination": {
				"src": "misc/crossexamination.gif",
				"duration": 1600,
				"sfx": "sounds/general/sfx-testimony2.wav"
			}
		};

		this.selectedEmote = -1;
		this.selectedEvidence = 0;

		this.checkUpdater = null;

		// Only used for RMC/'music' packets, not EM/SM/MC packets.
		this.musicList = Object();
		/**
		 * Assign handlers for all commands
		 * If you implement a new command, you need to add it here
		 */
		this.on("MS", this.handleMS.bind(this));
		this.on("CT", this.handleCT.bind(this));
		this.on("MC", this.handleMC.bind(this));
		this.on("RMC", this.handleRMC.bind(this));
		this.on("CI", this.handleCI.bind(this));
		this.on("SC", this.handleSC.bind(this));
		this.on("EI", this.handleEI.bind(this));
		this.on("FL", this.handleFL.bind(this));
		this.on("LE", this.handleLE.bind(this));
		this.on("EM", this.handleEM.bind(this));
		this.on("SM", this.handleSM.bind(this));
		this.on("MM", this.handleMM.bind(this));
		this.on("BD", this.handleBD.bind(this));
		this.on("DONE", this.handleDONE.bind(this));
		this.on("BN", this.handleBN.bind(this));
		this.on("HP", this.handleHP.bind(this));
		this.on("RT", this.handleRT.bind(this));
		this.on("ZZ", this.handleZZ.bind(this));
		this.on("ID", this.handleID.bind(this));
		this.on("PN", this.handlePN.bind(this));
		this.on("SI", this.handleSI.bind(this));
		this.on("ARUP", this.handleARUP.bind(this));
		this.on("CharsCheck", this.handleCharsCheck.bind(this));
		this.on("decryptor", this.handleDecryptor.bind(this));
		this.on("PV", this.handlePV.bind(this));
		this.on("CHECK", () => { });

		this._lastTimeICReceived = new Date(0);
	}

	/**
	 * Gets the current player's character.
	 */
	get character() {
		return this.chars[this.charID];
	}

	/**
	 * Gets the player's currently selected emote.
	 */
	get emote() {
		return this.emotes[this.selectedEmote];
	}

	/**
	 * Gets the player's currently selected evidence if presentable.
	 */
	get evidence() {
		return this.presentable ? this.selectedEvidence : 0;
	}

	/**
	 * Sends an out-of-character chat message.
	 * @param {string} message the message to send
	 */
	sendOOC(message) {
		setCookie("OOC_name",escapeChat(encodeChat(document.getElementById("OOC_name").value)));
		this.serv.send(`CT#${escapeChat(encodeChat(document.getElementById("OOC_name").value))}#${escapeChat(encodeChat(message))}#%`);
	}

	/**
	 * Sends an in-character chat message.
	 * @param {string} deskmod currently unused
	 * @param {string} speaking who is speaking
	 * @param {string} name the name of the current character
	 * @param {string} silent whether or not it's silent
	 * @param {string} message the message to be sent
	 * @param {string} side the name of the side in the background
	 * @param {string} sfx_name the name of the sound effect
	 * @param {string} emote_modifier whether or not to zoom
	 * @param {number} sfx_delay the delay (in milliseconds) to play the sound effect
	 * @param {string} objection_modifier the number of the shout to play
	 * @param {string} evidence the filename of evidence to show
	 * @param {number} flip change to 1 to reverse sprite for position changes
	 * @param {number} realization screen flash effect
	 * @param {number} text_color text color
	 * @param {string} showname custom name to be displayed (optional)
	 * @param {number} other_charid paired character (optional)
	 * @param {number} self_offset offset to paired character (optional)
	 * @param {number} noninterrupting_preanim play the full preanim (optional)
	 */
	sendIC(deskmod, speaking, name, silent, message, side, sfx_name, emote_modifier, sfx_delay, objection_modifier, evidence, flip, realization, text_color, showname, other_charid, self_offset, noninterrupting_preanim) {
		let extra_cccc = ``;
		if (extrafeatures.includes("cccc_ic_support") ) {
			extra_cccc = `${showname}#${other_charid}#${self_offset}#${noninterrupting_preanim}#`;
		}
		console.log(
			`MS#${deskmod}#${speaking}#${name}#${silent}` +
			`#${escapeChat(encodeChat(message))}#${side}#${sfx_name}#${emote_modifier}` +
			`#${this.charID}#${sfx_delay}#${objection_modifier}#${evidence}#${flip}#${realization}#${text_color}#${extra_cccc}%`
		);
		this.serv.send(
			`MS#${deskmod}#${speaking}#${name}#${silent}` +
			`#${escapeChat(encodeChat(message))}#${side}#${sfx_name}#${emote_modifier}` +
			`#${this.charID}#${sfx_delay}#${objection_modifier}#${evidence}#${flip}#${realization}#${text_color}#${extra_cccc}%`
		);
	}

	/**
	 * Sends add evidence command.
	 * @param {string} evidence name
	 * @param {string} evidence description
	 * @param {string} evidence image filename
	 */
	sendPE(name, desc, img) {
		this.serv.send(`PE#${escapeChat(encodeChat(name))}#${escapeChat(encodeChat(desc))}#${img}#%`);
	}

	/**
	 * Sends edit evidence command.
	 * @param {number} evidence id
	 * @param {string} evidence name
	 * @param {string} evidence description
	 * @param {string} evidence image filename
	 */
	sendEE(id, name, desc, img) {
		this.serv.send(`EE#${id}#${escapeChat(encodeChat(name))}#${escapeChat(encodeChat(desc))}#${img}#%`);
	}

	/**
	 * Sends delete evidence command.
	 * @param {number} evidence id
	 */
	sendDE(id) {
		this.serv.send(`DE#${id}#%`);
	}

	/**
	 * Sends health point command.
	 * @param {number} side the position
	 * @param {number} hp the health point
	 */
	sendHP(side, hp) {
		this.serv.send(`HP#${side}#${hp}#%`);
	}

	/**
	 * Sends call mod command.
	 * @param {string} message to mod
	 */
	sendZZ(msg) {
		this.serv.send(`ZZ#${msg}#%`);
	}

	/**
	 * Sends testimony command.
	 * @param {string} testimony type
	 */
	sendRT(testimony) {
		if (this.chars[this.charID].side === "jud") {
			this.serv.send(`RT#${testimony}#%`);
		}
	}

	/**
	 * Requests to change the music to the specified track.
	 * @param {string} track the track ID
	 */
	sendMusicChange(track) {
		this.serv.send(`MC#${track}#${this.charID}#%`);
	}

	/**
	 * Requests to leave the room and free the character slot.
	 * 
	 * Note: This packet is undocumented. It is not implemented by
	 * either the AO2 client or tsuserver.
	 */
	sendLeaveRoom() {
		this.serv.send("FC#%");
	}

	/**
	 * Begins the handshake process by sending an identifier
	 * to the server.
	 */
	joinServer() {
		this.serv.send(`HI#${hdid}#%`);
		this.serv.send("ID#webAO#2.3#%");
		this.checkUpdater = setInterval(() => this.sendCheck(), 5000);
	}

	/**
	 * Load game resources and stored settings.
	 */
	loadResources() {
		// Read cookies and set the UI to its values
		document.getElementById("OOC_name").value = getCookie("OOC_name");
		if (document.getElementById("OOC_name").value==="") {
			document.getElementById("OOC_name").value = "web"+this.playerID;
		}

		document.getElementById("client_mvolume").value = getCookie("musicVolume");
		changeMusicVolume();
		document.getElementById("client_svolume").value = getCookie("sfxVolume");
		changeSFXVolume();
		document.getElementById("client_bvolume").value = getCookie("blipVolume");
		changeBlipVolume();

		document.getElementById("ic_chat_name").value = getCookie("ic_chat_name");
		document.getElementById("showname").checked = getCookie("showname");

		// Load evidence array to select
		const evidence_select = document.getElementById("evi_select");
		evidence_select.add(new Option("Custom", 0));
		evidence_arr.forEach(evidence => {
			evidence_select.add(new Option(evidence));
		});

		// Load background array to select
		const background_select = document.getElementById("bg_select");
		background_select.add(new Option("Custom", 0));
		background_arr.forEach(background => {
			background_select.add(new Option(background));
		});
	}

	/**
	 * Requests to play as a specified character.
	 * @param {number} character the character ID
	 */
	sendCharacter(character) {
		this.serv.send(`CC#${this.playerID}#${character}#web#%`);
	}

	/**
	 * Requests to select a music track.
	 * @param {number?} song the song to be played
	 */
	sendMusic(song) {
		this.serv.send(`MC#${song}`);
	}

	/**
	 * Sends a keepalive packet.
	 */
	sendCheck() {
		this.serv.send(`CH#${this.charID}#%`);
	}

	/**
	 * Triggered when a connection is established to the server.
	 */
	onOpen(_e) {
		client.joinServer();
	}

	/**
	 * Triggered when the connection to the server closes.
	 * @param {CloseEvent} e
	 */
	onClose(e) {
		console.error(`The connection was closed: ${e.reason} (${e.code})`);
		if (e.code !== 1001) {
			document.getElementById("client_error").style.display = "flex";
			document.getElementById("client_loading").style.display = "none";
			document.getElementById("error_id").textContent = e.code;
			this.cleanup();
		}
	}

	/**
	 * Triggered when a packet is received from the server.
	 * @param {MessageEvent} e
	 */
	onMessage(e) {
		const msg = e.data;
		console.debug(msg);

		const lines = msg.split("%");
		const args = lines[0].split("#");
		const header = args[0];

		if (!this.emit(header, args)) {
			console.warn(`Invalid packet header ${header}`);
		}
	}

	/**
	 * Triggered when an network error occurs.
	 * @param {ErrorEvent} e 
	 */
	onError(e) {
		console.error(`A network error occurred: ${e.reason} (${e.code})`);
		document.getElementById("client_error").style.display = "flex";
		document.getElementById("error_id").textContent = e.code;
		this.cleanup();
	}

	/**
	 * Stop sending keepalives to the server.
	 */
	cleanup() {
		clearInterval(this.checkUpdater);
	}

	/**
	 * XXX: a nasty hack made by gameboyprinter.
	 * @param {string} msg chat message to prepare for display 
	 */
	prepChat(msg) {
		// TODO: make this less awful
		return unescapeChat(decodeChat(msg));
	}

	/**
	 * Handles an in-character chat message.
	 * @param {*} args packet arguments
	 */
	handleMS(args) {
		// TODO: this if-statement might be a bug.
		if (args[4] !== viewport.chatmsg.content) {
			document.getElementById("client_inner_chat").innerHTML = "";

			let msg_nameplate = args[3];
			let msg_blips = "male";
			try {
				msg_nameplate = this.chars[args[9]].showname;
				msg_blips = this.chars[args[9]].gender;
			} catch(e) {
				//we already set defaults
			}

			let chatmsg = {
        		deskmod: safe_tags(args[1]).toLowerCase(),
				preanim: safe_tags(args[2]).toLowerCase(), // get preanim
				nameplate: msg_nameplate,				// TODO: there's a new feature that let's people choose the name that's displayed
				name: safe_tags(args[3]),
				speaking: "(b)" + safe_tags(args[4]).toLowerCase(),
				silent: "(a)" + safe_tags(args[4]).toLowerCase(),
				content: this.prepChat(args[5]), // Escape HTML tags
				side: args[6].toLowerCase(),
				sound: safe_tags(args[7]).toLowerCase(),
				blips: msg_blips,
				type: args[8],
				charid: args[9],
				snddelay: args[10],
				objection: args[11],
				evidence: args[12],
				flip: args[13],
				flash: args[14],
				color: args[15],
				isnew: true,
			};

			if (extrafeatures.includes("cccc_ic_support")) {
				const extra_options = {
					showname: safe_tags(args[16]),
					other_charid: args[17],
					other_name: safe_tags(args[18]),
					other_emote: safe_tags(args[19]),
					self_offset: args[20],
					other_offset: args[21],
					other_flip: args[22],
					noninterrupting_preanim: args[23]
				};
				chatmsg = Object.assign(extra_options, chatmsg);
				if (chatmsg.showname && document.getElementById("showname").checked) {
					chatmsg.nameplate = chatmsg.showname;
				}
			}

			if (chatmsg.charid === this.charID) {
				resetICParams();
			}

			viewport.say(chatmsg); // no await
		}
	}

	/**
	 * Handles an out-of-character chat message.
	 * @param {Array} args packet arguments
	 */
	handleCT(args) {
		const oocLog = document.getElementById("client_ooclog");
		oocLog.innerHTML += `${decodeChat(unescapeChat(args[1]))}: ${decodeChat(unescapeChat(args[2]))}\r\n`;
		if (oocLog.scrollTop > oocLog.scrollHeight - 600) {
			oocLog.scrollTop = oocLog.scrollHeight;
		}
	}

	/**
	 * Handles a music change to an arbitrary resource.
	 * @param {Array} args packet arguments
	 */
	handleMC(args) {
		const [_packet, track, charID] = args;
		const music = viewport.music;
		music.pause();
		music.src = MUSIC_HOST + track.toLowerCase();
		music.play();
		if (args[2] >= 0) {
			const musicname = this.chars[charID].name;
			appendICLog(`${musicname} changed music to ${track}`);
		} else {
			appendICLog(`The music was changed to ${track}`);
		}
	}

	/**
	 * Handles a music change to an arbitrary resource, with an offset in seconds.
	 * @param {Array} args packet arguments
	 */
	handleRMC(args) {
		viewport.music.pause();
		viewport.music = new Audio(this.musicList[args[1]]);
		const music = viewport.music;
		// Music offset + drift from song loading
		music.totime = args[1];
		music.offset = new Date().getTime() / 1000;
		music.addEventListener("loadedmetadata", function () {
			music.currentTime += parseFloat(music.totime + (new Date().getTime() / 1000 - music.offset)).toFixed(3);
			music.play();
		}, false);
	}

	/**
	 * Handles the incoming character information, and downloads the sprite + ini for it
	 * @param {Array} chargs packet arguments
	 * @param {Number} charid character ID
	 */
	async handleCharacterInfo(chargs, charid) {
		let cini = {};
		let icon = AO_HOST + "characters/" + encodeURI(chargs[0].toLowerCase()) + "/char_icon.png";
		let img = document.getElementById(`demo_${charid}`);
		img.alt = chargs[0];
		img.src = icon;	// seems like a good time to load the icon

		// If the ini doesn't exist on the server this will throw an error
		try {
			const cinidata = await request(AO_HOST + "characters/" + encodeURI(chargs[0].toLowerCase()) + "/char.ini");
			cini = INI.parse(cinidata);
		} catch(err) {
			cini = {};
			img.classList.add("noini");
			// If it does, give the user a visual indication that the character is unusable
		}

		const mute_select = document.getElementById("mute_select");
		mute_select.add(new Option(escape(chargs[0]), charid));
		const pair_select = document.getElementById("pair_select");
		pair_select.add(new Option(escape(chargs[0]), charid));

		// sometimes ini files lack important settings
		const default_options = {
			name: chargs[0],
			showname: chargs[0],
			side: "def",
			gender: "male"
		};
		cini.options = Object.assign(default_options, cini.options);

		this.chars[charid] = {
			name: safe_tags(chargs[0]),
			showname: safe_tags(cini.options.showname),
			desc: safe_tags(chargs[1]),
			gender: safe_tags(cini.options.gender).toLowerCase(),
			evidence: chargs[3],
			icon: icon,
			inifile: cini
		};

		
	}

	/**
	 * Handles incoming character information, bundling multiple characters
	 * per packet.
	 * @param {Array} args packet arguments
	 */
	handleCI(args) {
		document.getElementById("client_loadingtext").innerHTML = "Loading Character " + args[1];
		// Loop through the 10 characters that were sent
		for (let i = 2; i < args.length - 1; i++) {
			if (i % 2 === 0) {
				document.getElementById("client_loadingtext").innerHTML = `Loading Character ${i}/${this.char_list_length}`;
				const chargs = args[i].split("&");
				this.handleCharacterInfo(chargs, i-1);
			}
		}
		// Request the next pack
		this.serv.send("AN#" + ((args[1] / 10) + 1) + "#%");
	}

	/**
	 * Handles incoming character information, containing all characters
	 * in one packet.
	 * @param {Array} args packet arguments
	 */
	handleSC(args) {
		document.getElementById("client_loadingtext").innerHTML = "Loading Characters";
		for (let i = 1; i < args.length - 1; i++) {
			document.getElementById("client_loadingtext").innerHTML = `Loading Character ${i}/${this.char_list_length}`;
			const chargs = args[i].split("&");
			this.handleCharacterInfo(chargs, i-1);
		}
		// We're done with the characters, request the music
		this.serv.send("RM#%");
	}

	/**
	 * Handles incoming evidence information, containing only one evidence
	 * item per packet.
	 * 
	 * Mostly unimplemented in webAO.
	 * @param {Array} args packet arguments
	 */
	handleEI(args) {
		document.getElementById("client_loadingtext").innerHTML = `Loading Evidence ${args[1]}/${this.evidence_list_length}`;
		this.serv.send("RM#%");
	}

	/**
	 * Handles incoming evidence list, all evidences at once
	 * item per packet.
	 * 
	 * @param {Array} args packet arguments
	 */
	handleLE(args) {
		this.evidences = [];
		for (let i = 1; i < args.length - 1; i++) {
			const arg = args[i].split("&");
			this.evidences[i - 1] = {
				name: decodeChat(unescapeChat(arg[0])),
				desc: decodeChat(unescapeChat(arg[1])),
				filename: safe_tags(arg[2]),
				icon: AO_HOST + "evidence/" + encodeURI(arg[2].toLowerCase())
			};
		}

		const evidence_box = document.getElementById("evidences");
		evidence_box.innerHTML = "";
		for (let i = 1; i <= this.evidences.length; i++) {
			evidence_box.innerHTML += `<img src="${this.evidences[i - 1].icon}" 
				id="evi_${i}" 
				alt="${this.evidences[i - 1].name}"
				class="client_button"
				onclick="pickEvidence(${i})">`;
		}
	}

	/**
	 * Handles incoming music information, containing multiple entries
	 * per packet.
	 * @param {Array} args packet arguments
	 */
	handleEM(args) {
		document.getElementById("client_loadingtext").innerHTML = "Loading Music " + args[1];
		this.serv.send("AM#" + ((args[1] / 10) + 1) + "#%");
		const hmusiclist = document.getElementById("client_musiclist");
		for (let i = 2; i < args.length - 1; i++) {
			if (i % 2 === 0) {
				document.getElementById("client_loadingtext").innerHTML = `Loading Music ${i}/${this.music_list_length}`;
				const newentry = document.createElement("OPTION");
				newentry.text = args[i];
				hmusiclist.options.add(newentry);
			}
		}
	}

	/**
	 * Handles incoming music information, containing all music in one packet.
	 * @param {Array} args packet arguments
	 */
	handleSM(args) {
		document.getElementById("client_loadingtext").innerHTML = "Loading Music ";
		const hmusiclist = document.getElementById("client_musiclist");
		let flagAudio = false;

		for (let i = 1; i < args.length - 1; i++) {
			// Check when found the song for the first time
			document.getElementById("client_loadingtext").innerHTML = `Loading Music ${i}/${this.music_list_length}`;
			if (/\.(?:wav|mp3|mp4|ogg|opus)$/i.test(args[i]) && !flagAudio) {
				flagAudio = true;
			}

			if (flagAudio) {
				// After reached the audio put everything in the music list
				const newentry = document.createElement("OPTION");
				newentry.text = args[i];
				hmusiclist.options.add(newentry);
			} else {
				// Create area button
				const newarea = document.createElement("SPAN");
				newarea.className = "location-box";
				newarea.textContent = args[i];
				newarea.onclick = function () {
					area_click(this);
				};
				document.getElementById("areas").appendChild(newarea);
			}
		}

		// We need to check if the last area that we got was actually a category
		// header for music. If it was, then move it over to the music list.
		const area_box = document.getElementById("areas");
		if (area_box.lastChild.textContent.startsWith("=")) {
			const audio_title = document.createElement("OPTION");
			audio_title.text = area_box.lastChild.textContent;
			hmusiclist.insertBefore(audio_title, hmusiclist.firstChild);
			area_box.removeChild(area_box.lastChild);
		}

		// Music done, carry on
		this.serv.send("RD#%");
	}

	/**
	 * Handles the "MusicMode" packet
	 * @param {Array} args packet arguments
	 */
	handleMM(args) {
		// It's unused nowadays, as preventing people from changing the music is now serverside
	}

	/**
	 * Handles the kicked packet
	 * @param {Array} args kick reason
	 */
	handleKK(args) {
		document.getElementById("client_loading").style.display = "flex";
		document.getElementById("client_loadingtext").innerHTML = "Kicked: " + safe_tags(args[1]);
	}

	/**
	 * Handles the banned packet
	 * this one is sent when you are kicked off the server
	 * @param {Array} args ban reason
	 */
	handleKB(args) {
		document.getElementById("client_loading").style.display = "flex";
		document.getElementById("client_loadingtext").innerHTML = "You got banned: " + safe_tags(args[1]);
	}

	/**
	 * Handles the banned packet
	 * this one is sent when you try to reconnect but you're banned
	 * @param {Array} args ban reason
	 */
	handleBD(args) {
		document.getElementById("client_loading").style.display = "flex";
		document.getElementById("client_loadingtext").innerHTML = "Banned: " + safe_tags(args[1]);
	}

	/**
	 * Handles the handshake completion packet, meaning the player
	 * is ready to select a character.
	 * 
	 * @param {Array} args packet arguments
	 */
	handleDONE(_args) {
		document.getElementById("client_loading").style.display = "none";
		if (mode === "watch") {		// Spectators don't need to pick a character
			document.getElementById("client_charselect").style.display = "none";
		} else {
			document.getElementById("client_charselect").style.display = "block";
		}
	}

	/**
	 * Handles a background change.
	 * @param {Array} args packet arguments
	 */
	handleBN(args) {
		viewport.bgname = safe_tags(args[1]);
		const bg_index = getIndexFromSelect("bg_select", safe_tags(args[1]));
		document.getElementById("bg_select").selectedIndex = bg_index;
		updateBackgroundPreview();
		if (bg_index === 0) {
			document.getElementById("bg_filename").value = args[1];
		}
		document.getElementById("bg_preview").src = AO_HOST + "background/" + encodeURI(args[1].toLowerCase()) + "/defenseempty.png";
		if (this.charID === -1) {
			changeBackground("jud");
		} else {
			changeBackground(this.chars[this.charID].side);
		}

	}

	/**
	 * Handles a change in the health bars' states.
	 * @param {Array} args packet arguments
	 */
	handleHP(args) {
		const percent_hp = args[2] * 10;
		if (args[1] === 1) {
			// Def hp
			this.hp[0] = args[2];
			$("#client_defense_hp > .health-bar").animate({
				"width": percent_hp + "%"
			}, 500);
		} else {
			// Pro hp
			this.hp[1] = args[2];
			$("#client_prosecutor_hp > .health-bar").animate({
				"width": percent_hp + "%"
			}, 500);
		}
	}

	/**
	 * Handles a testimony states.
	 * @param {Array} args packet arguments
	 */
	handleRT(args) {
		if (args[1] === "testimony1") {
			//Witness Testimony
			this.testimonyID = 1;
		} else {
			//Cross Examination
			this.testimonyID = 2;
		}
		viewport.initTestimonyUpdater();
	}

	/**
	 * Handles a call mod message.
	 * @param {Array} args packet arguments
	 */
	handleZZ(args) {
		const oocLog = document.getElementById("client_ooclog");
		oocLog.innerHTML += `$Alert: ${decodeChat(unescapeChat(args[1]))}\r\n`;
		if (oocLog.scrollTop > oocLog.scrollHeight - 60) {
			oocLog.scrollTop = oocLog.scrollHeight;
		}
	}

	/**
	 * Identifies the server and issues a playerID
	 * @param {Array} args packet arguments
	 */
	handleID(args) {
		this.playerID = args[1];
	}

	/**
	 * Indicates how many users are on this server
	 * @param {Array} args packet arguments
	 */
	handlePN(_args) {
		this.serv.send("askchaa#%");
	}

	/**
	 * Handle the change of players in an area.
	 * webAO doesn't have this feature yet, but i want the warning to go away.
	 * @param {Array} args packet arguments
	 */
	handleARUP(_args) {
		// TODO: webAO doesn't have this feature yet
	}

	/**
	 * With this the server tells us which features it supports
	 * @param {Array} args list of features
	 */
	handleFL(args) {
		console.info("Server-supported features:");
		console.info(args);
		extrafeatures = args;

		if (args.includes("yellowtext")) {
			let colorselect = document.getElementById("textcolor");

			colorselect.options[colorselect.options.length] = new Option("Yellow", 5);
			colorselect.options[colorselect.options.length] = new Option("Pink", 7);
			colorselect.options[colorselect.options.length] = new Option("Cyan", 8);
		}

		if (args.includes("cccc_ic_support")) {
			document.getElementById("cccc").style.display = "";
			document.getElementById("pairing").style.display = "";
		}
	}

	/**
	 * Received when the server announces its server info,
	 * but we use it as a cue to begin retrieving characters.
	 * @param {Array} args packet arguments
	 */
	handleSI(args) {
		this.char_list_length = args[1];
		this.evidence_list_length = args[2];
		this.music_list_length = args[3];

		// create the charselect grid, to be filled by the character loader
		document.getElementById("client_chartable").innerHTML = "";
		let tr;
		for (let i = 0; i < this.char_list_length; i++) {
			if (i % CHAR_SELECT_WIDTH === 0) {
				tr = document.createElement("TR");
			}
			const td = document.createElement("TD");

			td.innerHTML = `<img class='demothing' id='demo_${i}' onclick='pickChar(${i})' >`;
			
			tr.appendChild(td);
			if (i % CHAR_SELECT_WIDTH === 0) {
				document.getElementById("client_chartable").appendChild(tr);
			}
		}

		// this is determined at the top of this file
		if (oldLoading) {
			this.serv.send("askchar2#%");
		} else {
			this.serv.send("RC#%");
		}
	}

	/**
	 * Handles the list of all used and vacant characters.
	 * @param {Array} args list of all characters represented as a 0 for free or a -1 for taken
	 */
	handleCharsCheck(args) {
		for (let i = 0; i < this.char_list_length; i++) {
			let img = document.getElementById(`demo_${i}`);
			let icon_chosen = "demothing";

			if (img.classList.contains("noini"))
				icon_chosen += " noini";

			if (args[i + 1] === "-1")
				icon_chosen += " dark";
			
			img.classList = icon_chosen;
		}

		//changeBackground("def");
	}

	/**
	 * Decryptor for the command headers
	 * @param {Array} args packet arguments
	 */
	handleDecryptor(_args) {
		// unused since AO2
	}

	/**
	 * Handles the server's assignment of a character for the player to use.
	 * @param {Array} args packet arguments
	 */
	async handlePV(args) {
		this.charID = args[3];

		document.getElementById("client_charselect").style.display = "none";
		document.getElementById("client_inputbox").style.display = "";

		const me = this.character;
		this.selectedEmote = -1;
		const emotes = this.emotes;
		const emotesList = document.getElementById("client_emo");
		emotesList.innerHTML = ""; // Clear emote box
		emotesList.style.display = "";
		const ini = me.inifile;
		me.side = ini.options.side;
		updateActionCommands(me.side);
		for (let i = 1; i <= ini.emotions.number; i++) {
			const emoteinfo = ini.emotions[i].split("#");
			const esfx = ini.soundn[i] ? ini.soundn[i] : "0";
			const esfxd = ini.soundt[i] ? ini.soundt[i] : "0";
			// Make sure the asset server is case insensitive, or that everything on it is lowercase
			emotes[i] = {
				desc: emoteinfo[0].toLowerCase(),
				speaking: emoteinfo[1].toLowerCase(),
				silent: emoteinfo[2].toLowerCase(),
				zoom: emoteinfo[3],
				sfx: esfx.toLowerCase(),
				sfxdelay: esfxd,
				button_off: AO_HOST + `characters/${encodeURI(me.name.toLowerCase())}/emotions/button${i}_off.png`,
				button_on: AO_HOST + `characters/${encodeURI(me.name.toLowerCase())}/emotions/button${i}_on.png`
			};
			emotesList.innerHTML +=
				`<img src=${emotes[i].button_off}
					id="emo_${i}"
					alt="${emotes[i].desc}"
					class="emote_button"
					onclick="pickEmotion(${i})">`;
		}
		pickEmotion(1);
	}
}

class Viewport {
	constructor() {
		this.textnow = "";
		this.chatmsg = {
			"isnew": false,
			"content": "",
			"objection": "0",
			"sound": "",
			"startpreanim": false,
			"startspeaking": false,
			"side": null,
			"color": "0",
			"snddelay": 0,
			"preanimdelay": 0
		};
		this.blip = new Audio(AO_HOST + "sounds/general/sfx-blipmale.wav");
		this.blip.volume = 0.5;

		// Allocate multiple blip audio channels to make blips less jittery

		this.blipChannels = new Array(6);
		this.blipChannels.fill(new Audio(AO_HOST + "sounds/general/sfx-blipmale.wav"))
			.forEach(channel => channel.volume = 0.5);
		this.currentBlipChannel = 0;

		this.sfxaudio = new Audio(AO_HOST + "sounds/general/sfx-blipmale.wav");
		this.sfxplayed = 0;

		this.shoutaudio = new Audio();

		this.music = new Audio();
		this.music.play();

		this.updater = null;
		this.testimonyUpdater = null;

		this.bgname = "gs4";

		this.testimonyTimer = 0;
		this.shoutTimer = 0;
		this.textTimer = 0;

		this._animating = false;
	}

	/**
	 * Returns whether or not the viewport is busy
	 * performing a task (animating).
	 */
	get isAnimating() {
		return this._animating;
	}

	/**
	 * Sets the volume of the blip sound.
	 * @param {number} volume
	 */
	set blipVolume(volume) {
		this.blipChannels.forEach(channel => channel.volume = volume);
	}

	/**
	 * Returns the path which the background is located in.
	 */
	get bgFolder() {
		return `${AO_HOST}background/${encodeURI(this.bgname.toLowerCase())}/`;
	}

	/**
	 * Sets a new emote.
	 * @param {object} chatmsg the new chat message
	 */
	async say(chatmsg) {
		this.chatmsg = chatmsg;
		appendICLog(chatmsg.content, chatmsg.nameplate);
		changeBackground(chatmsg.side);
		this.blipChannels.forEach(channel => channel.src = `${AO_HOST}sounds/general/sfx-blip${encodeURI(chatmsg.blips.toLowerCase())}.wav`);
		this.textnow = "";
		this.sfxplayed = 0;
		this.textTimer = 0;
		this._animating = true;
		clearTimeout(this.updater);
		// If preanim existed then determine the length
		if (chatmsg.preanim !== "-") {
			const delay = await this.getAnimLength(`${AO_HOST}characters/${encodeURI(chatmsg.name.toLowerCase())}/${encodeURI(chatmsg.preanim)}.gif`);
			chatmsg.preanimdelay = delay;
			this.initUpdater(delay);
		} else {
			this.initUpdater(0);
		}
	}

	/**
	 * Intialize updater
	 * @param {number} animdelay the length of pre-animation 
	 */
	initUpdater(animdelay) {
		viewport.chatmsg.preanimdelay = parseInt(animdelay);
		viewport.updater = setTimeout(() => viewport.tick(), UPDATE_INTERVAL);
	}

	/**
	 * Intialize testimony updater 
	 */
	initTestimonyUpdater() {
		const testimonyFilenames = {
			1: "witnesstestimony",
			2: "crossexamination"
		};

		const testimony = testimonyFilenames[client.testimonyID];
		if (!testimony) {
			console.warn(`Invalid testimony ID ${client.testimonyID}`);
			return;
		}

		(new Audio(client.resources[testimony].sfx)).play();

		const testimonyOverlay = document.getElementById("client_testimony");
		testimonyOverlay.src = client.resources[testimony].src;
		testimonyOverlay.style.display = "";

		this.testimonyTimer = 0;
		this.testimonyUpdater = setTimeout(() => this.updateTestimony(), UPDATE_INTERVAL);
	}

	/**
	 * Gets animation length. If the animation cannot be found, it will
	 * silently fail and return 0 instead.
	 * @param {string} filename the animation file name
	 */
	async getAnimLength(filename) {
		try {
			const file = await requestBuffer(filename);
			return this.calculateGifLength(file);
		} catch (err) {
			return 0;
		}
	}

	/**
	 * Adds up the frame delays to find out how long a GIF is
	 * I totally didn't steal this
	 * @param {data} gifFile the GIF data
	 */
	calculateGifLength(gifFile) {
		let d = new Uint8Array(gifFile);
		// Thanks to http://justinsomnia.org/2006/10/gif-animation-duration-calculation/
		// And http://www.w3.org/Graphics/GIF/spec-gif89a.txt
		let duration = 0;
		for (var i = 0; i < d.length; i++) {
			// Find a Graphic Control Extension hex(21F904__ ____ __00)
			if (d[i] === 0x21
				&& d[i + 1] === 0xF9
				&& d[i + 2] === 0x04
				&& d[i + 7] === 0x00) {
				// Swap 5th and 6th bytes to get the delay per frame
				let delay = (d[i + 5] << 8) | (d[i + 4] & 0xFF);

				// Should be aware browsers have a minimum frame delay 
				// e.g. 6ms for IE, 2ms modern browsers (50fps)
				duration += delay < 2 ? 10 : delay;
			}
		}
		return duration * 10;
	}

	/**
	 * Updates the testimony overaly
	 */
	updateTestimony() {
		const testimonyFilenames = {
			1: "witnesstestimony",
			2: "crossexamination"
		};

		// Update timer
		this.testimonyTimer = this.testimonyTimer + UPDATE_INTERVAL;

		const testimony = testimonyFilenames[client.testimonyID];
		const resource = client.resources[testimony];
		if (!resource) {
			this.disposeTestimony();
			return;
		}

		if (this.testimonyTimer >= resource.duration) {
			this.disposeTestimony();
		} else {
			this.testimonyUpdater = setTimeout(() => this.updateTestimony(), UPDATE_INTERVAL);
		}
	}

	/**
	 * Dispose the testimony overlay
	 */
	disposeTestimony() {
		client.testimonyID = 0;
		this.testimonyTimer = 0;
		document.getElementById("client_testimony").style.display = "none";
		clearTimeout(this.testimonyUpdater);
	}

	/**
	 * Updates the chatbox based on the given text.
	 * 
	 * XXX: This relies on a global variable `this.chatmsg`!
	 */
	tick() {
		const nameBox = document.getElementById("client_name");
		const chatBox = document.getElementById("client_chat");
		const charSprite = document.getElementById("client_char");
		const pairSprite = document.getElementById("client_pair_char");
		const eviBox = document.getElementById("client_evi");
		const background = document.getElementById("client_background");
		const shoutSprite = document.getElementById("client_shout");
		const chatBoxInner = document.getElementById("client_inner_chat");

		// Flip the character
		if (this.chatmsg.flip === "1") {
			charSprite.style.transform = "scaleX(-1)";
		} else {
			charSprite.style.transform = "scaleX(1)";
		}

		if (extrafeatures.includes("cccc_ic_support")) {
			// Flip the pair character
			if (this.chatmsg.other_flip === "1") {
			pairSprite.style.transform = "scaleX(-1)";
			} else {
				pairSprite.style.transform = "scaleX(1)";
			}
		}

		if (this._animating) {
			this.updater = setTimeout(() => this.tick(), UPDATE_INTERVAL);
		}

		if (this.chatmsg.isnew) {
			// Reset screen background
			background.style.backgroundColor = "transparent";
			// Hide message and evidence window
			nameBox.style.display = "none";
			chatBox.style.display = "none";
			eviBox.style.opacity = "0";
			eviBox.style.height = "0%";
			const shouts = {
				"1": "holdit",
				"2": "objection",
				"3": "takethat"
			};

			// gets which shout shall played
			const shout = shouts[this.chatmsg.objection];
			if (shout) {
				shoutSprite.src = client.resources[shout]["src"];
				this.shoutaudio.src=`${AO_HOST}characters/${encodeURI(this.chatmsg.name.toLowerCase())}/${shout}.wav`;
				this.shoutaudio.play();
				this.shoutTimer = 850;
			} else {
				this.shoutTimer = 0;
			}

			this.chatmsg.isnew = false;
			this.chatmsg.startpreanim = true;
		}

		if (this.textTimer >= this.shoutTimer && this.chatmsg.startpreanim) {
			// Effect stuff
			if (this.chatmsg.flash === "2") {
				// Shake screen
				this.sfxaudio.pause();
				this.sfxplayed = 1;
				this.sfxaudio.src = AO_HOST + "sounds/general/sfx-stab.wav";
				this.sfxaudio.play();
				$("#client_gamewindow").effect("shake", {
					"direction": "up"
				});
			} else if (this.chatmsg.flash === "1") {
				// Flash screen
				background.style.backgroundColor = "white";
				this.sfxaudio.pause();
				this.sfxplayed = 1;
				this.sfxaudio.src = AO_HOST + "sounds/general/sfx-realization.wav";
				this.sfxaudio.play();
				$("#client_gamewindow").effect("pulsate", { times: 1 }, 200);
			}

			// Pre-animation stuff
			if (this.chatmsg.preanimdelay > 0) {
				shoutSprite.src = "misc/placeholder.gif";
				const charName = this.chatmsg.name.toLowerCase();
				const preanim = this.chatmsg.preanim.toLowerCase();
				charSprite.src = `${AO_HOST}characters/${encodeURI(charName)}/${encodeURI(preanim)}.gif`;
				charSprite.style.display = "";
			}

			if (extrafeatures.includes("cccc_ic_support")) {
				if (this.chatmsg.other_name) {
					const pairName = this.chatmsg.other_name.toLowerCase();
					const pairEmote = this.chatmsg.other_emote.toLowerCase();
					pairSprite.style.left = this.chatmsg.other_offset+"%";
					charSprite.style.left = this.chatmsg.self_offset+"%";
					pairSprite.src = `${AO_HOST}characters/${pairName}/(a)${pairEmote}.gif`;
					pairSprite.style.display = "";
				} else {
					pairSprite.style.display = "none";
					charSprite.style.left = 0;
				}

			}

			this.chatmsg.startpreanim = false;
			this.chatmsg.startspeaking = true;
		} else if (this.textTimer >= this.shoutTimer + this.chatmsg.preanimdelay && !this.chatmsg.startpreanim) {
			if (this.chatmsg.startspeaking) {
				if (this.chatmsg.evidence > 0) {
					// Prepare evidence
					eviBox.style.backgroundImage = "url('" + client.evidences[this.chatmsg.evidence - 1].icon + "')";

					if (this.chatmsg.side === "def") {
						// Only def show evidence on right
						eviBox.style.right = "1.5em";
						eviBox.style.left = "initial";
						$("#client_evi").animate({
							height: "30%",
							opacity: 1
						}, 250);
					} else {
						eviBox.style.right = "initial";
						eviBox.style.left = "1.5em";
						$("#client_evi").animate({
							height: "30%",
							opacity: 1
						}, 250);
					}
				}

				nameBox.style.display = "block";
				nameBox.style.fontSize = (nameBox.offsetHeight * 0.7) + "px";

				while (nameBox.hasChildNodes()) {
					nameBox.removeChild(nameBox.firstChild);
				}
				nameBox.appendChild(document.createTextNode(this.chatmsg.nameplate));

				chatBox.style.display = "block";
				chatBox.style.fontSize = (chatBox.offsetHeight * 0.25) + "px";

				let colors = {
					"0": "#ffffff", // white
					"1": "#00ff00", // green
					"2": "#ff0000", // red
					"3": "#ffa500", // orange
					"4": "#4596ff", // blue
					"5": "#ffff00", // yellow
					"6": "#fedcba", // 6 is rainbow.
					"7": "#aac0cb", // pink
					"8": "#00ffff"  // cyan
				};
				chatBoxInner.style.color = colors[this.chatmsg.color] || "#ffffff";
				this.chatmsg.startspeaking = false;

				if (this.chatmsg.preanimdelay === 0) {
					shoutSprite.src = "misc/placeholder.gif";
					changeBackground(this.chatmsg.side);
				}

				if (extrafeatures.includes("cccc_ic_support")) {
					if (this.chatmsg.other_name) {
						const pairName = this.chatmsg.other_name.toLowerCase();
						const pairEmote = this.chatmsg.other_emote.toLowerCase();
						pairSprite.style.left = this.chatmsg.other_offset+"%";
						charSprite.style.left = this.chatmsg.self_offset+"%";
						pairSprite.src = `${AO_HOST}characters/${pairName}/(a)${pairEmote}.gif`;
						pairSprite.style.display = "";
					} else {
						pairSprite.style.display = "none";
						charSprite.style.left = 0;
					}
				}

				charSprite.src = AO_HOST + "characters/" + encodeURI(this.chatmsg.name.toLowerCase()) + "/" + encodeURI(this.chatmsg.speaking.toLowerCase()) + ".gif";
				charSprite.style.display = "";

				if (this.textnow === this.chatmsg.content) {
					charSprite.src = AO_HOST + "characters/" + encodeURI(this.chatmsg.name.toLowerCase()) + "/" + encodeURI(this.chatmsg.silent.toLowerCase()) + ".gif";
					charSprite.style.display = "";
					this._animating = false;
					clearTimeout(this.updater);
				}
			} else {
				if (this.textnow !== this.chatmsg.content) {
					if (this.chatmsg.content.charAt(this.textnow.length) !== " ") {
						this.blipChannels[this.currentBlipChannel].play();
						this.currentBlipChannel++;
						this.currentBlipChannel %= this.blipChannels.length;
					}
					this.textnow = this.chatmsg.content.substring(0, this.textnow.length + 1);

					while (chatBoxInner.hasChildNodes()) {
						chatBoxInner.removeChild(chatBoxInner.firstChild);
					}
					chatBoxInner.appendChild(document.createTextNode(this.textnow));

					if (this.textnow === this.chatmsg.content) {
						this.textTimer = 0;
						this._animating = false;
						charSprite.src = AO_HOST + "characters/" + encodeURI(this.chatmsg.name.toLowerCase()) + "/" + encodeURI(this.chatmsg.silent.toLowerCase()) + ".gif";
            charSprite.style.display = "";
						clearTimeout(this.updater);
					}
				}
			}
		}

		if (!this.sfxplayed && this.chatmsg.snddelay + this.shoutTimer >= this.textTimer) {
			this.sfxaudio.pause();
			this.sfxplayed = 1;
			if (this.chatmsg.sound !== "0" && this.chatmsg.sound !== "1") {
				this.sfxaudio.src = AO_HOST + "sounds/general/" + encodeURI(this.chatmsg.sound.toLowerCase()) + ".wav";
				this.sfxaudio.play();
			}
		}
		this.textTimer = this.textTimer + UPDATE_INTERVAL;
	}
}

class INI {
	static parse(data) {
		const regex = {
			section: /^\s*\[\s*([^\]]*)\s*\]\s*$/,
			param: /^\s*([\w.\-_]+)\s*=\s*(.*?)\s*$/,
			comment: /^\s*;.*$/
		};
		const value = {};
		const lines = data.split(/\r\n|\r|\n/);
		let section;
		lines.forEach(function (line) {
			if (regex.comment.test(line)) {
				return;
			} else if (line.length === 0) {
				return;
			} else if (regex.param.test(line)) {
				const match = line.match(regex.param);
				if (section) {
					if(match[1].toLowerCase() === "showname"){	//don't lowercase the showname
						value[section]["showname"] = match[2];
					} else {
						value[section][match[1].toLowerCase()] = match[2].toLowerCase();
					}
				//} else { // we don't care about attributes without a section
				//	value[match[1]] = match[2];
				}
			} else if (regex.section.test(line)) {
				const match = line.match(regex.section);
				value[match[1].toLowerCase()] = {};				//lowercase everything else
				section = match[1].toLowerCase();
			}
		});
		return value;
	}
}

/**
 * read a cookie from storage
 * got this from w3schools
 * https://www.w3schools.com/js/js_cookies.asp
 * @param {String} cname The name of the cookie to return
 */
function getCookie(cname) {
	var name = cname + "=";
	var decodedCookie = decodeURIComponent(document.cookie);
	var ca = decodedCookie.split(';');
	for (var i = 0; i < ca.length; i++) {
		var c = ca[i];
		while (c.charAt(0) === ' ') {
			c = c.substring(1);
		}
		if (c.indexOf(name) === 0) {
			return c.substring(name.length, c.length);
		}
	}
	return "";
}

/**
 * set a cookie
 * the version from w3schools expects these to expire
 * @param {String} cname The name of the cookie to return
 * @param {String} value The value of that cookie option
 */
function setCookie(cname,value) {
	document.cookie = cname + "=" + value;
}

/**
 * Triggered when the Return key is pressed on the out-of-character chat input box.
 * @param {KeyboardEvent} event
 */
export function onOOCEnter(event) {
	if (event.keyCode === 13) {
		client.sendOOC(document.getElementById("client_oocinputbox").value);
		document.getElementById("client_oocinputbox").value = "";
	}
}
window.onOOCEnter = onOOCEnter;

/**
 * Triggered when the Return key is pressed on the in-character chat input box.
 * @param {KeyboardEvent} event
 */
export function onEnter(event) {
	if (event.keyCode === 13) {
		const mychar = client.character;
		const myemo = client.emote;
		const myevi = client.evidence;
		const myflip = ((client.flip) ? 1 : 0);
		const mycolor = document.getElementById("textcolor").value;
		const showname = document.getElementById("ic_chat_name").value;
		const mytext = document.getElementById("client_inputbox").value;
		const pairchar = document.getElementById("pair_select").value;
		const pairoffset = document.getElementById("pair_offset").value;
		let sfxname = "0";
		let sfxdelay = "0";
		if (document.getElementById("sendsfx").checked) {
			sfxname = myemo.sfx;
			sfxdelay = myemo.sfxdelay;
		}

		client.sendIC("chat", myemo.speaking, mychar.name, myemo.silent,
			mytext, mychar.side,
			sfxname, myemo.zoom, sfxdelay, selectedShout, myevi, myflip,
			selectedEffect, mycolor, showname, pairchar, pairoffset, 0);
	}
}
window.onEnter = onEnter;

/**
 * Resets the IC parameters for the player to enter a new chat message.
 * This should only be called when the player's previous chat message
 * was successfully sent/presented.
 */
function resetICParams() {
	document.getElementById("client_inputbox").value = "";
	if (selectedEffect) {
		document.getElementById("button_effect_" + selectedEffect).className = "client_button";
		selectedEffect = 0;
	}
	if (selectedShout) {
		document.getElementById("button_" + selectedShout).className = "client_button";
		selectedShout = 0;
	}
}

/**
 * Triggered when an item on the music list is clicked.
 * @param {MouseEvent} event
 */
export function musiclist_click(_event) {
	const playtrack = document.getElementById("client_musiclist").value;
	client.sendMusicChange(playtrack);

	// This is here so you can't actually select multiple tracks,
	// even though the select tag has the multiple option to render differently
	let musiclist_elements = document.getElementById("client_musiclist").selectedOptions;
	for (let i = 0; i < musiclist_elements.length; i++) {
		musiclist_elements[i].selected = false;
	}
}
window.musiclist_click = musiclist_click;

/**
 * Triggered when a character in the mute list is clicked
 * @param {MouseEvent} event
 */
export function mutelist_click(_event) {
	const select_character = document.getElementById("mute_select").value;

	// TODO: i don't feel like writing this rn
}
window.musiclist_click = mutelist_click;

/**
 * Triggered when the showname checkboc is clicked
 * @param {MouseEvent} event
 */
export function showname_click(_event) {
	setCookie("showname", document.getElementById("showname").checked);
	setCookie("ic_chat_name", document.getElementById("ic_chat_name").value);
}
window.showname_click = showname_click;

/**
 * Triggered when an item on the area list is clicked.
 * @param {MouseEvent} event
 */
export function area_click(el) {
	const area = el.textContent;
	client.sendMusicChange(area);

	const areaHr = document.createElement("div");
	areaHr.className = "hrtext";
	areaHr.textContent = `switched to ${el.textContent}`;
	document.getElementById("client_log").appendChild(areaHr);
}
window.area_click = area_click;

/**
 * Triggered by the music volume slider.
 */
export function changeMusicVolume() {
	viewport.music.volume = document.getElementById("client_mvolume").value / 100;
	setCookie("musicVolume",document.getElementById("client_mvolume").value);
}
window.changeMusicVolume = changeMusicVolume;

/**
 * Triggered by the sound effect volume slider.
 */
export function changeSFXVolume() {
	viewport.sfxaudio.volume = document.getElementById("client_svolume").value / 100;
	viewport.shoutaudio.volume = document.getElementById("client_svolume").value / 100;
	setCookie("sfxVolume",document.getElementById("client_svolume").value);
}
window.changeSFXVolume = changeSFXVolume;

/**
 * Triggered by the blip volume slider.
 */
export function changeBlipVolume() {
	viewport.blipVolume = document.getElementById("client_bvolume").value / 100;
	setCookie("blipVolume",document.getElementById("client_bvolume").value);
}
window.changeBlipVolume = changeBlipVolume;

/**
 * Triggered when a character icon is clicked in the character selection menu.
 * @param {MouseEvent} event
 */
export function changeCharacter(_event) {
	client.sendLeaveRoom();
	document.getElementById("client_charselect").style.display = "block";
	document.getElementById("client_emo").innerHTML = "";
}
window.changeCharacter = changeCharacter;

/**
 * Triggered when there was an error loading a character sprite.
 * @param {HTMLImageElement} image the element containing the missing image
 */
export function charError(image) {
	console.warn(image.src+" is missing from webAO");
	image.src = "misc/placeholder.gif";
	return true;
}
window.charError = charError;

/**
 * Triggered when there was an error loading a generic sprite.
 * @param {HTMLImageElement} image the element containing the missing image
 */
export function imgError(image) {
	image.onerror = "";
	image.src = ""; //unload so the old sprite doesn't persist
	return true;
}
window.imgError = imgError;

/**
 * Make a GET request for a specific URI.
 * @param {string} url the URI to be requested
 * @returns response data
 * @throws {Error} if status code is not 2xx, or a network error occurs
 */
async function requestBuffer(url) {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.responseType = "arraybuffer";
		xhr.addEventListener("error", () => {
			const err = new Error(`Request for ${url} failed: ${xhr.statusText}`);
			err.code = xhr.status;
			reject(err);
		});
		xhr.addEventListener("abort", () => {
			const err = new Error(`Request for ${url} was aborted!`);
			err.code = xhr.status;
			reject(err);
		});
		xhr.addEventListener("load", () => {
			if (xhr.status < 200 || xhr.status >= 300) {
				const err = new Error(`Request for ${url} failed with status code ${xhr.status}`);
				err.code = xhr.status;
				reject(err);
			} else {
				resolve(xhr.response);
			}
		});
		xhr.open("GET", url, true);
		xhr.send();
	});
}

/**
 * Make a GET request for a specific URI.
 * @param {string} url the URI to be requested
 * @returns response data
 * @throws {Error} if status code is not 2xx, or a network error occurs
 */
async function request(url) {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.responseType = "text";
		xhr.addEventListener("error", () => {
			const err = new Error(`Request for ${url} failed: ${xhr.statusText}`);
			err.code = xhr.status;
			reject(err);
		});
		xhr.addEventListener("abort", () => {
			const err = new Error(`Request for ${url} was aborted!`);
			err.code = xhr.status;
			reject(err);
		});
		xhr.addEventListener("load", () => {
			if (xhr.status < 200 || xhr.status >= 300) {
				const err = new Error(`Request for ${url} failed with status code ${xhr.status}`);
				err.code = xhr.status;
				reject(err);
			} else {
				resolve(xhr.response);
			}
		});
		xhr.open("GET", url, true);
		xhr.send();
	});
}

/**
 * Checks if a file exists at the specified URI.
 * @param {string} url the URI to be checked
 */
async function fileExists(url) {
	try {
		await request(url);
		return true;
	} catch (err) {
		if (err.code >= 400) return false;
		else throw err;
	}
}

/**
 * Changes the viewport background based on a given position.
 * 
 * Valid positions: `def, pro, hld, hlp, wit, jud, jur, sea`
 * @param {string} position the position to change into
 */
async function changeBackground(position) {
	const bgfolder = viewport.bgFolder;

	const positions = {
		def: {
			bg: "defenseempty.png",
			desk: { ao2: "defensedesk.png", ao1: "bancodefensa.png" },
			speedLines: "defense_speedlines.gif"
		},
		pro: {
			bg: "prosecutorempty.png",
			desk: { ao2: "prosecutiondesk.png", ao1: "bancoacusacion.png" },
			speedLines: "prosecution_speedlines.gif"
		},
		hld: {
			bg: "helperstand.png",
			desk: null,
			speedLines: "defense_speedlines.gif"
		},
		hlp: {
			bg: "prohelperstand.png",
			desk: null,
			speedLines: "prosecution_speedlines.gif"
		},
		wit: {
			bg: "witnessempty.png",
			desk: { ao2: "stand.png", ao1: "estrado.png" },
			speedLines: "prosecution_speedlines.gif"
		},
		jud: {
			bg: "judgestand.png",
			desk: null,
			speedLines: "prosecution_speedlines.gif"
		},
		jur: {
			bg: "jurystand.png",
			desk: { ao2: "jurydesk.png", ao1: "estrado.png" },
			speedLines: "defense_speedlines.gif"
		},
		sea: {
			bg: "seancestand.png",
			desk: { ao2: "seancedesk.png", ao1: "estrado.png" },
			speedLines: "prosecution_speedlines.gif"
		}
	};

	const { bg, desk, speedLines } = positions[position];
	document.getElementById("client_fg").style.display = "none";

	if (viewport.chatmsg.type === "5") {
		document.getElementById("client_court").src = `${AO_HOST}themes/default/${encodeURI(speedLines)}`;
		document.getElementById("client_bench").style.display = "none";
	} else {
		document.getElementById("client_court").src = bgfolder + bg;
		if (desk) {
			const deskFilename = await fileExists(bgfolder + desk.ao2) ? desk.ao2 : desk.ao1;
			document.getElementById("client_bench").src = bgfolder + deskFilename;
			document.getElementById("client_bench").style.display = "block";
		} else {
			document.getElementById("client_bench").style.display = "none";
		}
	}
}

/**
 * Triggered when the settings tab is fully loaded.
 */
export function loadSettings() {
	client.loadResources();
}
window.loadSettings = loadSettings;

/**
 * Triggered when the reconnect button is pushed.
 */
export function ReconnectButton() {
	client.cleanup();
	client = new Client(serverIP);
	if (client) {
		mode = "join"; // HACK: see client.onOpen
		document.getElementById("client_error").style.display = "none";
	}
}
window.ReconnectButton = ReconnectButton;

/**
 * Triggered when the retry button is pushed (during the loading process).
 */
export function RetryButton() {
	client.joinServer();
}
window.RetryButton = RetryButton;

/**
 * Appends a message to the in-character chat log.
 * @param {string} msg the string to be added
 * @param {string} name the name of the sender
 */
function appendICLog(msg, name = "", time = new Date()) {
	const entry = document.createElement("p");
	const nameField = document.createElement("span");
	nameField.id = "iclog_name";
	nameField.appendChild(document.createTextNode(name));
	entry.appendChild(nameField);
	entry.appendChild(document.createTextNode(msg));

	// Only put a timestamp if the minute has changed.
	if (lastICMessageTime.getMinutes() !== time.getMinutes()) {
		const timeStamp = document.createElement("span");
		timeStamp.id = "iclog_time";
		timeStamp.innerText = time.toLocaleTimeString(undefined, {
			hour: "numeric",
			minute: "2-digit"
		});
		entry.appendChild(timeStamp);
	}

	const clientLog = document.getElementById("client_log");
	clientLog.appendChild(entry);

	/* This is a little buggy - some troubleshooting might be desirable */
	if (clientLog.scrollTop > clientLog.scrollHeight - 800) {
		clientLog.scrollTop = clientLog.scrollHeight;
	}

	lastICMessageTime = new Date();
}

/**
 * Requests to play as a character.
 * @param {number} ccharacter the character ID; if this is a large number,
 * then spectator is chosen instead.
 */
export function pickChar(ccharacter) {
	if (ccharacter < 1000) {
		client.sendCharacter(ccharacter);
	} else {
		// Spectator
		document.getElementById("client_charselect").style.display = "none";
		document.getElementById("client_inputbox").style.display = "none";
		document.getElementById("client_emo").style.display = "none";
	}
}
window.pickChar = pickChar;

/**
 * Highlights and selects an emotion for in-character chat.
 * @param {string} emo the new emotion to be selected
 */
export function pickEmotion(emo) {
	try {
		if (client.selectedEmote !== -1) {
			document.getElementById("emo_" + client.selectedEmote).src = client.emote.button_off;
		}
	} catch (err) {
		// do nothing
	}
	client.selectedEmote = emo;
	document.getElementById("emo_" + emo).src = client.emote.button_on;
}
window.pickEmotion = pickEmotion;

/**
 * Highlights and selects an evidence for in-character chat.
 * @param {string} evidence the evidence to be presented
 */
export function pickEvidence(evidence) {
	if (client.selectedEvidence !== evidence) {
		//Update selected evidence		
		if (client.selectedEvidence > 0) {
			document.getElementById("evi_" + client.selectedEvidence).className = "client_button";
		}
		document.getElementById("evi_" + evidence).className = "client_button dark";
		client.selectedEvidence = evidence;

		// Show evidence on information window
		document.getElementById("evi_name").value = client.evidences[evidence - 1].name;
		document.getElementById("evi_desc").value = client.evidences[evidence - 1].desc;

		// Update icon
		const icon_id = getIndexFromSelect("evi_select", client.evidences[evidence - 1].filename);
		document.getElementById("evi_select").selectedIndex = icon_id;
		if (icon_id === 0) {
			document.getElementById("evi_filename").value = client.evidences[evidence - 1].filename;
		}
		updateEvidenceIcon();

		// Update button
		document.getElementById("evi_add").className = "client_button hover_button inactive";
		document.getElementById("evi_edit").className = "client_button hover_button";
		document.getElementById("evi_cancel").className = "client_button hover_button";
		document.getElementById("evi_del").className = "client_button hover_button";
	} else {
		cancelEvidence();
	}
}
window.pickEvidence = pickEvidence;

/**
 * Add evidence.
 */
export function addEvidence() {
	const evidence_select = document.getElementById("evi_select");
	client.sendPE(document.getElementById("evi_name").value,
		document.getElementById("evi_desc").value,
		evidence_select.selectedIndex === 0 ?
			document.getElementById("evi_filename").value :
			evidence_select.options[evidence_select.selectedIndex].text
	);
	cancelEvidence();
}
window.addEvidence = addEvidence;

/**
 * Edit selected evidence.
 */
export function editEvidence() {
	const evidence_select = document.getElementById("evi_select");
	const id = parseInt(client.selectedEvidence) - 1;
	client.sendEE(id,
		document.getElementById("evi_name").value,
		document.getElementById("evi_desc").value,
		evidence_select.selectedIndex === 0 ?
			document.getElementById("evi_filename").value :
			evidence_select.options[evidence_select.selectedIndex].text
	);
	cancelEvidence();
}
window.editEvidence = editEvidence;

/**
 * Delete selected evidence.
 */
export function deleteEvidence() {
	const id = parseInt(client.selectedEvidence) - 1;
	client.sendDE(id);
	cancelEvidence();
}
window.deleteEvidence = deleteEvidence;

/**
 * Cancel evidence selection.
 */
export function cancelEvidence() {
	//Clear evidence data
	if (client.selectedEvidence > 0) {
		document.getElementById("evi_" + client.selectedEvidence).className = "client_button";
	}
	client.selectedEvidence = 0;

	// Clear evidence on information window
	document.getElementById("evi_select").selectedIndex = 0;
	updateEvidenceIcon(); // Update icon widget
	document.getElementById("evi_filename").value = "";
	document.getElementById("evi_name").value = "";
	document.getElementById("evi_desc").value = "";
	document.getElementById("evi_icon").style.backgroundImage = "url('misc/empty.png')"; //Clear icon

	// Update button
	document.getElementById("evi_add").className = "client_button hover_button";
	document.getElementById("evi_edit").className = "client_button hover_button inactive";
	document.getElementById("evi_cancel").className = "client_button hover_button inactive";
	document.getElementById("evi_del").className = "client_button hover_button inactive";
}
window.cancelEvidence = cancelEvidence;

/**
 * Find index of anything in select box.
 * @param {string} select_box the select element name
 * @param {string} value the value that need to be compared
 */
export function getIndexFromSelect(select_box, value) {
	//Find if icon alraedy existed in select box
	const select_element = document.getElementById(select_box);
	for (let i = 1; i < select_element.length; ++i) {
		if (select_element.options[i].value === value) {
			return i;
		}
	}
	return 0;
}
window.getIndexFromSelect = getIndexFromSelect;

/**
 * Update evidence icon.
 */
export function updateEvidenceIcon() {
	const evidence_select = document.getElementById("evi_select");
	const evidence_filename = document.getElementById("evi_filename");
	const evidence_iconbox = document.getElementById("evi_icon");

	if (evidence_select.selectedIndex === 0) {
		evidence_filename.style.display = "initial";
		evidence_iconbox.style.backgroundImage = `url(${AO_HOST}evidence/${encodeURI(evidence_filename.value.toLowerCase())})`;
	} else {
		evidence_filename.style.display = "none";
		evidence_iconbox.style.backgroundImage = `url(${AO_HOST}evidence/${encodeURI(evidence_select.value.toLowerCase())})`;
	}
}
window.updateEvidenceIcon = updateEvidenceIcon;

/**
 * Update evidence icon.
 */
export function updateActionCommands(side) {
	if (side === "jud") {
		document.getElementById("judge_action").style.display = "inline-table";
		document.getElementById("no_action").style.display = "none";
	} else {
		document.getElementById("judge_action").style.display = "none";
		document.getElementById("no_action").style.display = "inline-table";
	}

	// Update role selector
	for (let i = 0, role_select = document.getElementById("role_select").options; i < role_select.length; i++) {
		if (side === role_select[i].value) {
			role_select.selectedIndex = i;
			return;
		}
	}
}
window.updateActionCommands = updateActionCommands;

/**
 * Change background via OOC.
 */
export function changeBackgroundOOC() {
	const selectedBG = document.getElementById("bg_select");
	const changeBGCommand = document.getElementById("bg_command").value;
	const bgFilename = document.getElementById("bg_filename");

	let filename = "";
	if (selectedBG.selectedIndex === 0) {
		filename = bgFilename.value;
	} else {
		filename = selectedBG.value;
	}
	client.sendOOC("/" + changeBGCommand.replace("$1", filename));
}
window.changeBackgroundOOC = changeBackgroundOOC;

/**
 * Change role via OOC.
 */
export function changeRoleOOC() {
	const role_select = document.getElementById("role_select");
	const role_command = document.getElementById("role_command").value;

	client.sendOOC("/" + role_command.replace("$1", role_select.value));
	updateActionCommands(role_select.value);
}
window.changeRoleOOC = changeRoleOOC;

/**
 * Random character via OOC.
 */
export function randomCharacterOOC() {
	client.sendOOC("/" + document.getElementById("randomchar_command").value);
}
window.randomCharacterOOC = randomCharacterOOC;

/**
 * Call mod.
 */
export function callMod() {
	$("#callmod_dialog").dialog("open");
}
window.callMod = callMod;

/**
 * Declare witness testimony.
 */
export function initWT() {
	client.sendRT("testimony1");
}
window.initWT = initWT;

/**
 * Declare cross examination.
 */
export function initCE() {
	client.sendRT("testimony2");
}
window.initCE = initCE;

/**
 * Increment defense health point.
 */
export function addHPD() {
	client.sendHP(1, String(parseInt(client.hp[0]) + 1));
}
window.addHPD = addHPD;

/**
 * Decrement defense health point.
 */
export function redHPD() {
	client.sendHP(1, String(parseInt(client.hp[0]) - 1));
}
window.redHPD = redHPD;

/**
 * Increment prosecution health point.
 */
export function addHPP() {
	client.sendHP(2, String(parseInt(client.hp[1]) + 1));
}
window.addHPP = addHPP;

/**
 * Decrement prosecution health point.
 */
export function redHPP() {
	client.sendHP(2, String(parseInt(client.hp[1]) - 1));
}
window.redHPP = redHPP;

/**
 * Update background preview.
 */
export function updateBackgroundPreview() {
	const background_select = document.getElementById("bg_select");
	const background_filename = document.getElementById("bg_filename");
	const background_preview = document.getElementById("bg_preview");

	if (background_select.selectedIndex === 0) {
		background_filename.style.display = "initial";
		background_preview.src = AO_HOST + "background/" + encodeURI(background_filename.value.toLowerCase()) + "/defenseempty.png";
	} else {
		background_filename.style.display = "none";
		background_preview.src = AO_HOST + "background/" + encodeURI(background_select.value.toLowerCase()) + "/defenseempty.png";
	}
}
window.updateBackgroundPreview = updateBackgroundPreview;

/**
 * Highlights and selects an effect for in-character chat.
 * If the same effect button is selected, then the effect is canceled.
 * @param {string} effect the new effect to be selected
 */
export function toggleEffect(effect) {
	if (effect === selectedEffect) {
		document.getElementById("button_effect_" + effect).className = "client_button";
		selectedEffect = 0;
	} else {
		document.getElementById("button_effect_" + effect).className = "client_button dark";
		if (selectedEffect) {
			document.getElementById("button_effect_" + selectedEffect).className = "client_button";
		}
		selectedEffect = effect;
	}
}
window.toggleEffect = toggleEffect;

/**
 * Toggle flip for in-character chat.
 */
export function toggleFlip() {
	if (client.flip) {
		document.getElementById("button_flip").className = "client_button";
	} else {
		document.getElementById("button_flip").className = "client_button dark";
	}
	client.flip = !client.flip;
}
window.toggleFlip = toggleFlip;

/**
 * Toggle presentable for presenting evidence in-character chat.
 */
export function togglePresent() {
	if (client.presentable) {
		document.getElementById("button_present").className = "client_button";
	} else {
		document.getElementById("button_present").className = "client_button dark";
	}
	client.presentable = !client.presentable;
}
window.togglePresent = togglePresent;

/**
 * Highlights and selects a menu.
 * @param {string} menu the menu to be selected
 */
export function toggleMenu(menu) {
	if (menu !== selectedMenu) {
		document.getElementById("menu_" + menu).className = "menu_icon active";
		document.getElementById("content_" + menu).className = "menu_content active";
		document.getElementById("menu_" + selectedMenu).className = "menu_icon";
		document.getElementById("content_" + selectedMenu).className = "menu_content";
		selectedMenu = menu;
	}
}
window.toggleMenu = toggleMenu;

/**
 * Highlights and selects a shout for in-character chat.
 * If the same shout button is selected, then the shout is canceled.
 * @param {string} shout the new shout to be selected
 */
export function toggleShout(shout) {
	if (shout === selectedShout) {
		document.getElementById("button_" + shout).className = "client_button";
		selectedShout = 0;
	} else {
		document.getElementById("button_" + shout).className = "client_button dark";
		if (selectedShout) {
			document.getElementById("button_" + selectedShout).className = "client_button";
		}
		selectedShout = shout;
	}
}
window.toggleShout = toggleShout;

/**
 * Escapes a string to be HTML-safe.
 * 
 * XXX: This is unnecessary if we use `createTextNode` instead!
 * @param {string} unsafe an unsanitized string
 */
function escapeHtml(unsafe) {
	return unsafe
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

/**
 * Escapes a string to AO1 escape codes.
 * @param {string} estring the string to be escaped
 */
function escapeChat(estring) {
	return estring
		.replace(/#/g, "<num>")
		.replace(/&/g, "<and>")
		.replace(/%/g, "<percent>")
		.replace(/\$/g, "<dollar>");
}

/**
 * Unescapes a string to AO1 escape codes.
 * @param {string} estring the string to be unescaped
 */
function unescapeChat(estring) {
	return estring
		.replace(/<num>/g, "#")
		.replace(/<and>/g, "&")
		.replace(/<percent>/g, "%")
		.replace(/<dollar>/g, "$");
}

/**
 * Encode text on client side.
 * @param {string} estring the string to be encoded
 */
function encodeChat(estring) {
	const selectedEncoding = document.getElementById("client_encoding").value;
	if (selectedEncoding === "unicode") {
		// This approach works by escaping all special characters to Unicode escape sequences.
		// Source: https://gist.github.com/mathiasbynens/1243213
		return estring.replace(/[^\0-~]/g, function (ch) {
			return "\\u" + ("000" + ch.charCodeAt().toString(16)).slice(-4);
		});
	} else if (selectedEncoding === "utf16") {
		// Source: https://developers.google.com/web/updates/2012/06/How-to-convert-ArrayBuffer-to-and-from-String
		const buffer = new ArrayBuffer(estring.length * 2);
		const result = new Uint16Array(buffer);
		for (let i = 0, strLen = estring.length; i < strLen; i++) {
			result[i] = estring.charCodeAt(i);
		}
		return String(result);
	} else {
		return estring;
	}
}

/**
 * Decodes text on client side.
 * @param {string} estring the string to be decoded
 */
function decodeChat(estring) {
	const selectedDecoding = document.getElementById("client_decoding").value;
	if (selectedDecoding === "unicode") {
		// Source: https://stackoverflow.com/questions/7885096/how-do-i-decode-a-string-with-escaped-unicode
		return estring.replace(/\\u([\d\w]{1,})/gi, function (match, group) {
			return String.fromCharCode(parseInt(group, 16));
		});
	} else if (selectedDecoding === "utf16") {
		// Source: https://developers.google.com/web/updates/2012/06/How-to-convert-ArrayBuffer-to-and-from-String
		return String.fromCharCode.apply(null, new Uint16Array(estring.split(",")));
	} else {
		return estring;
	}
}

//
// Client code
//

let client = new Client(serverIP);
let viewport = new Viewport();

// Create dialog and link to button	
$(function () {
	$("#callmod_dialog").dialog({
		autoOpen: false,
		resizable: false,
		show: {
			effect: "drop",
			direction: "down",
			duration: 500
		},
		hide: {
			effect: "drop",
			direction: "down",
			duration: 500
		},
		height: "auto",
		width: 400,
		modal: true,
		buttons: {
			Sure: function () {
				const reason = prompt("Please enter the reason", "");
				client.sendZZ(reason);
				$(this).dialog("close");
			},
			Cancel: function () {
				$(this).dialog("close");
			}
		}
	});
});
