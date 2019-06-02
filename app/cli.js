#!/usr/bin/env node
const yargs = require('yargs')
const path = require("path")
const fs = require("fs")
const eol = require("os").EOL

const SWProxy = require("./proxy/SWProxy.js")
const profileExporter = require("./plugins/profile-export")
global.gMapping = require('./mapping');

global.appVersion = "0.0.25-cli";

let defaultFilePath = "./"

global.config = {
    Config: {
        App: { filesPath: defaultFilePath, debug: false, clearLogOnLogin: false },
        Proxy: { port: 8080, autoStart: true },
        Plugins: {}
    }
};
config.Config.Plugins[profileExporter.pluginName] = profileExporter.defaultConfig

global.argv = yargs
    .usage("Usage: $0 [options]")

    .default("port", 8080)
    .describe("port", "proxy port")

    .boolean("log-to-file")
    .describe("log-to-file", "append all API calls/responses to files. See --{request,response}-file.")

    .default("request-file", "request-jsons.txt")
    .describe("request-file", "path to file which API requests shall be appended to")

    .default("response-file", "response-jsons.txt")
    .describe("response-file", "path to file which API responses shall be appended to")

    .default("mqtt-broker", "")
    .describe("mqtt-broker", "broker to which API data shall be published (ref. https://www.npmjs.com/package/mqtt#connect)")

    .default("mqtt-base-topic", "")
    .describe("mqtt-base-topic", "prefix for topics (e.g. 'sw/' => responses published to 'sw/<wizard_name>/response'")

    .boolean("profiles-to-file")
    .describe("profiles-to-file", "save exported profiles to file")

    .boolean("profiles-to-mqtt")
    .default("profiles-to-mqtt", true)
    .describe("profiles-to-mqtt", "public profiles to MQTT ([base-topic]/<wizard_name>/profile). No effect wihout MQTT broker configured.")

    .boolean("sort-like-in-game")
    .default("sort-like-in-game", true)
    .describe("sort-like-in-game", "sort profile data like sorted in-game")

    .argv

global.mqttClient = false
if (argv["mqtt-broker"]) {
    var mqtt = require('mqtt')
    mqttClient  = mqtt.connect(argv["mqtt-broker"])
    mqttClient.on("connect", () => {
        console.log("Successfully connected to MQTT broker.")
    })
    mqttClient.on("close", () => {
        console.log("Disconnected from MQTT broker.")
    })
    mqttClient.on("reconnect", () => {
        console.log("Reconnecting to MQTT broker...")
    })
    mqttClient.on("offline", () => {
        console.log("MQTT client went offline.")
    })
    mqttClient.on("error", (error) => {
        console.log("MQTT client emitted an error:", error)
    })
}

global.win = {
    webContents: {
        send(messageType, payload) {
            if (payload) {
                console.log(messageType, payload);
            } else {
                console.log(messageType);
            }
        }
    }
};

let proxy = new SWProxy();

if (argv["profiles-to-file"]) {
    config.Config.Plugins[profileExporter.pluginName].enabled = true
    profileExporter.init(proxy, config)
} else {
    config.Config.Plugins[profileExporter.pluginName].enabled = false
}

if (argv["profiles-to-mqtt"]) {
    proxy.on('HubUserLogin', (req, respData) => {
        if (argv["sort-like-in-game"]) {
            respData = profileExporter.sortUserData(respData);
        }
        if (mqttClient !== false) {
            let wizardTopic = argv["mqtt-base-topic"] + "/" + respData.wizard_info.wizard_name
            mqttClient.publish(wizardTopic + "/profile", JSON.stringify(respData))
        }
    });
}

proxy.on("apiCommand", (reqData, respData) => {
    console.log("API command:", respData.command)

    if(argv["log-to-file"] && argv["request-file"]) {
        fs.appendFile(argv["request-file"], JSON.stringify(reqData) + eol, (err) => {
            if (err) {
                console.error("Could not append request JSON to file. Please check access.")
            }
        })
    }
    if(argv["log-to-file"] && argv["response-file"]) {
        fs.appendFile(argv["response-file"], JSON.stringify(respData) + eol, (err) => {
            if (err) {
                console.error("Could not append response JSON to file. Please check access.")
            }
        })
    }

    if (mqttClient !== false) {
        if (respData.wizard_info) {
            let wizardTopic = argv["mqtt-base-topic"] + "/" + respData.wizard_info.wizard_name
            mqttClient.publish(wizardTopic + "/request", JSON.stringify(reqData))
            mqttClient.publish(wizardTopic + "/response", JSON.stringify(respData))
        } else {
            console.log("No wizard_info in respData in response to " + respData.command)
        }
    }
})

proxy.start(argv.port)
