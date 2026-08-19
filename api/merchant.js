import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  let merchantId;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'merchant') {
      return res.status(403).json({ error: 'Forbidden — Merchant access only' });
    }
    merchantId = decoded.id;
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { action } = req.query;

  // ============================================================
  // DASHBOARD STATS
  // ============================================================
  if (action === 'dashboard') {
    // Get merchant's shop_id
    const { data: shop, error: shopError } = await supabaseAdmin
      .from('shops')
      .select('id')
      .eq('merchant_id', merchantId)
      .single();

    if (shopError || !shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const shopId = shop.id;

    // Total products assigned to this shop
    const { count: totalProducts } = await supabaseAdmin
      .from('shop_products')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', shopId);

    // Total orders for this shop
    const { count: totalOrders } = await supabaseAdmin
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', shopId);

    // Pending orders
    const { count: pending } = await supabaseAdmin
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', shopId)
      .eq('status', 'pending');

    // Delivered orders
    const { count: delivered } = await supabaseAdmin
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('shop_id', shopId)
      .eq('status', 'delivered');

    return res.status(200).json({
      stats: {
        total_products: totalProducts || 0,
        total_orders: totalOrders || 0,
        pending: pending || 0,
        delivered: delivered || 0,
      },
    });
  }

  return res.status(400).json({ error: 'Invalid action' });
}
