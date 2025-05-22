require("dotenv").config();
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");
const fs = require('fs');
const https = require('https');

// TLS configuration - UNCOMMENT ONE of these if needed
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // Temporarily disable certificate validation for troubleshooting
// process.env.GRPC_SSL_CIPHER_SUITES = 'HIGH+ECDSA'; 

// Enable detailed logging
process.env.GRPC_TRACE = "all";
process.env.GRPC_VERBOSITY = "DEBUG";

// Force native DNS resolver
process.env.GRPC_DNS_RESOLVER = "native";

// Path configurations
const PROTO_PATH = path.join(__dirname, "protos", "OpenApiService.proto");
const ROOTS_PATH = path.join(__dirname, "roots.pem");

// Download root certificates if needed
async function ensureRootCertificates() {
  console.log("Ensuring root certificates exist...");
  
  if (!fs.existsSync(ROOTS_PATH) || fs.statSync(ROOTS_PATH).size === 0) {
    console.log("Root certificates missing or empty, downloading...");
    
    // Create Mozilla's CA certificate bundle
    return new Promise((resolve, reject) => {
      https.get('https://curl.se/ca/cacert.pem', (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to download certificates, status code: ${res.statusCode}`));
          return;
        }
        
        const fileStream = fs.createWriteStream(ROOTS_PATH);
        res.pipe(fileStream);
        
        fileStream.on('finish', () => {
          console.log("Root certificates downloaded successfully");
          fileStream.close();
          resolve();
        });
        
        fileStream.on('error', (err) => {
          fs.unlink(ROOTS_PATH, () => {});
          reject(err);
        });
      }).on('error', (err) => {
        reject(err);
      });
    });
  } else {
    console.log("Root certificates already exist");
    return Promise.resolve();
  }
}

// Validate environment variables
function validateEnv() {
  const required = ['CTRADER_ACCESS_TOKEN', 'CTRADER_ACCOUNT_ID'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  console.log("Environment variables validated");
}

// Load proto files with proper options
function loadProtoDefinition() {
  console.log(`Loading proto definition from ${PROTO_PATH}`);
  
  try {
    // Check if proto file exists
    if (!fs.existsSync(PROTO_PATH)) {
      throw new Error(`Proto file not found at ${PROTO_PATH}`);
    }
    
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [path.dirname(PROTO_PATH)],
      arrays: true
    });
    
    const proto = grpc.loadPackageDefinition(packageDefinition);
    
    // Verify proto loaded correctly
    if (!proto.proto_api || !proto.proto_api.OpenApi) {
      throw new Error("Failed to load OpenApi service from proto definition");
    }
    
    console.log("Available services:", Object.keys(proto.proto_api || {}));
    return proto;
  } catch (error) {
    console.error("Failed to load proto definition:", error);
    throw error;
  }
}

// Create gRPC client with optimized options
function createClient(proto) {
  const host = "demo.ctraderapi.com";
  const port = 5035;
  const address = `${host}:${port}`;
  
  console.log(`Creating client for ${address}...`);
  
  // Set environment variable for root certificates
  process.env.GRPC_DEFAULT_SSL_ROOTS_FILE_PATH = ROOTS_PATH;
  
  // Create SSL credentials with proper options
  const sslCreds = grpc.credentials.createSsl();
  
  // Client options with improved error handling
  const clientOptions = {
    "grpc.ssl_target_name_override": host,
    "grpc.default_authority": host,
    "grpc.keepalive_time_ms": 30000,
    "grpc.keepalive_timeout_ms": 10000,
    "grpc.http2.min_time_between_pings_ms": 10000,
    "grpc.keepalive_permit_without_calls": 1,
    "grpc.max_receive_message_length": 10 * 1024 * 1024,
    "grpc.max_send_message_length": 10 * 1024 * 1024,
    "grpc.enable_retries": 1,
    "grpc.service_config": JSON.stringify({
      "methodConfig": [{
        "name": [{}],
        "retryPolicy": {
          "maxAttempts": 5,
          "initialBackoff": "1s",
          "maxBackoff": "10s",
          "backoffMultiplier": 2,
          "retryableStatusCodes": ["UNAVAILABLE"]
        }
      }]
    })
  };
  
  return new proto.proto_api.OpenApi(address, sslCreds, clientOptions);
}

// Message handling functions
function createMessage(payloadType, payload) {
  return {
    payloadType: payloadType,
    payload: payload
  };
}

async function sendMessage(client, messageType, data, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    
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

// Main streaming function with improved error handling
async function startStream(client) {
  try {
    console.log(`Connecting to cTrader API... (${new Date().toISOString()})`);
    
    // Authenticate
    console.log("Authenticating...");
    const authReq = {
      accessToken: process.env.CTRADER_ACCESS_TOKEN
    };
    
    console.log("Sending authentication request...");
    const authResp = await sendMessage(client, "PROTO_OA_CLIENT_AUTH_REQ", authReq);
    console.log("Authentication response:", authResp);
    console.log("✅ Authentication successful");

    // Subscribe to EURUSD (symbolId 1)
    console.log("Subscribing to EURUSD...");
    const subReq = {
      ctidTraderAccountId: parseInt(process.env.CTRADER_ACCOUNT_ID),
      symbolId: 1
    };
    
    console.log("Sending subscription request...");
    const subResp = await sendMessage(client, "PROTO_OA_SUBSCRIBE_SPOTS_REQ", subReq);
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
      console.error(`Stream error (${new Date().toISOString()}):`, err.code, err.details || err.message);
      console.log("Attempting to reconnect in 5 seconds...");
      setTimeout(() => startStream(client), 5000);
    });
    
    stream.on("end", () => {
      console.log(`Stream ended (${new Date().toISOString()}), attempting to reconnect...`);
      setTimeout(() => startStream(client), 5000);
    });
    
    console.log("Stream setup complete, waiting for messages...");

  } catch (error) {
    console.error(`❌ Error (${new Date().toISOString()}):`, error.message);
    console.log("Retrying in 5 seconds...");
    setTimeout(() => startStream(client), 5000);
  }
}

// Main function that orchestrates the entire process
async function main() {
  try {
    console.log(`Starting cTrader API client (${new Date().toISOString()})`);
    
    // Validate environment variables
    validateEnv();
    
    // Ensure root certificates exist
    await ensureRootCertificates();
    
    // Load proto definition
    const proto = loadProtoDefinition();
    
    // Create client
    const client = createClient(proto);
    
    // Start the stream
    await startStream(client);
    
  } catch (error) {
    console.error(`Fatal error (${new Date().toISOString()}):`, error);
    console.log("Exiting with error code 1");
    process.exit(1);
  }
}

// Start the application
main();