#!/usr/bin/env node

// DEPENDENCIES =======================

const fs = require('fs');
const http = require('http');
const {Client, Producer} = require('kafka-node');


// CONSTANTS ==========================

const COMMAND_TOPIC = 'commands';


// CONFIG =============================

// read settings

let settings = null;
let contentTypes = {};
let bases = [];
let patternList = null;
let patternSingle = null;

try {
  const settingsFile = fs.readFileSync(__dirname + '/../settings.json', {encoding: 'utf8'});
  settings = JSON.parse(settingsFile);

  // extract content types and bases
  settings.contentTypes.forEach(contentType => {
    contentTypes[contentType.base] = contentType;
    bases.push(contentType.base);
  });

  // create patterns
  patternList = `^\/(${bases.join('|')})\/?$`;
  patternSingle = `^\/(${bases.join('|')})\/([-a-f0-9]+)\/?$`;

} catch (err) {
  console.error(`Could not open or parse configuration file.\n${err.message}\nDid you run "./control.sh setup" before?`);
  process.exit(1);
}


// KAFKA ==============================

// create client and producer
const client = new Client(`${settings.ip}:2181`);
const producer = new Producer(client, {
  requireAcks: 1,
  ackTimeoutMs: 100
});

let PRODUCER_READY = false;
producer.on('ready', () => PRODUCER_READY = true);


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

/**
 * validate request
 * @param {Request} req received request
 * @param {Object} body received body
 * @param {String} resource resource type identifier (e.g. "entries", "assets", ...)
 * @param {Function} cb callback to call with true in case of success or error message in case of failure
 */
let validateRequest = (req, body, resource, cb) => {
  let valid = true;

  // extract schema for given resource
  let schema = contentTypes[resource].fields;

  // check required fields
  schema
    .filter(field => field.required)
    .forEach(field => {
      if (!body[field.id]) {
        valid = `Required field "${field.id}" is missing`;
      }
    });

  // check data types
  Object.keys(body).forEach(field => {
    schema
      .filter(f => field === f.id)
      .forEach(f => {
        if (typeof body[field] != f.type) {
          valid = `Field "${field}" should be of type "${f.type}" but is of type "${typeof body[field]}"`;
        }
      });
  });

  cb(valid);
};

/**
 * send response to client
 * @param {Response} res response to send
 * @param {Number} status HTTP status to use
 * @param {Object} body body to send or undefined
 */
let sendResponse = (res, status, body) => {

  // determine status code and content type
  let code = status < 400 ? `\x1b[32m${status}\x1b[0m` : `\x1b[31m${status}\x1b[0m`;
  let contentType = status < 300 ? 'application/json' : 'text/plain';

  // send response
  console.log(`  response code ${code}`);
  res.writeHead(status, {'Content-Type': contentType});
  res.end(body);

};

/**
 * send message to kafka
 * @param {Request} req received request
 * @param {Response} res response to send
 * @param {Object} payload payload in format {topic: 'TOPIC', messages: [...]}
 * @param {Function} cb callback to call in case of success
 */
let sendMessage = (req, res, payload, cb) => {
  if (PRODUCER_READY) {

    // debug output
    console.log(`  sending payload with ${JSON.stringify(payload).length} bytes`);
    logJson(payload);

    // send to kafka producer
    producer.send(payload, (err, data) => {
      if (err) {
        sendResponse(res, 500, err);
      } else {
        cb(data);
      }
    });

  } else {
    sendResponse(res, 500, 'Producer not ready');
  }
};

/**
 * build command
 * @param {String} type command type to use
 * @param {Object} body body to send
 * @param {Object} params params used in REST request
 * @return {Object} command
 */
let buildCommand = (type, body, params = {}) => {
  return JSON.stringify({
    type: type,
    body: body,
    params: params,
    meta: {user: 1}
  });
};


// HANDLER ============================

/**
 * handler for creating resources (POST method)
 * @param {Request} req received request
 * @param {Object} body received body
 * @param {Response} res response to send
 * @param {String} resource resource type identifier (e.g. "entries", "assets", ...)
 */
let createHandler = (req, body, res, resource) => {
  const payload = [{
    topic: COMMAND_TOPIC,
    messages: [buildCommand('create' + contentTypes[resource].name, body)]
  }];

  sendMessage(req, res, payload, data => {
    sendResponse(res, 200);
  });
};

/**
 * handler for updating resources (PUT method)
 * @param {Request} req received request
 * @param {Object} body received body
 * @param {Response} res response to send
 * @param {String} resource resource type identifier (e.g. "entries", "assets", ...)
 * @param {String} id resource ID (e.g. an valid UUID4)
 */
let updateHandler = (req, body, res, resource, id) => {
  // TODO: validate ID here or send an event like 404 async?

  const payload = [{
    topic: COMMAND_TOPIC,
    messages: buildCommand('update' + contentTypes[resource].name, body, {id: id})
  }];

  sendMessage(req, res, payload, data => {
    sendResponse(res, 200);
  });
};

/**
 * handler for deleting resources (PUT method)
 * @param {Request} req received request
 * @param {Object} body received body
 * @param {Response} res response to send
 * @param {String} resource resource type identifier (e.g. "entries", "assets", ...)
 * @param {String} id resource ID (e.g. an valid UUID4)
 */
let deleteHandler = (req, body, res, resource, id) => {
  // TODO: validate ID here or send an event like 404 async?

  const payload = [{
    topic: COMMAND_TOPIC,
    messages: [buildCommand('delete' + contentTypes[resource].name, body, {id: id})]
  }];

  sendMessage(req, res, payload, data => {
    sendResponse(res, 200);
  });
};

let handler = {
  'POST': {callback: createHandler, patterns: [patternList]},
  'PUT': {callback: updateHandler, patterns: [patternSingle]},
  'DELETE': {callback: deleteHandler, patterns: [patternSingle]}
};


// SERVER =============================

// create HTTP server
let server = http
  .createServer()
  .listen(settings.ports.commandApi, settings.host, () => {
    console.log('Command REST API');
    console.log(`  URL: http://${settings.host}:${settings.ports.commandApi}`);
    console.log(`  PID: ${process.pid}`);
    console.log(`  RES: ${bases.join(', ')}\n`);
  });

// request handler
server.on('request', (req, res) => {

  // get body in chunks
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {

    let matches = null;

    // check patterns as defined for request method
    if (Object.keys(handler).indexOf(req.method) !== -1) {
      handler[req.method].patterns.forEach(pattern => {
        let patternMatch = req.url.match(pattern);
        if (patternMatch) {
          matches = patternMatch;
        }
      });
    }

    // log request
    console.log(`\x1b[37m${req.method} ${req.url}\x1b[0m`);

    // call handler for match, otherwise return bad request
    if (matches) {

      // try to parse body as JSON
      console.log(`  received body with ${body.length} bytes`);
      try {
        let bodyObject = JSON.parse(body);
        logJson(bodyObject);

        // validate request body
        validateRequest(req, bodyObject, matches[1] || null, result => {
          if (result === true) {
            handler[req.method].callback(req, bodyObject, res, matches[1] || null, matches[2] || null);
          } else {
            sendResponse(res, 400, result);
          }
        });

      } catch (e) {
        sendResponse(res, 400, e.message);
      }

    } else {
      sendResponse(res, 400, 'Unsupported method or URL pattern');
    }

  });

});

// start-up error handler
server.on('error', err => {
  console.error(`Could not create server: ${err.message}`);
  process.exit(1);
});

// graceful shutdown
let shutdown = () => {
  console.log('\nShutting down ...');
  server.close();
  process.exit(0);
};

process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
