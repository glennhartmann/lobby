/**
 * Lobby server providing game listings for aribtrary games.
 */
var WebSocket = require('ws');
var WebSocketServer = WebSocket.Server;

exports.Server = function() {

  var Server = function(port) {
    this.sessions = [];
    this.nextId_ = 1;
    this.webSocketServer_ = new WebSocketServer({ 'port': port });
    this.webSocketServer_.on('connection', this.onConnection_.bind(this));
    console.log('Listening on ' + port);
  };

  Server.prototype = {

    /**
     * Returns the next game id.
     *
     * @return {String} The next game identifier to be used.
     */
    getNextId_: function() {
      // TODO(flackr): Investigate re-using ids.
      return (this.nextId_++).toString();
    },

    /**
     * Dispatched when a client connects to a websocket.
     *
     * @param {WebSocket} websocket A connected websocket client connection.
     */
    onConnection_: function(websocket) {
      console.log('connection for ' + websocket.upgradeReq.url);
      var self = this;
      if (websocket.upgradeReq.url == '/new') {
        this.createHost_(websocket);
        return;
      }
      this.connectClient_(websocket);
    },

    /**
     * Connect client on |websocket| to host specified by connection url.
     *
     * @param {WebSocket} websocket A connected websocket client connection.
     */
    connectClient_: function(websocket) {
      var self = this;
      var sessionId = websocket.upgradeReq.url.substr(1);
      var session = this.sessions[sessionId];
      if (!session) {
        console.log("Client attempted to connect to invalid sessionId "+sessionId);
        // TODO(flackr): Investigate generating this error before upgrading to
        // a websocket. (http://nodejs.org/api/http.html#http_http_createserver_requestlistener)
        websocket.send(JSON.stringify({'error': 404}));
        websocket.close();
        return;
      }

      var clientId = session.nextClientId++;
      session.clients[clientId] = {
        'socket': websocket
      };
      console.log("Client " + clientId + " attempting to connect to session " + sessionId);
      websocket.on('message', function(message) {
        if (!session) {
          console.log("Client attempted to deliver a message on ended session.");
          websocket.send(JSON.stringify({'error': 404}));
          websocket.close();
          return;
        }
        var data = null;
        try {
          // Do not double JSON.stringify
          data = JSON.parse(message);
        } catch (err) {
        }
        if (data !== null) {
          session.socket.send(JSON.stringify({'client': clientId, 'type': data.type, 'data': data.data}));
        } else {
          console.log("Client message is not JSON: " + message);
          websocket.close();
        }
      });
      websocket.on('close', function() {
        // TODO(flackr): Test if this is called sychronously when host socket
        // closes, if so remove.
        if (!self.sessions[self.sessionId])
          return;
        session.socket.send(JSON.stringify({
          'client': clientId,
          'type': 'close'}));
        delete session.clients[clientId];
        session.clients[clientId] = undefined;
      })
    },

    /**
     * Create a new session host accepting connections through signaling socket
     * |websocket|.
     *
     * @param {WebSocket} websocket A connected websocket client connection.
     */
    createHost_: function(websocket) {
      var self = this;
      var sessionId = this.getNextId_();
      console.log('Created session ' + sessionId);
      var session = this.sessions[sessionId] = {
        'socket': websocket,
        'clients': {},
        'nextClientId': 1
      };
      websocket.on('message', function(message) {
        var data;
        try {
          data = JSON.parse(message);
        } catch (err) {
          websocket.close();
          return;
        }
        var clientId = data.client;
        var client = session.clients[clientId];
        if (!client) {
          websocket.send(JSON.stringify({
            'error': 0,
            'message': 'Client does not exist.'}));
          return;
        }
        client.socket.send(JSON.stringify({'type':data.type, 'data':data.data}));
      });
      websocket.on('close', function() {
        console.log("Session " + sessionId + " ended, disconnecting clients.");
        for (var clientId in session.clients) {
          // Server went away while client was connecting.
          if (session.clients[clientId].socket.readyState != WebSocket.OPEN)
            continue;
          session.clients[clientId].socket.send(JSON.stringify({'error': 404}));
          session.clients[clientId].socket.close();
        }
        delete self.sessions[sessionId];
        self.sessions[sessionId] = undefined;
      });
      websocket.send(JSON.stringify({'host': sessionId}));
    },

    /**
     * Shuts down the signaling server for game sessions.
     */
    shutdown: function() {
      this.webSocketServer_.close();
    },

  };

  return Server;
}();
