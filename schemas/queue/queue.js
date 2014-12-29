var f = require('util').format;

/*
 * Represents a work item from the queue
 */
var Work = function(queue, doc) {
  this.queue = queue;
  this.doc;
}

/*
 * Sets an end time on the work item signaling it's done
 */
Work.prototype.done = function(callback) {
  var self = this;
  // Set end time for the work item
  this.queue.updateOne({
    _id: this.doc._id
  }, {
    $set: { endTime: new Date() }
  }, function(err, r) {
    if(err) return callback(err);
    if(r.result.nModified == 0) return callback(new Error(f('failed to set work item with id %s to done', self.doc._id)));
    callback(null, self);
  })
}

/*
 * Represents a Queue
 */
var Queue = function(db, name) {
  this.db = db;
  this.name = name;
  this.queue = db.collection('queue');  
}

/*
 * Push a new item on the queue with a specific priority
 */
Queue.prototype.push = function(priority, object, callback) {
  var self = this;
  // Insert the new item into the queue
  this.queue.insertOne({
      name: this.name
    , startTime: null
    , endTime: null
    , createdOn: new Date()
    , priority: priority
    , payload: object
  }, function(err, r) {
    if(err) return callback(err);
    callback(null, self);
  });
}

/*
 * Fetch the next highest available priority item
 */
Queue.prototype.fetchByPriority = function(callback) {
  var self = this;
  // Find one and update, returning a work item
  this.queue.findOneAndUpdate({
    startTime: null
  }, {
    $set: { startTime, new Date() }
  }, {
    sort: {priority: -1}
  }, function(err, r) {
    if(err) return callback(err);
    callback(null, new Work(self.queue, r.value));
  });
}

/*
 * Fetch the next item in FIFO fashion (by createdOn timestamp)
 */
Queue.prototype.fetchFIFO = function(callback) {  
  var self = this;
  // Find one and update, returning a work item
  this.queue.findOneAndUpdate({
    startTime: null
  }, {
    $set: { startTime, new Date() }
  }, {
    sort: { createdOn: 1 }
  }, function(err, r) {
    if(err) return callback(err);
    callback(null, new Work(self.queue, r.value));
  });
}