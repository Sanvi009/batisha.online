export default function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  console.log('🔧 Config API called');
  
  // Read from Vercel Environment Variables
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  console.log('SUPABASE_URL exists:', !!supabaseUrl);
  console.log('SUPABASE_ANON_KEY exists:', !!supabaseAnonKey);

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('❌ Missing environment variables');
    return res.status(500).json({
      error: 'Missing environment variables',
      message: 'SUPABASE_URL and SUPABASE_ANON_KEY must be set in Vercel',
      missing: {
        SUPABASE_URL: !supabaseUrl,
        SUPABASE_ANON_KEY: !supabaseAnonKey
      }
    });
  }

  return res.status(200).json({
    supabaseUrl: supabaseUrl,
    supabaseAnonKey: supabaseAnonKey,
    tableName: 'product'  // ✅ FIXED: Changed from 'groceries' to 'product'
  });
}
