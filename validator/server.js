#!/usr/bin/env node

// DEPENDENCIES =======================

const fs = require('fs');
const {Client, Consumer, Producer} = require('kafka-node');


// CONSTANTS ==========================

const COMMAND_TOPIC = 'commands';
const EVENT_TOPIC = 'events';


// CONFIG =============================

// read settings

let settings = null;
let contentTypes = {};

try {
  const settingsFile = fs.readFileSync(__dirname + '/../settings.json', {encoding: 'utf8'});
  settings = JSON.parse(settingsFile);

  // extract content types
  settings.contentTypes.forEach(contentType => {
    contentTypes[contentType.base] = contentType;
  });

} catch (err) {
  console.error(`Could not open or parse configuration file.\n${err.message}\nDid you run "./control.sh setup" before?`);
  process.exit(1);
}


// KAFKA ==============================

// create client
const client = new Client(`${settings.ip}:2181`);

// create producer
const producer = new Producer(client, {
  requireAcks: 1,
  ackTimeoutMs: 100
});

let PRODUCER_READY = false;
producer.on('ready', () => PRODUCER_READY = true);

// create consumer
const consumer = new Consumer(client, [{
  topic: COMMAND_TOPIC,
  offset: 0
}], {
  fromOffset: true,
  encoding: 'utf8'
});


// UTILS ==============================

/**
 * repeat given character for specified times
 * @param {Number} [num=0] number to repeat
 * @param {String} [char=' '] character to repeat
 * @return {String} repeated character
 */
let repeat = (num = 0, char = ' ') => {
  return Array(num + 1).join(char);
};

/**
 * log json if debug flag is enabled
 * @param {Object} output output
 * @param {Number} [indent=4] indentation to use
 */
logJson = (output, indent = 4) => {
  if (settings.debug) {
    console.log(
      repeat(indent) +
      JSON.stringify(output, null, 2).replace(/\n/g, '\n' + repeat(indent))
    );
  }
};


// PROCESSING =========================

// error handler
consumer.on('error', err => {
  console.error(err.message);
});

// message handler
consumer.on('message', message => {
  console.log(`\x1b[37mMessage #${message.offset + 1}\x1b[0m of ${message.highWaterOffset} (Partition ${message.partition})`);
  console.log(`  received value with ${message.value.length} bytes`);

  try {
    let value = JSON.parse(message.value);
    logJson(value);

    // validate command
    // TODO: implement

  } catch (e) {
    console.error(`  ${e.message}`);
  }
});


// SHUTDOWN ===========================

// graceful shutdown
let shutdown = () => {
  console.log('\nShutting down ...');
  consumer.close();
  process.exit(0);
};

process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
