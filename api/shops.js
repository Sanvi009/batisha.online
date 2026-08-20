import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const authHeader = req.headers.authorization;
  let userId = null, userRole = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.id;
      userRole = decoded.role;
    } catch (err) {
      // Token invalid – treat as public for GET requests
    }
  }

  const { action } = req.query;

  // ============================================================
  // GET SHOP DETAILS (Public, or Merchant's own shop)
  // ============================================================
  if (action === 'detail') {
    const { shop_id } = req.query;

    // If merchant is logged in and no shop_id provided, fetch their own shop
    if (!shop_id) {
      if (!userId || userRole !== 'merchant') {
        return res.status(400).json({ error: 'Shop ID required' });
      }

      const { data: shop, error } = await supabaseAdmin
        .from('shops')
        .select(`
          id,
          merchant_id,
          shop_name,
          proprietor_name,
          phone,
          address,
          image_url,
          rating_cache,
          created_at,
          profiles:merchant_id (full_name, phone)
        `)
        .eq('merchant_id', userId)
        .single();

      if (error || !shop) {
        return res.status(404).json({ error: 'Shop not found' });
      }

      return res.status(200).json({ shop });
    }

    // Public shop detail by ID
    const { data: shop, error } = await supabaseAdmin
      .from('shops')
      .select(`
        id,
        merchant_id,
        shop_name,
        proprietor_name,
        phone,
        address,
        image_url,
        rating_cache,
        created_at,
        profiles:merchant_id (full_name, phone)
      `)
      .eq('id', shop_id)
      .single();

    if (error || !shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    return res.status(200).json({ shop });
  }

  // ============================================================
  // UPDATE SHOP (Merchant only)
  // ============================================================
  if (action === 'update') {
    if (!userId || userRole !== 'merchant') {
      return res.status(403).json({ error: 'Forbidden — Merchant access only' });
    }

    const {
      shop_name,
      proprietor_name,
      phone,
      address,
      image_url
    } = req.body;

    // Get the merchant's shop
    const { data: shop, error: shopError } = await supabaseAdmin
      .from('shops')
      .select('id')
      .eq('merchant_id', userId)
      .single();

    if (shopError || !shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const updates = {};
    if (shop_name !== undefined) updates.shop_name = shop_name;
    if (proprietor_name !== undefined) updates.proprietor_name = proprietor_name;
    if (phone !== undefined) updates.phone = phone;
    if (address !== undefined) updates.address = address;
    if (image_url !== undefined) updates.image_url = image_url;
    updates.updated_at = new Date().toISOString();

    const { data: updatedShop, error } = await supabaseAdmin
      .from('shops')
      .update(updates)
      .eq('id', shop.id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      shop: updatedShop
    });
  }

  // ============================================================
  // DELETE SHOP (Admin only)
  // ============================================================
  if (action === 'delete') {
    if (!userId || userRole !== 'admin') {
      return res.status(403).json({ error: 'Forbidden — Admin access only' });
    }

    const { shop_id } = req.body;

    if (!shop_id) {
      return res.status(400).json({ error: 'Shop ID required' });
    }

    // Verify shop exists
    const { data: shop, error: shopError } = await supabaseAdmin
      .from('shops')
      .select('id')
      .eq('id', shop_id)
      .single();

    if (shopError || !shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Delete the shop (CASCADE will remove shop_products, offers, orders, order_items)
    const { error } = await supabaseAdmin
      .from('shops')
      .delete()
      .eq('id', shop_id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      message: 'Shop deleted permanently'
    });
  }

  return res.status(400).json({ error: 'Invalid action' });
}
