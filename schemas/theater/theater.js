"use strict";

var f = require('util').format
  , ObjectID = require('mongodb').ObjectID
  , Session = require('./session');

/*
 * Create a new theater instance
 */
var Theater = function(collections, id, name, seats) {
  this.id = id == null ? new ObjectID() : id;
  this.collections = collections;
  this.name = name;
  this.seats = seats;
  this.theaters = collections['theaters'];
  this.sessions = []; 
}

/*
 *  Create a new theater instance
 */
Theater.prototype.create = function(callback) {
  var self = this;
  var seatsAvailable = 0;
  for(var i = 0; i < this.seats.length; i++) {
    seatsAvailable += this.seats[i].length;
  }

  // Theater
  var theater = {
      _id: this.id
    , name: this.name
    , seats: this.seats
    , seatsAvailable: seatsAvailable
  }

  // Save the document
  this.theaters.insertOne(theater, function(err, r) {
    if(err) return callback(err);
    callback(null, self);
  });
}

/*
 *  Add a new screening session to the theater
 */
Theater.prototype.addSession = function(name, description, start, end, price, callback) {
  var self = this;
  
  // Create a new session
  var session = new Session(this.collections, new ObjectID(), this.id, name, description, start, end, price);
  session.create(function(err, session) {
    if(err) return callback(err);
    self.sessions.push(session);
    callback(null, session);
  });
}

module.exports = Theater;