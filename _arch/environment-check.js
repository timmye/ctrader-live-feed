require("dotenv").config();
const path = require("path");
const fs = require("fs");
const grpc = require("@grpc/grpc-js");
const dns = require("dns").promises;

// Check if required environment variables are set
function checkEnvironment() {
  console.log("Environment Check:");
  console.log("-----------------");
  
  let allOk = true;
  
  // Check .env file
  if (!fs.existsSync(path.join(__dirname, ".env"))) {
    console.log("❌ .env file not found!");
    console.log("   Create a .env file with CTRADER_ACCESS_TOKEN and CTRADER_ACCOUNT_ID");
    allOk = false;
  } else {
    console.log("✅ .env file exists");
  }
  
  // Check environment variables
  if (!process.env.CTRADER_ACCESS_TOKEN) {
    console.log("❌ CTRADER_ACCESS_TOKEN not set in .env file");
    allOk = false;
  } else {
    console.log("✅ CTRADER_ACCESS_TOKEN is set");
  }
  
  if (!process.env.CTRADER_ACCOUNT_ID) {
    console.log("❌ CTRADER_ACCOUNT_ID not set in .env file");
    allOk = false;
  } else {
    console.log("✅ CTRADER_ACCOUNT_ID is set");
  }
  
  // Check proto files
  const protoDir = path.join(__dirname, "protos");
  if (!fs.existsSync(protoDir)) {
    console.log("❌ 'protos' directory not found!");
    allOk = false;
  } else {
    console.log("✅ 'protos' directory exists");
    
    // Check for service proto file
    const serviceProtoPath = path.join(protoDir, "OpenApiService.proto");
    if (!fs.existsSync(serviceProtoPath)) {
      console.log("❌ 'OpenApiService.proto' not found in protos directory");
      allOk = false;
    } else {
      console.log("✅ 'OpenApiService.proto' exists");
    }
  }
  
  return allOk;
}

// Test network connectivity to cTrader API
async function testConnectivity() {
  console.log("\nNetwork Connectivity Test:");
  console.log("------------------------");
  
  try {
    // 1. DNS resolution test
    console.log("Testing DNS resolution for demo.ctraderapi.com...");
    const addresses = await dns.lookup("demo.ctraderapi.com");
    console.log(`✅ DNS resolved to ${addresses.address}`);
    
    // 2. Port connectivity test using gRPC
    console.log("Testing port connectivity to demo.ctraderapi.com:5035...");
    
    const deadline = new Date().getTime() + 5000; // 5 second timeout
    const channel = grpc.createChannel("demo.ctraderapi.com:5035", grpc.credentials.createSsl());
    
    const state = channel.getConnectivityState(true);
    console.log(`Initial state: ${getStateName(state)}`);
    
    // Wait for channel to connect
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout after 5 seconds"));
      }, 5000);
      
      channel.watchConnectivityState(state, deadline, error => {
        clearTimeout(timeout);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    
    const newState = channel.getConnectivityState(false);
    console.log(`Final state: ${getStateName(newState)}`);
    
    if (newState === grpc.connectivityState.READY || newState === grpc.connectivityState.IDLE) {
      console.log("✅ Successfully connected to cTrader API server");
    } else {
      console.log("❌ Could not establish connection to cTrader API server");
    }
    
  } catch (error) {
    console.error("❌ Network test failed:", error.message);
    return false;
  }
  
  return true;
}

// Helper to get connectivity state name
function getStateName(state) {
  const states = {
    0: 'IDLE',
    1: 'CONNECTING',
    2: 'READY',
    3: 'TRANSIENT_FAILURE',
    4: 'SHUTDOWN'
  };
  return states[state] || `UNKNOWN(${state})`;
}

// Run all checks
async function runChecks() {
  const envOk = checkEnvironment();
  console.log();
  
  if (!envOk) {
    console.log("⚠️ Fix environment issues before continuing");
    return;
  }
  
  const connectivityOk = await testConnectivity();
  
  console.log("\nSummary:");
  console.log("--------");
  console.log(`Environment check: ${envOk ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Connectivity check: ${connectivityOk ? '✅ PASSED' : '❌ FAILED'}`);
  
  if (envOk && connectivityOk) {
    console.log("\n🎉 All checks passed! You should be able to run the cTrader API client successfully.");
  } else {
    console.log("\n⚠️ Some checks failed. Please fix the issues before running the cTrader API client.");
  }
}

runChecks();