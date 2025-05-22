// ctrader-live-price.mjs
import tls from 'tls';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import protobuf from 'protobufjs';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const protoDir = path.join(__dirname, 'protos');

// Load environment variables
let {
  CTRADER_CLIENT_ID,
  CTRADER_CLIENT_SECRET,
  CTRADER_ACCESS_TOKEN,
  CTRADER_REFRESH_TOKEN,
  CTRADER_ACCOUNT_ID,
  SYMBOL_NAME = 'EURUSD'
} = process.env;
const CTP_OAUTH_ENDPOINT = 'https://connect.spotware.com/apps/token';



// -----------------------
// Token Refresh Phase
// -----------------------
async function refreshAccessToken() {
  if (!CTRADER_CLIENT_ID || !CTRADER_CLIENT_SECRET || !CTRADER_REFRESH_TOKEN) {
    console.error('❌ Missing credentials for token refresh');
    process.exit(1);
  }

  const response = await fetch(CTP_OAUTH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CTRADER_CLIENT_ID,
      client_secret: CTRADER_CLIENT_SECRET,
      refresh_token: CTRADER_REFRESH_TOKEN
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Token refresh failed: ${response.status} ${errorText}`);
    process.exit(1);
  }

  const data = await response.json();
  console.log('🔄 Token refreshed successfully');

  // Update .env file
  const envPath = path.join(__dirname, '.env');
  const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
  const updateLine = (key, value) =>
    value ? `${key}=${value}` : envLines.find(line => line.startsWith(key));

  const newEnv = [
    updateLine('CTRADER_CLIENT_ID', CTRADER_CLIENT_ID),
    updateLine('CTRADER_CLIENT_SECRET', CTRADER_CLIENT_SECRET),
    updateLine('CTRADER_ACCESS_TOKEN', data.access_token),
    updateLine('CTRADER_REFRESH_TOKEN', data.refresh_token),
    updateLine('CTRADER_ACCOUNT_ID', CTRADER_ACCOUNT_ID),
    updateLine('SYMBOL_NAME', SYMBOL_NAME)
  ].join('\n');

  fs.writeFileSync(envPath, newEnv, 'utf8');

  // Apply to runtime
  CTRADER_ACCESS_TOKEN = data.access_token;
}

// -----------------------
// Tick Stream Phase
// -----------------------
async function startTickStream() {
  const protoFiles = [
    'OpenApiCommonMessages.proto',
    'OpenApiCommonModelMessages.proto',
    'OpenApiMessages.proto',
    'OpenApiModelMessages.proto'
  ];
  const root = await protobuf.load(protoFiles.map(f => path.join(protoDir, f)));

  const ProtoMessage = root.lookupType('ProtoMessage');
  const PayloadTypeEnum = root.lookupEnum('ProtoOAPayloadType');

  const MessageTypes = {
    ProtoOAVersionReq: root.lookupType('ProtoOAVersionReq'),
    ProtoOAApplicationAuthReq: root.lookupType('ProtoOAApplicationAuthReq'),
    ProtoOAAccountAuthReq: root.lookupType('ProtoOAAccountAuthReq'),
    ProtoOASubscribeSpotsReq: root.lookupType('ProtoOASubscribeSpotsReq'),
    ProtoOAErrorRes: root.lookupType('ProtoOAErrorRes'),
    ProtoOASpotEvent: root.lookupType('ProtoOASpotEvent')
  };

  const payloadTypeMap = {
    ProtoOAVersionReq: PayloadTypeEnum.values.PROTO_OA_VERSION_REQ,
    ProtoOAApplicationAuthReq: PayloadTypeEnum.values.PROTO_OA_APPLICATION_AUTH_REQ,
    ProtoOAAccountAuthReq: PayloadTypeEnum.values.PROTO_OA_ACCOUNT_AUTH_REQ,
    ProtoOASubscribeSpotsReq: PayloadTypeEnum.values.PROTO_OA_SUBSCRIBE_SPOTS_REQ
  };

  function sendMessage(socket, typeName, payload) {
    const messageType = MessageTypes[typeName];
    const payloadType = payloadTypeMap[typeName];
    const message = messageType.create(payload);
    const messageBuffer = messageType.encode(message).finish();
    const wrapper = ProtoMessage.create({ payloadType, payload: messageBuffer });
    const wrapperBuffer = ProtoMessage.encode(wrapper).finish();
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(wrapperBuffer.length, 0);
    socket.write(lengthBuffer);
    socket.write(wrapperBuffer);
    console.log(`→ Sent ${typeName}`);
  }

  const socket = tls.connect(
    { host: 'live.ctraderapi.com', port: 5035, servername: 'live.ctraderapi.com' },
    () => {
      console.log('🔗 Connected to cTrader Open API');
      sendMessage(socket, 'ProtoOAVersionReq', { version: { major: 2, minor: 0, patch: 0 } });
    }
  );

  let recvBuffer = Buffer.alloc(0);

  socket.on('data', chunk => {
    recvBuffer = Buffer.concat([recvBuffer, chunk]);
    while (recvBuffer.length >= 4) {
      const messageLength = recvBuffer.readUInt32BE(0);
      if (recvBuffer.length < 4 + messageLength) break;
      const messageBuffer = recvBuffer.slice(4, 4 + messageLength);
      recvBuffer = recvBuffer.slice(4 + messageLength);

      const wrapper = ProtoMessage.decode(messageBuffer);
      const payloadType = wrapper.payloadType;
      const payloadBuffer = wrapper.payload;

      switch (payloadType) {
        case PayloadTypeEnum.values.PROTO_OA_VERSION_RES:
          console.log('📡 Version handshake complete');
          sendMessage(socket, 'ProtoOAApplicationAuthReq', {
            clientId: CTRADER_CLIENT_ID,
            clientSecret: CTRADER_CLIENT_SECRET
          });
          break;

        case PayloadTypeEnum.values.PROTO_OA_APPLICATION_AUTH_RES:
          console.log('✅ Application authenticated');
          sendMessage(socket, 'ProtoOAAccountAuthReq', {
            ctidTraderAccountId: parseInt(CTRADER_ACCOUNT_ID),
            accessToken: CTRADER_ACCESS_TOKEN
          });
          break;

        case PayloadTypeEnum.values.PROTO_OA_ACCOUNT_AUTH_RES:
          console.log('🔐 Account authenticated');
          sendMessage(socket, 'ProtoOASubscribeSpotsReq', {
            ctidTraderAccountId: parseInt(CTRADER_ACCOUNT_ID),
            symbolName: SYMBOL_NAME
          });
          break;

        case PayloadTypeEnum.values.PROTO_OA_SPOT_EVENT:
          const event = MessageTypes.ProtoOASpotEvent.decode(payloadBuffer);
          const bid = event.bidPrice / 10 ** event.pipsPrecision;
          const ask = event.askPrice / 10 ** event.pipsPrecision;
          console.log(`💹 ${event.symbolName} | Bid: ${bid.toFixed(event.pipsPrecision)} | Ask: ${ask.toFixed(event.pipsPrecision)}`);
          break;

        case PayloadTypeEnum.values.PROTO_OA_ERROR_RES:
          const err = MessageTypes.ProtoOAErrorRes.decode(payloadBuffer);
          console.error(`❌ Error: ${err.errorCode} - ${err.description}`);
          break;

        default:
          console.log(`ℹ️ Received message type ${payloadType}`);
      }
    }
  });

  socket.on('error', err => {
    console.error('⚠️ Socket error:', err.message);
    process.exit(1);
  });

  socket.on('close', () => {
    console.log('🔒 Connection closed');
    process.exit(0);
  });
}

// ---------------------------
// Full Pipeline
// ---------------------------
await refreshAccessToken();
await startTickStream();
