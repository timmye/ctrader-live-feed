require('dotenv').config();
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// Function to load a single proto file and log its content.
function loadProtoFile(protoPath) {
  try {
    const packageDefinition = protoLoader.loadSync([protoPath], {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    });

    const proto = grpc.loadPackageDefinition(packageDefinition);
    console.log(`Loaded definitions from ${protoPath}:`, Object.keys(proto));

    // Additional debugging output for each top-level package in the definition.
    if (Object.keys(proto).length > 0) {
      Object.keys(proto).forEach((key) => {
        const value = proto[key];
        console.log(`Key: ${key}`);
        if (typeof value === 'object') {
          // Recursively log nested objects
          for (let subKey in value) {
            console.log(`  Sub-key: ${subKey}, Type: ${typeof value[subKey]}`);
          }
        } else {
          console.log(`  Value: ${value}`);
        }
      });
    } else {
      console.log(`No definitions found in ${protoPath}`);
    }
  } catch (error) {
    console.error(`Error loading ${protoPath}:`, error);
  }
}

// List all relevant .proto files
const protoFiles = [
  'C:/Users/tim_n/ctrader-live-feed/protos/OpenApiCommonMessages.proto',
  'C:/Users/tim_n/ctrader-live-feed/protos/OpenApiCommonModelMessages.proto',
  'C:/Users/tim_n/ctrader-live-feed/protos/OpenApiMessages.proto',
  'C:/Users/tim_n/ctrader-live-feed/protos/OpenApiModelMessages.proto'
];

// Load and inspect each proto file
protoFiles.forEach(loadProtoFile);