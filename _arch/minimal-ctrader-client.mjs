const grpc = import('@grpc/grpc-js');
const protoLoader = import('@grpc/proto-loader');
const path = import('path');

// Load the protobuf definitions
const PROTO_PATH = path.join(__dirname, 'OpenApiService.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [__dirname], // Ensure all imported .proto files are in the same directory
});
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const protoApi = protoDescriptor.proto_api;

// Replace with your actual clientId and clientSecret
const clientId = 'YOUR_CLIENT_ID';
const clientSecret = 'YOUR_CLIENT_SECRET';

// Choose the appropriate server: demo or live
const serverAddress = 'demo.ctraderapi.com:5035'; // Use 'live.ctraderapi.com:5035' for live trading

// Create a new gRPC client
const client = new protoApi.OpenApi(
  serverAddress,
  grpc.credentials.createSsl()
);

// Function to open the receiveMessage stream
function openReceiveMessageStream() {
  const call = client.receiveMessage({}, {});

  call.on('data', (message) => {
    console.log('📥 Received message:', message);

    // Handle authentication response
    if (message.payloadType === 2101) {
      console.log('✅ Authentication successful.');
    } else if (message.payloadType === 2105) {
      console.error('❌ Authentication failed.');
    } else {
      console.log('ℹ️ Received other message type:', message.payloadType);
    }
  });

  call.on('error', (error) => {
    console.error('❌ Stream error:', error);
  });

  call.on('end', () => {
    console.log('📴 Stream ended.');
  });

  return call;
}

// Function to send the ApplicationAuthReq message
function sendAuthentication() {
  // Construct the payload for ProtoOAApplicationAuthReq
  const authPayload = {
    clientId: clientId,
    clientSecret: clientSecret,
  };

  // Serialize the payload
  const payloadBuffer = Buffer.from(JSON.stringify(authPayload));

  // Construct the ProtoMessage
  const message = {
    payloadType: 2100, // ProtoOAApplicationAuthReq
    payload: payloadBuffer,
    clientMsgId: 'auth_1',
  };

  // Send the message
  client.sendMessage(message, (error, response) => {
    if (error) {
      console.error('❌ sendMessage error:', error);
    } else {
      console.log('📤 Sent authentication request:', response);
    }
  });
}

// Main function to initiate the process
function main() {
  console.log('🚀 Starting cTrader Open API client...');

  // Step 1: Open the receiveMessage stream
  openReceiveMessageStream();

  // Step 2: Send the authentication request after a short delay to ensure the stream is ready
  setTimeout(() => {
    sendAuthentication();
  }, 1000);
}

main();
