#!/usr/bin/env node

const Lgtv = require('lgtv2');
const pkg = require('../package.json');
const _ = require('lodash');
const logging = require('./logging.js');
const wol = require('wol');
const mqttHelpers = require('./mqtt-helpers.js');

let mqttConnected;
let tvConnected;
let lastError;
let foregroundApp = null;

const tvMAC = process.env.TV_MAC;
const tvIP = process.env.TV_IP;
const broadcastIP = process.env.BROADCAST_IP;
const clientKeyPath = process.env.CLIENT_KEY_PATH || '/usr/node_app/lgkey/';

const mqttOptions = {retain: true, qos: 1};
const topicPrefix = process.env.TOPIC_PREFIX;

if (_.isNil(topicPrefix)) {
    logging.error('TOPIC_PREFIX not set, not starting');
    process.abort();
}

logging.info(pkg.name + ' ' + pkg.version + ' starting');

const mqtt = mqttHelpers.setupClient(() => {
    mqttConnected = true;

    mqtt.publish(topicPrefix + '/connected', tvConnected ? '1' : '0', mqttOptions);

    logging.info('mqtt subscribe', topicPrefix + '/set/#');
    mqtt.subscribe(topicPrefix + '/set/#', {qos: 1});
}, () => {
    if (mqttConnected) {
        mqttConnected = false;
        logging.error('mqtt disconnected');
    }
});

const powerOff = function () {
    logging.info('power_off');
    logging.info('lg > ssap://system/turnOff');
    lgtv.request('ssap://system/turnOff', null, null);
};

const powerOn = function () {
    logging.info('power_on');
    wol.wake(tvMAC, {
        address: broadcastIP
    }, (err, response) => {
        logging.info('WOL: ' + response);
        if (foregroundApp === null) {
            logging.info('lg > ssap://system/turnOff (to turn it on...)');
            lgtv.request('ssap://system/turnOff', null, null);
        }
    });
};

const lgtv = new Lgtv({
    url: 'ws://' + tvIP + ':3000',
    reconnect: 1000,
    keyFile: `${clientKeyPath}keyfile-${tvIP.replace(/[a-z]+:\/\/([\w-.]+):\d+/, '$1')}`
});

mqtt.on('error', err => {
    logging.error('mqtt: ' + err);
});

mqtt.on('message', (inTopic, inPayload) => {
    let topic = inTopic;
    const payload = String(inPayload);
    logging.info('mqtt <' + topic + ':' + payload);

    if (topic[0] === '/') {
        topic = topic.slice(1);
    }

    const parts = topic.split('/');

    switch (parts[1]) {
        case 'set':
            switch (parts[2]) {
                case 'toast': {
                    logging.info(`lg > ssap://system.notifications/createToast:${payload}`);
                    lgtv.request('ssap://system.notifications/createToast', {message: String(payload)});
                    break;
                }

                case 'volume': {
                    const volume = Number.parseInt(payload, 10);
                    logging.info(`lg > ssap://audio/setVolume:${volume}`);
                    lgtv.request('ssap://audio/setVolume', {volume});
                    break;
                }

                case 'mute': {
                    const mute = Boolean(!(payload === 'false' || payload === '0'));
                    logging.info(`lg > ssap://audio/setMute:${mute}`);
                    lgtv.request('ssap://audio/setMute', {mute});
                    break;
                }

                case 'input': {
                    logging.info(`lg > ssap://tv/switchInput:${JSON.stringify({inputId: String(payload)})}`);
                    lgtv.request('ssap://tv/switchInput', {inputId: String(payload)});
                    break;
                }

                case 'launch': {
                    logging.info(`lg > ssap://system.launcher/launch:${payload}`);
                    lgtv.request('ssap://system.launcher/launch', {id: String(payload)});
                    break;
                }

                case 'system_launch_json': {
                    try {
                        logging.info(`lg > ssap://system.launcher/launch:${payload}`);
                        lgtv.request('ssap://system.launcher/launch', JSON.parse(payload));
                    } catch (error) {
                        logging.error(error);
                    }

                    break;
                }

                case 'am_launch_json': {
                    try {
                        logging.info(`lg > ssap://com.webos.applicationManager/launch:${payload}`);
                        lgtv.request('ssap://com.webos.applicationManager/launch', JSON.parse(payload));
                    } catch (error) {
                        logging.error(error);
                    }

                    break;
                }

                case 'move':
                case 'drag': {
                    try {
                        const jsonPayload = JSON.parse(payload);
                        // The event type is 'move' for both moves and drags.
                        sendPointerEvent('move', {
                            dx: jsonPayload.dx,
                            dy: jsonPayload.dy,
                            drag: parts[2] === 'drag' ? 1 : 0
                        });
                    } catch (error) {
                        logging.error(error);
                    }

                    break;
                }

                case 'scroll': {
                    try {
                        const jsonPayload = JSON.parse(payload);
                        sendPointerEvent('scroll', {
                            dx: jsonPayload.dx,
                            dy: jsonPayload.dy
                        });
                    } catch (error) {
                        logging.error(error);
                    }

                    break;
                }

                case 'click': {
                    sendPointerEvent('click');
                    break;
                }

                case 'power': {
                    if (payload === 'false' || payload === '0') {
                        powerOff();
                    } else {
                        powerOn();
                    }

                    break;
                }

                case 'button': {
                    /*
                     * Buttons that are known to work:
                     *    MUTE, RED, GREEN, YELLOW, BLUE, HOME, MENU, VOLUMEUP, VOLUMEDOWN,
                     *    CC, BACK, UP, DOWN, LEFT, ENTER, DASH, 0-9, EXIT, CHANNELUP, CHANNELDOWN
                     */
                    sendPointerEvent('button', {name: (String(payload)).toUpperCase()});
                    break;
                }

                case 'open':
                case 'open_max': {
                    lgtv.request('ssap://system.launcher/open', {target: String(payload)});
                    if (parts[2] === 'open_max') {
                        setTimeout(clickMax, 5000);
                    }

                    break;
                }

                case 'netflix': {
                    lgtv.request('ssap://system.launcher/launch', payload ? {
                        id: 'netflix',
                        contentId: `m=http://api.netflix.com/catalog/titles/movies/${payload}&source_type=4`
                    } : {
                        id: 'netflix'
                    });
                    break;
                }

                case 'amazon_prime': {
                    lgtv.request('ssap://system.launcher/launch', {id: 'amazon'});
                    break;
                }

                case 'web_video_caster': {
                    lgtv.request('ssap://system.launcher/launch', {id: 'com.instantbits.cast.webvideo'});
                    break;
                }

                case 'youtube': {
                    lgtv.request('ssap://com.webos.applicationManager/launch', payload ? {
                        id: 'youtube.leanback.v4',
                        params: {
                            contentTarget: `https://www.youtube.com/tv?v=${payload}`
                        }
                    } : {id: 'youtube.leanback.v4'});
                    break;
                }

                case 'plex': {
                    lgtv.request('ssap://system.launcher/launch', {id: 'cdp-30'});
                    break;
                }

                default: {
                    const path = topic.replace(topicPrefix + '/set/', '');
                    const jsonPayload = payload ? JSON.parse(payload) : null;
                    logging.info(`lg > 'ssap://${path}:${payload || 'null'}`);
                    lgtv.request(`ssap://${path}`, jsonPayload);
                }
            }

            break;
        default:
    }
});

lgtv.on('prompt', () => {
    logging.info('authorization required');
});

lgtv.on('connect', () => {
    let channelsSubscribed = false;
    lastError = null;
    tvConnected = true;
    logging.info('tv connected');
    mqtt.publish(topicPrefix + '/connected', '1', mqttOptions);

    lgtv.subscribe('ssap://audio/getVolume', (err, response) => {
        logging.info('audio/getVolume', err, response);
        if (response.changed.includes('volume')) {
            mqtt.publish(topicPrefix + '/status/volume', String(response.volume), mqttOptions);
        }

        if (response.changed.includes('muted')) {
            mqtt.publish(topicPrefix + '/status/mute', response.muted ? '1' : '0', mqttOptions);
        }
    });

    lgtv.subscribe('ssap://com.webos.applicationManager/getForegroundAppInfo', (err, response) => {
        logging.info('getForegroundAppInfo', err, response);
        mqtt.publish(topicPrefix + '/status/foregroundApp', String(response.appId), mqttOptions);

        if (!_.isNil(response.appId) && response.appId.length > 0) {
            foregroundApp = response.appId;
        } else {
            foregroundApp = null;
        }

        if (response.appId === 'com.webos.app.livetv') {
            if (!channelsSubscribed) {
                channelsSubscribed = true;
                setTimeout(() => {
                    lgtv.subscribe('ssap://tv/getCurrentChannel', (err, response) => {
                        if (err) {
                            logging.error(err);
                            return;
                        }

                        const message = {
                            val: response.channelNumber,
                            lgtv: response
                        };
                        mqtt.publish(topicPrefix + '/status/currentChannel', JSON.stringify(message), mqttOptions);
                    });
                }, 2500);
            }
        }
    });

    lgtv.subscribe('ssap://tv/getExternalInputList', (err, response) => {
        logging.info('getExternalInputList', err, response);
    });
});

lgtv.on('connecting', host => {
    logging.info('tv trying to connect', host);
});

lgtv.on('close', () => {
    lastError = null;
    tvConnected = false;
    logging.info('tv disconnected');
    mqtt.publish(topicPrefix + '/connected', '0', mqttOptions);
});

lgtv.on('error', err => {
    const string = String(err);
    if (string !== lastError) {
        logging.error('tv error: ' + string);
    }

    lastError = string;
});

const sendPointerEvent = function (type, payload) {
    logging.info(`lg > ssap://com.webos.service.networkinput/getPointerInputSocket | type: ${type} | payload: ${JSON.stringify(payload)}`);
    lgtv.getSocket(
        'ssap://com.webos.service.networkinput/getPointerInputSocket',
        (err, sock) => {
            if (!err) {
                sock.send(type, payload);
            }
        }
    );
};

const clickMax = function () {
    lgtv.getSocket('ssap://com.webos.service.networkinput/getPointerInputSocket',
        (err, sock) => {
            if (!err) {
                const command = 'move\ndx:11\ndy:-8\ndown:0\n\n';
                for (let i = 0; i < 22; i++) {
                    sock.send(command);
                }

                setTimeout(() => sock.send('click'), 1000);
            }
        });
};
