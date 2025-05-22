// getAccessToken.js
require("dotenv").config();
const axios = require("axios");

async function getToken() {
  try {
    const res = await axios.post(
      "https://connect.spotware.com/apps/oauth2/token ",
      null,
      {
        params: {
          grant_type: "authorization_code",
          client_id: process.env.CTRADER_CLIENT_ID,
          client_secret: process.env.CTRADER_CLIENT_SECRET,
          code: process.env.CTRADER_AUTH_CODE,
          redirect_uri: process.env.CTRADER_REDIRECT_URI,
        },
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    console.log("✅ Access Token:", res.data.access_token);
    console.log("🔁 Refresh Token:", res.data.refresh_token);
    console.log("⏰ Expires In:", res.data.expires_in, "seconds");

    // Save tokens securely
  } catch (err) {
    console.error("❌ Token fetch error:", err?.response?.data || err.message);
  }
}

getToken();