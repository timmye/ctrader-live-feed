require("dotenv").config();
const fs = require("fs");
const path = require("path");
const https = require("https");
const net = require("net");

// Simple environment checking
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
    
    // Check if token is reasonable length
    if (process.env.CTRADER_ACCESS_TOKEN.length < 10) {
      console.log("⚠️ Warning: CTRADER_ACCESS_TOKEN seems too short");
    }
  }
  
  if (!process.env.CTRADER_ACCOUNT_ID) {
    console.log("❌ CTRADER_ACCOUNT_ID not set in .env file");
    allOk = false;
  } else {
    console.log("✅ CTRADER_ACCOUNT_ID is set");
    
    // Check if it's a valid number
    if (isNaN(parseInt(process.env.CTRADER_ACCOUNT_ID))) {
      console.log("❌ CTRADER_ACCOUNT_ID should be a number");
      allOk = false;
    }
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

// Basic TCP connection test
function testTcpConnection() {
  return new Promise((resolve) => {
    console.log("\nTesting direct TCP connection to demo.ctraderapi.com:5035...");
    
    const socket = new net.Socket();
    let connected = false;
    
    // Set timeout
    socket.setTimeout(5000);
    
    socket.on('connect', () => {
      console.log("✅ TCP Connection successful!");
      connected = true;
      socket.end();
      resolve(true);
    });
    
    socket.on('timeout', () => {
      console.log("❌ TCP Connection timed out");
      socket.destroy();
      resolve(false);
    });
    
    socket.on('error', (err) => {
      console.log(`❌ TCP Connection error: ${err.message}`);
      resolve(false);
    });
    
    // Try to connect
    socket.connect(5035, 'demo.ctraderapi.com');
  });
}

// Test HTTPS connection
function testHttpsConnection() {
  return new Promise((resolve) => {
    console.log("\nTesting HTTPS connection to ctrader.com...");
    
    const req = https.request({
      hostname: 'ctrader.com',
      port: 443,
      path: '/',
      method: 'GET',
      timeout: 5000
    }, (res) => {
      console.log(`✅ HTTPS Connection successful! Status code: ${res.statusCode}`);
      // Consume response data to free up memory
      res.resume();
      resolve(true);
    });
    
    req.on('error', (err) => {
      console.log(`❌ HTTPS Connection error: ${err.message}`);
      resolve(false);
    });
    
    req.on('timeout', () => {
      console.log("❌ HTTPS Connection timed out");
      req.destroy();
      resolve(false);
    });
    
    req.end();
  });
}

// Run all tests
async function runTests() {
  const envOk = checkEnvironment();
  
  if (!envOk) {
    console.log("\n⚠️ Fix environment issues before continuing");
    return;
  }
  
  // Test basic connectivity
  const httpsOk = await testHttpsConnection();
  const tcpOk = await testTcpConnection();
  
  console.log("\nSummary:");
  console.log("--------");
  console.log(`Environment check: ${envOk ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`HTTPS connectivity: ${httpsOk ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`TCP connectivity: ${tcpOk ? '✅ PASSED' : '❌ FAILED'}`);
  
  if (!tcpOk) {
    console.log("\nPossible issues:");
    console.log("1. Your firewall may be blocking outgoing connections to port 5035");
    console.log("2. Your network may not allow this type of connection");
    console.log("3. The cTrader API server might be temporarily unavailable");
    console.log("\nTry disabling your firewall temporarily to test if that's the issue.");
  }
  
  if (envOk && httpsOk && tcpOk) {
    console.log("\n🎉 All checks passed! You should be able to run the cTrader API client successfully.");
  } else {
    console.log("\n⚠️ Some checks failed. Please fix the issues before running the cTrader API client.");
  }
}

runTests();