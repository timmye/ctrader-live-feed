const dotenv = require('dotenv');
dotenv.config();
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const PROTO_PATH = './protos/OpenApiCommonMessages.proto';
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const cTraderProto = grpc.loadPackageDefinition(packageDefinition);
function authenticateClient(callback) {
  const client = new cTraderProto.OpenClient('live.ctraderapi.com:5035', grpc.credentials.createInsecure());

  // Authenticate application
  const appAuthReq = {
    payloadType: 'PROTO_OA_APPLICATION_AUTH_REQ',
    payload: {
      clientId: process.env.CTRADER_CLIENT_ID,
      clientSecret: process.env.CTRADER_CLIENT_SECRET,
    },
  };

  client.connect((err) => {
    if (err) {
      console.error('Failed to connect:', err);
      callback(err, null);
      return;
    }

    // Send application auth request
    client.rpcCall(appAuthReq, (error, response) => {
      if (error) {
        console.error('Application authentication error:', error);
        callback(error, null);
        return;
      }

      const accountAuthReq = {
        payloadType: 'PROTO_OA_ACCOUNT_AUTH_REQ',
        payload: {
          ctidTraderAccountId: parseInt(process.env.CTRADER_ACCOUNT_ID),
          accessToken: process.env.CTRADER_ACCESS_TOKEN,
        },
      };

      // Send account auth request
      client.rpcCall(accountAuthReq, (error, response) => {
        if (error) {
          console.error('Account authentication error:', error);
          callback(error, null);
          return;
        }
        callback(null, client);
      });
    });
  });
}
function subscribeLiveTicks(client) {
  const subscribeReq = {
    payloadType: 'PROTO_OA_SUBSCRIBE_SPOTS_REQ',
    payload: {
      ctidTraderAccountId: parseInt(process.env.CTRADER_ACCOUNT_ID),
      symbolIds: [1], // Replace with actual symbol IDs
      subscribeToSpotTimestamp: true,
    },
  };

  client.rpcCall(subscribeReq, (error, response) => {
    if (error) {
      console.error('Subscription error:', error);
      return;
    }
    console.log('Subscribed successfully');

    // Listen to data from the server
    client.on('data', (message) => {
      const tickData = JSON.parse(message.payload.toString());
      console.log('Received live tick price:', tickData);
    });
  });
}

// Main Execution
authenticateClient((err, client) => {
  if (err) {
    console.error('Failed to authenticate:', err);
    return;
  }
  subscribeLiveTicks(client);
});