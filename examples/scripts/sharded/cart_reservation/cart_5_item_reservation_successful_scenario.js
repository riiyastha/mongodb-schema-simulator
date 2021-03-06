// Definition of the fields to execute
module.exports = [{
  // Name of the schema
  name: 'cart_reservation_successful',
  
  // Set the collection name for the carts
  collections: {
      carts: 'carts'
    , products: 'products'
    , inventories: 'inventories'
    , order: 'orders'
  },

  // Parameters
  params: {
      numberOfItems: 5
    , numberOfProducts: 1000
    , sizeOfProductsInBytes: 1024
  },

  // Run against specific db
  db: 'shop',

  // Setup function (run before the scenario is executed)
  // used to allow doing stuff like setting up the sharded collection
  // etc.
  setup: function(db, callback) {
    // Drop the database
    db.dropDatabase(function(err, r) {
      if(err) return callback(err);

      // Enable the sharding of the database
      db.admin().command({enableSharding:'shop'}, function(err, r) {
        if(err) return callback(err);

        // Shard the collections we want
        db.admin().command({shardCollection: 'shop.carts', key: {_id:'hashed'}}, function(err, r) {
          if(err) return callback(err);
          callback();
        });
      });
    });
  },

  //
  // Execution plan is run using all the process.openStdin();
  execution: {
    // Number of ticks/iterations we are running
      iterations: 100
    // Number of users starting the op at every tick
    , numberOfUsers: 500
  }
}];