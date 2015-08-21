var f = require('util').format
  , dnode = require('dnode')
  , co = require('co')
  , os = require('os')
  , Services = require('./services');

var performSetups = function(self, schemas, callback) {
  console.log(f("[AGENT-%s:%s] peforming per process setups", os.hostname(), self.argv.p));

  // Number of scenarios left
  var left = schemas.length;
  var errors = [];

  // Execute the global schema setup
  var setupSchema = function(schema) {
    console.log(f('[AGENT] execute local scenario setup for scenario %s %s', schema.name, JSON.stringify(schema.params)));
    // Fetch the scenario class
    var object = self.manager.find(schema.name);
    // No scenario found return an error
    if(!object) return callback(new Error(f('could not find scenario instance for %s', schema.name)));

    // Validate that all paramters are valid
    for(var name in schema.params) {
      if(!object.params[name]) return callback(new Error(f('scenario %s does not support the parameter %s', schema.name, name)));
    }

    // Return the promise
    return new Promise(function(resolve, reject) {
      co(function*() {
        // Create the object
        object = object.create(self.services, schemas, schema);
        // The actual object
        schema.object = object;
        // Initiate an instance and call it
        yield object.setup(callback);
        resolve();
      }).catch(function(err) {
        reject(err);
      });
    });
  }

  // Return the promise
  return new Promise(function(resolve, reject) {
    co(function*() {
      // Iterate over all the schemas
      for(var i = 0; i < schemas.length; i++) {
        try {
          yield setupSchema(schemas[i]);
        } catch(err) {

          errors.push(err);
        }
      }

      if(errors.length > 0) return reject(errors);
      resolve();
    }).catch(function(err) {
      reject(err);
    });
  });
}

var executePlan = function(self, remote, schemas, schema) {
  // The actual schema execution function
  var object = schema.object;
  // Get the plan we are executing against the schema
  var distribution = schema.execution;

  // Actual fields
  var type = distribution.type || 'linear';
  // The timing resolution to start another run of iteractions in milliseconds
  var resolution = distribution.resolution || 1000;
  // Number of iterations to run for load test
  var iterations = distribution.iterations || 25;
  // Number of users in each iteration
  var numberOfUsers = distribution.numberOfUsers || 100;
  // Any delay specified before executing the plan
  var delay = typeof distribution.delay == 'number' ? distribution.delay : 0;
  // The way we execute the users in the allocated time (when to start)
  var tickExecutionStrategy = distribution.tickExecutionStrategy || 'slicetime';
  var errors = [];

  // Only support for the linear type
  if(type != 'linear') return callback([new Error('only linear distribution supported')]);
  // Return the promise
  return new Promise(function(resolve, reject) {
    co(function*() {
      // console.log("----------------------- ++++++++++++++ 0")
      // Return the number of items we are executing in total
      remote.setup({totalExecutions: iterations * numberOfUsers}, function() {
        // console.log("----------------------- ++++++++++++++ 1")
        // Calculate the number of users in each milisecond
        var numberOfUsersPrMilisecond = numberOfUsers/resolution;
        var totalTicksLeft = iterations * resolution;
        var totalOpsLeft = iterations * resolution;
        // If we have less than a user a milisecond this keeps track of when to execute a user
        var currentUser = 0;

        // Set up exection method
        var executionMethod = typeof object.custom != 'function' ? 'execute' : 'custom';

        // We have a custom function
        var executeUser = function() {
          totalTicksLeft = totalTicksLeft - 1;
          var numberOfExecutions = 0;

          // Add to the current user
          if(numberOfUsersPrMilisecond < 1) {
            currentUser = currentUser + numberOfUsersPrMilisecond;
            if(currentUser >= 1) {
              currentUser = 0;
              numberOfExecutions = 0;
            }
          } else {
            numberOfExecutions = Math.round(numberOfUsersPrMilisecond);
          }

          co(function*() {
            totalOpsLeft = totalOpsLeft - 1;

            for(var i = 0; i < numberOfExecutions; i++) {
              // Execute the user
              try {
                yield object[executionMethod]();
              } catch(err) {
                errors.push(err);
              }
            }

            // Signal monitor that we have finished a piece of work
            remote.tick(function() {
              // Are we done ?
              if(totalOpsLeft == 0) {
                if(errors.length > 0) return reject(errors);
                resolve();
              }
            });

            if(totalOpsLeft > 0) {
              setTimeout(executeUser, 1);
            }
          });
        }

        // Execute the user
        executeUser();
      });

      // // Calculate the elapsed time between each user, ensure it's not 0
      // var timeBetweenEachUser = Math.round(resolution/numberOfUsers);
      // var iterationsLeft = iterations;
      // var totalLeft = iterations * numberOfUsers;
      // var totalOpsLeft = iterations * numberOfUsers;
      //
      // // Start the execution
      // if(typeof object.custom != 'function'
      //   && tickExecutionStrategy == 'slicetime') {
      //   // Execute the toal number of operations left to do
      //   var executeUser = function() {
      //     totalLeft = totalLeft - 1;
      //
      //     // Execute the user
      //     object.execute(function(err) {
      //       if(err) errors.push(err);
      //       totalOpsLeft = totalOpsLeft - 1;
      //
      //       // Signal monitor that we have finished a piece of work
      //       remote.tick(function() {
      //         // Are we done ?
      //         if(totalOpsLeft == 0) {
      //           callback(errors.length > 0 ? errors : null);
      //         }
      //       });
      //     });
      //
      //     if(totalLeft == 0) return;
      //     setTimeout(executeUser, timeBetweenEachUser);
      //   }
      //
      //   // Execute any delay
      //   setTimeout(function() {
      //     setTimeout(executeUser, timeBetweenEachUser);
      //   }, delay);
      // } else if(typeof object.custom == 'function') {
      //   // Execute any delay
      //   setTimeout(function() {
      //     // We have a custom execution plan in the scenario
      //     // useful for a case like listening to topics
      //     object.custom(remote, totalOpsLeft, callback);
      //   }, delay);
      // }
    }).catch(function(err) {
      reject(err);
    });
  });
}

var execute = function(self, schemas) {
  console.log(f("[AGENT-%s:%s] starting execution of plan against scenarios", os.hostname(), self.argv.p));

  // Number of scenarios left to execute
  var left = schemas.length;
  var errors = [];

  // Return the promise
  return new Promise(function(resolve, reject) {
    co(function*() {
      // Execute the plans
      for(var i = 0; i < schemas.length; i++) {
        try {
          yield executePlan(self, self.monitor, schemas, schemas[i]);
        } catch(err) {
          console.log(err.stack)
          errors.push(err);
        }
      }

      // Finished reset state of agent
      self.state = 'init';
      // Callback
      if(errors.length > 0) return reject(errors);
      resolve();
    }).catch(function(err) {
      reject(err);
    });
  });
}

var callerror = function(self, err) {
  self.monitor.error(err, function() {});
}

var calldone = function(self, schemas, callback) {
  // Return the promise
  return new Promise(function(resolve, reject) {
    co(function*() {
      self.monitor.done({
          host: os.hostname()
        , port: self.argv.p
        , schemas: schemas
      }, callback);
    }).catch(function(err) {
      reject(err);
    });
  });
}

/*
 * Represents a child process running
 */
var Process = function(manager, argv) {
  this.manager = manager;
  this.argv = argv;
  this.state = 'init';
  this.debug = this.argv.debug;
}

Process.prototype.setMonitor = function(monitor) {
  this.monitor = monitor;
  // Contains all the services we can use from
  // our scenarios
  this.services = new Services(this.argv, this.manager, monitor);
}

Process.prototype.execute = function(schemas, options, callback) {
  var self = this;
  // Set child running
  this.state = 'running';

  // Locate all the scenarios we need and execute the setup plan
  var scenarios = [];

  // Get all the schemas
  for (var i = schemas.length - 1; i >= 0; i--) {
    var schema = schemas[i];
    // Attempt to locate the scenario
    var object = this.manager.find(schema.name);
    // Add to the list of scenarios if it's available
    if(schema != null) {
      console.log(f('[AGENT-%s:%s] located scenario %s', os.hostname(), this.argv.p, schema.name));
      scenarios.push({
          schema: schema
        , scenario: object
      });
    } else if(schema == null) {
      console.log(f('[AGENT-%s:%s] failed to locate scenario %s', os.hostname(), this.argv.p, schema.name));
    }
  };

  console.log(f('[AGENT-%s:%s] starting process setup of scenarios', os.hostname(), self.argv.p));
  // Return the promise
  return new Promise(function(resolve, reject) {
    co(function*() {
      // Perform the needed setup of the schemas
      yield performSetups(self, schemas)
      console.log(f('[AGENT-%s:%s] starting execution of scenarios', os.hostname(), self.argv.p));

      // Execute a scenario
      var executeScenario = function(_self, _schemas, _callback) {
        // Return the promise
        return new Promise(function(resolve, reject) {
          co(function*() {
            yield execute(_self, _schemas);
            console.log(f('[AGENT-%s:%s] finished execution of scenarios', os.hostname(), _self.argv.p));
            // Signal done
            yield calldone(_self, _schemas);
            console.log(f('[AGENT-%s:%s] notified monitor that agent finished', os.hostname(), _self.argv.p));
            resolve();
          }).catch(function(err) {
            callerror(_self, err);
            reject(err);
          });
        });
      }

      // Execute the scenario
      yield executeScenario(self, schemas, callback);
      resolve();
    }).catch(function(err) {
      callerror(self, new Error('failed to execute process setups for scenarios'));
      reject(err);
    });
  });
}

Process.prototype.isRunning = function() {
  return this.state == 'running';
}

module.exports = Process;