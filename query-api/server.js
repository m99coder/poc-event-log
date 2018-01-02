#!/usr/bin/env node

// DEPENDENCIES =======================

const fs = require('fs');
const http = require('http');


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


// HANDLER ============================

/**
 * handler for getting resources (GET method)
 * @param {Request} req received request
 * @param {Response} res response to send
 * @param {String} resource resource type identifier (e.g. "entries", "assets", ...)
 */
let getHandler = (req, res, resource) => {
  // TODO: implement
  sendResponse(res, 200);
};

let handler = {
  'GET': {callback: getHandler, patterns: [patternList, patternSingle]}
};


// SERVER =============================

// create HTTP server
let server = http
  .createServer()
  .listen(settings.ports.queryApi, settings.host, () => {
    console.log('Query REST API');
    console.log(`  URL: http://${settings.host}:${settings.ports.queryApi}`);
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
      handler[req.method].callback(req, res, matches[1] || null, matches[2] || null);
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
