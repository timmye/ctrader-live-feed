require("dotenv").config();
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const { promisify } = require("util");

// 1. Load proto files
const packageDefinition = protoLoader.loadSync([
  "./protos/OpenApiService.proto",
  "./protos/OpenApiMessages.proto",
  "./protos/OpenApiModelMessages.proto"
], {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [__dirname + "/protos"]
});

// 2. Load package definition
const proto = grpc.loadPackageDefinition(packageDefinition);

// Debug: Check available services
console.log("Available services:", Object.keys(proto));

// 3. Create client (using correct namespace)
const client = new proto.proto_api.OpenApi(
  "ctraderapi.com:5035",
  grpc.credentials.createSsl()
);

// 4. Message handling functions
function createMessage(MessageType, payload) {
  const msg = new MessageType();
  Object.keys(payload).forEach(key => {
    msg[key] = payload[key];
  });
  return msg;
}

async function sendMessage(payloadType, payload, MessageType) {
  const message = createMessage(proto.proto_api.ProtoMessage, {
    payloadType,
    payload: MessageType.encode(payload).finish()
  });
  
  return new Promise((resolve, reject) => {
    client.sendMessage(message, (err, response) => {
      if (err) reject(err);
      else resolve(response);
    });
  });
}

// 5. Main streaming function
async function startStream() {
  try {
    // Authenticate
    const authReq = createMessage(proto.proto_api.ProtoOAClientAuthReq, {
      accessToken: process.env.CTRADER_ACCESS_TOKEN
    });
    
    await sendMessage("PROTO_OA_CLIENT_AUTH_REQ", authReq, proto.proto_api.ProtoOAClientAuthReq);
    console.log("✅ Authentication successful");

    // Subscribe to EURUSD (symbolId 1)
    const subReq = createMessage(proto.proto_api.ProtoOASubscribeSpotsReq, {
      ctidTraderAccountId: parseInt(process.env.CTRADER_ACCOUNT_ID),
      symbolId: 1
    });
    
    await sendMessage("PROTO_OA_SUBSCRIBE_SPOTS_REQ", subReq, proto.proto_api.ProtoOASubscribeSpotsReq);
    console.log("✅ Subscribed to EURUSD ticks");

    // Start receiving messages
    const stream = client.receiveMessage({});
    stream.on("data", (message) => {
      if (message.payloadType === "PROTO_OA_SPOT_EVENT") {
        const spot = proto.proto_api.ProtoOASpotEvent.decode(message.payload);
        console.log(`💹 ${spot.symbolName} | Bid: ${spot.bidPrice} | Ask: ${spot.askPrice}`);
      }
    });

    stream.on("error", (err) => {
      console.error("Stream error:", err);
    });

  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

startStream();