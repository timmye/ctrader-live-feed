// ctrader-live-feed.mjs
import tls from 'tls';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import readline from 'readline';
import protobuf from 'protobufjs';
import { fileURLToPath } from 'url';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const protoDir = path.join(__dirname, 'protos');

let {
  CTRADER_CLIENT_ID,
  CTRADER_CLIENT_SECRET,
  CTRADER_ACCESS_TOKEN,
  CTRADER_REFRESH_TOKEN,
  CTRADER_ACCOUNT_ID
} = process.env;

const CTP_OAUTH_ENDPOINT = 'https://connect.spotware.com/apps/token';

// ————————————————————————————————————————————————————————————————
// 1. Token Refresh (unchanged, proven working)
// ————————————————————————————————————————————————————————————————
async function refreshAccessToken() {
  const res = await fetch(CTP_OAUTH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CTRADER_CLIENT_ID,
      client_secret: CTRADER_CLIENT_SECRET,
      refresh_token: CTRADER_REFRESH_TOKEN
    })
  });
  if (!res.ok) {
    console.error('❌ Token refresh failed:', res.status, await res.text());
    process.exit(1);
  }
  const data = await res.json();
  console.log('🔄 Token refreshed successfully');
  // update .env
  const envPath = path.join(__dirname, '.env');
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const update = (k,v)=> v?`${k}=${v}`: lines.find(l=>l.startsWith(k));
  const newEnv = [
    update('CTRADER_CLIENT_ID', CTRADER_CLIENT_ID),
    update('CTRADER_CLIENT_SECRET', CTRADER_CLIENT_SECRET),
    update('CTRADER_ACCESS_TOKEN', data.access_token),
    update('CTRADER_REFRESH_TOKEN', data.refresh_token),
    update('CTRADER_ACCOUNT_ID', CTRADER_ACCOUNT_ID)
  ].join('\n');
  fs.writeFileSync(envPath, newEnv, 'utf8');
  CTRADER_ACCESS_TOKEN = data.access_token;
}

// ————————————————————————————————————————————————————————————————
// 2. Main Stream Setup with Callbacks
// ————————————————————————————————————————————————————————————————
async function startTickStream() {
  // load protos
  const protoFiles = [
    'OpenApiCommonMessages.proto',
    'OpenApiCommonModelMessages.proto',
    'OpenApiMessages.proto',
    'OpenApiModelMessages.proto'
  ].map(f=> path.join(protoDir,f));
  const root = await protobuf.load(protoFiles);

  const ProtoMessage       = root.lookupType('ProtoMessage');
  const PayloadTypeEnum    = root.lookupEnum('ProtoOAPayloadType');
  const MT = (n)=> root.lookupType(n);

  // your message types
  const MessageTypes = {
    VersionReq:        MT('ProtoOAVersionReq'),
    AppAuthReq:        MT('ProtoOAApplicationAuthReq'),
    AccountAuthReq:    MT('ProtoOAAccountAuthReq'),
    SymbolsListReq:    MT('ProtoOASymbolsListReq'),
    SubscribeSpotsReq: MT('ProtoOASubscribeSpotsReq'),
    SymbolsListRes:    MT('ProtoOASymbolsListRes'),
    SpotEvent:         MT('ProtoOASpotEvent'),
    ErrorRes:          MT('ProtoOAErrorRes')
  };

  const PayloadMap = {
    VersionReq:        PayloadTypeEnum.values.PROTO_OA_VERSION_REQ,
    AppAuthReq:        PayloadTypeEnum.values.PROTO_OA_APPLICATION_AUTH_REQ,
    AccountAuthReq:    PayloadTypeEnum.values.PROTO_OA_ACCOUNT_AUTH_REQ,
    SymbolsListReq:    PayloadTypeEnum.values.PROTO_OA_SYMBOLS_LIST_REQ,
    SubscribeSpotsReq: PayloadTypeEnum.values.PROTO_OA_SUBSCRIBE_SPOTS_REQ
  };

  // simple event emitter
  const emitter = {
    _handlers: {},
    on(t,cb){ this._handlers[t]=cb; },
    emit(t,arg){ this._handlers[t]?.(arg); }
  };

  // send wrapper helper
  const send = (socket,typeName,payload)=>{
    const msgType = MessageTypes[typeName];
    const buf = msgType.encode(msgType.create(payload)).finish();
    const wrap = ProtoMessage.create({ payloadType: PayloadMap[typeName], payload: buf });
    const wrapBuf = ProtoMessage.encode(wrap).finish();
    const header = Buffer.alloc(4);
    header.writeUInt32BE(wrapBuf.length,0);
    socket.write(header);
    socket.write(wrapBuf);
    console.log(`→ Sent ${typeName}`);
  };

  // callbacks
  emitter.on('version',()=> {
    console.log('📡 Version handshake complete');
    send(sock,'AppAuthReq',{ clientId:CTRADER_CLIENT_ID, clientSecret:CTRADER_CLIENT_SECRET });
  });
  emitter.on('auth_app',()=> {
    console.log('✅ App authenticated');
    send(sock,'AccountAuthReq',{ ctidTraderAccountId:parseInt(CTRADER_ACCOUNT_ID), accessToken:CTRADER_ACCESS_TOKEN });
  });
  emitter.on('auth_account',()=> {
    console.log('🔐 Account authenticated');
    send(sock,'SymbolsListReq',{ ctidTraderAccountId:parseInt(CTRADER_ACCOUNT_ID) });
  });
  emitter.on('symbols_list', async(res)=>{
    const all = res.symbol;
    console.log(`📥 Received ${all.length} symbols`);
    fs.writeFileSync(
      path.join(__dirname,'symbols.csv'),
      'symbolId,symbolName\n'+ all.map(s=>`${s.symbolId},${s.symbolName}`).join('\n'),
      'utf8'
    );
    console.log('📄 symbols.csv written');
    // prompt
    const sym = await new Promise(r=>{
      const rl = readline.createInterface({input:process.stdin,output:process.stdout});
      rl.question('📝 Enter symbol (e.g. EURUSD): ', a=>{
        rl.close(); r(a.trim().toUpperCase());
      });
    });
    const m = all.find(s=>s.symbolName.toUpperCase()===sym);
    if(!m) return console.error(`❌ "${sym}" not found`);
    send(sock,'SubscribeSpotsReq',{ ctidTraderAccountId:parseInt(CTRADER_ACCOUNT_ID), symbolId:[m.symbolId] });
  });
  emitter.on('spot', spot=>{
    const symbol = spot.symbolName || `ID ${spot.symbolId}`;
    const bid = spot.bid? (spot.bid/1e5).toFixed(5):'N/A';
    const ask = spot.ask? (spot.ask/1e5).toFixed(5):'N/A';
    console.log(`💹 ${symbol} | Bid: ${bid} | Ask: ${ask}`);
  });
  emitter.on('error_res', err=>{
    console.error(`❌ API Error ${err.errorCode}: ${err.description}`);
  });

  // open socket
  let sock = null;
  let recvBuffer = Buffer.alloc(0);

  const connect = ()=>{
    sock = tls.connect({ host:'live.ctraderapi.com',port:5035,servername:'live.ctraderapi.com' },()=>{
      console.log('🔗 Connected');
      send(sock,'VersionReq',{ version:{major:2,minor:0,patch:0} });
    });

    sock.on('data',chunk=>{
      recvBuffer = Buffer.concat([recvBuffer,chunk]);
      while(recvBuffer.length>=4){
        const len = recvBuffer.readUInt32BE(0);
        if(recvBuffer.length<4+len) break;
        const msgBuf = recvBuffer.slice(4,4+len);
        recvBuffer = recvBuffer.slice(4+len);
        const wrap = ProtoMessage.decode(msgBuf);
        const pt = wrap.payloadType;
        const payload = wrap.payload;
        switch(pt){
          case PayloadTypeEnum.values.PROTO_OA_VERSION_RES:
            emitter.emit('version'); break;
          case PayloadTypeEnum.values.PROTO_OA_APPLICATION_AUTH_RES:
            emitter.emit('auth_app'); break;
          case PayloadTypeEnum.values.PROTO_OA_ACCOUNT_AUTH_RES:
            emitter.emit('auth_account'); break;
          case PayloadTypeEnum.values.PROTO_OA_SYMBOLS_LIST_RES:
            emitter.emit('symbols_list', MessageTypes.SymbolsListRes.decode(payload)); break;
          case PayloadTypeEnum.values.PROTO_OA_SPOT_EVENT:
            emitter.emit('spot', MessageTypes.SpotEvent.decode(payload)); break;
          case PayloadTypeEnum.values.PROTO_OA_ERROR_RES:
            emitter.emit('error_res', MessageTypes.ErrorRes.decode(payload)); break;
          default:
            console.warn('ℹ️ Unhandled payload', pt);
        }
      }
    });

    sock.on('error',err=> console.error('⚠️ Socket error:',err.message));
    sock.on('close',()=> { console.warn('🔌 Closed, reconnecting in 5s'); setTimeout(connect,5000); });
  };

  connect();
}

await refreshAccessToken();
await startTickStream();
