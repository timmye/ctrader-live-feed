import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

// ✅ Create __filename and __dirname manually
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load proto files
const packageDefinition = protoLoader.loadSync([
  path.resolve(__dirname, './protos/OpenApiService.proto'),
  path.resolve(__dirname, './protos/OpenApiMessages.proto'),
  path.resolve(__dirname, './protos/OpenApiCommonMessages.proto'),
  path.resolve(__dirname, './protos/OpenApiCommonModelMessages.proto'),
], {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition).proto_api;

// Create secure client to cTrader
const client = new protoDescriptor.OpenApi('live.ctraderapi.com:5035', grpc.credentials.createSsl());

// Construct ProtoOAApplicationAuthReq
const authReq = {
  payloadType: 2100, // PROTO_OA_APPLICATION_AUTH_REQ
  payload: {
    clientId: process.env.CTRADER_CLIENT_ID,
    clientSecret: process.env.CTRADER_CLIENT_SECRET,
  },
};

console.log('✅ Built ProtoOAApplicationAuthReq:', authReq);

// Send authentication message
console.log('🔐 Sending authentication request...');
client.sendMessage(authReq, (err, response) => {
  if (err) {
    console.error('❌ gRPC Error:', err.message);
    return;
  }

  console.log('📬 Received response:');
  console.dir(response, { depth: null });

  if (response.payloadType === 2101) {
    console.log('🎉 Auth success (PROTO_OA_APPLICATION_AUTH_RES)');
  } else {
    console.warn('⚠️ Unexpected payloadType:', response.payloadType);
  }
});

// Optional: Start receive stream
const stream = client.receiveMessage({ payloadType: 0 }); // Dummy payloadType

stream.on('data', (msg) => {
  console.log('📨 Stream data received:');
  console.dir(msg, { depth: null });
});

stream.on('error', (err) => {
  console.error('❌ Stream error:', err.message);
});

stream.on('end', () => {
  console.log('📴 Stream ended.');
});
