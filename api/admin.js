import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  let adminId;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden — Admin access only' });
    }
    adminId = decoded.id;
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { action } = req.query;

  // ============================================================
  // DASHBOARD STATS
  // ============================================================
  if (action === 'dashboard') {
    const { count: totalUsers } = await supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'user');

    const { count: totalMerchants } = await supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'merchant');

    const { count: totalOrders } = await supabaseAdmin
      .from('orders')
      .select('*', { count: 'exact', head: true });

    const { count: totalOffers } = await supabaseAdmin
      .from('offers')
      .select('*', { count: 'exact', head: true });

    const { count: totalProducts } = await supabaseAdmin
      .from('products')
      .select('*', { count: 'exact', head: true });

    return res.status(200).json({
      stats: {
        totalUsers: totalUsers || 0,
        totalMerchants: totalMerchants || 0,
        totalOrders: totalOrders || 0,
        totalOffers: totalOffers || 0,
        totalProducts: totalProducts || 0,
      },
    });
  }

  // ============================================================
  // LIST USERS (with pagination)
  // ============================================================
  if (action === 'users') {
    const { limit = 50, offset = 0 } = req.query;

    const { data: users, error, count } = await supabaseAdmin
      .from('profiles')
      .select('id, phone, full_name, email, role, is_banned, ban_reason, created_at, updated_at')
      .eq('role', 'user')
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      users,
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0),
    });
  }

  // ============================================================
  // BAN USER (Admin only)
  // ============================================================
  if (action === 'user-ban') {
    const { user_id, reason } = req.body;

    if (!user_id || !reason) {
      return res.status(400).json({ error: 'User ID and reason required.' });
    }

    if (user_id === adminId) {
      return res.status(400).json({ error: 'You cannot ban yourself.' });
    }

    const { data: user } = await supabaseAdmin
      .from('profiles')
      .select('id, role, is_banned')
      .eq('id', user_id)
      .single();

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (user.role === 'admin') {
      return res.status(400).json({ error: 'Cannot ban another admin.' });
    }

    if (user.is_banned) {
      return res.status(409).json({ error: 'User is already banned.' });
    }

    const { error } = await supabaseAdmin
      .from('profiles')
      .update({
        is_banned: true,
        ban_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user_id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Log the ban
    await supabaseAdmin.from('bans').insert({
      admin_id: adminId,
      banned_user_id: user_id,
      reason,
    });

    return res.status(200).json({ success: true });
  }

  // ============================================================
  // DELETE USER (Admin only)
  // ============================================================
  if (action === 'user-delete') {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'User ID required.' });
    }

    if (user_id === adminId) {
      return res.status(400).json({ error: 'You cannot delete yourself.' });
    }

    const { data: user } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('id', user_id)
      .single();

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (user.role === 'admin') {
      return res.status(400).json({ error: 'Cannot delete another admin.' });
    }

    // Delete user (CASCADE will remove orders, reviews, addresses, etc.)
    const { error } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', user_id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true });
  }

  // ============================================================
  // LIST MERCHANTS (with pagination and shop info)
  // ============================================================
  if (action === 'merchants') {
    const { limit = 50, offset = 0 } = req.query;

    const { data: merchants, error, count } = await supabaseAdmin
      .from('profiles')
      .select(`
        id,
        phone,
        full_name,
        email,
        is_banned,
        ban_reason,
        created_at,
        shops:shops (
          id,
          shop_name,
          proprietor_name,
          phone,
          address,
          image_url,
          rating_cache
        )
      `)
      .eq('role', 'merchant')
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      merchants,
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0),
    });
  }

  // ============================================================
  // BAN MERCHANT (Admin only)
  // ============================================================
  if (action === 'merchant-ban') {
    const { merchant_id, reason } = req.body;

    if (!merchant_id || !reason) {
      return res.status(400).json({ error: 'Merchant ID and reason required.' });
    }

    if (merchant_id === adminId) {
      return res.status(400).json({ error: 'You cannot ban yourself.' });
    }

    const { data: merchant } = await supabaseAdmin
      .from('profiles')
      .select('id, role, is_banned')
      .eq('id', merchant_id)
      .single();

    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found.' });
    }

    if (merchant.role === 'admin') {
      return res.status(400).json({ error: 'Cannot ban another admin.' });
    }

    if (merchant.is_banned) {
      return res.status(409).json({ error: 'Merchant is already banned.' });
    }

    const { error } = await supabaseAdmin
      .from('profiles')
      .update({
        is_banned: true,
        ban_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', merchant_id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Log the ban
    await supabaseAdmin.from('bans').insert({
      admin_id: adminId,
      banned_user_id: merchant_id,
      reason,
    });

    return res.status(200).json({ success: true });
  }

  // ============================================================
  // DELETE MERCHANT (Admin only)
  // ============================================================
  if (action === 'merchant-delete') {
    const { merchant_id } = req.body;

    if (!merchant_id) {
      return res.status(400).json({ error: 'Merchant ID required.' });
    }

    if (merchant_id === adminId) {
      return res.status(400).json({ error: 'You cannot delete yourself.' });
    }

    const { data: merchant } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .eq('id', merchant_id)
      .single();

    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found.' });
    }

    if (merchant.role === 'admin') {
      return res.status(400).json({ error: 'Cannot delete another admin.' });
    }

    // Delete merchant (CASCADE will remove shop, products, orders, etc.)
    const { error } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', merchant_id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true });
  }

  // ============================================================
  // VIEW ALL ORDERS (Admin only)
  // ============================================================
  if (action === 'orders') {
    const { limit = 50, offset = 0 } = req.query;

    const { data: orders, error, count } = await supabaseAdmin
      .from('orders')
      .select(`
        id,
        delivery_fee,
        special_note,
        total_price,
        status,
        created_at,
        updated_at,
        profiles:user_id (full_name, phone),
        shops:shop_id (shop_name)
      `)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      orders,
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0),
    });
  }

  // ============================================================
  // VIEW ALL OFFERS (Admin only)
  // ============================================================
  if (action === 'offers') {
    const { limit = 50, offset = 0 } = req.query;

    const { data: offers, error, count } = await supabaseAdmin
      .from('offers')
      .select(`
        id,
        title,
        description,
        image_url,
        old_price,
        offer_price,
        discount_percent,
        expires_at,
        created_at,
        shops:shop_id (shop_name)
      `)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      offers,
      total: count || 0,
      hasMore: (Number(offset) + Number(limit)) < (count || 0),
    });
  }

  return res.status(400).json({ error: 'Invalid action' });
}
