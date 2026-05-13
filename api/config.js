export default function handler(req, res) {
  // CORS headers (allow your own domain)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  // Read from Vercel Environment Variables
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({
      error: 'Missing environment variables',
      message: 'SUPABASE_URL and SUPABASE_ANON_KEY must be set in Vercel'
    });
  }

  return res.status(200).json({
    supabaseUrl: supabaseUrl,
    supabaseAnonKey: supabaseAnonKey,
    tableName: 'groceries'
  });
}
