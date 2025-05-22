require("dotenv").config();
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

// Update these paths if needed
const PROTO_PATHS = [
  "./protos/OpenApiService.proto",
  "./protos/OpenApiMessages.proto",
  "./protos/OpenApiModelMessages.proto",
  "./protos/OpenApiCommonMessages.proto",
];

const packageDefinition = protoLoader.loadSync(PROTO_PATHS, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const proto = grpc.loadPackageDefinition(packageDefinition).proto_api;

const client = new proto.OpenApi("demo.ctraderapi.com:5035", grpc.credentials.createSsl());

function send(payloadType, message) {
  const request = {
    payloadType: payloadType,
    payload: message
  };
  client.sendMessage(request, () => {});
}

async function getAccounts() {
  const accessToken = process.env.CTRADER_ACCESS_TOKEN;

  // Authenticate
  const authReq = proto.ProtoOAClientAuthReq.create({ accessToken });
  send(proto.OAPayloadType.PROTO_OA_CLIENT_AUTH_REQ, proto.ProtoOAClientAuthReq.encode(authReq).finish());

  const stream = client.receiveMessage({});
  stream.on("data", (msg) => {
    const type = msg.payloadType;
    const payload = msg.payload;

    switch (type) {
      case proto.OAPayloadType.PROTO_OA_CLIENT_AUTH_RES:
        console.log("✅ Authenticated successfully — requesting account list...");
        const accountsReq = proto.ProtoOAGetAccountListReq.create({});
        send(
          proto.OAPayloadType.PROTO_OA_GET_ACCOUNT_LIST_REQ,
          proto.ProtoOAGetAccountListReq.encode(accountsReq).finish()
        );
        break;

      case proto.OAPayloadType.PROTO_OA_GET_ACCOUNTS_RES:
        const res = proto.ProtoOAGetAccountListRes.decode(payload);
        console.log("🏦 Accounts:");
        res.ctidTraderAccount.forEach(acc => {
          console.log(`- ID: ${acc.ctidTraderAccountId} | Broker: ${acc.brokerName} | Type: ${acc.accountType}`);
        });
        break;

      default:
        console.log("📥 Unknown message type:", type);
        break;
    }
  });

  stream.on("error", err => {
    console.error("❌ Stream error:", err.message);
  });
}

getAccounts();