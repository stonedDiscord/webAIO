const MASTERSERVER_IP = "master.aceattorneyonline.com:27014";
import { version } from '../package.json';

import Fingerprint2 from 'fingerprintjs2';
import { unescapeChat } from './encoding.js';

let masterserver;

let hdid;
const options = { fonts: { extendedJsFonts: true, userDefinedFonts: ["Ace Attorney", "8bitoperator", "DINEngschrift"] }, excludes: { userAgent: true, enumerateDevices: true } };

let lowMemory = false;

const server_description = [];
server_description[-1] = "This is your computer on port 50001";
const online_counter = [];

if (window.requestIdleCallback) {
	requestIdleCallback(function () {
		Fingerprint2.get(options, function (components) {
			hdid = Fingerprint2.x64hash128(components.reduce((a, b) => `${a.value || a}, ${b.value}`), 31);

			if (/webOS|iPod|BlackBerry|BB|PlayBook|IEMobile|Windows Phone|Kindle|Silk|PlayStation|Opera Mini/i.test(navigator.userAgent)) {
				lowMemory = true;
			}

			check_https();

			masterserver = new WebSocket("ws://" + MASTERSERVER_IP);
			masterserver.onopen = (evt) => onOpen(evt);
			masterserver.onerror = (evt) => onError(evt);
			masterserver.onmessage = (evt) => onMessage(evt);

			// i don't need the ms to play alone
			setTimeout(() => checkOnline(-1, "127.0.0.1:50001"), 0);
		});
	});
} else {
	setTimeout(function () {
		Fingerprint2.get(options, function (components) {
			hdid = Fingerprint2.x64hash128(components.reduce((a, b) => `${a.value || a}, ${b.value}`), 31);

			if (/webOS|iPod|BlackBerry|BB|PlayBook|IEMobile|Windows Phone|Kindle|Silk|PlayStation|Opera Mini/i.test(navigator.userAgent)) {
				lowMemory = true;
			}

			check_https();

			masterserver = new WebSocket("ws://" + MASTERSERVER_IP);
			masterserver.onopen = (evt) => onOpen(evt);
			masterserver.onerror = (evt) => onError(evt);
			masterserver.onmessage = (evt) => onMessage(evt);

			// i don't need the ms to play alone
			setTimeout(() => checkOnline(-1, "127.0.0.1:50001"), 0);
		});
	}, 500);
}

export function check_https() {
	if (document.location.protocol === "https:") {
		document.getElementById("https_error").style.display = "";
	}
}

export function setServ(ID) {
	console.log(server_description[ID]);
	if (server_description[ID] !== undefined) {
		document.getElementById("serverdescription_content").innerHTML = "<b>" + online_counter[ID] + "</b><br>" + server_description[ID];
	}
	else {
		document.getElementById("serverdescription_content").innerHTML = "";
	}
}
window.setServ = setServ;

function onOpen(_e) {
	console.log(`Your emulated HDID is ${hdid}`);
	masterserver.send(`ID#webAO#webAO#%`);

	masterserver.send("ALL#%");
	masterserver.send("VC#%");
}

/**
 * Triggered when an network error occurs.
 * @param {ErrorEvent} e 
 */
function onError(evt) {
	document.getElementById("ms_error").style.display = "block";
	document.getElementById("ms_error_code").innerText = `A network error occurred: ${evt.reason} (${evt.code})`;
}

function checkOnline(serverID, coIP) {
	let oserv = new WebSocket("ws://" + coIP);

	// define what the callbacks do
	function onCOOpen(_e) {
		document.getElementById(`server${serverID}`).className = "available";
		oserv.send(`HI#${hdid}#%`);
		oserv.send(`ID#webAO#webAO#%`);
	}

	function onCOMessage(e) {
		const comsg = e.data;
		const coheader = comsg.split("#", 2)[0];
		const coarguments = comsg.split("#").slice(1);
		if (coheader === "PN") {
			online_counter[serverID] = `Online: ${coarguments[0]}/${coarguments[1]}`;
			oserv.close();
		}
		else if (coheader === "BD") {
			online_counter[serverID] = "Banned";
			server_description[serverID] = coarguments[0];
			oserv.close();
		}
	}

	function onCOError(_e) {
		console.warn(coIP + " threw an error.");
	}

	// assign the callbacks
	oserv.onopen = function (evt) {
		onCOOpen(evt);
	};

	oserv.onmessage = function (evt) {
		onCOMessage(evt);
	};

	oserv.onerror = function (evt) {
		onCOError(evt);
	};

}

function onMessage(e) {
	const msg = e.data;
	const header = msg.split("#", 2)[0];
	console.log(header);

	if (header === "ALL") {
		const servers = msg.split("#").slice(1);
		for (let i = 0; i < servers.length - 1; i++) {
			const serverEntry = servers[i];
			const args = serverEntry.split("&");
			const asset = args[4] ? `&asset=${args[4]}` : "";
			const liclass = lowMemory ? "" : "unavailable"; // don't hide the entries if we're not checking them

			document.getElementById("masterlist").innerHTML +=
				`<li id="server${i}" class="${liclass}" onmouseover="setServ(${i})"><p>${args[0]}</p>`
				+ `<a class="button" href="client.html?mode=watch&ip=${args[2]}:${args[3]}${asset}">Watch</a>`
				+ `<a class="button" href="client.html?mode=join&ip=${args[2]}:${args[3]}${asset}">Join</a></li>`;
			server_description[i] = args[1];
			if (!lowMemory)
				setTimeout(() => checkOnline(i, `${args[2]}:${args[3]}`), 0);
		}
		masterserver.close();
	}
	else if (header === "servercheok") {
		const args = msg.split("#").slice(1);
		document.getElementById("clientinfo").innerHTML = `Client version: ${version} expected: ${args[0]}`;
	}
	else if (header === "SV") {
		const args = msg.split("#").slice(1);
		document.getElementById("serverinfo").innerHTML = `Master server version: ${args[0]}`;
	}
	else if (header === "CT") {
		const args = msg.split("#").slice(1);
		const msChat = document.getElementById("masterchat");
		msChat.innerHTML += `${unescapeChat(args[0])}: ${unescapeChat(args[1])}\r\n`;
		if (msChat.scrollTop > msChat.scrollHeight - 600) {
			msChat.scrollTop = msChat.scrollHeight;
		}
	}
}
