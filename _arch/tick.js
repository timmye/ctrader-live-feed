require('dotenv').config();
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// List of .proto files in the /protos directory.
const protoFiles = [
  'C:/Users/tim_n/ctrader-live-feed/protos/OpenApiCommonMessages.proto',
  'C:/Users/tim_n/ctrader-live-feed/protos/OpenApiCommonModelMessages.proto',
  'C:/Users/tim_n/ctrader-live-feed/protos/OpenApiMessages.proto',
  'C:/Users/tim_n/ctrader-live-feed/protos/OpenApiModelMessages.proto'
];

// Load protobuf definitions.
const packageDefinition = protoLoader.loadSync(protoFiles, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const proto = grpc.loadPackageDefinition(packageDefinition);
const credentials = grpc.credentials.createInsecure();
const clientId = process.env.CTRADER_CLIENT_ID;
const accountId = parseInt(process.env.CTRADER_ACCOUNT_ID, 10); // Ensure it's a number.
// Define a function to fetch tick prices.
function getTickPrices(client) {
  const request = {
    clientId,
    accountId,
    symbolId: 123456789, // Update with an actual symbol ID if known.
    type: 'ProtoOAQuoteType.BID' // Replace with the correct enum value.
  };

  client.getTickData(request, (err, response) => {
    if (!err) {
      console.log('Received tick data:', response);
    } else {
      console.error('Error receiving tick prices:', err);
    }
  });
}

// Create a new gRPC client.
const client = new proto.openapi.model.messages.Trading('localhost:5035', credentials); // Update with the correct service if needed.

// Wait for the client to be ready.
client.waitForReady(10000, (err) => {
  if (!err) {
    getTickPrices(client);
  } else {
    console.error('Failed to connect to server:', err);
  }
});