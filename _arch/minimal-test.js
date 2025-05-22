require("dotenv").config();
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");

// Add this to fix potential TLS issues - if needed uncomment one of these lines
// process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // Disables certificate validation (use only for testing)
// process.env.GRPC_SSL_CIPHER_SUITES = 'HIGH+ECDSA'; // Force higher security cipher suites

// Set buffer sizes - sometimes needed for gRPC
process.env.GRPC_DEFAULT_SSL_ROOTS_FILE_PATH = path.join(__dirname, "roots.pem");
process.env.GRPC_TRACE = "all"; // Enable all gRPC tracing
process.env.GRPC_VERBOSITY = "DEBUG"; // Set gRPC verbosity

// Explicitly set the DNS resolver to avoid IPv6 issues on Windows
process.env.GRPC_DNS_RESOLVER = "native";

// Use path.join for cross-platform compatibility with file paths
const PROTO_PATH = path.join(__dirname, "protos", "OpenApiService.proto");

// 1. Load proto files - with more specific options
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [path.join(__dirname, "protos")],
  arrays: true
});

// 2. Load package definition
const proto = grpc.loadPackageDefinition(packageDefinition);

// Verify proto loaded correctly
console.log("Available services:", Object.keys(proto.proto_api || {}));

// 3. Create client with explicit options for Windows compatibility
const clientOptions = {
  "grpc.ssl_target_name_override": "demo.ctraderapi.com", // Important for Windows
  "grpc.default_authority": "demo.ctraderapi.com", // Important for Windows
  "grpc.keepalive_time_ms": 30000,
  "grpc.keepalive_timeout_ms": 10000,
  "grpc.http2.min_time_between_pings_ms": 10000,
  "grpc.keepalive_permit_without_calls": 1,
  "grpc.max_receive_message_length": 10 * 1024 * 1024, // 10MB
  "grpc.max_send_message_length": 10 * 1024 * 1024     // 10MB
};

// Create SSL credentials with proper options
const sslCreds = grpc.credentials.createSsl();

// Create client with host/port separated for clarity
const host = "demo.ctraderapi.com";
const port = 5035;
const address = `${host}:${port}`;

console.log(`Creating client for ${address}...`);
const client = new proto.proto_api.OpenApi(address, sslCreds, clientOptions);

// Set timeout for operations
const TIMEOUT = 30000; // 30 seconds

// 4. Message handling functions
function createMessage(payloadType, payload) {
  return {
    payloadType: payloadType,
    payload: payload
  };
}

async function sendMessage(messageType, data) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + TIMEOUT;
    
    console.log(`Sending ${messageType}...`);
    client.sendMessage(createMessage(messageType, data), { deadline }, (err, response) => {
      if (err) {
        console.error(`Error sending ${messageType}:`, err.code, err.details || err.message);
        reject(err);
      } else {
        console.log(`Successfully sent ${messageType}`);
        resolve(response);
      }
    });
  });
}

// 5. Main streaming function
async function startStream() {
  try {
    console.log("Connecting to cTrader API...");
    
    // Authenticate with explicit handler for logging
    console.log("Authenticating...");
    
    const authReq = {
      accessToken: process.env.CTRADER_ACCESS_TOKEN
    };
    
    console.log("Sending authentication request...");
    const authResp = await sendMessage("PROTO_OA_CLIENT_AUTH_REQ", authReq);
    console.log("Authentication response:", authResp);
    console.log("✅ Authentication successful");

    // Subscribe to EURUSD (symbolId 1)
    console.log("Subscribing to EURUSD...");
    const subReq = {
      ctidTraderAccountId: parseInt(process.env.CTRADER_ACCOUNT_ID),
      symbolId: 1
    };
    
    console.log("Sending subscription request...");
    const subResp = await sendMessage("PROTO_OA_SUBSCRIBE_SPOTS_REQ", subReq);
    console.log("Subscription response:", subResp);
    console.log("✅ Subscribed to EURUSD ticks");

    // Start receiving messages
    console.log("Starting stream...");
    const stream = client.receiveMessage({});
    
    // Add additional logging for stream events
    console.log("Stream created, setting up event handlers...");
    
    stream.on("data", (message) => {
      if (message.payloadType === "PROTO_OA_SPOT_EVENT") {
        const spot = message.payload;
        console.log(`💹 ${spot.symbolName || 'EURUSD'} | Bid: ${spot.bidPrice} | Ask: ${spot.askPrice}`);
      } else {
        console.log(`Received message type: ${message.payloadType}`);
      }
    });

    stream.on("error", (err) => {
      console.error("Stream error:", err.code, err.details || err.message);
      console.log("Attempting to reconnect in 5 seconds...");
      setTimeout(() => startStream(), 5000);
    });
    
    stream.on("end", () => {
      console.log("Stream ended, attempting to reconnect...");
      setTimeout(() => startStream(), 5000);
    });
    
    console.log("Stream setup complete, waiting for messages...");

  } catch (error) {
    console.error("❌ Error:", error.message);
    console.log("Retrying in 5 seconds...");
    setTimeout(() => startStream(), 5000);
  }
}

// Create empty roots.pem file if it doesn't exist
const fs = require('fs');
if (!fs.existsSync(path.join(__dirname, "roots.pem"))) {
  fs.writeFileSync(path.join(__dirname, "roots.pem"), "");
}

// Start the application
console.log(`Starting cTrader API client (${new Date().toISOString()})`);
startStream();