var f = require('util').format
  , fs = require('fs')
  , ejs = require('ejs')
  , RunningStats = require('../gnuplot/running_stats')
  , gnuplot = require('../gnuplot/gnuplot');


// var mergeLogEntries = function(logEntries1, logEntries2) {
//   for(var tag in logEntries2) {
//     if(logEntries1[tag] == null) {
//       logEntries1[tag] = logEntries2[tag];
//     } else {
//       // Iterate over all the timestamps
//       for(var timestamp in logEntries2[tag]) {
//         if(logEntries1[tag][timestamp] == null) {
//           logEntries1[tag][timestamp] = logEntries2[tag][timestamp];
//         } else {
//           logEntries1[tag][timestamp] = logEntries1[tag][timestamp].concat(logEntries2[tag][timestamp]);
//         }
//       }
//     }
//   }

//   return logEntries1;
// }

var generateOperations = function(self, name, data, callback) {
  console.log(f('[MONITOR] generating schema ops graph for %s', name));
  var keys = Object.keys(data);
  var points = [];
  // Filename
  var filename = f('%s/%s.png', self.argv.o, name);
  // Create a new line graph
  var graph = new gnuplot.Line({debug:self.argv.debug});
  graph.terminal('png');
  graph.output(filename);
  graph.xlabel('seconds');
  graph.ylabel('ops');
  graph.title(f('%s', name.replace(/\_/g, ' ')));
  graph.style('data linespoints');

  var labels = [];
  // Figure out the length and create the point array
  for(var i = 0; i < keys.length; i++) {
    labels.push(i);
  }
  // Add the labels
  graph.addData(labels);

  // Iterate over the data in each pocket
  for(var i = 0; i < keys.length; i++) {
    // Get the key
    var key = keys[i];
    // Add the count
    points.push(data[key].length);
  }

  // Add the points
  graph.addData(points);
  // Plot commands
  var lines = [];
  // Add the data
  lines.push(f('"-" using 1:2 title "%s"', name.replace(/\_/g, ' ')));
  // Set the plot commands
  graph.plotData(lines);
  graph.execute(function() {
    callback('schema', {
        name:name
      , path: filename
      , filename: f('%s.png', name)
    });
  });
}

var generateServerOperations = function(self, name, data, callback) {
  console.log(f('[MONITOR] generating server ops graph for %s', name));

  var keys = Object.keys(data);
  var points = [];

  // Get calibration point
  var calibrationKey = keys.shift();
  var firstMeasurments = data[calibrationKey];
  delete data[calibrationKey];

  // Create by host
  var readingByHost = {}
  for(var i = 0; i < firstMeasurments.length; i++) {
    readingByHost[firstMeasurments[i].host] = firstMeasurments[i];
  }

  // For all the data we need to adjust the readings based on the intial
  // reading
  for(var i = 0; i < keys.length; i++) {
    var measurements = data[keys[i]];
    var newMeasurments = [];

    // Adjust the measurments
    for(var j = 0; j < measurements.length; j++) {
      newMeasurments[j] = {
        "insert": measurements[j].insert - readingByHost[measurements[j].host].insert,
        "query": measurements[j].query - readingByHost[measurements[j].host].query,
        "update": measurements[j].update - readingByHost[measurements[j].host].update,
        "delete": measurements[j].delete - readingByHost[measurements[j].host].delete,
        "getmore": measurements[j].getmore - readingByHost[measurements[j].host].getmore,
        "command": measurements[j].command - readingByHost[measurements[j].host].command,
        "host": measurements[j].host
      }

      readingByHost[measurements[j].host] = measurements[j];
    }

    // Save the adjusted measurement
    data[keys[i]] = newMeasurments;
  }

  // Sum up all the results into a single set
  for(var i = 0; i < keys.length; i++) {
    var measurements = data[keys[i]];
    // Single measurement
    if(measurements.length == 1) break;
    // Sum up all the measurements
    var finalmeasure = measurements[0];
    // Add the values together
    for(var j = 1; j < measurements.length; j++) {
      finalmeasure.insert += measurements[j].insert;
      finalmeasure.query += measurements[j].query;
      finalmeasure.update += measurements[j].update;
      finalmeasure.delete += measurements[j].delete;
      finalmeasure.getmore += measurements[j].getmore;
      finalmeasure.command += measurements[j].command;
    }

    // Add the summed up value
    data[keys[i]] = [finalmeasure];
  }

  // Filename
  var filename = f('%s/%s.png', self.argv.o, name);
  // Create a new line graph
  var graph = new gnuplot.Line({debug:self.argv.debug});
  graph.terminal('png');
  graph.output(filename);
  graph.xlabel('seconds');
  graph.ylabel('ops');
  graph.title(f('processes: %s, concurrency: %s, runs: %s, engine: %s'
    , self.argv.n
    , ''
    , ''
    , ''));
  graph.style('data linespoints');

  var labels = [];
  // Figure out the length and create the point array
  for(var i = 0; i < keys.length; i++) {
    labels.push(i);
  }
  // Add the labels
  graph.addData(labels);
  // Lines rendered
  var count = 2;

  // Reformat the data based on ops type
  // var fields = Object.keys(data[keys[0]][0]);
  var fields = ['insert', 'query', 'update', 'delete', 'getmore', 'command'];
  var lines = [];

  // Iterate over all the fields
  for(var j = 0; j < fields.length; j++) {
    var n = fields[j];
    var entries = [];

    // Iterate over all the results
    for(var k = 0; k < keys.length; k++) {
      entries.push(data[keys[k]][0][n]);
    }

    graph.addData(entries);
  }

  // Create the descriptive lines
  for(var j = 0; j < fields.length; j++) {
    lines.push(f('"-" using 1:%s title "%s"', count++, fields[j]));
  }
  // Set the plot commands
  graph.plotData(lines);
  graph.execute(function() {
    callback('server', {
        name:name
      , path: filename
      , filename: f('%s.png', name)
    });
  });
}

/*
 * Generate report for the collected data
 */
var generateReport = function(self, logEntries, callback) {
  var count = Object.keys(logEntries).length;
  // All graph object
  var serverGraphs = [];
  var schemaGraphs = [];

  // Join up all generation
  var finish = function(type, data) {
    count = count - 1;

    // Save the returned data
    if(type == 'schema') schemaGraphs.push(data);
    if(type == 'server') serverGraphs.push(data);

    // We need to generate the actual report
    if(count == 0) {
      // Render the actual report
      renderHTMLReport(self, logEntries, schemaGraphs, serverGraphs, callback)
    }
  }

  // Go over all the values
  for(var name in logEntries) {
    console.log(f('[MONITOR] generating graph for %s', name));

    // Check what type of data it is
    var data = logEntries[name];
    var keys = Object.keys(data);

    // Check if we have a op time recording
    if(keys.length > 0 && data[keys[0]][0].start != null && data[keys[0]][0].end != null && data[keys[0]][0].time != null) {
      console.log(f('[MONITOR] generating ops graph for %s', name));
      generateOperations(self, name, data, finish);
    } else if(keys.length > 0 && data[keys[0]][0].insert != null && data[keys[0]][0].update != null && data[keys[0]][0].query != null) {
      console.log(f('[MONITOR] generating server ops graph for %s', name));
      generateServerOperations(self, name, data, finish);
    } else {
      callback(new Error(f('did not receive compatible data %s', JSON.stringify(data[keys[0]][0]))))
    }
  }
}

/*
 * Render the HTML report
 */
var renderHTMLReport = function(self, logEntries, schemaGraphs, serverGraphs, callback) {
  // Load the template
  var template = fs.readFileSync(__dirname + "/./reports/html_report.ejs", 'utf8');

  // Statistics
  var statistics = {};

  // Get the statistics for all series not server ops
  for(var name in logEntries) {
    if(name == 'server_monitoring') continue;
    // Add a statistical calculation
    statistics[name] = new RunningStats();
    // Get timestamp measurements
    for(var time in logEntries[name]) {
      for(var i = 0; i < logEntries[name][time].length; i++) {
        statistics[name].push(logEntries[name][time][i].time);
      }
    }
  }

  // Read the schema
  var scenario = self.scenario;
  var schemas = {};

  // Pick out the runtime statistics
  for(var i = 0; i < scenario.schemas.length; i++) {
    var schema = scenario.schemas[i];
    schemas[schema.schema.name] = schema.execution.distribution;
  }

  // Render it with the passed in values
  var result = ejs.render(template, {
      entries: logEntries
    , schemaGraphs: schemaGraphs
    , serverGraphs: serverGraphs
    , title: self.argv.s
    , statistics: statistics
    , runtime: {
        processes: self.argv.n
        // Schemas
      , schemas: schemas
    }
  });

  // Write out to the output directory
  fs.writeFileSync(f('%s/index.html', self.argv.o), result, 'utf8');
  // We are done
  callback();
}

var BasicReport = function(monitor, filename) {
  this.monitor = monitor;
  this.filename = filename;
}

BasicReport.prototype.execute = function(callback) {
  // Read the report in
  var report = JSON.parse(fs.readFileSync(this.filename, 'utf8'))



  console.log("----------------- BasicReport")
  console.dir(report)
  callback();
}

module.exports = BasicReport;