export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      message: 'Method not allowed' 
    });
  }

  try {
    const { username, password } = req.body;

    // Basic validation
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username and password are required' 
      });
    }

    // --------------------------------------------------------------
    // 🔐 VERCEL ENVIRONMENT VARIABLES CHECK
    // --------------------------------------------------------------
    // These read from your Vercel deployment settings:
    //   USER_NAME = your value
    //   USER_PASSWORD = your value
    //
    // This runs ONLY on the server - never exposed to browser!
    // --------------------------------------------------------------
    const validUsername = process.env.USER_NAME;
    const validPassword = process.env.USER_PASSWORD;

    // Check if environment variables are set
    if (!validUsername || !validPassword) {
      console.error('Environment variables USER_NAME or USER_PASSWORD not set');
      return res.status(500).json({ 
        success: false, 
        message: 'Server configuration error' 
      });
    }

    // Verify credentials
    if (username === validUsername && password === validPassword) {
      return res.status(200).json({ 
        success: true, 
        message: 'Authentication successful' 
      });
    } else {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid username or password' 
      });
    }

  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
}
