// ctrader-live-price.mjs
import tls from 'tls';
import protobuf from 'protobufjs';
const { load } = protobuf;
import dotenv from 'dotenv';
dotenv.config();

const {
  CTRADER_CLIENT_ID,
  CTRADER_CLIENT_SECRET,
  CTRADER_ACCESS_TOKEN,
  CTRADER_ACCOUNT_ID,  // optional
  SYMBOL_NAME          // e.g. "EURUSD"
} = process.env;

if (!CTRADER_CLIENT_ID || !CTRADER_CLIENT_SECRET || !CTRADER_ACCESS_TOKEN) {
  console.error('❌ Missing CTRADER_CLIENT_ID/SECRET/ACCESS_TOKEN in .env');
  process.exit(1);
}

(async () => {
  // 1) Load protos
  const root = await load([
    './protos/OpenApiCommonMessages.proto',
    './protos/OpenApiCommonModelMessages.proto',
    './protos/OpenApiMessages.proto',
    './protos/OpenApiModelMessages.proto'
  ]);

  // 2) Lookup types & enum
  const ProtoMessage       = root.lookupType('ProtoMessage');
  const PayloadEnum        = root.lookupEnum('ProtoOAPayloadType');
  // === after: const PayloadEnum = root.lookupEnum('ProtoOAPayloadType');
const payloadTypeMap = {
  // MessageTypeName: PayloadEnum value
  ProtoOAApplicationAuthReq:               PayloadEnum.values.PROTO_OA_APPLICATION_AUTH_REQ,
  ProtoOAGetAccountListByAccessTokenReq:  PayloadEnum.values.PROTO_OA_GET_ACCOUNT_LIST_BY_ACCESS_TOKEN_REQ,
  ProtoOAAccountAuthReq:                   PayloadEnum.values.PROTO_OA_ACCOUNT_AUTH_REQ,
  ProtoOASubscribeSpotsReq:                PayloadEnum.values.PROTO_OA_SUBSCRIBE_SPOTS_REQ
};

  const ApplicationAuthReq = root.lookupType('ProtoOAApplicationAuthReq');
  const GetAccountsReq     = root.lookupType('ProtoOAGetAccountListByAccessTokenReq');
  const AccountAuthReq     = root.lookupType('ProtoOAAccountAuthReq');
  const SubscribeSpotsReq  = root.lookupType('ProtoOASubscribeSpotsReq');

function sendMessage(messageType, payload) {
  // 1) Encode the inner message
  const msgBuf = messageType.encode(messageType.create(payload)).finish();

  // 2) Look up the exact PayloadEnum value
  const pt = payloadTypeMap[messageType.name];
  if (pt === undefined) {
    throw new Error(`No payloadType mapping for ${messageType.name}`);
  }

  // 3) Wrap in ProtoMessage
  const wrapper = ProtoMessage.create({ payloadType: pt, payload: msgBuf });
  const pkt     = ProtoMessage.encode(wrapper).finish();

  // 4) Send with 4-byte BE length prefix
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(pkt.length);
  socket.write(lenBuf);
  socket.write(pkt);
}


//  // 4) Accumulate incoming bytes
let recvBuf = Buffer.alloc(0);

  // 5) Connect → then listeners
  const socket = tls.connect(
    { host: 'live.ctraderapi.com', port: 5035, servername: 'live.ctraderapi.com' },
    () => {
      console.log('🔗 Connected to cTrader Open API');
      // Kick off application‐level auth
      sendMessage(ApplicationAuthReq, {
        clientId:     CTRADER_CLIENT_ID,
        clientSecret: CTRADER_CLIENT_SECRET
      });
    }
  );

  socket.on('data', chunk => {
    recvBuf = Buffer.concat([recvBuf, chunk]);
    while (recvBuf.length >= 4) {
      const msgLen = recvBuf.readUInt32BE(0);
      if (recvBuf.length < 4 + msgLen) break;
      const msgBuf = recvBuf.slice(4, 4 + msgLen);
      recvBuf       = recvBuf.slice(4 + msgLen);

      const wrapper = ProtoMessage.decode(msgBuf);
      const pt      = wrapper.payloadType;
      const enumName = PayloadEnum.valuesById[pt];
      if (!enumName) continue;

      // Build messageName, decode inner
      const suffix      = enumName.replace(/^OA_/, '').toLowerCase()
        .split('_').map(w => w[0].toUpperCase()+w.slice(1)).join('');
      const messageName = 'ProtoOA' + suffix;
      let messageType;
      try {
        messageType = root.lookupType(messageName);
      } catch {
        continue;
      }
      const inner = messageType.decode(wrapper.payload);

      // Dispatch
      switch (enumName) {
        case 'OA_APPLICATION_AUTH_RES':
          console.log('✅ Application Authenticated');
          if (CTRADER_ACCOUNT_ID) {
            sendMessage(AccountAuthReq, {
              ctidTraderAccountId: Number(CTRADER_ACCOUNT_ID),
              accessToken:         CTRADER_ACCESS_TOKEN
            });
          } else {
            sendMessage(GetAccountsReq, { accessToken: CTRADER_ACCESS_TOKEN });
          }
          break;

        case 'OA_GET_ACCOUNT_LIST_BY_ACCESS_TOKEN_RES':
          const acctId = inner.ctidTraderAccount[0].ctidTraderAccountId;
          console.log('🆔 Got accountId:', acctId);
          sendMessage(AccountAuthReq, {
            ctidTraderAccountId: acctId,
            accessToken:         CTRADER_ACCESS_TOKEN
          });
          break;

        case 'OA_ACCOUNT_AUTH_RES':
          console.log('🔐 Account Authenticated');
          sendMessage(SubscribeSpotsReq, {
            ctidTraderAccountId: Number(inner.ctidTraderAccountId || CTRADER_ACCOUNT_ID),
            accessToken:         CTRADER_ACCESS_TOKEN,
            symbolName:          SYMBOL_NAME || 'EURUSD'
          });
          break;

        case 'OA_SPOT_EVENT':
          console.log(`💹 ${inner.symbolName}  Bid=${inner.bidPrice}  Ask=${inner.askPrice}`);
          break;
      }
    }
  });

  socket.on('error', err => {
    console.error('⚠️ Socket error', err);
    process.exit(1);
  });

  socket.on('close', () => {
    console.log('🔒 Connection closed');
    process.exit(0);
  });
})();
