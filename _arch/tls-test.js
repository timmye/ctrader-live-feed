const tls = require('tls');

// Function to test TLS connection with specific settings
function testTls() {
  console.log("Testing TLS connection to demo.ctraderapi.com:5035...");
  console.log("This test checks if your system can establish a secure TLS connection.");
  
  // Create TCP socket with TLS
  const socket = tls.connect({
    host: "demo.ctraderapi.com",
    port: 5035,
    rejectUnauthorized: false, // For testing only
    timeout: 5000,
    // Try different TLS versions
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3'
  });
  
  socket.on('secureConnect', () => {
    console.log("✅ TLS Connection established successfully!");
    console.log(`TLS Protocol: ${socket.getProtocol()}`);
    console.log(`TLS Cipher: ${socket.getCipher().name}`);
    socket.end();
  });
  
  socket.on('timeout', () => {
    console.log("❌ TLS Connection timed out");
    socket.destroy();
  });
  
  socket.on('error', (err) => {
    console.log(`❌ TLS Connection error: ${err.message}`);
    
    // Provide more specific guidance based on error
    if (err.message.includes('certificate')) {
      console.log("\nThis appears to be a certificate validation issue.");
      console.log("Try updating your Node.js to get the latest CA certificates.");
    } else if (err.message.includes('ECONNREFUSED')) {
      console.log("\nConnection refused. This could indicate:");
      console.log("1. The service is not available at this address/port");
      console.log("2. A firewall is blocking the connection");
    } else if (err.message.includes('ECONNRESET')) {
      console.log("\nConnection reset. This could indicate:");
      console.log("1. The server rejected the connection");
      console.log("2. A security device (firewall, proxy) interrupted the connection");
    } else if (err.message.includes('protocol')) {
      console.log("\nTLS protocol issue. Try forcing an older TLS version:");
      console.log("Set NODE_OPTIONS=--tls-min-v1.0");
    }
  });
}

// Run the test
testTls();