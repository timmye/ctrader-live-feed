import tls from 'tls';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import protobuf from 'protobufjs';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const protoDir = path.join(__dirname, 'protos');

const {
  CTRADER_CLIENT_ID,
  CTRADER_CLIENT_SECRET,
  CTRADER_ACCESS_TOKEN
} = process.env;

async function getTradingAccounts() {
  const protoFiles = [
    'OpenApiCommonMessages.proto',
    'OpenApiCommonModelMessages.proto',
    'OpenApiMessages.proto',
    'OpenApiModelMessages.proto'
  ];

  const root = await protobuf.load(protoFiles.map(f => path.join(protoDir, f)));

  const ProtoMessage = root.lookupType('ProtoMessage');
  const PayloadTypeEnum = root.lookupEnum('ProtoOAPayloadType');

//  // Dump all payload types
//  console.log('🔍 PayloadTypeEnum values:');
//  for (const [key, val] of Object.entries(PayloadTypeEnum.values)) {
//    console.log(`${key} = ${val}`);
//  }

  const MessageTypes = {
    ProtoOAVersionReq: root.lookupType('ProtoOAVersionReq'),
    ProtoOAApplicationAuthReq: root.lookupType('ProtoOAApplicationAuthReq'),
    ProtoOAGetAccountListByAccessTokenReq: root.lookupType('ProtoOAGetAccountListByAccessTokenReq'),
    ProtoOAGetAccountListByAccessTokenRes: root.lookupType('ProtoOAGetAccountListByAccessTokenRes'),
    ProtoOAErrorRes: root.lookupType('ProtoOAErrorRes')
  };

  const payloadTypeMap = {
    ProtoOAVersionReq: PayloadTypeEnum.values.PROTO_OA_VERSION_REQ,
    ProtoOAApplicationAuthReq: PayloadTypeEnum.values.PROTO_OA_APPLICATION_AUTH_REQ,
    ProtoOAGetAccountListByAccessTokenReq: PayloadTypeEnum.values.PROTO_OA_GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ
  };

  function sendMessage(socket, typeName, payload) {
    const messageType = MessageTypes[typeName];
    const payloadType = payloadTypeMap[typeName];
    if (payloadType === undefined) {
      console.error(`❌ No payloadType mapping found for: ${typeName}`);
      return;
    }
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
          sendMessage(socket, 'ProtoOAGetAccountListByAccessTokenReq', {
            accessToken: CTRADER_ACCESS_TOKEN
          });
          break;

        case PayloadTypeEnum.values.PROTO_OA_ERROR_RES:
          const err = MessageTypes.ProtoOAErrorRes.decode(payloadBuffer);
          console.error(`❌ Error: ${err.errorCode} - ${err.description}`);
          socket.end();
          break;

		case 2150: {
		  try {
			const res = MessageTypes.ProtoOAGetAccountListByAccessTokenRes.decode(payloadBuffer);
			if (!res.ctidTraderAccount || res.ctidTraderAccount.length === 0) {
			  console.warn('⚠️ No ctidTraderAccount found in response:', res);
			} else {
			  console.log('📄 Retrieved trading accounts:');
			  res.ctidTraderAccount.forEach(account => {
				console.log(`- ctidTraderAccountId: ${account.ctidTraderAccountId}`);
				console.log(`  Broker: ${account.brokerTitleShort}`);
				console.log(`  Live: ${account.isLive}`);
			  });
			}

		  } catch (e) {
			console.error('❌ Failed to decode account list response:', e.message);
			console.dir(payloadBuffer, { depth: null });
		  }
		  socket.end();
		  break;
		}


        default:
          console.warn(`⚠️ Unknown payloadType received: ${payloadType}`);
          try {
            const fallback = ProtoMessage.decode(payloadBuffer);
            console.dir(fallback, { depth: null });
          } catch (e) {
            console.error('Could not decode unknown payload:', e.message);
          }
      }
    }
  });

  socket.on('error', err => {
    console.error('⚠️ Socket error:', err.message);
  });

  socket.on('close', () => {
    console.log('🔒 Connection closed');
  });
}

getTradingAccounts();
