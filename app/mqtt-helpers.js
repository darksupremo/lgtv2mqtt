const mqtt = require('mqtt');
const logging = require('./logging.js');
const _ = require('lodash');

let publishMap = {};

const fixName = function (string) {
    string = string.replace(/[+\\&*%$#@!’]/g, '');
    string = string.replace(/\s/g, '_').trim().toLowerCase();
    string = string.replace(/__/g, '_');
    string = string.replace(/-/g, '_');

    return string;
};

if (mqtt.MqttClient.prototype.smartPublish === null) {
    mqtt.MqttClient.prototype.smartPublish = function (topic, message, options) {
        if (topic === null) {
            logging.error('empty client or topic passed into mqtt_helpers.publish');
            return;
        }

        topic = fixName(topic);

        logging.debug(' ' + topic + ':' + message);
        if (publishMap[topic] === message) {
            logging.debug(' * not published');
        } else {
            publishMap[topic] = message;
            logging.info(' => published: [' + topic + ':' + message + ']');
            this.publish(topic, message, options);
        }
    };
}

const host = process.env.MQTT_HOST;
const mqttUsername = process.env.MQTT_USER;
const mqttPassword = process.env.MQTT_PASS;
const mqttName = process.env.MQTT_NAME;
const mqttClientId = process.env.MQTT_CLIENT_ID || "lgtv2mqtt";

let logName = mqttName;

if (_.isNil(logName)) {
    logName = process.env.name;
}

if (_.isNil(logName)) {
    logName = process.env.LOGGING_NAME;
}

if (mqtt.setupClient === null) {
    mqtt.setupClient = exports.setupClient;
}

exports.setupClient = function (connectedCallback, disconnectedCallback) {
    if (_.isNil(host)) {
        logging.warn('MQTT_HOST not set, aborting');
        process.abort();
    }

    const mqttOptions = {
        clientId: mqttClientId
    };

    if (!_.isNil(mqttUsername)) {
        mqttOptions.username = mqttUsername;
    }

    if (!_.isNil(mqttPassword)) {
        mqttOptions.password = mqttPassword;
    }

    if (!_.isNil(logName)) {
        mqttOptions.will = {};
        mqttOptions.will.topic = fixName('/status/' + logName);
        mqttOptions.will.payload = '0';
        mqttOptions.will.retain = true;
    }

    const client = mqtt.connect(`mqtt://${host}`, mqttOptions);

    // MQTT Observation

    client.on('connect', () => {
        logging.info('MQTT Connected');

        publishMap = {};

        if (!_.isNil(logName)) {
            client.publish(fixName('/status/' + logName), '1', {retain: true});
        }

        if (!_.isNil(connectedCallback)) {
            connectedCallback();
        }
    });

    client.on('disconnect', () => {
        logging.error('MQTT Disconnected, reconnecting');

        publishMap = {};

        client.connect(host);

        if (!_.isNil(disconnectedCallback)) {
            disconnectedCallback();
        }
    });

    return client;
};

exports.generateTopic = function (...args) {
    let topicString = '';
    let first = true;

    for (const component of args) {
        if (first) {
            first = false;
        } else {
            topicString += '/';
        }

        topicString += fixName(component);
    }

    return topicString;
};
